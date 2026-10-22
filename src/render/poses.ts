import type { BoneName } from './characterModel';

/**
 * Keyframed poses for the procedural skeleton.
 * Angles are Euler XYZ in DEGREES relative to the bind pose (standing, arms down,
 * facing +Z, +X = character's left).
 *   - X < 0 on a thigh/upper arm swings it forward; X > 0 on a shin bends the knee.
 *   - X < 0 on a forearm bends the elbow.
 *   - Z > 0 raises the LEFT arm/leg sideways, Z < 0 raises the RIGHT one.
 *   - Y < 0 on hips/spine turns the chest toward the camera side.
 * `root` = hips offset in metres (x, y, z) in the character's local space.
 */
export type Euler3 = [number, number, number];
export type Pose = Partial<Record<BoneName, Euler3>> & { root?: Euler3 };

export interface Key {
  f: number;
  p: Pose;
  /** easing used to reach this key from the previous one */
  ease?: 'linear' | 'smooth' | 'out' | 'in';
}
export interface Clip {
  keys: Key[];
  loop?: boolean;
  length: number;
}

export const merge = (...poses: Pose[]): Pose => Object.assign({}, ...poses);

// ---------------------------------------------------------------------------
// base poses
// ---------------------------------------------------------------------------
const GUARD_ARMS: Pose = {
  upperArmL: [-58, 0, 14],
  foreArmL: [-112, 0, 0],
  handL: [10, 0, 0],
  upperArmR: [-42, 0, -22],
  foreArmR: [-128, 0, 0],
  handR: [10, 0, 0],
};

export const STANCE: Pose = merge(GUARD_ARMS, {
  root: [0, -0.06, 0],
  hips: [0, -32, 0],
  spine: [6, -4, 0],
  chest: [6, -4, 0],
  neck: [0, 4, 0],
  head: [-6, 6, 0],
  thighL: [-28, 0, 6],
  shinL: [40, 0, 0],
  footL: [-12, 0, 0],
  thighR: [15, 0, -6],
  shinR: [16, 0, 0],
  footR: [-31, 0, 0],
});

export const CROUCH: Pose = merge(GUARD_ARMS, {
  root: [0, -0.4, 0.04],
  hips: [0, -30, 0],
  spine: [16, -4, 0],
  chest: [12, -4, 0],
  neck: [-6, 0, 0],
  head: [-10, 8, 0],
  thighL: [-82, 0, 10],
  shinL: [118, 0, 0],
  footL: [-36, 0, 0],
  thighR: [-25, 0, -10],
  shinR: [118, 0, 0],
  footR: [-25, 0, 0],
  upperArmL: [-62, 0, 16],
  upperArmR: [-50, 0, -18],
});

export const AIR: Pose = merge(GUARD_ARMS, {
  root: [0, 0.05, 0],
  hips: [0, -25, 0],
  spine: [10, 0, 0],
  thighL: [-70, 0, 8],
  shinL: [95, 0, 0],
  footL: [-10, 0, 0],
  thighR: [-35, 0, -8],
  shinR: [100, 0, 0],
  footR: [-20, 0, 0],
});

export const LYING: Pose = {
  root: [0, -0.86, -0.05],
  hips: [-90, -10, 0],
  spine: [-4, 0, 0],
  chest: [-4, 0, 0],
  neck: [10, 0, 0],
  head: [8, -30, 0],
  upperArmL: [-10, 0, 70],
  foreArmL: [-30, 0, 0],
  upperArmR: [-20, 0, -60],
  foreArmR: [-50, 0, 0],
  handL: [0, 0, 0],
  handR: [0, 0, 0],
  thighL: [-6, 0, 10],
  shinL: [12, 0, 0],
  footL: [40, 0, 0],
  thighR: [-20, 0, -8],
  shinR: [30, 0, 0],
  footR: [40, 0, 0],
};

