import { archetypeOf, type Archetype, type FighterDef } from './roster';

/**
 * Driving stats of every friend, matching their profile in BBL FIGHTERZ:
 *  - LOURD (Dylan, Isis, Elies, Matteo): big top speed and weight (they shove the others),
 *    but slow to pick up speed and heavy in the turns;
 *  - RAPIDE (Thomas, Zia, Benji): explosive acceleration, light and nimble, a lower top speed;
 *  - DISTANCE → MANIABLE (Clément, Enola, Billel): they keep their distance… on rails: the best
 *    handling and drift, a fair top speed, they lose more speed when bumped;
 *  - ÉQUILIBRÉ (Rayan, Mihaï, Alex, lab creations): good everywhere.
 *
 * Ratings go from 1 to 5 (the screens show them); the race turns them into numbers (src/race/kart.ts).
 */
export interface KartStats {
  speed: number;
  accel: number;
  weight: number;
  handling: number;
}

export interface ProfileInfo {
  id: Archetype;
  /** badge, e.g. « LOURD » */
  label: string;
  line: string;
  stats: KartStats;
  color: string;
}

export const PROFILE_INFO: Record<Archetype, ProfileInfo> = {
  heavy: { id: 'heavy', label: 'LOURD', line: 'Pointe de vitesse, pousse tout le monde', stats: { speed: 5, accel: 2, weight: 5, handling: 2 }, color: '#ff7a3a' },
  fast: { id: 'fast', label: 'RAPIDE', line: 'Démarre en trombe, léger comme une plume', stats: { speed: 3, accel: 5, weight: 1, handling: 4 }, color: '#4ae0ff' },
  ranged: { id: 'ranged', label: 'MANIABLE', line: 'Colle aux virages, roi du dérapage', stats: { speed: 3, accel: 3, weight: 2, handling: 5 }, color: '#c27aff' },
  balanced: { id: 'balanced', label: 'ÉQUILIBRÉ', line: 'Bon partout', stats: { speed: 3, accel: 3, weight: 3, handling: 3 }, color: '#7ee07a' },
};

/** small personal touches on top of the profile (same profile, slightly different karts) */
const TWEAKS: Record<string, Partial<KartStats>> = {
  // short and thick: the heaviest of all
  dylan: { weight: 5, accel: 2 },
  isis: { speed: 4, accel: 3 },
  elies: { speed: 5, handling: 3, accel: 1 },
  matteo: { speed: 5, weight: 4, accel: 2 },
  thomas: { speed: 4, accel: 4 },
  zia: { weight: 2 },
  benji: { handling: 5, speed: 2 },
  clement: { speed: 4, handling: 4 },
  enola: { accel: 4 },
  billel: {},
  rayan: { handling: 4, speed: 2 },
  mihai: {},
  alex: { accel: 4, weight: 2 },
};

export function profileOf(def: FighterDef): ProfileInfo {
  return PROFILE_INFO[archetypeOf(def)];
}

export function kartStatsOf(def: FighterDef): KartStats {
  return { ...profileOf(def).stats, ...(TWEAKS[def.id] ?? {}) };
}

export const STAT_LABELS: [keyof KartStats, string][] = [
  ['speed', 'VITESSE'],
  ['accel', 'ACCÉLÉRATION'],
  ['weight', 'POIDS'],
  ['handling', 'MANIABILITÉ'],
];
