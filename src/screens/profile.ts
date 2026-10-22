import { kartStatsOf, profileOf, STAT_LABELS, type ProfileInfo } from '../data/kartStats';
import type { FighterDef } from '../data/roster';
import { h } from '../ui/dom';

/** « LOURD » badge in the profile's colour. */
export function profileBadge(info: ProfileInfo, cls = ''): HTMLElement {
  return h('span', { class: 'pf-badge ' + cls, style: `--pc:${info.color}` }, info.label);
}

/**
 * Driver profile shown under the name / title on the select screens:
 * badge + one line + 4 stat bars (1–5): speed, acceleration, weight, handling.
 * Nothing for the random cell (null).
 */
export function profileBox(def: FighterDef | null): HTMLElement | null {
  if (!def) return null;
  const info = profileOf(def);
  const st = kartStatsOf(def);
  const stats = STAT_LABELS.map(([k, label]) =>
    h(
      'div',
      { class: 'pf-stat' },
      h('span', { class: 'pf-k' }, label),
      h('span', { class: 'pf-bar', 'aria-label': `${label} ${st[k]}/5` }, ...Array.from({ length: 5 }, (_, i) => h('i', { class: i < st[k] ? 'on' : '' }))),
    ),
  );
  return h(
    'div',
    { class: 'profile', style: `--pc:${info.color}` },
    h('div', { class: 'pf-head' }, profileBadge(info), h('span', { class: 'pf-line' }, info.line)),
    h('div', { class: 'pf-stats' }, ...stats),
  );
}
