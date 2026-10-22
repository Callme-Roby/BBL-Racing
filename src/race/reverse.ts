import { Track, type RampDef, type Span, type TrackDef } from './track';

/**
 * The same circuit driven the other way round (« RETOUR » cup). The start line stays on the
 * first control point, everything else is mirrored: a feature at distance s ends up at L − s,
 * left and right swap, and every ramp is moved before its gap so it still launches you over it.
 */
export function reverseTrack(def: TrackDef): TrackDef {
  const fwd = new Track(def);
  const L = fwd.length;
  const rev = (s: number) => (((L - s) % L) + L) % L;
  const span = (sp: Span): [number, number] => {
    const [a, b] = fwd.main.spanOf(sp);
    return [rev(b), rev(a)];
  };
  const f = def.features;
  const pts = def.points;
  const points = [pts[0], ...pts.slice(1).reverse()].map((p) => [p[0], p[1], p[2], p[3], p[4] === undefined ? undefined : -p[4]] as typeof p);
  const ramps: RampDef[] = (f.ramps ?? []).map((r) => {
    const s0 = fwd.main.sOf(r);
    const lip = s0 + r.len;
    if (r.gap) {
      // gap [lip, lip + gap] → [L − lip − gap, L − lip]: the ramp now ends where the gap starts
      return { s: rev(lip + r.gap) - r.len, len: r.len, h: r.h, gap: r.gap, d0: r.d0 === undefined ? undefined : -(r.d1 ?? r.d0 + 3), d1: r.d0 === undefined ? undefined : -r.d0 };
    }
    return { s: rev(lip), len: r.len, h: r.h, d0: r.d0 === undefined ? undefined : -(r.d1 ?? r.d0 + 3), d1: r.d0 === undefined ? undefined : -r.d0 };
  });
  return {
    ...def,
    id: def.id + '-r',
    name: def.name + ' R',
    subtitle: def.subtitle + ' (à l’envers)',
    points,
    features: {
      ...f,
      ramps,
      boosts: (f.boosts ?? []).map((b) => ({ s: rev(fwd.main.sOf(b)), d: -b.d, w: b.w, len: b.len })),
      items: (f.items ?? []).map((it) => ({ s: rev(fwd.main.sOf(it)), n: it.n, spread: it.spread })),
      walls: (f.walls ?? []).map((w) => ({ span: span(w.span), side: w.side === 'left' ? 'right' : w.side === 'right' ? 'left' : 'both' })),
      antigrav: (f.antigrav ?? []).map(span),
      branches: (f.branches ?? []).map((b, i) => {
        const len = fwd.branches[i].length;
        return {
          ...b,
          points: b.points.slice().reverse().map((p) => [p[0], p[1], p[2], p[3], p[4] === undefined ? undefined : -p[4]] as typeof p),
          span: span(b.span),
          boosts: (b.boosts ?? []).map((bb) => ({ s: len - fwd.branches[i].sOf(bb), d: -bb.d, w: bb.w, len: bb.len })),
        };
      }),
    },
  };
}
