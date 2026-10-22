import * as THREE from 'three';
import type { FighterDef } from '../data/roster';
import type { Kart } from '../race/kart';
import { ghostMaterial } from './afterimage';
import { CharacterView } from './characterView';
import type { Effects } from './effects';
import type { FaceAssets } from './faceTexture';
import { buildKart, type KartModel } from './kartModel';

/** spark colours of the mini-turbo tiers (0 = charging: little white sparks) */
export const TIER_COLORS = [0xfff0c0, 0x3aa8ff, 0xff9a1a, 0xc65cff];

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const AX_X = new THREE.Vector3(1, 0, 0);

/** Translucent copies of the kart body left behind during a turbo (the driver has its own Afterimage). */
class KartGhosts {
  readonly group = new THREE.Group();
  private ghosts: { obj: THREE.Object3D; mat: THREE.ShaderMaterial; life: number; alpha: number }[] = [];
  private next = 0;
  private acc = 0;
  private readonly life = 12;

  constructor(src: THREE.Object3D, count = 3) {
    for (let i = 0; i < count; i++) {
      const mat = ghostMaterial(true);
      const obj = src.clone(true);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.renderOrder = 3;
        }
      });
      obj.visible = false;
      obj.matrixAutoUpdate = false;
      this.group.add(obj);
      this.ghosts.push({ obj, mat, life: 0, alpha: 0 });
    }
  }

  update(src: THREE.Object3D, tint: THREE.Color | null, dtFrames: number, interval = 3) {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dtFrames;
      if (g.life <= 0) g.obj.visible = false;
      else g.mat.uniforms.uOpacity.value = g.alpha * Math.pow(g.life / this.life, 1.4);
    }
    if (!tint) {
      this.acc = interval;
      return;
    }
    this.acc += dtFrames;
    if (this.acc < interval) return;
    this.acc = 0;
    const g = this.ghosts[this.next];
    this.next = (this.next + 1) % this.ghosts.length;
    g.obj.matrix.copy(src.matrixWorld);
    g.obj.matrixWorldNeedsUpdate = true;
    g.mat.uniforms.uColor.value.copy(tint);
    g.alpha = 0.3;
    g.life = this.life;
    g.obj.visible = true;
  }

  clear() {
    for (const g of this.ghosts) {
      g.life = 0;
      g.obj.visible = false;
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.ghosts) g.mat.dispose();
  }
}

/**
 * A friend driving their kart: the kart model, the seated character and every visual of the
 * driving (wheels, steering, drift angle, hop, tricks, spin-outs, anti-gravity, sparks, flames,
 * dust, turbo ghosts). Driven by a Kart (src/race/kart.ts) each rendered frame.
 */
export class RacerView {
  readonly kart: KartModel;
  readonly driver: CharacterView;
  private ghosts: KartGhosts;
  private wheelSpin = 0;
  /** visual drift yaw (rad) and lean (rad), smoothed */
  private driftYaw = 0;
  private lean = 0;
  private hopY = 0;
  private trickRot = 0;
  private time = 0;
  private sparkAcc = 0;
  private clip = 'kart:sit';
  private clipStart = 0;
  private clipKey = '';
  private lastTrickT = 0;
  private hitClipT = 0;
  private antigrav = 0;
  private tint = new THREE.Color();
  /** dust colour of the offroad of this circuit */
  dustColor = 0xb8a070;
  /** draw effects (false for far-away karts on small screens) */
  fx = true;
  /** finished: celebrate (true) or sulk (false); null = racing */
  result: boolean | null = null;
  /** shown above the kart while carried back by the rescue */
  rescued = false;