// ---------------------------------------------------------------------------
// loops & movement
// ---------------------------------------------------------------------------
function idle(): Clip {
  // light boxer bounce: knees flex twice per cycle, torso and guard sway a little
  const up = merge(STANCE, { root: [0, -0.05, 0], spine: [5, -6, 0], chest: [5, -5, 0] });
  const down = merge(STANCE, {
    root: [0, -0.085, 0.01],
    spine: [7, -2, 0],
    chest: [8, -3, 0],
    head: [-4, 6, 0],
    thighL: [-31, 0, 6],
    shinL: [46, 0, 0],
    thighR: [12, 0, -6],
    shinR: [24, 0, 0],
    upperArmL: [-61, 0, 15],
    foreArmL: [-115, 0, 0],
    upperArmR: [-45, 0, -21],
    foreArmR: [-131, 0, 0],
  });
  const down2 = merge(down, { spine: [7, -8, 0], chest: [8, -7, 0], upperArmL: [-56, 0, 12] });
  return {
    loop: true,
    length: 48,
    keys: [
      { f: 0, p: up },
      { f: 12, p: down, ease: 'smooth' },
      { f: 24, p: up, ease: 'smooth' },
      { f: 36, p: down2, ease: 'smooth' },
      { f: 48, p: up, ease: 'smooth' },
    ],
  };
}

function walk(forward: boolean): Clip {
  const L = 34;
  const s = forward ? 1 : -1;
  const p1 = merge(STANCE, {
    root: [0, -0.04, 0],
    thighL: [-40 * s - (forward ? 0 : 10), 0, 6],
    shinL: [30, 0, 0],
    footL: [forward ? 0 : -15, 0, 0],
    thighR: [12, 0, -6],
    shinR: [20, 0, 0],
  });
  const p2 = merge(STANCE, {
    root: [0, -0.08, 0],
    thighL: [-22, 0, 6],
    shinL: [36, 0, 0],
    thighR: [-8 * s + (forward ? 0 : 20), 0, -6],
    shinR: [55, 0, 0],
    footR: [-30, 0, 0],
  });
  return {
    loop: true,
    length: L,
    keys: [
      { f: 0, p: STANCE },
      { f: L * 0.25, p: forward ? p1 : p2, ease: 'smooth' },
      { f: L * 0.5, p: STANCE, ease: 'smooth' },
      { f: L * 0.75, p: forward ? p2 : p1, ease: 'smooth' },
      { f: L, p: STANCE, ease: 'smooth' },
    ],
  };
}

const single = (p: Pose, length = 1): Clip => ({ length, keys: [{ f: 0, p }] });

export const HIT_HIGH = merge(STANCE, {
  root: [0, -0.06, -0.08],
  hips: [-6, -40, 0],
  spine: [-10, 0, 0],
  chest: [-12, 0, 0],
  neck: [-20, 10, 0],
  head: [-26, 10, 0],
  upperArmL: [-20, 0, 40],
  foreArmL: [-50, 0, 0],
  upperArmR: [-10, 0, -40],
  foreArmR: [-50, 0, 0],
});
export const HIT_MID = merge(STANCE, {
  root: [0, -0.1, -0.1],
  hips: [6, -30, 0],
  spine: [26, 0, 0],
  chest: [20, 0, 0],
  head: [14, 0, 0],
  upperArmL: [-30, 0, 10],
  foreArmL: [-100, 0, 0],
  upperArmR: [-30, 0, -10],
  foreArmR: [-100, 0, 0],
});
export const HIT_LOW = merge(STANCE, {
  root: [0, -0.14, -0.04],
  thighL: [-10, 0, 6],
  shinL: [55, 0, 0],
  footL: [-30, 0, 0],
  spine: [16, 0, 0],
  head: [10, 0, 0],
  upperArmL: [-30, 0, 30],
  foreArmL: [-60, 0, 0],
});
const CROUCH_HIT = merge(CROUCH, { spine: [0, 0, 0], chest: [-10, 0, 0], head: [-25, 0, 0], upperArmL: [-20, 0, 40], foreArmL: [-60, 0, 0] });
export const BLOCK = merge(STANCE, {
  root: [0, -0.08, -0.03],
  hips: [0, -26, 0],
  spine: [10, 0, 0],
  head: [12, 6, 0],
  upperArmL: [-68, 0, 10],
  foreArmL: [-140, 0, 0],
  upperArmR: [-70, 0, -10],
  foreArmR: [-140, 0, 0],
});
const CROUCH_BLOCK = merge(CROUCH, {
  head: [10, 6, 0],
  upperArmL: [-60, 0, 10],
  foreArmL: [-140, 0, 0],
  upperArmR: [-62, 0, -10],
  foreArmR: [-140, 0, 0],
});

