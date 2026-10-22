import * as THREE from 'three';
/** one-shot visual effects (cinematics and race events) */
export type CineFx = 'explosion' | 'muzzle' | 'poof' | 'powerAura' | 'stars' | 'sweat' | 'question' | 'exclaim' | 'shine' | 'smoke' | 'confetti' | 'pain' | 'veins' | 'web' | 'speed';
import { createPS1Material, makeCanvasTexture, type PS1Material } from './ps1Material';

/** Hit sparks, block sparks, dust: pooled additive sprites. */

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  baseScale: number;
  /** circling particle (dizzy stars): centre, radius, angle, angular speed (rad/frame) */
  orbit?: { c: THREE.Vector3; r: number; a: number; w: number };
  /** drag per frame (0 = none) */
  drag: number;
  /** pop-in: scale overshoots then settles during the first frames */
  pop: boolean;
  /** width / height ratio of the sprite (streaks) */
  aspect: number;
  /** rotation speed (rad / frame) */
  spin: number;
}

/** A solid chunk of scenery (destruction finish): a box that tumbles, bounces and shrinks away. */
interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rot: THREE.Vector3;
  size: THREE.Vector3;
  life: number;
  max: number;
}

/** A flat decal / shockwave lying on the floor. */
interface Decal {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
  opacity: number;
}

/** Colours of the bits of scenery flying around when a wall breaks, per stage. */
export const DEBRIS_PALETTES: Record<string, { solid: number[]; dust: number }> = {
  hood: { solid: [0xa04a32, 0x8a3a28, 0xc26a4a, 0x8a6a44, 0x6e5034, 0xe8cfa8], dust: 0xc8b090 },
  dojo: { solid: [0xb02a20, 0x9a5a2a, 0xd08c44, 0x7c3418, 0xf0e8d0, 0x5a3a20], dust: 0xe8dcc8 },
  parking: { solid: [0x8a8a8c, 0x6a6a70, 0x9a9a98, 0x3a3a40, 0xe0c030, 0x7a7a7e], dust: 0xa0a0a8 },
};
const DEFAULT_PALETTE = { solid: [0x8a8a8c, 0x7a6a5a, 0xa09080, 0x5a5048], dust: 0xb0a898 };

export type CineFxId = CineFx;

let glyphs: Record<'question' | 'exclaim' | 'star5' | 'drop' | 'vein' | 'web' | 'heart' | 'note', THREE.Texture> | null = null;
function glyphTex() {
  if (glyphs) return glyphs;
  const text = (ch: string, fill: string) =>
    makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.font = 'bold 28px Arial Black, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(ch, w / 2, h / 2 + 2);
      ctx.fillStyle = fill;
      ctx.fillText(ch, w / 2, h / 2 + 2);
    });
  glyphs = {
    question: text('?', '#ffe040'),
    exclaim: text('!', '#ff3a2a'),
    star5: makeCanvasTexture(16, 16, (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 3 : 7.5;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
    }),
    drop: makeCanvasTexture(8, 12, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.quadraticCurveTo(8, 8, 4, 11);
      ctx.quadraticCurveTo(0, 8, 4, 0);
      ctx.fill();
    }),
    // manga anger mark
    vein: makeCanvasTexture(24, 24, (ctx, w, h) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.translate(w / 2, h / 2);
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(2, -9);
        ctx.quadraticCurveTo(2, -2, 9, -2);
        ctx.stroke();
      }
    }),
    heart: makeCanvasTexture(24, 24, (ctx, w, h) => {
      ctx.translate(w / 2, h / 2 + 1);
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-11, 0, -9, -10, 0, -4);
      ctx.bezierCurveTo(9, -10, 11, 0, 0, 8);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.fillStyle = '#ff4d8a';
      ctx.fill();
      ctx.fillStyle = '#ffd0e0';
      ctx.fillRect(-5, -4, 3, 2);
    }),
    note: makeCanvasTexture(24, 24, (ctx) => {
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#40e0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(7, 18, 4.5, 3.2, -0.4, 0, Math.PI * 2);
      ctx.ellipse(17, 15, 4.5, 3.2, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      ctx.fillRect(10, 3, 2.5, 15);
      ctx.fillRect(20, 1, 2.5, 14);
      ctx.fillRect(10, 2, 12.5, 4);
      ctx.strokeRect(10, 2, 12.5, 4);
    }),
    web: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.translate(w / 2, h / 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        ctx.stroke();
      }
      for (const r of [4, 8, 12]) {
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
      }
    }),
  };
  return glyphs;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

let textures: {
  star: THREE.Texture;
  dot: THREE.Texture;
  ring: THREE.Texture;
  puff: THREE.Texture;
  crack: THREE.Texture;
  crater: THREE.Texture;
  shard: THREE.Texture;
  /** cracked glass guard (guard crush) */
  shield: THREE.Texture;
  /** a glass splinter: pale blue pane with a white edge */
  glass: THREE.Texture;
} | null = null;

/** Jagged radial cracks (white core, dark outline) drawn from the centre of a square canvas. */
function drawCracks(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, style: 'light' | 'dark' | 'glass') {
  let k = seed;
  const r = () => {
    k = (k * 16807) % 2147483647;
    return (k - 1) / 2147483646;
  };
  const cx = w / 2;
  const cy = h / 2;
  const lines: [number, number][][] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
    let x = cx;
    let y = cy;
    const pts: [number, number][] = [[x, y]];
    const len = w * (0.32 + r() * 0.17);
    for (let d = 0; d < len; ) {
      const step = 3 + r() * 4;
      d += step;
      a += (r() - 0.5) * 0.7;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
      // small branch
      if (r() < 0.18) lines.push([[x, y], [x + Math.cos(a + 0.9) * step * 1.4, y + Math.sin(a + 0.9) * step * 1.4]]);
    }
    lines.push(pts);
  }
  // broken rings around the centre
  for (const rad of [w * 0.12, w * 0.24]) {
    for (let i = 0; i < n; i++) {
      if (r() < 0.35) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / n;
      lines.push([
        [cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad],
        [cx + Math.cos((a0 + a1) / 2) * rad * (0.9 + r() * 0.2), cy + Math.sin((a0 + a1) / 2) * rad * (0.9 + r() * 0.2)],
        [cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad],
      ]);
    }
  }
  const stroke = (col: string, wd: number) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = wd;
    ctx.lineJoin = 'round';
    for (const pts of lines) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  };
  if (style === 'dark') {
    stroke('rgba(10,8,6,0.85)', 2.5);
  } else if (style === 'glass') {
    stroke('rgba(30,110,230,0.85)', 3);
    stroke('#ffffff', 1.2);
  } else {
    stroke('rgba(0,0,0,0.9)', 3.5);
    stroke('#ffffff', 1.4);
  }
}
function tex() {
  if (textures) return textures;
  textures = {
    star: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(3, 0);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }),
    dot: makeCanvasTexture(8, 8, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(2, 1, 4, 6);
      ctx.fillRect(1, 2, 6, 4);
    }),
    ring: makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
    }),
    puff: makeCanvasTexture(16, 16, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
    crack: makeCanvasTexture(64, 64, (ctx, w, h) => {
      // bright flash at the centre of the impact, then the cracks
      const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w * 0.2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      drawCracks(ctx, w, h, 7, 'light');
    }),
    crater: makeCanvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.3);
      g.addColorStop(0, 'rgba(20,16,12,0.7)');
      g.addColorStop(1, 'rgba(20,16,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      drawCracks(ctx, w, h, 31, 'dark');
    }),
    shard: makeCanvasTexture(16, 16, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 1);
      ctx.lineTo(14, 13);
      ctx.lineTo(3, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }),
    shield: makeCanvasTexture(64, 64, (ctx, w, h) => {
      // hexagonal pane of light, cracked all over
      const hex = (r: number) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + Math.PI / 6;
          ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
        }
        ctx.closePath();
      };
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.48);
      g.addColorStop(0, 'rgba(230,248,255,0.75)');
      g.addColorStop(0.7, 'rgba(120,200,255,0.35)');
      g.addColorStop(1, 'rgba(120,200,255,0.6)');
      hex(w * 0.47);
      ctx.fillStyle = g;
      ctx.fill();
      drawCracks(ctx, w, h, 53, 'glass');
      hex(w * 0.47);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }),
    glass: makeCanvasTexture(16, 16, (ctx) => {
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(15, 9);
      ctx.lineTo(9, 15);
      ctx.lineTo(1, 11);
      ctx.closePath();
      ctx.fillStyle = 'rgba(190,232,255,0.85)';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(6, 3, 2, 5);
    }),
  };
  return textures;
}

