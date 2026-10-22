import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import type { GrandPrix } from '../game/grandPrix';
import { input } from '../input/input';
import { loadFace } from '../render/faceTexture';
import { Showroom } from '../render/showroom';
import { h, Menu, uiRoot } from '../ui/dom';
import { ordinal } from '../ui/raceHud';

/**
 * Grand prix standings after a race: everybody's points, the points just won counting up,
 * the three leaders on the turntable behind. CONTINUER → next race (or the podium).
 */
export class StandingsScreen implements Screen {
  private showroom = new Showroom();
  private menu!: Menu;
  private counters: { el: HTMLElement; from: number; to: number }[] = [];
  private t = 0;

  constructor(
    private app: App,
    private gp: GrandPrix,
    private next: () => void,
    private quit: () => void,
  ) {
    this.showroom.kartMode = true;
    this.showroom.slotCount = 3;
  }

  enter() {
    audio.playMusic('select');
    const gp = this.gp;
    const order = gp.standings();
    const rows = order.map((ei, pos) => {
      const e = gp.entries[ei];
      const face = h('div', { class: 'face' });
      void loadFace(e.def).then((f) => (face.style.backgroundImage = `url(${f.portraitUrl})`));
      const gain = gp.lastPoints(ei);
      const pts = h('td', { class: 'pts' }, String(e.points - gain));
      this.counters.push({ el: pts, from: e.points - gain, to: e.points });
      return h(
        'tr',
        { class: (e.local !== undefined ? 'me ' : '') + 'rise', style: `animation-delay:${pos * 0.05}s` },
        h('td', { class: 'rk' }, ordinal(pos + 1)),
        h('td', null, face),
        h('td', null, e.name ?? e.def.name),
        h('td', { class: 'gain' }, gain ? '+' + gain : ''),
        pts,
      );
    });
    const last = gp.done;
    this.menu = new Menu(
      [
        { label: last ? 'PODIUM !' : `COURSE ${gp.race + 1} / ${gp.cup.tracks.length}`, sub: last ? undefined : gp.track.name, action: () => this.next() },
        { label: 'ABANDONNER', action: () => this.quit() },
      ],
      () => audio.sfx('cursor'),
    );
    uiRoot().append(
      h(
        'div',
        { class: 'screen dim standings-screen', style: 'overflow-y:auto' },
        h('div', { class: 'h1' }, h('span', { class: 'cup-badge', style: `--cup:${gp.cup.color}` }, gp.cup.name), ' CLASSEMENT'),
        h('div', { class: 'title-hint' }, `APRÈS ${gp.race} COURSE${gp.race > 1 ? 'S' : ''} SUR ${gp.cup.tracks.length}`),
        h('table', { class: 'results-table' }, ...rows),
        this.menu.el,
      ),
    );
    order.slice(0, 3).forEach((ei, i) => void this.showroom.show(i, gp.entries[ei].def));
    // the leader in the middle
    void this.showroom.show(1, gp.entries[order[0]].def);
    void this.showroom.show(0, gp.entries[order[1]]?.def ?? null);
    void this.showroom.show(2, gp.entries[order[2]]?.def ?? null);
    this.showroom.play(1, 'kart:win');
  }

  exit() {
    this.showroom.dispose();
  }

  frame(dt: number) {
    this.t += dt;
    // points counting up
    const k = Math.min(1, Math.max(0, (this.t - 0.6) / 1.2));
    for (const c of this.counters) c.el.textContent = String(Math.round(c.from + (c.to - c.from) * k));
    if (k > 0 && k < 1 && Math.floor(this.t * 20) % 2 === 0) audio.sfx('roulette', { volume: 0.25 });
    for (const e of input.menuEvents()) {
      if (e.action === 'up') this.menu.move(-1);
      else if (e.action === 'down') this.menu.move(1);
      else if (e.action === 'confirm' || e.action === 'start') {
        audio.sfx('confirm');
        this.menu.activate();
        return;
      }
    }
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
