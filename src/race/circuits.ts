import type { TrackDef } from './track';
import { reverseTrack } from './reverse';
import { turtle } from './turtle';

/**
 * The circuits of BBL KART, built in code (see track.ts for the format), inspired by the
 * arenas of BBL FIGHTERZ. Control points: [x, y, z, half width, banking°]; the race starts at
 * the first point and runs toward the second. Features are placed with `at` = control point
 * index (fractional). `npm run map` prints them seen from above.
 */

/** Sunset Boulevard: the hood at sunset — palm trees, lowriders, a canal jump, a dirt alley, the freeway bend. */
export const HOOD: TrackDef = {
  id: 'hood',
  name: 'SUNSET BOULEVARD',
  subtitle: 'Le quartier au coucher du soleil',
  theme: 'hood',
  music: 'hood',
  points: [
    [0, 0, -40, 8],
    [0, 0, 50, 8],
    [8, 0, 95, 8, -8],
    [45, 0, 122, 8, -10],
    [95, 0, 118, 8, -6],
    [122, 0, 85, 7.5, -4],
    [122, 0, 30, 7.5],
    [138, 0, -5, 7, 8],
    [172, 0, -14, 7],
    [196, 0, -44, 7, -12],
    [182, 0, -82, 7, -16],
    [142, 0, -80, 7, -12],
    [112, 2.5, -62, 7.5, -4],
    [72, 6, -72, 8, -30],
    [42, 6, -112, 8, -40],
    [2, 5, -120, 8, -34],
    [-26, 3, -94, 8, -14],
    [-20, 0, -64, 8],
  ],
  features: {
    shoulder: 4,
    // the canal: jump it!
    ramps: [{ at: 5.45, len: 15, h: 2.3, gap: 9 }],
    boosts: [
      { at: 3.6, d: 2.5 },
      { at: 16.6, d: -2 },
      { at: 8.2, d: 0 },
    ],
    items: [{ at: 1.1 }, { at: 6.8 }, { at: 12.2 }],
    walls: [
      { span: { at: [8.6, 11.6] }, side: 'right' },
      { span: { at: [12.4, 16.6] }, side: 'both' },
    ],
    // the big banked bend of the freeway: anti-gravity
    antigrav: [{ at: [13, 15.6] }],
    branches: [
      {
        // dirt alley inside the first bend, with a turbo pad for those who dare
        span: { at: [1.25, 4.3] },
        points: [
          [0.5, 0, 62, 4],
          [14, 0, 76, 4],
          [40, 0, 86, 4],
          [72, 0, 92, 4],
          [100, 0, 100, 4],
          [109, 0, 108, 4],
        ],
        surface: 'dirt',
        boosts: [{ s: 40, d: 0, w: 1.4 }],
      },
    ],
  },
};

/** Sky Dojo: wooden walkways above the clouds — jumps over the void, the dragon spiral (anti-gravity). */
const dojo = turtle({ w: 7 }, [
  { s: 70, mark: 'start' },
  { turn: 90, r: 32, dy: 2 },
  { s: 60, dy: 2, mark: 'jump1' },
  { turn: 90, r: 26, dy: 1, mark: 'turn2' },
  { s: 40, dy: -2 },
  { turn: -40, r: 28, mark: 'chicane' },
  { turn: 40, r: 28 },
  { s: 20, mark: 'spiral' },
  // the dragon spiral: a full turn around the pagoda, climbing, on the walls (anti-gravity)
  { turn: 360, r: 24, dy: 18, bank: -55, w: 7.5, mark: 'spiralIn' },
  { s: 40, dy: -2, w: 7, mark: 'jump2' },
  { turn: 90, r: 30, dy: -5, mark: 'drop' },
  { s: 71, dy: -10 },
  { turn: 90, r: 30, dy: -4, mark: 'last' },
  { s: 60, dy: -2 },
]);

export const DOJO: TrackDef = {
  id: 'dojo',
  name: 'SKY DOJO',
  subtitle: 'Le dojo au-dessus des nuages',
  theme: 'dojo',
  music: 'dojo',
  points: dojo.points,
  features: {
    void: true,
    shoulder: 1.5,
    groundY: -20,
    ramps: [
      { at: dojo.marks.jump1 + 0.6, len: 14, h: 2.4, gap: 11 },
      { at: dojo.marks.jump2 + 0.2, len: 12, h: 2, gap: 9 },
    ],
    boosts: [
      { at: dojo.marks.turn2 - 0.5, d: 0 },
      { at: dojo.marks.drop + 2, d: -2 },
      { at: dojo.marks.last, d: 2 },
    ],
    items: [{ at: 1, n: 3 }, { at: dojo.marks.chicane, n: 3 }, { at: dojo.marks.drop + 3 }],
    walls: [
      { span: { at: [dojo.marks.spiral, dojo.marks.jump2] }, side: 'both' },
      { span: { at: [dojo.marks.turn2, dojo.marks.turn2 + 3] }, side: 'right' },
    ],
    antigrav: [{ at: [dojo.marks.spiralIn, dojo.marks.jump2] }],
  },
};

