import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import type { FighterDef } from '../data/roster';
import { input } from '../input/input';
import { CIRCUITS } from '../race/circuits';
import { Track, type TrackDef } from '../race/track';
import { Showroom } from '../render/showroom';
import { backButton, h, uiRoot } from '../ui/dom';
import { goMenu, quickRace } from './flow';
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

  enter() {
    const list = CIRCUITS;
    this.cards = list.map((def, i) => {
      const card = h('div', { class: 'track-card' }, trackPreview(def), h('b', null, def.name), def.subtitle);
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
      h('div', { class: 'screen circuit-select' }, h('div', { class: 'h1' }, 'CHOISIS LE CIRCUIT'), h('div', { class: 'track-cards' }, ...this.cards), h('div', { class: 'footer-hint' }, 'Entrée / touche deux fois : c’est parti')),
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
    const mode = this.mode === 'tt' ? 'tt' : this.mode === 'split' ? 'split' : 'race';
    quickRace(mode, this.drivers, CIRCUITS[this.index]);
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
