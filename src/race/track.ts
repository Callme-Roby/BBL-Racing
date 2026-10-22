import * as THREE from 'three';

/**
 * Circuits are built in code from a closed centre line (control points through which a
 * Catmull-Rom spline runs) plus features placed along it by distance `s` (metres from the
 * start line):
 *
 *  - the road is a ribbon: width and banking vary along the line, the outer edges are
 *    rumble strips then a shoulder (offroad, slows you down), then either a wall, the ground
 *    (terrain, offroad) or the void (fall → a friend puts you back on the track);
 *  - ramps (tremplins) lift the road and end with a lip: you fly, you can do a trick;
 *  - boost pads, item box rows;
 *  - anti-gravity sections: strongly banked, glowing edges, gravity follows the road and
 *    bumping into another kart gives both a spin boost;
 *  - shortcuts (branches): extra open ribbons joining two points of the main line (an alley,
 *    a dirt path) whose progress maps onto the main line.
 *
 * World: 1 unit = 1 m, Y up. Karts drive on the ribbon's surface; `Ribbon.locate` turns a
 * world position into (sample, lateral offset, height above the road).
 */

export type Theme = 'hood' | 'dojo' | 'parking' | 'beach';

/** [x, y, z, half width (default 7), banking in degrees (+ = right side lower)] */
export type CtrlPoint = [number, number, number, number?, number?];

/**
 * Where a feature goes along the main line: `s` = metres from the start line, or `at` = a
 * (fractional) control point index — 2.5 = halfway between points 2 and 3 (easier to author).
 */
export interface Along {
  s?: number;
  at?: number;
}

/** a stretch of the main line: [s0, s1] in metres, or { at: [a0, a1] } in control points */
export type Span = [number, number] | { at: [number, number] };

export interface RampDef extends Along {
  /** length of the slope */
  len: number;
  /** height gained at the lip */
  h: number;
  /** lateral extent (default: the whole road) */
  d0?: number;
  d1?: number;
  /** metres of void after the lip: jump over it! */
  gap?: number;
}

export interface PadDef extends Along {
  /** lateral offset of the pad centre (+ = right) */
  d: number;
  /** half width / length */
  w?: number;
  len?: number;
}

export interface WallDef {
  span: Span;
  side: 'left' | 'right' | 'both';
}

export interface BranchDef {
  /** points of the branch, from where it leaves the main line to where it joins it again */
  points: CtrlPoint[];
  /** main-line stretch it bypasses (progress maps linearly between its ends) */
  span: Span;
  surface?: 'road' | 'dirt';
  /** boost pads on the branch (s along the branch) */
  boosts?: PadDef[];
}

export interface TrackFeatures {
  ramps?: RampDef[];
  boosts?: PadDef[];
  /** rows of item boxes; `n` boxes across (default 4) */
  items?: (Along & { n?: number; spread?: number })[];
  /** anti-gravity sections */
  antigrav?: Span[];
  /** barriers along the edges */
  walls?: WallDef[];
  branches?: BranchDef[];
  /** half width of the offroad shoulder beyond the rumble strips (default 3) */
  shoulder?: number;
  /** void below the track (no ground: falling off means a rescue) */
  void?: boolean;
  /** ground height (default 0) */
  groundY?: number;
}

export interface TrackDef {
  id: string;
  name: string;
  subtitle: string;
  theme: Theme;
  /** night / sunset / day: picks the sky & lights of the theme */
  points: CtrlPoint[];
  features: TrackFeatures;
  /** BBL KART music id */
  music: string;
  /** recommended laps (time trial / races) */
  laps?: number;
}

