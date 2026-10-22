/**
 * Character catalogues: the roster is shown one page at a time (FighterDef.page, 1 by default),
 * with ◀ ▶ arrows and a « CATALOGUE 1 · 1 / 2 » label. LABO creations go on the last catalogue,
 * the « ? » random cell (draws from every catalogue) ends every page.
 *
 * Cursors keep FLAT roster indices (roster.length = « ? »), so the screens' picking logic,
 * online messages etc. don't change; only what is shown and how ← → travel does:
 * moving past the first / last cell of a page goes to the previous / next catalogue.
 */
import type { FighterDef } from '../data/roster';
import { loadFace } from '../render/faceTexture';
import { keyLabel } from '../input/input';
import { gridColumns, h } from '../ui/dom';

/** 0-based catalogue of each roster entry (built-ins: their `page`, LABO creations: the last one) */
export function catalogueOf(roster: FighterDef[]): number[] {
  const raw = roster.map((d) => (d.custom ? 0 : Math.max(1, Math.floor(d.page ?? 1))));
  const last = Math.max(1, ...raw);
  const pages = raw.map((p) => p || last);
  const uniq = [...new Set(pages)].sort((a, b) => a - b);
  return pages.map((p) => uniq.indexOf(p));
}

export interface PagedGridOpts {
  /** max columns (CSS --cols) */
  cols: number;
  /** « ? » random cell at the end of every page (flat index = roster.length) */
  random?: boolean;
  /** extra classes of the grid element (besides `grid`) */
  gridClass?: string;
  /** cell clicked / tapped (flat index) */
  onCell?: (i: number) => void;
  /** ◀ / ▶ clicked / tapped */
  onFlip?: (dir: -1 | 1) => void;
  /** face loaded (portrait url) */
  onFace?: (def: FighterDef, url: string) => void;
  /** tooltip of a cell */
  title?: (def: FighterDef | null) => string;
}

export class PagedGrid {
  /** arrows + label + grid */
  readonly el: HTMLDivElement;
  readonly grid: HTMLDivElement;
  /** flat: one cell per roster entry, then the « ? » cell */
  readonly cells: HTMLDivElement[] = [];
  readonly count: number;
  /** catalogue shown */
  shown = 0;
  private pageOf: number[];
  private label: HTMLDivElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private away: [HTMLSpanElement, HTMLSpanElement];
  private ghosts: HTMLElement[] = [];

