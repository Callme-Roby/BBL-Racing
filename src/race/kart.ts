import * as THREE from 'three';
import type { KartStats } from '../data/kartStats';
import type { FighterDef } from '../data/roster';
import type { KartInput } from '../input/input';
import type { ItemId } from './itemDefs';
import type { ObjKind } from './items';
import { newLocate, type Locate, type Ribbon, type Surface, type Track } from './track';

/**
 * Arcade kart physics (fixed 60 Hz step), Mario Kart 8 style mechanics:
 *  - acceleration / top speed / handling / weight from the friend's stats;
 *  - hop + drift with a 3-tier mini-turbo (blue → orange → purple sparks);
 *  - start boost (accelerate at the right moment of the countdown, too early = burnout);
 *  - ramps: press DRIFT in the air (trick) → small boost on landing;
 *  - slipstream behind another kart (charged by the race, see Race.slipstream);
 *  - offroad slows you down (not while boosting); boost pads;
 *  - anti-gravity sections: gravity follows the road, bumping karts = spin boost;
 *  - falling into the void / leaving the circuit: a friend puts you back on the track.
 */

export const DT = 1 / 60;
const GRAVITY = 30;
/** speed under which a drift can't start / stops */
const DRIFT_MIN_SPEED = 7.5;
/** horizontal speed a ramp over a gap gives at least (m/s) */
const JUMP_MIN_SPEED = 19.5;
/** the canal under a jump reaches this far beyond the shoulders (see trackMesh) */
export const CANAL_MARGIN = 8;

/** mini-turbo thresholds (seconds of charge) and boost lengths */
export const DRIFT_TIERS = [0, 0.95, 2.05, 3.3];
const DRIFT_BOOST = [0, 0.55, 1.05, 1.7];
/**
 * Turning while drifting, as a share of the kart's full-lock turn rate: steering into the
 * drift tightens it, steering out of it opens it (wide sweeping arcs, never tighter than
 * normal full lock).
 */
export const DRIFT_YAW = { base: 0.42, range: 0.2 };
/** seconds for a drift to build up from normal steering to its full turn (no sudden snap) */
const DRIFT_EASE_IN = 0.6;

export type BoostKind = 'drift' | 'start' | 'trick' | 'pad' | 'slip' | 'item' | 'bump';

/** Something visible / audible happened (consumed by the views, the HUD and the sound). */
export type KartEvent =
  | { k: 'hop' }
  | { k: 'land'; hard: boolean }
  | { k: 'tier'; tier: number }
  | { k: 'boost'; kind: BoostKind; tier?: number }
  | { k: 'trick' }
  | { k: 'bonk'; strength: number }
  | { k: 'bump'; other: number; strength: number }
  | { k: 'burnout' }
  | { k: 'fall' }
  | { k: 'rescued' }
  | { k: 'spin' }
  | { k: 'lap'; lap: number }
  | { k: 'finish' }
  | { k: 'itemBox' }
  | { k: 'itemGot'; item: ItemId }
  | { k: 'itemUse'; item: ItemId }
  | { k: 'itemHit'; item: ItemId | ObjKind; by: number }
  | { k: 'itemBlock'; item: ObjKind }
  | { k: 'rocketEnd' };

export interface KartParams {
  top: number;
  accel: number;
  turn: number;
  mass: number;
  driftRate: number;
  offroad: number;
}

/** engine class → base top speed (m/s) */
export const CC_SPEED: Record<number, number> = { 50: 17, 100: 21.5, 150: 26 };

