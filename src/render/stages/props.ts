import * as THREE from 'three';
import { Batch, C, Kit, mulC, noiseRect, shade, type UVRect } from './kit';

/* ------------------------------------------------------------------------ */
/* Car texture atlas (64×64)                                                */
/*   rows  0..15  side panel           v 0.75..1                            */
/*   rows 16..31  side windows         v 0.50..0.75                         */
/*   rows 32..47  front | rear         v 0.25..0.5                          */
/*   rows 48..63  windshield | paint   v 0..0.25                            */
/* Paint is drawn light grey and tinted with vertex colours.                */
/* ------------------------------------------------------------------------ */

const E = 0.5 / 64; // half texel inset, avoids bleeding between atlas cells
export const CAR_UV = {
  side: [E, 0.75 + E, 1 - E, 1 - E] as UVRect,
  glass: [E, 0.5 + E, 1 - E, 0.75 - E] as UVRect,
  front: [E, 0.25 + E, 0.5 - E, 0.5 - E] as UVRect,
  rear: [0.5 + E, 0.25 + E, 1 - E, 0.5 - E] as UVRect,
  shield: [E, E, 0.5 - E, 0.25 - E] as UVRect,
  paint: [0.5 + E, E, 1 - E, 0.25 - E] as UVRect,
};

export function carTexture(kit: Kit): THREE.CanvasTexture {
  const r = kit.rand;
  return kit.tex(
    64,
    64,
    (ctx) => {
      const PAINT = 0xe6e6e6;
      noiseRect(ctx, 0, 0, 64, 64, r, PAINT, 10, 0);
      // --- side panel (rows 0..15)
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, 64, 1);
      ctx.fillStyle = '#c4c8cc';
      ctx.fillRect(0, 6, 64, 1); // chrome trim
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 5, 64, 1);
      ctx.fillStyle = '#8a8a8a';
      for (const x of [24, 41]) ctx.fillRect(x, 1, 1, 12); // door seams
      ctx.fillStyle = '#5a5a5a';
      ctx.fillRect(36, 4, 3, 1);
      ctx.fillRect(19, 4, 3, 1);
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(0, 13, 64, 3); // rocker
      ctx.fillStyle = '#141414';
      for (const cx of [12, 52]) {
        // wheel arches
        for (let y = 0; y < 7; y++) {
          const hw = Math.round(Math.sqrt(Math.max(0, 49 - (7 - y) * (7 - y))));
          ctx.fillRect(cx - hw, 9 + y, hw * 2, 1);
        }
      }
      // --- side windows (rows 16..31)
      ctx.fillStyle = '#26303c';
      ctx.fillRect(4, 18, 27, 12);
      ctx.fillRect(34, 18, 25, 12);
      ctx.fillStyle = '#4a5a6c';
      for (let i = 0; i < 9; i++) {
        ctx.fillRect(8 + i, 28 - i, 2, 1);
        ctx.fillRect(40 + i, 28 - i, 1, 1);
      }
      ctx.fillStyle = '#c8ccd0';
      ctx.fillRect(4, 30, 55, 1);
      // --- front (rows 32..47, cols 0..31)
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(9, 36, 14, 6);
      ctx.fillStyle = '#3a3a3a';
      for (let y = 37; y < 42; y += 2) ctx.fillRect(10, y, 12, 1);
      ctx.fillStyle = '#fff6c8';
      ctx.fillRect(2, 36, 6, 4);
      ctx.fillRect(24, 36, 6, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(3, 37, 2, 2);
      ctx.fillRect(25, 37, 2, 2);
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(0, 44, 32, 4);
      // --- rear (rows 32..47, cols 32..63)
      ctx.fillStyle = '#b81c1c';
      ctx.fillRect(34, 36, 7, 4);
      ctx.fillRect(55, 36, 7, 4);
      ctx.fillStyle = '#ff5a40';
      ctx.fillRect(35, 37, 2, 1);
      ctx.fillRect(56, 37, 2, 1);
      ctx.fillStyle = '#f0f0e0';
      ctx.fillRect(44, 39, 8, 4);
      ctx.fillStyle = '#2a2a6a';
      ctx.fillRect(45, 40, 6, 1);
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(32, 44, 32, 4);
      // --- windshield (rows 48..63, cols 0..31)
      ctx.fillStyle = '#222a36';
      ctx.fillRect(2, 50, 28, 12);
      ctx.fillStyle = '#5a6a80';
      for (let i = 0; i < 10; i++) {
        ctx.fillRect(6 + i, 60 - i, 2, 1);
        ctx.fillRect(14 + i, 60 - i, 1, 1);
      }
      // --- paint (rows 48..63, cols 32..63): subtle highlight streak
      ctx.fillStyle = shade(PAINT, 1.1);
      for (let i = 0; i < 12; i++) ctx.fillRect(38 + i, 61 - i, 3, 1);
    },
    false,
  );
}

