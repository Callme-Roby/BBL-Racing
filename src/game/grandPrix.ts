import type { FighterDef } from '../data/roster';
import type { Cup } from '../race/circuits';
import type { Race, RacerSetup } from '../race/race';
import { settings } from './settings';
import { buildGrid } from './grid';

/** Points per finishing position (MK8 style, 12 drivers; fewer drivers keep the top of the table). */
export const POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export interface GpEntry {
  def: FighterDef;
  /** local player index (humans), undefined = CPU */
  local?: number;
  name?: string;
  points: number;
  /** finishing position of each race (0-based) */
  results: number[];
}

/**
 * A grand prix: 4 races of a cup, the same drivers all along, points after each race.
 * The grid of the next race follows the standings backwards (the leader starts last).
 */
export class GrandPrix {
  readonly entries: GpEntry[];
  race = 0;
  readonly seed: number;

  constructor(
    readonly cup: Cup,
    humans: FighterDef[],
  ) {
    this.seed = (Math.random() * 1e9) | 0;
    this.entries = buildGrid(humans, this.seed, settings.racers).map((r) => ({ def: r.def, local: r.local, name: r.name, points: 0, results: [] }));
  }

  get track() {
    return this.cup.tracks[this.race];
  }

  get done() {
    return this.race >= this.cup.tracks.length;
  }

  /** grid of the next race: standings reversed (first race: humans at the back) */
  grid(): { racers: RacerSetup[]; order: number[] } {
    const order = this.race === 0 ? this.entries.map((_, i) => i) : this.standings().reverse();
    return { racers: order.map((i) => ({ def: this.entries[i].def, local: this.entries[i].local, name: this.entries[i].name })), order };
  }

  /** after a race: `order` = grid order used for that race (kart index → entry index) */
  record(race: Race, order: number[]) {
    const fin = race.finalOrder();
    fin.forEach((ki, pos) => {
      const e = this.entries[order[ki]];
      e.results.push(pos);
      e.points += POINTS[pos] ?? 0;
    });
    this.race++;
  }

  /** entry indices sorted by points (ties: better last result) */
  standings(): number[] {
    return this.entries
      .map((_, i) => i)
      .sort((a, b) => {
        const ea = this.entries[a];
        const eb = this.entries[b];
        if (eb.points !== ea.points) return eb.points - ea.points;
        return (ea.results[ea.results.length - 1] ?? 99) - (eb.results[eb.results.length - 1] ?? 99);
      });
  }

  /** points won in the last race */
  lastPoints(i: number): number {
    const r = this.entries[i].results;
    return r.length ? (POINTS[r[r.length - 1]] ?? 0) : 0;
  }
}
