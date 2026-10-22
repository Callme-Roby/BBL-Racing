import * as THREE from 'three';
import type { StageDef, StageEnv } from './types';
import {
  Batch,
  C,
  Kit,
  T,
  blob,
  clamp,
  crack,
  css,
  decal,
  gridLines,
  groundGrid,
  hillRing,
  lerpC,
  mul,
  mulC,
  noiseRect,
  patch,
  px,
  radialSprite,
  shade,
  skyDome,
  type GroundCell,
  type UVRect,
} from './kit';
import { addCar, carTexture } from './props';
import type { PS1Material } from '../ps1Material';

/*
 * SUNSET HOOD — a San-Andreas-style cul-de-sac at golden hour.
 *
 * Layout (world, metres):
 *   street (asphalt, double yellow line on z = 0)   z ∈ [-7.5, 7.5], x < 30
 *   court (dead-end turnaround)                      x ∈ [30, 46], |z| < 14
 *   sidewalks (+0.15 m, curbs)                       |z| ∈ [7.5, 10.5]
 *   front yards                                      |z| ∈ [10.5, 16]
 *   houses (one storey)                              |z| ∈ [16, ~25]
 *   back fences / alley / second row                 |z| ∈ [32, 48]
 * The sun sets behind the north (-Z) row, slightly to the left.
 */

const CURB = 0.15;
const LOTS = [-124, -110, -96, -82, -68, -54, -40, -26, -12, 2, 16];
const DOOR_U = [0.5, 0.27, 0.66, 0.42];
const STUCCO = [0xf2c9a2, 0xbfe0b4, 0xaccbe4, 0xf2e2a4, 0xf0bcb8, 0xd6c6e6, 0xf2eee2, 0xcdd6a4, 0xf4d2b0];
const ROOFS = [0x7a6a64, 0x8a5a48, 0x5e5c62, 0x9a6a4a, 0x6a5450];

function facadeUV(k: number): UVRect {
  const e = 0.5 / 128;
  return [e, 1 - (k + 1) / 4 + e, 1 - e, 1 - k / 4 - e];
}

/** Quad whose flat normal is forced to point up (fronds, double-sided). */
function upQuad(b: Batch, p: THREE.Vector3[], uv: number[], c: THREE.Color[]): void {
  const n = new THREE.Vector3().subVectors(p[2], p[0]).cross(new THREE.Vector3().subVectors(p[3], p[1]));
  if (n.y >= 0) b.quadW(p, uv, c);
  else b.quadW([p[1], p[0], p[3], p[2]], [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], [c[1], c[0], c[3], c[2]]);
}

