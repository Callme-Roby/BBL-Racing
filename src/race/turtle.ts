import type { CtrlPoint } from './track';

/**
 * Circuit authoring with a "turtle": straights and arcs one after the other, like driving the
 * track. The loop is closed automatically (the small leftover gap is spread over the whole
 * lap), and `marks` give the control point index where a command starts, for the features.
 *
 *   turtle({ w: 7 }, [{ s: 60 }, { turn: -90, r: 30 }, { s: 40, dy: 3, mark: 'jump' }, …])
 *
 * Heading 0 = +Z; turn > 0 = left, < 0 = right (degrees). Arcs bank inward by default.
 */
export type TurtleCmd =
  | { s: number; dy?: number; w?: number; bank?: number; mark?: string }
  | { turn: number; r: number; dy?: number; w?: number; bank?: number; mark?: string };

export interface TurtleOut {
  points: CtrlPoint[];
  marks: Record<string, number>;
}

export function turtle(start: { x?: number; y?: number; z?: number; heading?: number; w?: number }, cmds: TurtleCmd[]): TurtleOut {
  let x = start.x ?? 0;
  let y = start.y ?? 0;
  let z = start.z ?? 0;
  let h = ((start.heading ?? 0) * Math.PI) / 180;
  let w = start.w ?? 7;
  const pts: { x: number; y: number; z: number; w: number; bank: number; d: number }[] = [];
  const marks: Record<string, number> = {};
  let dist = 0;
  const emit = (bank: number) => pts.push({ x, y, z, w, bank, d: dist });
  emit(0);
  for (const c of cmds) {
    if (c.mark) marks[c.mark] = pts.length - 1;
    const w0 = w;
    const w1 = c.w ?? w;
    if ('s' in c) {
      const n = Math.max(1, Math.round(c.s / 22));
      for (let i = 1; i <= n; i++) {
        x += (Math.sin(h) * c.s) / n;
        z += (Math.cos(h) * c.s) / n;
        y += (c.dy ?? 0) / n;
        dist += c.s / n;
        w = w0 + ((w1 - w0) * i) / n;
        emit(c.bank ?? 0);
      }
    } else {
      const a = (c.turn * Math.PI) / 180;
      const len = Math.abs(a) * c.r;
      const n = Math.max(2, Math.round(len / 13));
      // inward banking, stronger for tight turns
      const bank = c.bank ?? -Math.sign(a) * Math.min(14, 300 / c.r);
      // centre of the arc, on the left (turn > 0) or the right
      const lx = Math.cos(h);
      const lz = -Math.sin(h);
      const side = Math.sign(a);
      const cx = x + lx * c.r * side;
      const cz = z + lz * c.r * side;
      const a0 = Math.atan2(x - cx, z - cz);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const ang = a0 + a * t;
        x = cx + Math.sin(ang) * c.r;
        z = cz + Math.cos(ang) * c.r;
        y += (c.dy ?? 0) / n;
        dist += len / n;
        w = w0 + (w1 - w0) * t;
        emit(i === n ? bank * 0.5 : bank);
      }
      h += a;
    }
  }
  // close the loop: spread the leftover over the lap
  const last = pts[pts.length - 1];
  const ex = pts[0].x - last.x;
  const ey = pts[0].y - last.y;
  const ez = pts[0].z - last.z;
  const total = last.d || 1;
  for (const p of pts) {
    const k = p.d / total;
    p.x += ex * k;
    p.y += ey * k;
    p.z += ez * k;
  }
  if (Math.hypot(ex, ez) > 25) console.warn(`[turtle] loop closing gap ${Math.hypot(ex, ez).toFixed(1)} m`);
  pts.pop();
  return { points: pts.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10, p.w, Math.round(p.bank)] as CtrlPoint), marks };
}