  constructor(
    private roster: FighterDef[],
    private opts: PagedGridOpts,
  ) {
    this.pageOf = catalogueOf(roster);
    this.count = Math.max(1, ...this.pageOf.map((p) => p + 1));
    // columns: the biggest page decides (same grid width on every page)
    const biggest = Math.max(...Array.from({ length: this.count }, (_, p) => this.seq(p).length));
    const cols = Math.max(1, Math.min(opts.cols, biggest));
    this.grid = h('div', { class: 'grid' + (opts.gridClass ? ' ' + opts.gridClass : ''), style: `--cols:${cols}` });
    const all: (FighterDef | null)[] = opts.random ? [...roster, null] : [...roster];
    all.forEach((def, i) => {
      const t = opts.title?.(def);
      const cell = h('div', { class: 'cell' + (def ? '' : ' special'), title: t || undefined }, def ? h('div', { class: 'nm' }, def.name) : '?');
      if (def)
        loadFace(def).then((f) => {
          cell.style.backgroundImage = `url(${f.portraitUrl})`;
          opts.onFace?.(def, f.portraitUrl);
        });
      cell.addEventListener('click', () => opts.onCell?.(i));
      this.grid.append(cell);
      this.cells.push(cell);
    });
    // invisible cells: every catalogue keeps the size of the biggest one (no jump when flipping)
    for (let k = 0; k < biggest - 1; k++) this.ghosts.push(this.grid.appendChild(h('div', { class: 'cell ghost', 'aria-hidden': 'true' })));
    const arrow = (dir: -1 | 1, key: string) => {
      const b = h(
        'button',
        { class: 'rp-arrow ' + (dir < 0 ? 'rp-prev' : 'rp-next'), 'aria-label': dir < 0 ? 'Catalogue précédent' : 'Catalogue suivant' },
        h('span', { class: 'rp-ico' }, dir < 0 ? '◀' : '▶'),
        h('span', { class: 'rp-key kbd-only' }, key),
      );
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onFlip?.(dir);
      });
      return b;
    };
    this.prevBtn = arrow(-1, keyLabel('KeyQ'));
    this.nextBtn = arrow(1, keyLabel('KeyE'));
    this.away = [h('span', { class: 'rp-away' }), h('span', { class: 'rp-away' })];
    this.prevBtn.append(this.away[0]);
    this.nextBtn.append(this.away[1]);
    this.label = h('div', { class: 'rp-label' });
    this.el = h('div', { class: 'rpages' + (this.count > 1 ? '' : ' single') }, this.label, h('div', { class: 'rp-row' }, this.prevBtn, this.grid, this.nextBtn));
    this.show(0);
  }

  get randomIndex() {
    return this.roster.length;
  }

  /** catalogue of flat index i (-1 = the « ? » cell, on every page) */
  page(i: number): number {
    return i >= 0 && i < this.roster.length ? this.pageOf[i] : -1;
  }

  /** catalogue of cursor i, `fallback` for the « ? » cell */
  pageFor(i: number, fallback: number): number {
    const p = this.page(i);
    return p >= 0 ? p : fallback;
  }

  /** flat indices of page p in order, then « ? » */
  seq(p: number): number[] {
    const out: number[] = [];
    this.pageOf.forEach((q, i) => q === p && out.push(i));
    if (this.opts.random) out.push(this.roster.length);
    return out;
  }

  /** shows catalogue p (wraps around) */
  show(p: number) {
    p = ((p % this.count) + this.count) % this.count;
    if (p !== this.shown) {
      // little slide in the direction of travel
      this.grid.style.setProperty('--rp-dx', p > this.shown ? '14px' : '-14px');
      this.grid.classList.remove('rp-flip');
      void this.grid.offsetWidth;
      this.grid.classList.add('rp-flip');
    }
    this.shown = p;
    this.cells.forEach((c, i) => c.classList.toggle('off', this.page(i) >= 0 && this.page(i) !== p));
    const missing = Math.max(0, ...Array.from({ length: this.count }, (_, q) => this.seq(q).length)) - this.seq(p).length;
    this.ghosts.forEach((g, k) => g.classList.toggle('off', k >= missing));
    this.label.replaceChildren(
      h('b', null, `CATALOGUE ${p + 1}`),
      h('span', { class: 'rp-dots' }, ...Array.from({ length: this.count }, (_, k) => h('i', { class: k === p ? 'on' : '' }))),
      h('span', { class: 'rp-num' }, `${p + 1} / ${this.count}`),
    );
  }

  /** cells of the catalogue shown */
  visibleCells(): HTMLElement[] {
    return this.seq(this.shown).map((i) => this.cells[i]);
  }

  /**
   * ← → from cursor i on page p: next / previous cell, past the edge of the page into the
   * next / previous catalogue (wrapping around). Hops over `skip` (your own face for an assist).
   */
  stepH(i: number, p: number, dx: number, skip = -1): [number, number] {
    let k = this.seq(p).indexOf(i);
    if (k < 0) k = dx > 0 ? -1 : this.seq(p).length;
    const total = this.roster.length + (this.opts.random ? this.count : 0);
    for (let n = 0; n <= total; n++) {
      k += dx;
      let s = this.seq(p);
      if (k < 0) {
        p = (p - 1 + this.count) % this.count;
        s = this.seq(p);
        k = s.length - 1;
      } else if (k >= s.length) {
        p = (p + 1) % this.count;
        s = this.seq(p);
        k = 0;
      }
      if (s[k] !== skip && s[k] !== undefined) return [s[k], p];
    }
    return [i, p];
  }

  /** ↑ ↓ from cursor i on page p: a row up / down in that page (stays put at the top / bottom) */
  stepV(i: number, p: number, dy: number): number {
    const s = this.seq(p);
    const k = s.indexOf(i);
    if (k < 0) return s[0] ?? i;
    const cols = p === this.shown ? gridColumns(this.visibleCells(), 6) : 6;
    const j = k + dy * cols;
    return j < 0 || j >= s.length ? i : s[j];
  }

  /** cursor after flipping to page p: `remembered` if it lives there, else the slot at the same place */
  landOn(p: number, from: number, oldPage: number, remembered = -1): number {
    const s = this.seq(p);
    if (remembered >= 0 && s.includes(remembered) && this.page(remembered) === p) return remembered;
    const k = Math.max(0, this.seq(oldPage).indexOf(from));
    // the « ? » cell stays the « ? » cell
    if (from === this.roster.length && this.opts.random) return from;
    return s[Math.min(k, s.length - 1 - (this.opts.random ? 1 : 0))] ?? s[0];
  }

  /** players whose cursor is on another catalogue: little tags on the arrow pointing there */
  setAway(tags: { label: string; cls: string; page: number }[]) {
    const prev: HTMLElement[] = [];
    const next: HTMLElement[] = [];
    for (const t of tags) {
      if (t.page < 0 || t.page === this.shown) continue;
      (t.page < this.shown ? prev : next).push(h('b', { class: t.cls }, t.label));
    }
    this.away[0].replaceChildren(...prev);
    this.away[1].replaceChildren(...next);
  }
}