/** One sample of a ribbon (every ~1 m). */
export interface RibbonSample {
  p: THREE.Vector3;
  /** forward (unit), right (unit), up / road normal (unit) */
  t: THREE.Vector3;
  r: THREE.Vector3;
  u: THREE.Vector3;
  /** half width of the road (rumble strips included) */
  w: number;
  /** distance from the start of the ribbon */
  s: number;
  antigrav: boolean;
  /** 1 on the slope of a ramp (a jump from here can be a trick) */
  ramp: number;
  wallL: boolean;
  wallR: boolean;
  /** no road here (jump over it) */
  gap: boolean;
}

export type Surface = 'road' | 'curb' | 'offroad' | 'dirt' | 'void';

export interface Locate {
  ribbon: Ribbon;
  /** sample index (fractional) */
  i: number;
  /** distance along the ribbon */
  s: number;
  /** lateral offset (+ = right) and height above the road plane */
  d: number;
  h: number;
  w: number;
  /** road point under the kart and its normal */
  point: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  antigrav: boolean;
  ramp: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

/** A sampled road ribbon (the closed main loop or an open branch). */
export class Ribbon {
  readonly samples: RibbonSample[] = [];
  readonly length: number;
  readonly closed: boolean;
  readonly surface: 'road' | 'dirt';
  /** branch: main-line distances of its two ends */
  readonly s0: number;
  readonly s1: number;
  readonly isMain: boolean;
  /** distance of each control point (the last one = length for a closed ribbon) */
  readonly ctrlS: number[] = [];
  readonly nCtrl: number;

  constructor(
    points: CtrlPoint[],
    closed: boolean,
    opts: { surface?: 'road' | 'dirt'; s0?: number; s1?: number; ramps?: RampDef[]; antigrav?: Span[]; walls?: WallDef[]; main?: boolean },
  ) {
    this.closed = closed;
    this.surface = opts.surface ?? 'road';
    this.s0 = opts.s0 ?? 0;
    this.s1 = opts.s1 ?? 0;
    this.isMain = !!opts.main;
    this.nCtrl = points.length;
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      closed,
      'centripetal',
    );
    const n = points.length;
    const segs = closed ? n : n - 1;
    // fine pass by curve parameter, then resample every metre
    const fine: { p: THREE.Vector3; w: number; bank: number }[] = [];
    const per = 60;
    for (let k = 0; k <= segs * per; k++) {
      const t = k / (segs * per);
      const p = curve.getPoint(Math.min(t, closed ? 0.999999 : 1));
      const f = t * segs;
      const i0 = Math.min(Math.floor(f), segs - 1);
      const i1 = (i0 + 1) % n;
      const a = smooth(f - i0);
      const w0 = points[i0][3] ?? 7;
      const w1 = points[i1][3] ?? 7;
      const b0 = points[i0][4] ?? 0;
      const b1 = points[i1][4] ?? 0;
      fine.push({ p, w: w0 + (w1 - w0) * a, bank: b0 + (b1 - b0) * a });
    }
    let total = 0;
    const cum = [0];
    for (let k = 1; k < fine.length; k++) {
      total += fine[k].p.distanceTo(fine[k - 1].p);
      cum.push(total);
    }
    this.length = total;
    // distance of every control point (features placed with `at`)
    for (let i = 0; i <= segs; i++) this.ctrlS.push(cum[Math.min(cum.length - 1, i * per)]);
    const count = Math.max(8, Math.round(total / 1.0));
    const step = total / count;
    let k = 0;
    const raw: { p: THREE.Vector3; w: number; bank: number; s: number }[] = [];
    for (let j = 0; j < (closed ? count : count + 1); j++) {
      const s = j * step;
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const span = cum[k + 1] - cum[k] || 1;
      const a = Math.min(1, Math.max(0, (s - cum[k]) / span));
      const A = fine[k];
      const B = fine[k + 1];
      raw.push({ p: A.p.clone().lerp(B.p, a), w: A.w + (B.w - A.w) * a, bank: A.bank + (B.bank - A.bank) * a, s });
    }
    // ramps raise the road (baked into the samples, so the frames follow the slope)
    const rampAt = (s: number): { y: number; on: number; gap: boolean } => {
      for (const r of opts.ramps ?? []) {
        const r0 = this.sOf(r);
        if (r.gap && s > r0 + r.len && s < r0 + r.len + r.gap) return { y: 0, on: 0, gap: true };
        if (r.d0 !== undefined) continue; // partial ramps are separate objects (see Track.kickerAt)
        if (s >= r0 && s <= r0 + r.len) {
          const x = (s - r0) / r.len;
          return { y: r.h * Math.pow(x, 1.6), on: 1, gap: false };
        }
      }
      return { y: 0, on: 0, gap: false };
    };
    const inRange = (s: number, list: Span[] | undefined) =>
      !!list?.some((sp) => {
        const [a, b] = this.spanOf(sp);
        return a <= b ? s >= a && s <= b : s >= a || s <= b;
      });
    const wallOn = (s: number, side: 'left' | 'right') => !!opts.walls?.some((wl) => (wl.side === side || wl.side === 'both') && inRange(s, [wl.span]));
    for (const r of raw) {
      const ra = rampAt(r.s);
      r.p.y += ra.y;
      this.samples.push({
        p: r.p,
        t: new THREE.Vector3(),
        r: new THREE.Vector3(),
        u: new THREE.Vector3(),
        w: r.w,
        s: r.s,
        antigrav: inRange(r.s, opts.antigrav),
        ramp: ra.on,
        wallL: wallOn(r.s, 'left'),
        wallR: wallOn(r.s, 'right'),
        gap: ra.gap,
      });
    }
    this.banks = raw.map((r) => (r.bank * Math.PI) / 180);
    this.computeFrames();
  }

