import type { App } from '../app';
import type { FighterDef } from '../data/roster';
import { settings } from '../game/settings';
import { CIRCUITS } from '../race/circuits';
import type { RaceSetup, RacerSetup } from '../race/race';
import type { TrackDef } from '../race/track';
import { fullRoster } from '../game/settings';
import { CircuitSelectScreen } from './circuitSelect';
import { LabScreen } from './lab';
import { OptionsScreen } from './options';
import { RaceScreen, type RaceMode, type RaceScreenOpts } from './race';
import { SelectScreen, type SelectMode } from './select';
import { TitleScreen } from './title';

/** Central navigation between screens. */
let app: App;

export function initFlow(a: App) {
  app = a;
}

export function goTitle(skipPress = false) {
  app.go(new TitleScreen(app, skipPress));
}

export function goMenu() {
  goTitle(true);
}

export function goLab() {
  app.go(new LabScreen(app));
}

export function goOptions() {
  app.go(new OptionsScreen(app));
}

/** Driver select for `players` local players, then `next` with their choices. */
export function goSelect(mode: SelectMode, players = 1) {
  app.go(new SelectScreen(app, mode, players));
}

export function goCircuitSelect(mode: SelectMode, drivers: FighterDef[]) {
  app.go(new CircuitSelectScreen(app, mode, drivers));
}

export function startRace(opts: RaceScreenOpts) {
  app.go(new RaceScreen(app, opts));
}

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

/** A single race / split-screen race / time trial on `track`. */
export function quickRace(mode: RaceMode, drivers: FighterDef[], track: TrackDef) {
  const seed = (Math.random() * 1e9) | 0;
  const tt = mode === 'tt';
  const racers: RacerSetup[] = tt ? [{ def: drivers[0], local: 0 }] : buildGrid(drivers, seed);
  const setup: RaceSetup = {
    track,
    racers,
    laps: tt ? 3 : settings.laps,
    cc: settings.cc,
    difficulty: settings.difficulty,
    items: !tt && settings.items,
    timeTrial: tt,
    seed,
  };
  const locals = racers.map((r, i) => (r.local !== undefined ? i : -1)).filter((i) => i >= 0);
  startRace({ setup, mode, locals });
}

export { CIRCUITS };
