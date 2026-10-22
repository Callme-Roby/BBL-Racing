import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import type { FighterDef } from '../data/roster';
import { fullRoster } from '../game/settings';
import { input, keyLabel, P1_KEYS, P2_KEYS, type MenuEvent } from '../input/input';
import { Showroom, type ShowroomFit } from '../render/showroom';
import { backButton, h, isTouchUi, Menu, phoneLayout, uiRoot } from '../ui/dom';
import { PLAYER_COLORS } from '../ui/raceHud';
import { goCircuitSelect, goMenu } from './flow';
import { profileBox } from './profile';
import { PagedGrid } from './rosterPages';
import { goOnlineLobby } from './online';

/** what the drivers are chosen for */
export type SelectMode = 'gp' | 'race' | 'tt' | 'split' | 'online';

const MODE_LABEL: Record<SelectMode, string> = {
  gp: 'GRAND PRIX',
  race: 'COURSE SIMPLE',
  tt: 'CONTRE-LA-MONTRE',
  split: 'MULTIJOUEUR — ÉCRAN PARTAGÉ',
  online: 'EN LIGNE',
};

/** last driver each player validated: the cursor (and its catalogue) comes back there */
const lastPick: string[] = [];

/**
 * Driver select: 1 to 4 cursors (J1 blue, J2 red, J3 green, J4 yellow) over the portrait
 * catalogues; the chosen friends sit in their karts on the turntable behind.
 * Split screen first asks how many players.
 */
export class SelectScreen implements Screen {
  private roster: FighterDef[];
  private cursor: number[] = [];
  private locked: boolean[] = [];
  private picked: (FighterDef | null)[] = [];
  private pg: number[] = [];
  private showroom = new Showroom();
  private pages!: PagedGrid;
  private cells: HTMLDivElement[] = [];
  private names: HTMLDivElement[] = [];
  private status!: HTMLDivElement;
  private root!: HTMLDivElement;
  private arena!: HTMLDivElement;
  private okBtn!: HTMLButtonElement;
  private countMenu: Menu | null = null;
  private done = false;

  constructor(
    private app: App,
    private mode: SelectMode,
    private players: number,
  ) {
    this.roster = fullRoster();
    this.showroom.kartMode = true;
  }

  enter() {
    audio.playMusic('select');
    if (this.mode === 'split') this.askCount();
    else this.build();
  }

  /** split screen: 2, 3 or 4 players? */
  private askCount() {
    const pads = input.padList().length;
    const mk = (n: number) => ({
      label: `${n} JOUEURS`,
      sub: n === 2 ? 'Clavier partagé (ZQSD + flèches) ou manettes' : `Il faut au moins ${n - 2} manette${n > 3 ? 's' : ''} (${pads} branchée${pads > 1 ? 's' : ''})`,
      action: () => {
        this.players = n;
        this.countMenu = null;
        uiRoot().replaceChildren();
        this.build();
      },
    });
    this.countMenu = new Menu([mk(2), mk(3), mk(4)], () => audio.sfx('cursor'));
    this.countMenu.select(Math.max(0, this.players - 2), false);
    uiRoot().append(
      h('div', { class: 'screen' }, h('div', { class: 'h1' }, 'COMBIEN DE JOUEURS ?'), this.countMenu.el, h('div', { class: 'footer-hint' }, 'J1 et J2 : clavier ou manettes · J3 et J4 : manettes')),
      backButton(() => goMenu()),
    );
  }

  private build() {
    const n = this.players;
    input.setLocalPlayers(n);
    void audio.announcer('chooseDriver');
    this.showroom.slotCount = n;
    for (let p = 0; p < n; p++) {
      const i = this.roster.findIndex((d) => d.id === lastPick[p]);
      this.cursor[p] = i >= 0 ? i : p % Math.max(1, this.roster.length);
      this.locked[p] = false;
      this.picked[p] = null;
    }
    this.pages = new PagedGrid(this.roster, {
      cols: Math.min(8, this.roster.length + 1),
      random: true,
      onCell: (i) => this.clickCell(i),
      onFlip: (d) => this.tapFlip(d),
    });
    this.cells = this.pages.cells;
    for (let p = 0; p < n; p++) this.pg[p] = this.pages.pageFor(this.cursor[p], 0);
    this.pages.show(this.pg[0]);
    this.names = Array.from({ length: n }, (_, p) => h('div', { class: `pname p${p + 1}`, style: `--pc:${PLAYER_COLORS[p]}` }));
    this.status = h('div', { class: 'title-hint sel-hint' });
    this.okBtn = h('button', { class: 'btn primary sel-ok touch-only' }, 'VALIDER');
    this.okBtn.addEventListener('click', () => {
      const c = this.tapCursor();
      if (c >= 0) this.lock(c);
    });
    this.arena = h('div', { class: 'arena' });
    this.root = h(
      'div',
      { class: `select pick-screen kart-select players-${n}` },
      h('div', { class: 'top' }, h('div', { class: 'h1' }, n > 1 ? 'CHOISISSEZ VOS PILOTES' : 'CHOISIS TON PILOTE'), h('div', { class: 'title-hint' }, MODE_LABEL[this.mode])),
      this.arena,
      h('div', { class: 'names' }, ...this.names),
      h('div', { class: 'bottom' }, this.pages.el, this.status, this.okBtn),
    );
    uiRoot().append(this.root, backButton(() => this.back()));
    this.refresh();
  }

