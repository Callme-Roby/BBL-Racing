import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import type { FighterDef } from '../data/roster';
import { input } from '../input/input';
import { CIRCUITS, CUPS, type Cup } from '../race/circuits';
import { Track, type TrackDef } from '../race/track';
import { Showroom } from '../render/showroom';
import { backButton, h, uiRoot } from '../ui/dom';
import { goMenu, quickRace, startGrandPrix } from './flow';
import type { SelectMode } from './select';

/** Top view of a circuit drawn on a small canvas (cards, loading screens). */
export function trackPreview(def: TrackDef, w = 160, hgt = 100): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#120e1e';
  ctx.fillRect(0, 0, w, hgt);
  const tr = new Track(def);
  let minX = 1e9;
  let maxX = -1e9;
  let minZ = 1e9;
  let maxZ = -1e9;
  for (const s of tr.main.samples) {
    minX = Math.min(minX, s.p.x);
    maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z);
    maxZ = Math.max(maxZ, s.p.z);
  }
  const k = Math.min((w - 16) / (maxX - minX || 1), (hgt - 16) / (maxZ - minZ || 1));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const P = (x: number, z: number): [number, number] => [w / 2 - (x - cx) * k, hgt / 2 - (z - cz) * k];
  for (const rb of tr.ribbons) {
    ctx.beginPath();
    rb.samples.forEach((s, i) => {
      const [x, y] = P(s.p.x, s.p.z);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (rb.closed) ctx.closePath();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = rb.isMain ? '#ffd23a' : '#c8a070';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const s0 = tr.main.sample(0);
  const [x0, y0] = P(s0.p.x, s0.p.z);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x0 - 5, y0 - 2, 10, 4);
  return c;
}

/** Choose the circuit of a single race / time trial / split-screen race. */
export class CircuitSelectScreen implements Screen {
  private index = 0;
  private cards: HTMLElement[] = [];
  private showroom = new Showroom();

  constructor(
    private app: App,
    private mode: SelectMode,
    private drivers: FighterDef[],
  ) {
    this.showroom.kartMode = true;
    this.showroom.slotCount = drivers.length;
  }

  private get gp() {
    return this.mode === 'gp';
  }

  /** cards: the cups (grand prix, also offered in split screen), then the circuits */
  private get list(): (Cup | TrackDef)[] {
    return this.gp ? CUPS : this.mode === 'split' ? [...CUPS, ...CIRCUITS] : CIRCUITS;
  }

  enter() {
    const list = this.list;
    this.cards = list.map((item, i) => {
      const isCup = 'tracks' in item;
      const card = isCup
        ? h(
            'div',
            { class: 'track-card cup', style: `--cup:${(item as (typeof CUPS)[number]).color}` },
            h('div', { class: 'cup-tracks' }, ...(item as (typeof CUPS)[number]).tracks.map((t) => h('div', null, trackPreview(t, 120, 70), h('small', null, t.name)))),
            h('b', null, h('span', { class: 'cup-badge', style: `--cup:${(item as (typeof CUPS)[number]).color}` }, item.name)),
            'GRAND PRIX · 4 courses · points · podium',
          )
        : h('div', { class: 'track-card' }, trackPreview(item as (typeof CIRCUITS)[number]), h('b', null, item.name), (item as (typeof CIRCUITS)[number]).subtitle);
      card.addEventListener('click', () => {
        if (this.index === i) this.go();
        else {
          this.index = i;
          audio.sfx('cursor');
          this.refresh();
        }
      });
      return card;
    });
    uiRoot().append(
      h('div', { class: 'screen circuit-select' }, h('div', { class: 'h1' }, this.gp ? 'CHOISIS LA COUPE' : this.mode === 'split' ? 'GRAND PRIX OU COURSE ?' : 'CHOISIS LE CIRCUIT'), h('div', { class: 'track-cards' }, ...this.cards), h('div', { class: 'footer-hint' }, 'Entrée / touche deux fois : c’est parti')),
      backButton(() => goMenu()),
    );
    this.drivers.forEach((d, i) => void this.showroom.show(i, d));
    this.refresh();
  }

  exit() {
    this.showroom.dispose();
  }

  private refresh() {
    this.cards.forEach((c, i) => c.classList.toggle('sel', i === this.index));
  }

  private go() {
    audio.sfx('confirm');
    const item = this.list[this.index];
    if ('tracks' in item) {
      startGrandPrix(item, this.drivers);
      return;
    }
    const mode = this.mode === 'tt' ? 'tt' : this.mode === 'split' ? 'split' : 'race';
    quickRace(mode, this.drivers, item);
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (e.action === 'left' || e.action === 'up') {
        this.index = (this.index + this.cards.length - 1) % this.cards.length;
        audio.sfx('cursor');
        this.refresh();
      } else if (e.action === 'right' || e.action === 'down') {
        this.index = (this.index + 1) % this.cards.length;
        audio.sfx('cursor');
        this.refresh();
      } else if (e.action === 'confirm' || e.action === 'start') {
        this.go();
        return;
      } else if (e.action === 'back') {
        goMenu();
        return;
      }
    }
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
