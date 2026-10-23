import * as THREE from 'three';
import { CAST } from '../data/cast';
import type { Kart } from '../race/kart';
import { newLocate } from '../race/track';
import { CharacterView } from '../render/characterView';
import { createPS1Material } from '../render/ps1Material';
import type { Race } from '../race/race';
import { Effects } from '../render/effects';
import { loadFace } from '../render/faceTexture';
import type { RetroPipeline } from '../render/pipeline';
import { PS1Globals } from '../render/ps1Material';
import { ItemViews } from '../render/itemViews';
import { RacerView } from '../render/racerView';
import { buildTrackEnv, type TrackEnv } from '../render/trackMesh';

/** Where a local player's view goes on the screen (0..1, origin bottom-left). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Split screen layouts: 1 = full, 2 = top / bottom (side by side on a tall screen), 3–4 = quarters. */
export function splitLayout(n: number, aspect: number): ViewRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2)
    return aspect < 1
      ? [
          { x: 0, y: 0.5, w: 1, h: 0.5 },
          { x: 0, y: 0, w: 1, h: 0.5 },
        ]
      : [
          { x: 0, y: 0.5, w: 1, h: 0.5 },
          { x: 0, y: 0, w: 1, h: 0.5 },
        ];
  return [
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  ].slice(0, n);
}

/**
 * Chase camera of one kart: behind and above, following the travel direction and the road's
 * banking (anti-gravity walls), wider field of view while boosting, rear view on demand,
 * scripted moves for the intro / finish.
 */
const tmpHead = new THREE.Vector3();