/** the shared effect textures (projectile visuals reuse them) */
export function fxTexture(name: 'star' | 'dot' | 'ring' | 'puff'): THREE.Texture {
  return tex()[name];
}

/**
 * Block sparks: blue with a full guard, turning orange then red as the guard gauge
 * empties (`wear` = 1 - guard / guardMax).
 */
const WEAR_COLORS = {
  ring: [0x60c8ff, 0xff9a20, 0xff2a1a],
  star: [0xa0e0ff, 0xffd070, 0xff6a50],
  dot: [0x80d8ff, 0xffb040, 0xff4030],
} as const;
const wearTmp = new THREE.Color();
const wearTmp2 = new THREE.Color();
function wearColor(role: keyof typeof WEAR_COLORS, wear: number): THREE.Color {
  const [a, b, c] = WEAR_COLORS[role];
  // blue down to 80 % of the gauge, orange at half, red when nearly empty
  if (wear <= 0.2) return wearTmp.set(a).clone();
  if (wear <= 0.5) return wearTmp.set(a).lerp(wearTmp2.set(b), (wear - 0.2) / 0.3).clone();
  return wearTmp.set(b).lerp(wearTmp2.set(c), Math.min(1, (wear - 0.5) / 0.35)).clone();
}

/** Look of a projectile (assist 'beam' shots and the ranged profile's own projectile). */
export type ShotKind = 'grenade' | 'web' | 'words' | 'energy';
/** how a fighter's projectile ended (sim event `projectileEnd`) */
export type ShotEnd = 'hit' | 'block' | 'clash' | 'out';

/** every cinematic effect (a missing one is a compile error) */
const ALL_CINE_FX = Object.keys({
  explosion: 1,
  muzzle: 1,
  poof: 1,
  powerAura: 1,
  stars: 1,
  sweat: 1,
  question: 1,
  exclaim: 1,
  shine: 1,
  smoke: 1,
  confetti: 1,
  pain: 1,
  veins: 1,
  web: 1,
  speed: 1,
} satisfies Record<CineFxId, 1>) as CineFxId[];

export class Effects {
  readonly group = new THREE.Group();
  private parts: Particle[] = [];
  private chunks: Chunk[] = [];
  private decals: Decal[] = [];
  private chunkGeo: THREE.BoxGeometry | null = null;
  private flatGeo: THREE.PlaneGeometry | null = null;
  private chunkMats = new Map<number, PS1Material>();
  /** simulation speed of everything (K.O. slow motion < 1) */
  timeScale = 1;

