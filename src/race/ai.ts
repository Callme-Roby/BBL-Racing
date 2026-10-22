import * as THREE from 'three';
import type { Difficulty } from '../game/settings';
import { NO_INPUT, type KartInput } from '../input/input';
import type { Kart } from './kart';
import type { Ribbon, Track } from './track';

/**
 * CPU drivers: they follow a racing line (inside of the corners, smoothed), with a personal
 * lane offset, drift through the tight corners (mini-turbos up to the tier their level allows),
 * use their items (see race.ts) and get a little help or handicap depending on the gap to the
 * human players (rubber banding, gentle).
 */

/** racing line offset of every sample of a ribbon (+ = right), computed once per track */
const lineCache = new WeakMap<Ribbon, Float32Array>();
/** signed curvature (rad / m, + = turning right) */
const curvCache = new WeakMap<Ribbon, Float32Array>();

export function curvatureOf(rb: Ribbon): Float32Array {
  let c = curvCache.get(rb);
  if (c) return c;
  const N = rb.count;
  c = new Float32Array(N);
  const up = new THREE.Vector3();
  for (let j = 0; j < N; j++) {
    const a = rb.sample(j - 3).t;
    const b = rb.sample(j + 3).t;
    up.crossVectors(a, b);
    const ang = Math.asin(Math.max(-1, Math.min(1, up.dot(rb.sample(j).u))));
    // asin > 0 = turning left (counter-clockwise around up)
    c[j] = -ang / 6;
  }
  curvCache.set(rb, c);
  return c;
}

export function racingLine(rb: Ribbon): Float32Array {
  let line = lineCache.get(rb);
  if (line) return line;
  const N = rb.count;
  const curv = curvatureOf(rb);
  const raw = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    // look at the corner a little ahead: the apex is on the inside
    let k = 0;
    for (let a = -6; a <= 14; a++) k += curv[(((j + a) % N) + N) % N];
    k /= 21;
    const w = rb.sample(j).w;
    raw[j] = Math.max(-w * 0.62, Math.min(w * 0.62, k * 260));
  }
  // smooth
  line = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let a = -12; a <= 12; a++) s += raw[rb.closed ? (((j + a) % N) + N) % N : Math.max(0, Math.min(N - 1, j + a))];
    line[j] = s / 25;
  }
  lineCache.set(rb, line);
  return line;
}

