import * as THREE from 'three';
import {
  createPS1Material,
  makeCanvasTexture,
  type PS1Material,
  type PS1Options,
} from '../ps1Material';

/**
 * Small toolkit shared by the stage builders:
 *  - `Kit` owns every GPU resource created for a stage (so `dispose()` is trivial)
 *    and merges static geometry per material ("batches") into a single draw call.
 *  - `Batch` is a growing triangle soup (position / normal / uv / color) with
 *    helpers for boxes, tapered boxes, quads and arbitrary three.js geometries.
 *  - a few generic builders (sky dome, ground grid, hill ring) and 2D-canvas
 *    painting helpers for the procedural low-res textures.
 *
 * Note: never create THREE.Color from hex at module level — the game disables
 * colour management at startup, colours must be created inside build().
 */

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
/** [u0, v0, u1, v1] */
export type UVRect = readonly [number, number, number, number];
/** a number = world tiling (metres per texture repeat), a rect = explicit sub-rectangle */
export type UVSpec = number | UVRect;
export type V3 = readonly [number, number, number];
type ColorIn = THREE.ColorRepresentation;

export interface BoxOpts {
  /** colour of the top vertices (and of the whole box when `bottom` is not given) */
  color?: ColorIn;
  /** colour of the bottom vertices (fake AO / gradients) */
  bottom?: ColorIn;
  uv?: UVSpec;
  faceUV?: Partial<Record<Face, UVSpec>>;
  faceColor?: Partial<Record<Face, ColorIn>>;
  /** faces to skip (default: bottom face) */
  skip?: readonly Face[];
  /** only build these faces */
  only?: readonly Face[];
}

export interface GeoOpts {
  color?: ColorIn;
  /** gradient along the local Y of the geometry (bottom colour) */
  bottom?: ColorIn;
  uvMul?: readonly [number, number];
  uvAdd?: readonly [number, number];
  /** per-vertex colour from LOCAL position / normal (overrides color/bottom) */
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;
  /** use flat (per-triangle) normals */
  flat?: boolean;
}