function reaction(p: Pose, base: Pose, length = 20): Clip {
  return {
    length,
    keys: [
      { f: 0, p: base },
      { f: 3, p, ease: 'out' },
      { f: length * 0.6, p, ease: 'smooth' },
      { f: length, p: base, ease: 'smooth' },
    ],
  };
}

function juggle(): Clip {
  const a = merge(HIT_HIGH, { root: [0, 0, 0], hips: [-30, -20, 0], thighL: [-30, 0, 15], thighR: [-10, 0, -15], shinL: [40, 0, 0], shinR: [60, 0, 0] });
  const b = merge(a, {
    hips: [-75, -20, 0],
    spine: [-10, 0, 0],
    upperArmL: [-60, 0, 80],
    upperArmR: [-40, 0, -90],
    thighL: [-50, 0, 20],
    shinL: [70, 0, 0],
    thighR: [-20, 0, -20],
    shinR: [30, 0, 0],
  });
  const c = merge(b, { root: [0, 0.05, 0], hips: [-95, -15, 0] });
  return { length: 60, keys: [{ f: 0, p: a }, { f: 18, p: b, ease: 'smooth' }, { f: 60, p: c, ease: 'smooth' }] };
}

function getup(): Clip {
  const sit = merge(CROUCH, {
    root: [0, -0.62, -0.25],
    hips: [-40, -20, 0],
    spine: [30, 0, 0],
    thighL: [-80, 0, 15],
    shinL: [90, 0, 0],
    thighR: [-60, 0, -10],
    shinR: [120, 0, 0],
    upperArmL: [30, 0, 20],
    upperArmR: [30, 0, -20],
    foreArmL: [-10, 0, 0],
    foreArmR: [-10, 0, 0],
  });
  return { length: 26, keys: [{ f: 0, p: LYING }, { f: 10, p: sit, ease: 'smooth' }, { f: 18, p: CROUCH, ease: 'smooth' }, { f: 26, p: STANCE, ease: 'smooth' }] };
}

function intro(variant: number): Clip {
  if (variant % 2 === 0) {
    // points at the opponent, then guard
    const point = merge(STANCE, {
      root: [0, 0, 0],
      hips: [0, -45, 0],
      thighL: [-10, 0, 6],
      shinL: [10, 0, 0],
      thighR: [5, 0, -6],
      shinR: [5, 0, 0],
      footL: [0, 0, 0],
      footR: [-10, 0, 0],
      upperArmL: [10, 0, 10],
      foreArmL: [-10, 0, 0],
      upperArmR: [-95, 30, -10],
      foreArmR: [-6, 0, 0],
      head: [-8, 15, 0],
    });
    return { length: 150, keys: [{ f: 0, p: point }, { f: 110, p: point }, { f: 140, p: STANCE, ease: 'smooth' }] };
  }
  // "come here" hand wave
  const a = merge(STANCE, { upperArmL: [-80, 0, 10], foreArmL: [-20, 0, 0], handL: [-30, 0, 0], hips: [0, -40, 0] });
  const b = merge(a, { foreArmL: [-80, 0, 0], handL: [-60, 0, 0] });
  return {
    length: 150,
    keys: [
      { f: 0, p: STANCE },
      { f: 15, p: a, ease: 'smooth' },
      { f: 30, p: b, ease: 'smooth' },
      { f: 45, p: a, ease: 'smooth' },
      { f: 60, p: b, ease: 'smooth' },
      { f: 75, p: a, ease: 'smooth' },
      { f: 110, p: STANCE, ease: 'smooth' },
    ],
  };
}

