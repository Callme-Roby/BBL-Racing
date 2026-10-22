import * as THREE from 'three';
import type { FighterDef, HairStyle } from '../data/roster';
import { createFaceMaterial, createPS1Material, type PS1Material } from './ps1Material';
import type { FaceAssets } from './faceTexture';

/**
 * Procedural low-poly fighter with a real skeleton (THREE.Skeleton + skinned
 * meshes). Limbs and torso are continuous tubes whose joint rings are weighted
 * between two bones, so elbows / knees / waist bend smoothly.
 *
 * Bind pose: standing, arms down, facing +Z. +X is the character's LEFT side.
 */

export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'foreArmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'foreArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulderL: 'chest',
  upperArmL: 'shoulderL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  shoulderR: 'chest',
  upperArmR: 'shoulderR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
};

const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

type Weights = [BoneName, number][];
type ColorFn = (theta: number, end: 0 | 1) => THREE.Color;

interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
  w: Weights;
  /** colour of the band going from this ring to the next one */
  col: THREE.Color | ColorFn;
}

/** Accumulates skinned, vertex-coloured geometry. */
class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, w: Weights, u = 0, v = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, v);
    const ww = [...w, ...([['hips', 0], ['hips', 0], ['hips', 0], ['hips', 0]] as Weights)].slice(0, 4);
    const total = ww.reduce((a, b) => a + b[1], 0) || 1;
    for (const [b, wt] of ww) {
      this.si.push(BI[b]);
      this.sw.push(wt / total);
    }
    return i;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /** Elliptic tube through horizontal rings (listed top to bottom or bottom to top). */
  tube(rings: Ring[], segs: number, capStart = true, capEnd = true) {
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const ringVerts = (r: Ring, col: THREE.Color | ColorFn, end: 0 | 1) => {
      const out: number[] = [];
      for (let s = 0; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        p.set((r.cx ?? 0) + r.rx * c, r.y, (r.cz ?? 0) + r.rz * sn);
        n.set(c / Math.max(r.rx, 1e-3), 0, sn / Math.max(r.rz, 1e-3)).normalize();
        const cc = typeof col === 'function' ? col(th, end) : col;
        out.push(this.vert(p, n, cc, r.w, s / segs, r.y));
      }
      return out;
    };
    for (let i = 0; i < rings.length - 1; i++) {
      const a = ringVerts(rings[i], rings[i].col, 0);
      const b = ringVerts(rings[i + 1], rings[i].col, 1);
      const up = rings[i + 1].y > rings[i].y;
      for (let s = 0; s < segs; s++) {
        if (up) {
          this.tri(a[s], b[s + 1], a[s + 1]);
          this.tri(a[s], b[s], b[s + 1]);
        } else {
          this.tri(a[s], a[s + 1], b[s + 1]);
          this.tri(a[s], b[s + 1], b[s]);
        }
      }
    }
    const cap = (r: Ring, top: boolean, col: THREE.Color) => {
      const nn = new THREE.Vector3(0, top ? 1 : -1, 0);
      const center = this.vert(new THREE.Vector3(r.cx ?? 0, r.y + (top ? 0.012 : -0.012), r.cz ?? 0), nn, col, r.w);
      const vs: number[] = [];
      for (let s = 0; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        p.set((r.cx ?? 0) + r.rx * Math.cos(th), r.y, (r.cz ?? 0) + r.rz * Math.sin(th));
        vs.push(this.vert(p, nn, col, r.w));
      }
      for (let s = 0; s < segs; s++) {
        if (top) this.tri(center, vs[s + 1], vs[s]);
        else this.tri(center, vs[s], vs[s + 1]);
      }
    };
    const colOf = (r: Ring) => (typeof r.col === 'function' ? r.col(Math.PI / 2, 0) : r.col);
    const first = rings[0];
    const last = rings[rings.length - 1];
    const firstIsTop = first.y > last.y;
    if (capStart) cap(first, firstIsTop, colOf(first));
    if (capEnd) cap(last, !firstIsTop, colOf(rings[rings.length - 2]));
  }

  /** Axis-aligned box with flat normals; colour may depend on the face normal. */
  box(center: THREE.Vector3, size: THREE.Vector3, w: Weights, col: THREE.Color | ((n: THREE.Vector3, p: THREE.Vector3) => THREE.Color), taperTop = 1) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
      [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
      [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
      [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
      [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
    ];
    for (const [nrm, u, v] of faces) {
      const ids: number[] = [];
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const p = new THREE.Vector3()
          .addScaledVector(nrm, 1)
          .addScaledVector(u, a)
          .addScaledVector(v, b);
        p.set(p.x * hx, p.y * hy, p.z * hz);
        if (p.y > 0) {
          p.x *= taperTop;
          p.z *= taperTop;
        }
        p.add(center);
        const c = typeof col === 'function' ? col(nrm, p) : col;
        ids.push(this.vert(p, nrm, c, w));
      }
      this.tri(ids[0], ids[1], ids[2]);
      this.tri(ids[0], ids[2], ids[3]);
    }
  }

  /** Add an arbitrary (non-indexed or indexed) three.js geometry, bound to one bone (or per-vertex weights). */
  addGeometry(g: THREE.BufferGeometry, w: Weights | ((p: THREE.Vector3) => Weights), col: THREE.Color | ((p: THREE.Vector3, i: number) => THREE.Color)) {
    const geo = g;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const base = this.pos.length / 3;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      this.vert(p, n, typeof col === 'function' ? col(p, i) : col, typeof w === 'function' ? w(p) : w);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
    }
  }

  /** Tube along a polyline: one ring per point with its own radius and skin weights (dreads...), pointed tip. */
  pathTube(pts: THREE.Vector3[], radii: number[], weights: Weights[], segs: number, col: (ring: number) => THREE.Color) {
    const n = pts.length;
    const t = new THREE.Vector3();
    const u = new THREE.Vector3();
    const rings: number[][] = [];
    for (let i = 0; i < n; i++) {
      t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      // parallel-transported frame: no twisting along the lock
      if (i === 0) u.crossVectors(t, Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      else u.addScaledVector(t, -u.dot(t)).normalize();
      const v = new THREE.Vector3().crossVectors(t, u);
      const c = col(i);
      const ring: number[] = [];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const nrm = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        ring.push(this.vert(pts[i].clone().addScaledVector(nrm, radii[i]), nrm, c, weights[i]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        this.tri(rings[i][s], rings[i][s1], rings[i + 1][s1]);
        this.tri(rings[i][s], rings[i + 1][s1], rings[i + 1][s]);
      }
    }
    const last = n - 1;
    const dir = new THREE.Vector3().subVectors(pts[last], pts[last - 1]).normalize();
    const tip = this.vert(pts[last].clone().addScaledVector(dir, radii[last] * 1.6), dir, col(last), weights[last]);
    for (let s = 0; s < segs; s++) this.tri(rings[last][s], rings[last][(s + 1) % segs], tip);
  }

  /**
   * Thin flat strip lying on a surface (web lines...): one point + outward normal + skin weights
   * per vertex, `width` across. Single-sided, facing along the normals.
   */
  ribbon(pts: THREE.Vector3[], nrm: THREE.Vector3[], ws: Weights[], width: number, col: THREE.Color, closed = false) {
    const n = pts.length;
    if (n < 2) return;
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    const a = new THREE.Vector3();
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < n; i++) {
      const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
      t.subVectors(next, prev).normalize();
      side.crossVectors(t, nrm[i]).normalize().multiplyScalar(width / 2);
      left.push(this.vert(a.copy(pts[i]).sub(side), nrm[i], col, ws[i]));
      right.push(this.vert(a.copy(pts[i]).add(side), nrm[i], col, ws[i]));
    }
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const P = (k: number) => new THREE.Vector3(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const p0 = P(left[i]);
      e1.subVectors(P(right[i]), p0);
      e2.subVectors(P(right[j]), p0);
      if (e1.cross(e2).dot(nrm[i]) >= 0) {
        this.tri(left[i], right[i], right[j]);
        this.tri(left[i], right[j], left[j]);
      } else {
        this.tri(left[i], right[j], right[i]);
        this.tri(left[i], left[j], right[j]);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface CharacterModel {
  root: THREE.Group;
  /** child of root: apply facing mirror / yaw here */
  body: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  bindPos: Record<BoneName, THREE.Vector3>;
  materials: PS1Material[];
  skeleton: THREE.Skeleton;
  /** world-space height of the eyes in bind pose (camera framing) */
  headY: number;
  dispose(): void;
}

function hashNoise(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}


const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Silhouette multipliers applied to bone positions and ring radii (all 1 = standard body). */
interface Shape {
  shoulder: number;
  chest: number;
  chestZ: number;
  waist: number;
  hip: number;
  hipX: number;
  arm: number;
  thigh: number;
  shin: number;
  neck: number;
  fist: number;
  foot: number;
}
const STANDARD: Shape = { shoulder: 1, chest: 1, chestZ: 1, waist: 1, hip: 1, hipX: 1, arm: 1, thigh: 1, shin: 1, neck: 1, fist: 1, foot: 1 };
const FINE: Shape = { shoulder: 0.88, chest: 0.86, chestZ: 0.92, waist: 0.9, hip: 1.08, hipX: 1.06, arm: 0.8, thigh: 0.9, shin: 0.86, neck: 0.84, fist: 0.84, foot: 0.92 };

export function buildCharacter(def: FighterDef, face: FaceAssets): CharacterModel {
  const build = def.build ?? 1;
  const hs = def.headScale ?? 1.15;
  const o = def.outfit;
  const F = def.body === 'fine' ? FINE : STANDARD;
  const belly = clamp01(def.belly ?? 0);
  /** bodybuilder inflation of arms / shoulders / chest / thighs, on top of `build` */
  const mus = clamp01(def.muscles ?? 0);
  const baggy = o.baggy ? 1 : 0;
  const suit = o.top === 'suit';
  const shorts = !!o.shorts && !suit;
  const C = (h: string) => new THREE.Color(h);
  const skin = face.skin.clone();
  const skinDark = skin.clone().multiplyScalar(0.9);
  const top = C(o.topColor);
  const trim = C(o.trimColor);
  const pants = C(o.pantsColor);
  const pantsDark = pants.clone().multiplyScalar(0.8);
  const shoes = C(o.shoesColor);
  const sole = suit ? shoes.clone().multiplyScalar(0.62) : C('#e8e6e0');
  const belt = suit ? top : C(o.beltColor ?? o.pantsColor).multiplyScalar(o.beltColor ? 1 : 0.7);
  const wrist = o.wristColor ? C(o.wristColor) : null;
  const stain = o.stains ? C(o.stains) : null;
  const socks = C('#f2f0ea');
  const web = suit && o.web ? C(o.web) : null;

  const shoulderX = 0.235 * Math.sqrt(build) * F.shoulder * (1 + 0.3 * mus);
  const hipX = 0.1 * Math.sqrt(build) * F.hipX;
  const wb = build; // width factor for radii

  // ---------------- skeleton ----------------
  const bindPos: Record<BoneName, THREE.Vector3> = {
    hips: new THREE.Vector3(0, 0.98, 0),
    spine: new THREE.Vector3(0, 1.1, 0),
    chest: new THREE.Vector3(0, 1.27, 0),
    neck: new THREE.Vector3(0, 1.5, 0),
    head: new THREE.Vector3(0, 1.58, 0),
    shoulderL: new THREE.Vector3(0.07 * F.shoulder * (1 + 0.3 * mus), 1.45, 0),
    upperArmL: new THREE.Vector3(shoulderX, 1.46, 0),
    foreArmL: new THREE.Vector3(shoulderX, 1.18, 0),
    handL: new THREE.Vector3(shoulderX, 0.94, 0),
    shoulderR: new THREE.Vector3(-0.07 * F.shoulder * (1 + 0.3 * mus), 1.45, 0),
    upperArmR: new THREE.Vector3(-shoulderX, 1.46, 0),
    foreArmR: new THREE.Vector3(-shoulderX, 1.18, 0),
    handR: new THREE.Vector3(-shoulderX, 0.94, 0),
    thighL: new THREE.Vector3(hipX, 0.95, 0),
    shinL: new THREE.Vector3(hipX, 0.51, 0),
    footL: new THREE.Vector3(hipX, 0.09, 0),
    thighR: new THREE.Vector3(-hipX, 0.95, 0),
    shinR: new THREE.Vector3(-hipX, 0.51, 0),
    footR: new THREE.Vector3(-hipX, 0.09, 0),
  };
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    const parent = PARENT[name];
    const wp = bindPos[name];
    if (parent) {
      b.position.copy(wp).sub(bindPos[parent]);
      bones[parent].add(b);
    } else {
      b.position.copy(wp);
    }
    bones[name] = b;
  }

  // ---------------- body geometry ----------------
  const g = new GeoBuilder();
  const SEG = 10;
  const isTank = o.top === 'tank';
  const bare = o.top === 'shirtless';
  const sleeves = o.top === 'tracksuit' || o.top === 'hoodie' || suit;
  const torsoTop = bare ? skin : top;
  /** bodysuit: side panels (under the arms, down the flanks) in the trim colour */
  const suitSide = (th: number) => Math.abs(Math.cos(th)) > 0.62;

  // tank top: shoulders and arm holes show skin; tracksuit: front zip stripe
  const upperChestCol: ColorFn = (th) => {
    const side = Math.abs(Math.cos(th));
    if (isTank && side > 0.82) return skin;
    if (o.top === 'tracksuit' && Math.abs(th - Math.PI / 2) < 0.2) return trim;
    return torsoTop;
  };
  const shoulderCol: ColorFn = (th) => {
    const side = Math.abs(Math.cos(th));
    if (isTank && side > 0.5) return skin;
    if (o.top === 'tracksuit' && Math.abs(th - Math.PI / 2) < 0.2) return trim;
    return torsoTop;
  };
  const midCol: ColorFn = (th) => {
    if (o.top === 'tracksuit' && Math.abs(th - Math.PI / 2) < 0.2) return trim;
    if (suit && suitSide(th)) return trim;
    return torsoTop;
  };
  const hemCol: ColorFn = (th) => {
    if (suit) return suitSide(th) ? trim : top;
    return o.top === 'tank' || o.top === 'tshirt' ? trim : torsoTop;
  };
  // a few blotches on the front of the top (vertex colours: free)
  let stainSeed = 0;
  const stained = (fn: ColorFn): ColorFn => {
    if (!stain || bare) return fn;
    const seed = ++stainSeed;
    return (th, end) => {
      const c = fn(th, end);
      if (c !== torsoTop || Math.sin(th) < 0.15) return c;
      const s = Math.round((th / (Math.PI * 2)) * SEG);
      const n = hashNoise(seed * 17.3 + s * 3.7 + end * 1.9);
      return n > 0.78 ? c.clone().lerp(stain, 0.4 + 0.3 * hashNoise(s * 5.1 + seed)) : c;
    };
  };

  // torso rings, bottom to top (also used to lay the chain on the chest); muscles: big pecs / lats / traps
  const torso: Ring[] = [
    { y: 0.84, rx: 0.12 * wb * F.hip, rz: 0.1 * wb, w: [['hips', 1]], col: pants },
    { y: 0.93, rx: 0.165 * wb * F.hip, rz: 0.115 * wb, w: [['hips', 1]], col: pants },
    { y: 1.0, rx: 0.172 * wb * F.hip + 0.01 * belly, rz: 0.118 * wb + 0.022 * belly, cz: 0.016 * belly, w: [['hips', 1]], col: belt },
    {
      y: 1.045,
      rx: 0.168 * wb * lerp(F.hip, F.waist, 0.5) + 0.018 * belly,
      rz: 0.115 * wb + 0.055 * belly,
      cz: 0.045 * belly,
      w: [['hips', 0.6], ['spine', 0.4]],
      col: stained(hemCol),
    },
    { y: 1.07, rx: 0.165 * wb * F.waist + 0.022 * belly, rz: 0.113 * wb + 0.07 * belly, cz: 0.058 * belly, w: [['hips', 0.4], ['spine', 0.6]], col: stained(midCol) },
    {
      y: 1.16,
      rx: 0.16 * wb * F.waist * (1 + 0.08 * mus) + 0.025 * belly,
      rz: 0.112 * wb * (1 + 0.05 * mus) + 0.078 * belly,
      cz: 0.005 + 0.066 * belly,
      w: [['spine', 1]],
      col: stained(midCol),
    },
    {
      y: 1.27,
      rx: 0.185 * wb * lerp(F.waist, F.chest, 0.5) * (1 + 0.24 * mus) + 0.012 * belly,
      rz: 0.125 * wb * lerp(1, F.chestZ, 0.5) * (1 + 0.18 * mus) + 0.04 * belly,
      cz: 0.01 + 0.032 * belly + 0.01 * mus,
      w: [['spine', 0.5], ['chest', 0.5]],
      col: stained(midCol),
    },
    {
      y: 1.37,
      rx: 0.205 * wb * F.chest * (1 + 0.42 * mus),
      rz: 0.135 * wb * F.chestZ * (1 + 0.36 * mus),
      cz: 0.015 + 0.024 * mus,
      w: [['chest', 1]],
      col: stained(upperChestCol),
    },
    { y: 1.46, rx: 0.2 * wb * F.chest * (1 + 0.5 * mus), rz: 0.115 * wb * F.chestZ * (1 + 0.32 * mus), cz: 0.006 * mus, w: [['chest', 1]], col: shoulderCol },
    { y: 1.52, rx: 0.08 * F.neck * (1 + 0.95 * mus), rz: 0.07 * F.neck * (1 + 0.5 * mus), cz: 0.0, w: [['chest', 0.6], ['neck', 0.4]], col: skin },
  ];
  g.tube(torso, SEG, true, false);

  // neck
  const nk = Math.sqrt(wb) * F.neck * (1 + 0.35 * mus);
  g.tube(
    [
      { y: 1.49, rx: 0.062 * nk, rz: 0.06 * nk, cz: 0.005, w: [['chest', 0.3], ['neck', 0.7]], col: skin },
      { y: 1.62, rx: 0.056 * nk, rz: 0.056 * nk, cz: 0.012, w: [['neck', 0.4], ['head', 0.6]], col: skin },
    ],
    8,
    false,
    false,
  );

  // arms (muscles: big deltoids, biceps and forearms)
  const aw = wb * F.arm;
  const M = (k: number) => aw * (1 + k * mus);
  const armRings: Ring[][] = [];
  for (const s of [1, -1] as const) {
    const L = s === 1 ? 'L' : 'R';
    const ua = `upperArm${L}` as BoneName;
    const fa = `foreArm${L}` as BoneName;
    const hand = `hand${L}` as BoneName;
    const x = s * shoulderX;
    const armTop = sleeves || o.top === 'tshirt' ? top : skin;
    const stripe = (base: THREE.Color): ColorFn => (th) => {
      // outer side stripe for tracksuits
      if (o.top === 'tracksuit' && Math.abs(Math.cos(th) - s) < 0.25) return trim;
      return base;
    };
    const lowerCol = sleeves ? top : skin;
    const arm: Ring[] = [
      { y: 1.52, rx: 0.05 * M(0.45), rz: 0.055 * M(0.45), cx: x, w: [[ua, 1]], col: stripe(armTop) },
      { y: 1.46, rx: 0.072 * M(0.75), rz: 0.078 * M(0.75), cx: x, w: [[ua, 1]], col: stripe(armTop) },
      { y: 1.32, rx: 0.064 * M(0.6), rz: 0.07 * M(0.95), cx: x, cz: 0.016 * mus, w: [[ua, 1]], col: stripe(o.top === 'tshirt' ? skin : armTop) },
      { y: 1.18, rx: 0.05 * M(0.3), rz: 0.054 * M(0.3), cx: x, w: [[ua, 0.5], [fa, 0.5]], col: stripe(lowerCol) },
      { y: 1.09, rx: 0.053 * M(0.6), rz: 0.057 * M(0.5), cx: x, cz: 0.004, w: [[fa, 1]], col: stripe(lowerCol) },
      { y: 0.98, rx: 0.04 * M(0.25), rz: 0.036 * M(0.25), cx: x, w: [[fa, 1]], col: suit ? top : sleeves ? trim : wrist ?? skin },
      { y: 0.95, rx: 0.038 * M(0.2), rz: 0.034 * M(0.2), cx: x, w: [[fa, 0.6], [hand, 0.4]], col: skin },
    ];
    armRings.push(arm);
    g.tube(arm, 8, true, true);
    // fist
    const fm = 1 + 0.18 * mus;
    g.box(
      new THREE.Vector3(x, 0.885, 0.012),
      new THREE.Vector3(0.07 * wb * F.fist * fm, 0.09 * lerp(1, F.fist, 0.5) * fm, 0.084 * Math.sqrt(wb) * F.fist * fm),
      [[hand, 1]],
      (n) => (n.z > 0.5 ? skinDark : skin),
    );

    // legs (baggy trousers get wider toward the ankles; muscles: big thighs and calves)
    const th = `thigh${L}` as BoneName;
    const sh = `shin${L}` as BoneName;
    const ft = `foot${L}` as BoneName;
    const lx = s * hipX;
    const leg: ColorFn = (t) => (Math.abs(Math.cos(t) - s) < 0.3 && o.top === 'tracksuit' ? trim : pants);
    const bw = (k: number) => wb * (1 + k * baggy);
    const LM = (k: number) => 1 + k * mus;
    const kneeR = 0.072 * bw(0.26) * lerp(F.thigh, F.shin, 0.5) * LM(0.25);
    const thighR = 0.086 * bw(0.16) * F.thigh * LM(0.5);
    const legRings: Ring[] = [
      { y: 1.0, rx: 0.088 * wb * LM(0.2), rz: 0.098 * wb * LM(0.2), cx: lx, w: [['hips', 1]], col: leg },
      { y: 0.92, rx: 0.096 * bw(0.06) * LM(0.3), rz: 0.102 * bw(0.06) * LM(0.3), cx: lx, w: [['hips', 0.3], [th, 0.7]], col: leg },
      { y: 0.72, rx: thighR, rz: 0.09 * bw(0.16) * F.thigh * LM(0.5), cx: lx, w: [[th, 1]], col: leg },
    ];
    if (shorts) {
      // loose hem just above the knee, then bare leg
      const hem = lerp(thighR, kneeR, 0.4);
      legRings.push(
        { y: 0.63, rx: hem * 1.14, rz: hem * 1.18, cx: lx, w: [[th, 1]], col: pantsDark },
        { y: 0.63, rx: hem * 0.94, rz: hem * 0.98, cx: lx, w: [[th, 1]], col: skin },
      );
    }
    legRings.push(
      { y: 0.51, rx: kneeR, rz: 0.076 * bw(0.26) * lerp(F.thigh, F.shin, 0.5) * LM(0.25), cx: lx, cz: 0.006, w: [[th, 0.5], [sh, 0.5]], col: shorts ? skin : leg },
      { y: 0.3, rx: 0.074 * bw(0.34) * F.shin * LM(0.4), rz: 0.076 * bw(0.34) * F.shin * LM(0.4), cx: lx, w: [[sh, 1]], col: shorts ? skin : suit ? shoes : leg },
      { y: 0.12, rx: 0.084 * bw(0.36) * F.shin, rz: 0.084 * bw(0.4) * F.shin, cx: lx, cz: 0.012 * baggy, w: [[sh, 1]], col: shorts ? socks : suit ? shoes : pantsDark },
      { y: 0.08, rx: 0.07 * bw(0.4) * F.shin, rz: 0.07 * bw(0.5) * F.shin, cx: lx, cz: 0.016 * baggy, w: [[sh, 0.5], [ft, 0.5]], col: shorts ? socks : suit ? shoes : pantsDark },
    );
    g.tube(legRings, 8, false, true);
    if (web) {
      // boots: two hoops + four lines
      const boot = legRings.filter((r) => r.y <= 0.3 && r.y >= 0.12);
      for (const r of boot) webHoop(g, r, 8, 0, Math.PI * 2, web);
      webLines(g, boot, 8, [0.4, 2.0, 3.5, 5.1], web);
    }
    // sneaker: upper + sole
    const fw = Math.sqrt(wb) * F.foot;
    g.box(new THREE.Vector3(lx, 0.075, 0.055), new THREE.Vector3(0.11 * fw, 0.09, 0.27), [[ft, 1]], (n) => (n.y > 0.5 ? shoes.clone().multiplyScalar(1.1) : shoes), 0.85);
    g.box(new THREE.Vector3(lx, 0.016, 0.055), new THREE.Vector3(0.118 * fw, 0.032, 0.285), [[ft, 1]], sole);
  }

  // bodysuit web: a grid of thin lines over the main colour (front / back of the torso, shoulders, arms)
  if (web) {
    const front = Math.PI / 2;
    const back = (3 * Math.PI) / 2;
    const half = Math.acos(0.62) - 0.04; // stay inside the main-colour panel
    const lower = torso.filter((r) => r.y >= 1.04 && r.y <= 1.37);
    const upper = torso.filter((r) => r.y >= 1.37);
    for (const c of [front, back]) {
      // vertical lines on the front / back panel, converging up to the neck
      const angles = [-1, -0.5, 0, 0.5, 1].map((k) => c + k * half);
      webLines(g, [...lower, ...upper.slice(1)], SEG, angles, web);
      for (const r of lower) if (r.y > 1.05 && r.y < 1.36) webHoop(g, r, SEG, c - half, c + half, web);
    }
    // shoulders / upper chest: lines all around + full hoops
    webLines(g, upper, SEG, [0.15, 0.5, 2.64, 2.99, 3.3, 3.65, 5.78, 6.13], web);
    for (const r of upper.slice(0, 2)) webHoop(g, r, SEG, 0, Math.PI * 2, web);
    for (const arm of armRings) {
      const a = arm.slice(0, 6);
      webLines(g, a, 8, [0.3, 1.35, 2.4, 3.45, 4.5, 5.55], web);
      for (const r of a.slice(1, 5)) webHoop(g, r, 8, 0, Math.PI * 2, web);
    }
  }

  // ---------------- head ----------------
  const headCY = 1.58 + 0.12 * hs;
  const R = new THREE.Vector3(0.1 * hs, 0.125 * hs, 0.112 * hs);
  const headGeo = new THREE.SphereGeometry(1, 12, 10);
  {
    const pos = headGeo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // jaw taper + flatter face
      const below = Math.max(0, -v.y);
      v.x *= 1 - 0.22 * below * below;
      v.z *= 1 - 0.08 * below * below;
      if (v.z > 0) v.z *= 0.86;
      v.set(v.x * R.x, v.y * R.y, v.z * R.z + 0.012);
      v.y += headCY;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    headGeo.computeVertexNormals();
  }
  const hb = new GeoBuilder();
  hb.addGeometry(headGeo, [['head', 1]], new THREE.Color(1, 1, 1));
  headGeo.dispose();

  // ears (same skin tone as the face edge / neck: the lighting alone shades them)
  for (const s of [1, -1]) {
    g.box(new THREE.Vector3(s * R.x * 0.97, headCY - 0.005, -0.01), new THREE.Vector3(0.03, 0.055 * hs, 0.035), [['head', 1]], skin);
  }

  addHair(g, def, headCY, R, torso);
  if (!def.face && def.faceGen?.mask === 'spider') addMaskWeb(g, headCY, R, new THREE.Color(def.faceGen.maskLine ?? '#121216'));
  if (def.beard3d) addBeard3d(g, def.beard3d, headCY, R);
  if (def.accessories?.chain) addChain(g, torso, wb, !!def.accessories.whistle);

  // ---------------- meshes ----------------
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(bones.hips);

  const bodyMat = createPS1Material({ vertexColors: true });
  const faceRect = new THREE.Vector4(0, headCY + 0.004 * hs, 0.094 * hs, 0.128 * hs);
  const faceMat = createFaceMaterial(face.texture, skin, faceRect);

  const bodyGeo = g.build();
  const headGeom = hb.build();
  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, bodyMat);
  const headMesh = new THREE.SkinnedMesh(headGeom, faceMat);
  bodyMesh.frustumCulled = false;
  headMesh.frustumCulled = false;
  body.add(bodyMesh, headMesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  bodyMesh.bind(skeleton);
  headMesh.bind(skeleton);

  const scale = def.height ?? 1;
  body.scale.setScalar(scale);

  return {
    root,
    body,
    bones,
    bindPos,
    materials: [bodyMat, faceMat],
    skeleton,
    headY: headCY * scale,
    dispose() {
      bodyGeo.dispose();
      headGeom.dispose();
      bodyMat.dispose();
      faceMat.dispose();
      skeleton.dispose();
    },
  };
}

/** Triangle count of a model (both meshes), for budgets / dev tools. */
export function countTriangles(m: CharacterModel): number {
  let n = 0;
  m.body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) n += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
  });
  return n;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** Hair & headwear: everything rigidly skinned to the head bone, kept above the hairline / behind the ears. */
function addHair(g: GeoBuilder, def: FighterDef, cy: number, R: THREE.Vector3, torso: Ring[]) {
  const style: HairStyle = def.hair.style;
  if (style === 'bald') return;
  const col = new THREE.Color(def.hair.color);
  const w: Weights = [['head', 1]];
  const k = R.x / 0.1; // = head scale
  const varyOf = (c: THREE.Color, amt = 0.3) => (p: THREE.Vector3, i: number) => c.clone().multiplyScalar(0.82 + amt * hashNoise(i + p.x * 10));
  const vary = varyOf(col);
  const headwear = def.accessories?.cap ? new THREE.Color(def.accessories.cap) : null;
  const tieCol = new THREE.Color(def.outfit.topColor);

  /** maps a point of the (tilted) unit sphere onto the skull, `scale` x the head radii */
  const onSkull = (v: THREE.Vector3, scale: number) => {
    if (v.z > 0) v.z *= 0.9;
    return v.set(v.x * R.x * scale, v.y * R.y * scale + cy, v.z * R.z * scale + 0.012);
  };
  /** skull point in a direction given before tilt (unit sphere), after rotating by `tilt` around X */
  const skullPoint = (dir: THREE.Vector3, scale: number, tilt = 0) => onSkull(dir.clone().normalize().applyAxisAngle(AXIS_X, tilt), scale);
  const add = (geo: THREE.BufferGeometry, color: THREE.Color | ((p: THREE.Vector3, i: number) => THREE.Color)) => {
    g.addGeometry(geo, w, color);
    geo.dispose();
  };

  /** spherical cap covering the top of the skull (front edge = hairline); `bump` = curly relief */
  const dome = (scale: number, tilt: number, thetaLen: number, color: (p: THREE.Vector3, i: number) => THREE.Color = vary, bump = 0) => {
    const geo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(tilt);
    const pos = geo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      onSkull(v, scale * (1 + bump * (posNoise(v) - 0.3)));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    add(geo, color);
  };

  /**
   * Thick curtain of hair around the sides and back (front opening = 2 x (180 - halfDeg) deg),
   * hugging the jaw / neck down to `yuBottom`, with curly relief and a jagged bottom edge.
   */
  const curtain = (halfDeg: number, yuBottom: number, curlAmt: number, jagAmt: number, flare0: number, NI: number, NJ: number) => {
    const psi0 = THREE.MathUtils.degToRad(halfDeg); // measured from the back
    const outer: THREE.Vector3[][] = [];
    const inner: THREE.Vector3[][] = [];
    for (let i = 0; i <= NI; i++) {
      const s = i / NI;
      const yu = lerp(0.3, yuBottom, s);
      const below = Math.max(0, -yu);
      // head cross-section at this height (jaw taper), never narrower than the neck
      const head = Math.max(0.64, Math.sqrt(Math.max(0, 1 - yu * yu)) * (1 - 0.22 * below * below));
      const ro: THREE.Vector3[] = [];
      const ri: THREE.Vector3[] = [];
      for (let j = 0; j <= NJ; j++) {
        const psi = -psi0 + (2 * psi0 * j) / NJ;
        const curl = curlAmt * (hashNoise(i * 13.3 + j * 5.1) - 0.5) * Math.min(1, s * 3);
        const flare = head * (flare0 + 0.1 * s) + curl;
        const jag = i === NI ? (j % 2 ? jagAmt : -0.004) * k : 0;
        const at = (f: number) => {
          let z = -Math.cos(psi) * R.z * f;
          if (z > 0) z *= 0.9;
          return new THREE.Vector3(Math.sin(psi) * R.x * f, cy + yu * R.y + jag, z + 0.012);
        };
        ro.push(at(flare));
        ri.push(at(flare - 0.13));
      }
      outer.push(ro);
      inner.push(ri);
    }
    const axis = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z - 0.012);
    add(gridGeometry(outer, axis), vary);
    add(gridGeometry(inner, (p) => axis(p).negate()), (p, i) => vary(p, i).multiplyScalar(0.62));
    add(gridGeometry([outer[NI], inner[NI]], () => new THREE.Vector3(0, -1, 0)), (p, i) => vary(p, i).multiplyScalar(0.8));
    const mid = Math.floor(NI / 2);
    for (const j of [0, NJ]) {
      const e = outer[mid][j].clone().sub(outer[mid][j === 0 ? 1 : NJ - 1]);
      add(
        gridGeometry(
          [outer.map((r) => r[j]), inner.map((r) => r[j])],
          () => e,
        ),
        (p, i) => vary(p, i).multiplyScalar(0.85),
      );
    }
  };

  const headC = new THREE.Vector3(0, cy, 0.012);
  /** rounded curl clump lying on the hair surface: squashed along the outward direction, random twist */
  const curl = (pos: THREE.Vector3, r: number, seed: number) => {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.scale(r * (1.05 + 0.2 * hashNoise(seed * 1.3)), r * 0.78, r * (0.95 + 0.2 * hashNoise(seed * 3.7)));
    geo.rotateY(hashNoise(seed * 5.9) * Math.PI * 2);
    const out = pos.clone().sub(headC).normalize();
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out));
    geo.translate(pos.x, pos.y, pos.z);
    // lighter tops, darker undersides: each clump reads as a curl
    add(geo, (p, i) => col.clone().multiplyScalar(0.74 + 0.16 * hashNoise(seed * 11 + i) + 0.22 * clamp01((p.y - pos.y) / r + 0.5)));
  };
  /** point on the hair envelope: longitude phi (0 = front), unit height yu */
  const envelope = (phi: number, yu: number, f: number) => {
    const below = Math.max(0, -yu);
    const head = Math.max(0.64, Math.sqrt(Math.max(0, 1 - yu * yu)) * (1 - 0.22 * below * below));
    const rr = yu > 0.2 ? f : head * f;
    let z = Math.cos(phi) * R.z * rr;
    if (z > 0) z *= 0.9;
    return new THREE.Vector3(Math.sin(phi) * R.x * rr, cy + yu * R.y, z + 0.012);
  };

  /**
   * Long hair falling past the jaw to the shoulders: hugs the skull, then hangs straight down
   * and spreads a little on the shoulders, with waves. The lower part follows the neck / chest.
   */
  const drape = (halfTop: number, halfBottom: number, yuBottom: number, wave: number, NI: number, NJ: number) => {
    const outer: THREE.Vector3[][] = [];
    const inner: THREE.Vector3[][] = [];
    for (let i = 0; i <= NI; i++) {
      const s = i / NI;
      const yu = lerp(0.3, yuBottom, s);
      const below = Math.max(0, -yu);
      const skull = Math.sqrt(Math.max(0, 1 - yu * yu)) * (1 - 0.22 * below * below);
      const fall = yu < 0 ? Math.max(skull, 0.96 + 0.07 * clamp01(-yu - 1)) : skull;
      const psi0 = THREE.MathUtils.degToRad(lerp(halfTop, halfBottom, s * s * (3 - 2 * s)));
      const ro: THREE.Vector3[] = [];
      const ri: THREE.Vector3[] = [];
      for (let j = 0; j <= NJ; j++) {
        const psi = -psi0 + (2 * psi0 * j) / NJ;
        const wv = wave * Math.sin(psi * 7 + yu * 3.4) * Math.min(1, 0.25 + s * 2.5);
        const jag = i === NI ? (j % 2 ? 0.05 : -0.005) * k : 0;
        const f = fall * 1.1 + wv;
        const at = (ff: number) => {
          let z = -Math.cos(psi) * R.z * ff;
          if (z > 0) z *= 0.9;
          return new THREE.Vector3(Math.sin(psi) * R.x * ff, cy + yu * R.y + jag, z + 0.012);
        };
        ro.push(at(f));
        ri.push(at(f - 0.13 - 0.05 * s));
      }
      outer.push(ro);
      inner.push(ri);
    }
    const weightAt = (p: THREE.Vector3): Weights => {
      const yu = (p.y - cy) / R.y;
      const t = clamp01((-0.85 - yu) / (-0.85 - yuBottom));
      if (t <= 0) return w;
      return [['head', 1 - 0.65 * t], ['neck', 0.25 * t], ['chest', 0.4 * t]];
    };
    const put = (geo: THREE.BufferGeometry, c: (p: THREE.Vector3, i: number) => THREE.Color) => {
      g.addGeometry(geo, weightAt, c);
      geo.dispose();
    };
    const axis = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z - 0.012);
    put(gridGeometry(outer, axis), vary);
    put(gridGeometry(inner, (p) => axis(p).negate()), (p, i) => vary(p, i).multiplyScalar(0.6));
    put(gridGeometry([outer[NI], inner[NI]], () => new THREE.Vector3(0, -1, 0)), (p, i) => vary(p, i).multiplyScalar(0.8));
    const mid = Math.floor(NI / 2);
    for (const j of [0, NJ]) {
      // the front edges face away from the rest of the curtain
      const e = outer[mid][j].clone().sub(outer[mid][j === 0 ? 1 : NJ - 1]);
      put(gridGeometry([outer.map((r) => r[j]), inner.map((r) => r[j])], () => e), (p, i) => vary(p, i).multiplyScalar(0.85));
    }
  };

  switch (style) {
    case 'buzz':
      dome(1.03, -0.5, 1.3);
      break;
    case 'beanie': {
      // knit beanie worn low on the forehead (no logo): ribbed crown, folded cuff, rolled rim
      const knit = headwear ?? col;
      // with a separate beanie colour, the hair shows under it over the ears and at the nape (not on the forehead)
      if (headwear) dome(1.045, -0.6, 1.55, vary);
      // front edge just above the brows, sides over the top of the ears, back down to the nape
      const tilt = -0.42;
      const tl = 1.45;
      const sc = 1.12;
      const W = 32;
      const ribs = (amp: number) => (_p: THREE.Vector3, i: number) => knit.clone().multiplyScalar((i % (W + 1)) % 2 ? 1 - amp : 1 + 0.04 * hashNoise(i));
      const shell = (scale: number, from: number, len: number, hSeg: number, color: (p: THREE.Vector3, i: number) => THREE.Color) => {
        const geo = new THREE.SphereGeometry(1, W, hSeg, 0, Math.PI * 2, from, len);
        geo.rotateX(tilt);
        const pos = geo.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          onSkull(v.fromBufferAttribute(pos, i), scale);
          // slightly taller crown
          v.y = cy + (v.y - cy) * (v.y > cy ? 1.06 : 1);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        geo.computeVertexNormals();
        add(geo, color);
      };
      shell(sc, 0, tl - 0.3, 5, ribs(0.2));
      // folded cuff: a slightly thicker band around the bottom
      shell(sc + 0.04, tl - 0.36, 0.36, 2, ribs(0.3));
      // rolled bottom edge
      const rim = new THREE.TorusGeometry(Math.sin(tl), 0.05, 3, 20);
      rim.rotateX(Math.PI / 2);
      rim.translate(0, Math.cos(tl), 0);
      rim.rotateX(tilt);
      {
        const pos = rim.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          onSkull(v.fromBufferAttribute(pos, i), sc + 0.03);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        rim.computeVertexNormals();
      }
      add(rim, knit.clone().multiplyScalar(0.82));
      break;
    }
    case 'wavy': {
      // long wavy hair to the shoulders, parted in the middle, the face stays open
      dome(1.09, -0.45, 1.42, vary, 0.07);
      drape(118, 104, -1.55, 0.06, 8, 16);
      break;
    }
    case 'ssj': {
      // "super sayan": huge golden spikes standing up; vertex colours above 1 keep them bright (glowy) under the lighting
      const glow = (p: THREE.Vector3, i: number) => col.clone().multiplyScalar(1.15 + 0.3 * clamp01((p.y - cy) / (R.y * 2.8)) + 0.08 * hashNoise(i + p.x * 10));
      dome(1.07, -0.46, 1.38, glow);
      const N = 26;
      for (let i = 0; i < N; i++) {
        const az = i * 2.39996 + 0.3;
        const h = (i + 0.5) / N;
        let pb = 0.12 + 1.15 * Math.sqrt(h); // polar angle of the root on the skull
        if (Math.cos(az) > 0.25) pb = Math.min(pb, 0.62); // keep the forehead clear
        const root = new THREE.Vector3(Math.sin(pb) * Math.sin(az), Math.cos(pb), Math.sin(pb) * Math.cos(az));
        // standing up (flame-like), leaning outward and a bit back
        const dir = root.clone().multiplyScalar(0.62).add(new THREE.Vector3(0, 1, -0.12)).normalize();
        const len = k * (0.2 + 0.12 * hashNoise(i * 3.1)) * (1.15 - 0.4 * Math.sin(pb));
        const cone = new THREE.ConeGeometry(k * (0.05 + 0.018 * hashNoise(i * 1.7)), len, 5);
        cone.translate(0, len / 2, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        const base = onSkull(root.clone(), 0.96);
        cone.translate(base.x, base.y, base.z);
        add(cone, glow);
      }
      // two bangs falling over the forehead
      for (const sx of [-1, 1]) {
        const base = skullPoint(new THREE.Vector3(sx * 0.22, 0.86, 0.48), 1.05);
        const len = k * 0.1;
        const cone = new THREE.ConeGeometry(k * 0.026, len, 4);
        cone.translate(0, len / 2, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sx * 0.35, -0.75, 0.55).normalize()));
        cone.translate(base.x, base.y, base.z);
        add(cone, glow);
      }
      break;
    }
    case 'short':
      dome(1.07, -0.48, 1.38);
      break;
    case 'spiky': {
      dome(1.06, -0.45, 1.36);
      const spikes = 22;
      for (let i = 0; i < spikes; i++) {
        // golden-angle distribution over the top / back of the skull
        const a = i * 2.39996;
        const r = Math.sqrt((i + 0.5) / spikes) * 0.95;
        const dir = new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r * 0.9 - 0.2).normalize();
        const len = 0.07 + 0.05 * hashNoise(i * 3.1);
        const cone = new THREE.ConeGeometry(0.03 + 0.012 * hashNoise(i), len, 4);
        cone.translate(0, len / 2, 0);
        // spikes lean up and slightly back
        const tip = dir.clone().add(new THREE.Vector3(0, 0.5, -0.25)).normalize();
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip));
        const base = new THREE.Vector3(dir.x * R.x * 0.98, dir.y * R.y * 0.98 + cy, dir.z * R.z * 0.98 + 0.012);
        cone.translate(base.x, base.y, base.z);
        add(cone, vary);
      }
      break;
    }
    case 'spikyfringe': {
      // short spiky crop: many short spikes over the top / back, a short fringe on the forehead
      dome(1.06, -0.42, 1.36);
      const spikes = 30;
      for (let i = 0; i < spikes; i++) {
        const a = i * 2.39996;
        const r = Math.sqrt((i + 0.5) / spikes) * 0.95;
        const dir = new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r * 0.9 - 0.1).normalize();
        const len = k * (0.04 + 0.03 * hashNoise(i * 3.1));
        const cone = new THREE.ConeGeometry(k * (0.024 + 0.01 * hashNoise(i)), len, 4);
        cone.translate(0, len / 2, 0);
        const tip = dir.clone().add(new THREE.Vector3(0, 0.35, -0.08)).normalize();
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip));
        const base = new THREE.Vector3(dir.x * R.x * 0.98, dir.y * R.y * 0.98 + cy, dir.z * R.z * 0.98 + 0.012);
        cone.translate(base.x, base.y, base.z);
        add(cone, vary);
      }
      // fringe: short locks pointing forward and down over the top of the forehead
      for (let j = 0; j < 6; j++) {
        const sx = -0.55 + j * 0.22;
        const base = skullPoint(new THREE.Vector3(sx * 0.8, 0.8, 0.6), 1.04);
        const len = k * (0.06 + 0.02 * hashNoise(j * 7.3));
        const cone = new THREE.ConeGeometry(k * 0.03, len, 4);
        cone.translate(0, len / 2, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sx * 0.35, -0.45, 0.85).normalize()));
        cone.translate(base.x, base.y, base.z);
        add(cone, vary);
      }
      break;
    }
    case 'afro':
    case 'bigafro': {
      const big = style === 'bigafro';
      const geo = new THREE.IcosahedronGeometry(1, big ? 2 : 1);
      const pos = geo.getAttribute('position');
      const v = new THREE.Vector3();
      const hairline = cy + R.y * 0.6;
      const [sx, sy, sz, lift, zo] = big ? [1.9, 1.48, 1.62, 0.52, -0.05] : [1.45, 1.15, 1.3, 0.4, -0.04];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const b = big ? 1 + 0.09 * (posNoise(v) - 0.5) : 1;
        const x = v.x * R.x * sx * b;
        let y = v.y * R.y * sy * b + cy + R.y * lift;
        let z = v.z * R.z * sz * b + zo;
        // keep the face clear: the front-lower part is lifted up to the hairline
        const front = clamp01(v.z * 1.8 - 0.25);
        if (y < hairline) y = lerp(y, hairline, front);
        if (big && z > 0) {
          if (y < hairline && Math.abs(x) < R.x * 1.12) y = hairline;
          // rounded front: just above the forehead at the hairline, bulging forward higher up
          const cap = y >= hairline ? R.z * 0.95 + 0.012 + 0.85 * (y - hairline) : R.z * 0.7;
          z = Math.min(z, cap);
        }
        pos.setXYZ(i, x, y, z);
      }
      geo.computeVertexNormals();
      add(geo, vary);
      break;
    }
    case 'long': {
      dome(1.07, -0.45, 1.4);
      g.box(new THREE.Vector3(0, cy - R.y * 0.5, -R.z * 0.7), new THREE.Vector3(R.x * 2.1, R.y * 2.2, 0.06), w, col);
      break;
    }
    case 'mohawk': {
      dome(1.02, -0.5, 1.25);
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const ang = -0.9 + t * 2.2; // from front to back over the top
        const dir = new THREE.Vector3(0, Math.cos(ang), Math.sin(-ang) * 0.9 + 0.15).normalize();
        const cone = new THREE.ConeGeometry(0.035, 0.16, 4);
        cone.translate(0, 0.08, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        cone.translate(dir.x * R.x * 0.9, dir.y * R.y * 0.9 + cy, dir.z * R.z * 0.9);
        add(cone, vary);
      }
      break;
    }
    case 'midlong': {
      // straight cap + a thick curtain of hair around the sides and back that follows the jaw
      // down to the neck; the front stays open (+-64 deg) so the face is never covered
      dome(1.08, -0.46, 1.42, vary, 0.06);
      curtain(116, -1.08, 0.07, 0.04, 1.13, 6, 14);
      break;
    }
    case 'curlyshort': {
      // short curly crop: bumpy cap + tight curls over the crown, short on the sides (ears visible)
      dome(1.07, -0.5, 1.32, vary, 0.08);
      const NT = 30;
      for (let i = 0; i < NT; i++) {
        const t = (i + 0.5) / NT;
        const yu = 1 - t * 0.66;
        const phi = i * 2.39996;
        if (Math.cos(phi) > 0.3 && yu < 0.72) continue;
        const dir = new THREE.Vector3(Math.sqrt(1 - yu * yu) * Math.sin(phi), yu, Math.sqrt(1 - yu * yu) * Math.cos(phi)).applyAxisAngle(AXIS_X, -0.3);
        curl(onSkull(dir, 1.08 + 0.03 * hashNoise(i * 3.3)), k * (0.027 + 0.008 * hashNoise(i)), 300 + i);
      }
      // small curls along the hairline
      for (let i = 0; i < 5; i++) {
        const phi = THREE.MathUtils.degToRad(-40 + 20 * i);
        const p = skullPoint(new THREE.Vector3(Math.sin(phi) * 0.72, 0.7, Math.cos(phi) * 0.72), 1.07);
        curl(p, k * (0.02 + 0.005 * hashNoise(i * 9.1)), 340 + i);
      }
      break;
    }
    case 'curlymid': {
      // voluminous curly cut: bumpy base + many curl clumps on top, over the ears and down to the jaw
      dome(1.1, -0.42, 1.45, vary, 0.1);
      curtain(112, -0.92, 0.12, 0.05, 1.22, 5, 12);
      // messy curls over the crown (golden spiral), none below the hairline in front
      const NT = 30;
      for (let i = 0; i < NT; i++) {
        const t = (i + 0.5) / NT;
        const yu = 1 - t * 0.85;
        const phi = i * 2.39996;
        if (Math.cos(phi) > 0.3 && yu < 0.66) continue;
        const dir = new THREE.Vector3(Math.sqrt(1 - yu * yu) * Math.sin(phi), yu, Math.sqrt(1 - yu * yu) * Math.cos(phi)).applyAxisAngle(AXIS_X, -0.25);
        curl(onSkull(dir, 1.11 + 0.04 * hashNoise(i * 3.3)), k * (0.036 + 0.01 * hashNoise(i)), i);
      }
      // curls falling over the ears and down the sides / back to the jaw
      const rows = [0.15, -0.2, -0.52, -0.82];
      rows.forEach((yu, ri) => {
        const n = 9;
        for (let j = 0; j < n; j++) {
          const phi = THREE.MathUtils.degToRad(88 + (184 * (j + 0.5 * (ri % 2))) / (n - 0.5));
          const p = envelope(phi, yu + 0.05 * (hashNoise(ri * 17 + j) - 0.5), 1.2 + 0.06 * ri);
          curl(p, k * (0.032 + 0.008 * hashNoise(ri * 7 + j * 3)), 100 + ri * 20 + j);
        }
      });
      // a few small curly locks on the forehead edge (above the brows)
      for (let i = 0; i < 5; i++) {
        const phi = THREE.MathUtils.degToRad(-44 + 22 * i);
        const p = skullPoint(new THREE.Vector3(Math.sin(phi) * 0.76, 0.66, Math.cos(phi) * 0.76), 1.1);
        curl(p, k * (0.022 + 0.006 * hashNoise(i * 9.1)), 200 + i);
      }
      break;
    }
    case 'tahiti': {
      // huge palm-tree mass: a bushy core on the crown and big spiky fronds fanning up and out
      dome(1.07, -0.46, 1.38);
      const centre = new THREE.Vector3(0, cy + R.y * 1.2, -0.05 * k);
      const core = new THREE.IcosahedronGeometry(1, 1);
      core.scale(0.16 * k, 0.12 * k, 0.13 * k);
      core.translate(centre.x, centre.y, centre.z);
      add(core, vary);
      const tipShade = (p: THREE.Vector3, i: number) => col.clone().multiplyScalar(0.62 + 0.55 * clamp01(p.distanceTo(centre) / (0.34 * k)) + 0.12 * hashNoise(i));
      const N = 40;
      for (let i = 0; i < N; i++) {
        const az = i * 2.39996 + 0.4;
        let el = THREE.MathUtils.degToRad(lerp(8, 84, (i * 0.618034) % 1));
        // nothing droops over the face: forward fronds point up
        if (Math.cos(az) > 0.2) el = Math.max(el, THREE.MathUtils.degToRad(48));
        const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az) - 0.15).normalize();
        const len = k * (0.16 + 0.16 * hashNoise(i * 2.7)) * (0.85 + 0.35 * Math.sin(el));
        const cone = new THREE.ConeGeometry(k * (0.05 + 0.025 * hashNoise(i * 5.3)), len, 5);
        cone.translate(0, len / 2, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        cone.translate(centre.x + dir.x * 0.08 * k, centre.y + dir.y * 0.06 * k, centre.z + dir.z * 0.08 * k);
        add(cone, tipShade);
      }
      break;
    }
    case 'dreads': {
      dome(1.05, -0.5, 1.45, vary, 0.04);
      const skull = (phi: number, yu: number, f: number) => {
        const cl = Math.sqrt(Math.max(0, 1 - yu * yu));
        return onSkull(new THREE.Vector3(cl * Math.sin(phi), yu, cl * Math.cos(phi)), f);
      };
      const surfZ = (x: number, y: number, front: boolean, gap: number) => {
        const s = torsoAt(torso, y);
        const q = Math.sqrt(Math.max(0, 1 - Math.min(1, (x / s.rx) ** 2)));
        return s.cz + (front ? 1 : -1) * (s.rz * q + gap);
      };
      const pushOut = (p: THREE.Vector3) => {
        if (p.y > 1.53) return;
        const s = torsoAt(torso, p.y);
        const q = Math.hypot(p.x / s.rx, (p.z - s.cz) / s.rz);
        if (q < 1.1) {
          const f = 1.1 / Math.max(q, 0.05);
          p.x *= f;
          p.z = s.cz + (p.z - s.cz) * f;
        }
      };
      const weightAt = (y: number): Weights => {
        if (y > cy - R.y * 0.8) return [['head', 1]];
        if (y > 1.53) return [['head', 0.45], ['neck', 0.2], ['chest', 0.35]];
        if (y > 1.32) return [['chest', 1]];
        if (y > 1.2) return [['chest', 0.5], ['spine', 0.5]];
        return [['spine', 1]];
      };
      const lock = (pts: THREE.Vector3[], seed: number) => {
        pts.forEach(pushOut);
        const n = pts.length;
        const r0 = k * (0.012 + 0.004 * hashNoise(seed * 3.1));
        const radii = pts.map((_, i) => r0 * (1 + 0.25 * Math.sin((Math.PI * i) / (n - 1))));
        const shade = 0.8 + 0.35 * hashNoise(seed * 7.7);
        g.pathTube(pts, radii, pts.map((p) => weightAt(p.y)), 4, (i) => col.clone().multiplyScalar(shade * (i === n - 1 ? 1.25 : 1)));
      };
      // back & sides: from the crown, around the skull, down the back to the belly
      const M = 20;
      for (let m = 0; m < M; m++) {
        const phi = THREE.MathUtils.degToRad(78 + (204 * (m + 0.5)) / M + 4 * (hashNoise(m) - 0.5));
        const sn = Math.sin(phi);
        const yu0 = m % 2 ? 0.72 : 0.36;
        const p2 = skull(phi, -0.55, 1.17);
        if (Math.abs(p2.x) < R.x * 1.08 && Math.cos(phi) > -0.2) p2.x = Math.sign(sn) * R.x * 1.08;
        const bx = sn * 0.15;
        const tipY = 1.12 + 0.07 * hashNoise(m * 1.7);
        lock(
          [
            skull(phi, yu0, 1.0),
            skull(phi, yu0 - 0.42, 1.13),
            p2,
            new THREE.Vector3(sn * R.x * 1.05, cy - R.y * 1.05, Math.min(-0.05, Math.cos(phi) * 0.13)),
            new THREE.Vector3(bx, 1.44, surfZ(bx, 1.44, false, 0.022)),
            new THREE.Vector3(bx * 1.02, 1.3, surfZ(bx, 1.3, false, 0.022)),
            new THREE.Vector3(bx * 0.96, tipY, surfZ(bx, tipY, false, 0.022)),
          ],
          m,
        );
      }
      // a few locks in front of the shoulders, framing the face (always outside the cheeks)
      for (const sg of [1, -1]) {
        for (let n = 0; n < 3; n++) {
          const phi = sg * THREE.MathUtils.degToRad(60 + 10 * n);
          const fx = sg * (0.105 + 0.026 * n);
          const tipY = 1.16 + 0.05 * hashNoise(n * 9.1 + sg);
          lock(
            [
              skull(phi, 0.5 - 0.08 * n, 1.0),
              new THREE.Vector3(sg * R.x * 1.1, cy + R.y * 0.15, R.z * (0.34 - 0.08 * n)),
              new THREE.Vector3(sg * R.x * 1.16, cy - R.y * 0.45, R.z * (0.3 - 0.06 * n)),
              new THREE.Vector3(sg * R.x * 1.13, cy - R.y * 1.0, R.z * (0.32 - 0.06 * n)),
              new THREE.Vector3(fx, 1.45, surfZ(fx, 1.45, true, 0.024)),
              new THREE.Vector3(fx * 1.03, 1.3, surfZ(fx, 1.3, true, 0.024)),
              new THREE.Vector3(fx * 1.05, tipY, surfZ(fx, tipY, true, 0.024)),
            ],
            40 + n * 2 + sg,
          );
        }
      }
      break;
    }
    case 'ponytail': {
      dome(1.07, -0.46, 1.4);
      // scrunchie at the back of the crown, tail curving back then down the nape
      const anchor = skullPoint(new THREE.Vector3(0, 0.5, -0.87), 1.04);
      const tie = new THREE.CylinderGeometry(0.034 * k, 0.034 * k, 0.026 * k, 6);
      tie.rotateX(Math.PI / 2 - 0.5);
      tie.translate(anchor.x, anchor.y, anchor.z - 0.008 * k);
      add(tie, varyOf(tieCol, 0.15));
      const L = 0.22 * k;
      const tail = new THREE.CylinderGeometry(1, 1, 1, 6, 4);
      const pos = tail.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const t = 0.5 - v.y; // 0 at the tie, 1 at the tip
        const r = k * (0.03 * (1 - t) + 0.01 * t + 0.012 * Math.sin(Math.PI * t));
        const back = 0.075 * k * (1 - (1 - t) * (1 - t));
        pos.setXYZ(i, anchor.x + v.x * r, anchor.y - L * Math.pow(t, 1.2), anchor.z - 0.02 * k - back + v.z * r);
      }
      tail.computeVertexNormals();
      add(tail, vary);
      break;
    }
    case 'bun': {
      dome(1.07, -0.46, 1.4);
      const dir = new THREE.Vector3(0, 0.8, -0.6).normalize();
      const base = skullPoint(dir, 1.05);
      const tie = new THREE.CylinderGeometry(0.046 * k, 0.05 * k, 0.022 * k, 8);
      tie.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      tie.translate(base.x, base.y, base.z);
      add(tie, varyOf(tieCol, 0.15));
      const bun = new THREE.IcosahedronGeometry(1, 1);
      bun.scale(0.075 * k, 0.066 * k, 0.075 * k);
      bun.translate(base.x + dir.x * 0.05 * k, base.y + dir.y * 0.05 * k, base.z + dir.z * 0.05 * k);
      add(bun, vary);
      break;
    }
    case 'cap': {
      // backwards baseball cap; with a separate cap colour, the hair shows at the sides and back
      const capCol = headwear ?? col;
      if (headwear) dome(1.05, -0.5, 1.46);
      const tilt = -0.3;
      const tl = 1.24;
      const sc = 1.12;
      // six panels, alternately shaded
      dome(sc, tilt, tl, (p, i) => {
        const a = Math.atan2(p.x, p.z - 0.012) + Math.PI;
        const panel = Math.floor((a / (Math.PI * 2)) * 6 + 0.5) % 2;
        return capCol.clone().multiplyScalar((panel ? 0.9 : 1.02) + 0.06 * hashNoise(i));
      });
      // button on top
      const apex = skullPoint(new THREE.Vector3(0, 1, 0), sc + 0.02, tilt);
      const btn = new THREE.BoxGeometry(0.022 * k, 0.012 * k, 0.022 * k);
      btn.rotateX(tilt);
      btn.translate(apex.x, apex.y, apex.z);
      add(btn, capCol.clone().multiplyScalar(0.8));
      // brim at the back, pointing backwards and slightly down
      const backEdge = skullPoint(new THREE.Vector3(0, Math.cos(tl), -Math.sin(tl)), sc, tilt);
      const brim = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false, Math.PI / 2, Math.PI);
      brim.scale(R.x * 0.95, 0.014 * k, 0.11 * k);
      brim.rotateX(-0.32);
      brim.translate(0, backEdge.y + 0.004 * k, backEdge.z + 0.018 * k);
      add(brim, (p) => (p.y > backEdge.y + 0.004 * k ? capCol.clone().multiplyScalar(0.92) : capCol.clone().multiplyScalar(0.62)));
      break;
    }
    case 'bandana': {
      // GTA-style bandana: tight cloth over the skull, rolled edge, knot + two tails at the back
      const band = headwear ?? col;
      if (headwear) dome(1.04, -0.52, 1.5);
      const tilt = -0.4;
      const tl = 1.4;
      const sc = 1.09;
      const pattern = (p: THREE.Vector3, i: number) =>
        hashNoise(i * 7.13 + 1.7) > 0.8 ? band.clone().lerp(WHITE, 0.42) : band.clone().multiplyScalar(0.86 + 0.18 * hashNoise(i + p.y * 30));
      dome(sc, tilt, tl, pattern);
      // rolled edge following the rim of the cloth
      const rim = new THREE.TorusGeometry(Math.sin(tl), 0.06, 3, 14);
      rim.rotateX(Math.PI / 2);
      rim.translate(0, Math.cos(tl), 0);
      rim.rotateX(tilt);
      {
        const pos = rim.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          onSkull(v.fromBufferAttribute(pos, i), sc);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        rim.computeVertexNormals();
      }
      add(rim, band.clone().multiplyScalar(0.8));
      // knot
      const knotPos = skullPoint(new THREE.Vector3(0, Math.cos(tl), -Math.sin(tl)), sc + 0.06, tilt);
      const knot = new THREE.IcosahedronGeometry(0.03 * k, 0);
      knot.scale(1.25, 1, 0.9);
      knot.translate(knotPos.x, knotPos.y + 0.008 * k, knotPos.z - 0.006 * k);
      add(knot, band.clone().multiplyScalar(0.9));
      // tails
      for (const s of [1, -1]) {
        const tl2 = new THREE.BoxGeometry(0.034 * k, 0.1 * k, 0.008 * k);
        tl2.translate(0, -0.05 * k, 0);
        tl2.rotateZ(s * 0.38);
        tl2.rotateX(0.28);
        tl2.translate(knotPos.x + s * 0.008 * k, knotPos.y, knotPos.z - 0.01 * k);
        add(tl2, (_p, i) => band.clone().multiplyScalar(i % 4 < 2 ? 0.95 : 0.78));
      }
      break;
    }
  }
}