export class ChaseCam {
  readonly camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 900);
  private fwd = new THREE.Vector3(0, 0, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 68;
  private shakeT = 0;
  private shakeA = 0;
  private init = false;
  /** 'chase' = behind the kart, 'finish' = turning around it, 'tv' = trackside cameras (attract) */
  mode: 'chase' | 'finish' | 'tv' = 'chase';
  private orbit = 0;
  private tvSpot = new THREE.Vector3();
  private tvT = 0;

  constructor(public kart: Kart) {}

  private loc = newLocate();
  private hints: number[] = [];

  /**
   * The camera never goes under a road, behind a wall or under the terrain: the polygons are
   * one-sided, the circuit would vanish from the screen (anti-gravity entries, after jumps,
   * tight turns along a wall).
   */
  private keepOutOfTrack(p: THREE.Vector3) {
    const tr = this.kart.track;
    const loc = this.loc;
    tr.ribbons.forEach((rb, r) => {
      const hint = rb === this.kart.loc.ribbon ? Math.round(this.kart.loc.i) : (this.hints[r] ?? -1);
      const j = rb.nearest(p, hint, 60);
      if (j < 0) return;
      this.hints[r] = j;
      rb.locate(p, j, loc);
      const sm = rb.sample(j);
      if (sm.gap) return;
      const lim = loc.w + tr.shoulder;
      const ad = Math.abs(loc.d);
      // behind a wall: back inside
      const wall = loc.d > 0 ? sm.wallR : sm.wallL;
      if (wall && rb === this.kart.loc.ribbon && ad > lim - 0.4 && ad < lim + 8 && loc.h > -1.5 && loc.h < 3) {
        p.addScaledVector(loc.right, -Math.sign(loc.d) * (ad - (lim - 0.4)));
        rb.locate(p, j, loc);
      }
      // under the road (or just on it): above it again
      if (Math.abs(loc.d) < lim + 1 && loc.h < 0.6 && loc.h > -5) p.addScaledVector(loc.up, 0.6 - loc.h);
    });
    if (!tr.hasVoid && p.y < tr.groundY + 0.5) p.y = tr.groundY + 0.5;
    // just under ANOTHER part of the circuit (spiral decks, a bridge over the road): closer to the kart
    const head = tmpHead.copy(this.kart.pos).addScaledVector(this.kart.up, 1.2);
    for (let it = 0; it < 4 && this.underOtherDeck(p); it++) p.lerp(head, 0.45);
  }

  private underOtherDeck(p: THREE.Vector3): boolean {
    const tr = this.kart.track;
    const loc = this.loc;
    for (const rb of tr.ribbons) {
      const j = rb.nearest(p, -1, 30);
      if (j < 0) continue;
      rb.locate(p, j, loc);
      if (rb.sample(j).gap || Math.abs(loc.d) > loc.w + tr.shoulder + 0.5 || loc.h > 0.5 || loc.h < -4) continue;
      // the kart's own stretch of road was handled above
      const ks = this.kart.loc;
      let ds = Math.abs(loc.s - ks.s);
      if (rb.closed) ds = Math.min(ds, rb.length - ds);
      if (rb !== ks.ribbon || ds > 35) return true;
    }
    return false;
  }

  shake(a: number) {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = 0.3;
  }

  reset() {
    this.init = false;
  }

  update(dt: number, aspect: number, interp: THREE.Vector3, quat: THREE.Quaternion) {
    const k = this.kart;
    const cam = this.camera;
    const kfwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const kup = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    // travel direction (drifts slide sideways: the camera looks where the kart goes)
    const travel = k.vel.lengthSq() > 9 && k.grounded ? k.vel.clone().normalize() : kfwd;
    if (k.spinT > 0 || k.rescueT > 0) travel.copy(this.fwd);
    const wantFwd = travel.addScaledVector(kup, -travel.dot(kup)).normalize().lerp(kfwd, 0.35).normalize();
    if (!this.init) {
      this.fwd.copy(kfwd);
      this.up.copy(kup);
    }
    this.fwd.lerp(wantFwd, Math.min(1, dt * 5)).normalize();
    // gravity-ish up: follows the road strongly in anti-gravity, gently elsewhere
    const wantUp = k.loc.antigrav ? kup : kup.clone().lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
    this.up.lerp(wantUp, Math.min(1, dt * 3)).normalize();
    let wantPos: THREE.Vector3;
    let wantLook: THREE.Vector3;
    if (this.mode === 'finish') {
      this.orbit += dt * 0.5;
      const side = new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
      const dir = this.fwd.clone().multiplyScalar(Math.cos(this.orbit)).addScaledVector(side, Math.sin(this.orbit));
      wantPos = interp.clone().addScaledVector(dir, 4.6).addScaledVector(this.up, 1.6);
      wantLook = interp.clone().addScaledVector(this.up, 0.9);
    } else if (this.mode === 'tv') {
      this.tvT -= dt;
      if (this.tvT <= 0 || this.tvSpot.distanceTo(interp) > 40) {
        // a new trackside spot ahead of the kart
        this.tvT = 5 + Math.random() * 3;
        const side = new THREE.Vector3().crossVectors(kfwd, kup).normalize();
        this.tvSpot
          .copy(interp)
          .addScaledVector(kfwd, 18 + Math.random() * 10)
          .addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5))
          .addScaledVector(kup, 1.5 + Math.random() * 3);
        this.init = false;
      }
      wantPos = this.tvSpot.clone();
      wantLook = interp.clone().addScaledVector(kup, 0.8);
    } else {
      const back = k.input.look ? -1 : 1;
      const dist = 4.9 + Math.min(1.2, Math.max(0, k.speed - 15) * 0.08);
      wantPos = interp.clone().addScaledVector(this.fwd, -dist * back).addScaledVector(this.up, 1.85);
      wantLook = interp.clone().addScaledVector(this.fwd, 3.5 * back).addScaledVector(this.up, 0.85);
    }
    if (!this.init || this.mode === 'tv') {
      this.pos.copy(wantPos);
      this.look.copy(wantLook);
      this.init = true;
    } else {
      this.pos.lerp(wantPos, Math.min(1, dt * (this.mode === 'finish' ? 3 : 14)));
      this.look.lerp(wantLook, Math.min(1, dt * 16));
    }
    this.keepOutOfTrack(this.pos);
    cam.position.copy(this.pos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeA * (this.shakeT / 0.3);
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
    const boosting = k.boostT > 0 || k.starT > 0;
    const wantFov = (aspect < 1 ? 82 : 68) + (boosting ? 10 : 0) + Math.min(4, Math.max(0, k.speed - 18) * 0.4);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 4);
    cam.fov = this.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }
}

/**
 * The rescue: when a kart falls off or leaves the circuit, Spider-Pote (Enola's masked friend)
 * swings in, catches it with a web and puts it back on the track.
 */
