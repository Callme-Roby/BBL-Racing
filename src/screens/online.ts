/**
 * EN LIGNE — create a room or join one with the invitation link, the room screen (link to share,
 * players and their points, circuit chosen by the host) and the online races themselves.
 * The network side lives in src/game/onlineRoom.ts (room) and src/game/netRace.ts (race).
 */
import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import type { FighterDef } from '../data/roster';
import { NetRace } from '../game/netRace';
import { NetError, OnlineRoom, type RaceLaunch } from '../game/onlineRoom';
import { input } from '../input/input';
import { inviteUrl, preloadNet } from '../net/peer';
import { CIRCUITS } from '../race/circuits';
import { loadFace } from '../render/faceTexture';
import { Showroom } from '../render/showroom';
import { backButton, h, Menu, uiRoot } from '../ui/dom';
import { trackPreview } from './circuitSelect';
import { goMenu, goSelect } from './flow';
import { RaceScreen } from './race';

let app: App | null = null;
/** the room this page is in (null: none) */
let room: OnlineRoom | null = null;
/** invitation code of the link the page was opened with, until a friend is chosen */
let pendingJoin: string | null = null;
let netRace: NetRace | null = null;
let raceScreen: RaceScreen | null = null;

function niceError(e: unknown): string {
  if (e instanceof NetError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/unavailable-id|could not connect|peer-unavailable/i.test(msg)) return 'Partie introuvable : le lien a peut-être expiré, ou l’hôte a fermé sa page.';
  return msg;
}

/** Opened from an invitation link (?room=code): choose a friend, then join. */
export function goOnlineJoin(code: string) {
  pendingJoin = code;
  goSelect('online');
}

/** After the driver select of EN LIGNE. */
export function goOnlineLobby(def: FighterDef) {
  const a = currentApp();
  if (room) {
    // already in a room (changed friend): back to it
    room.setDef(def);
    a.go(new RoomScreen(a, room));
    return;
  }
  a.go(new OnlineHomeScreen(a, def, pendingJoin));
}

function currentApp(): App {
  if (!app) app = (window as unknown as { bbl: App }).bbl;
  return app;
}

function leaveRoom() {
  endRace();
  room?.leave();
  room = null;
  pendingJoin = null;
  // drop ?room= from the address bar: reloading opens the title again
  if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
}

function endRace() {
  netRace?.dispose();
  netRace = null;
  raceScreen = null;
}

function goRoom() {
  endRace();
  const a = currentApp();
  if (room) a.go(new RoomScreen(a, room));
  else goMenu();
}

/** A message (room closed, connection lost) then the menu. */
class MessageScreen implements Screen {
  private menu: Menu;
  constructor(
    private title: string,
    private text: string,
  ) {
    this.menu = new Menu([{ label: 'MENU', action: () => goMenu() }]);
  }
  enter() {
    uiRoot().append(h('div', { class: 'screen dim tn-center' }, h('div', { class: 'h1' }, this.title), h('div', { class: 'status err' }, this.text), this.menu.el));
  }
  frame() {
    for (const e of input.menuEvents()) if (e.action === 'confirm' || e.action === 'start' || e.action === 'back') this.menu.activate();
  }
}

function closed(reason: string) {
  const wasRacing = !!raceScreen;
  leaveRoom();
  audio.sfx('cancel');
  currentApp().go(new MessageScreen(wasRacing ? 'CONNEXION PERDUE' : 'PARTIE TERMINÉE', reason));
}

/** wire the callbacks of a fresh room */
function adopt(r: OnlineRoom) {
  room = r;
  pendingJoin = null;
  r.onClosed = (reason) => closed(reason);
  r.onStart = (l) => launchRace(r, l);
  r.onGo = (ms) => window.setTimeout(() => raceScreen?.startCountdownNow(), ms);
  r.onBackToRoom = () => {
    // the host ended the race: the guests still on their results screen stay there
    if (!raceScreen || raceScreen.race.phase !== 'done') goRoom();
  };
}

function launchRace(r: OnlineRoom, l: RaceLaunch) {
  const a = currentApp();
  endRace();
  const screen = new RaceScreen(a, {
    setup: l.setup,
    mode: 'online',
    locals: [l.me],
    subtitle: `EN LIGNE · ${r.players.filter((p) => p.online).length} JOUEURS`,
    holdIntro: true,
    plug: (race) => {
      netRace = new NetRace(race, l.me, r.host, l.links);
      netRace.onLost = (reason) => closed('L’hôte ne répond plus. ' + reason);
    },
    onTick: () => netRace?.afterTick(),
    onLoaded: () => {
      if (r.host) r.hostLoaded();
      else r.link?.send({ t: 'ready' });
    },
    onDone: (race) => {
      if (r.host) r.finishRace(race.finalOrder());
      goRoom();
    },
    onQuit: () => {
      if (r.host && r.racing) r.finishRace(screen.race.finalOrder());
      goRoom();
    },
  });
  raceScreen = screen;
  a.go(screen);
}