/** Noise from a position (stable for vertices shared by several faces). */
function posNoise(v: THREE.Vector3): number {
  return hashNoise(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719);
}

/** Indexed grid surface (rows x cols of points); each triangle is oriented so its normal agrees with `out(p)`. */
function gridGeometry(P: THREE.Vector3[][], out: (p: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry {
  const rows = P.length;
  const cols = P[0].length;
  const pos: number[] = [];
  for (const r of P) for (const p of r) pos.push(p.x, p.y, p.z);
  const idx: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  const tri = (i0: number, i1: number, i2: number) => {
    a.fromArray(pos, i0 * 3);
    b.fromArray(pos, i1 * 3);
    c.fromArray(pos, i2 * 3);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(out(m)) < 0) idx.push(i0, i2, i1);
    else idx.push(i0, i1, i2);
  };
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const p = i * cols + j;
      tri(p, p + cols, p + 1);
      tri(p + 1, p + cols, p + cols + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Point on the head surface (same shape as the head mesh): longitude phi (0 = front), unit-sphere height yu. */
function headSurface(phi: number, yu: number, cy: number, R: THREE.Vector3): THREE.Vector3 {
  const cl = Math.sqrt(Math.max(0, 1 - yu * yu));
  let x = cl * Math.sin(phi);
  let z = cl * Math.cos(phi);
  const below = Math.max(0, -yu);
  x *= 1 - 0.22 * below * below;
  z *= 1 - 0.08 * below * below;
  if (z > 0) z *= 0.86;
  return new THREE.Vector3(x * R.x, yu * R.y + cy, z * R.z + 0.012);
}

/**
 * 3D beard: a low-poly mass hugging the jaw, chin and lower cheeks. Its top edge stays
 * below the lower lip in front (and rises to the sideburns on the sides), so the photo's
 * eyes / nose / mouth stay visible. Rigid on the head bone.
 */
function addBeard3d(g: GeoBuilder, beard: { color: string; size?: number }, cy: number, R: THREE.Vector3) {
  const size = Math.min(1.6, Math.max(0.5, beard.size ?? 1));
  const k = R.x / 0.1;
  const col = new THREE.Color(beard.color);
  const NI = 5;
  const NJ = 12;
  const phiMax = THREE.MathUtils.degToRad(100);
  const centre = new THREE.Vector3(0, cy, 0.012);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  const P: THREE.Vector3[][] = [];
  for (let i = 0; i <= NI; i++) {
    const s = i / NI;
    const row: THREE.Vector3[] = [];
    for (let j = 0; j <= NJ; j++) {
      const phi = -phiMax + (2 * phiMax * j) / NJ;
      const side = Math.abs(Math.sin(phi));
      const top = -0.66 + 0.5 * Math.pow(side, 1.3);
      const yu = lerp(top, -0.97, s);
      const p = headSurface(phi, yu, cy, R);
      const nrm = new THREE.Vector3(p.x / (R.x * R.x), (p.y - cy) / (R.y * R.y), (p.z - 0.012) / (R.z * R.z)).normalize();
      const front = Math.abs(phi) < Math.PI / 2 ? Math.cos(phi) ** 2 : 0;
      const edge = 1 - smooth(0.62, 1, Math.abs(phi) / phiMax);
      const thick = size * 0.03 * k * smooth(0.05, 0.65, s) * edge * (0.55 + 0.45 * front);
      const drop = size * 0.06 * k * s * s * (0.25 + 0.75 * front) * edge;
      p.addScaledVector(nrm, thick + 0.007 * k * s * (hashNoise(i * 31 + j * 7) - 0.4));
      p.y -= drop;
      p.z += drop * 0.3 * front;
      row.push(p);
    }
    P.push(row);
  }
  const vary = (_p: THREE.Vector3, i: number) => col.clone().multiplyScalar(0.8 + 0.35 * hashNoise(i * 1.7));
  let geo = gridGeometry(P, (m) => m.clone().sub(centre));
  g.addGeometry(geo, [['head', 1]], vary);
  geo.dispose();
  // close the underside
  const last = P[NI];
  const c = last.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / last.length);
  c.y += 0.01 * k;
  geo = gridGeometry([last, last.map(() => c.clone())], () => new THREE.Vector3(0, -1, 0));
  g.addGeometry(geo, [['head', 1]], vary);
  geo.dispose();
}

/** Torso cross-section (rx, rz, cz) at height y, interpolated between rings sorted by y. */
function torsoAt(rings: Ring[], y: number): { rx: number; rz: number; cz: number } {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1].y < y) i++;
  const a = rings[i];
  const b = rings[i + 1];
  const t = clamp01((y - a.y) / (b.y - a.y));
  return { rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), cz: lerp(a.cz ?? 0, b.cz ?? 0, t) };
}