/* ------------------------------------------------------------------------ */
/* misc helpers                                                             */
/* ------------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32) so a stage looks identical on every build. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function C(c: ColorIn): THREE.Color {
  return new THREE.Color(c);
}

export function lerpC(a: ColorIn, b: ColorIn, t: number): THREE.Color {
  return C(a).lerp(C(b), t);
}

export function mulC(a: ColorIn, k: number): THREE.Color {
  return C(a).multiplyScalar(k);
}

/** Transform: translate + rotate (yaw outermost, Euler order YXZ) + scale. */
export function T(
  x = 0,
  y = 0,
  z = 0,
  ry = 0,
  rx = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

/** a·b (matrix product) */
export function mul(a: THREE.Matrix4, b: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(a, b);
}

/** Polygon offset so a decal never fights with the surface below (PS1 snapping makes it worse). */
export function decal<M extends THREE.Material>(m: M, factor = -2, units = -4): M {
  m.polygonOffset = true;
  m.polygonOffsetFactor = factor;
  m.polygonOffsetUnits = units;
  return m;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/* ------------------------------------------------------------------------ */
/* Batch                                                                    */
/* ------------------------------------------------------------------------ */

const FACES: readonly (readonly [Face, number, number, number, number])[] = [
  ['pz', 3, 2, 6, 7],
  ['nz', 1, 0, 4, 5],
  ['px', 2, 1, 5, 6],
  ['nx', 0, 3, 7, 4],
  ['py', 7, 6, 5, 4],
  ['ny', 0, 1, 2, 3],
];
const DEFAULT_SKIP: readonly Face[] = ['ny'];
const FULL: UVRect = [0, 0, 1, 1];

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _bt = new THREE.Vector3();

function worldUV(p: readonly THREE.Vector3[], tile: number): number[] {
  _e1.subVectors(p[2], p[0]);
  _e2.subVectors(p[3], p[1]);
  _n.crossVectors(_e1, _e2).normalize();
  _t.subVectors(p[1], p[0]);
  if (_t.lengthSq() < 1e-10) _t.subVectors(p[2], p[3]);
  _t.normalize();
  _bt.crossVectors(_n, _t);
  const out: number[] = [];
  for (const v of p) out.push(v.dot(_t) / tile, v.dot(_bt) / tile);
  return out;
}

function rectUV(r: UVRect): number[] {
  return [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];
}

export class Batch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uvs: number[] = [];
  private readonly cols: number[] = [];
  renderOrder = 0;
  consumed = false;

  constructor(
    readonly mat: PS1Material,
    readonly parent: THREE.Object3D,
    readonly name: string,
  ) {}

  get tris(): number {
    return this.pos.length / 9;
  }

  private vtx(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.cols.push(c.r, c.g, c.b);
  }

  /** World-space triangle (CCW = front). Flat normal unless `ns` is given. */
  tri(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    uv: readonly number[],
    ca: THREE.Color,
    cb: THREE.Color,
    cc: THREE.Color,
    ns?: readonly THREE.Vector3[],
  ): void {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _n.crossVectors(_e1, _e2);
    const l = _n.length();
    if (l < 1e-9) return;
    _n.divideScalar(l);
    this.vtx(a, ns ? ns[0] : _n, uv[0], uv[1], ca);
    this.vtx(b, ns ? ns[1] : _n, uv[2], uv[3], cb);
    this.vtx(c, ns ? ns[2] : _n, uv[4], uv[5], cc);
  }

  /** World-space quad: corners BL, BR, TR, TL (CCW seen from the front). */
  quadW(p: readonly THREE.Vector3[], uv: readonly number[], c: readonly THREE.Color[]): void {
    this.tri(p[0], p[1], p[2], [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]], c[0], c[1], c[2]);
    this.tri(p[0], p[2], p[3], [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]], c[0], c[2], c[3]);
  }

  /** Local-space quad transformed by m. */
  quad(
    m: THREE.Matrix4,
    corners: readonly V3[],
    uv: UVSpec = FULL,
    color: ColorIn = 0xffffff,
    bottom?: ColorIn,
  ): void {
    const p = corners.map((v) => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m));
    const top = C(color);
    const bot = bottom !== undefined ? C(bottom) : top;
    this.quadW(p, typeof uv === 'number' ? worldUV(p, uv) : rectUV(uv), [bot, bot, top, top]);
  }

  /** Hexahedron from 8 local corners: bottom (x0z0, x1z0, x1z1, x0z1) then top (same order). */
  hexa(m: THREE.Matrix4, c: readonly V3[], o: BoxOpts = {}): void {
    const w = c.map((v) => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m));
    const top = C(o.color ?? 0xffffff);
    const bottom = o.bottom !== undefined ? C(o.bottom) : top;
    for (const [f, i0, i1, i2, i3] of FACES) {
      if (o.only ? !o.only.includes(f) : (o.skip ?? DEFAULT_SKIP).includes(f)) continue;
      const p = [w[i0], w[i1], w[i2], w[i3]];
      const spec = o.faceUV?.[f] ?? o.uv ?? FULL;
      const uv = typeof spec === 'number' ? worldUV(p, spec) : rectUV(spec);
      const fc = o.faceColor?.[f];
      let cb: THREE.Color;
      let ct: THREE.Color;
      if (fc !== undefined) {
        cb = ct = C(fc);
      } else if (f === 'py') {
        cb = ct = top;
      } else if (f === 'ny') {
        cb = ct = bottom;
      } else {
        cb = bottom;
        ct = top;
      }
      this.quadW(p, uv, [cb, cb, ct, ct]);
    }
  }

  /** Axis-aligned (in local space) box: centre-bottom at (cx, y0, cz), size w (x) × h (y) × d (z). */
  box(m: THREE.Matrix4, cx: number, y0: number, cz: number, w: number, h: number, d: number, o: BoxOpts = {}): void {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const y1 = y0 + h;
    this.hexa(
      m,
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      o,
    );
  }

  /** Square beam (t × t section) between two local points; end caps skipped. */
  beam(m: THREE.Matrix4, a: V3, b: V3, t: number, o: BoxOpts = {}): void {
    const A = new THREE.Vector3(a[0], a[1], a[2]);
    const dir = new THREE.Vector3(b[0], b[1], b[2]).sub(A);
    const len = dir.length();
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len));
    const local = new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1));
    this.box(new THREE.Matrix4().multiplyMatrices(m, local), 0, 0, 0, t, len, t, { skip: ['ny', 'py'], ...o });
  }

  /** Append an arbitrary three.js geometry (indexed or not), transformed by m. */
  geo(m: THREE.Matrix4, g: THREE.BufferGeometry, o: GeoOpts = {}): void {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    const hY = bb.max.y - bb.min.y || 1;
    const top = C(o.color ?? 0xffffff);
    const bot = o.bottom !== undefined ? C(o.bottom) : top;
    const um = o.uvMul ?? [1, 1];
    const ua = o.uvAdd ?? [0, 0];
    const count = idx ? idx.count : pos.count;
    const lp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const ln = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const wp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const wn = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const cs = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
    const uvs = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const id = idx ? idx.getX(i + k) : i + k;
        lp[k].fromBufferAttribute(pos as THREE.BufferAttribute, id);
        if (nor) ln[k].fromBufferAttribute(nor as THREE.BufferAttribute, id);
        else ln[k].set(0, 1, 0);
        wp[k].copy(lp[k]).applyMatrix4(m);
        wn[k].copy(ln[k]).applyMatrix3(nm).normalize();
        if (o.colorFn) cs[k].copy(o.colorFn(lp[k], ln[k]));
        else cs[k].copy(bot).lerp(top, (lp[k].y - bb.min.y) / hY);
        uvs[k * 2] = uv ? uv.getX(id) * um[0] + ua[0] : 0;
        uvs[k * 2 + 1] = uv ? uv.getY(id) * um[1] + ua[1] : 0;
      }
      this.tri(wp[0], wp[1], wp[2], uvs, cs[0], cs[1], cs[2], o.flat || !nor ? undefined : wn);
    }
  }

  /** Cylinder / cone standing on (x, y0, z) in local space. */
  cyl(
    m: THREE.Matrix4,
    x: number,
    y0: number,
    z: number,
    rTop: number,
    rBot: number,
    h: number,
    seg: number,
    o: GeoOpts & { open?: boolean } = {},
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, o.open ?? false);
    g.translate(x, y0 + h / 2, z);
    this.geo(m, g, o);
    g.dispose();
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.mat.vertexColors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.cols, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/* ------------------------------------------------------------------------ */
/* Kit                                                                      */
/* ------------------------------------------------------------------------ */