/** Neon Parking: a car park at night — roof jump, the helix down, the parking lanes, the ramp back up. */
const park = turtle({ w: 7, y: 14 }, [
  { s: 60, mark: 'start' },
  { turn: -90, r: 20, mark: 'roofTurn' },
  { s: 40, mark: 'jump' },
  { turn: -90, r: 20 },
  { s: 10, mark: 'helix' },
  // the helix down to the ground floor
  { turn: -360, r: 22, dy: -13, w: 6.5, bank: 10, mark: 'helixIn' },
  { s: 40, w: 7, mark: 'ground' },
  { turn: 90, r: 18, mark: 'lanes' },
  { s: 20 },
  { turn: -90, r: 18 },
  { s: 40, mark: 'lane2' },
  { turn: -90, r: 20, mark: 'climb' },
  // the long ramp back up to the roof
  { s: 96, dy: 13, mark: 'ramp' },
  { turn: -90, r: 20, mark: 'roof' },
  { s: 66 },
]);

export const PARKING: TrackDef = {
  id: 'parking',
  name: 'NEON PARKING',
  subtitle: 'Le parking, la nuit',
  theme: 'parking',
  music: 'parking',
  points: park.points,
  features: {
    shoulder: 1.2,
    groundY: 0,
    ramps: [{ at: park.marks.jump + 0.3, len: 12, h: 1.8, gap: 8 }],
    boosts: [
      { at: park.marks.ground + 1, d: 0 },
      { at: park.marks.ramp + 2, d: 2 },
      { at: park.marks.ramp + 3, d: -2 },
    ],
    items: [{ at: park.marks.roofTurn + 2.2 }, { at: park.marks.ground + 0.5 }, { at: park.marks.lane2 + 1 }, { at: park.marks.roof + 3 }],
    walls: [
      { span: { at: [0, park.marks.jump] }, side: 'both' },
      { span: { at: [park.marks.jump + 2, park.marks.lanes] }, side: 'both' },
      { span: { at: [park.marks.climb, park.points.length] }, side: 'both' },
    ],
    // the helix: the cars stick to its banked wall
    antigrav: [{ at: [park.marks.helixIn + 1, park.marks.ground - 1] }],
  },
};

/** Tropical Beach: boardwalk and palm trees — the pier jump, the sand shortcut, the cliff bend (anti-gravity). */
const beach = turtle({ w: 8 }, [
  { s: 75, mark: 'start' },
  { turn: 60, r: 40, mark: 's1' },
  { s: 40, w: 7, mark: 'boardwalk' },
  { turn: -60, r: 40 },
  { turn: 120, r: 35, w: 8, mark: 'sea' },
  { s: 62, dy: 1, mark: 'pier' },
  { turn: 90, r: 25, dy: -1, mark: 'village' },
  { s: 120, dy: 4, mark: 'long' },
  { turn: -45, r: 30, mark: 'chicane' },
  { turn: 45, r: 30 },
  { s: 40, dy: 6, mark: 'cliff' },
  { turn: 90, r: 30, dy: 2, bank: -40, mark: 'cliffBend' },
  { s: 50, dy: -6, bank: -20 },
  { turn: 60, r: 40, dy: -6, mark: 'back' },
]);

export const BEACH: TrackDef = {
  id: 'beach',
  name: 'TROPICAL BEACH',
  subtitle: 'La plage de Benji',
  theme: 'beach',
  music: 'beach',
  points: beach.points,
  features: {
    shoulder: 5,
    ramps: [
      { at: beach.marks.pier + 1.2, len: 14, h: 2.2, gap: 10 },
      { at: beach.marks.long + 3, len: 10, h: 1.4, d0: -7, d1: -2 },
    ],
    boosts: [
      { at: beach.marks.boardwalk + 1, d: 0 },
      { at: beach.marks.chicane, d: 2 },
    ],
    items: [{ at: 1.2 }, { at: beach.marks.village + 1 }, { at: beach.marks.long + 4 }, { at: beach.marks.back + 1 }],
    walls: [{ span: { at: [beach.marks.cliff + 1, beach.marks.back] }, side: 'right' }],
    antigrav: [{ at: [beach.marks.cliffBend, beach.marks.back - 1] }],
    branches: [
      {
        // across the sand inside the big bend by the sea (a turbo can makes it worth it)
        span: { at: [beach.marks.sea + 0.6, beach.marks.pier + 0.5] },
        points: [],
        surface: 'dirt',
        boosts: [{ s: 25, d: 0, w: 1.5 }],
      },
    ],
  },
};

// the beach shortcut: a straight line of sand between its two ends on the road
{
  const pts = BEACH.points;
  const [a0, a1] = [beach.marks.sea + 0.6, beach.marks.pier + 0.5];
  const at = (a: number) => {
    const i = Math.floor(a);
    const f = a - i;
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f] as const;
  };
  const A = at(a0);
  const B = at(a1);
  const n = 5;
  BEACH.features.branches![0].points = Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, 3.5] as [number, number, number, number];
  });
}

/** The cups of the grand prix: 4 races each. */
export interface Cup {
  id: string;
  name: string;
  /** trophy colour of the cup's emblem */
  color: string;
  tracks: TrackDef[];
}

const REVERSED = [BEACH, PARKING, DOJO, HOOD].map(reverseTrack);

export const CUPS: Cup[] = [
  { id: 'bbl', name: 'COUPE BBL', color: '#ffd23a', tracks: [HOOD, DOJO, PARKING, BEACH] },
  { id: 'retour', name: 'COUPE RETOUR', color: '#4ae0ff', tracks: REVERSED },
];

export const CIRCUITS: TrackDef[] = [HOOD, DOJO, PARKING, BEACH, ...REVERSED];

export function getCircuit(id: string): TrackDef {
  return CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
}