export function kartParams(st: KartStats, cc: number): KartParams {
  const base = CC_SPEED[cc] ?? CC_SPEED[100];
  const top = base * (0.94 + 0.03 * st.speed);
  return {
    top,
    accel: top * 0.5 * (0.62 + 0.18 * st.accel),
    turn: 1.5 + 0.16 * st.handling,
    mass: 0.75 + 0.2 * st.weight,
    driftRate: 0.86 + 0.07 * st.handling,
    offroad: 0.4 + 0.025 * st.weight,
  };
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Kart {
  readonly params: KartParams;
  // ---- motion
  readonly pos = new THREE.Vector3();
  /** heading and up of the kart (orthonormal, right = fwd × up) */
  readonly fwd = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  /** forward speed (m/s, negative = reversing), sideways slide, and the world velocity while airborne */
  speed = 0;
  lat = 0;
  readonly airVel = new THREE.Vector3();
  /** real motion of the last grounded steps (follows the road's slope) */
  private readonly groundVel = new THREE.Vector3();
  grounded = true;
  airTime = 0;
  /** last step's world velocity (cameras, slipstream, collisions) */
  readonly vel = new THREE.Vector3();
  // ---- where on the track
  readonly loc: Locate = newLocate();
  private hints: number[] = [];
  private gPoint = new THREE.Vector3();
  private gDir = new THREE.Vector3();
  surface: Surface = 'road';
  /** steering as shown (smoothed) */
  steer = 0;
  // ---- drift
  drift: -1 | 0 | 1 = 0;
  driftCharge = 0;
  /** seconds since the current drift started */
  private driftT = 0;
  driftTier = 0;
  /** hop: the drift starts if the button is still held when it lands */
  private hopping = false;
  private prevDrift = false;
  private prevItem = false;
  // ---- boosts
  boostT = 0;
  boostPower = 0;
  boostKind: BoostKind | null = null;
  /** time spent in a slipstream (Race.slipstream charges it) */
  slipT = 0;
  // ---- tricks
  trickable = false;
  tricked = false;
  trickT = 0;
  trickVariant = 0;
  // ---- trouble
  /** spinning out (hit by an item), seconds left */
  spinT = 0;
  /** squashed / shrunk visuals */
  squashT = 0;
  /** invincible (star-like item), seconds left */
  starT = 0;
  /** rescue: falling then carried back, seconds left (0 = driving) */
  rescueT = 0;
  private rescueTarget = { s: 0, d: 0 };
  /** last safe point (on the road) */
  private safeS = 0;
  private safeD = 0;
  // ---- start
  /** time the accelerator has been held before GO (start boost) */
  startHold = 0;
  burnoutT = 0;
  // ---- race
  /** main-line distance of the last step and total progress (laps × length + s) */
  lastS = 0;
  progress = 0;
  lap = 1;
  finished = false;
  finishTime = 0;
  rank = 0;
  /** CPU / remote driver (no local input) */
  cpu = false;
  /** steering / accel used by the step (shown by the views: wheel, driver's arms) */
  input: KartInput = { steer: 0, accel: false, brake: false, drift: false, item: false, look: false, aim: 0 };
  /** item use edge (press) and hold, read by the race (items) */
  itemPressed = false;
  itemHeld = false;
  readonly events: KartEvent[] = [];
  /** previous step (render interpolation) */
  readonly prevPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly quat = new THREE.Quaternion();
  /** visual spin of a spin-out (rad) */
  spinAngle = 0;

  constructor(
    readonly index: number,
    readonly def: FighterDef,
    readonly stats: KartStats,
    cc: number,
    readonly track: Track,
  ) {
    this.params = kartParams(stats, cc);
    this.hints = track.ribbons.map(() => -1);
  }

  get right(): THREE.Vector3 {
    return tmpV2.crossVectors(this.fwd, this.up).normalize();
  }

  /** current top speed (boosts / offroad applied) */
  get topSpeed(): number {
    return this.params.top;
  }

  place(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3) {
    this.pos.copy(pos);
    this.fwd.copy(fwd);
    this.up.copy(up);
    this.speed = 0;
    this.lat = 0;
    this.grounded = true;
    this.airVel.set(0, 0, 0);
    this.groundVel.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.hints = this.track.ribbons.map(() => -1);
    this.locateGround();
    const s = this.loc.ribbon.mainS(this.loc.s);
    const L = this.track.length;
    // the grid is behind the line: progress starts slightly negative
    this.lastS = s;
    this.progress = s > L / 2 ? s - L : s;
    this.safeS = s;
    this.safeD = this.loc.d;
    this.updateQuat();
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  private updateQuat() {
    const r = tmpV.crossVectors(this.fwd, this.up).normalize();
    // basis: x = -right (model's left), y = up, z = fwd
    const m = new THREE.Matrix4().makeBasis(r.negate(), this.up, this.fwd);
    this.quat.setFromRotationMatrix(m);
  }

  /** Find the ribbon under the kart (main line or a shortcut) and the road frame there. */
  locateGround() {
    const tr = this.track;
    let best: Locate | null = null;
    let bestScore = 1e9;
    const cand = newLocate();
    tr.ribbons.forEach((rb, k) => {
      const hint = this.hints[k];
      const j = rb.nearest(this.pos, rb.isMain ? hint : -1, rb.isMain ? 1e9 : 40);
      if (j < 0) return;
      this.hints[k] = j;
      rb.locate(this.pos, j, cand);
      cand.h -= tr.kickerAt(rb, cand.s, cand.d);
      const over = Math.max(0, Math.abs(cand.d) - (cand.w + tr.shoulder));
      // on the ribbon (or just beside it) and close to its surface: the best candidate
      const score = over * 4 + Math.abs(Math.min(cand.h, 8)) + (rb.isMain ? 0 : 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = { ...cand, point: cand.point.clone(), up: cand.up.clone(), fwd: cand.fwd.clone(), right: cand.right.clone() };
      }
    });
    if (best) {
      const b = best as Locate;
      const l = this.loc;
      l.ribbon = b.ribbon;
      l.i = b.i;
      l.s = b.s;
      l.d = b.d;
      l.h = b.h;
      l.w = b.w;
      l.point.copy(b.point);
      l.up.copy(b.up);
      l.fwd.copy(b.fwd);
      l.right.copy(b.right);
      l.antigrav = b.antigrav;
      l.ramp = b.ramp;
    }
  }

  /** ground under the kart: point, normal, surface (null = nothing below: void) */
  private ground(): { point: THREE.Vector3; normal: THREE.Vector3; surface: Surface; wall: 0 | -1 | 1; limit: number; bank?: -1 | 1 } | null {
    const l = this.loc;
    const tr = this.track;
    const ad = Math.abs(l.d);
    const limit = l.w + tr.shoulder;
    const sample = l.ribbon.sample(Math.round(l.i));
    const wallSide: 0 | -1 | 1 = l.d > 0 ? (sample.wallR ? 1 : 0) : sample.wallL ? -1 : 0;
    // the void (or the canal) of a jump
    if (sample.gap && (tr.hasVoid || ad <= limit + CANAL_MARGIN)) return null;
    // well under the road (fell off a bridge, under a jump): the terrain below, or nothing
    const under = l.h < -1.5;
    if (!sample.gap && !under && (ad <= limit || (wallSide !== 0 && ad <= limit + 3))) {
      const kick = tr.kickerAt(l.ribbon, l.s, l.d);
      const point = this.gPoint.copy(l.point).addScaledVector(l.up, kick);
      let surface: Surface = l.ribbon.surface === 'dirt' ? 'dirt' : 'road';
      if (ad > l.w) surface = 'offroad';
      else if (ad > l.w - 0.7 && l.ribbon.surface !== 'dirt') surface = 'curb';
      return { point, normal: l.up, surface, wall: ad > limit ? wallSide : 0, limit };
    }
    if (tr.hasVoid) return null;
    // the terrain around the track
    // under a raised road (its embankment / bridge side): a wall the kart can't get into
    const bank: -1 | 1 | undefined = under && !sample.gap && ad <= limit ? (l.d > 0 ? 1 : -1) : undefined;
    return { point: this.gPoint.set(this.pos.x, tr.groundY, this.pos.z), normal: WORLD_UP, surface: 'offroad', wall: 0, limit, bank };
  }

  /** gravity direction (unit, pointing "down") */
  private gravityDir(out: THREE.Vector3): THREE.Vector3 {
    const l = this.loc;
    if (l.antigrav && Math.abs(l.d) <= l.w + this.track.shoulder && l.h < 4) return out.copy(l.up).negate();
    return out.set(0, -1, 0);
  }

  addBoost(kind: BoostKind, seconds: number, power: number) {
    this.boostPower = this.boostT > 0 ? Math.max(this.boostPower, power) : power;
    this.boostT = Math.max(this.boostT, seconds);
    this.boostKind = kind;
    if (kind !== 'drift') this.events.push({ k: 'boost', kind });
  }

  /** hit by an item: spin out (unless invincible) */
  spinOut(seconds = 1.1) {
    if (this.starT > 0 || this.rescueT > 0) return false;
    this.spinT = Math.max(this.spinT, seconds);
    this.drift = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.boostT = 0;
    this.events.push({ k: 'spin' });
    return true;
  }

  /** start a rescue now (fell off, way off the track) */
  startRescue() {
    if (this.rescueT > 0) return;
    this.rescueT = 2.4;
    this.events.push({ k: 'fall' });
    let s = this.safeS;
    // fell into the gap of a jump: put back after it, not on the ramp before it
    const L = this.track.length;
    for (const [g0, g1] of this.track.gaps) {
      const before = (((g0 - s) % L) + L) % L;
      if (before < 45 || (s >= g0 && s <= g1)) s = g1 + 6;
    }
    this.rescueTarget = { s, d: Math.max(-2, Math.min(2, this.safeD * 0.4)) };
    this.drift = 0;
    this.driftCharge = 0;
    this.boostT = 0;
    this.spinT = 0;
  }

  /**
   * One physics step.
   * @param raceOn false during the countdown (start boost charging, no motion)
   */
  step(inp: KartInput, raceOn: boolean, time: number) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    const dt = DT;
    this.input = inp;
    const driftPress = inp.drift && !this.prevDrift;
    const driftRelease = !inp.drift && this.prevDrift;
    this.prevDrift = inp.drift;
    this.itemPressed = inp.item && !this.prevItem;
    this.itemHeld = inp.item;
    this.prevItem = inp.item;
    // steering is smoothed (more while drifting: a keyboard tap doesn't jerk the slide)
    this.steer += (inp.steer - this.steer) * Math.min(1, dt * (this.drift !== 0 ? 4 : 8));

    if (!raceOn) {
      // countdown: the start boost is decided by when the accelerator went down
      this.startHold = inp.accel ? this.startHold + dt : 0;
      this.updateQuat();
      return;
    }
    if (this.finished) inp = { ...inp, item: false };

    // ---- timers
    if (this.boostT > 0) {
      this.boostT -= dt;
      if (this.boostT <= 0) this.boostKind = null;
    }
    if (this.starT > 0) this.starT -= dt;
    if (this.squashT > 0) this.squashT -= dt;
    if (this.trickT > 0) this.trickT -= dt;
    if (this.burnoutT > 0) this.burnoutT -= dt;

    if (this.rescueT > 0) {
      this.stepRescue(dt);
      this.updateQuat();
      return;
    }

    const p = this.params;
    this.locateGround();
    const g = this.ground();
    const spinning = this.spinT > 0;
    if (spinning) {
      this.spinT -= dt;
      this.spinAngle += dt * 14 * Math.min(1, this.spinT + 0.3);
    } else this.spinAngle *= 0.8;

    // ---- engine
    let target = p.top;
    const boosting = this.boostT > 0;
    if (boosting) target *= 1 + 0.32 * this.boostPower;
    if (this.starT > 0) target *= 1.14;
    const offroad = this.grounded && g !== null && (g.surface === 'offroad' || g.surface === 'dirt');
    if (offroad && !boosting && this.starT <= 0) target *= g!.surface === 'dirt' ? 0.82 : p.offroad;
    if (this.squashT > 0) target *= 0.7;
    const control = !spinning && this.burnoutT <= 0;
    if (this.grounded) {
      if (control && (inp.accel || boosting) && !inp.brake) {
        if (this.speed < target) {
          const k = Math.max(0.12, 1 - Math.pow(Math.max(0, this.speed) / target, 2));
          this.speed += p.accel * k * dt * (boosting ? 2.6 : 1);
          if (this.speed > target) this.speed = target;
        } else this.speed += (target - this.speed) * Math.min(1, 2.2 * dt);
      } else if (control && inp.brake) {
        if (this.speed > 0) this.speed = Math.max(this.speed > 2 ? 0 : -0.1, this.speed - 26 * dt);
        else this.speed = Math.max(-7, this.speed - 10 * dt);
        this.drift = 0;
      } else {
        // coasting
        this.speed -= this.speed * (spinning ? 2.6 : 0.75) * dt;
        if (Math.abs(this.speed) < 0.05) this.speed = 0;
      }
      if (this.speed > target && !boosting) this.speed += (target - this.speed) * Math.min(1, (offroad ? 3 : 1.4) * dt);
    }

    // ---- steering & drift
    const sp = this.speed;
    const speedK = Math.min(1, Math.abs(sp) / 7) * (1 - 0.18 * Math.min(1, Math.max(0, sp - 18) / 10));
    let yawRate = 0;
    if (control && this.grounded) {
      if (driftPress && Math.abs(sp) > 3 && !this.hopping) {
        // hop (the drift starts on landing if the button is still held)
        this.takeOff(this.up.clone().multiplyScalar(3));
        this.hopping = true;
        this.events.push({ k: 'hop' });
      }
      if (this.drift !== 0) {
        if (!inp.drift || sp < DRIFT_MIN_SPEED) this.endDrift(driftRelease || !inp.drift);
        else {
          const d = this.drift;
          // always turning into the drift: steering opens or tightens it
          const tighten = Math.max(-1, Math.min(1, this.steer * d));
          // the drift builds up gently from the turn the kart already had
          this.driftT += dt;
          const e = Math.min(1, this.driftT / DRIFT_EASE_IN);
          const ease = e * e * (3 - 2 * e);
          const normal = this.steer * p.turn * speedK;
          yawRate = normal + (d * p.turn * (DRIFT_YAW.base + DRIFT_YAW.range * tighten) * speedK - normal) * ease;
          this.lat += (-d * Math.abs(sp) * (0.11 - 0.035 * tighten) * ease - this.lat) * Math.min(1, dt * 2.5);
          if (g && g.surface !== 'offroad') {
            const before = this.driftTier;
            this.driftCharge += dt * p.driftRate * (1 + 0.85 * Math.max(0, tighten));
            this.driftTier = this.driftCharge >= DRIFT_TIERS[3] ? 3 : this.driftCharge >= DRIFT_TIERS[2] ? 2 : this.driftCharge >= DRIFT_TIERS[1] ? 1 : 0;
            if (this.driftTier > before) this.events.push({ k: 'tier', tier: this.driftTier });
          }
        }
      } else {
        yawRate = inp.steer * p.turn * speedK * (sp < 0 ? -1 : 1) * (boosting ? 0.85 : 1);
      }
    } else if (control && !this.grounded) {
      // a little air control
      yawRate = inp.steer * p.turn * 0.35 * speedK;
    }
    if (yawRate) {
      tmpQ.setFromAxisAngle(this.up, -yawRate * dt);
      this.fwd.applyQuaternion(tmpQ).normalize();
    }
    if (this.drift === 0) this.lat -= this.lat * Math.min(1, dt * 4);

    // ---- integrate
    if (this.grounded) {
      const r = tmpV2.crossVectors(this.fwd, this.up).normalize();
      this.vel.copy(this.fwd).multiplyScalar(this.speed).addScaledVector(r, this.lat);
      this.pos.addScaledVector(this.vel, dt);
    } else {
      this.airTime += dt;
      const gd = this.gravityDir(this.gDir);
      this.airVel.addScaledVector(gd, GRAVITY * dt);
      this.pos.addScaledVector(this.airVel, dt);
      this.vel.copy(this.airVel);
      // the kart levels out in the air
      const wantUp = gd.clone().negate();
      this.up.lerp(wantUp, Math.min(1, dt * 2.5)).normalize();
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
      // trick on a ramp (or any real jump): press DRIFT in the air
      if (driftPress && this.trickable && !this.tricked && this.airTime < 1.6) {
        this.tricked = true;
        this.trickT = 0.55;
        this.trickVariant = (this.trickVariant + 1 + Math.floor(time * 7)) % 3;
        this.events.push({ k: 'trick' });
      }
    }

    // ---- ground contact
    this.locateGround();
    const g2 = this.ground();
    if (g2) {
      const h = tmpV.subVectors(this.pos, g2.point).dot(g2.normal);
      if (this.grounded) {
        if (h > 0.45 || (this.loc.ramp && h > 0.08 && this.speed > 9)) {
          // the road drops away (ramp lip, crest): fly
          this.trickable = this.loc.ramp > 0 || h > 1.2;
          const rb = this.loc.ribbon;
          const lip = this.loc.ramp > 0 || rb.sample(rb.indexAt(this.loc.s - 1.5)).ramp > 0 || rb.sample(Math.round(this.loc.i)).gap || this.track.kickerAt(rb, this.loc.s - 1.5, this.loc.d) > 0;
          this.takeOff(new THREE.Vector3(), lip);
          // a ramp over a gap always carries you across when you take it (even slowed down in the pack)
          let gapAhead = false;
          for (let o = 1; o <= 4; o++) if (rb.sample(Math.round(this.loc.i) + o).gap) gapAhead = true;
          if (lip && gapAhead) {
            const vy = this.airVel.y;
            this.airVel.y = 0;
            const hs = this.airVel.length();
            if (hs > 1 && hs < JUMP_MIN_SPEED) this.airVel.multiplyScalar(JUMP_MIN_SPEED / hs);
            this.airVel.y = Math.max(vy, 6.2);
          }
        } else {
          this.pos.addScaledVector(g2.normal, -h);
          this.up.lerp(g2.normal, Math.min(1, dt * 12)).normalize();
          this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
          this.surface = g2.surface;
        }
      } else if (h <= 0 && (this.airTime > 0.05 || this.airVel.dot(g2.normal) < 0)) {
        this.land(g2.normal, h);
      }
      // walls
      if (g2.wall !== 0) this.hitWall(g2.wall, Math.abs(this.loc.d) - g2.limit);
      if (g2.bank) this.hitBank(g2.bank, g2.limit - Math.abs(this.loc.d));
    } else {
      this.surface = 'void';
      if (this.grounded) {
        this.trickable = false;
        this.takeOff(new THREE.Vector3());
      }
    }

    // ---- fell / far away: rescue
    const l = this.loc;
    const far = Math.abs(l.d) > l.w + this.track.shoulder + 35;
    const inCanal = !this.track.hasVoid && this.loc.ribbon.sample(Math.round(l.i)).gap && Math.abs(l.d) <= l.w + this.track.shoulder + CANAL_MARGIN;
    const below = (l.h < -7 && (this.track.hasVoid || this.pos.y < this.track.groundY - 3)) || (inCanal && this.pos.y < this.track.groundY - 1);
    if (far || below || this.pos.y < this.track.groundY - 30) {
      this.startRescue();
    }
    if (this.grounded && Math.abs(l.d) < l.w - 0.5 && (this.surface === 'road' || this.surface === 'curb' || this.surface === 'dirt') && l.ribbon.isMain) {
      this.safeS = l.s;
      this.safeD = l.d;
    }

    // ---- boost pads
    if (this.grounded) {
      for (const b of this.track.boosts) {
        if (b.ribbon !== l.ribbon) continue;
        let ds = l.s - b.s;
        if (l.ribbon.closed) ds = ((ds + l.ribbon.length / 2) % l.ribbon.length + l.ribbon.length) % l.ribbon.length - l.ribbon.length / 2;
        if (Math.abs(ds) < b.len / 2 && Math.abs(l.d - b.d) < b.w) {
          if (this.boostKind !== 'pad' || this.boostT < 0.7) this.addBoost('pad', 1.1, 1.15);
        }
      }
    }

    if (this.grounded) this.groundVel.subVectors(this.pos, this.prevPos).divideScalar(dt);
    else this.groundVel.copy(this.airVel);
    this.updateProgress();
    this.updateQuat();
  }

  /** @param launch leaving a ramp: keep the climb of the slope */
  private takeOff(extra: THREE.Vector3, launch = false) {
    const r = tmpV2.crossVectors(this.fwd, this.up).normalize();
    this.airVel.copy(this.fwd).multiplyScalar(this.speed).addScaledVector(r, this.lat);
    // the kart's nose lags the slope a little: keep the climb it really had (ramp lips launch)
    const rise = launch ? this.groundVel.y - this.airVel.y : 0;
    if (rise > 0) this.airVel.y += Math.min(rise, Math.abs(this.speed) * 0.8);
    this.airVel.add(extra);
    this.grounded = false;
    this.airTime = 0;
    this.tricked = false;
  }

  private land(normal: THREE.Vector3, h: number) {
    this.pos.addScaledVector(normal, -h);
    const impact = -this.airVel.dot(normal);
    this.up.copy(normal);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.speed = this.airVel.dot(this.fwd);
    const r = tmpV2.crossVectors(this.fwd, this.up).normalize();
    this.lat = this.airVel.dot(r) * 0.3;
    this.grounded = true;
    const wasHop = this.hopping;
    this.hopping = false;
    this.events.push({ k: 'land', hard: impact > 9 });
    if (this.tricked) {
      this.addBoost('trick', 0.75, 0.9);
      this.tricked = false;
    }
    this.trickable = false;
    // drift starts when landing from the hop with a direction held
    if (wasHop && this.input.drift && Math.abs(this.input.steer) > 0.25 && this.speed > DRIFT_MIN_SPEED && this.spinT <= 0) {
      this.drift = this.input.steer > 0 ? 1 : -1;
      this.driftT = 0;
      this.driftCharge = 0;
      this.driftTier = 0;
    }
  }

  private endDrift(release: boolean) {
    const tier = this.driftTier;
    this.drift = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    if (release && tier > 0) {
      this.addBoost('drift', DRIFT_BOOST[tier], 0.8 + tier * 0.12);
      this.events.push({ k: 'boost', kind: 'drift', tier });
    }
  }

  private hitWall(side: -1 | 1, depth: number) {
    const l = this.loc;
    // push back inside
    this.pos.addScaledVector(l.right, -side * (depth + 0.02));
    // speed lost depends on the angle of the impact
    const into = this.fwd.dot(l.right) * side;
    const vin = (this.grounded ? this.speed : this.airVel.dot(l.fwd)) * Math.max(0, into);
    if (into > 0) {
      const keep = 1 - Math.min(0.7, into * 1.1);
      this.speed *= keep;
      // turn along the wall
      this.fwd.addScaledVector(l.right, -side * into * 0.8).normalize();
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
      if (!this.grounded) this.airVel.addScaledVector(l.right, -side * Math.max(0, this.airVel.dot(l.right) * side) * 1.3);
    }
    this.lat = -side * Math.min(3, Math.abs(this.lat) * 0.4 + 1);
    if (vin > 4) this.events.push({ k: 'bonk', strength: Math.min(1, vin / 20) });
    if (this.drift !== 0 && into > 0.5) this.endDrift(false);
  }

  /** on the terrain, against the side of a raised road (embankment, bridge): pushed back out */
  private hitBank(side: -1 | 1, depth: number) {
    const l = this.loc;
    const out = tmpV.copy(l.right).setY(0);
    const flat = Math.max(0.4, out.length());
    out.normalize().multiplyScalar(side);
    // (a banked road measures d in its tilted plane)
    this.pos.addScaledVector(out, (depth + 0.1) / flat);
    const into = -this.fwd.dot(out);
    if (into > 0) {
      this.speed *= 1 - Math.min(0.7, into * 1.1);
      this.fwd.addScaledVector(out, into * 0.9).normalize();
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
      if (this.speed > 4) this.events.push({ k: 'bonk', strength: Math.min(1, (this.speed * into) / 20) });
    }
    if (!this.grounded) this.airVel.addScaledVector(out, Math.max(0, -this.airVel.dot(out)));
    this.lat = 0;
  }

  private stepRescue(dt: number) {
    const before = this.rescueT;
    this.rescueT -= dt;
    const tr = this.track;
    const sm = tr.main.sample(tr.main.indexAt(this.rescueTarget.s));
    const target = sm.p.clone().addScaledVector(sm.r, this.rescueTarget.d).addScaledVector(sm.u, 0.05 + tr.kickerAt(tr.main, this.rescueTarget.s, this.rescueTarget.d));
    if (this.rescueT > 1.6) {
      // still falling (or skidding off)
      this.airVel.y -= GRAVITY * dt * 0.6;
      this.pos.addScaledVector(this.airVel, dt);
      this.airVel.multiplyScalar(0.97);
    } else if (this.rescueT > 0.5) {
      // carried by a friend above the track
      if (before > 1.6) this.pos.copy(target).addScaledVector(sm.u, 6);
      const k = (1.6 - this.rescueT) / 1.1;
      this.pos.copy(target).addScaledVector(sm.u, 6 - 4.5 * k);
      this.fwd.copy(sm.t);
      this.up.copy(sm.u);
    } else {
      this.pos.copy(target).addScaledVector(sm.u, 1.5 * Math.max(0, this.rescueT / 0.5));
      this.fwd.copy(sm.t);
      this.up.copy(sm.u);
      if (this.rescueT <= 0) {
        this.rescueT = 0;
        this.speed = 0;
        this.lat = 0;
        this.grounded = true;
        this.groundVel.set(0, 0, 0);
        this.hints = this.track.ribbons.map(() => -1);
        this.locateGround();
        this.events.push({ k: 'rescued' });
      }
    }
    this.vel.set(0, 0, 0);
  }

  private updateProgress() {
    const L = this.track.length;
    const s = this.loc.ribbon.mainS(this.loc.s);
    let ds = s - this.lastS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    // a jump of more than a quarter lap is not a real move (re-acquired the wrong ribbon)
    if (Math.abs(ds) < L / 4) this.progress += ds;
    this.lastS = s;
    const lap = Math.floor(this.progress / L) + 1;
    if (lap > this.lap) {
      this.lap = lap;
      this.events.push({ k: 'lap', lap });
    } else if (lap < this.lap) this.lap = Math.max(1, lap);
  }

  /** Start: called at GO with the time the accelerator was held. */
  launch() {
    // pressed during the « 3 » = burnout; between the « 2 » and the « 1 » = big boost
    const h = this.startHold;
    if (h > 2.12) {
      this.burnoutT = 1.1;
      this.events.push({ k: 'burnout' });
    } else if (h > 0.85) {
      this.addBoost('start', 1.3, 1.25);
      this.speed = this.params.top * 0.5;
    } else if (h > 0.3) {
      this.addBoost('start', 0.6, 0.9);
      this.speed = this.params.top * 0.3;
    }
  }

  // ---------------------------------------------------------------- online

  /** compact state sent to the other browsers (see applyNet) */
  netState(): number[] {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const BK: (BoostKind | null)[] = [null, 'drift', 'start', 'trick', 'pad', 'slip', 'item', 'bump'];
    return [
      r(this.pos.x), r(this.pos.y), r(this.pos.z),
      r(this.quat.x), r(this.quat.y), r(this.quat.z), r(this.quat.w),
      r(this.speed), r(this.steer), this.drift, this.driftTier,
      r(this.boostT), r(this.boostPower), BK.indexOf(this.boostKind),
      r(this.starT), r(this.spinT), r(this.squashT), r(this.trickT), this.trickVariant, r(this.rescueT),
      this.grounded ? 1 : 0, r(this.progress), this.lap, this.finished ? 1 : 0, r(this.finishTime),
      this.input.look ? 1 : 0, r(this.lat), r(this.spinAngle),
    ];
  }

  /** Puts a remote kart where the network says it is (pos/quat already interpolated by the caller). */
  applyNet(s: number[], pos: THREE.Vector3, quat: THREE.Quaternion) {
    const BK: (BoostKind | null)[] = [null, 'drift', 'start', 'trick', 'pad', 'slip', 'item', 'bump'];
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.vel.subVectors(pos, this.pos).multiplyScalar(60);
    if (this.vel.lengthSq() > 60 * 60) this.vel.set(0, 0, 0);
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.fwd.set(0, 0, 1).applyQuaternion(quat);
    this.up.set(0, 1, 0).applyQuaternion(quat);
    this.speed = s[7];
    this.steer = s[8];
    this.drift = s[9] as -1 | 0 | 1;
    this.driftTier = s[10];
    this.boostT = s[11];
    this.boostPower = s[12];
    this.boostKind = BK[s[13]] ?? null;
    this.starT = s[14];
    this.spinT = s[15];
    this.squashT = s[16];
    this.trickT = s[17];
    this.trickVariant = s[18];
    this.rescueT = s[19];
    this.grounded = s[20] === 1;
    this.progress = s[21];
    this.lap = s[22];
    this.input = { ...this.input, steer: s[8], look: s[25] === 1 };
    this.lat = s[26];
    this.spinAngle = s[27];
    this.locateGround();
    const l = this.loc;
    const ad = Math.abs(l.d);
    this.surface = ad > l.w + this.track.shoulder ? 'offroad' : ad > l.w ? 'offroad' : l.ribbon.surface === 'dirt' ? 'dirt' : 'road';
  }

  /** Which ribbon / where (for the AI and the HUD). */
  get ribbon(): Ribbon {
    return this.loc.ribbon;
  }
}