function isMaterial(m: unknown): m is PS1Material {
  return !!m && (m as THREE.Material).isMaterial === true;
}

export class Kit {
  readonly group = new THREE.Group();
  readonly rand: () => number;
  private readonly owned: { dispose(): void }[] = [];
  private readonly batches: Batch[] = [];

  constructor(seed: number, name = 'stage') {
    this.rand = rng(seed);
    this.group.name = name;
  }

  /** random in [a, b) */
  rr(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rand() * arr.length) % arr.length];
  }

  own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  tex(
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    repeat = true,
  ): THREE.CanvasTexture {
    return this.own(makeCanvasTexture(w, h, draw, repeat));
  }

  /** options applied to every material of this kit (e.g. affine: false for race tracks) */
  defaults: Partial<PS1Options> = {};

  mat(o: PS1Options): PS1Material {
    return this.own(createPS1Material({ ...this.defaults, ...o }));
  }

  /** New merge batch. Options default to vertexColors: true. */
  batch(m: PS1Material | PS1Options, name = '', parent: THREE.Object3D = this.group): Batch {
    const mat = isMaterial(m) ? m : this.mat({ vertexColors: true, ...m });
    const b = new Batch(mat, parent, name);
    this.batches.push(b);
    return b;
  }

  /** Turn a batch into a standalone (owned) geometry; the batch is not merged by finish(). */
  geometryOf(b: Batch): THREE.BufferGeometry {
    b.consumed = true;
    return this.own(b.toGeometry());
  }

  /** Build a batch now as its own mesh (for animated parts). */
  meshOf(b: Batch, parent: THREE.Object3D = b.parent): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometryOf(b), b.mat);
    mesh.name = b.name;
    mesh.renderOrder = b.renderOrder;
    parent.add(mesh);
    return mesh;
  }

  instanced(b: Batch, count: number, parent: THREE.Object3D = b.parent): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(this.geometryOf(b), b.mat, count);
    im.frustumCulled = false;
    im.name = b.name;
    im.renderOrder = b.renderOrder;
    this.own(im);
    parent.add(im);
    return im;
  }

  /** Line segments (pairs of points) drawn with a PS1 material. */
  lines(pts: readonly number[], mat: PS1Material, parent: THREE.Object3D = this.group): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    const n = pts.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts as number[], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(n * 2).fill(0), 2));
    if (mat.vertexColors) g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
    g.computeBoundingSphere();
    this.own(g);
    const l = new THREE.LineSegments(g, mat);
    parent.add(l);
    return l;
  }

  /** Merge every pending batch into one mesh per batch. */
  finish(): void {
    for (const b of this.batches) {
      if (b.consumed || b.tris === 0) continue;
      this.meshOf(b);
    }
  }

  dispose(): void {
    for (const o of this.owned.splice(0)) o.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/* ------------------------------------------------------------------------ */
/* Generic builders                                                         */
/* ------------------------------------------------------------------------ */

/** Sorted grid lines between min and max through every breakpoint, subdivided so that
 * the spacing never exceeds step(distance-to-origin). */
export function gridLines(
  min: number,
  max: number,
  breaks: readonly number[],
  step: (d: number) => number,
): number[] {
  const pts = [...new Set([min, max, ...breaks.filter((b) => b > min && b < max)])].sort((a, b) => a - b);
  const out: number[] = [pts[0]];
  const rec = (a: number, b: number): void => {
    const d = a <= 0 && b >= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b));
    if (b - a > step(d) * 1.001) {
      const m = (a + b) / 2;
      rec(a, m);
      rec(m, b);
    } else out.push(b);
  };
  for (let i = 0; i < pts.length - 1; i++) rec(pts[i], pts[i + 1]);
  return out;
}

