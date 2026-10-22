import * as THREE from 'three';
import { audio, type EngineVoice } from '../audio/audio';
import type { App, Screen } from '../app';
import { input, type KartInput } from '../input/input';
import { loadFace } from '../render/faceTexture';
import { KartAI } from '../race/ai';
import { DT } from '../race/kart';
import { Race, type RaceSetup } from '../race/race';
import { RaceWorld, splitLayout, type ViewRect } from '../game/raceWorld';
import { h, Menu, uiRoot } from '../ui/dom';
import { fmtTime, MapPanel, ordinal, RaceHud } from '../ui/raceHud';
import { ALL_ITEMS, itemIcon, type ItemId } from '../race/itemDefs';
import { getRecord, GHOST_STEP, submitRun, type TrackRecord } from '../game/records';
import { fullRoster } from '../game/settings';
import { RacerView } from '../render/racerView';
import { goMenu } from './flow';

export type RaceMode = 'race' | 'gp' | 'tt' | 'split' | 'online';

export interface RaceScreenOpts {
  setup: RaceSetup;
  mode: RaceMode;
  /** kart index driven by each local player (1..4) */
  locals: number[];
  /** line under the circuit name in the intro (« GRAND PRIX · COURSE 2/4 ») */
  subtitle?: string;
  /** results: CONTINUER (grand prix: next race / standings) */
  onDone?: (race: Race) => void;
  /** REJOUER from the results / pause menu (default: same race again) */
  onRetry?: () => void;
  /** extra systems (items, network) plugged in when the race is created */
  plug?: (race: Race, world: RaceWorld, screen: RaceScreen) => void;
}

const INTRO_TICKS = 5 * 60;

/** A race on screen: 1 to 4 local players (split screen), CPU drivers, HUDs, sounds, pause, results. */
export class RaceScreen implements Screen {
  readonly race: Race;
  world: RaceWorld | null = null;
  readonly huds: RaceHud[] = [];
  private root!: HTMLDivElement;
  private acc = 0;
  private paused = false;
  private pauseMenu: Menu | null = null;
  private overlay: HTMLElement | null = null;
  private resultsShown = false;
  private doneT = 0;
  private engines: (EngineVoice | null)[] = [];
  private introCam = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  private titleEl: HTMLElement | null = null;
  private lastCount = -1;
  private disposed = false;
  private rects: ViewRect[] = [{ x: 0, y: 0, w: 1, h: 1 }];
  /** systems that want a callback for each kart event (items: HUD icons...) */
  readonly hooks: ((kart: number, ev: Race['events'][number]['ev']) => void)[] = [];
  /** online: the network decides when the countdown starts */
  holdIntro = false;
  // ---- time trial
  private record: TrackRecord | null = null;
  private ghost: RacerView | null = null;
  private ghostRec: number[] = [];
  private lapTimes: number[] = [];
  private lapStart = 0;
  private lapsEl: HTMLElement | null = null;
  private ttResult: { race: boolean; lap: boolean } | null = null;
  private mapPanel: MapPanel | null = null;

  constructor(
    private app: App,
    readonly opts: RaceScreenOpts,
  ) {
    this.race = new Race(opts.setup);
    this.race.introTicks = INTRO_TICKS;
  }

  enter() {
    audio.stopMusic(0.6);
    input.setLocalPlayers(this.opts.locals.length);
    this.root = h('div', { class: 'race-screen' }, h('div', { class: 'race-loading' }, 'CHARGEMENT DU CIRCUIT…'));
    uiRoot().append(this.root);
    this.app.touch.onPause = () => this.togglePause();
    void this.load();
  }

  private async load() {
    const world = await RaceWorld.create(this.race, this.opts.locals);
    if (this.disposed) {
      world.dispose();
      return;
    }
    this.world = world;
    this.opts.plug?.(this.race, world, this);
    if (this.opts.mode === 'tt') await this.setupGhost();
    await world.prewarm(this.app.pipeline);
    if (this.disposed) return;
    this.root.replaceChildren();
    this.layoutHuds();
    const faces = await Promise.all(this.race.karts.map((k) => loadFace(k.def).then((f) => f.portraitUrl)));
    for (const hd of this.huds) hd.faces = faces;
    this.app.touch.setGameplay(true);
    this.app.touch.setIdle(true);
    this.app.resize();
    audio.playMusic(this.opts.setup.track.music as never);
    this.titleEl = h(
      'div',
      { class: 'race-title' },
      h('b', null, this.opts.setup.track.name),
      h('small', null, this.opts.subtitle ?? this.opts.setup.track.subtitle),
      h('span', { class: 'skip blink' }, 'ENTRÉE / TOUCHE : PASSER'),
    );
    this.root.append(this.titleEl);
    this.root.addEventListener('click', () => this.skipIntro());
  }

