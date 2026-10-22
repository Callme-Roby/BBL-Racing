import * as THREE from 'three';
import type { Ribbon, Theme, Track } from '../race/track';
import { blob, C, clamp, crack, decal, hillRing, Kit, noiseRect, px, radialSprite, skyDome, T, type Batch } from './stages/kit';
import { addCar, carTexture, type CarBatches } from './stages/props';
import type { PS1Material } from './ps1Material';

/**
 * Builds the 3D world of a circuit: the road ribbon (asphalt / planks / concrete), rumble
 * strips, shoulders, walls, the structure under raised sections, the start gate, boost
 * pads, ramps, anti-gravity glow, then the sky and the scenery of the theme.
 *
 * Everything static is merged per material (Kit batches): a whole circuit is ~20 draw calls.
 */

export interface TrackEnv {
  group: THREE.Group;
  clearColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  ambient: THREE.Color;
  /** colour of the dust kicked up offroad */
  dust: number;
  /** animated parts (boost pads, neon, clouds) */
  update(t: number): void;
  dispose(): void;
}

interface ThemeStyle {
  fog: number;
  fogNear: number;
  fogFar: number;
  sky: [number, number][];
  sunDir: THREE.Vector3;
  sunColor: number;
  lightColor: [number, number, number];
  ambient: [number, number, number];
  road: number;
  roadLine: string;
  shoulder: number;
  ground: number;
  curbA: string;
  curbB: string;
  wall: number;
  wallTop: number;
  under: number;
  dust: number;
  hills: [number, number];
}