/* ---------------------------- web lines (bodysuit) ---------------------------- */

const WEB_W = 0.009;
const WEB_OFF = 0.0045;

/** Point on the polygonal ring of a tube (exactly on its facets) at angle `th`, pushed out along the normal. */
function ringPoint(r: Ring, th: number, segs: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const TAU = Math.PI * 2;
  const t = (((th % TAU) + TAU) % TAU) / TAU * segs;
  const s0 = Math.floor(t);
  const f = t - s0;
  const at = (s: number) => {
    const a = (s / segs) * TAU;
    return new THREE.Vector3((r.cx ?? 0) + r.rx * Math.cos(a), r.y, (r.cz ?? 0) + r.rz * Math.sin(a));
  };
  const p = at(s0).lerp(at(s0 + 1), f);
  const n = new THREE.Vector3(Math.cos(th) / Math.max(r.rx, 1e-3), 0, Math.sin(th) / Math.max(r.rz, 1e-3)).normalize();
  p.addScaledVector(n, WEB_OFF);
  return { p, n };
}

/** Thin line running along a tube (one point per ring) at each of the given angles. */
function webLines(g: GeoBuilder, rings: Ring[], segs: number, angles: number[], col: THREE.Color) {
  for (const th of angles) {
    const pts = rings.map((r) => ringPoint(r, th, segs));
    g.ribbon(
      pts.map((q) => q.p),
      pts.map((q) => q.n),
      rings.map((r) => r.w),
      WEB_W,
      col,
    );
  }
}

