import type { App } from '../app';
import type { FighterDef } from '../data/roster';
import { settings } from '../game/settings';
import { CIRCUITS, type Cup } from '../race/circuits';
import { GrandPrix } from '../game/grandPrix';
import { PodiumScreen } from './podium';
import { StandingsScreen } from './standings';
import type { RaceSetup, RacerSetup } from '../race/race';
import type { TrackDef } from '../race/track';
import { buildGrid } from '../game/grid';
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

/** A single race / split-screen race / time trial on `track`. */
export function quickRace(mode: RaceMode, drivers: FighterDef[], track: TrackDef) {
  const seed = (Math.random() * 1e9) | 0;
  const tt = mode === 'tt';
  const racers: RacerSetup[] = tt ? [{ def: drivers[0], local: 0 }] : buildGrid(drivers, seed);
  const setup: RaceSetup = {
    track,
    racers,
    // ?debug: bblLaps = 1 for quick tests
    laps: (window as unknown as { bblLaps?: number }).bblLaps ?? (tt ? 3 : settings.laps),
    cc: settings.cc,
    difficulty: settings.difficulty,
    items: !tt && settings.items,
    timeTrial: tt,
    seed,
  };
  const locals = racers.map((r, i) => (r.local !== undefined ? i : -1)).filter((i) => i >= 0);
  startRace({ setup, mode, locals });
}

// ---------------------------------------------------------------- grand prix

/** A grand prix of `cup` for 1–4 local players (split screen). */
export function startGrandPrix(cup: Cup, drivers: FighterDef[]) {
  const gp = new GrandPrix(cup, drivers);
  gpRace(gp);
}

function gpRace(gp: GrandPrix) {
  const { racers, order } = gp.grid();
  const track = gp.track;
  const setup: RaceSetup = {
    track,
    racers,
    laps: settings.laps,
    cc: settings.cc,
    difficulty: settings.difficulty,
    items: settings.items,
    seed: gp.seed + gp.race * 101,
  };
  const locals = racers.map((r, i) => (r.local !== undefined ? i : -1)).filter((i) => i >= 0);
  // split screen: locals sorted by player number
  locals.sort((a, b) => (racers[a].local ?? 0) - (racers[b].local ?? 0));
  startRace({
    setup,
    mode: 'gp',
    locals,
    subtitle: `${gp.cup.name} · COURSE ${gp.race + 1} / ${gp.cup.tracks.length}`,
    onDone: (race) => {
      gp.record(race, order);
      app.go(
        new StandingsScreen(
          app,
          gp,
          () => (gp.done ? goPodium(gp) : gpRace(gp)),
          () => goMenu(),
        ),
      );
    },
  });
}

/** the podium of a finished grand prix */
export function goPodium(gp: GrandPrix) {
  app.go(
    new PodiumScreen(
      app,
      gp,
      () => startGrandPrix(gp.cup, gp.entries.filter((e) => e.local !== undefined).sort((a, b) => a.local! - b.local!).map((e) => e.def)),
      () => goMenu(),
    ),
  );
}

export { CIRCUITS };
