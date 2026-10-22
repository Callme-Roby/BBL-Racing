import * as THREE from 'three';
import type { Kart } from '../race/kart';
import type { Race } from '../race/race';
import { Effects } from '../render/effects';
import { loadFace } from '../render/faceTexture';
import type { RetroPipeline } from '../render/pipeline';
import { PS1Globals } from '../render/ps1Material';
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
    return new RaceWorld(race, views, followed);
  }

  /** Compiles every shader and uploads every texture before the race starts (no stutter later). */
  async prewarm(pipeline: RetroPipeline) {
    this.applyLights();
    for (const v of this.views) v.prepare();
    // one of each effect, never shown (keeps the materials, hence the programs, alive)
    const warm = new Effects();
    const p = new THREE.Vector3(0, -1000, 0);
    warm.kartSpark(p, 0xffffff, new THREE.Vector3(), true);
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
    this.scene.add(warm.group);
    this.warm = warm;
    const cam = this.cams[0]?.camera ?? new THREE.PerspectiveCamera();
    await pipeline.prewarm(this.scene, cam);
    this.scene.remove(warm.group);
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
      for (const c of this.cams) if (c.kart.pos.distanceToSquared(k.pos) < 70 * 70) near = true;
      this.views[i].update(k, alpha, dt, near ? this.effects : null);
    });
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
    for (const v of this.views) v.dispose();
    this.effects.dispose();
    this.warm?.dispose();
    this.env.dispose();
  }
}