export interface GroundCell {
  b: Batch;
  y: number;
  /** world tiling of the texture (metres) — ignored if uv is given */
  tile?: number;
  uv?: (x: number, z: number) => readonly [number, number];
  color?: ColorIn | ((x: number, z: number) => THREE.Color);
  /** batch used for the vertical faces towards lower neighbours (curbs) */
  side?: Batch;
  sideTile?: number;
  sideColor?: ColorIn;
}

/** Height-classified ground grid; vertical "curb" faces are generated between cells of different heights. */
export function groundGrid(
  xs: readonly number[],
  zs: readonly number[],
  classify: (cx: number, cz: number) => GroundCell | null,
): void {
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  const cells: (GroundCell | null)[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) cells.push(classify((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2));
  const cell = (i: number, j: number): GroundCell | null =>
    i < 0 || j < 0 || i >= nx || j >= nz ? null : cells[j * nx + i];
  const colAt = (c: GroundCell, x: number, z: number): THREE.Color =>
    typeof c.color === 'function' ? c.color(x, z) : C(c.color ?? 0xffffff);
  const uvAt = (c: GroundCell, x: number, z: number): readonly [number, number] =>
    c.uv ? c.uv(x, z) : [x / (c.tile ?? 4), -z / (c.tile ?? 4)];
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = cell(i, j);
      if (!c) continue;
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const z0 = zs[j];
      const z1 = zs[j + 1];
      const y = c.y;
      const corners: [number, number][] = [
        [x0, z1],
        [x1, z1],
        [x1, z0],
        [x0, z0],
      ];
      const uv: number[] = [];
      for (const [x, z] of corners) uv.push(...uvAt(c, x, z));
      c.b.quadW(
        corners.map(([x, z]) => V(x, y, z)),
        uv,
        corners.map(([x, z]) => colAt(c, x, z)),
      );
      // vertical faces towards +x and +z neighbours (whichever is lower gets the face)
      const right = cell(i + 1, j);
      if (right && right.y !== y) {
        const hi = right.y > y ? right : c;
        const lo = Math.min(y, right.y);
        const top = Math.max(y, right.y);
        const x = x1;
        const pts =
          hi === c
            ? [V(x, lo, z1), V(x, lo, z0), V(x, top, z0), V(x, top, z1)] // faces +x
            : [V(x, lo, z0), V(x, lo, z1), V(x, top, z1), V(x, top, z0)]; // faces -x
        const sc = C(hi.sideColor ?? (typeof hi.color === 'function' || hi.color === undefined ? 0xffffff : hi.color));
        (hi.side ?? hi.b).quadW(pts, worldUV(pts, hi.sideTile ?? 1), [sc, sc, sc, sc]);
      }
      const front = cell(i, j + 1);
      if (front && front.y !== y) {
        const hi = front.y > y ? front : c;
        const lo = Math.min(y, front.y);
        const top = Math.max(y, front.y);
        const z = z1;
        const pts =
          hi === c
            ? [V(x0, lo, z), V(x1, lo, z), V(x1, top, z), V(x0, top, z)] // faces +z
            : [V(x1, lo, z), V(x0, lo, z), V(x0, top, z), V(x1, top, z)]; // faces -z
        const sc = C(hi.sideColor ?? (typeof hi.color === 'function' || hi.color === undefined ? 0xffffff : hi.color));
        (hi.side ?? hi.b).quadW(pts, worldUV(pts, hi.sideTile ?? 1), [sc, sc, sc, sc]);
      }
    }
  }
}

