import type { TrackDef } from './track';

/**
 * The circuits of BBL KART, built in code (see track.ts for the format).
 * Control points: [x, y, z, half width, banking°]; the race starts at the first point and
 * runs toward the second. `s` values of the features are metres from the start line.
 */

/** Sunset Hood: the boulevards of the hood at sunset (palm trees, lowriders, a jump over the canal). */
export const HOOD: TrackDef = {
  id: 'hood',
  name: 'SUNSET BOULEVARD',
  subtitle: 'Le quartier au coucher du soleil',
  theme: 'hood',
  music: 'hood',
  points: [
    [0, 0, -20, 8],
    [0, 0, 60, 8],
    [10, 0, 110, 8, -6],
    [50, 0, 140, 8, -8],
    [105, 0, 130, 8, -6],
    [130, 0, 90, 7.5],
    [118, 0, 48, 7],
    [86, 0, 28, 7, 6],
    [72, 0, -8, 7],
    [92, 2, -48, 7.5, -10],
    [86, 5, -100, 8, -38],
    [48, 5, -128, 8, -38],
    [8, 2, -108, 8, -12],
  ],
  features: {
    shoulder: 4,
    ramps: [{ s: 236, len: 16, h: 2.4 }],
    boosts: [
      { s: 120, d: 3 },
      { s: 460, d: -3 },
    ],
    items: [{ s: 70 }, { s: 330 }, { s: 520 }],
    walls: [
      { s0: 150, s1: 300, side: 'left' },
      { s0: 380, s1: 470, side: 'right' },
      { s0: 480, s1: 640, side: 'both' },
    ],
    // the big banked bend over the freeway: anti-gravity
    antigrav: [[500, 625]],
  },
};

export const CIRCUITS: TrackDef[] = [HOOD];

export function getCircuit(id: string): TrackDef {
  return CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
}