// ===========================================================================
// create / join
// ===========================================================================
class OnlineHomeScreen implements Screen {
  private showroom = new Showroom();
  private root!: HTMLElement;
  private menu: Menu | null = null;
  private busy = false;

  constructor(
    private app: App,
    private def: FighterDef,
    private joinCode: string | null,
  ) {
    this.showroom.kartMode = true;
  }

  enter() {
    preloadNet().catch(() => undefined);
    audio.playMusic('select');
    this.root = h('div', { class: 'screen dim tn-center online-home' });
    uiRoot().append(this.root, backButton(() => this.back()));
    void this.showroom.show(0, this.def);
    if (this.joinCode) void this.join(this.joinCode);
    else this.home();
  }

  exit() {
    this.showroom.dispose();
  }

  private back() {
    audio.sfx('cancel');
    pendingJoin = null;
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
    goMenu();
  }

  private home() {
    this.menu = new Menu(
      [
        { label: 'CRÉER UNE PARTIE', sub: 'Tu envoies un lien, chacun joue depuis chez soi', action: () => void this.create() },
        { label: 'REJOINDRE', sub: 'Colle le lien ou le code reçu', action: () => this.askCode() },
        { label: 'RETOUR', action: () => this.back() },
      ],
      () => audio.sfx('cursor'),
    );
    this.root.replaceChildren(h('div', { class: 'h1' }, 'EN LIGNE'), h('div', { class: 'title-hint' }, 'Jusqu’à 8 joueurs, les places libres sont pour les pilotes CPU'), this.menu.el, h('div', { class: 'status' }, ''));
  }

  private askCode() {
    this.menu = null;
    audio.sfx('confirm');
    const field = h('input', { placeholder: 'Lien ou code (ex : k7m2pq)', autocomplete: 'off', spellcheck: false });
    const go = h('button', { class: 'btn primary' }, 'REJOINDRE');
    const submit = () => {
      const v = field.value.trim();
      const m = v.match(/[?&]room=([a-z0-9]+)/i);
      const code = (m ? m[1] : v).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (code.length >= 4) void this.join(code);
      else this.setStatus('Code invalide.', true);
    };
    go.addEventListener('click', submit);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') this.home();
    });
    const back = h('button', { class: 'btn' }, 'RETOUR');
    back.addEventListener('click', () => this.home());
    this.root.replaceChildren(h('div', { class: 'h1' }, 'REJOINDRE UNE PARTIE'), h('div', { class: 'share' }, field, go), h('div', { class: 'status' }, ''), back);
    setTimeout(() => field.focus(), 50);
  }

  private setStatus(text: string, err = false) {
    const el = this.root.querySelector('.status');
    if (el) {
      el.textContent = text;
      el.classList.toggle('err', err);
      el.classList.toggle('blink', !err && !!text);
    }
  }

  private async create() {
    if (this.busy) return;
    this.busy = true;
    audio.sfx('confirm');
    this.setStatus('Connexion…');
    try {
      adopt(await OnlineRoom.create(this.def, (s) => this.setStatus(s)));
      goRoom();
    } catch (e) {
      console.warn(e);
      this.setStatus(niceError(e), true);
    } finally {
      this.busy = false;
    }
  }

  private async join(code: string) {
    if (this.busy) return;
    this.busy = true;
    this.menu = null;
    this.root.replaceChildren(h('div', { class: 'h1' }, 'REJOINDRE LA PARTIE'), h('div', { class: 'title-hint' }, `Code : ${code.toUpperCase()}`), h('div', { class: 'status' }, ''));
    this.setStatus('Connexion…');
    try {
      const r = await OnlineRoom.join(code, this.def, (s) => this.setStatus(s));
      adopt(r);
      // the ?room= link stays in the address bar: reloading the page rejoins (same seat)
      goRoom();
    } catch (e) {
      console.warn(e);
      this.setStatus(niceError(e), true);
      const back = h('button', { class: 'btn' }, 'RETOUR');
      back.addEventListener('click', () => this.home());
      this.root.append(back);
    } finally {
      this.busy = false;
    }
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (this.menu) {
        if (e.action === 'up') this.menu.move(-1);
        else if (e.action === 'down') this.menu.move(1);
        else if (e.action === 'confirm' || e.action === 'start') this.menu.activate();
        else if (e.action === 'back') this.back();
      } else if (e.action === 'back' && !document.activeElement?.matches('input') && !this.busy) this.home();
    }
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}

// ===========================================================================
// the room
// ===========================================================================
class RoomScreen implements Screen {
  private showroom = new Showroom();
  private root!: HTMLElement;
  private list!: HTMLElement;
  private trackEl!: HTMLElement;
  private startBtn: HTMLButtonElement | null = null;
  private off: (() => void) | null = null;
  private trackIndex = 0;

  constructor(
    private app: App,
    private room: OnlineRoom,
  ) {
    this.showroom.kartMode = true;
  }