function win(variant: number): Clip {
  const relaxedLegs: Pose = { thighL: [-4, 0, 8], shinL: [6, 0, 0], footL: [-2, 0, 0], thighR: [2, 0, -8], shinR: [4, 0, 0], footR: [-6, 0, 0], root: [0, 0, 0] };
  let p: Pose;
  if (variant === 0) {
    p = merge(STANCE, relaxedLegs, {
      hips: [0, -40, 0],
      spine: [-6, 0, 0],
      chest: [-6, 0, 0],
      head: [-14, 10, 0],
      upperArmL: [0, 0, 150],
      foreArmL: [-10, 0, 0],
      upperArmR: [0, 0, -150],
      foreArmR: [-10, 0, 0],
    });
  } else if (variant === 1) {
    // double biceps
    p = merge(STANCE, relaxedLegs, {
      hips: [0, -12, 0],
      spine: [-4, 0, 0],
      chest: [-6, 0, 0],
      head: [-8, 6, 0],
      upperArmL: [0, 0, 88],
      foreArmL: [0, 0, 105],
      upperArmR: [0, 0, -88],
      foreArmR: [0, 0, -105],
      handL: [0, 0, 0],
      handR: [0, 0, 0],
    });
  } else {
    // arms crossed, chin up
    p = merge(STANCE, relaxedLegs, {
      hips: [0, -55, 0],
      spine: [-4, 0, 0],
      head: [-16, 25, 0],
      upperArmL: [-25, 0, 15],
      foreArmL: [-100, -60, 0],
      upperArmR: [-25, 0, -15],
      foreArmR: [-100, 60, 0],
    });
  }
  const bounce = merge(p, { root: [0, 0.02, 0] });
  return { length: 90, loop: false, keys: [{ f: 0, p: STANCE }, { f: 14, p: bounce, ease: 'out' }, { f: 24, p }, { f: 90, p }] };
}

export const LOSE = merge(STANCE, {
  root: [0, -0.12, 0],
  hips: [10, -40, 0],
  spine: [28, 0, 0],
  chest: [10, 0, 0],
  head: [30, 0, 0],
  upperArmL: [-40, 0, 6],
  foreArmL: [-20, 0, 0],
  upperArmR: [-40, 0, -6],
  foreArmR: [-20, 0, 0],
  thighL: [-30, 0, 6],
  shinL: [40, 0, 0],
  footL: [-10, 0, 0],
  thighR: [-10, 0, -6],
  shinR: [30, 0, 0],
  footR: [-20, 0, 0],
});


function dizzy(): Clip {
  const a = merge(STANCE, {
    root: [0.04, -0.1, 0],
    hips: [0, -30, 8],
    spine: [14, 0, -10],
    chest: [6, 0, -6],
    neck: [10, 0, -10],
    head: [16, 20, -18],
    upperArmL: [6, 0, 16],
    foreArmL: [-20, 0, 0],
    upperArmR: [4, 0, -14],
    foreArmR: [-24, 0, 0],
    thighL: [-20, 0, 8],
    shinL: [36, 0, 0],
    thighR: [6, 0, -8],
    shinR: [30, 0, 0],
  });
  const b = merge(a, { root: [-0.04, -0.12, 0], hips: [0, -38, -8], spine: [12, 0, 10], neck: [8, 0, 10], head: [12, 30, 16], upperArmL: [2, 0, 20], upperArmR: [8, 0, -20] });
  return {
    length: 48,
    loop: true,
    keys: [
      { f: 0, p: a },
      { f: 24, p: b, ease: 'smooth' },
      { f: 48, p: a, ease: 'smooth' },
    ],
  };
}

// ---------------------------------------------------------------------------
// karting (BBL KART): seated in the kart, both hands on the wheel
// ---------------------------------------------------------------------------
/**
 * Seated driver. The character's root stands on the kart floor; `root` lowers the hips onto
 * the seat. Steering, leaning and drifting are layered on top procedurally (RacerView sets
 * Animator.extra), so these clips stay simple.
 */
