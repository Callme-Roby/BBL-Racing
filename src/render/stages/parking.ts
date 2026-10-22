import * as THREE from 'three';
import type { StageDef, StageEnv } from './types';
import {
  C,
  Kit,
  T,
  blob,
  clamp,
  crack,
  decal,
  gridLines,
  groundGrid,
  lerpC,
  mulC,
  noiseRect,
  px,
  radialSprite,
  skyDome,
  type GroundCell,
} from './kit';
import { addCar, carTexture } from './props';
import type { PS1Material } from '../ps1Material';

/*
 * NEON PARKING — rooftop level of a downtown parking garage at midnight.
 *
 *   deck (y = 0)          x ∈ [-34, 34], z ∈ [-21, 23], parapet walls all around
 *   far bays              z ∈ [-15, -9.5]   (cars nose-in)
 *   aisle / fight lane    z ∈ [-9.5, 9.5]
 *   near bays             z ∈ [9.5, 15]
 *   walkways (+0.15 m)    z ∈ [-21, -15] (half covered by a concrete canopy), z ∈ [15, 23]
 *   city blocks from |x| > 56 / z < -42 / z > 44, street level y = -24.
 */

const DX = 34;
const DZ0 = -21;
const DZ1 = 23;
const BAY0 = -15;
const AISLE0 = -9.5;
const AISLE1 = 9.5;
const BAY1 = 15;
const BAY_W = 2.6;
const STREET_Y = -24;
const CURB = 0.15;