  /** bank angle of every sample (rad) */
  private readonly banks: number[];
  /** how much each sample was raised by liftAbove (m) */
  lift: number[] = [];

  /** tangent / right / up of every sample from the positions and the banking */
  private computeFrames() {
    const closed = this.closed;
    const N = this.samples.length;
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < N; j++) {
      const sm = this.samples[j];
      const prev = this.samples[closed ? (j - 1 + N) % N : Math.max(0, j - 1)];
      const next = this.samples[closed ? (j + 1) % N : Math.min(N - 1, j + 1)];
      sm.t.subVectors(next.p, prev.p).normalize();
      // right = forward × up, then bank around the forward axis
      sm.r.crossVectors(sm.t, up).normalize();
      sm.u.crossVectors(sm.r, sm.t).normalize();
      const bank = this.banks[j];
      if (bank) {
        sm.r.applyAxisAngle(sm.t, bank);
        sm.u.applyAxisAngle(sm.t, bank);
      }
    }
    // smooth the normals a little (ramps' lips stay sharp: the up of the slope is kept)
    const ups = this.samples.map((sm) => sm.u.clone());
    for (let j = 0; j < N; j++) {
      if (this.samples[j].ramp) continue;
      const a = ups[closed ? (j - 1 + N) % N : Math.max(0, j - 1)];
      const b = ups[closed ? (j + 1) % N : Math.min(N - 1, j + 1)];
      const sm = this.samples[j];
      sm.u.copy(ups[j]).multiplyScalar(2).add(a).add(b).normalize();
      sm.r.crossVectors(sm.t, sm.u).normalize();
    }
  }

  /**
   * Raise the road where its lower edge (banked turns) would sink under the terrain at `floor`:
   * the turn becomes a banked berm, its low edge level with the ground. The lift fades in and
   * out over ~25 m so the road stays smooth. `ends` (branches): the lift of the main line where
   * the branch leaves and joins it, so both still meet.
   */
  liftAbove(floor: number, margin: number, ends?: [number, number]) {
    const N = this.samples.length;
    const R = 25;
    const need = this.samples.map((sm) => (sm.gap ? 0 : Math.max(0, floor + 0.03 - (sm.p.y - Math.abs(sm.r.y) * (sm.w + margin)))));
    const idx = (j: number) => (this.closed ? ((j % N) + N) % N : j);
    const spread = () => {
      const lift = new Array<number>(N).fill(0);
      for (let k = 0; k < N; k++) {
        if (need[k] <= 0) continue;
        for (let o = -R; o <= R; o++) {
          const j = idx(k + o);
          if (j < 0 || j >= N) continue;
          const f = 0.5 + 0.5 * Math.cos((Math.PI * Math.abs(o)) / R);
          lift[j] = Math.max(lift[j], need[k] * (Math.abs(o) <= 2 ? 1 : f));
        }
      }
      return lift;
    };
    let lift = spread();
    // a jump (ramp, gap, landing) is lifted in one piece: same take-off and landing heights
    const zones: number[][] = [];
    for (let j = 0; j < N; j++) {
      if (!this.samples[j].ramp || this.samples[idx(j - 1)]?.ramp) continue;
      const zone: number[] = [];
      let k = j;
      while (zone.length < N && (this.samples[idx(k)].ramp || this.samples[idx(k)].gap)) zone.push(idx(k++));
      for (let e = 0; e < 14; e++) zone.push(idx(k + e));
      zones.push(zone.filter((z) => z >= 0 && z < N));
    }
    if (zones.length) {
      for (const z of zones) {
        const m = Math.max(...z.map((j) => lift[j]));
        for (const j of z) need[j] = m;
      }
      lift = spread();
    }
    if (ends) {
      // meet the main line again at both ends
      const fix = (j0: number, dir: 1 | -1, want: number) => {
        const c = want - lift[j0];
        if (Math.abs(c) < 1e-3) return;
        for (let o = 0; o <= R; o++) {
          const j = j0 + dir * o;
          if (j < 0 || j >= N) break;
          lift[j] += c * (0.5 + 0.5 * Math.cos((Math.PI * o) / R));
        }
      };
      fix(0, 1, ends[0]);
      fix(N - 1, -1, ends[1]);
    }
    this.lift = lift;
    if (!lift.some((v) => Math.abs(v) > 1e-4)) return;
    this.samples.forEach((sm, j) => (sm.p.y += lift[j]));
    this.computeFrames();
  }

  get count() {
    return this.samples.length;
  }

  /** distance along the ribbon of a feature placed with `s` or `at` */
  sOf(f: Along): number {
    if (f.at === undefined) return f.s ?? 0;
    const n = this.ctrlS.length - 1;
    const a = this.closed ? ((f.at % n) + n) % n : Math.max(0, Math.min(n, f.at));
    const i = Math.min(n - 1, Math.floor(a));
    return this.ctrlS[i] + (this.ctrlS[i + 1] - this.ctrlS[i]) * (a - i);
  }

  spanOf(sp: Span): [number, number] {
    return Array.isArray(sp) ? sp : [this.sOf({ at: sp.at[0] }), this.sOf({ at: sp.at[1] })];
  }

  sample(j: number): RibbonSample {
    const N = this.samples.length;
    return this.samples[this.closed ? ((j % N) + N) % N : Math.max(0, Math.min(N - 1, j))];
  }

  /** index of the sample nearest to s */
  indexAt(s: number): number {
    const L = this.length;
    const N = this.samples.length;
    const ss = this.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    return Math.round((ss / L) * (this.closed ? N : N - 1));
  }

  /** point of the road at (s, d) */
  pointAt(s: number, d: number, out = new THREE.Vector3()): THREE.Vector3 {
    const sm = this.sample(this.indexAt(s));
    return out.copy(sm.p).addScaledVector(sm.r, d);
  }

  /**
   * Nearest sample to `pos`, searching around `hint` first (pass -1 to search everything).
   * Returns -1 when nothing is within `maxDist`.
   */
  nearest(pos: THREE.Vector3, hint: number, maxDist = 1e9): number {
    const N = this.samples.length;
    let best = -1;
    let bestD = maxDist * maxDist;
    const scan = (j: number) => {
      const sm = this.samples[j];
      const dx = pos.x - sm.p.x;
      const dy = pos.y - sm.p.y;
      const dz = pos.z - sm.p.z;
      // vertical distance counts more (bridges over other parts of the track)
      const d2 = dx * dx + dz * dz + dy * dy * 2.5;
      if (d2 < bestD) {
        bestD = d2;
        best = j;
      }
    };
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const j = this.closed ? (((hint + k) % N) + N) % N : hint + k;
        if (j >= 0 && j < N) scan(j);
      }
      const sm = this.samples[best >= 0 ? best : 0];
      if (best >= 0 && bestD < (sm.w + 10) * (sm.w + 10)) return best;
    }
    for (let j = 0; j < N; j++) scan(j);
    return best;
  }

  /** Road frame and offsets of `pos` around sample j (interpolated with its neighbour). */
  locate(pos: THREE.Vector3, j: number, out: Locate): Locate {
    const N = this.samples.length;
    const a = this.samples[j];
    // which neighbour: the one on the side of pos along the tangent
    const ahead = tmpA.subVectors(pos, a.p).dot(a.t) >= 0;
    let jb = ahead ? j + 1 : j - 1;
    if (this.closed) jb = (jb + N) % N;
    else jb = Math.max(0, Math.min(N - 1, jb));
    const b = this.samples[jb];
    const seg = tmpB.subVectors(b.p, a.p);
    const segLen2 = seg.lengthSq() || 1;
    let f = Math.max(0, Math.min(1, tmpA.subVectors(pos, a.p).dot(seg) / segLen2));
    if (jb === j) f = 0;
    out.ribbon = this;
    out.point.copy(a.p).lerp(b.p, f);
    out.up.copy(a.u).lerp(b.u, f).normalize();
    out.fwd.copy(a.t).lerp(b.t, f).normalize();
    out.right.crossVectors(out.fwd, out.up).normalize();
    out.w = a.w + (b.w - a.w) * f;
    const rel = tmpA.subVectors(pos, out.point);
    out.d = rel.dot(out.right);
    out.h = rel.dot(out.up);
    out.point.addScaledVector(out.right, out.d);
    const sa = a.s;
    let sb = b.s;
    if (this.closed && jb === 0 && j === N - 1) sb = this.length;
    if (this.closed && j === 0 && jb === N - 1) sb = -1 * (this.length - b.s);
    out.s = sa + (sb - sa) * f;
    if (this.closed) out.s = ((out.s % this.length) + this.length) % this.length;
    out.i = j + (jb - j) * f;
    out.antigrav = f < 0.5 ? a.antigrav : b.antigrav;
    out.ramp = Math.max(a.ramp, b.ramp);
    return out;
  }

  /** main-line distance of a distance along this branch */
  mainS(s: number): number {
    if (this.isMain) return s;
    return this.s0 + ((this.s1 - this.s0) * s) / Math.max(1, this.length);
  }
}