function build(): StageEnv {
  const kit = new Kit(0xb0b1, 'stage:hood');
  const r = kit.rand;
  const I = new THREE.Matrix4();

  /* ---------------------------------------------------------------- */
  /* textures                                                         */
  /* ---------------------------------------------------------------- */
  const zRow = (z: number) => Math.round((1 - (z + 7.5) / 15) * 128);
  const streetTex = kit.tex(128, 128, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x5e585c, 20, 0.15);
    // tyre-polished lanes
    for (const zc of [-5.0, -2.4, 2.4, 5.0]) {
      ctx.fillStyle = 'rgba(30,28,34,0.18)';
      ctx.fillRect(0, zRow(zc) - 3, w, 6);
    }
    // asphalt repair patches
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(25,24,30,0.35)' : 'rgba(120,116,118,0.18)';
      ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h), 6 + Math.floor(r() * 18), 4 + Math.floor(r() * 10));
    }
    for (let i = 0; i < 9; i++) crack(ctx, w, h, r, r() * w, r() * h, 8 + r() * 16, 'rgba(24,22,28,0.55)');
    for (let i = 0; i < 9; i++) blob(ctx, w, h, r, r() * w, zRow(-5 + r() * 10), 2 + r() * 4, 'rgba(20,18,24,0.3)', 0.6);
    // gutters along the curbs
    noiseRect(ctx, 0, 0, w, 4, r, 0x77736c, 16, 0.1);
    noiseRect(ctx, 0, h - 4, w, 4, r, 0x77736c, 16, 0.1);
    ctx.fillStyle = 'rgba(30,26,22,0.5)';
    ctx.fillRect(0, 4, w, 1);
    ctx.fillRect(0, h - 5, w, 1);
    // worn double yellow line on z = 0
    for (let x = 0; x < w; x++) {
      if (r() > 0.16) px(ctx, x, 62, w, h, r() > 0.5 ? '#d9b04a' : '#c49a3c');
      if (r() > 0.16) px(ctx, x, 65, w, h, r() > 0.5 ? '#d9b04a' : '#c49a3c');
    }
    // dashed white parking-lane edge lines
    for (let x = 0; x < w; x++) {
      if (x % 32 < 18 && r() > 0.3) {
        px(ctx, x, zRow(5.9), w, h, '#c8c4bc');
        px(ctx, x, zRow(-5.9), w, h, '#c8c4bc');
      }
    }
    // burnout donuts / skid marks
    ctx.lineWidth = 1;
    for (const [cx, cz, rad] of [
      [30, 2.8, 14],
      [86, -2.2, 11],
    ] as const) {
      ctx.strokeStyle = 'rgba(16,14,18,0.45)';
      for (const dr of [0, 3]) {
        ctx.beginPath();
        ctx.ellipse(cx, zRow(cz), rad + dr, (rad + dr) * 0.6, 0.3, 0.4, Math.PI * 1.7);
        ctx.stroke();
      }
    }
    // manhole
    ctx.fillStyle = '#2c2a2e';
    ctx.beginPath();
    ctx.arc(96, zRow(-3.6), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a5654';
    for (let i = -3; i <= 3; i += 2) ctx.fillRect(93, zRow(-3.6) + i, 7, 1);
  });

  const asphaltTex = kit.tex(64, 64, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x56535a, 20, 0.15);
    for (let i = 0; i < 6; i++) crack(ctx, w, h, r, r() * w, r() * h, 8 + r() * 14, 'rgba(24,22,28,0.55)');
    for (let i = 0; i < 6; i++) blob(ctx, w, h, r, r() * w, r() * h, 2 + r() * 4, 'rgba(14,12,16,0.35)', 0.6);
  });

  const sidewalkTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0xb8ae9c, 16, 0.1);
    ctx.fillStyle = '#7e766a';
    ctx.fillRect(0, 0, w, 1);
    ctx.fillRect(0, 16, w, 1);
    ctx.fillRect(0, 0, 1, h);
    ctx.fillRect(16, 0, 1, h);
    for (let i = 0; i < 3; i++) crack(ctx, w, h, r, r() * w, r() * h, 8 + r() * 8, 'rgba(90,82,72,0.9)');
    for (let i = 0; i < 6; i++) px(ctx, r() * w, r() * h, w, h, 'rgba(60,56,52,0.8)');
    blob(ctx, w, h, r, 24, 8, 3, 'rgba(110,100,86,0.35)', 0.5);
  });

  const grassTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x92904e, 34, 0.3);
    for (let i = 0; i < 60; i++) px(ctx, r() * w, r() * h, w, h, r() > 0.5 ? '#6a7a36' : '#a6a058');
    for (let i = 0; i < 4; i++) blob(ctx, w, h, r, r() * w, r() * h, 2 + r() * 4, 'rgba(150,118,80,0.8)', 0.7);
  });

  const stuccoTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0xeae4da, 18, 0.05);
    for (let i = 0; i < 3; i++) crack(ctx, w, h, r, r() * w, r() * h, 6, 'rgba(150,140,130,0.6)', Math.PI / 2);
  });

  const facadeTex = kit.tex(
    128,
    128,
    (ctx) => {
      for (let k = 0; k < 4; k++) {
        const y0 = k * 32;
        noiseRect(ctx, 0, y0, 128, 32, r, 0xeee8de, 14, 0.05);
        ctx.fillStyle = 'rgba(70,50,60,0.35)';
        ctx.fillRect(0, y0, 128, 2); // shadow under the eaves
        ctx.fillStyle = '#8a8278';
        ctx.fillRect(0, y0 + 30, 128, 2); // foundation
        const win = (x: number, o: { bars?: boolean; curtain?: number; ac?: boolean; boarded?: boolean } = {}) => {
          const y = y0 + 9;
          ctx.fillStyle = '#f8f6f0';
          ctx.fillRect(x - 1, y - 1, 18, 14);
          ctx.fillStyle = '#bab4aa';
          ctx.fillRect(x - 2, y + 12, 20, 1);
          if (o.boarded) {
            ctx.fillStyle = '#ab8550';
            ctx.fillRect(x, y, 16, 12);
            ctx.fillStyle = '#76552e';
            for (let i = 0; i < 16; i++) {
              ctx.fillRect(x + i, y + Math.floor((i * 12) / 16), 1, 1);
              ctx.fillRect(x + 15 - i, y + Math.floor((i * 12) / 16), 1, 1);
            }
            ctx.fillRect(x, y + 6, 16, 1);
            return;
          }
          ctx.fillStyle = '#1d2536';
          ctx.fillRect(x, y, 16, 12);
          if (o.curtain) {
            ctx.fillStyle = css(o.curtain);
            ctx.fillRect(x, y, 4, 12);
            ctx.fillRect(x + 12, y, 4, 12);
          }
          ctx.fillStyle = '#4f6080';
          for (let i = 0; i < 6; i++) ctx.fillRect(x + 4 + i, y + 9 - i, 2, 1);
          ctx.fillStyle = '#d8d4cc';
          ctx.fillRect(x, y + 6, 16, 1);
          ctx.fillRect(x + 8, y, 1, 12);
          if (o.bars) {
            ctx.fillStyle = '#141414';
            for (let i = 1; i < 16; i += 3) ctx.fillRect(x + i, y - 1, 1, 14);
            ctx.fillRect(x - 1, y + 2, 18, 1);
            ctx.fillRect(x - 1, y + 9, 18, 1);
          }
          if (o.ac) {
            ctx.fillStyle = '#a2a4a6';
            ctx.fillRect(x + 3, y + 7, 9, 6);
            ctx.fillStyle = '#56585a';
            for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + i * 2, y + 8, 1, 4);
          }
        };
        const door = (u: number, hex: number, screen = false) => {
          const x = Math.round(u * 128) - 6;
          const y = y0 + 7;
          ctx.fillStyle = '#f6f4ee';
          ctx.fillRect(x - 1, y - 1, 14, 25);
          ctx.fillStyle = css(hex);
          ctx.fillRect(x, y, 12, 23);
          ctx.fillStyle = shade(hex, 0.7);
          ctx.fillRect(x + 2, y + 2, 8, 8);
          ctx.fillRect(x + 2, y + 12, 8, 9);
          ctx.fillStyle = shade(hex, 1.1);
          ctx.fillRect(x + 3, y + 3, 6, 6);
          ctx.fillRect(x + 3, y + 13, 6, 7);
          ctx.fillStyle = '#ecc860';
          ctx.fillRect(x + 9, y + 11, 1, 2);
          if (screen) {
            ctx.fillStyle = 'rgba(8,8,8,0.8)';
            for (let yy = 0; yy < 23; yy++) for (let xx = yy & 1; xx < 12; xx += 2) ctx.fillRect(x + xx, y + yy, 1, 1);
            ctx.fillStyle = '#0c0c0c';
            ctx.fillRect(x, y, 12, 1);
            ctx.fillRect(x, y + 11, 12, 1);
            ctx.fillRect(x, y, 1, 23);
            ctx.fillRect(x + 11, y, 1, 23);
          }
          // porch light + house number
          ctx.fillStyle = '#fff2b0';
          ctx.fillRect(x + 14, y + 2, 2, 2);
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(x - 5, y + 4, 1, 3);
          ctx.fillRect(x - 3, y + 4, 2, 1);
          ctx.fillRect(x - 3, y + 6, 2, 1);
        };
        const garage = (x: number) => {
          const y = y0 + 9;
          ctx.fillStyle = '#f2f0ea';
          ctx.fillRect(x - 1, y - 1, 32, 22);
          noiseRect(ctx, x, y, 30, 21, r, 0xc8c4ba, 8, 0);
          ctx.fillStyle = '#9a968e';
          for (let yy = y + 3; yy < y + 21; yy += 3) ctx.fillRect(x, yy, 30, 1);
          ctx.fillStyle = 'rgba(60,50,40,0.35)';
          ctx.fillRect(x, y + 17, 30, 4);
        };
        if (k === 0) {
          win(10);
          win(36, { curtain: 0xc8904a });
          door(DOOR_U[0], 0x7a4a2a);
          win(80);
          win(104, { curtain: 0xb05a5a });
        } else if (k === 1) {
          win(8, { bars: true });
          door(DOOR_U[1], 0x5a3a2a, true);
          win(48, { bars: true, ac: true });
          garage(86);
        } else if (k === 2) {
          win(10, { curtain: 0xd0a050 });
          win(34, { ac: true });
          door(DOOR_U[2], 0x3a5a6a);
          win(104, { bars: true });
        } else {
          win(14, { boarded: true });
          door(DOOR_U[3], 0x6a2a2a, true);
          win(74, { bars: true });
          win(100, { bars: true, curtain: 0x8a6ab0 });
        }
        // a few dirt streaks
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = 'rgba(120,100,80,0.18)';
          ctx.fillRect(Math.floor(r() * 128), y0 + 22 + Math.floor(r() * 6), 1, 3 + Math.floor(r() * 4));
        }
      }
    },
    false,
  );

  const roofTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0xb4aaa4, 20, 0.1);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = 'rgba(40,30,30,0.55)';
      ctx.fillRect(0, y + 3, w, 1);
      const off = (y / 4) % 2 ? 3 : 0;
      for (let x = off; x < w; x += 6) {
        ctx.fillStyle = 'rgba(40,30,30,0.4)';
        ctx.fillRect(x, y, 1, 3);
        if (r() < 0.25) {
          ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
          ctx.fillRect(x + 1, y, 5, 3);
        }
      }
    }
  });

  const woodTex = kit.tex(32, 32, (ctx, w, h) => {
    for (let x = 0; x < w; x += 4) {
      noiseRect(ctx, x, 0, 4, h, r, [0xa47a50, 0x9a7048, 0xae8458, 0x8e6640][Math.floor(r() * 4)], 14, 0.05);
      ctx.fillStyle = '#3a2818';
      ctx.fillRect(x, 0, 1, h);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = 'rgba(60,40,20,0.4)';
        ctx.fillRect(x + 1 + Math.floor(r() * 3), Math.floor(r() * h), 1, 4 + Math.floor(r() * 6));
      }
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(x + 2, 6, 1, 1);
      ctx.fillRect(x + 2, 26, 1, 1);
    }
  });

  const chainTex = kit.tex(16, 16, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) px(ctx, x, y, w, h, (x + y) % 8 === 0 ? '#d4d8dc' : '#a8acb0');
  });

  const barkTex = kit.tex(16, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, 0x8e7c64, 20, 0.1);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = '#5a4a38';
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = 'rgba(200,180,150,0.35)';
      ctx.fillRect(0, y + 1, w, 1);
    }
  });

  const frondTex = kit.tex(
    32,
    64,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const greens = ['#3e7c2c', '#4c8c34', '#2f6424', '#5a983c'];
      for (let y = 2; y < h - 1; y += 2) {
        const t = 1 - y / h; // 0 at the tip .. 1 at the base
        const len = Math.max(2, Math.round(15 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 1));
        for (const s of [-1, 1]) {
          const col = r() < 0.1 ? '#a09a44' : greens[Math.floor(r() * greens.length)];
          for (let i = 0; i < len; i++) {
            const x = 16 + s * (i + 1) - (s < 0 ? 1 : 0);
            const yy = y - Math.round(i * 0.55);
            if (yy < 0) break;
            ctx.fillStyle = col;
            ctx.fillRect(x, yy, 1, 2);
          }
        }
      }
      ctx.fillStyle = '#a4a85a';
      ctx.fillRect(15, 0, 2, h);
    },
    false,
  );

  const graffitiTex = kit.tex(
    128,
    32,
    (ctx, w, h) => {
      noiseRect(ctx, 0, 0, w, h, r, 0xaea696, 16, 0.08);
      for (let y = 0; y < h; y += 4) {
        ctx.fillStyle = 'rgba(80,74,66,0.55)';
        ctx.fillRect(0, y, w, 1);
        for (let x = (y / 4) % 2 ? 4 : 0; x < w; x += 8) ctx.fillRect(x, y, 1, 4);
      }
      // grime at the bottom
      ctx.fillStyle = 'rgba(70,56,40,0.35)';
      ctx.fillRect(0, h - 5, w, 5);
      // background blob behind the piece
      ctx.fillStyle = '#3a2a6a';
      ctx.beginPath();
      ctx.ellipse(66, 17, 40, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // "BBL" bubble letters
      ctx.font = 'bold 24px "DejaVu Sans", "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#120a14';
      ctx.lineWidth = 5;
      ctx.strokeText('BBL', 68, 19);
      ctx.fillStyle = '#4a1a3a';
      ctx.fillText('BBL', 69, 20);
      const g = ctx.createLinearGradient(0, 8, 0, 28);
      g.addColorStop(0, '#ffe04a');
      g.addColorStop(0.5, '#ff6a3a');
      g.addColorStop(1, '#e8287a');
      ctx.fillStyle = g;
      ctx.fillText('BBL', 67, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(52, 10, 3, 1);
      ctx.fillRect(66, 10, 3, 1);
      ctx.fillRect(80, 10, 3, 1);
      // drips
      ctx.fillStyle = '#e8287a';
      for (const x of [55, 63, 77, 84]) ctx.fillRect(x, 26, 1, 2 + Math.floor(r() * 3));
      // crown above
      ctx.fillStyle = '#ffd23a';
      ctx.fillRect(60, 2, 13, 2);
      for (const x of [60, 66, 72]) ctx.fillRect(x, 0, 1, 2);
      // side tags
      ctx.font = 'bold 9px "DejaVu Sans", sans-serif';
      ctx.fillStyle = '#2ad0a0';
      ctx.fillText('4 LIFE', 18, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ZK', 112, 9);
      ctx.strokeStyle = '#3a8aff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(100, 24);
      for (let i = 0; i < 8; i++) ctx.lineTo(100 + i * 3, 18 + (i % 2) * 7);
      ctx.stroke();
      ctx.strokeStyle = '#e04040';
      ctx.beginPath();
      ctx.moveTo(6, 26);
      for (let i = 0; i < 7; i++) ctx.lineTo(6 + i * 3, 21 + ((i * 7) % 5));
      ctx.stroke();
    },
    false,
  );

  const shadowTex = kit.tex(32, 32, (ctx, w, h) => radialSprite(ctx, w, h, 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.5)'), false);
  const glowTex = kit.tex(32, 32, (ctx, w, h) => radialSprite(ctx, w, h, '#ffffff', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.35)'), false);

  /* ---------------------------------------------------------------- */
  /* batches (one draw call each)                                     */
  /* ---------------------------------------------------------------- */
  const street = kit.batch({ map: streetTex }, 'street');
  const asphalt = kit.batch({ map: asphaltTex }, 'asphalt');
  const sidewalk = kit.batch({ map: sidewalkTex }, 'sidewalk');
  const grass = kit.batch({ map: grassTex }, 'grass');
  const stucco = kit.batch({ map: stuccoTex }, 'stucco');
  const facade = kit.batch({ map: facadeTex }, 'facades');
  const roof = kit.batch({ map: roofTex }, 'roofs');
  const wood = kit.batch({ map: woodTex }, 'wood');
  const chain = kit.batch({ map: chainTex, alphaTest: 0.5, side: THREE.DoubleSide }, 'chainlink');
  const plain = kit.batch({}, 'plain');
  const graffiti = kit.batch({ map: graffitiTex }, 'graffiti');
  const carTex = carTexture(kit);
  const carBody = kit.batch({ map: carTex }, 'cars');
  const lens = kit.batch({ unlit: 1 }, 'lamp-lens');
  const shadowMat = decal(kit.mat({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, vertexColors: true }));
  const shadows = kit.batch(shadowMat, 'shadows');
  shadows.renderOrder = 1;
  const poolMat = decal(kit.mat({ map: glowTex, transparent: true, depthWrite: false, color: 0x6a4a2a, vertexColors: true }));
  poolMat.blending = THREE.AdditiveBlending;
  const pools = kit.batch(poolMat, 'lamp-pools');
  pools.renderOrder = 2;
  const far = kit.batch({ unlit: 1, fog: false }, 'far-silhouettes');

  /* ---------------------------------------------------------------- */
  /* sky, sun, distant hills & downtown                                */
  /* ---------------------------------------------------------------- */
  const FOG = 0xe39270;
  // visible sun disc (low on the horizon) — the key light itself is a bit higher so the street catches it
  const sunDir = new THREE.Vector3(-0.2, 0.12, -0.97).normalize();
  const keyDir = new THREE.Vector3(-0.28, 0.34, -0.9).normalize();
  const antiSun = C(0xc86a8a);
  skyDome(kit, {
    radius: 300,
    stops: [
      [-90, 0xc07468],
      [-4, FOG],
      [0, FOG],
      [3, 0xf0a46c],
      [8, 0xf6b46e],
      [14, 0xf09060],
      [22, 0xdc6c6e],
      [32, 0xb24e7c],
      [46, 0x723c7e],
      [64, 0x3c2c66],
      [90, 0x231d4a],
    ],
    glow: { dir: sunDir, color: 0xffe2a0, amount: 0.9, power: 10 },
    tint: (d, c) => {
      // away from the sun the sky turns pink / violet
      const away = clamp(-d.dot(sunDir), 0, 1);
      const band = clamp(1 - Math.abs(d.y - 0.18) / 0.3, 0, 1);
      c.lerp(antiSun, away * band * 0.45);
    },
  });
  // sun disc + halo
  {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sunDir.clone().negate());
    const pos = sunDir.clone().multiplyScalar(272);
    const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
    const g = new THREE.CircleGeometry(25, 20);
    const sunC = C(0xfff6c8);
    const sunE = C(0xffc060);
    const sun = kit.batch({ unlit: 1, fog: false }, 'sun');
    sun.renderOrder = -90;
    sun.geo(m, g, { colorFn: (p) => sunC.clone().lerp(sunE, clamp(Math.hypot(p.x, p.y) / 25, 0, 1)) });
    g.dispose();
    const haloMat = kit.mat({ map: glowTex, transparent: true, depthWrite: false, fog: false, unlit: 1, color: 0xffa860, opacity: 0.75 });
    haloMat.blending = THREE.AdditiveBlending;
    const halo = kit.batch(haloMat, 'sun-halo');
    halo.renderOrder = -80;
    const m2 = new THREE.Matrix4().compose(sunDir.clone().multiplyScalar(268), q, new THREE.Vector3(1, 1, 1));
    halo.quad(m2, [
      [-80, -80, 0],
      [80, -80, 0],
      [80, 80, 0],
      [-80, 80, 0],
    ]);
  }
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const valley = (a: number) => {
    let d = Math.abs(a - sunAz) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return clamp((d - 0.12) / 0.5, 0.25, 1);
  };
  hillRing(far, {
    radius: 255,
    seg: 72,
    base: -8,
    height: (a) => (20 + 12 * Math.sin(3 * a + 1) + 8 * Math.sin(7 * a + 2) + 4 * Math.sin(17 * a)) * valley(a),
    top: 0xae6276,
    bottom: 0xd88a78,
  });
  hillRing(far, {
    radius: 215,
    seg: 60,
    base: -8,
    height: (a) => (9 + 6 * Math.sin(5 * a + 3) + 4 * Math.sin(11 * a + 1)) * valley(a),
    top: 0x7c4062,
    bottom: 0xb46a70,
  });
  // downtown skyline far down the street (-X)
  for (let i = 0; i < 22; i++) {
    const a = Math.PI + (r() - 0.5) * 0.42;
    const d = 190 + r() * 25;
    const hgt = 14 + r() * 34 * (1 - Math.abs(a - Math.PI) * 3);
    const wd = 6 + r() * 9;
    const top = lerpC(0xb46c80, 0xc47a84, r());
    far.box(T(Math.cos(a) * d, -2, Math.sin(a) * d, r() * 0.6), 0, 0, 0, wd, hgt, wd * (0.6 + r() * 0.6), {
      color: top,
      bottom: 0xe08e76,
      faceColor: { py: mulC(top, 0.95) },
    });
    if (r() < 0.35) far.box(T(Math.cos(a) * d, hgt - 2, Math.sin(a) * d), 0, 0, 0, 0.6, 6 + r() * 6, 0.6, { color: top });
  }

  /* ---------------------------------------------------------------- */
  /* ground                                                           */
  /* ---------------------------------------------------------------- */
  const step = (d: number) => (d < 10 ? 2.5 : d < 26 ? 4 : d < 50 ? 10 : d < 110 ? 28 : 65);
  const xs = gridLines(-230, 230, [-131, 23, 27, 30, 33, 46, 49, 54.5], step);
  const zs = gridLines(-34, 34, [-17, -16, -14, -10.5, -7.5, 7.5, 10.5, 14, 16, 17], step);
  const xsFar = gridLines(-230, 230, [], (d) => (d < 60 ? 20 : 60));
  const zsFarN = gridLines(-230, -34, [], (d) => (d < 60 ? 12 : d < 110 ? 30 : 70));
  const zsFarS = gridLines(34, 230, [], (d) => (d < 60 ? 12 : d < 110 ? 30 : 70));
  const dirt = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const k = clamp((d - 40) / 120, 0, 1);
    const n = 0.9 + 0.2 * Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.13 - x * 0.07);
    return lerpC(0xf2eadc, 0xd8b08a, k).multiplyScalar(n);
  };
  const cStreet: GroundCell = { b: street, y: 0, uv: (x, z) => [x / 16, (z + 7.5) / 15] };
  const cCourt: GroundCell = { b: asphalt, y: 0, tile: 6 };
  const cWalk: GroundCell = { b: sidewalk, y: CURB, tile: 3, sideTile: 1, sideColor: 0xd8d0c4 };
  const cDirt: GroundCell = { b: grass, y: CURB, tile: 3, color: dirt };
  groundGrid(xs, zs, (x, z) => {
    const az = Math.abs(z);
    if (x < 30 && az < 7.5) return cStreet;
    if (x >= 30 && x < 46 && az < 14) return cCourt;
    if ((x < 33 && az < 10.5) || (x >= 27 && x < 49 && az < 17)) return cWalk;
    if (x >= -131 && x < 23 && az >= 10.5 && az < 16) return null; // front yards, built per lot
    if (x >= 49 && x < 54.5 && az < 14) return null; // court-end yards
    return cDirt;
  });
  groundGrid(xsFar, zsFarN, () => cDirt);
  groundGrid(xsFar, zsFarS, () => cDirt);
  // underlay: hides hairline cracks at T-junctions between independently tessellated patches
  plain.quad(I, [
    [-240, -1.5, 240],
    [240, -1.5, 240],
    [240, -1.5, -240],
    [-240, -1.5, -240],
  ], [0, 0, 1, 1], 0x5a4a3e);

  /* ---------------------------------------------------------------- */
  /* palms (instanced trunks + crowns, crowns sway)                    */
  /* ---------------------------------------------------------------- */
  const PALM_H = 12;
  const LEAN = 0.9;
  const ring = (t: number) => ({ y: t * PALM_H, r: t < 0.03 ? 0.42 : 0.3 - 0.11 * t, off: LEAN * t * t });
  const makeTrunk = (name: string, ts: readonly number[], RAD: number, boot: boolean): Batch => {
    const b = kit.batch({ map: barkTex }, name);
    const cT = C(0xffffff);
    const cB = C(0xb0a090);
    const P = (q: { y: number; r: number; off: number }, ang: number) =>
      new THREE.Vector3(q.off + q.r * Math.cos(ang), q.y, q.r * Math.sin(ang));
    for (let i = 0; i < ts.length - 1; i++) {
      const a = ring(ts[i]);
      const c = ring(ts[i + 1]);
      for (let k = 0; k < RAD; k++) {
        const a0 = (k / RAD) * Math.PI * 2;
        const a1 = ((k + 1) / RAD) * Math.PI * 2;
        const c0 = i === 0 ? cB : cT;
        b.quadW(
          [P(a, a1), P(a, a0), P(c, a0), P(c, a1)],
          [(k + 1) / RAD, a.y / 1.4, k / RAD, a.y / 1.4, k / RAD, c.y / 1.4, (k + 1) / RAD, c.y / 1.4],
          [c0, c0, cT, cT],
        );
      }
    }
    if (boot) {
      // frond "boot" on top
      const top = ring(1);
      const tip = new THREE.Vector3(LEAN + 0.05, PALM_H + 0.7, 0);
      const bootC = C(0x8a7050);
      for (let k = 0; k < RAD; k++) {
        const a0 = (k / RAD) * Math.PI * 2;
        const a1 = ((k + 1) / RAD) * Math.PI * 2;
        const Q = (ang: number) => new THREE.Vector3(top.off + 0.34 * Math.cos(ang), top.y - 0.2, 0.34 * Math.sin(ang));
        b.tri(Q(a1), Q(a0), tip, [0, 0, 1, 0, 0.5, 1], bootC, bootC, bootC);
      }
    }
    return b;
  };
  const makeCrown = (name: string, n: number, detailed: boolean, deadN: number): Batch => {
    const b = kit.batch({ map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide }, name);
    const green = C(0xffffff);
    const dead = C(0xb08850);
    const frond = (yaw: number, len: number, rise: number, droop: number, c: THREE.Color, pitch = 0) => {
      const rot = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(pitch));
      const at = (s2: number) => new THREE.Vector3(len * s2, rise * s2 - droop * s2 * s2, 0);
      if (!detailed) {
        // far LOD: one diamond (2 triangles) per frond
        for (const side of [-1, 1]) {
          const mid = at(0.5).add(new THREE.Vector3(0, -0.12, side * 0.75));
          const pts = [at(0), at(1), mid].map((p) => p.applyMatrix4(rot));
          const u = side < 0 ? 0 : 1;
          b.tri(pts[0], pts[1], pts[2], [0.5, 0, 0.5, 1, u, 0.5], c, c, c);
        }
        return;
      }
      const S = [0, 0.45, 1];
      const W = [0.14, 0.7, 0.08];
      const path = S.map(at);
      for (let i = 0; i < 2; i++) {
        for (const side of [-1, 1]) {
          const e0 = path[i].clone().add(new THREE.Vector3(0, -0.18 * W[i], side * W[i]));
          const e1 = path[i + 1].clone().add(new THREE.Vector3(0, -0.18 * W[i + 1], side * W[i + 1]));
          const pts = [path[i].clone(), path[i + 1].clone(), e1, e0].map((p) => p.applyMatrix4(rot));
          const u = side < 0 ? 0 : 1;
          upQuad(b, pts, [0.5, S[i], 0.5, S[i + 1], u, S[i + 1], u, S[i]], [c, c, c, c]);
        }
      }
    };
    for (let k = 0; k < n; k++) {
      const yaw = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.4;
      frond(yaw, 3.1 + r() * 0.6, 1.5 + r() * 0.5, 2.4 + r() * 1.2, green);
    }
    for (let k = 0; k < deadN; k++) frond((k / deadN) * Math.PI * 2 + 0.4, 2.2, -0.2, 1.4, dead, -0.9);
    return b;
  };
  const trunkHi = makeTrunk('palm-trunks', [0, 0.05, 0.25, 0.45, 0.65, 0.85, 1], 5, true);
  const trunkLo = makeTrunk('palm-trunks-far', [0, 0.4, 0.75, 1], 4, false);
  const crownHi = makeCrown('palm-crowns', 9, true, 3);
  const crownLo = makeCrown('palm-crowns-far', 7, false, 0);
  interface Palm {
    x: number;
    z: number;
    h: number;
    yaw: number;
    phase: number;
  }
  const palms: Palm[] = [];
  const addPalm = (x: number, z: number, h = 10 + r() * 4) =>
    palms.push({ x, z, h, yaw: r() * Math.PI * 2, phase: r() * 10 });

  /* ---------------------------------------------------------------- */
  /* props                                                            */
  /* ---------------------------------------------------------------- */
  const shadowBlob = (x: number, z: number, rad: number, y = CURB + 0.02) =>
    shadows.quad(I, [
      [x - rad, y, z + rad],
      [x + rad, y, z + rad],
      [x + rad, y, z - rad],
      [x - rad, y, z - rad],
    ]);

  const trashCan = (m: THREE.Matrix4, x: number, z: number, hex = 0x2e5a3a) => {
    plain.cyl(m, x, CURB, z, 0.3, 0.27, 0.86, 8, { color: hex, bottom: mulC(hex, 0.6) });
    plain.cyl(m, x, CURB + 0.86, z, 0.33, 0.33, 0.07, 8, { color: mulC(hex, 0.8) });
  };

  const lampMats: PS1Material[] = [];
  const lamp = (x: number, z: number, dir: 1 | -1, flicker = false) => {
    plain.cyl(I, x, CURB, z, 0.07, 0.11, 7.1, 6, { color: 0x9a9ca2, bottom: 0x5a5c62 });
    plain.box(I, x, 7.0, z + dir * 0.9, 0.1, 0.1, 1.8, { color: 0x8a8c92 });
    const hz = z + dir * 1.95;
    plain.box(I, x, 6.86, hz, 0.34, 0.2, 0.72, { color: 0x7a7c82 });
    let lb = lens;
    if (flicker) {
      lb = kit.batch({ unlit: 1, color: 0xffe2a0 }, 'lamp-lens-flicker');
      lampMats.push(lb.mat);
    }
    lb.quad(I, [
      [x - 0.14, 6.86, hz - 0.3],
      [x + 0.14, 6.86, hz - 0.3],
      [x + 0.14, 6.86, hz + 0.3],
      [x - 0.14, 6.86, hz + 0.3],
    ], [0, 0, 1, 1], 0xffe6a8);
    const pr = 3.6;
    pools.quad(I, [
      [x - pr, 0.02, hz + pr],
      [x + pr, 0.02, hz + pr],
      [x + pr, 0.02, hz - pr],
      [x - pr, 0.02, hz - pr],
    ]);
  };

  // power poles + wires
  const wirePts: number[] = [];
  const poleLine = (z: number, x0: number, x1: number, spacing: number, h = 9.6) => {
    const poles: number[] = [];
    for (let x = x0; x <= x1 + 0.01; x += spacing) poles.push(x);
    for (const x of poles) {
      plain.cyl(I, x, CURB - 0.5, z, 0.11, 0.15, h + 0.5, 5, { color: 0x7a5a40, bottom: 0x4a3828, open: true });
      plain.box(I, x, h - 0.6, z, 0.12, 0.12, 2.6, { color: 0x6a4a34 });
      plain.box(I, x, h - 0.48, z, 0.05, 0.1, 2.1, { color: 0x9ab0a0, only: ['pz', 'nz', 'px', 'nx'] });
      if (r() < 0.4) plain.cyl(I, x + 0.32, h - 2.4, z, 0.22, 0.22, 0.8, 5, { color: 0x8a8e90, bottom: 0x5a5e60 });
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const xa = poles[i];
      const xb = poles[i + 1];
      for (const [dz, yy, sag] of [
        [-1.0, h - 0.4, 1.0],
        [1.0, h - 0.4, 1.1],
        [0, h - 2.1, 1.4],
      ] as const) {
        const N = 8;
        for (let k = 0; k < N; k++) {
          const t0 = k / N;
          const t1 = (k + 1) / N;
          wirePts.push(
            xa + (xb - xa) * t0, yy - 4 * sag * t0 * (1 - t0), z + dz,
            xa + (xb - xa) * t1, yy - 4 * sag * t1 * (1 - t1), z + dz,
          );
        }
      }
    }
  };

  /* ---------------------------------------------------------------- */
  /* lots                                                             */
  /* ---------------------------------------------------------------- */
  const FRONT = -16;
  const lawnTint = (k: number) => lerpC(0xffffff, 0xd6b890, k);
  const chainFence = (m: THREE.Matrix4, xa: number, xb: number, z: number, hgt = 1.15) => {
    if (xb - xa < 0.3) return;
    chain.quad(m, [
      [xa, CURB, z],
      [xb, CURB, z],
      [xb, CURB + hgt, z],
      [xa, CURB + hgt, z],
    ], 1);
    plain.box(m, (xa + xb) / 2, CURB + hgt - 0.03, z, xb - xa, 0.05, 0.05, { color: 0xa0a4a8, skip: ['ny'] });
    const n = Math.max(1, Math.round((xb - xa) / 3));
    for (let i = 0; i <= n; i++)
      plain.box(m, xa + ((xb - xa) * i) / n, CURB, z, 0.06, hgt + 0.05, 0.06, { color: 0x9a9ea2, bottom: 0x6a6e72, only: ['pz', 'nz', 'px', 'nx'] });
  };
  const woodFenceX = (m: THREE.Matrix4, x: number, za: number, zb: number, hgt = 1.8) =>
    wood.box(m, x, CURB, (za + zb) / 2, 0.07, hgt, Math.abs(zb - za), { uv: 1.6, color: 0xe8dcc8, bottom: 0xa89880 });
  const woodFenceZ = (m: THREE.Matrix4, z: number, xa: number, xb: number, hgt = 1.8) =>
    wood.box(m, (xa + xb) / 2, CURB, z, Math.abs(xb - xa), hgt, 0.07, { uv: 1.6, color: 0xe8dcc8, bottom: 0xa89880 });

  interface LotOpts {
    kind: 'house' | 'wall';
    drive: 1 | -1;
    variant: number;
    fence: 'chain' | 'picket' | 'none';
    frontPalm?: boolean;
    backPalm?: boolean;
    car?: { paint: number; pickup?: boolean };
    hoop?: boolean;
    flat?: boolean;
  }
  const lot = (m: THREE.Matrix4, o: LotOpts) => {
    const d0 = o.drive > 0 ? 3.0 : -6.3;
    const d1 = o.drive > 0 ? 6.3 : -3.0;
    const tint = lawnTint(o.kind === 'wall' ? 0.9 : r() * 0.6);
    // yard + driveway
    if (o.kind === 'wall') {
      patch(grass, m, -7, 7, FRONT, -10.5, CURB, { tile: 3, color: tint });
    } else {
      patch(grass, m, -7, d0, FRONT, -10.5, CURB, { tile: 3, color: tint, step: 3 });
      patch(grass, m, d1, 7, FRONT, -10.5, CURB, { tile: 3, color: tint, step: 3 });
      patch(sidewalk, m, d0, d1, FRONT, -10.5, CURB, { tile: 3, color: 0xe0d8cc, step: 3 });
    }
    // backyard fences
    woodFenceX(m, 7, FRONT - 0.2, -32);
    woodFenceZ(m, -32, -7, 7);

    if (o.kind === 'wall') {
      // graffiti wall (cinder block) in the empty lot
      const wx0 = -5.5;
      const wx1 = 4.5;
      const wz = -11.4;
      graffiti.quad(m, [
        [wx0, CURB, wz + 0.15],
        [wx1, CURB, wz + 0.15],
        [wx1, CURB + 2.5, wz + 0.15],
        [wx0, CURB + 2.5, wz + 0.15],
      ], [0, 0, 1, 1], 0xffffff, 0xd8ccc0);
      stucco.box(m, (wx0 + wx1) / 2, CURB, wz, wx1 - wx0, 2.5, 0.3, { uv: 2, color: 0xb8b0a4, bottom: 0x8a8278, skip: ['pz', 'ny'] });
      sidewalk.box(m, (wx0 + wx1) / 2, CURB + 2.5, wz, wx1 - wx0 + 0.1, 0.12, 0.4, { uv: 1, color: 0xd0c8bc });
      // junk: old tyres and a crate
      plain.cyl(m, wx1 + 1.1, CURB, wz + 0.5, 0.36, 0.36, 0.22, 8, { color: 0x1c1c1c });
      plain.cyl(m, wx1 + 1.2, CURB + 0.22, wz + 0.45, 0.36, 0.36, 0.22, 8, { color: 0x222222 });
      wood.box(m, wx0 + 1.5, CURB, wz - 1.2, 0.8, 0.6, 0.8, { uv: 1, color: 0xd8c0a0, bottom: 0x8a7860 });
      chainFence(m, -7, wx0 - 0.1, -10.75, 1.4);
      chainFence(m, wx1 + 0.1, 7, -10.75, 1.4);
    } else {
      const hx0 = o.drive > 0 ? -6.4 : -2.4;
      const hx1 = o.drive > 0 ? 2.4 : 6.4;
      const depth = 8.5 + r() * 1.5;
      const back = FRONT - depth;
      const H = 2.95 + r() * 0.2;
      const sc = STUCCO[Math.floor(r() * STUCCO.length)];
      const scB = mulC(sc, 0.78);
      const cx = (hx0 + hx1) / 2;
      const cz = (FRONT + back) / 2;
      stucco.box(m, cx, CURB, cz, hx1 - hx0, H, depth, { uv: 2.5, color: sc, bottom: scB, skip: ['pz', 'ny', 'py'] });
      facade.quad(m, [
        [hx0, CURB, FRONT],
        [hx1, CURB, FRONT],
        [hx1, CURB + H, FRONT],
        [hx0, CURB + H, FRONT],
      ], facadeUV(o.variant), sc, scB);
      // roof
      const ey = CURB + H;
      const rc = ROOFS[Math.floor(r() * ROOFS.length)];
      if (o.flat) {
        roof.box(m, cx, ey, cz, hx1 - hx0 + 0.5, 0.32, depth + 0.5, {
          uv: 2,
          color: mulC(rc, 0.75),
          faceColor: { ny: 0x6a5a5a, pz: 0xd8d0c8, nz: 0xd8d0c8, px: 0xd8d0c8, nx: 0xd8d0c8 },
          skip: [],
        });
        plain.box(m, cx + 1.5, ey + 0.32, cz - 1, 1.1, 0.7, 0.9, { color: 0xb0b2b4, bottom: 0x7a7c7e });
      } else {
        const ov = 0.5;
        const X0 = hx0 - ov;
        const X1 = hx1 + ov;
        const Z0 = back - ov;
        const Z1 = FRONT + ov;
        const inset = ((Z1 - Z0) / 2) * 0.9;
        let rx0 = X0 + inset;
        let rx1 = X1 - inset;
        if (rx0 > rx1) rx0 = rx1 = (X0 + X1) / 2;
        const ry = ey + 1.1 + r() * 0.3;
        const zc = (Z0 + Z1) / 2;
        roof.hexa(
          m,
          [
            [X0, ey, Z0],
            [X1, ey, Z0],
            [X1, ey, Z1],
            [X0, ey, Z1],
            [rx0, ry, zc],
            [rx1, ry, zc],
            [rx1, ry, zc],
            [rx0, ry, zc],
          ],
          { uv: 2, color: rc, faceColor: { ny: 0x5a4a4a }, skip: [] },
        );
      }
      // porch
      const doorX = hx0 + DOOR_U[o.variant] * (hx1 - hx0);
      sidewalk.box(m, doorX, CURB, FRONT + 0.8, 2.6, 0.22, 1.6, { uv: 1.5, color: 0xd8d0c4 });
      sidewalk.box(m, doorX, CURB, FRONT + 1.85, 1.4, 0.11, 0.5, { uv: 1.5, color: 0xd0c8bc });
      wood.box(m, doorX, CURB + 2.62, FRONT + 0.95, 3.0, 0.12, 1.9, { uv: 2, color: 0xf0ece4, faceColor: { ny: 0xc0b8b0 }, skip: [] });
      for (const s of [-1, 1]) plain.box(m, doorX + s * 1.35, CURB + 0.22, FRONT + 1.75, 0.12, 2.4, 0.12, { color: 0xf4f0e8, bottom: 0xb0aaa0 });
      // fences
      const fz = -10.75;
      // walkway porch → sidewalk, with a gate gap in the fence
      sidewalk.box(m, doorX, CURB, (FRONT + 2.1 - 10.5) / 2, 1.1, 0.07, -10.5 - (FRONT + 2.1), { uv: 1.5, color: 0xd8d0c4 });
      const segs: [number, number][] = [];
      for (const [a, b2] of [
        [-7, d0 - 0.1],
        [d1 + 0.1, 7],
      ] as const) {
        if (doorX > a && doorX < b2) {
          segs.push([a, doorX - 0.65], [doorX + 0.65, b2]);
        } else segs.push([a, b2]);
      }
      for (const [a, b2] of segs) {
        if (b2 - a < 0.3) continue;
        if (o.fence === 'chain') chainFence(m, a, b2, fz);
        else if (o.fence === 'picket') woodFenceZ(m, fz, a, b2, 0.85);
      }
      // mailbox + bins
      plain.box(m, d0 - 0.4, CURB, -10.3, 0.08, 1.0, 0.08, { color: 0x5a5a5a });
      plain.box(m, d0 - 0.4, CURB + 1.0, -10.3, 0.24, 0.24, 0.42, { color: [0x2a3a6a, 0x8a2a2a, 0x2a2a2a][Math.floor(r() * 3)] });
      if (r() < 0.6) trashCan(m, d1 + 0.5, -9.9, r() < 0.5 ? 0x2e5a3a : 0x3a4a6a);
      // car in the driveway (nose towards the street)
      if (o.car) {
        const cm = mul(m, T((d0 + d1) / 2, CURB, -13.2, -Math.PI / 2));
        addCar({ body: carBody, plain, shadow: shadows }, cm, { paint: o.car.paint, pickup: o.car.pickup });
      }
      if (o.hoop) {
        const hxp = (d0 + d1) / 2;
        plain.box(m, hxp, CURB, FRONT + 0.4, 0.12, 3.3, 0.12, { color: 0x7a7c80 });
        plain.box(m, hxp, CURB + 2.75, FRONT + 0.55, 1.2, 0.85, 0.06, { color: 0xf4f4f0, skip: [] });
        plain.box(m, hxp, CURB + 2.95, FRONT + 0.6, 0.5, 0.36, 0.02, { color: 0xc83030, skip: [] });
        plain.box(m, hxp, CURB + 3.0, FRONT + 0.62, 0.42, 0.28, 0.025, { color: 0xf4f4f0, skip: [] });
        const rim = new THREE.TorusGeometry(0.23, 0.025, 3, 10);
        rim.rotateX(Math.PI / 2);
        rim.translate(hxp, CURB + 2.8, FRONT + 0.85);
        plain.geo(m, rim, { color: 0xe86a1a });
        rim.dispose();
      }
    }
    // second row house behind the alley (we see its back)
    {
      const bw = 8 + r() * 3;
      const bx = (r() - 0.5) * 3;
      const bd = 8 + r() * 2;
      const bz = -40 - bd / 2;
      const sc = STUCCO[Math.floor(r() * STUCCO.length)];
      stucco.box(m, bx, CURB, bz, bw, 3, bd, { uv: 2.5, color: sc, bottom: mulC(sc, 0.75), skip: ['ny', 'py'] });
      const ey = CURB + 3;
      const ov = 0.4;
      const inset = (bd / 2 + ov) * 0.9;
      roof.hexa(
        m,
        [
          [bx - bw / 2 - ov, ey, bz - bd / 2 - ov],
          [bx + bw / 2 + ov, ey, bz - bd / 2 - ov],
          [bx + bw / 2 + ov, ey, bz + bd / 2 + ov],
          [bx - bw / 2 - ov, ey, bz + bd / 2 + ov],
          [bx - bw / 2 - ov + inset, ey + 1.2, bz],
          [bx + bw / 2 + ov - inset, ey + 1.2, bz],
          [bx + bw / 2 + ov - inset, ey + 1.2, bz],
          [bx - bw / 2 - ov + inset, ey + 1.2, bz],
        ],
        { uv: 2, color: ROOFS[Math.floor(r() * ROOFS.length)], faceColor: { ny: 0x5a4a4a }, skip: [] },
      );
    }
    // palms (positions in local space → world)
    const wp = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(m);
    if (o.frontPalm) {
      const p = wp(o.drive > 0 ? -5.4 : 5.4, -12.4);
      addPalm(p.x, p.z);
    }
    if (o.backPalm) {
      const p = wp((r() - 0.5) * 10, -27 - r() * 3);
      addPalm(p.x, p.z, 12 + r() * 4);
    }
  };

  const lotN = (xc: number) => T(xc, 0, 0);
  const lotS = (xc: number) => T(xc, 0, 0, Math.PI);
  LOTS.forEach((xc, i) => {
    const near = Math.abs(xc) < 30;
    lot(lotN(xc), {
      kind: xc === 2 ? 'wall' : 'house',
      drive: i % 3 === 1 ? -1 : 1,
      variant: (i * 3 + 1) % 4,
      fence: (['chain', 'picket', 'chain', 'none'] as const)[i % 4],
      frontPalm: i % 2 === 0 || xc === 2,
      backPalm: near || i % 3 === 0,
      flat: i % 4 === 3,
      car: xc === 16 ? { paint: 0xd8d0c0 } : xc === -54 ? { paint: 0x6a2a2a, pickup: true } : undefined,
    });
    lot(lotS(xc), {
      kind: 'house',
      drive: i % 2 === 0 ? 1 : -1,
      variant: (i * 5 + 2) % 4,
      fence: (['picket', 'chain', 'none', 'chain'] as const)[i % 4],
      frontPalm: i % 2 === 1 || xc === 2,
      backPalm: near || i % 3 === 1,
      flat: i % 3 === 2,
      hoop: xc === 2,
      car: xc === 16 ? { paint: 0x3a5a8a } : xc === -40 ? { paint: 0xc8a040 } : undefined,
    });
  });
  // court-end lots facing -X
  for (const tz of [-7, 7]) {
    lot(T(38.5, 0, tz, -Math.PI / 2), {
      kind: 'house',
      drive: tz < 0 ? -1 : 1,
      variant: tz < 0 ? 0 : 2,
      fence: 'chain',
      frontPalm: true,
      backPalm: true,
    });
  }
  // walls along the court sides
  for (const s of [-1, 1]) {
    stucco.box(I, 38, CURB, s * 17.4, 22, 2.0, 0.3, { uv: 2, color: 0xd8c0a8, bottom: 0x9a8270 });
    addPalm(31, s * 19);
    addPalm(44, s * 20, 14);
  }
  // street palms in the far yards past the lots
  for (let x = -140; x > -220; x -= 16) {
    addPalm(x, -12 - r() * 2);
    addPalm(x - 8, 12 + r() * 2);
  }
  // distant rooftops & palms (fogged silhouettes beyond the second row)
  for (let i = 0; i < 46; i++) {
    const s = i % 2 ? 1 : -1;
    const z = s * (56 + r() * 60);
    const x = -200 + r() * 330;
    const bw = 8 + r() * 4;
    const bd = 7 + r() * 3;
    const sc = STUCCO[Math.floor(r() * STUCCO.length)];
    stucco.box(T(x, 0, z, (r() - 0.5) * 0.2), 0, CURB, 0, bw, 3, bd, { uv: 2.5, color: sc, skip: ['ny', 'py'] });
    roof.box(T(x, 0, z, 0), 0, CURB + 3, 0, bw + 0.6, 0.6, bd + 0.6, { uv: 2, color: ROOFS[i % ROOFS.length] });
    if (i % 3 === 0) addPalm(x + 6, z + s * 3, 13 + r() * 5);
  }

  // street furniture
  lamp(-37, -7.9, 1);
  lamp(-7.5, -7.9, 1, true);
  lamp(22, -7.9, 1);
  lamp(-22, 7.9, -1);
  lamp(8, 7.9, -1);
  lamp(37, 7.9, -1);
  poleLine(-10.1, -116, 52, 28);
  poleLine(-35.5, -125, 55, 30);
  poleLine(10.1, -102, 38, 28);
  poleLine(35.5, -110, 50, 32);
  // hydrants
  for (const [x, z] of [
    [3.8, -9.6],
    [-15, 9.4],
  ]) {
    plain.cyl(I, x, CURB, z, 0.12, 0.14, 0.55, 6, { color: 0xd8b028, bottom: 0x9a7a18 });
    plain.cyl(I, x, CURB + 0.55, z, 0.02, 0.13, 0.14, 6, { color: 0xd8b028 });
    plain.box(I, x, CURB + 0.3, z, 0.4, 0.08, 0.08, { color: 0xc8a020 });
  }
  trashCan(I, -2.6, -9.9);
  trashCan(I, -1.8, -10.0, 0x3a3a3a);
  // cars at the curbs (outside the fight zone)
  addCar({ body: carBody, plain, shadow: shadows }, T(-26, 0, -6.3), { paint: 0xc8b48a });
  addCar({ body: carBody, plain, shadow: shadows }, T(-44, 0, 6.3, Math.PI), { paint: 0x6a6a7a, pickup: true });
  addCar({ body: carBody, plain, shadow: shadows }, T(40, 0, 9.5, 0.7), { paint: 0x8a2a6a });

  // the green lowrider (own group: hydraulics bounce)
  const lowOuter = new THREE.Group();
  lowOuter.position.set(-7.2, CURB, -13.1);
  lowOuter.rotation.y = -Math.PI / 2;
  const lowInner = new THREE.Group();
  lowOuter.add(lowInner);
  kit.group.add(lowOuter);
  {
    const lb = kit.batch(carBody.mat, 'lowrider-body', lowInner);
    const lp = kit.batch(plain.mat, 'lowrider-trim', lowInner);
    addCar({ body: lb, plain: lp }, I, { paint: 0x2f9a52, lowrider: true, chrome: 0xe8e8e8 });
    // chrome side strip + continental kit
    for (const s of [-1, 1]) lp.box(I, 0, 0.47, s * 0.985, 4.6, 0.04, 0.02, { color: 0xf0f0f0, skip: [] });
    lp.cyl(T(-2.75, 0.5, 0, 0, 0, Math.PI / 2), 0, -0.12, 0, 0.3, 0.3, 0.24, 8, { color: 0x2f9a52 });
  }
  shadows.quad(T(-7.2, 0, -13.1, -Math.PI / 2), [
    [-3.1, CURB + 0.02, 1.4],
    [3.1, CURB + 0.02, 1.4],
    [3.1, CURB + 0.02, -1.4],
    [-3.1, CURB + 0.02, -1.4],
  ]);

  // wires
  const wireMat = kit.mat({ color: 0x24161e, unlit: 1 });
  kit.lines(wirePts, wireMat);

  // palms → instanced meshes (two LODs)
  const near = palms.filter((p) => Math.hypot(p.x, p.z) < 48);
  const farP = palms.filter((p) => Math.hypot(p.x, p.z) >= 48);
  const palmSets = [
    { list: near, trunks: kit.instanced(trunkHi, near.length), crowns: kit.instanced(crownHi, near.length), base: [] as THREE.Matrix4[] },
    { list: farP, trunks: kit.instanced(trunkLo, farP.length), crowns: kit.instanced(crownLo, farP.length), base: [] as THREE.Matrix4[] },
  ];
  for (const set of palmSets) {
    set.list.forEach((p, i) => {
      const s = p.h / PALM_H;
      const m = T(p.x, CURB, p.z, p.yaw, 0, 0, s);
      set.trunks.setMatrixAt(i, m);
      const top = new THREE.Vector3(LEAN, PALM_H + 0.25, 0).applyMatrix4(m);
      set.base.push(T(top.x, top.y, top.z, p.yaw + 1.3, 0, 0, 0.75 + 0.25 * s));
      set.crowns.setMatrixAt(i, set.base[i]);
      if (set.list === near) shadowBlob(p.x, p.z, 0.8);
    });
    set.trunks.instanceMatrix.needsUpdate = true;
    set.crowns.instanceMatrix.needsUpdate = true;
  }

  // birds circling above the north rooftops
  const birdB = kit.batch({ unlit: 1, color: 0x2a1a26, side: THREE.DoubleSide }, 'birds');
  {
    const c = C(0xffffff);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    birdB.tri(V(0, 0, 0.18), V(0, 0, -0.18), V(-0.85, 0.25, -0.1), [0, 0, 0, 0, 0, 0], c, c, c);
    birdB.tri(V(0, 0, -0.18), V(0, 0, 0.18), V(0.85, 0.25, -0.1), [0, 0, 0, 0, 0, 0], c, c, c);
  }
  const BIRDS = 7;
  const birds = kit.instanced(birdB, BIRDS);
  const birdP = Array.from({ length: BIRDS }, () => ({
    rad: 9 + r() * 12,
    speed: 0.25 + r() * 0.2,
    phase: r() * Math.PI * 2,
    y: 15 + r() * 6,
    flap: 5 + r() * 3,
  }));

  kit.finish();

  /* ---------------------------------------------------------------- */
  /* env                                                              */
  /* ---------------------------------------------------------------- */
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const swayM = new THREE.Matrix4();
  const lampOn = C(0xffe2a0);
  const lampOff = C(0x6a5a40);

  return {
    group: kit.group,
    clearColor: C(FOG),
    fogColor: C(FOG),
    fogNear: 30,
    fogFar: 175,
    lightDir: keyDir,
    lightColor: new THREE.Color(0.86, 0.55, 0.36),
    ambient: new THREE.Color(0.58, 0.45, 0.58),
    update(t: number) {
      // palm crowns sway
      for (const set of palmSets) {
        set.list.forEach((p, i) => {
          swayM.makeRotationFromEuler(
            tmpE.set(Math.sin(t * 0.9 + p.phase) * 0.05, 0, Math.sin(t * 0.7 + p.phase * 1.3) * 0.06),
          );
          tmpM.multiplyMatrices(set.base[i], swayM);
          set.crowns.setMatrixAt(i, tmpM);
        });
        set.crowns.instanceMatrix.needsUpdate = true;
      }
      // birds
      birdP.forEach((b, i) => {
        const a = b.phase + t * b.speed;
        tmpP.set(-12 + Math.cos(a) * b.rad, b.y + Math.sin(t * 0.5 + i) * 0.8, -58 + Math.sin(a) * b.rad);
        tmpQ.setFromEuler(tmpE.set(0, -a, 0));
        const f = Math.sin(t * b.flap + i);
        tmpS.set(1.6, 1.6 * f, 1.6);
        tmpM.compose(tmpP, tmpQ, tmpS);
        birds.setMatrixAt(i, tmpM);
      });
      birds.instanceMatrix.needsUpdate = true;
      // flickering street lamp
      const fl = Math.sin(t * 23.0) * Math.sin(t * 7.3 + 1.2) + Math.sin(t * 1.7);
      for (const m of lampMats) (m.uniforms.uColor.value as THREE.Color).copy(fl > 0.55 ? lampOff : lampOn);
      // lowrider hydraulics: a hop sequence every 7 s
      const ph = t % 7;
      if (ph < 2.6) {
        const env = Math.sin((ph / 2.6) * Math.PI);
        const hop = Math.abs(Math.sin(ph * Math.PI * 2.2));
        lowInner.position.y = hop * 0.38 * env;
        lowInner.rotation.z = Math.sin(ph * Math.PI * 2.2) * 0.12 * env;
      } else {
        lowInner.position.y = 0;
        lowInner.rotation.z = 0;
      }
    },
    dispose() {
      kit.dispose();
    },
  };
}

export const hood: StageDef = {
  id: 'hood',
  name: 'SUNSET HOOD',
  subtitle: 'Los Santos, cul-de-sac',
  music: 'hood',
  build,
};