  private async setupGhost() {
    this.record = getRecord(this.opts.setup.track.id);
    const rec = this.record;
    if (!rec?.ghost?.length || !this.world) return;
    const def = fullRoster().find((d) => d.id === rec.driver) ?? this.race.karts[0].def;
    const face = await loadFace(def);
    const g = new RacerView(def, face);
    g.addTo(this.world.scene);
    g.makeGhost();
    g.setVisible(false);
    this.ghost = g;
  }

  /** ghost of the record, interpolated between its frames */
  private updateGhost(dt: number, alpha: number) {
    const g = this.ghost;
    const rec = this.record;
    if (!g || !rec?.ghost || this.race.phase === 'intro' || this.race.phase === 'countdown') return;
    const frames = rec.ghost.length / 7;
    const f = (this.race.time * 60 + alpha) / GHOST_STEP;
    const i = Math.floor(f);
    if (i >= frames - 1) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    const k = f - i;
    const a = rec.ghost.slice(i * 7, i * 7 + 7);
    const b = rec.ghost.slice(i * 7 + 7, i * 7 + 14);
    const pos = new THREE.Vector3(a[0], a[1], a[2]).lerp(new THREE.Vector3(b[0], b[1], b[2]), k);
    const q = new THREE.Quaternion(a[3], a[4], a[5], a[6]).slerp(new THREE.Quaternion(b[3], b[4], b[5], b[6]), k);
    const speed = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).length() * (60 / GHOST_STEP);
    g.placeGhost(pos, q, dt, speed);
  }

  private layoutHuds() {
    for (const hd of this.huds) hd.el.remove();
    this.huds.length = 0;
    this.rects = splitLayout(this.opts.locals.length, this.app.aspect);
    this.opts.locals.forEach((ki, p) => {
      const hud = new RaceHud(this.race, ki, this.rects[p], p, this.opts.locals.length);
      this.huds.push(hud);
      this.root.append(hud.el);
    });
    if (this.opts.locals.length === 3) {
      this.mapPanel = new MapPanel(this.race, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
      this.root.append(this.mapPanel.el);
    }
    if (this.opts.mode === 'tt') {
      this.lapsEl = h('div', { class: 'tt-laps' });
      this.huds[0]?.el.append(this.lapsEl);
      this.refreshLaps();
    }
  }

  private refreshLaps() {
    if (!this.lapsEl) return;
    const best = this.lapTimes.length ? Math.min(...this.lapTimes) : Infinity;
    const rec = this.record;
    this.lapsEl.replaceChildren(
      ...this.lapTimes.map((t, i) => h('div', { class: t === best ? 'best' : '' }, `T${i + 1}  ${fmtTime(t)}`)),
      h('div', { class: 'rec' }, rec ? `RECORD ${fmtTime(rec.best)}` : 'PAS ENCORE DE RECORD'),
    );
  }

  skipIntro() {
    if (this.race.phase === 'intro' && !this.holdIntro) this.race.introTicks = Math.min(this.race.introTicks, this.race.phaseTicks + 1);
  }

  /** online: everyone starts the countdown together */
  startCountdownNow() {
    this.holdIntro = false;
    this.race.introTicks = this.race.phaseTicks;
  }

  private togglePause() {
    if (this.resultsShown || !this.world) return;
    // online races don't stop: the menu opens over the running race
    this.paused = !this.paused;
    if (this.paused) this.showPause();
    else this.hidePause();
  }

  private showPause() {
    audio.sfx('cancel');
    const items = [
      { label: 'REPRENDRE', action: () => this.togglePause() },
      ...(this.opts.mode !== 'online' ? [{ label: 'RECOMMENCER', action: () => this.retry() }] : []),
      { label: 'QUITTER', sub: this.opts.mode === 'gp' ? 'Le grand prix sera perdu' : undefined, action: () => this.quit() },
    ];
    this.pauseMenu = new Menu(items, () => audio.sfx('cursor'));
    this.overlay = h('div', { class: 'overlay' }, h('div', { class: 'h1' }, 'PAUSE'), this.pauseMenu.el);
    uiRoot().append(this.overlay);
    this.app.touch.setCovered(true);
    for (const e of this.engines) e?.set(0, 0, 0);
  }

  private hidePause() {
    this.overlay?.remove();
    this.overlay = null;
    this.pauseMenu = null;
    this.app.touch.setCovered(false);
  }

  private retry() {
    if (this.opts.onRetry) this.opts.onRetry();
    else this.app.go(new RaceScreen(this.app, { ...this.opts, setup: { ...this.opts.setup, seed: this.opts.setup.seed + 1 } }));
  }

  private quit() {
    audio.sfx('cancel');
    goMenu();
  }

  exit() {
    this.disposed = true;
    input.autoAccelArmed = false;
    this.app.pipeline.post.uLines.value = 0;
    for (const e of this.engines) e?.stop();
    this.ghost?.dispose();
    this.world?.dispose();
    this.app.touch.onPause = null;
    input.setLocalPlayers(1);
  }

  /** inputs of this tick for every kart driven here */
  private inputs(): (KartInput | null)[] {
    const out: (KartInput | null)[] = this.race.karts.map(() => null);
    const covered = this.paused && this.opts.mode !== 'online';
    const auto = (window as unknown as { bblAutopilot?: boolean }).bblAutopilot;
    this.opts.locals.forEach((ki, p) => {
      out[ki] = covered ? null : input.kart(p);
      // ?debug: bblAutopilot = true lets the CPU drive the local karts (tests)
      if (auto && this.race.phase === 'race') {
        let ai = this.autoAIs.get(ki);
        if (!ai) this.autoAIs.set(ki, (ai = new KartAI(this.race.karts[ki], 'hard', ki)));
        const kb = out[ki]!;
        out[ki] = { ...ai.think(this.race.track, this.race.time), item: kb.item, aim: kb.aim };
      }
    });
    return out;
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (this.pauseMenu) {
        if (e.action === 'up') this.pauseMenu.move(-1);
        else if (e.action === 'down') this.pauseMenu.move(1);
        else if (e.action === 'confirm') {
          audio.sfx('confirm');
          this.pauseMenu.activate();
          return;
        } else if (e.action === 'back' || e.action === 'start') this.togglePause();
        continue;
      }
      if (this.resultsMenu) {
        if (e.action === 'up' || e.action === 'left') this.resultsMenu.move(-1);
        else if (e.action === 'down' || e.action === 'right') this.resultsMenu.move(1);
        else if (e.action === 'confirm' || e.action === 'start') {
          audio.sfx('confirm');
          this.resultsMenu.activate();
          return;
        }
        continue;
      }
      if (this.race.phase === 'intro' && (e.action === 'confirm' || e.action === 'start')) this.skipIntro();
      else if (e.action === 'start' || (e.action === 'back' && this.race.phase !== 'intro')) this.togglePause();
    }
    const world = this.world;
    if (!world || !this.huds.length) return;
    (window as unknown as { bblRaceNow?: Race; bblWorld?: RaceWorld }).bblRaceNow = this.race;
    (window as unknown as { bblWorld?: RaceWorld }).bblWorld = world;
    const race = this.race;
    if (this.holdIntro && race.phase === 'intro') race.introTicks = race.phaseTicks + 2;
    const frozen = this.paused && this.opts.mode !== 'online';
    if (!frozen) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n++ < 5) {
        this.acc -= DT;
        race.tick(this.inputs());
        input.endTick();
        this.onTick();
      }
      if (this.acc > DT * 5) this.acc = 0;
    }
    const alpha = frozen ? 1 : Math.min(1, this.acc / DT);
    if (race.phase === 'intro') this.renderIntro(dt);
    else {
      if (this.titleEl) {
        this.titleEl.remove();
        this.titleEl = null;
      }
      world.render(this.app.pipeline, alpha, dt, this.rects, this.app.aspect);
    }
    for (const hd of this.huds) hd.update(dt, this.opts.locals);
    if (this.mapPanel && race.ticks % 6 === 0) this.mapPanel.update(this.opts.locals);
    this.updateItemSlots();
    if (this.ghost) this.updateGhost(dt, alpha);
    // manga speed lines while boosting (one player: they cover the whole picture)
    const post = this.app.pipeline.post;
    if (this.opts.locals.length === 1 && race.phase !== 'intro') {
      const k = race.karts[this.opts.locals[0]];
      const want = k.boostT > 0 || k.starT > 0 ? Math.min(0.75, 0.35 + k.boostPower * 0.25) : k.slipT > 0.4 ? 0.2 : 0;
      post.uLines.value += (want - post.uLines.value) * Math.min(1, dt * 8);
      post.uLinesCenter.value.set(0.5, 0.55);
      post.uLinesSeed.value = Math.floor(race.ticks / 3);
    } else post.uLines.value = 0;
    this.updateEngines();
    if (race.phase === 'done' && !this.resultsShown) {
      this.doneT += dt;
      if (this.doneT > 3.2) this.showResults();
    }
  }

  /** fly-over of the circuit before the countdown */
  private renderIntro(dt: number) {
    const race = this.race;
    const tr = race.track;
    const t = race.phaseTicks / Math.max(1, race.introTicks);
    const L = tr.length;
    const cam = this.introCam;
    if (t < 0.7) {
      // sweeping along the circuit (backwards toward the grid)
      const k = t / 0.7;
      const s = L * (0.42 - 0.4 * k);
      const a = tr.main.sample(tr.main.indexAt(s));
      const b = tr.main.sample(tr.main.indexAt(s - 25));
      cam.position.copy(a.p).addScaledVector(a.u, 9 + 6 * Math.sin(k * Math.PI)).addScaledVector(a.r, 14 * Math.cos(k * 3));
      cam.up.set(0, 1, 0);
      cam.lookAt(b.p);
    } else {
      // the grid, from the front, slowly pulling back
      const k = (t - 0.7) / 0.3;
      const a = tr.main.sample(tr.main.indexAt(4 + 6 * k));
      const g = tr.main.sample(tr.main.indexAt(-14));
      cam.position.copy(a.p).addScaledVector(a.u, 3 + 2 * k).addScaledVector(a.r, 4 - 8 * k);
      cam.up.set(0, 1, 0);
      cam.lookAt(g.p.clone().addScaledVector(g.u, 0.5));
    }
    cam.fov = this.app.aspect < 1 ? 75 : 58;
    cam.aspect = this.app.aspect;
    cam.updateProjectionMatrix();
    const world = this.world!;
    // views still need their pose (and the driver's idle)
    world.render(this.app.pipeline, 1, dt, [], this.app.aspect);
    this.app.pipeline.renderViews(world.scene, [{ camera: cam, x: 0, y: 0, w: 1, h: 1 }], world.env.clearColor);
  }

  private onTick() {
    const race = this.race;
    if (this.opts.mode === 'tt' && race.phase === 'race') {
      const k = race.karts[this.opts.locals[0]];
      if (!k.finished && (race.ticks - 1) % GHOST_STEP === 0) {
        const r = (v: number, m: number) => Math.round(v * m) / m;
        this.ghostRec.push(r(k.pos.x, 100), r(k.pos.y, 100), r(k.pos.z, 100), r(k.quat.x, 1000), r(k.quat.y, 1000), r(k.quat.z, 1000), r(k.quat.w, 1000));
      }
      for (const { kart, ev } of race.events) {
        if (kart !== this.opts.locals[0] || ev.k !== 'lap') continue;
        if (ev.lap - 1 > this.lapTimes.length) {
          this.lapTimes.push(race.time - this.lapStart);
          this.lapStart = race.time;
          this.refreshLaps();
        }
      }
    }
    // countdown beeps & numbers
    if (race.phase === 'countdown') {
      const c = Math.ceil(race.countdown);
      if (c !== this.lastCount && c >= 1 && c <= 3) {
        this.lastCount = c;
        audio.sfx('beep');
        for (const hd of this.huds) hd.big(String(c));
        if (c === 3) {
          this.app.touch.setIdle(false);
          if (this.opts.locals.length === 1) void audio.announcer('three');
        }
      }
    } else if (race.phase === 'race' && this.lastCount !== 0) {
      this.lastCount = 0;
      input.autoAccelArmed = true;
      this.app.touch.sync();
      audio.sfx('beepGo');
      for (const hd of this.huds) hd.big('PARTEZ !', 'go');
    }
    for (const { kart, ev } of race.events) {
      for (const hk of this.hooks) hk(kart, ev);
      const p = this.opts.locals.indexOf(kart);
      const k = race.karts[kart];
      if (p < 0) {
        // others: only the loud things, quieter with distance
        const near = this.world ? Math.min(...this.world.cams.map((c) => c.kart.pos.distanceTo(k.pos))) : 99;
        const vol = Math.max(0, 1 - near / 40) * 0.6;
        if (ev.k === 'itemHit' && this.opts.locals.includes(ev.by)) {
          // one of mine hit somebody
          const me = this.opts.locals.indexOf(ev.by);
          this.huds[me]?.message(`${k.def.name} EST TOUCHÉ !`, 'gold', 1.2);
          audio.sfx('ding', { volume: 0.6 });
        }
        if (vol > 0.05) {
          if (ev.k === 'spin') audio.sfx('crash', { volume: vol });
          else if (ev.k === 'itemUse') this.itemSound(ev.item, vol * 0.7);
          else if (ev.k === 'boost' && ev.kind !== 'drift') audio.sfx('turbo', { volume: vol * 0.6 });
          else if (ev.k === 'bonk' && ev.strength > 0.4) audio.sfx('bonk', { volume: vol * 0.7 });
        }
        continue;
      }
      const hud = this.huds[p];
      const cam = this.world?.cams[p];
      switch (ev.k) {
        case 'tier':
          audio.sfx('spark', { pitch: 1 + ev.tier * 0.12 });
          break;
        case 'boost': {
          audio.sfx('turbo');
          if (ev.kind === 'drift' && ev.tier) hud.message(['', 'MINI-TURBO !', 'SUPER MINI-TURBO !', 'ULTRA MINI-TURBO !'][ev.tier], 't' + ev.tier);
          else if (ev.kind === 'start') hud.message('DÉPART TURBO !', 'gold');
          else if (ev.kind === 'slip') hud.message('ASPIRATION !', 'gold');
          else if (ev.kind === 'bump') hud.message('TURBO ANTI-GRAVITÉ !', 't1');
          break;
        }
        case 'trick':
          audio.sfx('trick');
          hud.message('FIGURE !', 'gold', 0.8);
          break;
        case 'hop':
          audio.sfx('hop', { volume: 0.5 });
          break;
        case 'land':
          if (ev.hard) {
            audio.sfx('land');
            cam?.shake(0.12);
          }
          break;
        case 'bonk':
          audio.sfx('bonk', { volume: 0.4 + 0.6 * ev.strength });
          cam?.shake(0.25 * ev.strength);
          break;
        case 'bump':
          audio.sfx('bonk', { volume: 0.3 + 0.4 * ev.strength, pitch: 1.3 });
          break;
        case 'burnout':
          audio.sfx('crash', { volume: 0.5 });
          hud.message('RATÉ ! TROP TÔT…', 'red');
          break;
        case 'spin':
          audio.sfx('crash');
          cam?.shake(0.3);
          break;
        case 'fall':
          audio.sfx('fall');
          break;
        case 'rescued':
          audio.sfx('thwip');
          break;
        case 'itemBox':
          audio.sfx('itemBox');
          break;
        case 'itemGot':
          audio.sfx('itemGet');
          break;
        case 'itemUse':
          this.itemSound(ev.item, 1);
          if (ev.item === 'config') for (const hd of this.huds) if (hd !== hud) hd.message('« C’EST QUOI TA CONFIG ? »', 't2', 2.2);
          if (ev.item === 'sayan') hud.message('SUPER SAYAN !', 'gold', 1.5);
          if (ev.item === 'bazooka') hud.message('BAZOOKA !', 'red', 1.5);
          break;
        case 'itemHit': {
          const by = race.karts[ev.by];
          const short: Record<string, string> = { ball: 'LE BALLON', words: 'LA MÉTA', grenade: 'LA GRENADE', mic: 'LA PUNCHLINE', web: 'LA TOILE', sauce: 'LA SAUCE' };
          const what = short[ev.item] ?? 'ÇA';
          const line =
            ev.item === 'config' ? '« C’EST QUOI TA CONFIG ? »' : ev.by === kart ? `OUPS ! ${what}, C’ÉTAIT LA TIENNE…` : `${by ? by.def.name : '???'} T’A EU AVEC ${what} !`;
          hud.message(line, 'red', 1.8);
          audio.sfx(ev.item === 'web' || ev.item === 'sauce' ? 'splat' : 'crash');
          cam?.shake(0.35);
          break;
        }
        case 'itemBlock':
          audio.sfx('shine');
          break;
        case 'lap':
          if (ev.lap === race.laps) {
            audio.sfx('lap', { pitch: 1.2 });
            hud.message('TOUR FINAL !', 'gold', 2);
            if (this.opts.locals.length === 1) void audio.announcer('finalLap');
          } else if (ev.lap < race.laps) {
            audio.sfx('lap');
            hud.message(`TOUR ${ev.lap}/${race.laps}`, '', 1.2);
          }
          break;
        case 'finish': {
          if (this.opts.mode === 'tt') {
            if (this.lapTimes.length < race.laps) this.lapTimes.push(race.time - this.lapStart);
            this.refreshLaps();
            this.ttResult = submitRun(this.opts.setup.track.id, k.finishTime, Math.min(...this.lapTimes), k.def.id, this.ghostRec);
            audio.sfx('roundBell');
            hud.big(fmtTime(k.finishTime), 'finish', 99);
            if (this.ttResult.race) hud.message('NOUVEAU RECORD !', 'gold', 99);
            else if (this.ttResult.lap) hud.message('MEILLEUR TOUR !', 'gold', 99);
            if (cam) cam.mode = 'finish';
            this.world!.views[kart].result = this.ttResult.race;
            break;
          }
          const pos = k.rank + 1;
          audio.sfx('roundBell');
          hud.big(ordinal(pos) + ' !', 'finish', 99);
          if (this.opts.locals.length === 1) void audio.announcer('finish');
          if (cam) cam.mode = 'finish';
          this.world?.effects.confetti(k.pos.clone().add(new THREE.Vector3(0, 2, 0)), 40, 3);
          this.world!.views[kart].result = pos <= 3;
          if (pos <= 3) setTimeout(() => void audio.say(k.def.winLines[Math.floor(Math.random() * k.def.winLines.length)] ?? '', k.def.voice ?? {}), 600);
          break;
        }
      }
    }
  }

  private itemSound(item: ItemId, volume: number) {
    const map: Partial<Record<ItemId, Parameters<typeof audio.sfx>[0]>> = {
      turbo: 'turbo',
      turbo3: 'turbo',
      sauce: 'toss',
      web: 'thwip',
      ball: 'dash',
      ball3: 'dash',
      words: 'zap',
      grenade: 'pin',
      mic: 'rocket',
      sayan: 'powerUp',
      bazooka: 'rocket',
      config: 'crowdOoh',
    };
    const id = map[item];
    if (id) audio.sfx(id, { volume });
  }

  /** item slots of the HUDs (and the touch button): the roulette cycles through the icons */
  private updateItemSlots() {
    const items = this.race.items;
    this.opts.locals.forEach((ki, p) => {
      const hud = this.huds[p];
      if (!items) {
        hud.setItem(null, 0, false);
        return;
      }
      const h = items.holds[ki];
      let url: string | null = null;
      if (h.roll > 0) url = itemIcon(ALL_ITEMS[Math.floor(this.race.ticks / 4) % ALL_ITEMS.length]);
      else if (h.item) url = itemIcon(h.item);
      hud.setItem(url, h.count, h.roll > 0);
      if (p === 0) this.app.touch.setItem(url, h.roll > 0);
      if (h.roll > 0 && this.race.ticks % 4 === 0) audio.sfx('roulette', { volume: 0.4 });
    });
    // explosions near a local camera
    const w = this.world;
    if (w?.items) {
      for (const b of w.items.booms) {
        const near = Math.min(...w.cams.map((c) => c.kart.pos.distanceTo(b.pos)));
        audio.sfx('explosion', { volume: Math.max(0.15, 1 - near / 60) });
        if (near < 15) for (const c of w.cams) c.shake(0.4 * (1 - near / 15));
      }
    }
  }

  private updateEngines() {
    const race = this.race;
    if (!this.engines.length && race.phase !== 'intro') this.engines = this.opts.locals.map(() => audio.engine());
    this.opts.locals.forEach((ki, p) => {
      const e = this.engines[p];
      if (!e) return;
      const k = race.karts[ki];
      if (this.paused || this.resultsShown) {
        e.set(0, 0, 0);
        return;
      }
      const rev = race.phase === 'countdown' ? (k.startHold > 0 ? 0.55 + 0.2 * Math.sin(race.ticks * 0.3) : 0.08) : Math.abs(k.speed) / k.params.top;
      const skid = (k.drift !== 0 && k.grounded ? 0.8 : 0) + (k.grounded && (k.surface === 'offroad' || k.surface === 'dirt') && Math.abs(k.speed) > 4 ? 0.4 : 0) + (k.burnoutT > 0 ? 1 : 0);
      const n = this.opts.locals.length;
      e.set(rev + (k.boostT > 0 ? 0.25 : 0), Math.min(1, skid), n > 1 ? 0.6 : 1, n === 2 ? 0 : n > 2 ? (p % 2 ? 0.5 : -0.5) : 0);
    });
  }

  private resultsMenu: Menu | null = null;
  private autoAIs = new Map<number, KartAI>();

  private showResults() {
    this.resultsShown = true;
    this.root.classList.add('covered');
    for (const e of this.engines) e?.set(0, 0, 0);
    this.app.touch.setCovered(true);
    const race = this.race;
    const order = race.finalOrder();
    const rows = order.map((ki, pos) => {
      const k = race.karts[ki];
      const face = h('td', null, h('div', { class: 'face' }));
      loadFace(k.def).then((f) => ((face.firstChild as HTMLElement).style.backgroundImage = `url(${f.portraitUrl})`));
      const name = this.opts.setup.racers[ki].name ?? k.def.name;
      return h(
        'tr',
        { class: this.opts.locals.includes(ki) ? 'me' : '' },
        h('td', { class: 'rk' }, ordinal(pos + 1)),
        face,
        h('td', null, name),
        h('td', { class: 'tt' }, k.finished ? fmtTime(k.finishTime) : '--'),
      );
    });
    const items = [
      ...(this.opts.onDone ? [{ label: 'CONTINUER', action: () => this.opts.onDone!(race) }] : []),
      ...(this.opts.mode !== 'gp' && this.opts.mode !== 'online' ? [{ label: 'REJOUER', action: () => this.retry() }] : []),
      ...(this.opts.mode !== 'gp' ? [{ label: 'MENU', action: () => this.quit() }] : []),
    ];
    this.resultsMenu = new Menu(items, () => audio.sfx('cursor'));
    let table: HTMLElement = h('table', { class: 'results-table' }, ...rows);
    let title = 'RÉSULTATS';
    if (this.opts.mode === 'tt') {
      // time trial: the laps, the total, the record
      const k = race.karts[this.opts.locals[0]];
      const best = Math.min(...this.lapTimes);
      const rec = getRecord(this.opts.setup.track.id);
      title = this.ttResult?.race ? 'NOUVEAU RECORD !' : 'CONTRE-LA-MONTRE';
      table = h(
        'table',
        { class: 'results-table' },
        ...this.lapTimes.map((t, i) => h('tr', { class: t === best ? 'me' : '' }, h('td', { class: 'rk' }, `T${i + 1}`), h('td', null, t === best ? 'MEILLEUR TOUR' : ''), h('td', { class: 'tt' }, fmtTime(t)))),
        h('tr', { class: 'me' }, h('td', { class: 'rk' }, 'TOTAL'), h('td', null, k.def.name), h('td', { class: 'tt' }, fmtTime(k.finishTime))),
        rec ? h('tr', null, h('td', { class: 'rk' }, 'REC'), h('td', null, `record : ${fmtTime(rec.best)} · meilleur tour : ${fmtTime(rec.lap)}`), h('td', null, '')) : null,
      );
    }
    this.overlay = h('div', { class: 'overlay results' }, h('div', { class: 'h1' }, title), table, this.resultsMenu.el);
    uiRoot().append(this.overlay);
    audio.playMusic('victory', { loop: false });
  }
}