export interface CarBatches {
  /** textured with carTexture(), vertex colours */
  body: Batch;
  /** untextured vertex-colour batch (wheels, bumpers) */
  plain: Batch;
  /** optional blob-shadow batch (transparent, radial texture) */
  shadow?: Batch;
}

export interface CarOpts {
  paint: number;
  length?: number;
  width?: number;
  /** lowered body, chrome/gold wire wheels */
  lowrider?: boolean;
  /** pickup truck bed instead of a trunk */
  pickup?: boolean;
  chrome?: number;
  rim?: number;
}

/** Boxy low-poly car. Local frame: front towards +X, ground at y = 0. */
export function addCar(b: CarBatches, m: THREE.Matrix4, o: CarOpts): void {
  const L = o.length ?? (o.lowrider ? 5.3 : 4.6);
  const W = o.width ?? (o.lowrider ? 1.95 : 1.85);
  const low = !!o.lowrider;
  const wr = low ? 0.31 : 0.34; // wheel radius
  const yb = low ? 0.2 : 0.3; // body bottom
  const hb = low ? 0.45 : 0.5; // body height
  const paint = C(o.paint);
  const paintDark = mulC(o.paint, 0.55);
  const chrome = o.chrome ?? 0xc8c8c8;
  const rim = C(o.rim ?? (low ? 0xe0c060 : 0xa8a8a8));
  const tyre = C(0x161616);

  // wheels (8-sided, hubcap gradient: rim colour in the centre, tyre at the edge)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wx = sx * (L / 2 - 0.9);
      const wz = sz * (W / 2 - 0.14);
      const g = new THREE.CylinderGeometry(wr, wr, 0.22, 8, 1);
      g.rotateX(Math.PI / 2);
      g.translate(wx, wr, wz);
      b.plain.geo(m, g, {
        colorFn: (p) => {
          const d = Math.hypot(p.x - wx, p.y - wr);
          return d < wr * 0.5 ? rim : tyre;
        },
      });
      g.dispose();
    }
  }

  // body
  b.body.box(m, 0, yb, 0, L, hb, W, {
    color: paint,
    bottom: paintDark,
    faceUV: { pz: CAR_UV.side, nz: CAR_UV.side, px: CAR_UV.front, nx: CAR_UV.rear, py: CAR_UV.paint },
    faceColor: { py: paint },
  });

  // cabin (tapered)
  const y0 = yb + hb;
  const ch = low ? 0.42 : 0.5;
  const bx0 = o.pickup ? -L * 0.1 : -L * 0.32;
  const bx1 = o.pickup ? L * 0.16 : L * 0.12;
  const tx0 = o.pickup ? -L * 0.08 : -L * 0.25;
  const tx1 = o.pickup ? L * 0.04 : L * 0.0;
  const zb = W / 2 - 0.06;
  const zt = W / 2 - 0.2;
  b.body.hexa(
    m,
    [
      [bx0, y0, -zb],
      [bx1, y0, -zb],
      [bx1, y0, zb],
      [bx0, y0, zb],
      [tx0, y0 + ch, -zt],
      [tx1, y0 + ch, -zt],
      [tx1, y0 + ch, zt],
      [tx0, y0 + ch, zt],
    ],
    {
      color: paint,
      faceUV: { pz: CAR_UV.glass, nz: CAR_UV.glass, px: CAR_UV.shield, nx: CAR_UV.shield, py: CAR_UV.paint },
    },
  );
  if (o.pickup) {
    // bed walls
    const bedC = { color: paint, bottom: paintDark, uv: CAR_UV.paint };
    b.body.box(m, -L * 0.3, y0, -W / 2 + 0.06, L * 0.38, 0.28, 0.12, bedC);
    b.body.box(m, -L * 0.3, y0, W / 2 - 0.06, L * 0.38, 0.28, 0.12, bedC);
    b.body.box(m, -L / 2 + 0.06, y0, 0, 0.12, 0.28, W, bedC);
  }

  // bumpers
  b.plain.box(m, L / 2 + 0.05, yb + 0.02, 0, 0.12, 0.15, W * 0.96, { color: chrome, bottom: mulC(chrome, 0.6) });
  b.plain.box(m, -L / 2 - 0.05, yb + 0.02, 0, 0.12, 0.15, W * 0.96, { color: chrome, bottom: mulC(chrome, 0.6) });
  // underbody (dark) so that the gap between the wheels is not see-through
  b.plain.box(m, 0, 0.12, 0, L - 0.5, yb - 0.1, W - 0.5, { color: 0x101010, skip: ['ny', 'py'] });

  if (b.shadow) {
    b.shadow.quad(
      m,
      [
        [-L / 2 - 0.5, 0.02, W / 2 + 0.45],
        [L / 2 + 0.5, 0.02, W / 2 + 0.45],
        [L / 2 + 0.5, 0.02, -W / 2 - 0.45],
        [-L / 2 - 0.5, 0.02, -W / 2 - 0.45],
      ],
      [0, 0, 1, 1],
    );
  }
}
