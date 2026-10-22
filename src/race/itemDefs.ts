/**
 * The items of BBL KART, from the friends' universe (BBL FIGHTERZ assists and BBL MAX):
 *
 *  - TURBO BBL (×1 / ×3): an energy can, instant boost (cuts across the grass);
 *  - SAUCE BARBECUE (Dylan): a puddle dropped behind (or thrown ahead), whoever drives in spins;
 *  - TOILE D'ENOLA: thrown straight ahead, sticks the first kart it meets (or left behind as a trap);
 *  - BALLON DE MATTEO (×1 / ×3): kicked straight ahead, bounces off the walls;
 *  - MOTS DE BILLEL: « LA MÉTA » flies after the kart in front of you;
 *  - GRENADE DE CLÉMENT: lobbed ahead (or dropped), explodes after a moment: everyone around spins;
 *  - MICRO DE ZIA: flies to the leader and blows up in a « PUNCHLINE ! »;
 *  - SUPER SAYAN (Mihaï): golden hair, invincible and faster, bumping into others spins them;
 *  - BAZOOKA DE CLÉMENT: you ride the rocket, autopilot at full speed, knocking everybody aside;
 *  - C'EST QUOI TA CONFIG ? (Benji): the question that destabilises everyone ahead of you.
 *
 * Items are handed out by position: the leader gets defensive ones, the last ones the big ones.
 */

export type ItemId = 'turbo' | 'turbo3' | 'sauce' | 'web' | 'ball' | 'ball3' | 'words' | 'grenade' | 'mic' | 'sayan' | 'bazooka' | 'config';

export interface ItemInfo {
  id: ItemId;
  name: string;
  help: string;
  /** uses (triple items) */
  count: number;
}

export const ITEM_INFO: Record<ItemId, ItemInfo> = {
  turbo: { id: 'turbo', name: 'TURBO BBL', help: 'une canette : turbo instantané, même dans l’herbe', count: 1 },
  turbo3: { id: 'turbo3', name: 'TRIPLE TURBO BBL', help: 'trois canettes, à utiliser quand tu veux', count: 3 },
  sauce: { id: 'sauce', name: 'SAUCE BARBECUE', help: 'la sauce de Dylan : flaque derrière toi (ou lancée devant), qui roule dedans part en toupie', count: 1 },
  web: { id: 'web', name: 'TOILE D’ENOLA', help: 'tirée tout droit, elle colle le premier kart touché · vers l’arrière = piège sur la route', count: 1 },
  ball: { id: 'ball', name: 'BALLON DE MATTEO', help: 'frappé tout droit, il rebondit sur les murs', count: 1 },
  ball3: { id: 'ball3', name: 'TRIPLE BALLON', help: 'trois ballons qui tournent autour de toi, à frapper un par un', count: 3 },
  words: { id: 'words', name: 'MOTS DE BILLEL', help: '« LA MÉTA » poursuit le kart devant toi', count: 1 },
  grenade: { id: 'grenade', name: 'GRENADE DE CLÉMENT', help: 'lancée en cloche devant (ou posée derrière), elle explose : tout le monde autour valdingue', count: 1 },
  mic: { id: 'mic', name: 'MICRO DE ZIA', help: 'file droit sur le premier et explose en PUNCHLINE', count: 1 },
  sayan: { id: 'sayan', name: 'SUPER SAYAN', help: 'les cheveux de Mihaï : invincible, plus rapide, tu envoies valser ceux que tu touches', count: 1 },
  bazooka: { id: 'bazooka', name: 'BAZOOKA', help: 'tu chevauches la roquette de Clément : pilote automatique à fond, les autres dégagent', count: 1 },
  config: { id: 'config', name: 'C’EST QUOI TA CONFIG ?', help: 'la question de Benji : tous ceux devant toi perdent les pédales', count: 1 },
};

/**
 * Chances of each item by position (0 = first, 1 = last), MK8-style: weights at the first,
 * middle and last places, interpolated.
 */
const WEIGHTS: Record<ItemId, [number, number, number]> = {
  sauce: [30, 8, 0],
  ball: [24, 10, 1],
  web: [16, 10, 2],
  turbo: [4, 16, 6],
  ball3: [2, 10, 4],
  words: [0, 16, 8],
  grenade: [2, 8, 4],
  turbo3: [0, 8, 16],
  mic: [0, 3, 6],
  sayan: [0, 3, 14],
  bazooka: [0, 1, 14],
  config: [0, 1, 6],
};

export const ALL_ITEMS = Object.keys(WEIGHTS) as ItemId[];

/** Draw an item for a kart at position `pos` (0-based) among `count` karts. */
export function drawItem(pos: number, count: number, rnd: () => number, opts: { leaderGap?: number } = {}): ItemId {
  const f = count <= 1 ? 0 : pos / (count - 1);
  let total = 0;
  const w = ALL_ITEMS.map((id) => {
    const [a, b, c] = WEIGHTS[id];
    let v = f < 0.5 ? a + (b - a) * (f / 0.5) : b + (c - b) * ((f - 0.5) / 0.5);
    // the microphone only makes sense when the leader is far ahead
    if (id === 'mic' && (opts.leaderGap ?? 0) < 60) v *= 0.2;
    total += v;
    return v;
  });
  let r = rnd() * total;
  for (let i = 0; i < ALL_ITEMS.length; i++) {
    r -= w[i];
    if (r <= 0) return ALL_ITEMS[i];
  }
  return 'sauce';
}

// ---------------------------------------------------------------- icons (pixel art, drawn once)

