import type { FighterDef } from '../data/roster';
import { NET_VERSION, NetError, NetHub, NetLink, type NetMsg, type NetRaceSetup, type RoomPlayer } from '../net/peer';
import { CIRCUITS } from '../race/circuits';
import type { RaceSetup, RacerSetup } from '../race/race';
import { POINTS } from './grandPrix';
import { shuffled } from './grid';
import { fullRoster, sanitizeDef, settings } from './settings';
import { ROSTER } from '../data/roster';

/**
 * An online room (the model of the online tournament of BBL FIGHTERZ): the host's page is the
 * hub, everybody else connects to it with the invitation link. The host picks the circuit and
 * starts the races; points add up race after race. A refreshed page gets its seat back (token).
 */

export const MAX_PLAYERS = 8;

function token(): string {
  try {
    let t = localStorage.getItem('bblkart.token');
    if (!t) {
      t = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('bblkart.token', t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

/** A friend's definition from the network: our copy of a built-in friend, a cleaned custom one. */
export function netDef(d: FighterDef): FighterDef {
  const builtIn = !d.custom ? ROSTER.find((r) => r.id === d.id) : undefined;
  return builtIn ?? sanitizeDef(d);
}

/** Everything a page needs to start an online race. */
export interface RaceLaunch {
  setup: RaceSetup;
  /** my kart */
  me: number;
  /** host: the link of each guest's kart */
  links: { kart: number; link: NetLink }[];
}

export class OnlineRoom {
  players: RoomPlayer[] = [];
  /** my room index */
  you = 0;
  trackId = CIRCUITS[0].id;
  racing = false;
  readonly host: boolean;
  private hub: NetHub | null = null;
  /** guest: the link to the host */
  link: NetLink | null = null;
  /** host: player index → link / token */
  private guests = new Map<number, { link: NetLink; token: string }>();
  private listeners = new Set<() => void>();
  /** a race starts (both sides) */
  onStart: ((l: RaceLaunch) => void) | null = null;
  /** guests: the host says « 3, 2, 1 » in `ms` */
  onGo: ((ms: number) => void) | null = null;
  /** guests: the host went back to the room */
  onBackToRoom: (() => void) | null = null;
  /** the room is gone (host left, refused…) */
  onClosed: ((reason: string) => void) | null = null;
  /** host: guests that loaded the current race */
  private ready = new Set<number>();
  private lastSetup: NetRaceSetup | null = null;
  private closed = false;

  private constructor(host: boolean) {
    this.host = host;
  }

  get code(): string {
    return this.hub?.code ?? this.link?.code ?? '';
  }

  static async create(def: FighterDef, onStatus: (s: string) => void): Promise<OnlineRoom> {
    const room = new OnlineRoom(true);
    room.hub = await NetHub.host(onStatus);
    room.players = [{ name: def.name, def, online: true, points: 0 }];
    room.you = 0;
    room.hub.onGuest((link) => room.acceptGuest(link));
    return room;
  }

  static async join(code: string, def: FighterDef, onStatus: (s: string) => void): Promise<OnlineRoom> {
    const room = new OnlineRoom(false);
    const link = await NetLink.join(code, onStatus, true);
    room.link = link;
    link.on((m) => room.onHostMsg(m));
    link.onClose((r) => room.close('L’hôte a quitté la partie. ' + r));
    link.send({ t: 'hello', version: NET_VERSION, name: def.name, def, token: token() });
    return room;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const l of [...this.listeners]) l();
  }

  // ---------------------------------------------------------------- host

  private acceptGuest(link: NetLink) {
    let seat = -1;
    const off = link.on((m) => {
      if (m.t === 'hello') {
        if (m.version !== NET_VERSION) {
          link.send({ t: 'refused', reason: 'Vos deux pages n’ont pas la même version du jeu : rechargez-les.' });
          setTimeout(() => link.close(), 500);
          return;
        }
        // same browser coming back: its old seat
        for (const [i, g] of this.guests) if (g.token === m.token) seat = i;
        if (seat < 0) {
          if (this.racing) {
            link.send({ t: 'refused', reason: 'Une course est en cours : réessaie dans un instant.' });
            setTimeout(() => link.close(), 500);
            return;
          }
          if (this.players.length >= MAX_PLAYERS) {
            link.send({ t: 'refused', reason: 'La partie est complète (8 joueurs).' });
            setTimeout(() => link.close(), 500);
            return;
          }
          seat = this.players.length;
          this.players.push({ name: m.name.slice(0, 16), def: netDef(m.def), online: true, points: 0 });
        } else {
          const p = this.players[seat];
          p.online = true;
          p.def = netDef(m.def);
        }
        this.guests.set(seat, { link, token: m.token });
        this.broadcastRoom();
      } else if (m.t === 'me' && seat >= 0 && !this.racing) {
        this.players[seat].def = netDef(m.def);
        this.players[seat].name = this.players[seat].def.name;
        this.broadcastRoom();
      } else if (m.t === 'ready' && seat >= 0) {
        this.ready.add(seat);
        this.checkReady();
      } else if (m.t === 'leave' && seat >= 0) {
        this.players[seat].online = false;
        this.broadcastRoom();
      }
    });
    link.onClose(() => {
      off();
      if (seat >= 0 && this.guests.get(seat)?.link === link) {
        this.players[seat].online = false;
        this.guests.delete(seat);
        this.broadcastRoom();
        this.checkReady();
      }
    });
  }

  broadcastRoom() {
    if (!this.host) return;
    for (const [i, g] of this.guests) g.link.send({ t: 'room', players: this.players, you: i, trackId: this.trackId, racing: this.racing });
    this.changed();
  }

  setTrack(id: string) {
    this.trackId = id;
    this.broadcastRoom();
  }

  setDef(def: FighterDef) {
    if (this.racing) return;
    if (this.host) {
      this.players[0].def = def;
      this.players[0].name = def.name;
      this.broadcastRoom();
    } else this.link?.send({ t: 'me', def });
  }

  /** host: start a race on the chosen circuit with everybody online */
  startRace() {
    if (!this.host || this.racing) return;
    const humans = this.players.map((p, i) => ({ p, i })).filter((x) => x.p.online);
    const seed = (Math.random() * 1e9) | 0;
    const total = Math.max(humans.length, Math.min(12, settings.racers));
    const cpus = shuffled(
      fullRoster().filter((d) => !humans.some((x) => x.p.def.id === d.id)),
      seed,
    ).slice(0, total - humans.length);
    // CPUs in front, the humans at the back (the order of the points table, the leader last)
    const order = humans.sort((a, b) => a.p.points - b.p.points);
    const racers: NetRaceSetup['racers'] = [...cpus.map((def) => ({ def, player: -1 })), ...order.map((x) => ({ def: x.p.def, player: x.i, name: x.p.name }))];
    const setup: NetRaceSetup = { trackId: this.trackId, laps: settings.laps, cc: settings.cc, items: settings.items, seed, difficulty: settings.difficulty, racers };
    this.lastSetup = setup;
    this.racing = true;
    this.ready.clear();
    this.broadcastRoom();
    for (const [i, g] of this.guests) {
      const you = racers.findIndex((r) => r.player === i);
      if (you >= 0) g.link.send({ t: 'start', setup, you });
    }
    this.launch(setup, racers.findIndex((r) => r.player === 0));
  }

  /** host: my own page loaded the race */
  hostLoaded() {
    this.ready.add(0);
    this.checkReady();
  }

  private readyTimer = 0;
  private checkReady() {
    if (!this.host || !this.racing || !this.lastSetup) return;
    const needed = this.lastSetup.racers.filter((r) => r.player >= 0 && (r.player === 0 || this.guests.has(r.player))).map((r) => r.player);
    if (!this.readyTimer)
      this.readyTimer = window.setTimeout(() => {
        // somebody is too slow (or gone): go anyway
        this.readyTimer = 0;
        this.go();
      }, 25000);
    if (needed.every((p) => this.ready.has(p))) this.go();
  }

  private goSent = false;
  private go() {
    if (this.goSent || !this.racing) return;
    this.goSent = true;
    window.clearTimeout(this.readyTimer);
    this.readyTimer = 0;
    const ms = 1200;
    for (const g of this.guests.values()) g.link.send({ t: 'go', in: ms });
    window.setTimeout(() => this.onGo?.(0), ms);
  }

  /** host: the race is over (final order of the karts) → points, back to the room */
  finishRace(order: number[]) {
    const setup = this.lastSetup;
    if (!this.host || !setup) return;
    order.forEach((ki, pos) => {
      const r = setup.racers[ki];
      if (r && r.player >= 0) this.players[r.player].points += POINTS[pos] ?? 0;
    });
    this.racing = false;
    this.goSent = false;
    for (const g of this.guests.values()) g.link.send({ t: 'toRoom' });
    this.broadcastRoom();
  }

  // ---------------------------------------------------------------- guest

  private onHostMsg(m: NetMsg) {
    if (m.t === 'room') {
      this.players = m.players.map((p) => ({ ...p, def: netDef(p.def) }));
      this.you = m.you;
      this.trackId = m.trackId;
      this.racing = m.racing;
      this.changed();
    } else if (m.t === 'refused') this.close(m.reason);
    else if (m.t === 'start') {
      this.racing = true;
      this.launch(m.setup, m.you);
    } else if (m.t === 'go') this.onGo?.(Math.max(0, m.in - (this.link?.rtt ?? 0) / 2));
    else if (m.t === 'toRoom') {
      this.racing = false;
      this.onBackToRoom?.();
    }
  }

  /** both sides: build the race of `setup` with me in kart `me` */
  private launch(ns: NetRaceSetup, me: number) {
    const track = CIRCUITS.find((c) => c.id === ns.trackId) ?? CIRCUITS[0];
    const racers: RacerSetup[] = ns.racers.map((r, i) => {
      const def = netDef(r.def);
      if (i === me) return { def, local: 0, name: r.name };
      // the host drives the CPUs, guests see them like the other humans
      if (r.player < 0 && this.host) return { def };
      return { def, remote: true, name: r.name ?? (r.player < 0 ? undefined : def.name) };
    });
    const setup: RaceSetup = { track, racers, laps: ns.laps, cc: ns.cc, difficulty: ns.difficulty, items: ns.items, seed: ns.seed };
    const links: RaceLaunch['links'] = [];
    if (this.host) ns.racers.forEach((r, ki) => {
      const g = r.player > 0 ? this.guests.get(r.player) : undefined;
      if (g) links.push({ kart: ki, link: g.link });
    });
    else if (this.link) links.push({ kart: -1, link: this.link });
    this.onStart?.({ setup, me, links });
  }

  // ---------------------------------------------------------------- end

  private close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.onClosed?.(reason);
  }

  leave() {
    this.closed = true;
    if (this.host) {
      for (const g of this.guests.values()) g.link.close();
      this.hub?.close();
    } else this.link?.close();
  }
}

export { NetError };
