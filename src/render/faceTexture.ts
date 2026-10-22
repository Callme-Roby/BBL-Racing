import * as THREE from 'three';
import type { FighterDef } from '../data/roster';
import { pixelTexture } from './ps1Material';

/** Face texture resolution (PS1-ish but still recognisable). */
export const FACE_W = 72;
export const FACE_H = 96;

export interface FaceAssets {
  texture: THREE.CanvasTexture;
  skin: THREE.Color;
  /** small canvas for menus (CSS-scaled with pixelated rendering) */
  portrait: HTMLCanvasElement;
  /** data URL of the portrait */
  portraitUrl: string;
}

const cache = new Map<string, Promise<FaceAssets>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + src.slice(0, 64)));
    img.src = src;
  });
}

/** Posterise to 5 bits per channel with a 4x4 ordered dither: PS1 15-bit colour look. */
function ps1Posterize(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 8;
      for (let c = 0; c < 3; c++) {
        const v = Math.max(0, Math.min(255, d[i + c] + t));
        d[i + c] = Math.round(v / 8) * 8;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Position of a texture pixel in the face oval, exactly as the face shader computes it
 * (ps1Material FACE_FRAG): p in [-1, 1] with y up, d = 1 on the oval's edge.
 */
function ovalAt(x: number, y: number, w: number, h: number): { px: number; py: number; d: number } {
  const px = ((x + 0.5) / w) * 2 - 1;
  const py = 1 - ((y + 0.5) / h) * 2;
  return { px, py, d: Math.hypot(px * 1.02, py * 0.98) };
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const smooth01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Body skin tone from the photo: the cheeks and jaw sides just inside the face oval (below the
 * eyes, beside the nose and mouth), i.e. the skin that meets the body at the oval's edge.
 * Robust: only mid-tones of skin-like colours are kept (drops beard, shadows, glasses frames,
 * specular highlights), then a per-channel median. No hue forcing: the body matches the photo.
 */
function sampleSkin(data: Uint8ClampedArray, w: number, h: number): THREE.Color {
  const s: [number, number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { px, py, d } = ovalAt(x, y, w, h);
      if (d < 0.42 || d > 0.86 || py < -0.62 || py > 0.06 || Math.abs(px) < 0.26) continue;
      const i = (y * w + x) * 4;
      s.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const median = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] ?? 160;
  };
  const mY = median(s.map((c) => lum(c[0], c[1], c[2])));
  let keep = s.filter((c) => {
    const Y = lum(c[0], c[1], c[2]);
    return Y > mY * 0.8 && Y < mY * 1.18 && c[0] >= c[2] * 0.92;
  });
  if (keep.length < 20) keep = s;
  const col = new THREE.Color(median(keep.map((c) => c[0])) / 255, median(keep.map((c) => c[1])) / 255, median(keep.map((c) => c[2])) / 255);
  // safety net only for wild colour casts: cap the saturation, keep hue and lightness
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  if (hsl.s > 0.55) col.setHSL(hsl.h, 0.55, hsl.l);
  return col;
}

/** Separable box blur (edge clamped), applied `passes` times: ~gaussian. */
function boxBlur(src: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
  const a = Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = acc / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        a[y * w + x] = acc / n;
      }
    }
  }
  return a;
}

/**
 * Makes the outer band of the face oval blend into the body skin tone: the local skin colour of
 * the photo (low-pass of the skin-like pixels only) is scaled toward `skin` near the oval's edge,
 * so the photo's own details (beard, brows, shadows) are kept but there is no colour step where
 * the shader fades the photo into the head / neck / ears colour.
 */