/** Subdivided horizontal rectangle (local space, transformed by m), world-tiled uv. */
export function patch(
  b: Batch,
  m: THREE.Matrix4,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  o: { tile?: number; step?: number; color?: ColorIn | ((x: number, z: number) => THREE.Color); uvRot?: boolean } = {},
): void {
  const step = o.step ?? 2.5;
  const nx = Math.max(1, Math.ceil((x1 - x0) / step - 1e-6));
  const nz = Math.max(1, Math.ceil((z1 - z0) / step - 1e-6));
  const tile = o.tile ?? 4;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + ((x1 - x0) * i) / nx;
      const bx = x0 + ((x1 - x0) * (i + 1)) / nx;
      const az = z0 + ((z1 - z0) * j) / nz;
      const bz = z0 + ((z1 - z0) * (j + 1)) / nz;
      const loc: [number, number][] = [
        [ax, bz],
        [bx, bz],
        [bx, az],
        [ax, az],
      ];
      const p = loc.map(([x, z]) => new THREE.Vector3(x, y, z).applyMatrix4(m));
      const uv: number[] = [];
      for (const v of p) {
        if (o.uvRot) uv.push(-v.z / tile, v.x / tile);
        else uv.push(v.x / tile, -v.z / tile);
      }
      const cols = p.map((v) =>
        typeof o.color === 'function' ? o.color(v.x, v.z) : C(o.color ?? 0xffffff),
      );
      b.quadW(p, uv, cols);
    }
  }
}

export interface SkyOpts {
  radius?: number;
  seg?: number;
  /** [elevation in degrees, colour] sorted by elevation */
  stops: readonly (readonly [number, number])[];
  glow?: { dir: THREE.Vector3; color: number; amount: number; power: number };
  /** extra per-vertex tint (e.g. city light pollution towards a direction) */
  tint?: (dir: THREE.Vector3, c: THREE.Color) => void;
}

/** Vertex-coloured gradient sky dome (unlit, no fog, back faces), centred on the origin. */
export function skyDome(kit: Kit, o: SkyOpts): Batch {
  const b = kit.batch({ unlit: 1, fog: false, side: THREE.BackSide, depthWrite: false }, 'sky');
  b.renderOrder = -100;
  const R = o.radius ?? 300;
  const seg = o.seg ?? 24;
  const elev = new Set<number>([-90, 90]);
  for (const [e] of o.stops) elev.add(e);
  for (let e = 15; e < 90; e += 15) elev.add(e);
  const rings = [...elev].sort((a, b2) => a - b2);
  const stops = o.stops.map(([e, c]) => [e, C(c)] as const);
  const gradient = (e: number): THREE.Color => {
    if (e <= stops[0][0]) return stops[0][1].clone();
    for (let i = 0; i < stops.length - 1; i++) {
      const [e0, c0] = stops[i];
      const [e1, c1] = stops[i + 1];
      if (e <= e1) return c0.clone().lerp(c1, (e - e0) / (e1 - e0 || 1));
    }
    return stops[stops.length - 1][1].clone();
  };
  const glowC = o.glow ? C(o.glow.color) : null;
  const point = (aDeg: number, eDeg: number): [THREE.Vector3, THREE.Color] => {
    const a = (aDeg * Math.PI) / 180;
    const e = (eDeg * Math.PI) / 180;
    const d = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    const c = gradient(eDeg);
    if (o.glow && glowC) {
      const k = Math.pow(Math.max(0, d.dot(o.glow.dir)), o.glow.power) * o.glow.amount;
      c.lerp(glowC, clamp(k, 0, 1));
    }
    if (o.tint) o.tint(d, c);
    return [d.multiplyScalar(R), c];
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * 360;
      const a1 = ((s + 1) / seg) * 360;
      const [p00, c00] = point(a0, rings[r]);
      const [p10, c10] = point(a1, rings[r]);
      const [p11, c11] = point(a1, rings[r + 1]);
      const [p01, c01] = point(a0, rings[r + 1]);
      // outward-facing winding, rendered with BackSide
      b.tri(p00, p01, p11, [0, 0, 0, 0, 0, 0], c00, c01, c11);
      b.tri(p00, p11, p10, [0, 0, 0, 0, 0, 0], c00, c11, c10);
    }
  }
  return b;
}