const STYLES: Record<Theme, ThemeStyle> = {
  // Sunset Hood: Los Santos cul-de-sac at sunset
  hood: {
    fog: 0xe39270,
    fogNear: 40,
    fogFar: 230,
    sky: [
      [-90, 0xc07468],
      [-4, 0xe39270],
      [0, 0xe39270],
      [3, 0xf0a46c],
      [8, 0xf6b46e],
      [14, 0xf09060],
      [22, 0xdc6c6e],
      [32, 0xb24e7c],
      [46, 0x723c7e],
      [64, 0x3c2c66],
      [90, 0x231d4a],
    ],
    sunDir: new THREE.Vector3(-0.2, 0.12, -0.97).normalize(),
    sunColor: 0xffe2a0,
    lightColor: [0.86, 0.6, 0.42],
    ambient: [0.58, 0.47, 0.58],
    road: 0x58545a,
    roadLine: '#d9b04a',
    shoulder: 0x9a8a50,
    ground: 0x8c8048,
    curbA: '#d8d4c8',
    curbB: '#c03a2e',
    wall: 0xd8c8b0,
    wallTop: 0x8a7a68,
    under: 0x8a7a70,
    dust: 0xc0a070,
    hills: [0xae6276, 0xd88a78],
  },
  // Sky Dojo: wooden walkways above the clouds
  dojo: {
    fog: 0xcfe0f2,
    fogNear: 70,
    fogFar: 420,
    sky: [
      [-90, 0xf4f6fa],
      [-10, 0xdfe8f4],
      [0, 0xcfe0f2],
      [10, 0xa8c8ec],
      [30, 0x6c9ee0],
      [60, 0x3a6ccc],
      [90, 0x2a50b0],
    ],
    sunDir: new THREE.Vector3(0.45, 0.78, 0.48).normalize(),
    sunColor: 0xfff8e8,
    lightColor: [0.78, 0.74, 0.66],
    ambient: [0.52, 0.56, 0.68],
    road: 0x9a6438,
    roadLine: '#e8d8b0',
    shoulder: 0x7a7e70,
    ground: 0xffffff,
    curbA: '#f2ead6',
    curbB: '#b8282a',
    wall: 0xb82a24,
    wallTop: 0x2a1a14,
    under: 0x5a3a22,
    dust: 0xf2f0ea,
    hills: [0xffffff, 0xe8eef8],
  },
  // Neon Parking: rooftops and ramps of a car park at night
  parking: {
    fog: 0x1c1834,
    fogNear: 30,
    fogFar: 220,
    sky: [
      [-90, 0x0c0a18],
      [-4, 0x2a2244],
      [0, 0x3a2c58],
      [6, 0x2c2450],
      [20, 0x1a1636],
      [50, 0x0e0c22],
      [90, 0x07060f],
    ],
    sunDir: new THREE.Vector3(0.28, 0.82, 0.5).normalize(),
    sunColor: 0xd8dcff,
    lightColor: [0.5, 0.5, 0.72],
    ambient: [0.34, 0.3, 0.5],
    road: 0x6a6a70,
    roadLine: '#e8c030',
    shoulder: 0x4a4a52,
    ground: 0x26242e,
    curbA: '#e8c030',
    curbB: '#202024',
    wall: 0x8a8a90,
    wallTop: 0xe8c030,
    under: 0x5a5a62,
    dust: 0x9a9aa8,
    hills: [0x22203a, 0x2a2648],
  },
  // BBL Beach: boardwalk, sand and palm trees under a hot sun
  beach: {
    fog: 0xbfe6f4,
    fogNear: 60,
    fogFar: 300,
    sky: [
      [-90, 0x4ab0d0],
      [-2, 0xbfe6f4],
      [0, 0xbfe6f4],
      [8, 0x8ed2f2],
      [30, 0x48a8e8],
      [90, 0x1a6cd0],
    ],
    sunDir: new THREE.Vector3(-0.4, 0.75, 0.5).normalize(),
    sunColor: 0xfffbe0,
    lightColor: [0.95, 0.9, 0.78],
    ambient: [0.55, 0.6, 0.66],
    road: 0x6a6670,
    roadLine: '#f2f2ea',
    shoulder: 0xe8d29a,
    ground: 0xe6cc90,
    curbA: '#f2f2ea',
    curbB: '#2a8ad8',
    wall: 0xf0e6d0,
    wallTop: 0x2a8ad8,
    under: 0x9a8a78,
    dust: 0xf0dca8,
    hills: [0x5a9a6a, 0x80b880],
  },
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildTrackEnv(track: Track): TrackEnv {
  const theme = track.def.theme;
  const st = STYLES[theme];
  const kit = new Kit(0x5eed + track.def.id.length * 977, 'track:' + track.def.id);
  const r = kit.rand;

  // ---------------------------------------------------------------- textures
  const roadTex = kit.tex(64, 64, (ctx, w, h) => {
    if (theme === 'dojo') {
      // wooden planks across the road
      noiseRect(ctx, 0, 0, w, h, r, st.road, 22, 0.2);
      for (let y = 0; y < h; y += 8) {
        ctx.fillStyle = 'rgba(40,20,10,0.6)';
        ctx.fillRect(0, y, w, 1);
        for (let x = 0; x < w; x += 2) if (r() < 0.25) px(ctx, x, y + 1 + Math.floor(r() * 6), w, h, 'rgba(60,30,14,0.35)');
      }
      for (let i = 0; i < 10; i++) px(ctx, r() * w, r() * h, w, h, '#2a160a');
    } else {
      noiseRect(ctx, 0, 0, w, h, r, st.road, 20, 0.12);
      for (let i = 0; i < 5; i++) crack(ctx, w, h, r, r() * w, r() * h, 6 + r() * 10, 'rgba(24,22,28,0.5)');
      for (let i = 0; i < 5; i++) blob(ctx, w, h, r, r() * w, r() * h, 2 + r() * 3, 'rgba(14,12,16,0.3)', 0.6);
    }
    // edge lines + centre dashes (u = across the road)
    ctx.fillStyle = theme === 'dojo' ? 'rgba(232,216,176,0.0)' : '#d8d4cc';
    ctx.fillRect(2, 0, 2, h);
    ctx.fillRect(w - 4, 0, 2, h);
    ctx.fillStyle = st.roadLine;
    if (theme !== 'dojo') for (let y = 0; y < h; y++) if (y % 32 < 16) ctx.fillRect(w / 2 - 1, y, 2, 1);
  });
  const curbTex = kit.tex(8, 16, (ctx, w, h) => {
    ctx.fillStyle = st.curbA;
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = st.curbB;
    ctx.fillRect(0, h / 2, w, h / 2);
  });
  const shoulderTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, st.shoulder, 26, 0.25);
    if (theme === 'hood' || theme === 'beach') for (let i = 0; i < 40; i++) px(ctx, r() * w, r() * h, w, h, theme === 'hood' ? 'rgba(70,90,40,0.6)' : 'rgba(255,250,230,0.5)');
  });
  const groundTex = kit.tex(64, 64, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, st.ground, 22, 0.2);
    if (theme === 'hood') {
      for (let i = 0; i < 14; i++) blob(ctx, w, h, r, r() * w, r() * h, 2 + r() * 5, 'rgba(90,110,50,0.45)', 0.5);
      for (let i = 0; i < 60; i++) px(ctx, r() * w, r() * h, w, h, 'rgba(60,50,30,0.5)');
    } else if (theme === 'parking') {
      ctx.fillStyle = 'rgba(232,192,48,0.35)';
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 1, h);
    } else if (theme === 'beach') {
      for (let i = 0; i < 80; i++) px(ctx, r() * w, r() * h, w, h, r() < 0.5 ? 'rgba(255,248,220,0.6)' : 'rgba(180,150,90,0.5)');
    }
  });
  const wallTex = kit.tex(32, 16, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, st.wall, 14, 0.1);
    ctx.fillStyle = `rgb(${(st.wallTop >> 16) & 255},${(st.wallTop >> 8) & 255},${st.wallTop & 255})`;
    ctx.fillRect(0, 0, w, 3);
    if (theme === 'parking') {
      ctx.fillStyle = '#202024';
      for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 4, 3);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - 2, w, 2);
    ctx.fillRect(w - 1, 0, 1, h);
  });
  const underTex = kit.tex(32, 32, (ctx, w, h) => {
    noiseRect(ctx, 0, 0, w, h, r, st.under, 18, 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 1);
  });
  const glowTex = kit.tex(32, 32, (ctx, w, h) => radialSprite(ctx, w, h, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.4)'), false);
  const padTex = kit.tex(16, 32, (ctx, w, h) => {
    ctx.fillStyle = '#ff7a10';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe040';
    for (let k = 0; k < 2; k++) {
      const y0 = k * 16;
      ctx.beginPath();
      ctx.moveTo(w / 2, y0 + 2);
      ctx.lineTo(w - 2, y0 + 10);
      ctx.lineTo(w - 5, y0 + 12);
      ctx.lineTo(w / 2, y0 + 7);
      ctx.lineTo(5, y0 + 12);
      ctx.lineTo(2, y0 + 10);
      ctx.closePath();
      ctx.fill();
    }
  });
  const checkerTex = kit.tex(16, 4, (ctx, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x, y, 1, 1);
    }
  });

  // ---------------------------------------------------------------- batches
  const road = kit.batch({ map: roadTex, vertexColors: true }, 'road');
  const dirt = kit.batch({ map: shoulderTex, vertexColors: true }, 'dirt-road');
  const curbs = kit.batch({ map: curbTex, vertexColors: true }, 'curbs');
  const shoulder = kit.batch({ map: shoulderTex, vertexColors: true }, 'shoulder');
  const walls = kit.batch({ map: wallTex, vertexColors: true, side: THREE.DoubleSide }, 'walls');
  const under = kit.batch({ map: underTex, vertexColors: true }, 'under');
  const glowMat = kit.mat({ unlit: 1, vertexColors: true, fog: false });
  const agGlow = kit.batch(glowMat, 'antigrav-edges');
  const padMat = decal(kit.mat({ map: padTex, unlit: 0.9, vertexColors: true }));
  const pads = kit.batch(padMat, 'boost-pads');
  const checker = kit.batch(decal(kit.mat({ map: checkerTex, vertexColors: true })), 'start-line');
  const white = C(0xffffff);

  const tile = 8; // metres of road per texture repeat
  for (const rb of track.ribbons) buildRibbon(rb, rb.surface === 'dirt' ? dirt : road);

  function buildRibbon(rb: Ribbon, surf: Batch) {
    const N = rb.count;
    const last = rb.closed ? N : N - 1;
    const sh = track.shoulder;
    for (let j = 0; j < last; j++) {
      const a = rb.sample(j);
      const b = rb.sample(j + 1);
      const va = a.s / tile;
      const vb = (j + 1 === N && rb.closed ? rb.length : b.s) / tile;
      const at = (sm: typeof a, d: number, lift = 0) => sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, lift);
      const ag = a.antigrav || b.antigrav;
      const shade = (sm: typeof a) => white.clone().multiplyScalar(sm.antigrav ? 0.85 : 1);
      const ca = shade(a);
      const cb = shade(b);
      const inner = rb.surface === 'dirt' ? 0 : 0.7;
      // road surface (between the rumble strips)
      surf.quadW([at(a, -a.w + inner), at(a, a.w - inner), at(b, b.w - inner), at(b, -b.w + inner)], [0, va, 1, va, 1, vb, 0, vb], [ca, ca, cb, cb]);
      if (rb.surface !== 'dirt') {
        // rumble strips
        for (const side of [-1, 1]) {
          const p0 = at(a, side * (a.w - inner), 0.01);
          const p1 = at(a, side * a.w, 0.03);
          const q1 = at(b, side * b.w, 0.03);
          const q0 = at(b, side * (b.w - inner), 0.01);
          const uv = [0, a.s / 2, 1, a.s / 2, 1, (a.s + (b.s - a.s || 1)) / 2, 0, (a.s + (b.s - a.s || 1)) / 2];
          if (side < 0) curbs.quadW([p1, p0, q0, q1], uv, [ca, ca, cb, cb]);
          else curbs.quadW([p0, p1, q1, q0], uv, [ca, ca, cb, cb]);
        }
      }
      // shoulders (offroad strip), unless a wall stands right there
      for (const side of [-1, 1]) {
        const p0 = at(a, side * a.w, 0.02);
        const p1 = at(a, side * (a.w + sh), 0.0);
        const q1 = at(b, side * (b.w + sh), 0.0);
        const q0 = at(b, side * b.w, 0.02);
        const g0 = C(0xffffff).multiplyScalar(0.92);
        if (side < 0) shoulder.quadW([p1, p0, q0, q1], [p1.x / 4, p1.z / 4, p0.x / 4, p0.z / 4, q0.x / 4, q0.z / 4, q1.x / 4, q1.z / 4], [g0, g0, g0, g0]);
        else shoulder.quadW([p0, p1, q1, q0], [p0.x / 4, p0.z / 4, p1.x / 4, p1.z / 4, q1.x / 4, q1.z / 4, q0.x / 4, q0.z / 4], [g0, g0, g0, g0]);
        // walls on the outer edge of the shoulder
        const wallHere = side < 0 ? a.wallL && b.wallL : a.wallR && b.wallR;
        if (wallHere) {
          const H = 1.1;
          const w0 = at(a, side * (a.w + sh), 0);
          const w1 = at(b, side * (b.w + sh), 0);
          const t0 = w0.clone().addScaledVector(a.u, H);
          const t1 = w1.clone().addScaledVector(b.u, H);
          const wc = white;
          const wb = C(0xffffff).multiplyScalar(0.7);
          const u0 = a.s / 3;
          const u1 = (a.s + (b.s - a.s || 1)) / 3;
          if (side < 0) walls.quadW([w1, w0, t0, t1], [u1, 0, u0, 0, u0, 1, u1, 1], [wb, wb, wc, wc]);
          else walls.quadW([w0, w1, t1, t0], [u0, 0, u1, 0, u1, 1, u0, 1], [wb, wb, wc, wc]);
          // top cap
          const o0 = t0.clone().addScaledVector(a.r, side * 0.35);
          const o1 = t1.clone().addScaledVector(b.r, side * 0.35);
          if (side < 0) walls.quadW([t1, t0, o0, o1], [0, 0, 0, 0, 0, 0.1, 0, 0.1], [wc, wc, wc, wc]);
          else walls.quadW([t0, t1, o1, o0], [0, 0, 0, 0, 0, 0.1, 0, 0.1], [wc, wc, wc, wc]);
        }
        // anti-gravity: glowing blue edges
        if (ag) {
          const e0 = at(a, side * (a.w + 0.15), 0.05);
          const e1 = at(b, side * (b.w + 0.15), 0.05);
          const f0 = at(a, side * (a.w + 0.55), 0.05);
          const f1 = at(b, side * (b.w + 0.55), 0.05);
          const gc = C(0x40d8ff);
          const gc2 = C(0x6a50ff);
          if (side < 0) agGlow.quadW([f1, f0, e0, e1], [0, 0, 0, 0, 0, 0, 0, 0], [gc2, gc2, gc, gc]);
          else agGlow.quadW([e0, e1, f1, f0], [0, 0, 0, 0, 0, 0, 0, 0], [gc, gc, gc2, gc2]);
        }
      }
      // structure under raised parts: side skirts down to the ground (or a deck slab over the void)
      const groundY = track.groundY;
      const raised = (sm: typeof a) => sm.p.y - groundY > 0.6 || track.hasVoid;
      if (raised(a) || raised(b)) {
        const depth = (sm: typeof a) => (track.hasVoid ? 1.6 : Math.max(0.2, sm.p.y - groundY + 0.3));
        for (const side of [-1, 1]) {
          const top0 = at(a, side * (a.w + sh), 0);
          const top1 = at(b, side * (b.w + sh), 0);
          const bot0 = track.hasVoid ? top0.clone().addScaledVector(a.u, -depth(a)) : V(top0.x, groundY - 0.3, top0.z);
          const bot1 = track.hasVoid ? top1.clone().addScaledVector(b.u, -depth(b)) : V(top1.x, groundY - 0.3, top1.z);
          const c0 = C(0xffffff);
          const c1 = C(0xffffff).multiplyScalar(0.55);
          const uA = a.s / 4;
          const uB = (a.s + (b.s - a.s || 1)) / 4;
          if (side > 0) under.quadW([bot0, bot1, top1, top0], [uA, 0, uB, 0, uB, 1, uA, 1], [c1, c1, c0, c0]);
          else under.quadW([bot1, bot0, top0, top1], [uB, 0, uA, 0, uA, 1, uB, 1], [c1, c1, c0, c0]);
        }
        if (track.hasVoid) {
          // bottom slab
          const l0 = at(a, -(a.w + sh), -depth(a));
          const r0 = at(a, a.w + sh, -depth(a));
          const l1 = at(b, -(b.w + sh), -depth(b));
          const r1 = at(b, b.w + sh, -depth(b));
          const cd = C(0xffffff).multiplyScalar(0.5);
          under.quadW([l0, r0, r1, l1].reverse(), [0, 0, 1, 0, 1, 1, 0, 1], [cd, cd, cd, cd]);
        } else if (raised(a) && raised(b) && j % 14 === 0 && rb.isMain) {
          // columns under a bridge, each one stopping just under the (maybe banked) road
          for (const d of [-a.w * 0.55, a.w * 0.55]) {
            const top = at(a, d, -0.35);
            const h = top.y - groundY;
            if (h > 1.2) under.box(T(top.x, groundY, top.z, Math.atan2(a.t.x, a.t.z)), 0, 0, 0, 1.1, h, 1.1, { color: 0xd0d0d0, bottom: 0x808080, uv: 3 });
          }
        }
      }
    }
  }

  // kicker ramps (partial width): wedges on the road
  for (const k of track.kickers) {
    const rb = k.ribbon;
    const steps = Math.max(2, Math.round(k.len / 1.5));
    for (let i = 0; i < steps; i++) {
      const s0 = k.s + (k.len * i) / steps;
      const s1 = k.s + (k.len * (i + 1)) / steps;
      const a = rb.sample(rb.indexAt(s0));
      const b = rb.sample(rb.indexAt(s1));
      const h0 = k.h * Math.pow(i / steps, 1.6);
      const h1 = k.h * Math.pow((i + 1) / steps, 1.6);
      const P = (sm: typeof a, d: number, h: number) => sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, h + 0.02);
      const ca = C(0xffd040);
      const cb = C(0xff7020);
      pads.quadW([P(a, k.d0, h0), P(a, k.d1, h0), P(b, k.d1, h1), P(b, k.d0, h1)], [0, 0, 1, 0, 1, 1, 0, 1], [ca, ca, cb, cb]);
      for (const [d, sgn] of [
        [k.d0, -1],
        [k.d1, 1],
      ] as const) {
        const q = [P(a, d, 0), P(b, d, 0), P(b, d, h1), P(a, d, h0)];
        under.quadW(sgn > 0 ? q : [q[1], q[0], q[3], q[2]], [0, 0, 1, 0, 1, 1, 0, 1], [white, white, white, white]);
      }
      if (i === steps - 1) under.quadW([P(b, k.d1, 0), P(b, k.d0, 0), P(b, k.d0, h1), P(b, k.d1, h1)], [0, 0, 1, 0, 1, 1, 0, 1], [white, white, white, white]);
    }
  }

  // full-width ramps: chevrons on the slope, a stripe on the lip
  for (const rp of track.def.features.ramps ?? []) {
    if (rp.d0 !== undefined) continue;
    const rb = track.main;
    const a = rb.sample(rb.indexAt(rp.s + rp.len * 0.25));
    const b = rb.sample(rb.indexAt(rp.s + rp.len));
    const w = Math.min(a.w, b.w) - 0.8;
    const ca = C(0xffe040);
    const P = (sm: typeof a, d: number) => sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, 0.04);
    pads.quadW([P(a, -w), P(a, w), P(b, w), P(b, -w)], [0, 0, 4, 0, 4, 2, 0, 2], [ca, ca, ca, ca]);
  }

  // boost pads
  for (const bp of track.boosts) {
    const rb = bp.ribbon;
    const a = rb.sample(rb.indexAt(bp.s - bp.len / 2));
    const b = rb.sample(rb.indexAt(bp.s + bp.len / 2));
    const P = (sm: typeof a, d: number) => sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, 0.04);
    pads.quadW([P(a, bp.d - bp.w), P(a, bp.d + bp.w), P(b, bp.d + bp.w), P(b, bp.d - bp.w)], [0, 0, 1, 0, 1, bp.len / 3, 0, bp.len / 3], [white, white, white, white]);
  }

  // start / finish line + gate
  {
    const rb = track.main;
    const a = rb.sample(0);
    const b = rb.sample(2);
    const P = (sm: typeof a, d: number) => sm.p.clone().addScaledVector(sm.r, d).addScaledVector(sm.u, 0.03);
    checker.quadW([P(a, -a.w), P(a, a.w), P(b, b.w), P(b, -b.w)], [0, 0, 8, 0, 8, 1, 0, 1], [white, white, white, white]);
    const gate = kit.batch({ vertexColors: true }, 'gate');
    const yaw = Math.atan2(a.t.x, a.t.z);
    const span = a.w + track.shoulder * 0.6;
    for (const side of [-1, 1]) {
      const base = a.p.clone().addScaledVector(a.r, side * span);
      gate.box(T(base.x, base.y, base.z, yaw), 0, 0, 0, 0.6, 6.2, 0.6, { color: 0xe8e8e8, bottom: 0x8a8a8a });
    }
    const top = a.p.clone().addScaledVector(a.u, 5.2);
    gate.box(T(top.x, top.y, top.z, yaw), 0, 0, 0, span * 2 + 0.6, 1.4, 0.5, { color: 0x1a1a22 });
    // banner: "BBL KART" painted on a texture
    const banTex = kit.tex(128, 16, (ctx, w, h) => {
      ctx.fillStyle = '#16141c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff8a1c';
      ctx.font = 'bold 13px Impact, Arial Black, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BBL KART', w / 2, h / 2 + 1);
      ctx.fillStyle = '#ffd040';
      for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 4, 1);
      for (let x = 4; x < w; x += 8) ctx.fillRect(x, h - 1, 4, 1);
    }, false);
    const ban = kit.batch({ map: banTex, unlit: 0.6 }, 'banner');
    for (const face of [1, -1]) {
      const m = T(top.x, top.y, top.z, yaw + (face < 0 ? Math.PI : 0));
      ban.quad(m, [
        [span, 0.05, 0.26],
        [-span, 0.05, 0.26],
        [-span, 1.35, 0.26],
        [span, 1.35, 0.26],
      ]);
    }
  }

  // ---------------------------------------------------------------- sky, ground
  skyDome(kit, { radius: 480, stops: st.sky, glow: { dir: st.sunDir, color: st.sunColor, amount: 0.8, power: 12 } });
  const far = kit.batch({ unlit: 1, fog: false }, 'far');
  if (theme !== 'dojo') {
    hillRing(far, { radius: 430, seg: 64, base: -10, height: (a) => 26 + 14 * Math.sin(3 * a + 1) + 8 * Math.sin(7 * a + 2), top: st.hills[0], bottom: st.hills[1] });
  }
  // the ground is drawn first and writes no depth: the road lying on it can never z-fight with it
  const groundBatch = kit.batch({ map: groundTex, vertexColors: true, depthWrite: false }, 'ground');
  groundBatch.renderOrder = -50;
  if (!track.hasVoid) {
    // big terrain under everything (offroad), in rings so the far parts stay cheap
    const box = new THREE.Box3();
    for (const s of track.main.samples) box.expandByPoint(s.p);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const R = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 60;
    const n = 12;
    const gc = C(0xffffff);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x0 = cx - R + (2 * R * i) / n;
      const x1 = cx - R + (2 * R * (i + 1)) / n;
      const z0 = cz - R + (2 * R * j) / n;
      const z1 = cz - R + (2 * R * (j + 1)) / n;
      const y = track.groundY - 0.02;
      groundBatch.quadW([V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0)], [x0 / 6, z1 / 6, x1 / 6, z1 / 6, x1 / 6, z0 / 6, x0 / 6, z0 / 6], [gc, gc, gc, gc]);
    }
    const ring = kit.batch({ vertexColors: true, fog: true, depthWrite: false }, 'ground-far');
    ring.renderOrder = -60;
    const fc = C(st.ground).multiplyScalar(0.9);
    for (let i = 0; i < 32; i++) {
      const a0 = (i / 32) * Math.PI * 2;
      const a1 = ((i + 1) / 32) * Math.PI * 2;
      const y = track.groundY - 0.05;
      const P = (a: number, rr: number) => V(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
      ring.quadW([P(a0, R * 1.42), P(a1, R * 1.42), P(a1, 470), P(a0, 470)].reverse(), [0, 0, 0, 0, 0, 0, 0, 0], [fc, fc, fc, fc]);
    }
  } else {
    // sea of clouds far below
    const cloudTex = kit.tex(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e8eef6';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) blob(ctx, w, h, r, r() * w, r() * h, 4 + r() * 8, i % 2 ? 'rgba(255,255,255,0.9)' : 'rgba(196,210,232,0.7)', 0.8);
    });
    const clouds = kit.batch({ map: cloudTex, unlit: 0.5, fog: true, vertexColors: true }, 'cloud-sea');
    const y = track.groundY - 60;
    const cc = C(0xffffff);
    for (let i = -6; i < 6; i++) for (let j = -6; j < 6; j++) {
      const s = 80;
      clouds.quadW([V(i * s, y, (j + 1) * s), V((i + 1) * s, y, (j + 1) * s), V((i + 1) * s, y, j * s), V(i * s, y, j * s)], [0, 1, 2, 1, 2, 0, 0, 0], [cc, cc, cc, cc]);
    }
  }

  // ---------------------------------------------------------------- scenery
  const anim: ((t: number) => void)[] = [];
  decorate(kit, track, theme, st, anim, glowTex);

  kit.finish();
  // boost pads flicker
  const padMesh = kit.group.children.find((c) => c.name === 'boost-pads') as THREE.Mesh | undefined;
  anim.push((t) => {
    if (padMesh) (padMesh.material as PS1Material).uniforms.uColor.value.setScalar(0.85 + 0.15 * Math.sin(t * 14));
  });
  const agMesh = kit.group.children.find((c) => c.name === 'antigrav-edges') as THREE.Mesh | undefined;
  anim.push((t) => {
    if (agMesh) (agMesh.material as PS1Material).uniforms.uColor.value.setScalar(0.75 + 0.25 * Math.sin(t * 6));
  });

  return {
    group: kit.group,
    clearColor: C(st.fog),
    fogColor: C(st.fog),
    fogNear: st.fogNear,
    fogFar: st.fogFar,
    lightDir: st.sunDir.clone().setY(Math.max(0.35, st.sunDir.y)).normalize(),
    lightColor: new THREE.Color(...st.lightColor),
    ambient: new THREE.Color(...st.ambient),
    dust: st.dust,
    update(t: number) {
      for (const f of anim) f(t);
    },
    dispose() {
      kit.dispose();
    },
  };
}

