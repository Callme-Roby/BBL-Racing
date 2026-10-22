import { HAIR_STYLES, ROSTER, type FighterDef } from '../data/roster';

/** level of the CPU drivers */
export type Difficulty = 'easy' | 'normal' | 'hard';
/** engine class: top speed of every kart (50cc = relaxed, 150cc = fast) */
export type EngineClass = 50 | 100 | 150;

export interface Settings {
  difficulty: Difficulty;
  cc: EngineClass;
  /** laps per race */
  laps: number;
  /** number of drivers on the grid (8..12) */
  racers: number;
  /** items on / off */
  items: boolean;
  /** touch controls: the kart accelerates on its own (FREIN to slow down) */
  autoAccel: boolean;
  /** internal vertical resolution */
  lines: number;
  dither: boolean;
  touch: 'auto' | 'on' | 'off';
  /** version of the stored settings (see loadSettings) */
  v?: number;
}

const DEFAULTS: Settings = { difficulty: 'normal', cc: 100, laps: 3, racers: 10, items: true, autoAccel: true, lines: 480, dither: true, touch: 'auto' };
const SETTINGS_VERSION = 2;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* private mode etc. */
  }
  return fallback;
}

function loadSettings(): Settings {
  const s = load('bblkart.settings', { ...DEFAULTS });
  // v2: the default resolution went from 270p to 480p; a stored 270p is the old default
  if ((s.v ?? 1) < 2 && s.lines === 270) s.lines = DEFAULTS.lines;
  s.v = SETTINGS_VERSION;
  return s;
}

export const settings: Settings = loadSettings();

export function saveSettings() {
  try {
    localStorage.setItem('bblkart.settings', JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// custom fighters (created in the lab, stored in this browser)
// ---------------------------------------------------------------------------
export function loadCustoms(): FighterDef[] {
  try {
    const raw = localStorage.getItem('bbl.customs');
    if (raw) {
      const arr = JSON.parse(raw) as FighterDef[];
      if (Array.isArray(arr)) return arr.filter((d) => d && d.id && d.name);
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function saveCustoms(list: FighterDef[]): boolean {
  try {
    localStorage.setItem('bbl.customs', JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function fullRoster(): FighterDef[] {
  return [...ROSTER, ...loadCustoms()];
}

/** Sanitise a fighter definition received from the network. */
export function sanitizeDef(d: FighterDef): FighterDef {
  const str = (v: unknown, max: number, fb = '') => (typeof v === 'string' ? v.slice(0, max) : fb);
  const isCol = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
  const col = (v: unknown, fb: string) => (isCol(v) ? v : fb);
  const optCol = (v: unknown) => (isCol(v) ? v : undefined);
  const face = typeof d.face === 'string' && (d.face.startsWith('data:image/') || /^faces\/[\w.-]+$/.test(d.face)) ? d.face.slice(0, 200000) : '';
  const o = d.outfit ?? ({} as FighterDef['outfit']);
  const tops = ['tank', 'tshirt', 'tracksuit', 'shirtless', 'hoodie', 'suit'] as const;
  const mouths = ['neutral', 'smile', 'smirk', 'frown', 'grin'] as const;
  const num = (v: unknown, lo: number, hi: number, fb: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
  const lines = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).slice(0, n).map((l) => str(l, max)).filter(Boolean);
  const obj = <T extends object>(v: T | undefined): T | null => (v && typeof v === 'object' ? v : null);
  const fg = obj(d.faceGen);
  const acc = obj(d.accessories);
  const beard = obj(d.beard3d);
  const superLines = lines(d.superLines, 3, 60);
  const archetypes = ['heavy', 'fast', 'ranged', 'balanced'] as const;
  return {
    id: str(d.id, 40, 'remote'),
    archetype: archetypes.includes(d.archetype as (typeof archetypes)[number]) ? d.archetype : 'balanced',
    name: str(d.name, 16, '???').toUpperCase(),
    title: str(d.title, 40),
    face,
    photoPending: d.photoPending === true ? true : undefined,
    skin: d.skin ? col(d.skin, '#c89070') : undefined,
    hair: {
      style: HAIR_STYLES.includes(d.hair?.style) ? d.hair.style : 'short',
      color: col(d.hair?.color, '#302010'),
    },
    outfit: {
      top: tops.includes(o.top as (typeof tops)[number]) ? o.top : 'tank',
      topColor: col(o.topColor, '#ffffff'),
      trimColor: col(o.trimColor, '#cccccc'),
      pantsColor: col(o.pantsColor, '#335588'),
      shoesColor: col(o.shoesColor, '#111111'),
      beltColor: o.beltColor ? col(o.beltColor, '#442211') : undefined,
      wristColor: optCol(o.wristColor),
      stains: optCol(o.stains),
      baggy: o.baggy === true ? true : undefined,
      shorts: o.shorts === true ? true : undefined,
      web: optCol(o.web),
    },
    accessories: acc ? { chain: acc.chain === true, whistle: acc.whistle === true, cap: optCol(acc.cap) } : undefined,
    faceGen: fg
      ? {
          eyes: optCol(fg.eyes),
          brows: optCol(fg.brows),
          browSize: fg.browSize === undefined ? undefined : num(fg.browSize, 0.5, 2, 1),
          beard: !!fg.beard,
          goatee: !!fg.goatee,
          moustache: !!fg.moustache,
          stubble: !!fg.stubble,
          beardColor: optCol(fg.beardColor),
          glasses: !!fg.glasses,
          sunglasses: !!fg.sunglasses,
          lips: optCol(fg.lips),
          wrinkles: !!fg.wrinkles,
          freckles: !!fg.freckles,
          scar: !!fg.scar,
          blush: !!fg.blush,
          mouth: mouths.includes(fg.mouth as (typeof mouths)[number]) ? fg.mouth : undefined,
          mask: fg.mask === 'spider' ? 'spider' : undefined,
          maskLine: optCol(fg.maskLine),
        }
      : undefined,
    build: num(d.build, 0.8, 1.3, 1),
    body: d.body === 'fine' ? 'fine' : 'standard',
    belly: num(d.belly, 0, 1, 0),
    muscles: num(d.muscles, 0, 1, 0) || undefined,
    beard3d: beard ? { color: col(beard.color, '#2a1a10'), size: num(beard.size, 0.5, 1.6, 1) } : undefined,
    headScale: num(d.headScale, 0.9, 1.4, 1.15),
    height: num(d.height, 0.85, 1.15, 1),
    introLines: lines(d.introLines, 4, 80),
    winLines: lines(d.winLines, 4, 80),
    superLines: superLines.length ? superLines : undefined,
    voice: { lang: str(d.voice?.lang, 10, 'fr-FR'), pitch: num(d.voice?.pitch, 0.1, 2, 1), rate: num(d.voice?.rate, 0.5, 1.5, 1) },
    custom: true,
  };
}