export function newLocate(): Locate {
  return {
    ribbon: null as unknown as Ribbon,
    i: 0,
    s: 0,
    d: 0,
    h: 0,
    w: 7,
    point: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    fwd: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    antigrav: false,
    ramp: 0,
  };
}

export interface ItemBoxSpot {
  pos: THREE.Vector3;
  up: THREE.Vector3;
  s: number;
}

export interface BoostSpot {
  ribbon: Ribbon;
  s: number;
  d: number;
  w: number;
  len: number;
}

/** A playable track: ribbons + features, with the queries the race needs. */
export class Track {
  readonly main: Ribbon;
  readonly branches: Ribbon[];
  readonly ribbons: Ribbon[];
  readonly boxes: ItemBoxSpot[] = [];
  readonly boosts: BoostSpot[] = [];
  readonly shoulder: number;
  readonly hasVoid: boolean;
  readonly groundY: number;
  /** stretches with no road (after a ramp) */
  readonly gaps: [number, number][] = [];
  /** partial ramps (a kicker on one side of the road): extra solid wedges */
  readonly kickers: { ribbon: Ribbon; s: number; len: number; h: number; d0: number; d1: number }[] = [];

  constructor(readonly def: TrackDef) {
    const f = def.features;
    this.main = new Ribbon(def.points, true, { ramps: f.ramps, antigrav: f.antigrav, walls: f.walls, main: true });
    this.branches = (f.branches ?? []).map((b) => {
      const [s0, s1] = this.main.spanOf(b.span);
      return new Ribbon(b.points, false, { surface: b.surface ?? 'dirt', s0, s1: s1 < s0 ? s1 + this.main.length : s1 });
    });
    this.ribbons = [this.main, ...this.branches];
    this.shoulder = f.shoulder ?? 3;
    this.hasVoid = !!f.void;
    this.groundY = f.groundY ?? 0;
    if (!this.hasVoid) {
      // no road under the terrain (the low side of banked turns)
      this.main.liftAbove(this.groundY, this.shoulder);
      const liftAt = (s: number) => this.main.lift[this.main.indexAt(s) % this.main.count] ?? 0;
      for (const b of this.branches) b.liftAbove(this.groundY, this.shoulder, [liftAt(b.s0), liftAt(b.s1)]);
    }
    for (const row of f.items ?? []) {
      const n = row.n ?? 4;
      const rs = this.main.sOf(row);
      const sm = this.main.sample(this.main.indexAt(rs));
      const spread = row.spread ?? sm.w * 0.62;
      for (let k = 0; k < n; k++) {
        const d = n === 1 ? 0 : -spread + (2 * spread * k) / (n - 1);
        this.boxes.push({ pos: sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, 1.0), up: sm.u.clone(), s: rs });
      }
    }
    for (const b of f.boosts ?? []) this.boosts.push({ ribbon: this.main, s: this.main.sOf(b), d: b.d, w: b.w ?? 1.6, len: b.len ?? 4 });
    (f.branches ?? []).forEach((bd, i) => {
      for (const b of bd.boosts ?? []) this.boosts.push({ ribbon: this.branches[i], s: this.branches[i].sOf(b), d: b.d, w: b.w ?? 1.6, len: b.len ?? 4 });
    });
    for (const r of f.ramps ?? []) if (r.d0 !== undefined) this.kickers.push({ ribbon: this.main, s: this.main.sOf(r), len: r.len, h: r.h, d0: r.d0, d1: r.d1 ?? r.d0 + 3 });
    for (const r of f.ramps ?? []) if (r.gap) {
      const s0 = this.main.sOf(r) + r.len;
      this.gaps.push([s0, s0 + r.gap]);
    }
  }

  get length() {
    return this.main.length;
  }

  /** extra height of a kicker ramp at (s, d) on a ribbon, and whether it is the slope */
  kickerAt(rb: Ribbon, s: number, d: number): number {
    for (const k of this.kickers) {
      if (k.ribbon !== rb || d < k.d0 || d > k.d1) continue;
      let x = s - k.s;
      if (rb.closed) x = ((x % rb.length) + rb.length) % rb.length;
      if (x >= 0 && x <= k.len) return k.h * Math.pow(x / k.len, 1.6);
    }
    return 0;
  }

  /** start grid: slot k (0 = pole), behind the line, two by two */
  gridSlot(k: number): { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 } {
    const row = Math.floor(k / 2);
    const s = -6 - row * 4.2;
    const sm = this.main.sample(this.main.indexAt(s));
    const side = k % 2 === 0 ? -1 : 1;
    const d = side * Math.min(sm.w * 0.45, 2.6) + (row % 2 ? 0.6 : -0.6);
    const pos = sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, 0.05);
    return { pos, fwd: sm.t.clone(), up: sm.u.clone() };
  }
}