function build(): StageEnv {
  const kit = new Kit(0x9a4c, 'stage:parking');
  const r = kit.rand;
  const I = new THREE.Matrix4();

  /* ---------------------------------------------------------------- */
  /* textures                                                         */
  /* ---------------------------------------------------------------- */
  const vRow = (z: number) => Math.round((1 - (z - AISLE0) / (AISLE1 - AISLE0)) * 128);
  const aisleTex = kit.tex(128, 128, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x3a3840, 18, 0.15);
    for (let i = 0; i < 8; i++) crack(ctx, w, h, r, r() * w, r() * h, 8 + r() * 14, 'rgba(14,12,18,0.55)');
    for (let i = 0; i < 10; i++) blob(ctx, w, h, r, r() * w, r() * h, 2 + r() * 5, 'rgba(8,8,14,0.35)', 0.6);
    // tyre skid marks
    ctx.strokeStyle = 'rgba(10,10,14,0.45)';
    ctx.lineWidth = 1;
    for (const [cx, cz, rad] of [
      [40, 3.5, 18],
      [96, -4.5, 12],
    ] as const) {
      for (const dr of [0, 4]) {
        ctx.beginPath();
        ctx.ellipse(cx, vRow(cz), rad + dr, (rad + dr) * 0.55, -0.2, 0.3, Math.PI * 1.5);
        ctx.stroke();
      }
    }
    // dashed yellow centre line (z = 0)
    for (let x = 0; x < w; x++) if (x % 24 < 14 && r() > 0.12) {
      px(ctx, x, vRow(0) - 1, w, h, '#c8a838');
      px(ctx, x, vRow(0), w, h, '#b8982e');
    }
    // lane arrows
    const arrow = (cx: number, cz: number, dir: 1 | -1) => {
      const y = vRow(cz);
      ctx.fillStyle = 'rgba(220,220,214,0.85)';
      ctx.fillRect(cx - 10 * dir, y - 1, 12 * dir, 2);
      for (let i = 0; i < 6; i++) ctx.fillRect(cx + (2 - i) * dir, y - i, 1, i * 2 + 1);
    };
    arrow(30, 4.6, 1);
    arrow(94, -4.6, -1);
  });

  const bayTex = kit.tex(32, 64, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x38363e, 18, 0.15);
    for (let i = 0; i < 3; i++) blob(ctx, w, h, r, 8 + r() * 16, 12 + r() * 40, 2 + r() * 4, 'rgba(8,8,12,0.4)', 0.6);
    crack(ctx, w, h, r, r() * w, r() * h, 10, 'rgba(14,12,18,0.5)');
    // separating line (left edge) and end line (top = far end)
    for (let y = 0; y < h; y++) {
      if (r() > 0.1) px(ctx, 0, y, w, h, '#d8d8d0');
      if (r() > 0.1) px(ctx, 1, y, w, h, '#c4c4bc');
    }
    for (let x = 0; x < w; x++) if (r() > 0.15) px(ctx, x, 1, w, h, '#c8c8c0');
  });

  const concreteTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x8a8890, 14, 0.08);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(40,36,44,0.18)';
      ctx.fillRect(Math.floor(r() * w), 0, 1, h);
    }
    ctx.fillStyle = 'rgba(30,28,34,0.5)';
    ctx.fillRect(0, 0, w, 1);
    ctx.fillRect(0, 0, 1, h);
    for (let i = 0; i < 3; i++) crack(ctx, w, h, r, r() * w, r() * h, 8, 'rgba(40,36,44,0.5)');
  });

  const hazardTex = kit.tex(16, 16, (ctx, w, h) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) px(ctx, x, y, w, h, (x + y) % 8 < 4 ? '#e8b818' : '#18161a');
  });

  // city windows: 16 columns (3 m) × 32 floors (3.5 m) — u tile 48 m, v tile 112 m
  const windowTex = kit.tex(128, 128, (ctx) => {
    ctx.fillStyle = '#12141e';
    ctx.fillRect(0, 0, 128, 128);
    const lit = ['#ffd890', '#ffe8b0', '#e8f0ff', '#a8e0ff', '#ffb070'];
    for (let row = 1; row < 32; row++) {
      const dark = r() < 0.12;
      const density = 0.15 + r() * 0.4;
      for (let col = 0; col < 16; col++) {
        const x = col * 8 + 1;
        const y = row * 4 + 1;
        const on = !dark && r() < density;
        ctx.fillStyle = on ? lit[Math.floor(r() * lit.length)] : r() < 0.5 ? '#1c2234' : '#232a3e';
        ctx.fillRect(x, y, 6, 2);
        if (on && r() < 0.3) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(x + Math.floor(r() * 4), y, 2, 2);
        }
      }
    }
    // roof strip (row 0) stays solid dark — used for roof tops
    ctx.fillStyle = '#0c0d14';
    ctx.fillRect(0, 0, 128, 4);
  });

  const glowTex = kit.tex(32, 32, (ctx, w, h) => radialSprite(ctx, w, h, '#ffffff', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.4)'), false);

  const neonTex = (text: string, hex: string, w = 128, h = 48, font = 34) =>
    kit.tex(
      w,
      h,
      (ctx) => {
        ctx.clearRect(0, 0, w, h);
        ctx.font = `bold ${font}px "DejaVu Sans", "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = hex;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 3;
        ctx.strokeStyle = hex;
        ctx.strokeText(text, w / 2, h / 2 + 2);
        ctx.shadowBlur = 4;
        ctx.strokeText(text, w / 2, h / 2 + 2);
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(text, w / 2, h / 2 + 2);
        // border tube
        ctx.shadowBlur = 6;
        ctx.strokeStyle = hex;
        ctx.lineWidth = 2;
        ctx.strokeRect(3, 3, w - 6, h - 6);
      },
      false,
    );

  /* ---------------------------------------------------------------- */
  /* batches                                                          */
  /* ---------------------------------------------------------------- */
  const aisle = kit.batch({ map: aisleTex }, 'aisle');
  const bays = kit.batch({ map: bayTex }, 'bays');
  const concrete = kit.batch({ map: concreteTex }, 'concrete');
  const hazard = kit.batch({ map: hazardTex }, 'hazard');
  const plain = kit.batch({}, 'plain');
  const carBody = kit.batch({ map: carTexture(kit) }, 'cars');
  const city = kit.batch({ map: windowTex, unlit: 1 }, 'city-windows');
  const cityRoof = kit.batch({ unlit: 1 }, 'city-roofs');
  const far = kit.batch({ unlit: 1, fog: false }, 'far-skyline');
  const lights = kit.batch({ unlit: 1 }, 'lamp-heads');
  const additive = (o: Parameters<Kit['mat']>[0]) => {
    const m = kit.mat({ transparent: true, depthWrite: false, unlit: 1, vertexColors: true, ...o });
    m.blending = THREE.AdditiveBlending;
    return m;
  };
  const pools = kit.batch(decal(additive({ map: glowTex, color: 0xffffff })), 'light-pools');
  pools.renderOrder = 2;
  const beams = kit.batch(additive({ side: THREE.DoubleSide }), 'light-beams');
  beams.renderOrder = 3;
  const shadowMat = decal(
    kit.mat({
      map: kit.tex(32, 32, (ctx, w, h) => radialSprite(ctx, w, h, 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)'), false),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
      vertexColors: true,
    }),
  );
  const shadows = kit.batch(shadowMat, 'shadows');
  shadows.renderOrder = 1;

  /* ---------------------------------------------------------------- */
  /* sky: night gradient + city glow, stars, moon                      */
  /* ---------------------------------------------------------------- */
  const FOG = 0x241b3e;
  const moonDir = new THREE.Vector3(0.36, 0.21, -0.91).normalize();
  skyDome(kit, {
    radius: 300,
    stops: [
      [-90, 0x120e22],
      [-3, FOG],
      [0, FOG],
      [3, 0x3c2658],
      [8, 0x2a1d4a],
      [18, 0x161636],
      [35, 0x0c0f26],
      [60, 0x070a1a],
      [90, 0x05060f],
    ],
    glow: { dir: moonDir, color: 0x3a4a7a, amount: 0.6, power: 12 },
  });
  {
    const stars = kit.batch({ unlit: 1, fog: false, depthWrite: false }, 'stars');
    stars.renderOrder = -95;
    for (let i = 0; i < 170; i++) {
      const az = r() * Math.PI * 2;
      const el = (14 + Math.pow(r(), 0.7) * 70) * (Math.PI / 180);
      const d = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().negate());
      const m = new THREE.Matrix4().compose(d.multiplyScalar(285), q, new THREE.Vector3(1, 1, 1));
      const s = 0.45 + r() * 0.6;
      const c = lerpC(0x8890b0, 0xffffff, r());
      stars.quad(m, [
        [-s, -s, 0],
        [s, -s, 0],
        [s, s, 0],
        [-s, s, 0],
      ], [0, 0, 1, 1], c);
    }
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), moonDir.clone().negate());
    const moon = kit.batch({ unlit: 1, fog: false }, 'moon');
    moon.renderOrder = -90;
    const g = new THREE.CircleGeometry(9, 16);
    const mc = C(0xf4f0dc);
    const me = C(0xc8c4b8);
    moon.geo(new THREE.Matrix4().compose(moonDir.clone().multiplyScalar(280), q, new THREE.Vector3(1, 1, 1)), g, {
      colorFn: (p) => mc.clone().lerp(me, clamp(Math.hypot(p.x - 2, p.y + 2) / 10, 0, 1)),
    });
    g.dispose();
    const halo = kit.batch(additive({ map: glowTex, fog: false, color: 0x5a6aa0 }), 'moon-halo');
    halo.renderOrder = -85;
    halo.quad(new THREE.Matrix4().compose(moonDir.clone().multiplyScalar(276), q, new THREE.Vector3(1, 1, 1)), [
      [-36, -36, 0],
      [36, -36, 0],
      [36, 36, 0],
      [-36, 36, 0],
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* deck                                                             */
  /* ---------------------------------------------------------------- */
  {
    const xs = gridLines(-DX, DX, [], (d) => (d < 12 ? 2.5 : 5));
    const zs = gridLines(DZ0, DZ1, [BAY0, AISLE0, AISLE1, BAY1], (d) => (d < 10 ? 2.5 : 4));
    const cAisle: GroundCell = { b: aisle, y: 0, uv: (x, z) => [x / 16, (z - AISLE0) / (AISLE1 - AISLE0)] };
    const cBayFar: GroundCell = { b: bays, y: 0, uv: (x, z) => [(x + DX) / BAY_W, (z - AISLE0) / (BAY0 - AISLE0)] };
    const cBayNear: GroundCell = { b: bays, y: 0, uv: (x, z) => [(x + DX) / BAY_W, (z - AISLE1) / (BAY1 - AISLE1)] };
    const cWalk: GroundCell = { b: concrete, y: CURB, tile: 3, color: 0xb8b4bc, side: hazard, sideTile: 0.6 };
    groundGrid(xs, zs, (_x, z) => {
      if (z < BAY0 || z > BAY1) return cWalk;
      if (z < AISLE0) return cBayFar;
      if (z > AISLE1) return cBayNear;
      return cAisle;
    });
    // parapet walls (+ metal rail) all around
    const pc = { uv: 2, color: 0xc0bcc8, bottom: 0x6a6670 };
    concrete.box(I, 0, CURB, DZ0 - 0.2, DX * 2 + 0.8, 1.0, 0.4, pc);
    concrete.box(I, 0, CURB, DZ1 + 0.2, DX * 2 + 0.8, 1.0, 0.4, pc);
    concrete.box(I, -DX - 0.2, CURB, (DZ0 + DZ1) / 2, 0.4, 1.0, DZ1 - DZ0, pc);
    concrete.box(I, DX + 0.2, CURB, (DZ0 + DZ1) / 2, 0.4, 1.0, DZ1 - DZ0, pc);
    // outer facade of the garage, down to the street
    const fc = { uv: 4, color: 0x5a5866, bottom: 0x2a2834 };
    concrete.box(I, 0, STREET_Y, DZ0 - 0.4, DX * 2 + 1.2, -STREET_Y + CURB, 0.01, { ...fc, skip: ['ny', 'py', 'pz'] });
    concrete.box(I, 0, STREET_Y, DZ1 + 0.4, DX * 2 + 1.2, -STREET_Y + CURB, 0.01, { ...fc, skip: ['ny', 'py', 'nz'] });
    concrete.box(I, -DX - 0.4, STREET_Y, (DZ0 + DZ1) / 2, 0.01, -STREET_Y + CURB, DZ1 - DZ0 + 1.2, { ...fc, skip: ['ny', 'py', 'px'] });
    concrete.box(I, DX + 0.4, STREET_Y, (DZ0 + DZ1) / 2, 0.01, -STREET_Y + CURB, DZ1 - DZ0 + 1.2, { ...fc, skip: ['ny', 'py', 'nx'] });
    // rail on top of the parapet
    for (const z of [DZ0 - 0.2, DZ1 + 0.2]) plain.box(I, 0, CURB + 1.0, z, DX * 2 + 0.8, 0.08, 0.1, { color: 0x8a8c96 });
    for (const x of [-DX - 0.2, DX + 0.2]) plain.box(I, x, CURB + 1.0, (DZ0 + DZ1) / 2, 0.1, 0.08, DZ1 - DZ0, { color: 0x8a8c96 });
  }

  /* ---------------------------------------------------------------- */
  /* far side: pillars + canopy (left half), jersey barriers (right)   */
  /* ---------------------------------------------------------------- */
  {
    const CAN_X0 = -DX;
    const CAN_X1 = -4;
    const canY = 3.8;
    const CAN_Z0 = DZ0 - 0.4;
    const CAN_Z1 = BAY0 - 1.0;
    for (let x = CAN_X0 + 1.5; x <= CAN_X1 + 0.01; x += 7.5) {
      for (const z of [CAN_Z1 - 0.5, DZ0 + 0.4]) {
        hazard.box(I, x, CURB, z, 0.8, 1.0, 0.8, { uv: 0.6, skip: ['ny', 'py'] });
        concrete.box(I, x, CURB + 1.0, z, 0.8, canY - CURB - 1.0, 0.8, { uv: 2, color: 0xb0acb8, bottom: 0x8a8692, skip: ['ny', 'py'] });
      }
    }
    concrete.box(I, (CAN_X0 + CAN_X1) / 2 + 0.5, canY, (CAN_Z0 + CAN_Z1) / 2, CAN_X1 - CAN_X0 + 1.8, 0.55, CAN_Z1 - CAN_Z0, {
      uv: 3,
      color: 0xa8a4b0,
      faceColor: { ny: 0x4a4854 },
      skip: [],
    });
    // fluorescent tubes under the canopy
    for (let x = CAN_X0 + 5; x < CAN_X1; x += 7.5)
      lights.box(I, x, canY - 0.08, (CAN_Z0 + CAN_Z1) / 2, 1.6, 0.08, 0.14, { color: 0xe8f4ff, skip: [] });
    // stair / elevator block under the canopy with a lit door and vending machines
    concrete.box(I, -24, CURB, DZ0 + 2.4, 6, canY - CURB, 3.6, { uv: 2, color: 0x9a96a4, bottom: 0x6a6674 });
    lights.box(I, -25.2, CURB, DZ0 + 4.22, 1.3, 2.2, 0.04, { color: 0xfff0c0, skip: ['ny', 'py'] });
    lights.box(I, -22.6, CURB + 2.5, DZ0 + 4.22, 1.2, 0.4, 0.04, { color: 0x30ff70, skip: ['ny', 'py'] });
    plain.box(I, -18.6, CURB, DZ0 + 1.2, 1.1, 1.9, 0.8, { color: 0xc02028, bottom: 0x601014 });
    lights.box(I, -18.6, CURB + 0.9, DZ0 + 1.61, 0.8, 0.85, 0.02, { color: 0xd8e8ff, skip: ['ny', 'py'] });
    plain.box(I, -17.2, CURB, DZ0 + 1.2, 1.1, 1.9, 0.8, { color: 0x2040b0, bottom: 0x102060 });
    lights.box(I, -17.2, CURB + 0.9, DZ0 + 1.61, 0.8, 0.85, 0.02, { color: 0xfff0d0, skip: ['ny', 'py'] });
    // jersey barriers on the open right half
    for (let x = CAN_X1 + 3; x < DX - 1; x += 3.2) {
      concrete.hexa(T(x, CURB, BAY0 - 0.9), [
        [-1.5, 0, -0.32],
        [1.5, 0, -0.32],
        [1.5, 0, 0.32],
        [-1.5, 0, 0.32],
        [-1.5, 0.8, -0.1],
        [1.5, 0.8, -0.1],
        [1.5, 0.8, 0.1],
        [-1.5, 0.8, 0.1],
      ], { uv: 1.5, color: 0xd0ccd4, bottom: 0x8a8692 });
    }
    // wheel stops in the bays
    for (let i = 0; i < 26; i += 1) {
      const x = -DX + BAY_W * (i + 0.5);
      if (i % 3 === 1) continue;
      concrete.box(I, x, 0, BAY0 + 0.6, 1.7, 0.14, 0.25, { uv: 1, color: 0xe0dce4 });
      concrete.box(I, x, 0, BAY1 - 0.6, 1.7, 0.14, 0.25, { uv: 1, color: 0xe0dce4 });
    }
    // near side: stair tower with "P" sign
    concrete.box(I, 14, CURB, 19.5, 7, 6.5, 5, { uv: 2.5, color: 0xa8a4b0, bottom: 0x6a6674 });
    concrete.box(I, 14, CURB + 6.5, 19.5, 7.4, 0.3, 5.4, { uv: 2, color: 0x8a8692 });
    lights.box(I, 12.6, CURB, 16.98, 1.4, 2.3, 0.04, { color: 0xfff0c0, skip: ['ny', 'py'] });
    lights.box(I, 15.2, CURB + 2.6, 16.98, 1.4, 0.45, 0.04, { color: 0x30ff70, skip: ['ny', 'py'] });
    for (let x = -DX + 4; x < 8; x += 3.2) {
      concrete.hexa(T(x, CURB, BAY1 + 1.7), [
        [-1.5, 0, -0.32],
        [1.5, 0, -0.32],
        [1.5, 0, 0.32],
        [-1.5, 0, 0.32],
        [-1.5, 0.8, -0.1],
        [1.5, 0.8, -0.1],
        [1.5, 0.8, 0.1],
        [-1.5, 0.8, 0.1],
      ], { uv: 1.5, color: 0xd0ccd4, bottom: 0x8a8692 });
    }
  }

  /* ---------------------------------------------------------------- */
  /* sodium lamps: poles behind the bays, heads over the bay fronts     */
  /* ---------------------------------------------------------------- */
  {
    const sodium = C(0xffa848);
    const beamTop = C(0x2a1c0c);
    const black = C(0x000000);
    const lamp = (x: number, side: 1 | -1) => {
      const zp = side * (BAY1 + 0.5);
      const zh = side * 11.2;
      plain.cyl(I, x, CURB, zp, 0.1, 0.14, 8.2, 6, { color: 0x6a6c78, bottom: 0x3a3c48, open: true });
      plain.box(I, x, 8.0, (zp + zh) / 2, 0.12, 0.12, Math.abs(zp - zh) + 0.3, { color: 0x5a5c68 });
      plain.box(I, x, 7.85, zh, 0.5, 0.22, 0.9, { color: 0x4a4c58, skip: ['ny'] });
      lights.quad(I, [
        [x - 0.2, 7.85, zh - 0.38],
        [x + 0.2, 7.85, zh - 0.38],
        [x + 0.2, 7.85, zh + 0.38],
        [x - 0.2, 7.85, zh + 0.38],
      ], [0, 0, 1, 1], 0xffd090);
      const pr = 10;
      const pz = side * 7.6;
      pools.quad(I, [
        [x - pr, 0.03, pz + pr],
        [x + pr, 0.03, pz + pr],
        [x + pr, 0.03, pz - pr],
        [x - pr, 0.03, pz - pr],
      ], [0, 0, 1, 1], mulC(sodium, 0.85));
      // faint volumetric cone
      const g = new THREE.CylinderGeometry(0.3, 3.4, 7.8, 10, 1, true);
      g.translate(x, 7.8 / 2, zh);
      beams.geo(I, g, { colorFn: (p) => black.clone().lerp(beamTop, clamp(p.y / 7.8, 0, 1) ** 2.4) });
      g.dispose();
    };
    for (const x of [-24, -8, 8, 24]) {
      lamp(x, -1);
      lamp(x + 4, 1);
    }
  }

  /* ---------------------------------------------------------------- */
  /* parked cars                                                       */
  /* ---------------------------------------------------------------- */
  const carB = { body: carBody, plain, shadow: shadows };
  // bay index relative to the middle bay (valid range -13..12)
  const farCars: [number, number, boolean?][] = [
    [-12, 0x1a1a20],
    [-8, 0x7a1a24, true],
    [-3, 0xd8d8e0],
    [5, 0x4a2a6a],
    [9, 0x1a5a5a],
    [12, 0x8a8a92],
  ];
  const bayX = (i: number) => -DX + BAY_W * (i + 0.5);
  farCars.forEach(([bi, paint, pickup]) => {
    const x = bayX(bi + 13);
    addCar(carB, T(x, 0, (BAY0 + AISLE0) / 2 - 0.2, Math.PI / 2), { paint, pickup });
  });
  const nearCars: [number, number][] = [
    [-9, 0x2a2a34],
    [-4, 0xa01828],
    [3, 0xe0e0e4],
    [9, 0x283a7a],
    [-12, 0x5a6a2a],
  ];
  nearCars.forEach(([bi, paint]) => {
    const x = bayX(bi + 13);
    addCar(carB, T(x, 0, (BAY1 + AISLE1) / 2 + 0.2, -Math.PI / 2), { paint });
  });
  // tuner with neon underglow
  const tunerX = bayX(1 + 13);
  addCar(carB, T(tunerX, 0, (BAY0 + AISLE0) / 2 - 0.2, Math.PI / 2), { paint: 0x18181e, lowrider: true, rim: 0xd0d0d8 });
  const glowB = kit.batch(decal(additive({ map: glowTex, color: 0xffffff })), 'underglow');
  glowB.renderOrder = 2;
  glowB.quad(I, [
    [tunerX - 2.0, 0.035, -9.0],
    [tunerX + 2.0, 0.035, -9.0],
    [tunerX + 2.0, 0.035, -15.6],
    [tunerX - 2.0, 0.035, -15.6],
  ], [0, 0, 1, 1], 0xff30c0);
  const underglowMat = glowB.mat;

  /* ---------------------------------------------------------------- */
  /* city                                                             */
  /* ---------------------------------------------------------------- */
  const blinkA = kit.batch({ unlit: 1, color: 0xff2a20 }, 'blink-a');
  const blinkB2 = kit.batch({ unlit: 1, color: 0xff2a20 }, 'blink-b');
  const tower = (x: number, z: number, w: number, d: number, top: number, tint: THREE.Color, ry = 0, spire = false) => {
    const h = top - STREET_Y;
    const m = T(x, 0, z, ry);
    const u0 = Math.floor(r() * 16) / 16;
    const v0 = Math.floor(r() * 8) / 32;
    const rect = (fw: number): [number, number, number, number] => [u0, v0, u0 + fw / 48, v0 + h / 112];
    city.box(m, 0, STREET_Y, 0, w, h, d, {
      color: tint,
      faceUV: { pz: rect(w), nz: rect(w), px: rect(d), nx: rect(d) },
      skip: ['ny', 'py'],
    });
    const dist = Math.hypot(x, z);
    const detail = dist < 150 || spire;
    cityRoof.box(m, 0, top - 0.01, 0, w + 0.4, 0.6, d + 0.4, {
      color: mulC(tint, 0.12),
      bottom: mulC(tint, 0.1),
      only: detail ? undefined : ['py'],
    });
    if (detail && r() < 0.5) cityRoof.box(m, (r() - 0.5) * w * 0.4, top + 0.6, (r() - 0.5) * d * 0.4, w * 0.35, 2.5, d * 0.35, { color: 0x14141e });
    if (spire || (detail && r() < 0.4)) {
      const sh = spire ? 18 + r() * 14 : 4 + r() * 6;
      cityRoof.box(m, 0, top + 0.6, 0, 0.4, sh, 0.4, { color: 0x202028 });
      (r() < 0.5 ? blinkA : blinkB2).box(m, 0, top + 0.6 + sh, 0, 0.9, 0.9, 0.9);
    }
  };
  // custom buildings carrying the neon signs (kept clear of the procedural blocks)
  const CUSTOM: [number, number][] = [
    [-6, -62],
    [34, -54],
    [-30, -50],
    [-14, 66],
    [40, 70],
  ];
  {
    const tints = [0xffffff, 0xd8e4ff, 0xffe8d8, 0xc8f0ff, 0xf0d8ff];
    const SP = 30;
    for (let gx = -9; gx <= 9; gx++)
      for (let gz = -9; gz <= 9; gz++) {
        const cx = gx * SP + (r() - 0.5) * 6;
        const cz = gz * SP + (r() - 0.5) * 6;
        const dist = Math.hypot(cx, cz);
        if (dist > 270) continue;
        if (Math.abs(cx) < 58 && cz > -46 && cz < 48) continue; // the garage + surrounding streets
        if (CUSTOM.some(([bx, bz]) => Math.abs(cx - bx) < 26 && Math.abs(cz - bz) < 24)) continue;
        // a street canyon under the moon gives the gameplay shot some depth
        const az = Math.atan2(cz, cx) - Math.atan2(moonDir.z, moonDir.x);
        if (dist > 70 && Math.abs(Math.atan2(Math.sin(az), Math.cos(az))) < 0.11) continue;
        const w = 14 + r() * 12;
        const d = 14 + r() * 12;
        // keep the regular skyline under ~13° from the gameplay camera so the sky stays visible
        const want = dist < 90 ? -8 + r() * 24 : dist < 160 ? 6 + r() * 46 : 26 + r() * 96;
        const top = Math.min(want, 0.23 * dist - 4 + r() * 6);
        tower(cx, cz, w, d, top, C(tints[Math.floor(r() * tints.length)]).multiplyScalar(0.8 + r() * 0.35));
      }
    // signature skyscrapers
    tower(-70, -150, 30, 26, 150, C(0xd8e4ff), 0.2, true);
    tower(60, -180, 26, 26, 170, C(0xffe8d8), -0.3, true);
    tower(150, -60, 24, 30, 120, C(0xffffff), 0.1, true);
    tower(-170, 40, 28, 24, 130, C(0xc8f0ff), 0, true);
    tower(20, 190, 26, 26, 140, C(0xf0d8ff), 0.4, true);

    // far skyline silhouette ring (no fog) with a few lit dots
    const sil = C(0x140f26);
    const silTop = C(0x1c1632);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 + r() * 0.03;
      const dd = 268 + r() * 14;
      const hgt = 20 + r() * 70 * (0.4 + 0.6 * Math.abs(Math.sin(a * 2.5 + 1)));
      const wd = 10 + r() * 14;
      far.box(T(Math.cos(a) * dd, STREET_Y, Math.sin(a) * dd, -a), 0, 0, 0, 10, hgt - STREET_Y, wd, { color: silTop, bottom: sil });
    }
    // street level ground
    const street = C(0x16141e);
    plain.quad(I, [
      [-320, STREET_Y, 320],
      [320, STREET_Y, 320],
      [320, STREET_Y, -320],
      [-320, STREET_Y, -320],
    ], [0, 0, 1, 1], street);
  }

  /* ---------------------------------------------------------------- */
  /* neon signs                                                       */
  /* ---------------------------------------------------------------- */
  interface Sign {
    mat: PS1Material;
    base: number;
    flicker: boolean;
  }
  const signs: Sign[] = [];
  const sign = (
    text: string,
    hex: string,
    m: THREE.Matrix4,
    w: number,
    h: number,
    opts: { flicker?: boolean; font?: number; texW?: number; texH?: number; frame?: boolean } = {},
  ) => {
    const tex = neonTex(text, hex, opts.texW ?? 128, opts.texH ?? 48, opts.font ?? 34);
    const b = kit.batch(additive({ map: tex, color: 0xffffff }), `neon-${text}`);
    b.renderOrder = 4;
    b.quad(m, [
      [-w / 2, -h / 2, 0.12],
      [w / 2, -h / 2, 0.12],
      [w / 2, h / 2, 0.12],
      [-w / 2, h / 2, 0.12],
    ]);
    if (opts.frame !== false) plain.box(m, 0, -h / 2 - 0.2, -0.1, w + 0.4, h + 0.4, 0.2, { color: 0x101018 });
    signs.push({ mat: b.mat, base: 1, flicker: !!opts.flicker });
  };
  // "BBL" on a rooftop frame across the street (backdrop of the gameplay camera)
  tower(-6, -62, 30, 18, 4, C(0xe8e0ff));
  plain.box(T(-6, 4.6, -60), -5, 0, 0, 0.3, 4, 0.3, { color: 0x1a1a22 });
  plain.box(T(-6, 4.6, -60), 5, 0, 0, 0.3, 4, 0.3, { color: 0x1a1a22 });
  sign('BBL', '#ff3ab4', T(-6, 10.6, -60), 15, 5.6, { font: 38 });
  // "24/7" on a corner store facade, right
  tower(34, -54, 22, 16, 6, C(0xffe0d0));
  sign('24/7', '#30f0ff', T(30, 3.0, -45.8), 9, 3.4, { font: 32 });
  // "MOTEL" vertical-ish sign on a pole, left
  plain.cyl(I, -30, STREET_Y, -50, 0.4, 0.4, 32, 6, { color: 0x24242c });
  sign('MOTEL', '#ff4a3a', T(-30, 9.4, -49.4), 12, 3.6, { font: 28, flicker: true });
  // behind the camera (reverse / KO cameras)
  sign('P', '#4a8aff', T(15.8, 5.0, 16.8, Math.PI), 2.4, 2.4, { font: 40, texW: 48, texH: 48 });
  tower(-14, 66, 28, 18, 8, C(0xf0d8ff));
  sign('MOTEL', '#ff3ab4', T(-14, 13, 56.8, Math.PI), 13, 4, { font: 28 });
  tower(40, 70, 20, 20, 14, C(0xd8f0ff));
  sign('BBL', '#30f0ff', T(40, 18.5, 59.8, Math.PI), 10, 3.8, { font: 38 });

  /* ---------------------------------------------------------------- */
  /* police helicopter with searchlight                                */
  /* ---------------------------------------------------------------- */
  const heli = new THREE.Group();
  heli.scale.setScalar(1.5);
  kit.group.add(heli);
  const rotor = new THREE.Group();
  const tailRotor = new THREE.Group();
  const spot = new THREE.Group();
  heli.add(rotor, tailRotor, spot);
  {
    const hb = kit.batch(plain.mat, 'heli-body', heli);
    const body = 0x1c2030;
    hb.hexa(I, [
      [-1.4, 0, -0.8],
      [1.2, 0, -0.7],
      [1.2, 0, 0.7],
      [-1.4, 0, 0.8],
      [-1.2, 1.5, -0.7],
      [0.6, 1.5, -0.6],
      [0.6, 1.5, 0.6],
      [-1.2, 1.5, 0.7],
    ], { color: body, faceColor: { px: 0x3a4a6a }, skip: [] });
    hb.hexa(I, [
      [1.2, 0, -0.7],
      [2.3, 0.4, -0.3],
      [2.3, 0.4, 0.3],
      [1.2, 0, 0.7],
      [0.6, 1.5, -0.6],
      [1.6, 1.0, -0.3],
      [1.6, 1.0, 0.3],
      [0.6, 1.5, 0.6],
    ], { color: 0x4a5a80, skip: ['nx'] });
    hb.box(I, -0.2, 0.55, 0, 2.6, 0.25, 1.62, { color: 0xe8e8f0, skip: ['ny', 'py'] });
    hb.beam(I, [-1.3, 0.9, 0], [-6.2, 1.3, 0], 0.4, { color: body });
    hb.box(I, -6.1, 1.0, 0, 0.8, 1.6, 0.12, { color: body, skip: [] });
    for (const s of [-1, 1]) {
      hb.beam(I, [-1.4, -0.45, s * 0.85], [1.4, -0.45, s * 0.85], 0.1, { color: 0x6a6a72 });
      hb.beam(I, [-0.8, -0.45, s * 0.85], [-0.6, 0, s * 0.6], 0.08, { color: 0x6a6a72 });
      hb.beam(I, [0.8, -0.45, s * 0.85], [0.6, 0, s * 0.6], 0.08, { color: 0x6a6a72 });
    }
    hb.box(I, 0, 1.5, 0, 0.3, 0.35, 0.3, { color: 0x2a2a30 });
    const rb = kit.batch(plain.mat, 'heli-rotor', rotor);
    rb.box(I, 0, 0, 0, 9.5, 0.06, 0.32, { color: 0x14141a, skip: [] });
    rb.box(I, 0, 0, 0, 0.32, 0.06, 9.5, { color: 0x14141a, skip: [] });
    rotor.position.set(0, 1.85, 0);
    const tb = kit.batch(plain.mat, 'heli-tail-rotor', tailRotor);
    tb.box(I, 0, -0.9, 0, 0.18, 1.8, 0.04, { color: 0x14141a, skip: [] });
    tailRotor.position.set(-6.1, 1.9, 0.12);
    // searchlight cone (additive)
    const sb = kit.batch(additive({ side: THREE.DoubleSide }), 'heli-searchlight', spot);
    sb.renderOrder = 5;
    const g = new THREE.CylinderGeometry(0.35, 6.5, 60, 12, 1, true);
    g.translate(0, -30, 0);
    const top = C(0x9aa8d8);
    const black = C(0x000000);
    sb.geo(I, g, { colorFn: (p) => black.clone().lerp(top, clamp((p.y + 60) / 60, 0, 1) ** 2.2) });
    g.dispose();
    spot.position.set(1.4, -0.1, 0);
  }
  const strobe = kit.batch({ unlit: 1, color: 0xffffff }, 'heli-strobe', heli);
  strobe.box(I, -6.1, 2.0, 0, 0.35, 0.35, 0.35, { skip: [] });
  const lampB = kit.batch({ unlit: 1, color: 0xf0f4ff }, 'heli-lamp', spot);
  lampB.box(I, 0, -0.25, 0, 0.5, 0.25, 0.5, { skip: [] });
  const strobeMat = strobe.mat;
  const navR = kit.batch({ unlit: 1, color: 0xff2020 }, 'heli-nav-r', heli);
  navR.box(I, -0.2, 0.7, -0.84, 0.2, 0.2, 0.06, { skip: [] });
  const navG = kit.batch({ unlit: 1, color: 0x20ff40 }, 'heli-nav-g', heli);
  navG.box(I, -0.2, 0.7, 0.84, 0.2, 0.2, 0.06, { skip: [] });

  kit.finish();

  /* ---------------------------------------------------------------- */
  /* animation                                                        */
  /* ---------------------------------------------------------------- */
  const blinkOn = C(0xff2a20);
  const blinkOff = C(0x300808);
  const white = C(0xffffff);
  const dark = C(0x101010);
  const colorOf = (m: PS1Material) => m.uniforms.uColor.value as THREE.Color;
  const tangent = new THREE.Vector3();
  const pathAt = (t: number, out: THREE.Vector3) => {
    const a = t * 0.1 - 1.2;
    return out.set(Math.cos(a) * 72, 17 + Math.sin(t * 0.21) * 2, -24 + Math.sin(a) * 52);
  };
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const placeHeli = (t: number) => {
    pathAt(t, p0);
    pathAt(t + 0.1, p1);
    tangent.subVectors(p1, p0);
    heli.position.copy(p0);
    heli.rotation.set(0, Math.atan2(-tangent.z, tangent.x), 0, 'YXZ');
    heli.rotation.z = -0.12;
    heli.rotation.x = 0.18;
    rotor.rotation.y = t * 9;
    tailRotor.rotation.z = t * 21;
    // searchlight sweeps around, roughly towards the garage
    spot.rotation.set(Math.sin(t * 0.37) * 0.35 + 0.25, 0, -0.45 + Math.sin(t * 0.53) * 0.3, 'YXZ');
  };
  placeHeli(0);

  return {
    group: kit.group,
    clearColor: C(FOG),
    fogColor: C(FOG),
    fogNear: 28,
    fogFar: 240,
    lightDir: new THREE.Vector3(0.28, 0.82, 0.5).normalize(),
    lightColor: new THREE.Color(0.42, 0.42, 0.62),
    ambient: new THREE.Color(0.3, 0.27, 0.44),
    update(t: number) {
      placeHeli(t);
      colorOf(blinkA.mat).copy(t % 2 < 0.5 ? blinkOn : blinkOff);
      colorOf(blinkB2.mat).copy((t + 1) % 2 < 0.5 ? blinkOn : blinkOff);
      colorOf(strobeMat).copy(t % 1.2 < 0.08 ? white : dark);
      // neon: soft pulse, the MOTEL sign stutters
      for (const s of signs) {
        let k = 0.92 + 0.08 * Math.sin(t * 3.1 + s.base);
        if (s.flicker) {
          const f = Math.sin(t * 17) + Math.sin(t * 5.3 + 0.7) + Math.sin(t * 0.9);
          if (f > 1.6) k = 0.15;
        }
        colorOf(s.mat).setScalar(k);
      }
      colorOf(underglowMat).setScalar(0.75 + 0.25 * Math.sin(t * 2.4));
    },
    dispose() {
      kit.dispose();
    },
  };
}

export const parking: StageDef = {
  id: 'parking',
  name: 'NEON PARKING',
  subtitle: 'Minuit, centre-ville',
  music: 'parking',
  build,
};