/** Scenery along the track, by theme: houses & palm trees, torii & pagodas, pillars & neon… */
function decorate(kit: Kit, track: Track, theme: Theme, st: ThemeStyle, anim: ((t: number) => void)[], glowTex: THREE.Texture) {
  const r = kit.rand;
  const main = track.main;
  const N = main.count;
  const clearance = (p: THREE.Vector3, margin: number) => {
    // keep scenery off every ribbon
    for (const rb of track.ribbons) {
      const j = rb.nearest(p, -1);
      const sm = rb.sample(j);
      const dx = p.x - sm.p.x;
      const dz = p.z - sm.p.z;
      if (Math.hypot(dx, dz) < sm.w + track.shoulder + margin && Math.abs(p.y - sm.p.y) < 12) return false;
    }
    return true;
  };
  /** a spot beside the track at sample j, `side` ±1, `off` metres beyond the shoulder */
  const beside = (j: number, side: number, off: number) => {
    const sm = main.sample(j);
    const p = sm.p.clone().addScaledVector(sm.r, side * (sm.w + track.shoulder + off));
    p.y = track.hasVoid ? sm.p.y : track.groundY;
    return { p, yaw: Math.atan2(sm.t.x, sm.t.z), sm };
  };
  const I = new THREE.Matrix4();
  void I;

  if (theme === 'hood' || theme === 'beach') {
    const stucco = [0xf2c9a2, 0xbfe0b4, 0xaccbe4, 0xf2e2a4, 0xf0bcb8, 0xd6c6e6, 0xf2eee2];
    const roofs = [0x7a6a64, 0x8a5a48, 0x5e5c62, 0x9a6a4a];
    const winTex = kit.tex(16, 16, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4a5a6a';
      ctx.fillRect(3, 4, 4, 5);
      ctx.fillRect(9, 4, 4, 5);
      ctx.fillStyle = '#8a6a4a';
      ctx.fillRect(6, 10, 4, 6);
    });
    const houses = kit.batch({ map: winTex, vertexColors: true }, 'houses');
    const roofB = kit.batch({ vertexColors: true }, 'roofs');
    const palms = kit.batch({ vertexColors: true }, 'palms');
    const lamps = kit.batch({ vertexColors: true }, 'lamps');
    const lens = kit.batch({ unlit: 1, vertexColors: true }, 'lamp-lens');
    const carTex = carTexture(kit);
    const cars: CarBatches = { body: kit.batch({ map: carTex, vertexColors: true }, 'cars'), plain: kit.batch({ vertexColors: true }, 'car-parts') };
    for (let j = 0; j < N; j += 9) {
      for (const side of [-1, 1]) {
        if (r() < 0.3) continue;
        const { p, yaw } = beside(j, side, 6 + r() * 10);
        if (!clearance(p, 4)) continue;
        const kind = r();
        if (theme === 'hood' && kind < 0.45) {
          // a small LA house facing the road
          const w = 7 + r() * 4;
          const d = 6 + r() * 3;
          const h = 3 + r() * 1.4;
          const m = T(p.x, p.y, p.z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
          const col = stucco[Math.floor(r() * stucco.length)];
          houses.box(m, 0, 0, 0, w, h, d, { color: col, bottom: C(col).multiplyScalar(0.8), uv: [0, 0, 1, 1], faceUV: { py: [0, 0, 0.01, 0.01] } });
          const rc = roofs[Math.floor(r() * roofs.length)];
          roofB.hexa(m, [
            [-w / 2 - 0.4, h, -d / 2 - 0.4],
            [w / 2 + 0.4, h, -d / 2 - 0.4],
            [w / 2 + 0.4, h, d / 2 + 0.4],
            [-w / 2 - 0.4, h, d / 2 + 0.4],
            [-w / 2 + 0.6, h + 1.4, -0.2],
            [w / 2 - 0.6, h + 1.4, -0.2],
            [w / 2 - 0.6, h + 1.4, 0.2],
            [-w / 2 + 0.6, h + 1.4, 0.2],
          ], { color: rc, bottom: C(rc).multiplyScalar(0.8) });
        } else if (kind < 0.8) {
          // palm tree
          const h = 7 + r() * 5;
          const lean = (r() - 0.5) * 0.3;
          const m = T(p.x, p.y, p.z, r() * 6, lean, 0);
          palms.cyl(m, 0, 0, 0, 0.18, 0.28, h, 5, { color: 0x8a6a48, bottom: 0x5a4430 });
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2;
            const fm = T(p.x, p.y + h, p.z, a, 0.5 + r() * 0.3);
            palms.hexa(fm, [
              [-0.15, 0, 0],
              [0.15, 0, 0],
              [0.5, -0.4, 3.2],
              [-0.5, -0.4, 3.2],
              [-0.15, 0.08, 0],
              [0.15, 0.08, 0],
              [0.5, -0.32, 3.2],
              [-0.5, -0.32, 3.2],
            ], { color: 0x4a8a3a, bottom: 0x2a5a2a });
          }
        } else {
          // parked lowrider
          addCar(cars, T(p.x, p.y, p.z, yaw + Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI)), { paint: [0x8a2a3a, 0x2a4a8a, 0xd8c040, 0x2a8a6a, 0xe8e8e8][Math.floor(r() * 5)], lowrider: r() < 0.5 });
        }
      }
      // street lamps along the road
      if (j % 27 === 0) {
        const { p, yaw } = beside(j, j % 54 === 0 ? 1 : -1, 1);
        if (clearance(p, 0.5)) {
          const m = T(p.x, p.y, p.z, yaw);
          lamps.cyl(m, 0, 0, 0, 0.08, 0.12, 6, 5, { color: 0x6a6a70 });
          lens.box(m, 0, 6, 0, 0.5, 0.2, 0.5, { color: 0xffe0a0 });
        }
      }
    }
  } else if (theme === 'dojo') {
    // torii gates over the road, pagodas and pines on floating islands, drifting clouds
    const red = kit.batch({ vertexColors: true }, 'torii');
    const isl = kit.batch({ vertexColors: true }, 'islands');
    for (let j = 20; j < N; j += 70) {
      const sm = main.sample(j);
      const yaw = Math.atan2(sm.t.x, sm.t.z);
      const span = sm.w + track.shoulder + 0.5;
      for (const side of [-1, 1]) {
        const b = sm.p.clone().addScaledVector(sm.r, side * span);
        red.cyl(T(b.x, b.y - 2, b.z, yaw), 0, 0, 0, 0.35, 0.4, 9, 6, { color: 0xc8302a, bottom: 0x8a1a14 });
      }
      const top = sm.p.clone().addScaledVector(sm.u, 6.8);
      red.box(T(top.x, top.y, top.z, yaw), 0, 0, 0, span * 2 + 3, 0.6, 0.8, { color: 0xc8302a });
      red.box(T(top.x, top.y + 0.9, top.z, yaw), 0, 0, 0, span * 2 + 5, 0.5, 1.0, { color: 0x1a1210 });
    }
    for (let k = 0; k < 26; k++) {
      const j = Math.floor(r() * N);
      const side = r() < 0.5 ? -1 : 1;
      const { p } = beside(j, side, 25 + r() * 60);
      p.y += (r() - 0.6) * 30;
      if (!clearance(p, 15)) continue;
      const R = 8 + r() * 10;
      const m = T(p.x, p.y, p.z, r() * 6);
      // rock island (cone upside down) with grass on top
      isl.cyl(m, 0, -R * 1.4, 0, R, R * 0.2, R * 1.4, 7, { color: 0x6a6258, bottom: 0x3a342e });
      isl.cyl(m, 0, 0, 0, R, R, 0.6, 7, { color: 0x6a9a4a, bottom: 0x4a7a3a });
      if (r() < 0.5) {
        // pagoda
        for (let f = 0; f < 3; f++) {
          const s = 1 - f * 0.25;
          isl.box(m, 0, 0.6 + f * 3, 0, 4 * s, 2.2, 4 * s, { color: 0xe8dcc0, bottom: 0xa89878 });
          isl.hexa(m, [
            [-3.6 * s, 2.8 + f * 3, -3.6 * s],
            [3.6 * s, 2.8 + f * 3, -3.6 * s],
            [3.6 * s, 2.8 + f * 3, 3.6 * s],
            [-3.6 * s, 2.8 + f * 3, 3.6 * s],
            [-0.5, 3.6 + f * 3, -0.5],
            [0.5, 3.6 + f * 3, -0.5],
            [0.5, 3.6 + f * 3, 0.5],
            [-0.5, 3.6 + f * 3, 0.5],
          ], { color: 0x3a2a2a, bottom: 0x8a2420 });
        }
      } else {
        // cherry trees
        for (let t = 0; t < 3; t++) {
          const tx = (r() - 0.5) * R;
          const tz = (r() - 0.5) * R;
          isl.cyl(m, tx, 0.6, tz, 0.2, 0.3, 3, 5, { color: 0x5a3a2a });
          isl.geo(T(0, 0, 0).multiply(m).multiply(T(tx, 4.2, tz)), new THREE.IcosahedronGeometry(2, 0), { color: 0xf4b8d0, bottom: 0xd88aa8, flat: true });
        }
      }
    }
    // a few clouds drifting at track level
    const cloudMat = kit.mat({ map: glowTex, transparent: true, depthWrite: false, unlit: 1, color: 0xffffff, opacity: 0.8 });
    const cloudGroup = new THREE.Group();
    kit.group.add(cloudGroup);
    for (let k = 0; k < 14; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
      kit.own(s.material);
      const j = Math.floor(r() * N);
      const { p } = beside(j, r() < 0.5 ? -1 : 1, 20 + r() * 50);
      p.y += -10 + r() * 14;
      s.position.copy(p);
      s.scale.set(30 + r() * 30, 12 + r() * 8, 1);
      cloudGroup.add(s);
    }
    kit.own(cloudMat);
    anim.push((t) => {
      cloudGroup.position.x = Math.sin(t * 0.05) * 8;
    });
  } else if (theme === 'parking') {
    // concrete pillars, neon tubes along the walls, a skyline of lit windows
    const pillars = kit.batch({ vertexColors: true }, 'pillars');
    const neonMat = kit.mat({ unlit: 1, vertexColors: true, fog: false });
    const neon = kit.batch(neonMat, 'neon');
    const neonCols = [0xff3aa8, 0x3ae8ff, 0xffd03a, 0x8a5aff];
    for (let j = 0; j < N; j += 12) {
      for (const side of [-1, 1]) {
        const { p, yaw, sm } = beside(j, side, 1.2);
        if (!clearance(p, 0.6)) continue;
        pillars.box(T(p.x, track.groundY, p.z, yaw), 0, 0, 0, 0.9, Math.max(3, sm.p.y - track.groundY + 4.5), 0.9, { color: 0x9a9aa2, bottom: 0x5a5a62 });
        if (j % 24 === 0) {
          const nc = neonCols[(j / 24 + (side > 0 ? 1 : 0)) % neonCols.length];
          const top = sm.p.clone().addScaledVector(sm.r, side * (sm.w + track.shoulder + 0.7)).addScaledVector(sm.u, 3.2);
          neon.box(T(top.x, top.y, top.z, yaw), 0, 0, 0, 0.12, 0.12, 9, { color: nc });
        }
      }
    }
    const city = kit.batch({ unlit: 1, vertexColors: true, fog: false }, 'skyline');
    for (let k = 0; k < 70; k++) {
      const a = (k / 70) * Math.PI * 2 + r() * 0.05;
      const R = 330 + r() * 80;
      const w = 14 + r() * 26;
      const h = 30 + r() * 110;
      const m = T(Math.cos(a) * R, -5, Math.sin(a) * R, -a + Math.PI / 2);
      city.box(m, 0, 0, 0, w, h, 12, { color: 0x1a1830, bottom: 0x0c0a18 });
      for (let wv = 0; wv < 8; wv++) {
        const wx = (r() - 0.5) * w * 0.8;
        const wy = 6 + r() * (h - 10);
        city.box(m, wx, wy, -6.2, 1.2, 1.4, 0.2, { color: r() < 0.5 ? 0xffd890 : 0x9ad0ff });
      }
    }
    const neonMesh = () => kit.group.children.find((c) => c.name === 'neon') as THREE.Mesh | undefined;
    anim.push((t) => {
      const m = neonMesh();
      if (m) (m.material as PS1Material).uniforms.uColor.value.setScalar(Math.sin(t * 23) > -0.92 ? 1 : 0.4);
    });
  }
  void st;
  void clamp;
}