  enter() {
    audio.playMusic('select');
    const r = this.room;
    this.trackIndex = Math.max(0, CIRCUITS.findIndex((c) => c.id === r.trackId));
    this.list = h('div', { class: 'room-players' });
    this.trackEl = h('div', { class: 'room-track' });
    const url = inviteUrl(r.code);
    const quit = h('button', { class: 'btn' }, 'QUITTER');
    quit.addEventListener('click', () => this.quit());
    const change = h('button', { class: 'btn' }, 'CHANGER DE PILOTE');
    change.addEventListener('click', () => (audio.sfx('confirm'), goSelect('online')));
    const actions = h('div', { class: 'room-actions' });
    if (r.host) {
      this.startBtn = h('button', { class: 'btn primary' }, 'LANCER LA COURSE');
      this.startBtn.addEventListener('click', () => this.start());
      actions.append(this.startBtn);
    }
    actions.append(change, quit);
    this.root = h(
      'div',
      { class: 'screen dim online-room' },
      h('div', { class: 'h1' }, r.host ? 'TA PARTIE EN LIGNE' : 'PARTIE EN LIGNE'),
      r.host ? h('div', { class: 'title-hint' }, 'Envoie ce lien à tes potes et garde cette page ouverte :') : null,
      shareBox(url),
      h('div', { class: 'room-body' }, this.list, this.trackEl),
      actions,
    );
    uiRoot().append(this.root);
    this.off = r.subscribe(() => this.refresh());
    this.refresh();
  }

  exit() {
    this.off?.();
    this.showroom.dispose();
  }

  private quit() {
    audio.sfx('cancel');
    leaveRoom();
    goMenu();
  }

  private start() {
    if (!this.room.host || this.room.racing) return;
    audio.sfx('confirm');
    this.room.startRace();
  }

  private moveTrack(d: number) {
    if (!this.room.host || this.room.racing) return;
    this.trackIndex = (this.trackIndex + d + CIRCUITS.length) % CIRCUITS.length;
    audio.sfx('cursor');
    this.room.setTrack(CIRCUITS[this.trackIndex].id);
  }

  private refresh() {
    const r = this.room;
    const order = r.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.points - a.p.points);
    this.list.replaceChildren(
      h('div', { class: 'room-head' }, `JOUEURS ${r.players.filter((p) => p.online).length}/8`),
      ...order.map(({ p, i }) => {
        const ph = h('div', { class: 'ph' });
        void loadFace(p.def).then((f) => (ph.style.backgroundImage = `url(${f.portraitUrl})`));
        return h(
          'div',
          { class: 'room-player' + (i === r.you ? ' me' : '') + (p.online ? '' : ' off') },
          ph,
          h('div', { class: 'who' }, h('b', null, p.name), h('small', null, i === 0 ? 'HÔTE' : p.online ? p.def.name : 'DÉCONNECTÉ')),
          h('div', { class: 'pts' }, `${p.points} PTS`),
        );
      }),
    );
    const t = CIRCUITS.find((c) => c.id === r.trackId) ?? CIRCUITS[0];
    this.trackIndex = CIRCUITS.indexOf(t);
    const prev = h('button', { class: 'btn' }, '◀');
    const next = h('button', { class: 'btn' }, '▶');
    prev.addEventListener('click', () => this.moveTrack(-1));
    next.addEventListener('click', () => this.moveTrack(1));
    this.trackEl.replaceChildren(
      h('div', { class: 'room-head' }, 'CIRCUIT'),
      h('div', { class: 'track-card sel' }, trackPreview(t), h('b', null, t.name), t.subtitle),
      r.host ? h('div', { class: 'room-pick' }, prev, next) : h('div', { class: 'status blink' }, r.racing ? 'Course en cours…' : 'L’hôte choisit le circuit…'),
    );
    if (this.startBtn) {
      this.startBtn.disabled = r.racing;
      this.startBtn.textContent = r.racing ? 'COURSE EN COURS…' : 'LANCER LA COURSE';
    }
    void this.showroom.show(0, r.players[r.you]?.def ?? null);
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (document.activeElement?.matches('input')) continue;
      if (e.action === 'left') this.moveTrack(-1);
      else if (e.action === 'right') this.moveTrack(1);
      else if (e.action === 'confirm' || e.action === 'start') this.start();
      else if (e.action === 'back') this.quit();
    }
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}

/** Share field: the link + COPIER (+ PARTAGER on phones). */
function shareBox(url: string): HTMLElement {
  const field = h('input', { value: url, readOnly: true });
  const copy = h('button', { class: 'btn primary' }, 'COPIER LE LIEN');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      field.select();
      document.execCommand?.('copy');
    }
    copy.textContent = 'COPIÉ !';
    audio.sfx('confirm');
  });
  const share = h('button', { class: 'btn' }, 'PARTAGER');
  share.addEventListener('click', () => {
    void navigator.share?.({ title: 'BBL KART', text: 'Viens faire la course sur BBL KART !', url }).catch(() => undefined);
  });
  return h('div', { class: 'share' }, field, copy, typeof navigator.share === 'function' ? share : null);
}