  exit() {
    this.showroom.dispose();
  }

  private get n() {
    return this.players;
  }

  private tapCursor(): number {
    for (let p = 0; p < this.n; p++) if (!this.locked[p]) return p;
    return -1;
  }

  private activeCursor(e: MenuEvent): number {
    if (this.n === 1) return 0;
    if (e.player >= 0 && e.player < this.n) return this.locked[e.player] ? -1 : e.player;
    return this.tapCursor();
  }

  private clickCell(i: number) {
    const c = this.tapCursor();
    if (c < 0) return;
    if (this.cursor[c] === i && this.pg[c] === this.pages.shown) this.lock(c);
    else {
      this.cursor[c] = i;
      this.pg[c] = this.pages.shown;
      audio.sfx('cursor');
      this.refresh();
    }
  }

  private tapFlip(dir: -1 | 1) {
    const c = this.tapCursor();
    if (c >= 0) this.flip(c, dir);
    else {
      this.pages.show(this.pages.shown + dir);
      this.refresh();
    }
  }

  private flip(c: number, dir: -1 | 1) {
    if (this.locked[c] || this.pages.count < 2) return;
    const old = this.pg[c];
    const p = (old + dir + this.pages.count) % this.pages.count;
    this.cursor[c] = this.pages.landOn(p, this.cursor[c], old);
    this.pg[c] = p;
    this.pages.show(p);
    audio.sfx('cursor');
    this.refresh();
  }

  private move(c: number, dx: number, dy: number) {
    if (this.locked[c]) return;
    if (this.pages.shown !== this.pg[c]) this.pages.show(this.pg[c]);
    let i = this.cursor[c];
    let p = this.pg[c];
    if (dx) [i, p] = this.pages.stepH(i, p, dx);
    if (dy) i = this.pages.stepV(i, p, dy);
    if (i !== this.cursor[c] || p !== this.pg[c]) {
      this.cursor[c] = i;
      this.pg[c] = p;
      this.pages.show(p);
      audio.sfx('cursor');
      this.refresh();
    }
  }

  private lock(c: number) {
    if (this.locked[c] || this.done) return;
    let def = this.roster[this.cursor[c]] ?? null;
    if (!def) {
      // « ? »: somebody nobody else took
      const free = this.roster.filter((d) => !this.picked.some((p) => p?.id === d.id));
      def = free[Math.floor(Math.random() * free.length)] ?? this.roster[0];
      this.cursor[c] = this.roster.indexOf(def);
      this.pg[c] = this.pages.pageFor(this.cursor[c], this.pg[c]);
    }
    if (this.picked.some((p, k) => k !== c && p?.id === def!.id)) {
      // two players can't drive the same friend
      audio.sfx('cancel');
      const cell = this.cells[this.cursor[c]];
      cell?.classList.remove('nope');
      void cell?.offsetWidth;
      cell?.classList.add('nope');
      return;
    }
    this.picked[c] = def;
    this.locked[c] = true;
    lastPick[c] = def.id;
    audio.sfx('confirm');
    this.showroom.play(c, 'kart:win');
    void audio.say(def.introLines[0]?.replace(/je vais te tuer/i, 'je vais te battre') ?? '', def.voice ?? {});
    const next = this.tapCursor();
    if (next >= 0) this.pages.show(this.pg[next]);
    this.refresh();
    if (this.locked.slice(0, this.n).every(Boolean)) {
      this.done = true;
      const drivers = this.picked.slice(0, this.n) as FighterDef[];
      setTimeout(() => {
        if (this.mode === 'online') goOnlineLobby(drivers[0]);
        else goCircuitSelect(this.mode, drivers);
      }, 900);
    }
  }

  private unlock(c: number): boolean {
    if (!this.locked[c] || this.done) return false;
    this.locked[c] = false;
    this.picked[c] = null;
    this.showroom.play(c, 'showcase');
    audio.sfx('cancel');
    this.refresh();
    return true;
  }

  private back() {
    for (let p = this.n - 1; p >= 0; p--) if (this.unlock(p)) return;
    audio.sfx('cancel');
    goMenu();
  }