export const KART_SIT: Pose = {
  root: [0, -0.56, -0.12],
  hips: [0, 0, 0],
  spine: [-10, 0, 0],
  chest: [-4, 0, 0],
  neck: [6, 0, 0],
  head: [8, 0, 0],
  thighL: [-78, 0, 9],
  shinL: [38, 0, 0],
  footL: [-30, 0, 0],
  thighR: [-78, 0, -9],
  shinR: [38, 0, 0],
  footR: [-30, 0, 0],
  upperArmL: [-36, 0, 12],
  foreArmL: [-50, 0, 0],
  handL: [0, 0, 0],
  upperArmR: [-36, 0, -12],
  foreArmR: [-50, 0, 0],
  handR: [0, 0, 0],
};

/** leaning hard into a drift: body low and turned, one hand cranking the wheel */
const KART_DRIFT: Pose = merge(KART_SIT, {
  spine: [-4, 0, 0],
  chest: [4, 0, 0],
  head: [2, 0, 0],
  upperArmL: [-44, 0, 18],
  foreArmL: [-60, 0, 0],
  upperArmR: [-32, 0, -6],
  foreArmR: [-40, 0, 0],
});

function kartIdle(): Clip {
  // engine idling: tiny vibration of the torso
  const a = KART_SIT;
  const b = merge(KART_SIT, { root: [0, -0.565, -0.12], spine: [-9, 0, 0], head: [9, 0, 0] });
  return { loop: true, length: 8, keys: [{ f: 0, p: a }, { f: 4, p: b, ease: 'linear' }, { f: 8, p: a, ease: 'linear' }] };
}

/** ramp trick: arms thrown up, back arched, then back on the wheel */
function kartTrick(variant: number): Clip {
  const up = merge(KART_SIT, {
    root: [0, -0.48, -0.12],
    spine: [-22, 0, 0],
    chest: [-12, 0, 0],
    head: [-18, 0, 0],
    upperArmL: [0, 0, 150],
    foreArmL: [-10, 0, 0],
    upperArmR: [0, 0, -150],
    foreArmR: [-10, 0, 0],
  });
  const pose =
    variant === 1
      ? merge(up, { upperArmR: [-52, 0, -14], foreArmR: [-52, 0, 0], spine: [-14, 0, -18], head: [-10, 0, -20] })
      : variant === 2
        ? merge(up, { thighL: [-110, 0, 30], thighR: [-110, 0, -30], shinL: [10, 0, 0], shinR: [10, 0, 0] })
        : up;
  return {
    length: 34,
    keys: [
      { f: 0, p: KART_SIT },
      { f: 7, p: pose, ease: 'out' },
      { f: 22, p: pose },
      { f: 34, p: KART_SIT, ease: 'smooth' },
    ],
  };
}

/** hit by an item: thrown back, arms flailing, then back to the wheel */
function kartHit(): Clip {
  const a = merge(KART_SIT, {
    root: [0, -0.5, -0.18],
    spine: [-26, 0, 0],
    chest: [-14, 0, 0],
    head: [-24, 0, 0],
    upperArmL: [-30, 0, 70],
    foreArmL: [-60, 0, 0],
    upperArmR: [-20, 0, -80],
    foreArmR: [-40, 0, 0],
    thighL: [-100, 0, 22],
    thighR: [-96, 0, -22],
  });
  const b = merge(a, { upperArmL: [-60, 0, 100], upperArmR: [-70, 0, -60], head: [-10, 20, 10] });
  const c = merge(KART_SIT, { spine: [6, 0, 0], head: [20, 0, 0] });
  return {
    length: 60,
    keys: [
      { f: 0, p: KART_SIT },
      { f: 5, p: a, ease: 'out' },
      { f: 18, p: b, ease: 'smooth' },
      { f: 32, p: a, ease: 'smooth' },
      { f: 46, p: c, ease: 'smooth' },
      { f: 60, p: KART_SIT, ease: 'smooth' },
    ],
  };
}