function matchEdgesToSkin(img: ImageData, skin: THREE.Color) {
  const { width: w, height: h, data } = img;
  const N = w * h;
  const S = [skin.r * 255, skin.g * 255, skin.b * 255];
  const YS = Math.max(1, lum(S[0], S[1], S[2]));
  const sumS = Math.max(1, S[0] + S[1] + S[2]);
  const ws = new Float32Array(N);
  const chan = [0, 1, 2].map(() => new Float32Array(N));
  const wchan = [0, 1, 2].map(() => new Float32Array(N));
  for (let i = 0; i < N; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const sum = Math.max(1, r + g + b);
    const dc = Math.hypot(r / sum - S[0] / sumS, g / sum - S[1] / sumS, b / sum - S[2] / sumS);
    const dl = Math.log(Math.max(1, lum(r, g, b)) / YS);
    const wt = Math.exp(-((dc / 0.04) ** 2) - (dl / 0.4) ** 2);
    ws[i] = wt;
    [r, g, b].forEach((v, c) => {
      chan[c][i] = v;
      wchan[c][i] = v * wt;
    });
  }
  const R = 4;
  const den = boxBlur(ws, w, h, R);
  const num = wchan.map((c) => boxBlur(c, w, h, R));
  const plain = chan.map((c) => boxBlur(c, w, h, R));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = smooth01(0.4, 0.92, ovalAt(x, y, w, h).d);
      if (k <= 0) continue;
      const t = Math.min(1, den[i] / 0.15);
      for (let c = 0; c < 3; c++) {
        const local = (num[c][i] / Math.max(den[i], 1e-4)) * t + plain[c][i] * (1 - t);
        const ratio = Math.min(1.6, Math.max(0.6, S[c] / Math.max(local, 1)));
        data[i * 4 + c] = Math.min(255, chan[c][i] * (1 + (ratio - 1) * k));
      }
    }
  }
}

/**
 * Full-head spider-hero mask (parody, no logo): mask colour = skin, a web radiating from the
 * nose, big white eye lenses outlined in black.
 */
function drawSpiderMask(ctx: CanvasRenderingContext2D, w: number, h: number, skin: THREE.Color, line: string) {
  const sx = w / 72;
  const sy = h / 96;
  // base colour with soft volume shading
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / sx;
      const y = (py + 0.5) / sy;
      const dx = (x - 36) / 36;
      let f = 1 - 0.15 * Math.abs(dx) ** 2.2 + 0.035 * dx;
      f -= 0.1 * Math.max(0, (y - 76) / 20) ** 2 * (0.3 + Math.abs(dx));
      f += 0.05 * Math.exp(-(((x - 37) / 4) ** 2) - ((y - 52) / 9) ** 2); // nose ridge
      const i = (py * w + px) * 4;
      d[i] = Math.min(255, skin.r * f * 255);
      d[i + 1] = Math.min(255, skin.g * f * 255);
      d[i + 2] = Math.min(255, skin.b * f * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.scale(sx, sy);
  ctx.strokeStyle = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // web: spokes from the nose + sagging rings
  const cx = 36;
  const cy = 50;
  const spokes = 16;
  const ang = (i: number) => (i / spokes) * Math.PI * 2 + 0.1;
  ctx.lineWidth = 1.05;
  for (let i = 0; i < spokes; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang(i)) * 90, cy + Math.sin(ang(i)) * 90);
    ctx.stroke();
  }
  for (const r of [7, 14, 22, 31, 41, 52, 64]) {
    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a0 = ang(i);
      const a1 = ang(i + 1);
      const am = (a0 + a1) / 2;
      const x0 = cx + Math.cos(a0) * r;
      const y0 = cy + Math.sin(a0) * r;
      if (i === 0) ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx + Math.cos(am) * r * 0.8, cy + Math.sin(am) * r * 0.8, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    }
    ctx.stroke();
  }
  // big eye lenses (picture left, then mirrored)
  for (const m of [1, -1]) {
    const X = (x: number) => (m === 1 ? x : 72 - x);
    ctx.beginPath();
    ctx.moveTo(X(32), 47);
    ctx.quadraticCurveTo(X(31), 32, X(17), 29);
    ctx.quadraticCurveTo(X(6), 28, X(7), 38);
    ctx.quadraticCurveTo(X(10), 48, X(32), 47);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 29, 0, 48);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#c8d0dc');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  ctx.restore();
}