class RescueView {
  readonly hero: CharacterView;
  private line: THREE.Mesh;
  private t = 0;
  kart: Kart | null = null;

  constructor(scene: THREE.Scene, face: Awaited<ReturnType<typeof loadFace>>) {
    this.hero = new CharacterView(CAST.spiderpote, face);
    this.hero.addTo(scene);
    this.hero.shadow.visible = false;
    const mat = createPS1Material({ color: 0xf2f2f2, unlit: 0.6 });
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4, 1, true).translate(0, 0.5, 0), mat);
    scene.add(this.line);
    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.hero.root.visible = v;
    this.line.visible = v;
  }

  update(dt: number, kartPos: THREE.Vector3) {
    const k = this.kart;
    if (!k || k.rescueT <= 0) {
      this.setVisible(false);
      this.kart = null;
      return;
    }
    this.t += dt;
    this.setVisible(true);
    const r = k.rescueT;
    // swing in from above, hold the kart up, let it go and fly away
    const lift = r > 1.6 ? 3 + (r - 1.6) * 10 : r > 0.5 ? 2.6 : 2.6 + (0.5 - r) * 14;
    const side = r < 0.5 ? (0.5 - r) * 6 : 0;
    const root = this.hero.root;
    root.position.copy(kartPos).add(new THREE.Vector3(side, lift, 0));
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.t * 0.8);
    this.hero.animator.extra = { upperArmL: [-150, 0, 0], upperArmR: [-160, 0, 0], foreArmL: [-10, 0, 0], foreArmR: [-10, 0, 0] };
    this.hero.pose('air', this.t * 60, dt * 60, 'air', 6);
    // the web from his hand down to the kart
    const hand = new THREE.Vector3();
    this.hero.model.bones.handR.getWorldPosition(hand);
    const to = kartPos.clone().add(new THREE.Vector3(0, 0.6, 0));
    const d = to.clone().sub(hand);
    const len = d.length();
    this.line.position.copy(hand);
    this.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.line.scale.set(1, len, 1);
    this.line.visible = r > 0.35;
  }

  dispose() {
    this.hero.dispose();
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.line.removeFromParent();
  }
}

/** Everything 3D of a race: circuit, karts with their drivers, effects; rendered for 1–4 views. */
export class RaceWorld {
  readonly scene = new THREE.Scene();
  readonly effects = new Effects();
  readonly env: TrackEnv;
  readonly views: RacerView[];
  readonly cams: ChaseCam[];
  /** visual extensions (items) updated every rendered frame */
  readonly extras: { update(dt: number, alpha: number): void; dispose(): void }[] = [];
  private time = 0;
  private interp = new THREE.Vector3();
  private iq = new THREE.Quaternion();
  /** sample effects kept alive so their shaders stay compiled */
  private warm: Effects | null = null;
  private rescues: RescueView[] = [];
  /** visuals of the items (null without items) */
  items: ItemViews | null = null;
  private heroFace: Awaited<ReturnType<typeof loadFace>> | null = null;

  private constructor(
    readonly race: Race,
    views: RacerView[],
    /** kart followed by each local view */
    followed: number[],
  ) {
    this.env = buildTrackEnv(race.track);
    this.scene.add(this.env.group);
    this.scene.add(this.effects.group);
    this.views = views;
    for (const v of views) {
      v.addTo(this.scene);
      v.dustColor = this.env.dust;
    }
    this.cams = followed.map((i) => new ChaseCam(race.karts[i]));
  }

  static async create(race: Race, followed: number[]): Promise<RaceWorld> {
    const faces = await Promise.all(race.karts.map((k) => loadFace(k.def)));
    const views = race.karts.map((k, i) => new RacerView(k.def, faces[i]));
    const w = new RaceWorld(race, views, followed);
    if (race.items) w.items = new ItemViews(w.scene, race, race.items, views, w.effects);
    w.heroFace = await loadFace(CAST.spiderpote);
    // two heroes ready (more are created if many karts fall at once)
    w.rescues.push(new RescueView(w.scene, w.heroFace), new RescueView(w.scene, w.heroFace));
    return w;
  }