  private spawn(
    map: THREE.Texture,
    color: THREE.ColorRepresentation,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    scale: number,
    life: number,
    opts: {
      grow?: number;
      gravity?: number;
      additive?: boolean;
      opacity?: number;
      drag?: number;
      pop?: boolean;
      orbit?: Particle['orbit'];
      /** width / height ratio (streaks) */
      aspect?: number;
      /** initial rotation (rad) */
      rot?: number;
      /** rotation speed (rad / frame) */
      spin?: number;
      /** hidden behind the characters (default: always on top) */
      depthTest?: boolean;
    } = {},
  ) {
    const mat = new THREE.SpriteMaterial({
      map,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? false,
      opacity: opts.opacity ?? 1,
      blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    mat.userData.o = opts.opacity ?? 1;
    if (opts.rot) mat.rotation = opts.rot;
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    const aspect = opts.aspect ?? 1;
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.parts.push({
      sprite,
      vel,
      life,
      max: life,
      grow: opts.grow ?? 0,
      gravity: opts.gravity ?? 0,
      baseScale: scale,
      drag: opts.drag ?? 0,
      pop: !!opts.pop,
      orbit: opts.orbit,
      aspect,
      spin: opts.spin ?? 0,
    });
    return sprite;
  }

  hit(x: number, y: number, strength: 'light' | 'medium' | 'heavy', counter: boolean, scale = 1, z = 0.35) {
    const t = tex();
    const p = new THREE.Vector3(x, y, z);
    const big = (strength === 'heavy' ? 1.6 : strength === 'medium' ? 1.2 : 0.9) * scale;
    const col = counter ? 0xff4030 : strength === 'heavy' ? 0xffa020 : strength === 'medium' ? 0xffd040 : 0xfff0a0;
    this.spawn(t.star, 0xffffff, p.clone(), new THREE.Vector3(), 0.55 * big, 7, { grow: 0.09 * big });
    this.spawn(t.star, col, p.clone(), new THREE.Vector3(), 0.8 * big, 9, { grow: 0.06 * big });
    this.spawn(t.ring, col, p.clone(), new THREE.Vector3(), 0.2, 10, { grow: 0.12 * big });
    const n = strength === 'heavy' ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.03 + Math.random() * 0.05) * big;
      this.spawn(t.dot, col, p.clone(), new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 0.02, (Math.random() - 0.5) * s), 0.06 + Math.random() * 0.05, 14 + Math.random() * 10, {
        gravity: 0.004,
      });
    }
  }

  /** @param wear 0 = full guard (blue sparks) .. 1 = about to break (red, bigger, cracking) */
  block(x: number, y: number, wear = 0) {
    const t = tex();
    const w = Math.max(0, Math.min(1, wear));
    const p = new THREE.Vector3(x, y, 0.35);
    const k = 1 + w * 0.45;
    this.spawn(t.ring, wearColor('ring', w), p.clone(), new THREE.Vector3(), 0.15, 9, { grow: 0.07 * k });
    this.spawn(t.star, wearColor('star', w), p.clone(), new THREE.Vector3(), 0.4 * k, 6, { grow: 0.02 });
    const dot = wearColor('dot', w);
    const n = 6 + Math.round(w * 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.04 * (1 + w * 0.5);
      this.spawn(t.dot, dot, p.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), 0.05, 10, { gravity: 0.003 });
    }
    // a worn guard starts cracking: a few splinters fall off
    if (w > 0.55) {
      const m = w > 0.8 ? 4 : 2;
      for (let i = 0; i < m; i++) {
        this.spawn(t.glass, wearColor('star', w), p.clone(), new THREE.Vector3(rnd(-0.03, 0.03), rnd(0.005, 0.035), rnd(-0.01, 0.01)), rnd(0.06, 0.1), rnd(18, 26), {
          additive: false,
          gravity: 0.004,
          spin: rnd(-0.3, 0.3),
          rot: rnd(0, 6),
        });
      }
    }
  }

  /**
   * Guard crush: the guard bursts like a pane of glass. Cracked hexagonal pane, glass
   * shards flying the way of the blow (`dir` = +1 / -1), white / blue rings and glints.
   */
  guardShatter(x: number, y: number, dir: number) {
    const t = tex();
    const p = new THREE.Vector3(x, y, 0.4);
    const pane = this.spawn(t.shield, 0xffffff, p.clone(), new THREE.Vector3(dir * 0.004, 0, 0), 0.75, 12, { additive: false, pop: true, opacity: 0.9 });
    pane.renderOrder = 11;
    this.spawn(t.star, 0xffffff, p.clone(), new THREE.Vector3(), 1.3, 6, { grow: 0.08, opacity: 0.9 });
    this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(), 0.3, 10, { grow: 0.18, opacity: 0.9 });
    this.spawn(t.ring, 0x60c8ff, p.clone(), new THREE.Vector3(), 0.2, 14, { grow: 0.12 });
    // glass shards: mostly carried by the blow, some falling back toward the attacker
    for (let i = 0; i < 30; i++) {
      const back = i % 5 === 0;
      const a = (back ? Math.PI : 0) + rnd(-1.1, 1.1);
      const sp = rnd(0.03, 0.1) * (back ? 0.6 : 1);
      const off = new THREE.Vector3(rnd(-0.2, 0.2), rnd(-0.4, 0.4), rnd(-0.15, 0.15));
      const sh = this.spawn(
        t.glass,
        i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xcfeeff : 0x8fd0ff,
        p.clone().add(off),
        new THREE.Vector3(dir * Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 0.025, rnd(-0.025, 0.04)),
        rnd(0.07, 0.18),
        rnd(30, 52),
        { additive: false, gravity: 0.0035, spin: rnd(-0.4, 0.4), rot: rnd(0, 6), aspect: rnd(0.6, 1.4) },
      );
      sh.renderOrder = 11;
    }
    // glints catching the light
    for (let i = 0; i < 10; i++) {
      this.spawn(t.star, 0xe8f8ff, p.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), rnd(-0.45, 0.45), 0.05)), new THREE.Vector3(dir * rnd(0.005, 0.03), rnd(-0.005, 0.02), 0), rnd(0.1, 0.18), rnd(10, 20), {
        pop: true,
      });
    }
    // fast streaks
    for (let i = 0; i < 10; i++) {
      const a = (dir > 0 ? 0 : Math.PI) + rnd(-1.2, 1.2);
      const sp = rnd(0.08, 0.16);
      this.spawn(t.dot, i % 2 ? 0x9fdcff : 0xffffff, p.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), rnd(0.05, 0.07), rnd(8, 13), {
        aspect: rnd(5, 8),
        rot: a,
        drag: 0.12,
      });
    }
  }

  /** Parry: big cyan ring + sparks */
  parry(x: number, y: number) {
    const t = tex();
    const p = new THREE.Vector3(x, y, 0.35);
    this.spawn(t.ring, 0x60e0ff, p.clone(), new THREE.Vector3(), 0.2, 14, { grow: 0.12 });
    this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(), 0.1, 10, { grow: 0.08 });
    this.spawn(t.star, 0xa0f0ff, p.clone(), new THREE.Vector3(), 0.9, 8, { grow: 0.05 });
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(t.dot, 0x9ff0ff, p.clone(), new THREE.Vector3(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0), 0.06, 16, { gravity: 0.002 });
    }
  }

  /**
   * Throw escape: a white / gold spark burst between the two fighters, a flat shockwave
   * and streaks flying out to both sides (they are pushed apart).
   */
  tech(x: number, y: number) {
    const t = tex();
    const p = new THREE.Vector3(x, y, 0.4);
    this.spawn(t.star, 0xffffff, p.clone(), new THREE.Vector3(), 0.9, 7, { grow: 0.06, rot: 0.785 });
    this.spawn(t.star, 0xffe070, p.clone(), new THREE.Vector3(), 1.1, 9, { grow: 0.03 });
    this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(), 0.15, 9, { grow: 0.15, opacity: 0.9 });
    this.spawn(t.ring, 0xffc040, p.clone(), new THREE.Vector3(), 0.1, 13, { grow: 0.1 });
    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? 1 : -1;
      const a = (side > 0 ? 0 : Math.PI) + rnd(-0.6, 0.6);
      const sp = rnd(0.07, 0.15);
      this.spawn(t.dot, i % 3 ? 0xffe9a0 : 0xffffff, p.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), rnd(0.05, 0.07), rnd(8, 13), {
        aspect: rnd(5, 8),
        rot: a,
        drag: 0.12,
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(t.dot, 0xfff4c0, p.clone(), new THREE.Vector3(Math.cos(a) * 0.04, Math.sin(a) * 0.04 + 0.02, 0), 0.06, rnd(14, 22), { gravity: 0.003 });
    }
  }

  dust(x: number, big = false) {
    const t = tex();
    const n = big ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const dir = (Math.random() - 0.5) * 2;
      this.spawn(
        t.puff,
        0xb8a890,
        new THREE.Vector3(x + dir * 0.3, 0.08, (Math.random() - 0.5) * 0.4),
        new THREE.Vector3(dir * 0.02, 0.006 + Math.random() * 0.01, (Math.random() - 0.5) * 0.01),
        big ? 0.5 : 0.3,
        26 + Math.random() * 10,
        { grow: 0.015, additive: false, opacity: 0.7 },
      );
    }
  }

  aura(pos: THREE.Vector3) {
    const t = tex();
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.2;
      this.spawn(
        t.puff,
        Math.random() < 0.5 ? 0xff8020 : 0xffd040,
        new THREE.Vector3(pos.x + Math.cos(a) * r, 0.2 + Math.random() * 1.6, Math.sin(a) * r),
        new THREE.Vector3(0, 0.02 + Math.random() * 0.02, 0),
        0.25,
        20,
        { grow: -0.008 },
      );
    }
  }

  /**
   * BBL MAX cinematic effects. `pos` = anchor (usually the chest or head of a character),
   * `dir` = +1/-1 the attacker's facing (for directional effects).
   */
  cine(fx: CineFxId, pos: THREE.Vector3, scale = 1, dir = 1) {
    const t = tex();
    const g = glyphTex();
    const P = () => pos.clone();
    const k = scale;
    switch (fx) {
      case 'explosion': {
        this.spawn(t.star, 0xffffff, P(), new THREE.Vector3(), 0.7 * k, 7, { grow: 0.06 * k });
        this.spawn(t.ring, 0xffc040, P(), new THREE.Vector3(), 0.3 * k, 14, { grow: 0.12 * k });
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rnd(0.008, 0.032) * k;
          const v = new THREE.Vector3(Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp + 0.008, rnd(-0.015, 0.015));
          this.spawn(t.puff, Math.random() < 0.5 ? 0xff6a10 : 0xffc030, P(), v, rnd(0.25, 0.45) * k, rnd(16, 26), { grow: 0.012 * k, drag: 0.05 });
        }
        for (let i = 0; i < 10; i++) {
          const v = new THREE.Vector3(rnd(-0.02, 0.02) * k, rnd(0.01, 0.03), rnd(-0.01, 0.01));
          this.spawn(t.puff, 0x3a3634, P().add(new THREE.Vector3(rnd(-0.25, 0.25) * k, rnd(0, 0.3) * k, 0)), v, rnd(0.35, 0.55) * k, rnd(50, 70), {
            grow: 0.008 * k,
            additive: false,
            opacity: 0.75,
            drag: 0.03,
          });
        }
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rnd(0.04, 0.09) * k;
          this.spawn(t.dot, 0xffa040, P(), new THREE.Vector3(Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp, rnd(-0.03, 0.03)), 0.07, rnd(20, 34), { gravity: 0.004 });
        }
        break;
      }
      case 'muzzle':
        this.spawn(t.star, 0xfff2a0, P(), new THREE.Vector3(), 0.45 * k, 4, { grow: 0.04 });
        this.spawn(t.puff, 0xffa020, P(), new THREE.Vector3(), 0.3 * k, 5);
        this.spawn(t.puff, 0x8a8478, P(), new THREE.Vector3(rnd(-0.004, 0.004), 0.008, 0), 0.12 * k, 18, { grow: 0.01, additive: false, opacity: 0.5 });
        break;
      case 'poof':
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const v = new THREE.Vector3(Math.cos(a) * 0.022 * k, Math.sin(a) * 0.016 * k + 0.004, rnd(-0.01, 0.01));
          this.spawn(t.puff, 0xf2f0ea, P().add(new THREE.Vector3(rnd(-0.1, 0.1), rnd(-0.4, 0.4) * k, rnd(-0.1, 0.1))), v, rnd(0.45, 0.7) * k, rnd(26, 36), {
            grow: 0.012 * k,
            additive: false,
            opacity: 0.95,
            drag: 0.06,
          });
        }
        this.spawn(t.star, 0xffffff, P(), new THREE.Vector3(), 0.6 * k, 6, { grow: 0.05 });
        break;
      case 'powerAura': {
        this.spawn(t.ring, 0xffe040, P(), new THREE.Vector3(), 0.3 * k, 16, { grow: 0.16 * k });
        this.spawn(t.star, 0xfff8c0, P(), new THREE.Vector3(), 1.4 * k, 10, { grow: 0.08 * k });
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = rnd(0.25, 0.5) * k;
          const base = new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + rnd(-1.1, 0.7) * k, pos.z + Math.sin(a) * r);
          this.spawn(t.puff, Math.random() < 0.6 ? 0xffd030 : 0xfff090, base, new THREE.Vector3(0, rnd(0.03, 0.06), 0), rnd(0.25, 0.4) * k, rnd(20, 32), {
            grow: -0.006,
          });
        }
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawn(t.dot, 0xffffa0, P(), new THREE.Vector3(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0), 0.06, 20, { drag: 0.04 });
        }
        break;
      }
      case 'stars':
        for (let i = 0; i < 5; i++) {
          this.spawn(g.star5, 0xffe040, P(), new THREE.Vector3(), 0.13 * k, 150, {
            orbit: { c: P(), r: 0.22 * k, a: (i / 5) * Math.PI * 2, w: 0.09 },
          });
        }
        break;
      case 'sweat':
        for (let i = 0; i < 5; i++) {
          const a = rnd(0.3, 2.8);
          this.spawn(g.drop, 0xb8e0ff, P().add(new THREE.Vector3(Math.cos(a) * 0.12, 0.05, 0.1)), new THREE.Vector3(Math.cos(a) * 0.02, Math.sin(a) * 0.025 + 0.01, 0.005), 0.08 * k, 30, {
            gravity: 0.0018,
            additive: false,
          });
        }
        break;
      case 'question':
      case 'exclaim': {
        const sp = this.spawn(fx === 'question' ? g.question : g.exclaim, 0xffffff, P(), new THREE.Vector3(0, 0.002, 0), 0.38 * k, 70, { additive: false, pop: true });
        sp.renderOrder = 11;
        break;
      }
      case 'shine':
        this.spawn(t.star, 0xffffff, P(), new THREE.Vector3(), 0.1, 18, { grow: 0.05 * k });
        this.spawn(g.star5, 0xfff8d0, P(), new THREE.Vector3(), 0.25 * k, 22, { pop: true });
        for (let i = 0; i < 4; i++) {
          this.spawn(g.star5, 0xffffff, P().add(new THREE.Vector3(rnd(-0.25, 0.25), rnd(-0.2, 0.25), 0.05)), new THREE.Vector3(0, 0.003, 0), 0.08 * k, rnd(16, 26), {
            pop: true,
          });
        }
        break;
      case 'smoke':
        for (let i = 0; i < 8; i++) {
          this.spawn(t.puff, 0x5a5652, P().add(new THREE.Vector3(rnd(-0.2, 0.2), rnd(-0.1, 0.2), 0)), new THREE.Vector3(rnd(-0.004, 0.004), rnd(0.006, 0.014), 0), rnd(0.35, 0.55) * k, rnd(60, 90), {
            grow: 0.008,
            additive: false,
            opacity: 0.6,
          });
        }
        break;
      case 'confetti': {
        const cols = [0xff4060, 0x40c0ff, 0xffe040, 0x60ff80, 0xff80ff, 0xffffff];
        for (let i = 0; i < 40; i++) {
          const a = rnd(Math.PI * 0.15, Math.PI * 0.85);
          const sp = rnd(0.04, 0.09) * k;
          this.spawn(t.dot, cols[i % cols.length], P(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, rnd(-0.03, 0.03)), 0.06, rnd(50, 80), {
            gravity: 0.0016,
            drag: 0.03,
            additive: false,
          });
        }
        break;
      }
      case 'pain':
        this.spawn(t.star, 0xff2a2a, P(), new THREE.Vector3(), 0.3 * k, 12, { grow: 0.05 * k });
        this.spawn(t.ring, 0xff5040, P(), new THREE.Vector3(), 0.1, 12, { grow: 0.06 * k });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          this.spawn(t.dot, 0xff4030, P(), new THREE.Vector3(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0), 0.07, 14, { drag: 0.08 });
        }
        break;
      case 'veins': {
        const sp = this.spawn(g.vein, 0xff2020, P().add(new THREE.Vector3(0.12 * dir, 0.12, 0.12)), new THREE.Vector3(), 0.22 * k, 40, { additive: false, pop: true });
        sp.renderOrder = 11;
        for (let i = 0; i < 6; i++) {
          this.spawn(t.puff, 0xffffff, P().add(new THREE.Vector3(rnd(-0.2, 0.2), rnd(-0.1, 0.1), 0)), new THREE.Vector3(rnd(-0.01, 0.01), rnd(0.015, 0.03), 0), 0.25 * k, rnd(24, 36), {
            grow: 0.01,
            additive: false,
            opacity: 0.7,
          });
        }
        break;
      }
      case 'web':
        this.spawn(g.web, 0xffffff, P(), new THREE.Vector3(), 0.2 * k, 60, { grow: 0.05 * k, additive: false });
        break;
      case 'speed':
        for (let i = 0; i < 10; i++) {
          const v = new THREE.Vector3(-dir * rnd(0.03, 0.08), rnd(0, 0.006), rnd(-0.01, 0.01));
          this.spawn(t.puff, i % 2 ? 0xd8d0c0 : 0xffffff, P().add(new THREE.Vector3(0, rnd(-0.9, 0.6), rnd(-0.2, 0.2))), v, rnd(0.15, 0.3) * k, rnd(10, 18), {
            additive: false,
            opacity: 0.7,
          });
        }
        this.dust(pos.x, false);
        break;
    }
  }

  /** one smoke puff (rocket trail) */
  trail(pos: THREE.Vector3) {
    const t = tex();
    this.spawn(t.puff, 0xd0ccc4, pos.clone(), new THREE.Vector3(rnd(-0.003, 0.003), 0.004, 0), 0.18, 30, { grow: 0.01, additive: false, opacity: 0.6 });
    this.spawn(t.puff, 0xffa020, pos.clone(), new THREE.Vector3(), 0.12, 4);
  }

  // -------------------------------------------------------------------------
  // BBL KART: drift sparks, turbo flames, dust, item hits (velocities in m / frame)
  // -------------------------------------------------------------------------

  /** mini-turbo spark at a rear wheel */
  kartSpark(pos: THREE.Vector3, color: number, vel: THREE.Vector3, big = false) {
    const t = tex();
    this.spawn(t.dot, color, pos.clone(), vel, big ? 0.14 : 0.09, big ? 14 : 9, { gravity: 0.006, depthTest: true });
    if (big) this.spawn(t.star, color, pos.clone(), new THREE.Vector3(), 0.32, 4, { depthTest: true });
  }

  /** turbo flame out of an exhaust (`back` = direction of the flame, m / frame) */
  flame(pos: THREE.Vector3, back: THREE.Vector3, color = 0xff8a20, size = 1) {
    const t = tex();
    this.spawn(t.puff, 0xfff0a0, pos.clone(), back.clone().multiplyScalar(0.5), 0.16 * size, 4, { depthTest: true, grow: -0.01 });
    this.spawn(t.puff, color, pos.clone(), back.clone(), 0.22 * size, 7, { depthTest: true, grow: 0.01 });
  }

  /** dust / smoke / splash puff (not additive) */
  puff(pos: THREE.Vector3, color: number, size: number, life: number, vel: THREE.Vector3, opacity = 0.7) {
    const t = tex();
    this.spawn(t.puff, color, pos.clone(), vel, size, life, { grow: size * 0.03, additive: false, opacity, depthTest: true, drag: 0.04 });
  }

  /** glowing flash + ring (boost start, item box, landing a trick) */
  flash(pos: THREE.Vector3, color: number, size = 1) {
    const t = tex();
    this.spawn(t.star, 0xffffff, pos.clone(), new THREE.Vector3(), 0.5 * size, 6, { grow: 0.05 * size });
    this.spawn(t.ring, color, pos.clone(), new THREE.Vector3(), 0.3 * size, 12, { grow: 0.1 * size });
  }

  /** small burst of coloured dots (item box broken, coins...) */
  pop(pos: THREE.Vector3, colors: number[], n = 12, speed = 0.08) {
    const t = tex();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = rnd(-0.3, 1);
      const v = new THREE.Vector3(Math.cos(a) * speed * (1 - Math.abs(e) * 0.5), e * speed + 0.02, Math.sin(a) * speed * (1 - Math.abs(e) * 0.5));
      this.spawn(t.dot, colors[i % colors.length], pos.clone(), v, rnd(0.1, 0.18), rnd(16, 26), { gravity: 0.005, depthTest: true });
    }
  }

  /** confetti rain around a point (finish line, podium) */
  confetti(pos: THREE.Vector3, n = 30, radius = 2) {
    const t = tex();
    const cols = [0xff4050, 0xffd040, 0x40d0ff, 0x60ff70, 0xff70e0, 0xffffff];
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3(rnd(-radius, radius), rnd(0, radius), rnd(-radius, radius)));
      this.spawn(t.dot, cols[i % cols.length], p, new THREE.Vector3(rnd(-0.01, 0.01), rnd(0.01, 0.04), rnd(-0.01, 0.01)), rnd(0.08, 0.14), rnd(70, 110), {
        gravity: 0.0012,
        additive: false,
        aspect: 0.6,
        spin: rnd(-0.3, 0.3),
        drag: 0.02,
        depthTest: true,
      });
    }
  }

  update(dtRaw: number) {
    const dtFrames = dtRaw * this.timeScale;
    this.updateSolids(dtFrames);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dtFrames;
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dtFrames;
      if (p.drag) p.vel.multiplyScalar(Math.pow(1 - p.drag, dtFrames));
      if (p.orbit) {
        const o = p.orbit;
        o.a += o.w * dtFrames;
        p.sprite.position.set(o.c.x + Math.cos(o.a) * o.r, o.c.y + Math.sin(o.a * 2) * 0.03, o.c.z + Math.sin(o.a) * o.r * 0.6);
      } else {
        p.sprite.position.addScaledVector(p.vel, dtFrames);
      }
      if (p.spin) p.sprite.material.rotation += p.spin * dtFrames;
      if (p.pop) {
        const age = p.max - p.life;
        const t = Math.min(1, age / 8);
        const sc = p.baseScale * (t < 1 ? 0.2 + 1.2 * Math.sin(t * Math.PI * 0.75) : 1);
        p.sprite.scale.set(sc * p.aspect, sc, 1);
      } else {
        const s = Math.max(0.01, p.sprite.scale.y + p.grow * dtFrames);
        p.sprite.scale.set(s * p.aspect, s, 1);
      }
      const k = p.life / p.max;
      p.sprite.material.opacity = Math.min(1, k * 1.6) * (p.sprite.material.userData.o ?? 1);
    }
  }

  clear() {
    for (const p of this.parts) {
      this.group.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.parts.length = 0;
    for (const c of this.chunks) this.group.remove(c.mesh);
    this.chunks.length = 0;
    for (const d of this.decals) {
      this.group.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
    this.decals.length = 0;
  }

  /**
   * One of every effect (shader / texture warm-up before a fight). The instance
   * is never drawn nor updated: it only keeps those materials, and so their
   * compiled shaders, alive until it is disposed.
   */
  sampleAll(stageId: string) {
    const p = new THREE.Vector3(0, 1, 0);
    this.hit(0, 1, 'heavy', true);
    this.hit(0, 1, 'light', false);
    this.block(0, 1);
    this.parry(0, 1);
    this.tech(0, 1);
    this.dust(0, true);
    this.aura(p);
    for (const fx of ALL_CINE_FX) this.cine(fx, p);
    this.trail(p);
    this.impactBurst(0, 1, 3, 1, true);
    this.wallCrack(0, 1, 1, true);
    this.wallBreak(0, 1, 1, stageId);
    this.groundSlam(0, true);
    this.burst(0, 1, 1, 'superJump');
    this.burst(0, 1, 1, 'airDash');
    this.dizzyStars(p, 60);
    for (const g of ['heart', 'note', 'question', 'exclaim'] as const) this.glyph(g, p);
    for (const k of ['grenade', 'web', 'words', 'energy'] as const) {
      for (const how of ['hit', 'block', 'out'] as const) this.shotImpact(k, p, how);
      this.shotSpawn(k, p, 1);
      this.shotTrail(k, p, 1);
    }
    this.shotClash(p);
    this.block(0, 1, 0.9);
    this.guardShatter(0, 1, 1);
  }

  /** Frees everything (geometries and materials owned by this instance). */
  dispose() {
    this.clear();
    this.chunkGeo?.dispose();
    this.flatGeo?.dispose();
    for (const m of this.chunkMats.values()) m.dispose();
    this.chunkMats.clear();
    this.chunkGeo = null;
    this.flatGeo = null;
  }

  // -------------------------------------------------------------------------
  // hit feel: big impacts, bounces, the destruction finish
  // -------------------------------------------------------------------------

  /**
   * Big hit spark for heavy / special hits (on top of `hit`): white core, double
   * shockwave, spark streaks flying away from the attacker (`dir` = attacker's facing).
   * `tier` 1 = heavy hit, 2 = counter / launcher / bounce, 3 = K.O. blow.
   */
  impactBurst(x: number, y: number, tier: 1 | 2 | 3, dir: number, counter = false) {
    const t = tex();
    const p = new THREE.Vector3(x, y, 0.4);
    const k = tier === 3 ? 1.6 : tier === 2 ? 1.3 : 1;
    const col = counter ? 0xff3a2a : tier === 3 ? 0xffd040 : 0xffb030;
    this.spawn(t.star, col, p.clone(), new THREE.Vector3(), 0.6 * k, 6, { grow: 0.03 * k, rot: 0.4, opacity: 0.6 });
    this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(), 0.3, 8, { grow: 0.17 * k, opacity: 0.8 });
    this.spawn(t.ring, col, p.clone(), new THREE.Vector3(), 0.2, 10, { grow: 0.11 * k, opacity: 0.85 });
    const n = tier === 1 ? 8 : 14;
    for (let i = 0; i < n; i++) {
      // streaks fan out mostly away from the attacker
      const a = (dir > 0 ? 0 : Math.PI) + rnd(-1.3, 1.3) + (Math.random() < 0.25 ? Math.PI : 0);
      const sp = rnd(0.07, 0.16) * k;
      this.spawn(t.dot, i % 3 ? col : 0xffffff, p.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), rnd(0.05, 0.08) * k, rnd(8, 14), {
        aspect: rnd(5, 8),
        rot: a,
        drag: 0.12,
      });
    }
  }

  /**
   * The arena wall (invisible otherwise) cracks where a fighter slammed into it.
   * `side` = +1 right wall, -1 left wall.
   */
  wallCrack(x: number, y: number, side: number, big = false) {
    const t = tex();
    const p = new THREE.Vector3(x, Math.max(0.5, y), 0.3);
    // the cracks sit behind the character slammed into the wall
    const sp = this.spawn(t.crack, 0xffffff, new THREE.Vector3(x, p.y, -0.45), new THREE.Vector3(), big ? 2.3 : 1.7, big ? 34 : 46, {
      additive: false,
      pop: true,
      rot: Math.random() * Math.PI * 2,
      depthTest: true,
    });
    sp.renderOrder = 9;
    this.spawn(t.ring, 0xa0e0ff, p.clone(), new THREE.Vector3(), 0.3, 12, { grow: 0.16 });
    // dust sliding down the wall
    for (let i = 0; i < 8; i++) {
      this.spawn(t.puff, 0xd8d0c4, p.clone().add(new THREE.Vector3(-side * rnd(0, 0.15), rnd(-0.5, 0.5), rnd(-0.2, 0.2))), new THREE.Vector3(-side * rnd(0.005, 0.02), rnd(-0.01, 0.01), 0), rnd(0.3, 0.5), rnd(22, 34), {
        grow: 0.012,
        additive: false,
        opacity: 0.65,
        drag: 0.05,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.spawn(t.shard, 0xe8f4ff, p.clone(), new THREE.Vector3(-side * rnd(0.02, 0.06), rnd(-0.02, 0.05), rnd(-0.02, 0.02)), rnd(0.07, 0.12), rnd(16, 26), {
        additive: false,
        gravity: 0.004,
        spin: rnd(-0.3, 0.3),
      });
    }
  }

  /**
   * Destruction finish: the arena wall bursts open. Shards of the barrier, solid
   * chunks of scenery (stage palette), a dust cloud and a big flash.
   * `side` = direction the fighter is flying (+1 / -1).
   */
  wallBreak(x: number, y: number, side: number, stageId: string) {
    const t = tex();
    const pal = DEBRIS_PALETTES[stageId] ?? DEFAULT_PALETTE;
    const p = new THREE.Vector3(x, Math.max(0.6, y), 0.3);
    const crack = this.spawn(t.crack, 0xffffff, new THREE.Vector3(x, p.y, -0.45), new THREE.Vector3(), 2.6, 18, { additive: false, pop: true, depthTest: true });
    crack.renderOrder = 9;
    this.spawn(t.star, 0xffffff, p.clone(), new THREE.Vector3(), 1.1, 6, { grow: 0.08, opacity: 0.85 });
    this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(), 0.3, 10, { grow: 0.16, opacity: 0.8 });
    this.spawn(t.ring, 0xffc040, p.clone(), new THREE.Vector3(), 0.2, 14, { grow: 0.11, opacity: 0.8 });
    // barrier shards
    for (let i = 0; i < 26; i++) {
      const a = rnd(-1.2, 1.2);
      const sp = rnd(0.04, 0.12);
      this.spawn(
        t.shard,
        i % 4 ? 0xe8f4ff : 0x9fdcff,
        p.clone().add(new THREE.Vector3(0, rnd(-0.8, 0.8), rnd(-0.4, 0.4))),
        new THREE.Vector3(side * Math.cos(a) * sp, Math.sin(a) * sp + 0.02, rnd(-0.03, 0.05)),
        rnd(0.08, 0.2),
        rnd(36, 60),
        { additive: false, gravity: 0.0035, spin: rnd(-0.35, 0.35), rot: rnd(0, 6) },
      );
    }
    // solid chunks: rocks / bricks / planks of the stage
    for (let i = 0; i < 22; i++) {
      const plank = i % 3 === 0;
      const size = plank ? new THREE.Vector3(rnd(0.35, 0.7), rnd(0.05, 0.09), rnd(0.1, 0.18)) : new THREE.Vector3(rnd(0.1, 0.24), rnd(0.08, 0.2), rnd(0.1, 0.22));
      const a = rnd(-0.5, 1.2);
      const sp = rnd(0.05, 0.14);
      this.chunk(
        pal.solid[i % pal.solid.length],
        new THREE.Vector3(x + side * rnd(-0.1, 0.4), Math.max(0.2, y + rnd(-0.7, 0.9)), rnd(-0.6, 0.6)),
        new THREE.Vector3(side * Math.cos(a) * sp, Math.sin(a) * sp + 0.03, rnd(-0.04, 0.06)),
        size,
        rnd(90, 140),
      );
    }
    // dust cloud (mostly behind the fight lane, so it does not hide the flying fighter)
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(side * rnd(0.005, 0.035), rnd(0.002, 0.016), rnd(-0.02, 0.005));
      this.spawn(t.puff, pal.dust, p.clone().add(new THREE.Vector3(rnd(-0.2, 0.6) * side, rnd(-0.9, 0.5), rnd(-1.0, 0.1))), v, rnd(0.4, 0.7), rnd(45, 70), {
        grow: 0.012,
        additive: false,
        opacity: 0.6,
        drag: 0.03,
        depthTest: true,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.05, 0.12);
      this.spawn(t.dot, 0xffc060, p.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, rnd(-0.03, 0.03)), 0.08, rnd(20, 34), { gravity: 0.004 });
    }
    this.dust(x + side * 0.4, true);
  }

  /** Ground bounce: crater decal, flat shockwave and a ring of dust on the floor. */
  groundSlam(x: number, big = true) {
    const t = tex();
    this.decal(t.crater, 0xffffff, x, big ? 1.9 : 1.4, 150, 0, 0.9, false);
    this.decal(t.ring, 0xfff0c0, x, 0.4, 16, big ? 0.22 : 0.15, 1, true);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.spawn(
        t.puff,
        0xc8b8a0,
        new THREE.Vector3(x + Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3),
        new THREE.Vector3(Math.cos(a) * 0.035, 0.008, Math.sin(a) * 0.03),
        rnd(0.35, 0.55),
        rnd(26, 36),
        { grow: 0.014, additive: false, opacity: 0.75, drag: 0.07 },
      );
    }
    for (let i = 0; i < 8; i++) {
      const a = rnd(0.3, Math.PI - 0.3);
      this.chunk(0x6a625a, new THREE.Vector3(x + rnd(-0.3, 0.3), 0.06, rnd(-0.3, 0.3)), new THREE.Vector3(Math.cos(a) * 0.05, Math.sin(a) * 0.08, rnd(-0.03, 0.03)), new THREE.Vector3(rnd(0.05, 0.1), rnd(0.04, 0.08), rnd(0.05, 0.1)), rnd(40, 60));
    }
  }

  /** Puff of air + dust under a fighter springing up (super jump) or kicking off in the air (air dash). */
  burst(x: number, y: number, dir: number, kind: 'superJump' | 'airDash') {
    const t = tex();
    if (kind === 'superJump') {
      this.decal(t.ring, 0xffffff, x, 0.3, 14, 0.12, 0.9, true);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.spawn(t.puff, 0xe8e0d0, new THREE.Vector3(x + Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2), new THREE.Vector3(Math.cos(a) * 0.03, 0.01, Math.sin(a) * 0.025), 0.35, rnd(18, 26), {
          grow: 0.012,
          additive: false,
          opacity: 0.75,
          drag: 0.06,
        });
      }
      for (let i = 0; i < 6; i++) {
        this.spawn(t.dot, 0xffffff, new THREE.Vector3(x + rnd(-0.3, 0.3), 0.3 + rnd(0, 0.8), 0.2), new THREE.Vector3(0, rnd(0.06, 0.12), 0), 0.05, rnd(10, 16), { aspect: 0.15, drag: 0.08 });
      }
    } else {
      const p = new THREE.Vector3(x - dir * 0.3, y + 1.0, 0.1);
      this.spawn(t.ring, 0xffffff, p.clone(), new THREE.Vector3(-dir * 0.01, 0, 0), 0.25, 12, { grow: 0.08, aspect: 0.45 });
      for (let i = 0; i < 8; i++) {
        this.spawn(t.puff, 0xf0ece4, p.clone().add(new THREE.Vector3(0, rnd(-0.5, 0.4), rnd(-0.2, 0.2))), new THREE.Vector3(-dir * rnd(0.02, 0.05), rnd(-0.005, 0.005), 0), rnd(0.2, 0.32), rnd(12, 20), {
          grow: 0.01,
          additive: false,
          opacity: 0.7,
          drag: 0.08,
        });
      }
    }
  }

  /** Dizzy stars circling over a head for `frames` frames. */
  dizzyStars(pos: THREE.Vector3, frames: number) {
    const g = glyphTex();
    for (let i = 0; i < 5; i++) {
      this.spawn(g.star5, 0xffe040, pos.clone(), new THREE.Vector3(), 0.13, Math.max(20, frames), {
        orbit: { c: pos.clone(), r: 0.24, a: (i / 5) * Math.PI * 2, w: 0.1 },
      });
    }
  }

  /** Little floating symbols around a goofy assist (hearts, notes, question marks). */
  glyph(kind: 'heart' | 'note' | 'question' | 'exclaim', pos: THREE.Vector3, scale = 1) {
    const g = glyphTex();
    const sp = this.spawn(g[kind], 0xffffff, pos.clone(), new THREE.Vector3(rnd(-0.006, 0.006), rnd(0.008, 0.016), 0), 0.26 * scale, rnd(40, 56), {
      additive: false,
      pop: true,
      drag: 0.01,
    });
    sp.renderOrder = 11;
  }

  /**
   * A projectile is gone (assist shots, the ranged profile's projectile): explosion, web
   * splat, word burst or energy pop. `how`: it connected, was guarded, met the other
   * projectile (both pop) or flew off the arena.
   */
  shotImpact(kind: ShotKind, pos: THREE.Vector3, how: ShotEnd = 'hit') {
    const t = tex();
    const small = how === 'block' || how === 'clash';
    if (kind === 'grenade') {
      this.cine('explosion', pos, how === 'hit' ? 1.1 : how === 'out' ? 0.75 : 0.9);
      return;
    }
    if (how === 'out') {
      // fizzles out at the edge of the arena
      this.spawn(t.puff, kind === 'energy' ? 0x60c8ff : 0xf0f0f0, pos.clone(), new THREE.Vector3(0, 0.004, 0), 0.35, 16, { grow: 0.02, additive: kind === 'energy', opacity: 0.7 });
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawn(t.dot, kind === 'energy' ? 0x9fe0ff : kind === 'words' ? 0xffe040 : 0xffffff, pos.clone(), new THREE.Vector3(Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0), 0.05, 14, { drag: 0.06 });
      }
      return;
    }
    if (kind === 'web') {
      // the web sticks on the opponent (or their guard) for a moment
      const g = glyphTex();
      const sp = this.spawn(g.web, 0xffffff, pos.clone().setZ(0.3), new THREE.Vector3(), small ? 0.6 : 0.9, small ? 30 : 50, { additive: false, pop: true });
      sp.renderOrder = 11;
      this.spawn(t.ring, 0xffffff, pos.clone(), new THREE.Vector3(), 0.2, 10, { grow: 0.08 });
      for (let i = 0; i < (small ? 8 : 5); i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawn(t.dot, 0xffffff, pos.clone(), new THREE.Vector3(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0), 0.05, 16, { drag: 0.05, gravity: 0.002, aspect: 3, rot: a });
      }
    } else if (kind === 'words') {
      const col = how === 'block' ? 0xd8d8d8 : 0xffe040;
      this.spawn(t.star, col, pos.clone(), new THREE.Vector3(), small ? 0.6 : 0.8, 8, { grow: 0.08 });
      this.spawn(t.ring, col, pos.clone(), new THREE.Vector3(), 0.15, 10, { grow: 0.09 });
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(0.04, 0.07);
        this.spawn(t.dot, i % 2 ? col : 0xffffff, pos.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), 0.07, 16, { drag: 0.06, gravity: 0.002 });
      }
    } else {
      // energy ball
      this.spawn(t.star, 0xffffff, pos.clone(), new THREE.Vector3(), small ? 0.7 : 0.95, 7, { grow: 0.07 });
      this.spawn(t.puff, 0x40a8ff, pos.clone(), new THREE.Vector3(), 0.6, 12, { grow: 0.04 });
      this.spawn(t.ring, 0x80d8ff, pos.clone(), new THREE.Vector3(), 0.2, 12, { grow: small ? 0.09 : 0.13 });
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rnd(0.05, 0.1);
        this.spawn(t.dot, i % 3 ? 0x80d8ff : 0xffffff, pos.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), 0.06, rnd(10, 16), { drag: 0.08, aspect: 3, rot: a });
      }
    }
  }

  /** The two projectiles met: a white pop between them (on top of each one's own impact). */
  shotClash(pos: THREE.Vector3) {
    const t = tex();
    this.spawn(t.star, 0xffffff, pos.clone(), new THREE.Vector3(), 1.2, 8, { grow: 0.09 });
    this.spawn(t.ring, 0xffffff, pos.clone(), new THREE.Vector3(), 0.3, 12, { grow: 0.2, opacity: 0.9 });
    this.spawn(t.ring, 0xffe080, pos.clone(), new THREE.Vector3(), 0.2, 14, { grow: 0.13 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.07, 0.15);
      this.spawn(t.dot, i % 2 ? 0xffe080 : 0xffffff, pos.clone(), new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp, 0), rnd(0.05, 0.07), rnd(8, 14), {
        aspect: rnd(4, 7),
        rot: a,
        drag: 0.1,
      });
    }
  }

  /** A fighter throws their projectile: puff / flash at the hand, `dir` = the throw's direction. */
  shotSpawn(kind: ShotKind, pos: THREE.Vector3, dir: number) {
    const t = tex();
    if (kind === 'energy') {
      this.spawn(t.star, 0xbfeaff, pos.clone(), new THREE.Vector3(), 0.7, 6, { grow: 0.05 });
      this.spawn(t.ring, 0x60c8ff, pos.clone(), new THREE.Vector3(), 0.15, 10, { grow: 0.07, aspect: 0.5 });
    } else if (kind === 'words') {
      this.spawn(t.star, 0xffe040, pos.clone(), new THREE.Vector3(), 0.45, 6, { grow: 0.04 });
    } else if (kind === 'web') {
      this.spawn(t.ring, 0xffffff, pos.clone(), new THREE.Vector3(), 0.1, 8, { grow: 0.05 });
    }
    // a little gust of air behind the throw
    for (let i = 0; i < 4; i++) {
      this.spawn(t.puff, 0xf0ece4, pos.clone().add(new THREE.Vector3(-dir * 0.1, rnd(-0.1, 0.1), rnd(-0.1, 0.1))), new THREE.Vector3(-dir * rnd(0.01, 0.02), rnd(-0.003, 0.006), 0), rnd(0.14, 0.22), rnd(10, 16), {
        grow: 0.01,
        additive: false,
        opacity: 0.55,
        drag: 0.08,
      });
    }
  }

  /** what a flying projectile leaves behind (grenade smoke, energy sparks), called every few frames */
  shotTrail(kind: ShotKind, pos: THREE.Vector3, dir: number) {
    const t = tex();
    if (kind === 'grenade') this.trail(pos);
    else if (kind === 'energy') {
      this.spawn(t.puff, 0x3a90ff, pos.clone(), new THREE.Vector3(-dir * 0.01, rnd(-0.003, 0.003), 0), 0.32, 12, { grow: -0.012 });
      this.spawn(t.dot, 0xbfeaff, pos.clone().add(new THREE.Vector3(0, rnd(-0.12, 0.12), 0)), new THREE.Vector3(-dir * rnd(0.01, 0.03), rnd(-0.008, 0.008), 0), 0.05, rnd(8, 12), { drag: 0.05 });
    } else if (kind === 'words') {
      this.spawn(t.dot, 0xffe040, pos.clone().add(new THREE.Vector3(-dir * 0.3, rnd(-0.1, 0.1), 0)), new THREE.Vector3(-dir * 0.01, 0, 0), 0.05, 10, { drag: 0.05 });
    }
  }

  private chunkMat(color: number): PS1Material {
    let m = this.chunkMats.get(color);
    if (!m) {
      m = createPS1Material({ color });
      this.chunkMats.set(color, m);
    }
    return m;
  }

  private chunk(color: number, pos: THREE.Vector3, vel: THREE.Vector3, size: THREE.Vector3, life: number) {
    if (this.chunks.length > 70) return;
    if (!this.chunkGeo) this.chunkGeo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(this.chunkGeo, this.chunkMat(color));
    mesh.position.copy(pos);
    mesh.scale.copy(size);
    mesh.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
    this.group.add(mesh);
    this.chunks.push({ mesh, vel, rot: new THREE.Vector3(rnd(-0.25, 0.25), rnd(-0.25, 0.25), rnd(-0.25, 0.25)), size: size.clone(), life, max: life });
  }

  /** Flat decal lying on the floor at x (`grow` > 0: expanding shockwave). */
  private decal(map: THREE.Texture, color: number, x: number, size: number, life: number, grow: number, opacity: number, additive: boolean) {
    if (!this.flatGeo) this.flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(this.flatGeo, mat);
    mesh.position.set(x, 0.02 + this.decals.length * 0.002, 0);
    mesh.scale.set(size, 1, size * 0.8);
    mesh.rotation.y = rnd(0, Math.PI * 2);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.decals.push({ mesh, life, max: life, grow, opacity });
  }

  private updateSolids(dt: number) {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.group.remove(c.mesh);
        this.chunks.splice(i, 1);
        continue;
      }
      const m = c.mesh;
      c.vel.y -= 0.0045 * dt;
      m.position.addScaledVector(c.vel, dt);
      const half = c.size.y * 0.5;
      if (m.position.y < half) {
        // bounce on the floor, losing energy and spin
        m.position.y = half;
        c.vel.y = Math.abs(c.vel.y) > 0.02 ? -c.vel.y * 0.35 : 0;
        c.vel.x *= 0.7;
        c.vel.z *= 0.7;
        c.rot.multiplyScalar(0.6);
      }
      m.rotation.x += c.rot.x * dt;
      m.rotation.y += c.rot.y * dt;
      m.rotation.z += c.rot.z * dt;
      // shrink away at the end of their life
      const k = Math.min(1, c.life / 20);
      m.scale.copy(c.size).multiplyScalar(k);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        mat.dispose();
        this.decals.splice(i, 1);
        continue;
      }
      if (d.grow) {
        d.mesh.scale.x += d.grow * dt;
        d.mesh.scale.z += d.grow * dt * 0.8;
      }
      mat.opacity = d.opacity * Math.min(1, (d.life / d.max) * (d.grow ? 1.5 : 3));
    }
  }
}
