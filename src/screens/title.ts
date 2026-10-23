import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { RaceWorld } from '../game/raceWorld';
import { fullRoster, settings } from '../game/settings';
import { input } from '../input/input';
import { CIRCUITS } from '../race/circuits';
import { DT } from '../race/kart';
import { Race } from '../race/race';
import { h, isTouchUi, Menu, uiRoot } from '../ui/dom';
import { goLab, goOptions, goSelect } from './flow';
import { shuffled } from '../game/grid';

/** CPU race playing behind the title menu, filmed by trackside cameras. */
class Attract {
  race: Race | null = null;
  world: RaceWorld | null = null;
  private acc = 0;
  private disposed = false;
  private followT = 0;
  private loading = false;

  constructor() {
    void this.load();
  }

  private async load() {
    if (this.loading) return;
    this.loading = true;
    const seed = (Math.random() * 1e9) | 0;
    const track = CIRCUITS[Math.floor(Math.random() * CIRCUITS.length)];
    const racers = shuffled(fullRoster(), seed)
      .slice(0, 6)
      .map((def) => ({ def }));
    const race = new Race({ track, racers, laps: 99, cc: 150, difficulty: 'hard', items: true, seed });
    race.introTicks = 0;
    // skip the countdown: already racing
    for (let i = 0; i < Race.COUNT + 1; i++) race.tick([]);
    for (let i = 0; i < 60 * (5 + Math.random() * 15); i++) race.tick([]);
    const world = await RaceWorld.create(race, [0]);
    this.loading = false;
    if (this.disposed) {
      world.dispose();
      return;
    }
    this.world?.dispose();
    this.race = race;
    this.world = world;
    world.cams[0].mode = 'tv';
  }

  frame(app: App, dt: number) {
    const race = this.race;
    const world = this.world;
    if (!race || !world) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n++ < 4) {
      this.acc -= DT;
      race.tick([]);
    }
    // follow the leader most of the time, sometimes someone in the pack
    this.followT -= dt;
    if (this.followT <= 0) {
      this.followT = 6 + Math.random() * 4;
      const pick = Math.random() < 0.5 ? race.order[0] : race.order[Math.floor(Math.random() * race.order.length)];
      world.cams[0].kart = race.karts[pick];
      world.cams[0].reset();
    }
    world.render(app.pipeline, Math.min(1, this.acc / DT), dt, [{ x: 0, y: 0, w: 1, h: 1 }], app.aspect);
    if (race.time > 90) {
      race.time = 0;
      void this.load();
    }
  }

  dispose() {
    this.disposed = true;
    this.world?.dispose();
  }
}

export class TitleScreen implements Screen {
  private attract = new Attract();
  private menu: Menu | null = null;
  private pressEl: HTMLElement | null = null;
  private root!: HTMLElement;

  constructor(
    private app: App,
    private skipPress: boolean,
  ) {}

  enter() {
    audio.playMusic('title');
    this.root = h('div', { class: 'screen title' });
    uiRoot().append(this.root);
    const logo = h('div', { class: 'logo' }, 'BBL', h('br'), 'KART', h('small', null, 'LE GRAND PRIX DES POTES'));
    this.root.append(logo);
    if (this.skipPress) this.showMenu();
    else {
      this.pressEl = h('div', { class: 'title-hint title-press blink' }, isTouchUi() ? "TOUCHE L'ÉCRAN" : 'APPUIE SUR ENTRÉE');
      this.root.classList.add('press');
      this.root.append(this.pressEl);
      this.root.addEventListener('click', () => this.press(), { once: true });
    }
    this.root.append(h('div', { class: 'footer-hint title-foot' }, '© BBL CREW · jeu de kart fait maison · photos des potes non contractuelles'));
  }

  exit() {
    this.attract.dispose();
  }

  private press() {
    if (this.menu) return;
    audio.unlock();
    audio.sfx('confirm');
    void audio.announcer('gameTitle');
    this.pressEl?.remove();
    this.root.classList.remove('press');
    this.showMenu();
  }

  private showMenu() {
    const cc = `${settings.cc}cc`;
    this.menu = new Menu(
      [
        { label: 'GRAND PRIX', sub: `4 courses, des points, une coupe · ${cc}`, action: () => goSelect('gp') },
        { label: 'COURSE SIMPLE', sub: 'Un circuit au choix contre les CPU', action: () => goSelect('race') },
        { label: 'CONTRE-LA-MONTRE', sub: 'Seul en piste, bats ton record', action: () => goSelect('tt') },
        { label: 'MULTIJOUEUR', sub: 'Écran partagé de 2 à 4 joueurs', action: () => goSelect('split', 2) },
        { label: 'EN LIGNE', sub: 'Envoie un lien à tes potes', action: () => goSelect('online') },
        { label: 'LABO', sub: 'Crée ton pilote avec ta photo', action: () => goLab() },
        { label: 'OPTIONS', sub: 'Son, cylindrée, CPU, graphismes, commandes', action: () => goOptions() },
      ],
      () => audio.sfx('cursor'),
    );
    this.menu.el.classList.add('title-menu');
    this.root.insertBefore(this.menu.el, this.root.querySelector('.title-foot'));
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (!this.menu) {
        if (e.action === 'confirm' || e.action === 'start') this.press();
        continue;
      }
      if (e.action === 'up') this.menu.move(-1);
      else if (e.action === 'down') this.menu.move(1);
      else if (e.action === 'confirm' || e.action === 'start') {
        audio.sfx('confirm');
        this.menu.activate();
        return;
      }
    }
    this.attract.frame(this.app, dt);
  }
}