  /** Compiles every shader and uploads every texture before the race starts (no stutter later). */
  async prewarm(pipeline: RetroPipeline) {
    this.applyLights();
    for (const v of this.views) v.prepare();
    for (const r of this.rescues) r.setVisible(true);
    // one of each effect, never shown (keeps the materials, hence the programs, alive)
    const warm = new Effects();
    const p = new THREE.Vector3(0, -1000, 0);
    warm.kartSpark(p, 0xffffff, new THREE.Vector3(), 3);
    warm.flame(p, new THREE.Vector3());
    warm.puff(p, 0xffffff, 1, 10, new THREE.Vector3());
    warm.flash(p, 0xffffff);
    warm.pop(p, [0xffffff]);
    warm.confetti(p, 2);
    warm.cine('explosion', p);
    warm.cine('smoke', p);
    warm.cine('poof', p);
    warm.cine('stars', p);
    warm.cine('web', p);
    warm.glyph('question', p);
    warm.cine('powerAura', p);
    // builds the batched particle meshes (one per texture / blending) so their shaders compile now
    warm.update(0);
    this.scene.add(warm.group);
    this.warm = warm;
    const samples = this.items?.samples() ?? [];
    for (const o of samples) o.position.set(0, -1000, 0);
    const cam = this.cams[0]?.camera ?? new THREE.PerspectiveCamera();
    await pipeline.prewarm(this.scene, cam);
    this.scene.remove(warm.group);
    for (const r of this.rescues) r.setVisible(false);
    for (const o of samples) o.removeFromParent();
  }

  private applyLights() {
    const e = this.env;
    PS1Globals.uLightDir.value.copy(e.lightDir);
    PS1Globals.uLightColor.value.copy(e.lightColor);
    PS1Globals.uAmbient.value.copy(e.ambient);
    PS1Globals.uFogColor.value.copy(e.fogColor);
    PS1Globals.uFogNear.value = e.fogNear;
    PS1Globals.uFogFar.value = e.fogFar;
  }

  /** Update every view (interpolated by `alpha`) and draw the local cameras into `rects`. */
  render(pipeline: RetroPipeline, alpha: number, dt: number, rects: ViewRect[], screenAspect: number) {
    this.time += dt;
    this.applyLights();
    this.env.update(this.time);
    const race = this.race;
    race.karts.forEach((k, i) => {
      // effects only for karts near a local camera (cheap on phones)
      let near = false;
      let close = false;
      for (const c of this.cams) {
        if (c.kart.pos.distanceToSquared(k.pos) < 70 * 70) near = true;
        if (c.camera.position.distanceToSquared(k.pos) < 22 * 22) close = true;
      }
      // small parts (hubs, steering wheel) only on the karts close to a camera
      const kv = this.views[i].kart;
      if (kv.details[0].visible !== close) for (const d of kv.details) d.visible = close;
      this.views[i].close = close;
      this.views[i].update(k, alpha, dt, near ? this.effects : null);
    });
    // rescues
    race.karts.forEach((k, i) => {
      if (k.rescueT <= 0 || this.rescues.some((r) => r.kart === k)) return;
      let r = this.rescues.find((x) => !x.kart);
      if (!r && this.heroFace) {
        r = new RescueView(this.scene, this.heroFace);
        this.rescues.push(r);
      }
      if (r) r.kart = k;
      void i;
    });
    for (const r of this.rescues) if (r.kart) r.update(dt, this.views[r.kart.index].kart.root.position);
    this.items?.update(dt);
    for (const x of this.extras) x.update(dt, alpha);
    this.effects.update(dt * 60);
    if (!rects.length) return;
    const views = rects.map((r, i) => {
      const cam = this.cams[i];
      const k = cam.kart;
      this.interp.copy(k.prevPos).lerp(k.pos, alpha);
      this.iq.copy(k.prevQuat).slerp(k.quat, alpha);
      cam.update(dt, (r.w / r.h) * screenAspect, this.interp, this.iq);
      return { camera: cam.camera, ...r };
    });
    pipeline.renderViews(this.scene, views, this.env.clearColor);
  }

  dispose() {
    for (const x of this.extras) x.dispose();
    this.items?.dispose();
    for (const v of this.views) v.dispose();
    for (const r of this.rescues) r.dispose();
    this.effects.dispose();
    this.warm?.dispose();
    this.env.dispose();
  }
}