/** Inward-facing vertical band (distant hills / skyline silhouettes). */
export function hillRing(
  b: Batch,
  o: {
    radius: number;
    seg: number;
    base: number;
    height: (a: number) => number;
    top: ColorIn;
    bottom: ColorIn;
    from?: number;
    to?: number;
  },
): void {
  const from = o.from ?? 0;
  const to = o.to ?? Math.PI * 2;
  const top = C(o.top);
  const bot = C(o.bottom);
  for (let s = 0; s < o.seg; s++) {
    const a0 = from + ((to - from) * s) / o.seg;
    const a1 = from + ((to - from) * (s + 1)) / o.seg;
    const h0 = o.height(a0);
    const h1 = o.height(a1);
    const P = (a: number, y: number) => new THREE.Vector3(Math.cos(a) * o.radius, y, Math.sin(a) * o.radius);
    b.quadW([P(a0, o.base), P(a1, o.base), P(a1, h1), P(a0, h0)], [0, 0, 1, 0, 1, 1, 0, 1], [bot, bot, top, top]);
  }
}

/* ------------------------------------------------------------------------ */
/* 2D canvas painting helpers                                               */
/* ------------------------------------------------------------------------ */

export function rgbOf(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function css(hex: number, a = 1): string {
  const [r, g, b] = rgbOf(hex);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Shade a hex colour by k (multiplicative), returns css. */
export function shade(hex: number, k: number, a = 1): string {
  const [r, g, b] = rgbOf(hex);
  const f = (v: number) => Math.round(clamp(v * k, 0, 255));
  return a >= 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

/** Fill a rect with a base colour + per-pixel luminance noise (and a bit of chroma noise). */
export function noiseRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
  hex: number,
  amp: number,
  chroma = 0.25,
): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const [r, g, b] = rgbOf(hex);
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * amp;
    d[i * 4] = clamp(r + n + (rand() - 0.5) * amp * chroma, 0, 255);
    d[i * 4 + 1] = clamp(g + n + (rand() - 0.5) * amp * chroma, 0, 255);
    d[i * 4 + 2] = clamp(b + n + (rand() - 0.5) * amp * chroma, 0, 255);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, x, y);
}

/** Wrapping pixel (for tileable textures). */
export function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(((Math.round(x) % w) + w) % w, ((Math.round(y) % h) + h) % h, 1, 1);
}

/** Random-walk crack (wrapping). */
export function crack(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  x: number,
  y: number,
  len: number,
  fill: string,
  dir = rand() * Math.PI * 2,
): void {
  for (let i = 0; i < len; i++) {
    px(ctx, x, y, w, h, fill);
    dir += (rand() - 0.5) * 1.2;
    x += Math.cos(dir);
    y += Math.sin(dir);
    if (rand() < 0.08) crack(ctx, w, h, rand, x, y, Math.floor(len / 3), fill, dir + (rand() < 0.5 ? 1 : -1));
  }
}

/** Soft blob (wrapping) — stains, patches. */
export function blob(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  density = 0.7,
): void {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y) / r;
      if (d <= 1 && rand() < density * (1 - d * d * 0.7)) px(ctx, cx + x, cy + y, w, h, fill);
    }
}

/** Radial gradient sprite: white centre → transparent (for glows / light pools / shadows). */
export function radialSprite(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  inner: string,
  outer: string,
  mid?: string,
): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, inner);
  if (mid) g.addColorStop(0.45, mid);
  g.addColorStop(1, outer);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