/** Thin line around a tube ring, from angle th0 to th1 (a full turn is closed). */
function webHoop(g: GeoBuilder, r: Ring, segs: number, th0: number, th1: number, col: THREE.Color) {
  const full = th1 - th0 >= Math.PI * 2 - 1e-6;
  const step = (Math.PI * 2) / segs;
  const ths: number[] = [];
  if (full) for (let s = 0; s < segs; s++) ths.push(th0 + s * step);
  else {
    ths.push(th0);
    for (let a = Math.ceil(th0 / step) * step; a < th1 - 1e-4; a += step) if (a > th0 + 1e-4) ths.push(a);
    ths.push(th1);
  }
  const pts = ths.map((th) => ringPoint(r, th, segs));
  g.ribbon(
    pts.map((q) => q.p),
    pts.map((q) => q.n),
    pts.map(() => r.w),
    WEB_W,
    col,
    full,
  );
}

/** Web lines over the back and sides of a masked head (the front is drawn in the face texture). */
function addMaskWeb(g: GeoBuilder, cy: number, R: THREE.Vector3, col: THREE.Color) {
  const w: Weights = [['head', 1]];
  const pointAt = (phi: number, yu: number) => {
    const p = headSurface(phi, yu, cy, R);
    const n = new THREE.Vector3(p.x / (R.x * R.x), (p.y - cy) / (R.y * R.y), (p.z - 0.012) / (R.z * R.z)).normalize();
    p.addScaledVector(n, 0.006);
    return { p, n };
  };
  const D = THREE.MathUtils.degToRad;
  // meridians from the crown down to the nape, around the sides and back
  for (let deg = 75; deg <= 285; deg += 30) {
    const pts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let i = 0; i <= 8; i++) pts.push(pointAt(D(deg), lerp(0.97, -0.88, i / 8)));
    g.ribbon(
      pts.map((q) => q.p),
      pts.map((q) => q.n),
      pts.map(() => w),
      WEB_W * 0.9,
      col,
    );
  }
  // a few rings across them
  for (const yu of [0.62, 0.15, -0.4]) {
    const pts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let deg = 70; deg <= 290; deg += 10) pts.push(pointAt(D(deg), yu));
    g.ribbon(
      pts.map((q) => q.p),
      pts.map((q) => q.n),
      pts.map(() => w),
      WEB_W * 0.9,
      col,
    );
  }
}