  constructor(
    readonly def: FighterDef,
    face: FaceAssets,
  ) {
    this.kart = buildKart(def, face);
    this.driver = new CharacterView(def, face);
    this.ghosts = new KartGhosts(this.kart.body);
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.kart.root);
    this.driver.addTo(scene);
    scene.add(this.ghosts.group);
    this.driver.shadow.visible = false;
  }

  /** Builds the trails now and compiles their shaders next frame (race prewarm). */
  prepare() {
    this.driver.prepareTrail();
  }

  setVisible(v: boolean) {
    this.kart.root.visible = v;
    this.driver.root.visible = v;
    if (!v) {
      this.ghosts.clear();
      this.driver.clearTrail();
    }
  }

  /**
   * @param k the kart
   * @param alpha interpolation between the last two physics steps
   * @param dt seconds since the last rendered frame
   */
  update(k: Kart, alpha: number, dt: number, fx: Effects | null) {
    const dtF = dt * 60;
    this.time += dt;
    const root = this.kart.root;
    root.position.copy(k.prevPos).lerp(k.pos, alpha);
    root.quaternion.copy(k.prevQuat).slerp(k.quat, alpha);

    // ---- body: drift angle, lean, hop, trick, spin-out, squash
    const drifting = k.drift !== 0;
    const wantYaw = drifting ? k.drift * (0.42 + 0.12 * k.input.steer * k.drift) : k.lat * -0.03;
    this.driftYaw += (wantYaw - this.driftYaw) * Math.min(1, dt * 8);
    const wantLean = (drifting ? -k.drift * 0.1 : -k.steer * 0.06 * Math.min(1, Math.abs(k.speed) / 12)) * (k.grounded ? 1 : 0.4);
    this.lean += (wantLean - this.lean) * Math.min(1, dt * 8);
    // little bounce on rough ground
    const rough = k.grounded && (k.surface === 'offroad' || k.surface === 'dirt' || k.surface === 'curb') ? Math.sin(this.time * 40) * 0.025 * Math.min(1, Math.abs(k.speed) / 10) : 0;
    this.hopY = rough;
    const body = this.kart.body;
    body.position.set(0, this.hopY, 0);
    body.quaternion.setFromAxisAngle(AX_Y, this.driftYaw + k.spinAngle);
    tmpQ.setFromAxisAngle(AX_Z, this.lean);
    body.quaternion.multiply(tmpQ);
    // trick: a quick roll (or a flip for the 3rd variant)
    if (k.trickT > 0) {
      const p = 1 - k.trickT / 0.55;
      this.trickRot = p * Math.PI * 2;
      tmpQ.setFromAxisAngle(k.trickVariant === 2 ? AX_X : AX_Z, k.trickVariant === 1 ? -this.trickRot : this.trickRot);
      body.quaternion.multiply(tmpQ);
    }
    const sq = k.squashT > 0 ? 0.55 : 1;
    body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // ---- wheels & steering wheel
    this.wheelSpin += (k.speed / this.kart.wheelR) * dt * (k.burnoutT > 0 ? 3 : 1) + (k.burnoutT > 0 ? dt * 40 : 0);
    for (const w of this.kart.wheels) w.rotation.x = this.wheelSpin;
    const steerA = drifting ? k.drift * 0.5 + k.steer * 0.15 : k.steer * 0.42;
    this.kart.steerL.rotation.y = -steerA;
    this.kart.steerR.rotation.y = -steerA;
    this.kart.steeringWheel.rotation.z = steerA * 2.2;
    // anti-gravity: wheels turn flat, blue glow underneath
    const ag = k.loc.antigrav && Math.abs(k.loc.d) <= k.loc.w + 2 ? 1 : 0;
    this.antigrav += (ag - this.antigrav) * Math.min(1, dt * 6);
    this.kart.mounts.forEach((m, i) => {
      const left = i % 2 === 0;
      m.rotation.z = (left ? 1 : -1) * this.antigrav * (Math.PI / 2);
    });
    this.kart.hover.visible = this.antigrav > 0.3;
    if (this.kart.hover.visible) {
      const pulse = 0.8 + 0.2 * Math.sin(this.time * 12);
      this.kart.hover.scale.setScalar(pulse);
    }
    // star: rainbow glow
    if (k.starT > 0) {
      // SUPER SAYAN: a golden, pulsing glow
      this.tint.setRGB(1, 0.78 + 0.18 * Math.sin(this.time * 18), 0.25);
      for (const m of this.kart.materials) {
        m.uniforms.uFlash.value = 0.45;
        m.uniforms.uFlashColor.value.copy(this.tint);
      }
      this.driver.setGlow(0.45, this.tint);
    } else {
      for (const m of this.kart.materials) m.uniforms.uFlash.value = 0;
      this.driver.setGlow(0);
    }
    root.updateMatrixWorld(true);

    // ---- the driver in the seat
    const seat = this.kart.seat;
    seat.matrixWorld.decompose(tmpV, tmpQ, tmpS);
    const dr = this.driver.root;
    dr.position.copy(tmpV);
    dr.quaternion.copy(tmpQ);
    const s = this.def.height ?? 1;
    // a tall friend sinks a bit deeper in the seat
    dr.scale.setScalar(1);
    this.driver.model.body.scale.setScalar(s);
    this.driver.model.body.position.set(0, -(s - 1) * 0.35, 0);
    this.poseDriver(k, dt);
    this.driver.headWorld();

    // ---- trails during turbos
    const boosting = k.boostT > 0 || k.starT > 0;
    let ghostTint: THREE.Color | null = null;
    if (boosting && (k.starT > 0 || k.boostPower >= 1 || (k.boostKind === 'drift' && k.boostT > 0.4))) ghostTint = this.tint.set(k.starT > 0 ? 0xffd040 : k.boostKind === 'drift' ? 0xff8a30 : 0xffc040);
    this.ghosts.update(body, ghostTint, dtF, 4);
    this.driver.updateTrail(ghostTint, dtF, 4, 0.28);

    if (fx && this.fx) this.emit(k, dt, fx);
  }

  /**
   * Menus / podium: the kart parked at `pos` facing `yaw`, the driver seated and idling
   * (or playing `clip`).
   */
  showcase(pos: THREE.Vector3, yaw: number, dt: number, clip = 'kart:sit') {
    this.time += dt;
    const root = this.kart.root;
    root.position.copy(pos);
    root.quaternion.setFromAxisAngle(AX_Y, yaw);
    const body = this.kart.body;
    body.position.set(0, Math.sin(this.time * 30) * 0.004, 0);
    body.quaternion.identity();
    body.scale.set(1, 1, 1);
    for (const w of this.kart.wheels) w.rotation.x = 0;
    this.kart.steerL.rotation.y = Math.sin(this.time * 0.8) * 0.2;
    this.kart.steerR.rotation.y = this.kart.steerL.rotation.y;
    this.kart.steeringWheel.rotation.z = -this.kart.steerL.rotation.y * 2;
    this.kart.hover.visible = false;
    for (const m of this.kart.mounts) m.rotation.z = 0;
    root.updateMatrixWorld(true);
    this.kart.seat.matrixWorld.decompose(tmpV, tmpQ, tmpS);
    this.driver.root.position.copy(tmpV);
    this.driver.root.quaternion.copy(tmpQ);
    const s = this.def.height ?? 1;
    this.driver.model.body.scale.setScalar(s);
    this.driver.model.body.position.set(0, -(s - 1) * 0.35, 0);
    this.setClip(clip);
    const a = this.driver.animator;
    a.extra = {};
    this.driver.pose(this.clip, (this.time - this.clipStart) * 60, dt * 60, this.clipKey, 6);
  }

  private setClip(clip: string, key = clip) {
    if (key !== this.clipKey) {
      this.clipKey = key;
      this.clip = clip;
      this.clipStart = this.time;
    }
  }

  private poseDriver(k: Kart, dt: number) {
    if (k.trickT > 0 && this.lastTrickT <= 0) this.setClip('kart:trick' + k.trickVariant, 'trick' + this.time);
    this.lastTrickT = k.trickT;
    if (k.spinT > 0 || k.rescueT > 0) {
      if (this.hitClipT <= 0) this.setClip('kart:hit', 'hit' + this.time);
      this.hitClipT = 1;
    } else this.hitClipT = Math.max(0, this.hitClipT - dt);
    const busy = this.clip.startsWith('kart:trick') || this.clip === 'kart:hit';
    const elapsed = (this.time - this.clipStart) * 60;
    if (!busy || elapsed > 60) {
      if (this.result === true) this.setClip('kart:win');
      else if (this.result === false) this.setClip('kart:lose');
      else if (k.input.look) this.setClip('kart:look');
      else if (k.drift !== 0) this.setClip('kart:drift');
      else this.setClip('kart:sit');
    }
    const steer = k.drift !== 0 ? k.drift * 0.6 + k.steer * 0.4 : k.steer;
    const a = this.driver.animator;
    a.extra.spine = [0, -steer * 6, steer * 9];
    a.extra.head = [0, -steer * 14, steer * 5];
    a.extra.upperArmL = [-steer * 14, 0, 0];
    a.extra.upperArmR = [steer * 14, 0, 0];
    this.driver.pose(this.clip, (this.time - this.clipStart) * 60, dt * 60, this.clipKey, 5);
  }

  private emit(k: Kart, dt: number, fx: Effects) {
    const body = this.kart.body;
    const back = tmpV2.set(0, 0, -1).applyQuaternion(this.kart.root.quaternion);
    this.sparkAcc += dt * 60;
    const every = this.sparkAcc >= 1;
    if (every) this.sparkAcc = 0;
    if (!every) return;
    // drift sparks
    if (k.drift !== 0 && k.grounded) {
      const col = TIER_COLORS[k.driftTier];
      for (const c of this.kart.rearContacts) {
        c.getWorldPosition(tmpV);
        for (let n = 0; n < 1 + k.driftTier; n++) {
          const v = back.clone().multiplyScalar(0.05 + Math.random() * 0.04).add(new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.03 + Math.random() * 0.05, (Math.random() - 0.5) * 0.08));
          fx.kartSpark(tmpV, col, v, k.driftTier);
        }
      }
    }
    // turbo flames
    if (k.boostT > 0) {
      const col = k.boostKind === 'drift' ? 0xff7a1a : k.boostKind === 'trick' ? 0xffd040 : 0xff9a2a;
      for (const e of this.kart.exhausts) {
        e.getWorldPosition(tmpV);
        fx.flame(tmpV, back.clone().multiplyScalar(0.06), col, k.boostPower > 1 ? 1.3 : 1);
      }
    }
    // burnout smoke, offroad dust
    if (k.burnoutT > 0) {
      for (const c of this.kart.rearContacts) {
        c.getWorldPosition(tmpV);
        fx.puff(tmpV, 0xd8d8d8, 0.4, 30, new THREE.Vector3((Math.random() - 0.5) * 0.02, 0.02, (Math.random() - 0.5) * 0.02));
      }
    } else if (k.grounded && (k.surface === 'offroad' || k.surface === 'dirt') && Math.abs(k.speed) > 4 && Math.random() < 0.6) {
      const c = this.kart.rearContacts[Math.random() < 0.5 ? 0 : 1];
      c.getWorldPosition(tmpV);
      fx.puff(tmpV, this.dustColor, 0.35, 26, back.clone().multiplyScalar(0.03).add(new THREE.Vector3(0, 0.02, 0)), 0.6);
    }
    void body;
  }

  dispose() {
    this.ghosts.dispose();
    this.kart.dispose();
    this.driver.dispose();
  }
}
