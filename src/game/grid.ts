import type { FighterDef } from '../data/roster';
import type { RacerSetup } from '../race/race';
import { fullRoster, settings } from './settings';

/** a deterministic shuffle (CPU line-ups) */
export function shuffled<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The grid of a race: the humans at the back (like the real thing), CPU friends in front.
 * `count` drivers in total (settings.racers by default, 8..12).
 */
export function buildGrid(humans: FighterDef[], seed: number, count = settings.racers): RacerSetup[] {
  const pool = shuffled(
    fullRoster().filter((d) => !humans.some((hd) => hd.id === d.id)),
    seed,
  );
  const n = Math.max(humans.length + 1, Math.min(12, count));
  const cpus: RacerSetup[] = [];
  for (let i = 0; cpus.length < n - humans.length; i++) {
    const def = pool[i % Math.max(1, pool.length)];
    if (!def) break;
    cpus.push({ def });
  }
  return [...cpus, ...humans.map((def, p) => ({ def, local: p }))];
}