const iconCache = new Map<ItemId, string>();

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function drawCan(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number) {
  const k = s / 32;
  const P = (x: number, y: number, w: number, h: number, c: string) => px(ctx, ox + x * k, oy + y * k, w * k, h * k, c);
  P(9, 4, 14, 24, '#1a1a22');
  P(10, 5, 12, 22, '#ff8a1c');
  P(10, 5, 12, 3, '#c8c8d0');
  P(10, 24, 12, 3, '#c8c8d0');
  P(11, 10, 10, 9, '#ffd23a');
  P(13, 11, 2, 7, '#c03a2e');
  P(16, 11, 2, 7, '#c03a2e');
  P(12, 6, 2, 18, 'rgba(255,255,255,0.35)');
}

function drawIcon(id: ItemId, ctx: CanvasRenderingContext2D) {
  const P = (x: number, y: number, w: number, h: number, c: string) => px(ctx, x, y, w, h, c);
  switch (id) {
    case 'turbo':
      drawCan(ctx, 0, 0, 32);
      break;
    case 'turbo3':
      drawCan(ctx, -6, 4, 22);
      drawCan(ctx, 16, 4, 22);
      drawCan(ctx, 5, -1, 24);
      break;
    case 'sauce':
      P(4, 18, 24, 8, '#3a1a10');
      P(5, 19, 22, 6, '#8a2a14');
      P(8, 20, 10, 3, '#c04020');
      P(12, 4, 8, 14, '#1a1a1a');
      P(13, 5, 6, 12, '#a0281a');
      P(14, 2, 4, 3, '#e0e0e0');
      P(14, 9, 4, 4, '#ffd23a');
      break;
    case 'web':
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 1.5;
      for (let a = 0; a < 8; a++) {
        ctx.beginPath();
        ctx.moveTo(16, 16);
        ctx.lineTo(16 + Math.cos((a * Math.PI) / 4) * 14, 16 + Math.sin((a * Math.PI) / 4) * 14);
        ctx.stroke();
      }
      for (const r of [4, 8, 12]) {
        ctx.beginPath();
        for (let a = 0; a <= 8; a++) {
          const x = 16 + Math.cos((a * Math.PI) / 4) * r;
          const y = 16 + Math.sin((a * Math.PI) / 4) * r;
          if (a) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      P(13, 13, 6, 6, '#c41e2a');
      break;
    case 'ball':
    case 'ball3': {
      const ball = (cx: number, cy: number, r: number) => {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        for (let a = 0; a < 5; a++) {
          const x = cx + Math.cos(a * 1.2566 - 1.57) * r * 0.4;
          const y = cy + Math.sin(a * 1.2566 - 1.57) * r * 0.4;
          if (a) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.fill();
      };
      if (id === 'ball') ball(16, 16, 12);
      else {
        ball(9, 21, 7);
        ball(23, 21, 7);
        ball(16, 9, 7);
      }
      break;
    }
    case 'words':
      P(2, 6, 28, 18, '#111');
      P(3, 7, 26, 16, '#f4f0e0');
      ctx.fillStyle = '#c41e2a';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LA', 16, 14);
      ctx.fillText('MÉTA', 16, 22);
      P(8, 24, 4, 4, '#f4f0e0');
      P(6, 27, 3, 2, '#f4f0e0');
      break;
    case 'grenade':
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(16, 19, 10, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a6a2a';
      ctx.beginPath();
      ctx.ellipse(16, 19, 9, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      P(10, 14, 12, 1, '#2a3a14');
      P(10, 20, 12, 1, '#2a3a14');
      P(15, 9, 2, 20, '#2a3a14');
      P(13, 4, 6, 5, '#8a8a90');
      P(19, 3, 6, 2, '#c8c8d0');
      P(23, 3, 2, 6, '#c8c8d0');
      break;
    case 'mic':
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(16, 9, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b8bcc4';
      ctx.beginPath();
      ctx.arc(16, 9, 7, 0, Math.PI * 2);
      ctx.fill();
      for (let y = 4; y < 15; y += 2) P(10, y, 12, 1, '#7a7e86');
      P(13, 15, 6, 14, '#111');
      P(14, 16, 4, 12, '#2a2a30');
      P(14, 20, 4, 2, '#ffd23a');
      break;
    case 'sayan':
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = k % 2 ? '#ffe86a' : '#ffd23a';
        ctx.beginPath();
        const x = 4 + k * 4;
        ctx.moveTo(x - 3, 26);
        ctx.lineTo(x + 1, 2 + (k % 3) * 4);
        ctx.lineTo(x + 5, 26);
        ctx.fill();
      }
      P(4, 24, 24, 5, '#ffd23a');
      P(8, 18, 16, 2, '#fff8c0');
      break;
    case 'bazooka':
      P(2, 13, 26, 8, '#111');
      P(3, 14, 24, 6, '#5a6a3a');
      P(22, 12, 8, 10, '#111');
      P(23, 13, 6, 8, '#3a4a2a');
      P(10, 20, 4, 6, '#111');
      P(1, 15, 3, 4, '#ff8a1c');
      P(0, 16, 2, 2, '#ffd23a');
      P(6, 15, 14, 1, 'rgba(255,255,255,0.3)');
      break;
    case 'config':
      P(3, 5, 26, 18, '#111');
      P(4, 6, 24, 16, '#2c64c8');
      P(5, 7, 22, 12, '#9ad0ff');
      ctx.fillStyle = '#111';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', 16, 17);
      P(12, 23, 8, 3, '#111');
      P(8, 26, 16, 2, '#111');
      break;
  }
}

/** Pixel icon of an item (data URL, 32×32). */
export function itemIcon(id: ItemId): string {
  let url = iconCache.get(id);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    drawIcon(id, ctx);
    url = c.toDataURL();
    iconCache.set(id, url);
  }
  return url;
}
