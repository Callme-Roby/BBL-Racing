import * as THREE from 'three';
import type { StageDef, StageEnv } from './types';
import {
  C,
  Kit,
  T,
  clamp,
  crack,
  groundGrid,
  mulC,
  noiseRect,
  px,
  skyDome,
  type GroundCell,
} from './kit';

/*
 * SKY DOJO — a square fighting platform high above a sea of clouds
 * (homage to the Tekken 3 sky stages).
 *
 *   platform (y = 0)    x ∈ [-16, 16], z ∈ [-12, 14], checkered 2 m tiles
 *   ring ropes on the 0.8 m border band, torii gate on the +Z side (entrance)
 *   lattice tower + white segmented column behind-left, rock pinnacles in the
 *   cloud sea (y = -16), snowy mountain ranges all around (r = 150..330).
 */

const PX = 16; // platform half width (x)
const PZ0 = -12; // platform far edge (z)
const PZ1 = 14; // platform near edge (z)
const TILE_X = 15; // checkered area half width
const TILE_Z0 = -11;
const TILE_Z1 = 13;
const SEA_Y = -16;

function build(): StageEnv {
  const kit = new Kit(0xd0c0, 'stage:dojo');
  const r = kit.rand;
  const I = new THREE.Matrix4();

  /* ---------------------------------------------------------------- */
  /* textures                                                         */
  /* ---------------------------------------------------------------- */
  const tileTex = kit.tex(64, 64, (ctx, w, h) => {
    const cells: [number, number, boolean][] = [
      [0, 0, true],
      [32, 0, false],
      [0, 32, false],
      [32, 32, true],
    ];
    for (const [tx, ty, dark] of cells) {
      noiseRect(ctx, tx, ty, 32, 32, r, dark ? 0x7c3418 : 0xd08c44, dark ? 12 : 16, 0.12);
      // marble veins
      for (let i = 0; i < 3; i++) {
        let x = tx + r() * 32;
        let y = ty + r() * 32;
        let d = r() * Math.PI * 2;
        for (let k = 0; k < 18; k++) {
          if (x >= tx && x < tx + 32 && y >= ty && y < ty + 32)
            px(ctx, x, y, w, h, dark ? 'rgba(40,14,6,0.45)' : 'rgba(150,80,30,0.4)');
          d += (r() - 0.5) * 0.9;
          x += Math.cos(d);
          y += Math.sin(d);
        }
      }
      // polished highlight bands (fake reflection of the sky)
      for (let j = 0; j < 32; j++)
        for (let i = 0; i < 32; i++) {
          const dd = i + j;
          if (Math.abs(dd - 22) < 4) px(ctx, tx + i, ty + j, w, h, dark ? 'rgba(255,200,170,0.10)' : 'rgba(255,248,230,0.20)');
          else if (Math.abs(dd - 34) < 2) px(ctx, tx + i, ty + j, w, h, dark ? 'rgba(255,200,170,0.06)' : 'rgba(255,248,230,0.12)');
        }
      // bevel + grout
      ctx.fillStyle = dark ? 'rgba(255,190,150,0.28)' : 'rgba(255,240,210,0.5)';
      ctx.fillRect(tx + 1, ty + 1, 30, 1);
      ctx.fillRect(tx + 1, ty + 1, 1, 30);
      ctx.fillStyle = 'rgba(30,8,0,0.45)';
      ctx.fillRect(tx + 1, ty + 30, 30, 1);
      ctx.fillRect(tx + 30, ty + 1, 1, 30);
      ctx.fillStyle = '#2a1408';
      ctx.fillRect(tx, ty, 32, 1);
      ctx.fillRect(tx, ty, 1, 32);
    }
  });

  const borderTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x4a2c20, 14, 0.1);
    for (let y = 0; y < h; y += 8) {
      ctx.fillStyle = '#20120a';
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = 'rgba(255,200,150,0.12)';
      ctx.fillRect(0, y + 1, w, 1);
    }
    for (let i = 0; i < 4; i++) crack(ctx, w, h, r, r() * w, r() * h, 8, 'rgba(20,10,4,0.4)', 0);
  });

  const trimTex = kit.tex(64, 16, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x9c2016, 12, 0.1);
    ctx.fillStyle = '#d8a838';
    ctx.fillRect(0, 1, w, 2);
    ctx.fillRect(0, h - 3, w, 2);
    ctx.fillStyle = '#3a0a06';
    ctx.fillRect(0, 0, w, 1);
    ctx.fillRect(0, h - 1, w, 1);
    // gold key (meander) pattern
    const key = ['#######.', '#.....#.', '#.###.#.', '#.#...#.', '#.#####.', '#.......', '########'];
    for (let x0 = 0; x0 < w; x0 += 8)
      key.forEach((row, j) => {
        for (let i = 0; i < 8; i++) if (row[i] === '#') px(ctx, x0 + i, 5 + j, w, h, '#e0b040');
      });
  });

  const cloudTex = kit.tex(64, 64, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0xb8cce4, 8, 0.05);
    for (let i = 0; i < 22; i++) {
      const cx = r() * w;
      const cy = r() * h;
      const rad = 5 + r() * 12;
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
          g.addColorStop(0, 'rgba(255,255,255,0.95)');
          g.addColorStop(0.6, 'rgba(240,246,255,0.6)');
          g.addColorStop(1, 'rgba(220,232,248,0)');
          ctx.fillStyle = g;
          ctx.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
        }
    }
  });

  /* ---------------------------------------------------------------- */
  /* batches                                                          */
  /* ---------------------------------------------------------------- */
  const tiles = kit.batch({ map: tileTex }, 'floor-tiles');
  const border = kit.batch({ map: borderTex }, 'floor-border');
  const trim = kit.batch({ map: trimTex }, 'platform-trim');
  const plain = kit.batch({}, 'plain');
  const rock = kit.batch({}, 'mountains');
  const steel = kit.batch({}, 'tower');

  /* ---------------------------------------------------------------- */
  /* sky                                                              */
  /* ---------------------------------------------------------------- */
  const FOG = 0xb9d3ee;
  const lightDir = new THREE.Vector3(0.45, 0.78, 0.48).normalize();
  skyDome(kit, {
    radius: 320,
    stops: [
      [-90, 0xd2e2f2],
      [-3, FOG],
      [0, FOG],
      [5, 0xa6cbf0],
      [14, 0x86b6ec],
      [28, 0x6098e0],
      [50, 0x417cd2],
      [90, 0x2d62c0],
    ],
    glow: { dir: lightDir, color: 0xfff8e8, amount: 0.7, power: 24 },
  });
  // sun disc (behind the gameplay camera, seen by orbit cams)
  {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lightDir.clone().negate());
    const m = new THREE.Matrix4().compose(lightDir.clone().multiplyScalar(300), q, new THREE.Vector3(1, 1, 1));
    const sun = kit.batch({ unlit: 1, fog: false }, 'sun');
    sun.renderOrder = -90;
    const g = new THREE.CircleGeometry(10, 16);
    sun.geo(m, g, { color: 0xfffef0 });
    g.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* platform                                                         */
  /* ---------------------------------------------------------------- */
  {
    const xs: number[] = [-PX];
    for (let x = -TILE_X; x <= TILE_X; x += 2) xs.push(x);
    xs.push(PX);
    const zs: number[] = [PZ0];
    for (let z = TILE_Z0; z <= TILE_Z1; z += 2) zs.push(z);
    zs.push(PZ1);
    // fake glossy reflection: the floor gets brighter / bluer towards the edges (grazing angles)
    const sheen = (x: number, z: number) => {
      const d = Math.max(Math.abs(x) / TILE_X, z < 0 ? -z / -TILE_Z0 : z / TILE_Z1);
      const k = clamp((d - 0.25) / 0.75, 0, 1);
      return new THREE.Color(1 + 0.1 * k, 1 + 0.14 * k, 1 + 0.26 * k);
    };
    const cTile: GroundCell = { b: tiles, y: 0, uv: (x, z) => [(x + 1) / 4, -(z + 1) / 4], color: sheen };
    const cBorder: GroundCell = { b: border, y: 0, tile: 2 };
    groundGrid(xs, zs, (x, z) => (Math.abs(x) < TILE_X && z > TILE_Z0 && z < TILE_Z1 ? cTile : cBorder));
    // slab sides with the lacquered trim + underside
    const D = 1.4;
    const side = (a: [number, number], b: [number, number]) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      trim.quad(I, [
        [a[0], -D, a[1]],
        [b[0], -D, b[1]],
        [b[0], 0, b[1]],
        [a[0], 0, a[1]],
      ], [0, 0, len / 2.4, 1]);
    };
    side([-PX, PZ1], [PX, PZ1]);
    side([PX, PZ1], [PX, PZ0]);
    side([PX, PZ0], [-PX, PZ0]);
    side([-PX, PZ0], [-PX, PZ1]);
    plain.quad(I, [
      [-PX, -D, PZ0],
      [PX, -D, PZ0],
      [PX, -D, PZ1],
      [-PX, -D, PZ1],
    ], [0, 0, 1, 1], 0x6a3a2a);
    // gold lip around the floor
    const lip = { color: 0xe0b048, bottom: 0x9a6a20 };
    plain.box(I, 0, 0, PZ0 + 0.06, PX * 2, 0.08, 0.12, lip);
    plain.box(I, 0, 0, PZ1 - 0.06, PX * 2, 0.08, 0.12, lip);
    plain.box(I, -PX + 0.06, 0, (PZ0 + PZ1) / 2, 0.12, 0.08, PZ1 - PZ0, lip);
    plain.box(I, PX - 0.06, 0, (PZ0 + PZ1) / 2, 0.12, 0.08, PZ1 - PZ0, lip);
    // support structure: four legs + ring beams disappearing into the clouds
    const legC = { color: 0x8a5040, bottom: 0x5a3a34 };
    for (const lx of [-11, 11])
      for (const lz of [-7, 9]) {
        plain.box(I, lx, -70, lz, 2.2, 70 - D, 2.2, { ...legC, skip: ['ny', 'py'] });
        plain.beam(I, [lx, -D - 0.5, lz], [lx * 1.38, -D - 0.5, lz * 1.25 + 1], 0.9, legC);
      }
    for (const y of [-9, -20]) {
      plain.box(I, 0, y, -7, 22, 0.9, 0.9, legC);
      plain.box(I, 0, y, 9, 22, 0.9, 0.9, legC);
      plain.box(I, -11, y, 1, 0.9, 0.9, 16, legC);
      plain.box(I, 11, y, 1, 0.9, 0.9, 16, legC);
    }
  }

  /* ---------------------------------------------------------------- */
  /* ring posts & ropes                                               */
  /* ---------------------------------------------------------------- */
  {
    const ex = PX - 0.45;
    const ez0 = PZ0 + 0.45;
    const ez1 = PZ1 - 0.45;
    const post = (x: number, z: number, corner: boolean) => {
      plain.box(I, x, 0, z, 0.26, 1.45, 0.26, { color: 0x9a9ca4, bottom: 0x4a4c54 });
      plain.box(I, x, 1.45, z, 0.34, 0.08, 0.34, { color: 0xe0b048 });
      if (corner) {
        // padded turnbuckle covers
        for (const y of [0.32, 0.72, 1.12]) plain.box(I, x, y, z, 0.36, 0.2, 0.36, { color: 0xc81e1e, bottom: 0x8a1010 });
      }
      plain.box(I, x, 0, z, 0.5, 0.12, 0.5, { color: 0x3a3a40 });
    };
    const postsX = [-ex, -5.2, 5.2, ex];
    const postsZ = [ez0, 0.5, ez1];
    for (const x of postsX) {
      post(x, ez0, Math.abs(x) === ex);
    }
    for (const x of [-ex, ex]) {
      post(x, 0.5, false);
      post(x, ez1, true);
    }
    // torii pillars replace the posts on the +Z side
    const ropeY = [0.42, 0.82, 1.22];
    const ropeC = [0xd02020, 0xf0f0f0, 0xd02020];
    const rope = (a: [number, number], b: [number, number]) =>
      ropeY.forEach((y, i) =>
        plain.beam(I, [a[0], y, a[1]], [b[0], y, b[1]], 0.06, { color: ropeC[i], bottom: mulC(ropeC[i], 0.7) }),
      );
    for (let i = 0; i < postsX.length - 1; i++) rope([postsX[i], ez0], [postsX[i + 1], ez0]);
    for (const x of [-ex, ex]) for (let i = 0; i < postsZ.length - 1; i++) rope([x, postsZ[i]], [x, postsZ[i + 1]]);
    rope([-ex, ez1], [-4.6, ez1]);
    rope([4.6, ez1], [ex, ez1]);

    // torii gate (entrance, +Z side)
    const ver = 0xe24a1e;
    const blk = 0x24201e;
    for (const sx of [-4.6, 4.6]) {
      plain.cyl(I, sx, 0, ez1, 0.28, 0.32, 6.6, 8, { color: ver, bottom: mulC(ver, 0.75) });
      plain.cyl(I, sx, 0, ez1, 0.42, 0.42, 0.5, 8, { color: blk });
    }
    plain.box(I, 0, 5.0, ez1, 11.2, 0.42, 0.36, { color: ver, skip: [] }); // nuki
    plain.box(I, 0, 6.35, ez1, 11.6, 0.4, 0.5, { color: ver, skip: [] }); // shimaki
    plain.box(I, 0, 6.75, ez1, 12.4, 0.36, 0.7, { color: blk, bottom: 0x3a3430, skip: [] }); // kasagi
    for (const s of [-1, 1])
      plain.hexa(T(s * 6.2, 6.75, ez1), [
        [-0.01 * s, 0, -0.35],
        [0.9 * s, 0.35, -0.35],
        [0.9 * s, 0.35, 0.35],
        [-0.01 * s, 0, 0.35],
        [-0.01 * s, 0.36, -0.35],
        [0.95 * s, 0.75, -0.35],
        [0.95 * s, 0.75, 0.35],
        [-0.01 * s, 0.36, 0.35],
      ].map(([x, y, z]) => (s < 0 ? ([x, y, -z] as const) : ([x, y, z] as const))), { color: blk, skip: [] });
    plain.box(I, 0, 5.42, ez1, 0.9, 0.93, 0.3, { color: blk, skip: [] }); // gakuzuka
    plain.box(I, 0, 5.55, ez1 - 0.17, 0.6, 0.6, 0.04, { color: 0xe0b048, skip: [] });
  }

  /* ---------------------------------------------------------------- */
  /* lattice tower + white segmented column (background, left)         */
  /* ---------------------------------------------------------------- */
  const towerTop = new THREE.Vector3();
  {
    const TX = -36;
    const TZ = -54;
    const y0 = SEA_Y - 12;
    const y1 = 44;
    const levels = 17;
    const half = (y: number) => 4.6 - ((y - y0) / (y1 - y0)) * 2.6;
    const orange = 0xe8742a;
    const red = 0xd23a1e;
    const white = 0xf0eee8;
    const m = T(TX, 0, TZ, 0.35);
    const corner = (y: number, i: number): [number, number, number] => {
      const h = half(y);
      const sx = i === 0 || i === 3 ? -1 : 1;
      const sz = i < 2 ? -1 : 1;
      return [sx * h, y, sz * h];
    };
    for (let l = 0; l < levels; l++) {
      const ya = y0 + ((y1 - y0) * l) / levels;
      const yb = y0 + ((y1 - y0) * (l + 1)) / levels;
      const col = l >= levels - 4 ? (l % 2 ? white : red) : l % 2 ? orange : red;
      const o = { color: col, bottom: mulC(col, 0.8) };
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        steel.beam(m, corner(ya, i), corner(yb, i), 0.55, o); // legs
        steel.beam(m, corner(yb, i), corner(yb, j), 0.3, o); // ring
        if (l % 2 === 0) steel.beam(m, corner(ya, i), corner(yb, j), 0.22, o); // zig-zag bracing
        else steel.beam(m, corner(ya, j), corner(yb, i), 0.22, o);
      }
    }
    // top deck + antenna
    steel.box(m, 0, y1, 0, 4.6, 0.5, 4.6, { color: white, skip: [] });
    steel.box(m, 0, y1 + 0.5, 0, 0.35, 9, 0.35, { color: red });
    towerTop.set(0, y1 + 9.8, 0).applyMatrix4(m);

    // segmented white column
    const CX = -25;
    const CZ = -64;
    const R = 1.8;
    let y = SEA_Y - 14;
    let k = 0;
    while (y < 30) {
      const hgt = 3.2;
      const c = k % 2 ? 0xf2f2ee : 0xd6dade;
      plain.cyl(I, CX, y, CZ, R, R, hgt, 10, { color: c, bottom: mulC(c, 0.85), open: true });
      plain.cyl(I, CX, y + hgt - 0.25, CZ, R + 0.12, R + 0.12, 0.25, 10, { color: 0x7a8088, open: true });
      y += hgt;
      k++;
    }
    plain.cyl(I, CX, y, CZ, R + 0.5, R + 0.5, 0.6, 10, { color: 0xd23a1e });
    plain.cyl(I, CX, y + 0.6, CZ, 0.4, R + 0.3, 1.6, 10, { color: 0xe8e4dc });
  }

  /* ---------------------------------------------------------------- */
  /* mountains, rock pinnacles, cloud sea                             */
  /* ---------------------------------------------------------------- */
  {
    const snow = C(0xf4f8ff);
    const range = (radii: readonly number[], seg: number, peak: (a: number) => number, capFrac: number, rockC: number) => {
      const jit = Array.from({ length: seg }, () => r());
      const rows = radii.length;
      const peakAt = (s: number) => {
        const a = ((s % seg) / seg) * Math.PI * 2;
        return peak(a) * (0.7 + 0.6 * jit[s % seg]);
      };
      const prof = [-60, 0.45, 1, 0.55, -60];
      const height = (s: number, row: number) => {
        const f = prof[Math.min(row, prof.length - 1)];
        return f < -1 ? f : peakAt(s) * f + (row === 1 ? 3 * jit[(s + 3) % seg] : 0);
      };
      const P = (s: number, row: number) => {
        const a = ((s % seg) / seg) * Math.PI * 2 + (row % 2) * (Math.PI / seg);
        const rad = radii[row] + (row === 2 ? (jit[(s + 7) % seg] - 0.5) * 28 : 0);
        return new THREE.Vector3(Math.cos(a) * rad, height(s, row), Math.sin(a) * rad);
      };
      const rockBase = C(rockC);
      // snow cap relative to each peak's own height
      const colorAt = (s: number, row: number, y: number) => {
        const pk = Math.max(peakAt(s), 1);
        const k = clamp((y - pk * (1 - capFrac)) / (pk * capFrac * 0.5), 0, 1);
        return rockBase.clone().multiplyScalar(0.85 + 0.3 * jit[(s + row * 5) % seg]).lerp(snow, k);
      };
      for (let s = 0; s < seg; s++)
        for (let row = 0; row < rows - 1; row++) {
          const ids: [number, number][] = [
            [s, row],
            [s + 1, row],
            [s + 1, row + 1],
            [s, row + 1],
          ];
          const p = ids.map(([a, b]) => P(a, b));
          const c = ids.map(([a, b], i) => colorAt(a, b, p[i].y));
          // winding: inner row → outer row faces up/inwards
          rock.tri(p[0], p[1], p[2], [0, 0, 0, 0, 0, 0], c[0], c[1], c[2]);
          rock.tri(p[0], p[2], p[3], [0, 0, 0, 0, 0, 0], c[0], c[2], c[3]);
        }
    };
    const peakNear = (a: number) =>
      12 + 18 * Math.pow(Math.abs(Math.sin(2.3 * a + 0.7)), 3) + 8 * Math.pow(Math.abs(Math.sin(5.7 * a + 1.3)), 2) + 3 * Math.abs(Math.sin(13 * a));
    const peakFar = (a: number) => 18 + 18 * Math.pow(Math.abs(Math.sin(1.6 * a + 2.1)), 2) + 8 * Math.pow(Math.abs(Math.sin(4.3 * a)), 2);
    range([150, 174, 198, 226, 255], 60, peakNear, 0.35, 0x46506a);
    range([250, 270, 292, 314, 334], 48, peakFar, 0.45, 0x5a6886);

    // rock pinnacles poking out of the clouds (karst style) with a pine tuft
    // [x, z, top y, radius]
    const pin: [number, number, number, number][] = [
      [48, -66, 0, 6],
      [58, -78, 9, 5],
      [-70, -92, 4, 7],
      [-84, -70, -6, 5],
      [-56, 68, 7, 6],
      [-44, 80, -4, 5],
      [72, 54, -3, 6],
      [118, -26, 6, 8],
      [104, -40, -5, 5],
      [-110, 16, 8, 7],
      [24, 106, 2, 7],
      [6, -126, -6, 8],
    ];
    for (const [x, z, top, rad] of pin) {
      // irregular rock pillar: jittered rings, strata bands, grassy cap with pines
      const N = 7;
      const RINGS = 5;
      const yb = SEA_Y - 25;
      const rings: THREE.Vector3[][] = [];
      let ox = 0;
      let oz = 0;
      for (let k = 0; k <= RINGS; k++) {
        const t = k / RINGS;
        const y = yb + (top - yb) * t;
        const rr = rad * (1.1 - 0.3 * t);
        const ring: THREE.Vector3[] = [];
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + k * 0.4;
          const rj = rr * (0.72 + 0.5 * r());
          ring.push(new THREE.Vector3(x + ox + Math.cos(a) * rj, y + (k > 0 && k < RINGS ? (r() - 0.5) * 2 : 0), z + oz + Math.sin(a) * rj));
        }
        rings.push(ring);
        ox += (r() - 0.5) * rad * 0.3;
        oz += (r() - 0.5) * rad * 0.3;
      }
      const rockLo = C(0x4e4840);
      const rockHi = C(0x8a7e6a);
      const moss = C(0x5a7040);
      const band = (k: number) =>
        rockLo
          .clone()
          .lerp(rockHi, clamp(k / RINGS, 0, 1))
          .lerp(moss, k >= RINGS - 1 ? 0.45 : 0)
          .multiplyScalar(k % 2 ? 0.86 : 1.04);
      for (let k = 0; k < RINGS; k++)
        for (let i = 0; i < N; i++) {
          const j = (i + 1) % N;
          const c0 = band(k);
          const c1 = band(k + 1);
          plain.quadW([rings[k][j], rings[k][i], rings[k + 1][i], rings[k + 1][j]], [0, 0, 1, 0, 1, 1, 0, 1], [c0, c0, c1, c1]);
        }
      const topRing = rings[RINGS];
      const centre = topRing.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(N);
      centre.y += 0.8;
      const grassC = C(0x5c7c3e);
      for (let i = 0; i < N; i++) plain.tri(topRing[(i + 1) % N], topRing[i], centre, [0, 0, 0, 0, 0, 0], grassC, grassC, grassC);
      for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
        const v = topRing[Math.floor(r() * N)].clone().lerp(centre, 0.4 + r() * 0.3);
        plain.cyl(I, v.x, v.y - 0.3, v.z, 0, 1.2 + r() * 1.2, 3 + r() * 3, 5, { color: 0x3c6a3a, bottom: 0x22422a });
      }
    }
  }

  // cloud sea: polar disc (moves slowly, texture repeats every 64 m)
  const seaB = kit.batch({ map: cloudTex }, 'cloud-sea');
  {
    const radii = [0, 40, 80, 130, 190, 260, 360];
    const seg = 24;
    const TILE = 64;
    const c = C(0xffffff);
    const P = (ri: number, s: number) => {
      const a = (s / seg) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radii[ri], SEA_Y, Math.sin(a) * radii[ri]);
    };
    for (let ri = 0; ri < radii.length - 1; ri++)
      for (let s = 0; s < seg; s++) {
        const p = [P(ri, s), P(ri, s + 1), P(ri + 1, s + 1), P(ri + 1, s)];
        const uv: number[] = [];
        for (const v of p) uv.push(v.x / TILE, -v.z / TILE);
        // faces up
        seaB.quadW(p, uv, [c, c, c, c]);
      }
  }
  const sea = kit.meshOf(seaB);

  // low-poly cloud puffs (instanced, drifting)
  const puffB = kit.batch({}, 'clouds');
  {
    const g = new THREE.SphereGeometry(1, 8, 5);
    const top = C(0xffffff);
    const bot = C(0xb4c6de);
    puffB.geo(I, g, { colorFn: (p) => bot.clone().lerp(top, clamp((p.y + 0.5) / 1.1, 0, 1)) });
    g.dispose();
  }
  interface Puff {
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    ry: number;
    speed: number;
  }
  const puffs: Puff[] = [];
  const cluster = (x: number, y: number, z: number, size: number, speed: number) => {
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++)
      puffs.push({
        x: x + (r() - 0.5) * size * 2.2,
        y: y + (r() - 0.3) * size * 0.4,
        z: z + (r() - 0.5) * size * 1.2,
        sx: size * (0.6 + r() * 0.6),
        sy: size * (0.28 + r() * 0.18),
        sz: size * (0.5 + r() * 0.4),
        ry: r() * Math.PI,
        speed,
      });
  };
  // below the platform (sea of clouds detail)
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = 30 + r() * 110;
    cluster(Math.cos(a) * d, SEA_Y + 2 + r() * 5, Math.sin(a) * d, 7 + r() * 6, 1.2 + r() * 0.8);
  }
  // mid-level, far enough in z so that drifting never crosses the platform
  for (let i = 0; i < 7; i++) {
    const s = i % 2 ? 1 : -1;
    cluster(-200 + r() * 400, -6 + r() * 14, s * (70 + r() * 110), 8 + r() * 8, 1.5 + r());
  }
  // high clouds
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = 100 + r() * 120;
    cluster(Math.cos(a) * d, 32 + r() * 28, Math.sin(a) * d, 12 + r() * 10, 2 + r());
  }
  const puffMesh = kit.instanced(puffB, puffs.length);

  // cranes gliding far away
  const birdB = kit.batch({ unlit: 1, color: 0xf4f4f0, side: THREE.DoubleSide }, 'cranes');
  {
    const c = C(0xffffff);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    birdB.tri(V(0, 0, 0.3), V(0, 0, -0.25), V(-1.3, 0.2, -0.15), [0, 0, 0, 0, 0, 0], c, c, c);
    birdB.tri(V(0, 0, -0.25), V(0, 0, 0.3), V(1.3, 0.2, -0.15), [0, 0, 0, 0, 0, 0], c, c, c);
    birdB.tri(V(-0.08, 0, 0.9), V(0.08, 0, 0.9), V(0, 0, -0.7), [0, 0, 0, 0, 0, 0], c, c, c);
  }
  const CRANES = 5;
  const cranes = kit.instanced(birdB, CRANES);

  // blinking light on the tower top
  const blinkB = kit.batch({ unlit: 1, color: 0xff2a1a }, 'tower-blink');
  blinkB.box(I, towerTop.x, towerTop.y - 0.6, towerTop.z, 1.0, 1.0, 1.0, { skip: [] });
  const blinkMat = blinkB.mat;

  kit.finish();

  /* ---------------------------------------------------------------- */
  /* animation                                                        */
  /* ---------------------------------------------------------------- */
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const WRAP = 260;
  const placePuffs = (t: number) => {
    puffs.forEach((p, i) => {
      let x = p.x + p.speed * t;
      x = ((((x + WRAP) % (2 * WRAP)) + 2 * WRAP) % (2 * WRAP)) - WRAP;
      const fade = clamp((WRAP - Math.abs(x)) / 40, 0, 1);
      tmpP.set(x, p.y, p.z);
      tmpQ.setFromEuler(tmpE.set(0, p.ry, 0));
      tmpS.set(p.sx * fade + 1e-3, p.sy * fade + 1e-3, p.sz * fade + 1e-3);
      tmpM.compose(tmpP, tmpQ, tmpS);
      puffMesh.setMatrixAt(i, tmpM);
    });
    puffMesh.instanceMatrix.needsUpdate = true;
  };
  placePuffs(0);
  const blinkOn = C(0xff2a1a);
  const blinkOff = C(0x401010);

  return {
    group: kit.group,
    clearColor: C(FOG),
    fogColor: C(FOG),
    fogNear: 60,
    fogFar: 380,
    lightDir,
    lightColor: new THREE.Color(0.7, 0.67, 0.6),
    ambient: new THREE.Color(0.5, 0.55, 0.66),
    update(t: number) {
      placePuffs(t);
      sea.position.x = (t * 0.8) % 64;
      for (let i = 0; i < CRANES; i++) {
        const a = t * 0.07 + (i / CRANES) * 0.5;
        tmpP.set(40 + Math.cos(a) * 70 + i * 2.5, 14 + Math.sin(t * 0.4 + i) * 1.2 + i * 0.6, -70 + Math.sin(a) * 40 - i * 3);
        tmpQ.setFromEuler(tmpE.set(0, -a, 0));
        const f = 0.35 + 0.65 * Math.abs(Math.sin(t * 2.2 + i * 0.7));
        tmpS.set(1.8, 1.8 * f * (Math.sin(t * 2.2 + i * 0.7) > 0 ? 1 : -1), 1.8);
        tmpM.compose(tmpP, tmpQ, tmpS);
        cranes.setMatrixAt(i, tmpM);
      }
      cranes.instanceMatrix.needsUpdate = true;
      (blinkMat.uniforms.uColor.value as THREE.Color).copy(t % 1.6 < 0.8 ? blinkOn : blinkOff);
    },
    dispose() {
      kit.dispose();
    },
  };
}

export const dojo: StageDef = {
  id: 'dojo',
  name: 'SKY DOJO',
  subtitle: 'Sommet des nuages',
  music: 'dojo',
  build,
};
