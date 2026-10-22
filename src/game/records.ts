/**
 * Time trial records, kept in this browser: best race time and best lap of every circuit, with
 * the ghost of the best race (the kart's position / rotation 15 times a second).
 */

export interface TrackRecord {
  /** best total time (s) and who drove it */
  best: number;
  lap: number;
  driver: string;
  /** ghost frames: [x, y, z, qx, qy, qz, qw] × n, every GHOST_STEP ticks */
  ghost?: number[];
}

/** ticks between two ghost frames (60 Hz / 4 = 15 frames a second) */
export const GHOST_STEP = 4;
const KEY = 'bblkart.records';

function loadAll(): Record<string, TrackRecord> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Record<string, TrackRecord>;
      if (d && typeof d === 'object') return d;
    }
  } catch {
    /* private mode, bad data */
  }
  return {};
}

export function getRecord(trackId: string): TrackRecord | null {
  const r = loadAll()[trackId];
  return r && typeof r.best === 'number' ? r : null;
}

/** Saves the run if it beats the record (or the best lap). Returns what was beaten. */
export function submitRun(trackId: string, total: number, lap: number, driver: string, ghost: number[]): { race: boolean; lap: boolean } {
  const all = loadAll();
  const old = all[trackId];
  const raceRec = !old || total < old.best;
  const lapRec = !old || lap < old.lap;
  if (!raceRec && !lapRec) return { race: false, lap: false };
  all[trackId] = {
    best: raceRec ? total : old!.best,
    lap: lapRec ? lap : old!.lap,
    driver: raceRec ? driver : old!.driver,
    ghost: raceRec ? ghost : old!.ghost,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // full: keep the times, drop the ghosts of the other circuits
    for (const k of Object.keys(all)) if (k !== trackId) delete all[k].ghost;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* give up */
    }
  }
  return { race: raceRec, lap: lapRec };
}