/** Gold chain lying around the neck base and down the chest, with a medallion or a whistle. Skinned to the chest. */
function addChain(g: GeoBuilder, torso: Ring[], wb: number, whistle: boolean) {
  const gold = new THREE.Color('#e8c040');
  const w: Weights = [['chest', 1]];
  const inside = (p: THREE.Vector3) => {
    const s = torsoAt(torso, p.y);
    return (p.x / s.rx) ** 2 + ((p.z - s.cz) / s.rz) ** 2 < 1;
  };
  const yBack = 1.505;
  const yFront = 1.385;
  const back = torsoAt(torso, yBack);
  const front = torsoAt(torso, yFront);
  const B = new THREE.Vector3(0, yBack, back.cz - back.rz - 0.012);
  const Fp = new THREE.Vector3(0, yFront, front.cz + front.rz + 0.013);
  const M = B.clone().add(Fp).multiplyScalar(0.5);
  const U = Fp.clone().sub(B).multiplyScalar(0.5);
  const halfW = 0.088 * Math.sqrt(wb);
  const pts: THREE.Vector3[] = [];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const p = M.clone().addScaledVector(U, Math.cos(a)).add(new THREE.Vector3(Math.sin(a) * halfW, 0, 0));
    // rest on the shoulders: lift points that sink into the torso
    if (inside(p)) {
      let lo = p.y;
      let hi = 1.6;
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (inside(new THREE.Vector3(p.x, mid, p.z))) lo = mid;
        else hi = mid;
      }
      p.y = hi + 0.01;
    }
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const radial = 3;
  const tube = new THREE.TubeGeometry(curve, 26, 0.0075, radial, true);
  // alternate bright / dark rings: reads as links
  g.addGeometry(tube, w, (_p, i) => gold.clone().multiplyScalar(Math.floor(i / (radial + 1)) % 2 ? 0.72 : 1.05));
  tube.dispose();

  const hang = Fp.clone().add(new THREE.Vector3(0, -0.026, 0.004));
  if (whistle) {
    const metal = new THREE.Color('#c8ccd4');
    const body = new THREE.BoxGeometry(0.044, 0.024, 0.026);
    body.translate(hang.x - 0.004, hang.y - 0.006, hang.z + 0.006);
    g.addGeometry(body, w, (_p, i) => metal.clone().multiplyScalar(i < 8 ? 1.1 : 0.85));
    body.dispose();
    const mouth = new THREE.BoxGeometry(0.024, 0.012, 0.016);
    mouth.translate(hang.x + 0.028, hang.y - 0.001, hang.z + 0.006);
    g.addGeometry(mouth, w, metal.clone().multiplyScalar(0.75));
    mouth.dispose();
  } else {
    const medal = new THREE.CylinderGeometry(0.022, 0.022, 0.008, 8);
    medal.rotateX(Math.PI / 2);
    medal.translate(hang.x, hang.y, hang.z);
    g.addGeometry(medal, w, (p) => (p.z > hang.z + 0.002 ? gold.clone().multiplyScalar(1.15) : gold.clone().multiplyScalar(0.7)));
    medal.dispose();
  }
}