function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function seedOf(s: string): number {
  let n = 7;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 100003;
  return n;
}

/**
 * Draws a pixel-art face for fighters without a photo.
 * Designed on a 72x96 grid (scaled to w x h): the texture covers hairline → chin and
 * cheek → cheek; eyes at ~42% from the top, mouth at ~74%, chin at ~93%.
 * The light comes from the upper right of the picture (the fighter's left).
 */
export function drawProceduralFace(ctx: CanvasRenderingContext2D, w: number, h: number, def: FighterDef) {
  const fg = def.faceGen ?? {};
  const skin = new THREE.Color(def.skin ?? '#c89070');
  if (fg.mask === 'spider') {
    drawSpiderMask(ctx, w, h, skin, fg.maskLine ?? '#121216');
    ps1Posterize(ctx, w, h);
    return;
  }
  const seed = seedOf(def.id);
  const sx = w / 72;
  const sy = h / 96;
  const C = (c: string | THREE.Color) => (typeof c === 'string' ? new THREE.Color(c) : c.clone());
  const css = (c: THREE.Color) => '#' + c.getHexString();
  const tone = (k: number) => skin.clone().multiplyScalar(k);
  const mix = (a: string | THREE.Color, b: string | THREE.Color, t: number) => C(a).lerp(C(b), t);
  /** fill a rectangle given in 72x96 design pixels */
  const R = (x: number, y: number, ww: number, hh: number, col: THREE.Color | string) => {
    ctx.fillStyle = typeof col === 'string' ? col : css(col);
    ctx.fillRect(Math.round(x * sx), Math.round(y * sy), Math.max(1, Math.round(ww * sx)), Math.max(1, Math.round(hh * sy)));
  };
  const P = (x: number, y: number, col: THREE.Color | string) => R(x, y, 1, 1, col);
  const lum = (c: THREE.Color) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;

  // ---- 1. base skin with soft volume shading (per pixel) ----
  const eyeL = 23;
  const eyeR = 49;
  const eyeY = 40;
  {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const g2 = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const x = (px + 0.5) / sx;
        const y = (py + 0.5) / sy;
        const dx = (x - 36) / 36;
        let f = 1 - 0.17 * Math.abs(dx) ** 2.2 + 0.035 * dx;
        f -= 0.1 * Math.max(0, (y - 76) / 20) ** 2 * (0.3 + Math.abs(dx)); // jaw
        f += 0.035 * g2(x, y, 40, 22, 14, 8); // forehead
        f += 0.04 * g2(x, y, 54, 50, 6, 5) + 0.02 * g2(x, y, 18, 50, 6, 5); // cheekbones
        f -= 0.07 * (g2(x, y, eyeL + 1, eyeY - 1, 9, 4.5) + g2(x, y, eyeR - 1, eyeY - 1, 9, 4.5)); // eye sockets
        f -= 0.05 * g2(x, y, 36, 80, 9, 2.5); // under the lower lip
        f += 0.03 * g2(x, y, 37, 86, 6, 3); // chin
        const i = (py * w + px) * 4;
        d[i] = Math.min(255, skin.r * f * 255);
        d[i + 1] = Math.min(255, skin.g * f * 255);
        d[i + 2] = Math.min(255, skin.b * f * 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- 1b. hair / headwear band at the very top: only seen on menu portraits, the 3D hair covers it ----
  {
    const st = def.hair.style;
    const hairC = C(def.hair.color);
    const wear = def.accessories?.cap ? C(def.accessories.cap) : hairC;
    const band = (rows: number, col: THREE.Color, amount = 1, x0 = 0, x1 = 72) => {
      for (let x = x0; x < x1; x++) {
        const edge = rows + 3 * ((x - 35.5) / 36) ** 2 + (hash01(seed + x * 3.7) - 0.5) * 1.6;
        for (let y = 0; y < edge; y++) P(x, y, mix(skin, col.clone().multiplyScalar(0.85 + 0.3 * hash01(seed + x * 7.1 + y * 13.3)), amount));
      }
    };
    if (st === 'buzz') band(11, hairC, 0.6);
    else if (st === 'mohawk') {
      band(9, hairC, 0.35);
      band(12, hairC, 1, 28, 44);
    } else if (st === 'afro' || st === 'bigafro') band(15, hairC);
    else if (st === 'cap' || st === 'bandana') {
      band(st === 'cap' ? 12 : 14, wear);
      R(0, st === 'cap' ? 13 : 15, 72, 1, wear.clone().multiplyScalar(0.7));
    } else if (st !== 'bald') band(13, hairC);
  }

  const browCol = C(fg.brows ?? mix(def.hair.style === 'bald' ? '#2a1a10' : def.hair.color, '#20140c', 0.45));
  const beardCol = C(fg.beardColor ?? browCol);
  const dark = mix(tone(0.3), '#140c0a', 0.5);
  const lips = C(fg.lips ?? mix(skin, '#a84a48', 0.38).multiplyScalar(0.9));
  const mouth = fg.mouth ?? 'neutral';
  const angry = mouth === 'frown';

  // ---- 2. beards (under the features) ----
  const inBeard = (x: number, y: number) => {
    const dd = Math.abs(x - 35.5);
    let topY: number;
    if (dd >= 30) topY = 46;
    else if (dd >= 12) topY = 68 - (dd - 12);
    else topY = 74;
    return y >= topY ? y - topY : -1;
  };
  const speckle = (x: number, y: number) => hash01(seed + x * 13.1 + y * 71.7);
  if (fg.beard || fg.stubble) {
    for (let y = 44; y < 96; y++) {
      for (let x = 0; x < 72; x++) {
        const depth = inBeard(x + 0.5, y + 0.5);
        if (depth < 0) continue;
        const n = speckle(x, y);
        if (fg.beard) {
          const edge = depth < 2 ? 0.5 : 1;
          if (depth < 2 && n < 0.4) continue;
          P(x, y, mix(skin, beardCol.clone().multiplyScalar(0.85 + 0.3 * n), edge * 0.92));
        } else if (n < 0.5) {
          P(x, y, mix(skin, beardCol, 0.28 + 0.12 * n));
        }
      }
    }
  }
  if (fg.goatee) {
    for (let y = 76; y < 93; y++) {
      const half = y > 85 ? 8 - (y - 85) * 0.9 : 8;
      for (let x = Math.round(36 - half); x < 36 + half; x++) {
        const n = speckle(x, y);
        if ((x < 36 - half + 1.5 || x > 36 + half - 2 || y > 90) && n < 0.5) continue;
        P(x, y, beardCol.clone().multiplyScalar(0.85 + 0.3 * n));
      }
    }
    if (fg.moustache) {
      // thin lines joining the moustache to the goatee around the mouth
      for (let y = 67; y < 77; y++) {
        const x = y < 72 ? 27 : 28;
        P(x, y, beardCol.clone().multiplyScalar(0.9));
        P(71 - x, y, beardCol.clone().multiplyScalar(0.9));
      }
    }
  }

  // ---- 3. eyes ----
  const white = mix('#f2eee6', skin, 0.14);
  const iris = C(fg.eyes ?? '#3a2616');
  for (const cx of [eyeL, eyeR]) {
    const outer = cx < 36 ? -1 : 1;
    R(cx - 4, 34, 9, 1, tone(0.82)); // lid crease
    R(cx - 4, 37, 9, 1, white);
    R(cx - 5, 38, 11, 3, white);
    R(cx - 4, 41, 9, 1, white);
    R(cx - 2, 37, 5, 5, iris);
    R(cx - 2, 37, 5, 1, iris.clone().multiplyScalar(0.6));
    R(cx - 1, 38, 3, 2, '#0c0808');
    P(cx + 1, 38, '#ffffff');
    R(cx - 5, 36, 11, 1, dark); // upper lid + lashes
    R(cx - 4, 35, 9, 1, mix(dark, skin, 0.55));
    P(cx + outer * 6, 36, dark);
    P(cx + outer * 6, 37, mix(dark, skin, 0.35));
    P(cx - outer * 5, 41, mix(white, skin, 0.5));
    R(cx - 4, 42, 9, 1, tone(0.8)); // lower lid
    if (fg.wrinkles) {
      R(cx - 3, 43, 7, 1, tone(0.86)); // bags
      P(cx + outer * 7, 38, tone(0.8));
      P(cx + outer * 8, 40, tone(0.82));
      P(cx + outer * 7, 42, tone(0.8));
    }
  }

  // ---- 4. eyebrows ----
  const browSize = Math.min(2, Math.max(0.5, fg.browSize ?? 1));
  const thick = Math.max(1, Math.round(2 * browSize));
  for (const cx of [eyeL, eyeR]) {
    for (let i = 0; i <= 16; i++) {
      // u: 0 at the outer end, 1 at the inner end
      const x = cx < 36 ? cx - 8 + i : cx + 8 - i;
      const u = i / 16;
      let y = 31.6 - 1.8 * Math.sin(Math.PI * Math.pow(u, 0.75));
      if (angry) y += 2.4 * u * u;
      const t = thick + (u > 0.55 && browSize > 1.2 ? 1 : 0) - (u < 0.12 ? 1 : 0);
      const c = browCol.clone().multiplyScalar(0.9 + 0.2 * hash01(seed + i + cx));
      R(x, Math.round(y), 1, Math.max(1, t), c);
    }
  }

  // ---- 5. nose ----
  R(33, 41, 1, 13, tone(0.9));
  R(32, 49, 1, 7, tone(0.87));
  R(37, 43, 1, 12, tone(1.07));
  R(34, 55, 5, 3, tone(1.04));
  R(36, 55, 2, 1, tone(1.1));
  R(30, 56, 2, 3, tone(0.84));
  R(41, 56, 2, 3, tone(0.92));
  R(31, 59, 11, 1, tone(0.76));
  R(32, 59, 2, 1, tone(0.45));
  R(39, 59, 2, 1, tone(0.5));
  R(32, 60, 9, 1, tone(0.86));
  R(35, 62, 1, 5, tone(0.93)); // philtrum
  if (fg.wrinkles) {
    for (let i = 0; i < 9; i++) {
      P(Math.round(29 - i * 0.4), 61 + i, tone(0.84));
      P(Math.round(43 + i * 0.4), 61 + i, tone(0.88));
    }
    R(26, 23, 20, 1, tone(0.88));
    R(29, 27, 16, 1, tone(0.88));
    R(31, 31, 10, 1, tone(0.9));
  }

  // ---- 6. cheeks: blush, freckles ----
  if (fg.blush) {
    const rose = new THREE.Color('#e0505c');
    for (const cx of [17, 55]) {
      for (let y = 47; y <= 57; y++) {
        for (let x = cx - 7; x <= cx + 7; x++) {
          const r = ((x - cx) / 7) ** 2 + ((y - 52) / 5) ** 2;
          if (r > 1) continue;
          const px = ctx.getImageData(Math.floor(x * sx), Math.floor(y * sy), 1, 1).data;
          const base = new THREE.Color(px[0] / 255, px[1] / 255, px[2] / 255);
          P(x, y, base.lerp(rose, 0.28 * (1 - r)));
        }
      }
    }
  }
  if (fg.freckles) {
    const fr = mix(tone(0.78), '#a0502a', 0.3);
    for (let i = 0; i < 34; i++) {
      const x = Math.round(14 + hash01(seed + i * 3.3) * 44);
      const y = Math.round(44 + hash01(seed + i * 7.7) * 13);
      if (Math.abs(x - 36) < 3 && y > 50) continue;
      if (y < 45 && (Math.abs(x - eyeL) < 6 || Math.abs(x - eyeR) < 6)) continue;
      P(x, y, fr);
    }
  }

  // ---- 7. moustache ----
  if (fg.moustache) {
    const m = (x: number, y: number) => P(x, y, beardCol.clone().multiplyScalar(0.85 + 0.3 * speckle(x, y)));
    for (let x = 31; x <= 41; x++) m(x, 63);
    for (let y = 64; y <= 66; y++) for (let x = 28; x <= 44; x++) m(x, y);
    for (let x = 27; x <= 31; x++) m(x, 67);
    for (let x = 41; x <= 45; x++) m(x, 67);
    m(27, 68);
    m(26, 68);
    m(45, 68);
    m(46, 68);
    for (let x = 30; x <= 42; x++) P(x, 67, beardCol.clone().multiplyScalar(0.6)); // shadow under it
  }

  // ---- 8. mouth ----
  const lineCol = mix(dark, lips, 0.3);
  if (!fg.moustache) {
    R(29, 69, 5, 1, lips.clone().multiplyScalar(0.85));
    R(38, 69, 5, 1, lips.clone().multiplyScalar(0.85));
  }
  R(28, 70, 16, 1, lips.clone().multiplyScalar(0.78));
  if (mouth === 'grin') {
    R(28, 71, 16, 1, lineCol);
    R(29, 72, 14, 1, '#ece6da');
    R(30, 73, 12, 1, '#5a1c1c');
    R(30, 74, 12, 2, lips);
    R(33, 74, 6, 1, lips.clone().multiplyScalar(1.15));
    P(27, 70, lineCol);
    P(44, 70, lineCol);
    P(26, 69, lineCol);
    P(45, 69, lineCol);
  } else {
    R(28, 71, 16, 1, lineCol);
    R(30, 72, 12, 2, lips);
    R(33, 72, 6, 1, lips.clone().multiplyScalar(1.15));
    if (mouth === 'smile' || mouth === 'smirk') {
      P(44, 70, lineCol);
      P(45, 69, lineCol);
      P(46, 70, tone(0.86));
      if (mouth === 'smile') {
        P(27, 70, lineCol);
        P(26, 69, lineCol);
        P(25, 70, tone(0.86));
      }
    } else if (mouth === 'frown') {
      P(27, 72, lineCol);
      P(44, 72, lineCol);
      P(26, 73, tone(0.84));
      P(45, 73, tone(0.84));
    }
  }
  R(31, 75, 10, 1, tone(lum(skin) > 0.35 ? 0.86 : 0.8));

  // ---- 9. scar (across the left eyebrow, picture right) ----
  if (fg.scar) {
    const sc = mix(tone(1.15), '#e8a8a0', 0.35);
    for (let i = 0; i < 9; i++) {
      const x = 51 + Math.round(i * 0.45);
      P(x, 27 + i, sc);
      P(x + 1, 27 + i, tone(0.82));
    }
    P(50, 29, tone(0.85));
    P(53, 29, tone(0.85));
    P(51, 33, tone(0.85));
    P(54, 33, tone(0.85));
  }

  // ---- 10. glasses ----
  if (fg.sunglasses) {
    for (const cx of [eyeL, eyeR]) {
      for (let y = 35; y <= 45; y++) {
        const corner = y === 45 ? 2 : y === 44 ? 1 : 0;
        for (let x = cx - 8 + corner; x <= cx + 7 - corner; x++) {
          const t = (y - 35) / 10;
          P(x, y, mix('#0a0c12', '#20283a', t));
        }
      }
      R(cx - 8, 34, 16, 1, '#050506');
      for (let i = 0; i < 6; i++) {
        P(cx - 4 + i, 43 - i, '#4a5a74');
        P(cx - 3 + i, 43 - i, '#3a4860');
      }
      P(cx + 4, 37, '#c8d8f0');
    }
    R(31, 36, 10, 2, '#08080a');
    R(0, 36, eyeL - 8, 1, '#08080a');
    R(eyeR + 8, 36, 72 - eyeR - 8, 1, '#08080a');
  } else if (fg.glasses) {
    const fc = '#1e1e24';
    for (const cx of [eyeL, eyeR]) {
      R(cx - 8, 34, 16, 1, fc);
      R(cx - 8, 45, 16, 1, fc);
      R(cx - 9, 35, 1, 10, fc);
      R(cx + 8, 35, 1, 10, fc);
      P(cx + 5, 36, '#ffffff');
      P(cx + 6, 37, '#dde8f0');
    }
    R(32, 37, 8, 1, fc);
    R(0, 36, eyeL - 9, 1, fc);
    R(eyeR + 9, 36, 72 - eyeR - 9, 1, fc);
  }

  ps1Posterize(ctx, w, h);
}

/** `portraitFrom`: picture used for the menu portrait (defaults to the texture's canvas). */
function finish(canvas: HTMLCanvasElement, skin: THREE.Color, portraitFrom: HTMLCanvasElement = canvas): FaceAssets {
  const texture = pixelTexture(canvas);
  const portrait = document.createElement('canvas');
  portrait.width = 48;
  portrait.height = 64;
  const pctx = portrait.getContext('2d')!;
  pctx.imageSmoothingEnabled = true;
  pctx.drawImage(portraitFrom, 0, 0, 48, 64);
  return { texture, skin, portrait, portraitUrl: portrait.toDataURL() };
}

export function loadFace(def: FighterDef): Promise<FaceAssets> {
  let key = def.id + '|' + def.face.slice(0, 80) + '|' + def.face.length + '|' + (def.skin ?? '');
  // procedural faces also depend on their options (lab edits)
  if (!def.face) key += '|' + JSON.stringify(def.faceGen ?? {}) + def.hair.style + def.hair.color;
  let p = cache.get(key);
  if (!p) {
    p = buildFace(def);
    cache.set(key, p);
  }
  return p;
}

async function buildFace(def: FighterDef): Promise<FaceAssets> {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (def.face) {
    try {
      const img = await loadImage(def.face);
      // cover-crop to 3:4
      const target = FACE_W / FACE_H;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      let sx = 0;
      let sy = 0;
      if (sw / sh > target) {
        sw = sh * target;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = sw / target;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FACE_W, FACE_H);
      const pixels = ctx.getImageData(0, 0, FACE_W, FACE_H);
      const skin = def.skin ? new THREE.Color(def.skin) : sampleSkin(pixels.data, FACE_W, FACE_H);
      // menus show the untouched photo
      const portrait = document.createElement('canvas');
      portrait.width = FACE_W;
      portrait.height = FACE_H;
      const pctx = portrait.getContext('2d', { willReadFrequently: true })!;
      pctx.drawImage(canvas, 0, 0);
      ps1Posterize(pctx, FACE_W, FACE_H);
      // 3D texture: the oval's outer band is matched to the body skin tone
      matchEdgesToSkin(pixels, skin);
      ctx.putImageData(pixels, 0, 0);
      ps1Posterize(ctx, FACE_W, FACE_H);
      return finish(canvas, skin, portrait);
    } catch (e) {
      console.warn(e);
    }
  }
  drawProceduralFace(ctx, FACE_W, FACE_H, def);
  return finish(canvas, new THREE.Color(def.skin ?? '#c89070'));
}

/** Read an uploaded File into a cropped data URL (used by the fighter lab). */
export async function cropFileToDataUrl(
  src: string,
  crop: { cx: number; cy: number; zoom: number },
  outW = 240,
  outH = 320,
): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext('2d')!;
  const aspect = outW / outH;
  // base box: largest 3:4 box inside the image, then zoomed
  let bw = img.naturalWidth;
  let bh = bw / aspect;
  if (bh > img.naturalHeight) {
    bh = img.naturalHeight;
    bw = bh * aspect;
  }
  bw /= crop.zoom;
  bh /= crop.zoom;
  const sx = crop.cx * img.naturalWidth - bw / 2;
  const sy = crop.cy * img.naturalHeight - bh / 2;
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, bw, bh, 0, 0, outW, outH);
  return c.toDataURL('image/jpeg', 0.85);
}