const LEVEL = {
  easy: { maxTier: 0, steerGain: 1.6, speed: 0.86, lane: 2.2, mistakes: 0.004, itemDelay: 2.5 },
  normal: { maxTier: 2, steerGain: 2.1, speed: 0.95, lane: 1.6, mistakes: 0.0015, itemDelay: 1.2 },
  hard: { maxTier: 3, steerGain: 2.6, speed: 1.0, lane: 1.0, mistakes: 0.0004, itemDelay: 0.5 },
} satisfies Record<Difficulty, unknown>;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class KartAI {
  private lane: number;
  private laneT = 0;
  private stuckT = 0;
  private reverseT = 0;
  private wobble = 0;
  private driftHold = false;
  private driftDir = 0;
  private driftWait = 0;
  private targetTier: number;
  /** speed factor applied by the race (rubber band), read by Race */
  speedScale = 1;
  readonly level: (typeof LEVEL)[Difficulty];
  /** seconds before using the item it holds */
  itemTimer = 0;

  constructor(
    readonly kart: Kart,
    readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.level = LEVEL[difficulty];
    this.lane = Math.sin(seed * 12.9898) * this.level.lane;
    this.targetTier = Math.min(this.level.maxTier, 1 + (seed % 3));
    this.itemTimer = this.level.itemDelay;
  }

  think(_track: Track, time: number): KartInput {
    const k = this.kart;
    if (k.rescueT > 0 || k.spinT > 0) {
      this.driftHold = false;
      this.driftWait = 0;
      return { ...NO_INPUT, accel: true };
    }
    const rb = k.loc.ribbon;
    const line = racingLine(rb);
    const curv = curvatureOf(rb);
    const N = rb.count;
    const j = Math.round(k.loc.i);
    const speed = Math.max(0, k.speed);
    const look = Math.round(6 + speed * 0.42);
    const ja = rb.closed ? (j + look) % N : Math.min(N - 1, j + look);
    const sm = rb.sample(ja);
    // lane changes now and then
    this.laneT -= 1 / 60;
    if (this.laneT <= 0) {
      this.laneT = 3 + Math.random() * 5;
      this.lane = (Math.random() - 0.5) * 2 * this.level.lane;
    }
    const off = Math.max(-sm.w + 1.2, Math.min(sm.w - 1.2, line[ja] + this.lane));
    const target = tmp.copy(sm.p).addScaledVector(sm.r, off);
    // steering toward the target, in the kart's plane
    const to = tmp2.subVectors(target, k.pos);
    to.addScaledVector(k.up, -to.dot(k.up));
    const right = k.right;
    const ang = Math.atan2(to.dot(right), to.dot(k.fwd));
    this.wobble += (Math.random() - 0.5) * this.level.mistakes * 60;
    this.wobble *= 0.97;
    let steer = Math.max(-1, Math.min(1, ang * this.level.steerGain + this.wobble));
    // corner ahead: yaw rate it needs at this speed (rad / s), now and a little further
    const turn = k.params.turn;
    const curvAt = (from: number, to: number) => {
      let c = 0;
      let n = 0;
      for (let a = from; a <= to; a++) {
        c += curv[rb.closed ? (((j + a) % N) + N) % N : Math.max(0, Math.min(N - 1, j + a))];
        n++;
      }
      return c / n;
    };
    const cAhead = curvAt(6, 20);
    const cNow = curvAt(0, 10);
    const needAhead = cAhead * speed;
    const needNow = cNow * speed;
    const inp: KartInput = { ...NO_INPUT, accel: true, steer };
    // drift through the corners that need a lot of turning (mini-turbos up to the level's tier)
    if (this.level.maxTier > 0) {
      const onRoad = Math.abs(k.loc.d) < k.loc.w - 1.2;
      if (k.drift === 0) {
        if (!this.driftHold && onRoad && speed > 12 && Math.abs(needAhead) > 0.27 * turn && Math.sign(needAhead) === Math.sign(steer || needAhead) && Math.abs(ang) < 0.45) {
          this.driftHold = true;
          this.driftDir = Math.sign(needAhead);
        }
        if (this.driftHold) {
          inp.steer = this.driftDir;
          // the hop never turned into a drift (button already held, too slow…): let go
          this.driftWait += 1 / 60;
          if (this.driftWait > 0.5) this.driftHold = false;
        }
      } else {
        this.driftWait = 0;
        const d = k.drift;
        // what normal steering would ask, mapped into the drift's range (0.36 .. 1.2 of the turn rate)
        const want = (ang * this.level.steerGain + needNow / turn) * 0.5 * d;
        const tighten = Math.max(-1, Math.min(1, (want - 0.78) / 0.42));
        inp.steer = d * tighten;
        const corner = Math.abs(needNow) > 0.16 * turn && Math.sign(needNow) === d;
        const done = k.driftTier >= this.targetTier && Math.abs(needAhead) < 0.2 * turn;
        if (!corner || done || want < 0.05 || !onRoad) this.driftHold = false;
      }
      if (this.driftHold) inp.drift = true;
    }
    // stuck against something: back up and turn
    if (speed < 1.5 && time > 3) this.stuckT += 1 / 60;
    else this.stuckT = Math.max(0, this.stuckT - 2 / 60);
    if (this.stuckT > 1.4) {
      this.reverseT = 1;
      this.stuckT = 0;
    }
    if (this.reverseT > 0) {
      this.reverseT -= 1 / 60;
      inp.accel = false;
      inp.brake = true;
      inp.drift = false;
      inp.steer = -steer;
    }
    // trick on every ramp
    if (!k.grounded && k.trickable && !k.tricked && Math.random() < 0.2 && this.difficulty !== 'easy') inp.drift = true;
    steer = inp.steer;
    void steer;
    return inp;
  }
}