/** finish line: standing up in the seat, one fist in the air */
function kartWin(): Clip {
  const fist = merge(KART_SIT, {
    root: [0, -0.4, -0.12],
    spine: [-14, 0, 0],
    head: [-14, 0, 0],
    upperArmR: [0, 0, -160],
    foreArmR: [-20, 0, 0],
  });
  const pump = merge(fist, { foreArmR: [-70, 0, 0] });
  return {
    loop: true,
    length: 40,
    keys: [
      { f: 0, p: fist },
      { f: 10, p: pump, ease: 'smooth' },
      { f: 20, p: fist, ease: 'smooth' },
      { f: 40, p: fist },
    ],
  };
}

/** finished out of the podium: slumped over the wheel */
const KART_LOSE: Pose = merge(KART_SIT, { spine: [20, 0, 0], chest: [14, 0, 0], head: [26, 0, 0], upperArmL: [-40, 0, 10], upperArmR: [-40, 0, -10] });

/** looking back over the shoulder (rear view) */
const KART_LOOK: Pose = merge(KART_SIT, { spine: [-6, 40, 0], chest: [-2, 30, 0], neck: [0, 30, 0], head: [0, 40, 0], upperArmL: [-40, 0, 30] });

/** throwing an item forward / dropping it behind */
function kartThrow(back: boolean): Clip {
  const wind = merge(KART_SIT, back ? { upperArmR: [30, 0, -30], foreArmR: [-20, 0, 0], spine: [-6, -20, 0] } : { upperArmR: [-150, 0, -20], foreArmR: [-80, 0, 0], spine: [-10, -14, 0] });
  const rel = merge(KART_SIT, back ? { upperArmR: [40, 0, -10], foreArmR: [0, 0, 0] } : { upperArmR: [-90, 0, -10], foreArmR: [-6, 0, 0], spine: [6, 10, 0] });
  return { length: 22, keys: [{ f: 0, p: KART_SIT }, { f: 6, p: wind, ease: 'out' }, { f: 11, p: rel, ease: 'out' }, { f: 22, p: KART_SIT, ease: 'smooth' }] };
}

// ---------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------
export type ClipId = string;

function buildLibrary(): Record<ClipId, Clip> {
  return {
    idle: idle(),
    walkF: walk(true),
    walkB: walk(false),
    crouch: single(CROUCH),
    air: single(AIR),
    lying: single(LYING),
    hitHigh: reaction(HIT_HIGH, STANCE),
    hitMid: reaction(HIT_MID, STANCE),
    hitLow: reaction(HIT_LOW, STANCE),
    crouchHit: reaction(CROUCH_HIT, CROUCH),
    block: reaction(BLOCK, STANCE, 14),
    crouchBlock: reaction(CROUCH_BLOCK, CROUCH, 14),
    juggle: juggle(),
    getup: getup(),
    intro0: intro(0),
    intro1: intro(1),
    win0: win(0),
    win1: win(1),
    win2: win(2),
    lose: { length: 30, keys: [{ f: 0, p: STANCE }, { f: 30, p: LOSE, ease: 'smooth' }] },
    stance: single(STANCE),
    dizzy: dizzy(),
    // relaxed pose used by the select screen
    showcase: idle(),
    // karting
    'kart:sit': kartIdle(),
    'kart:drift': single(KART_DRIFT),
    'kart:trick0': kartTrick(0),
    'kart:trick1': kartTrick(1),
    'kart:trick2': kartTrick(2),
    'kart:hit': kartHit(),
    'kart:win': kartWin(),
    'kart:lose': { length: 30, keys: [{ f: 0, p: KART_SIT }, { f: 30, p: KART_LOSE, ease: 'smooth' }] },
    'kart:look': single(KART_LOOK),
    'kart:throw': kartThrow(false),
    'kart:drop': kartThrow(true),
  };
}

export const CLIPS = buildLibrary();