  private refresh() {
    const n = this.n;
    const total = this.roster.length + 1;
    for (let i = 0; i < total; i++) {
      const cell = this.cells[i];
      if (!cell) continue;
      cell.querySelectorAll('.tag').forEach((t) => t.remove());
      let any = false;
      for (let p = 0; p < n; p++) {
        if (this.cursor[p] !== i) continue;
        any = true;
        const tag = h('span', { class: `tag t${p + 1}`, style: `background:${PLAYER_COLORS[p]};left:${-4 + p * 18}px;right:auto` }, n > 1 ? `J${p + 1}` : '1P');
        cell.append(tag);
        cell.style.setProperty('--sel', PLAYER_COLORS[p]);
      }
      cell.classList.toggle('kp', any);
      cell.classList.toggle('taken', this.picked.some((d) => d && this.roster[i]?.id === d.id));
    }
    this.pages.setAway(
      Array.from({ length: n }, (_, p) => p)
        .filter((p) => !this.locked[p])
        .map((p) => ({ label: n > 1 ? `J${p + 1}` : '1P', cls: p === 0 ? 't1' : 't2', page: this.pages.page(this.cursor[p]) >= 0 ? this.pg[p] : -1 })),
    );
    for (let p = 0; p < n; p++) {
      const def = this.picked[p] ?? this.roster[this.cursor[p]] ?? null;
      const parts: (string | HTMLElement | null)[] = [def ? def.name : '???'];
      parts.push(h('span', { class: 'ttl' }, def ? def.title : 'Au hasard'));
      if (n <= 2) parts.push(profileBox(def));
      if (this.locked[p]) parts.push(h('div', { class: 'lock' }, 'PRÊT !'));
      this.names[p].replaceChildren(...parts.filter((x): x is string | HTMLElement => x !== null));
      void this.showroom.show(p, def);
    }
    const touch = isTouchUi();
    const c = this.tapCursor();
    let msg = touch ? 'Touche ton pilote' : 'Choisis ton pilote (Entrée pour valider)';
    if (n > 1) {
      if (touch) msg = c >= 0 ? `J${c + 1} : touche ton pilote` : 'Prêts !';
      else {
        const k = (codes: string[]) => keyLabel(codes[0]);
        msg = `J1 : ${k(P1_KEYS.up)}${k(P1_KEYS.left)}${k(P1_KEYS.down)}${k(P1_KEYS.right)} + R · J2 : flèches + Entrée · J3 / J4 : manettes (A)`;
      }
    }
    this.status.textContent = msg;
    this.okBtn.disabled = c < 0;
    this.okBtn.textContent = c < 0 ? 'PRÊT !' : n > 1 ? `VALIDER J${c + 1}` : 'VALIDER';
    this.okBtn.style.background = c >= 0 && n > 1 ? PLAYER_COLORS[c] : '';
    void P2_KEYS;
  }

  private fitKarts(): ShowroomFit | null {
    const layout = phoneLayout();
    const W = window.innerWidth;
    if (!layout && W / Math.max(1, window.innerHeight) >= 1.1) return null;
    const a = this.arena.getBoundingClientRect();
    if (a.width < 40 || a.height < 40) return null;
    return { box: { left: a.left, top: a.top, width: a.width, height: a.height }, worldH: 1.9, centerY: 0.7, worldW: 2.6 };
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (this.countMenu) {
        if (e.action === 'up') this.countMenu.move(-1);
        else if (e.action === 'down') this.countMenu.move(1);
        else if (e.action === 'confirm' || e.action === 'start') {
          audio.sfx('confirm');
          this.countMenu.activate();
        } else if (e.action === 'back') goMenu();
        continue;
      }
      if (!this.pages) continue;
      if (e.action === 'back') {
        const c = e.player >= 0 && e.player < this.n ? e.player : -1;
        if (c >= 0 ? this.unlock(c) : false) continue;
        this.back();
        return;
      }
      const c = this.activeCursor(e);
      if (c < 0) continue;
      if (e.action === 'left') this.move(c, -1, 0);
      else if (e.action === 'right') this.move(c, 1, 0);
      else if (e.action === 'up') this.move(c, 0, -1);
      else if (e.action === 'down') this.move(c, 0, 1);
      else if (e.action === 'confirm' || e.action === 'start') this.lock(c);
      else if (e.action === 'prevPage') this.flip(c, -1);
      else if (e.action === 'nextPage') this.flip(c, 1);
    }
    if (!this.pages) {
      // count question: the turntable stays empty behind
      this.showroom.render(this.app.pipeline, dt, this.app.aspect);
      return;
    }
    this.showroom.fit = this.fitKarts();
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
