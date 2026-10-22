// PeerJS (+ its WebRTC shims) is only downloaded when a game goes online
import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import type { FighterDef } from '../data/roster';
type Tournament = unknown;

/**
 * Peer-to-peer link between two browsers (WebRTC data channel via PeerJS).
 * The free public PeerJS broker is only used for the initial handshake; the
 * game traffic then goes directly between the two players.
 *
 * Two channels share the connection: PeerJS's reliable ordered one for
 * everything, plus a lossy unordered one for the fight inputs and pings (a lost
 * packet must not hold back the ones behind it: the rollback session repeats the
 * unacknowledged inputs in every packet anyway).
 */

/** bump when the messages or the simulation change (both browsers must run the same game) */
export const NET_VERSION = 'bbl-6';
const ID_PREFIX = 'bblkart-';
/** online tournaments: the organiser's peer id is ID_PREFIX + TN_TAG + code */
const TN_TAG = 't';

/** A participant as seen in the online tournament lobby. */
export interface TnEntry {
  name: string;
  cpu: boolean;
  /** chosen fighter (a built-in roster id, or a full custom definition) */
  fighterId: string;
  def?: FighterDef;
  /** chosen assist (a built-in roster id; '' = « HASARD »: drawn from the tournament seed at the start) */
  assistId: string;
  /** connected right now (CPU entries are always "online") */
  online: boolean;
}

/** Everything needed to play / watch one tournament match (identical on every browser). */
export interface TnMatch {
  /** unique per attempt: "round.match.replays" */
  key: string;
  r: number;
  m: number;
  /** participant indices (left / right) */
  a: number;
  b: number;
  p1: FighterDef;
  p2: FighterDef;
  /** each side's assist (every browser creates the game with these) */
  assists: [FighterDef | null, FighterDef | null];
  stageId: string;
  rounds: number;
  difficulty: 'easy' | 'normal' | 'hard';
  seed: number;
  title: string;
  names: [string, string];
  cpu: [boolean, boolean];
  /** participant index of the browser that runs the fight and streams it (-1 = the organiser, CPU vs CPU) */
  runner: number;
}

export type NetMsg =
  | { t: 'hello'; version: string; name: string }
  /** fighter select: my fighter (cursor or locked), then my assist (cursor or locked) */
  | { t: 'pick'; def: FighterDef | null; locked: boolean; cursor: number; assist: FighterDef | null; assistLocked: boolean; assistCursor: number }
  | { t: 'stage'; id: string; locked: boolean }
  /** host → guest: the fight starts (a1 / a2 = assists of P1 / P2, the same on both browsers) */
  | { t: 'start'; stage: string; p1: FighterDef; p2: FighterDef; a1: FighterDef | null; a2: FighterDef | null; seed: number; rounds: number }
  /** inputs of frames f.. (b), frame advantage, a = last of your frames I have (contiguous), d = my input delay */
  | { t: 'in'; f: number; b: number[]; adv: number; a: number; d: number }
  | { t: 'sum'; f: number; h: number }
  | { t: 'ready' }
  | { t: 'rematch' }
  | { t: 'toSelect' }
  | { t: 'leave' }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  // ---- online tournament (organiser = hub, everybody else connects to it)
  /** guest → organiser: who I am (`token` lets a refreshed page get its slot back) */
  | { t: 'tnHello'; version: string; name: string; token: string }
  /** organiser → guest: refused (wrong version, full…) */
  | { t: 'tnError'; reason: string }
  /** organiser → guest: lobby / tournament state. `you` = participant index of the receiver (-1 = spectator) */
  | { t: 'tnLobby'; entries: TnEntry[]; you: number; started: boolean }
  /** guest → organiser: name / fighter / assist choice (assistId '' = « HASARD ») */
  | { t: 'tnMe'; name: string; fighterId: string; def?: FighterDef; assistId?: string }
  /** organiser → all: the bracket (after the start) */
  | { t: 'tnState'; tour: Tournament; live: TnMatch | null; flash: string }
  /** organiser → all: a match starts (its two players fight, the others watch) */
  | { t: 'tnMatch'; match: TnMatch }
  /** left player → organiser → right player: code of the room of their online fight */
  | { t: 'tnRoom'; key: string; code: string }
  /** runner → organiser → spectators: final inputs from frame f (pairs p1, p2 flattened) */
  | { t: 'tnTv'; key: string; f: number; b: number[] }
  /** runner → organiser: match result (2 = draw) */
  | { t: 'tnResult'; key: string; w: 0 | 1 | 2 }
  /** player → organiser: the match could not be played (disconnection...) */
  | { t: 'tnAbort'; key: string; reason: string }
  /** organiser → all: the tournament is over / cancelled */
  | { t: 'tnEnd'; reason: string };

export type NetListener = (m: NetMsg) => void;

/** A connection that failed, with a message for the players. */
export class NetError extends Error {
  constructor(
    readonly kind: 'notFound' | 'blocked' | 'broker' | 'browser',
    message: string,
  ) {
    super(message);
  }
}

const MSG_BROKER = 'Le serveur de mise en relation ne répond pas : vérifie ta connexion internet et réessaie.';
const MSG_BROWSER =
  "Ce navigateur ne gère pas le jeu en ligne : ouvre le lien dans Chrome, Safari ou Firefox (pas dans le navigateur intégré d'une appli).";
const MSG_BLOCKED =
  'Vos deux réseaux bloquent la connexion directe (fréquent en 4G ou sur un wifi de travail / d’école). Réessayez en wifi à la maison, ou au moins l’un des deux en wifi.';
const msgNotFound = (tournament: boolean) =>
  tournament
    ? "Tournoi introuvable. L'organisateur doit avoir la page du jeu affichée (pas WhatsApp devant) : réessaie dès qu'il y est revenu."
    : 'Partie introuvable. Ton pote doit avoir la page du jeu affichée (pas WhatsApp devant) : réessaie dès qu’il y est revenu.';

/** PeerJS error type of an error event */
const errType = (e: unknown) => String((e as { type?: string })?.type ?? '');
/** errors of the broker connection only (it reconnects by itself, see keepRegistered) */
const TRANSIENT = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function randomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (const v of arr) s += chars[v % chars.length];
  return s;
}

/** SCTP stream id of the inputs channel (negotiated: both sides create it, no handshake) */
const FAST_CHANNEL_ID = 42;

export class NetLink {
  private listeners = new Set<NetListener>();
  private closeListeners = new Set<(reason: string) => void>();
  private conn: DataConnection | null = null;
  private closed = false;
  /** lossy unordered channel (inputs, pings) */
  private fast: RTCDataChannel | null = null;
  /** something arrived on `fast`: the other side has it too (until then the reliable channel carries a copy) */
  private fastOk = false;
  /** smoothed round-trip time in ms */
  rtt = 0;
  /** last round-trip times (ms) */
  private rttSamples: number[] = [];
  private pingTimer = 0;

  private constructor(
    private peer: Peer,
    readonly code: string,
    readonly isHost: boolean,
    /** false for the links of a hub: closing one must not destroy the shared peer */
    private ownsPeer = true,
  ) {}

  /** Wraps a connection accepted by a hub (the hub owns the peer). */
  static fromConnection(peer: Peer, c: DataConnection): NetLink {
    const link = new NetLink(peer, '', true, false);
    link.attach(c);
    return link;
  }

  /** Create a room. Resolves once the Peer is registered (the opponent connects later via `waitForGuest`). */
  static async host(onStatus?: (s: string) => void): Promise<NetLink> {
    const code = randomCode();
    onStatus?.('Connexion au serveur de mise en relation…');
    const peer = await openPeer(ID_PREFIX + code);
    return new NetLink(peer, code, true);
  }

  waitForGuest(): Promise<void> {
    return new Promise((resolve, reject) => {
      // adopted once open: a page waking up may still answer stale attempts that never open
      this.peer.on('connection', (c) => {
        c.on('open', () => {
          if (this.conn) {
            c.close();
            return;
          }
          this.attach(c);
          resolve();
        });
      });
      // a dropped broker connection comes back by itself (keepRegistered): keep waiting
      this.peer.on('error', (e) => {
        if (!TRANSIENT.has(errType(e))) reject(e);
      });
    });
  }

  /** Called when the room stops / starts being reachable through the broker (phone page put to sleep…). */
  onBroker(cb: (ok: boolean) => void) {
    watchBroker(this.peer, cb);
  }

  /**
   * Joins a room / tournament. The other page may be asleep for a moment (the
   * organiser is still in WhatsApp after sending the link): keeps trying for 90 s.
   */
  static async join(code: string, onStatus?: (s: string) => void, tournament = false): Promise<NetLink> {
    onStatus?.('Connexion au serveur de mise en relation…');
    const peer = await openPeer();
    const target = ID_PREFIX + (tournament ? TN_TAG : '') + code;
    const who = tournament ? "l'organisateur" : 'ton pote';
    const giveUp = performance.now() + 90000;
    let blocked = 0;
    let last: 'notFound' | 'blocked' | null = null;
    try {
      for (;;) {
        onStatus?.(
          last === null
            ? tournament
              ? 'Recherche du tournoi…'
              : "Recherche de l'adversaire…"
            : last === 'blocked'
              ? `${who[0].toUpperCase() + who.slice(1)} répond, mais vos réseaux n'arrivent pas à se relier… Nouvel essai…`
              : `Pas encore de réponse de ${who}… Il doit avoir la page du jeu affichée. Nouvel essai…`,
        );
        const r = await connectOnce(peer, target);
        if (typeof r !== 'string') {
          const link = new NetLink(peer, code, false);
          link.attach(r);
          return link;
        }
        last = r;
        if (r === 'blocked' && ++blocked >= 2) throw new NetError('blocked', MSG_BLOCKED);
        if (performance.now() > giveUp) throw blocked ? new NetError('blocked', MSG_BLOCKED) : new NetError('notFound', msgNotFound(tournament));
        await sleep(3000);
      }
    } catch (e) {
      peer.destroy();
      throw e;
    }
  }

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('data', (d) => this.receive(d as NetMsg));
    c.on('close', () => this.handleClose("L'adversaire s'est déconnecté."));
    c.on('error', () => this.handleClose('Erreur de connexion.'));
    const ping = () => this.sendFast({ t: 'ping', ts: performance.now() });
    const opened = () => {
      this.openFast(c);
      // first ping right away: the input delay of a fight is chosen from the ping
      ping();
    };
    if (c.open) opened();
    else c.on('open', opened);
    this.pingTimer = window.setInterval(ping, 1000);
  }

  private receive(m: NetMsg) {
    if (m.t === 'ping') {
      this.sendFast({ t: 'pong', ts: m.ts });
      return;
    }
    if (m.t === 'pong') {
      const r = performance.now() - m.ts;
      this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
      this.rttSamples.push(r);
      if (this.rttSamples.length > 9) this.rttSamples.shift();
      return;
    }
    // snapshot: a listener may (un)subscribe others while handling the message
    for (const l of [...this.listeners]) l(m);
  }

  /** Inputs channel on the same WebRTC connection (unordered, never re-sent). */
  private openFast(c: DataConnection) {
    if (this.fast) return;
    try {
      const pc = c.peerConnection;
      if (!pc) return;
      const dc = pc.createDataChannel('bbl-in', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      dc.onmessage = (e) => {
        this.fastOk = true;
        try {
          this.receive(JSON.parse(e.data as string) as NetMsg);
        } catch {
          /* ignore */
        }
      };
      dc.onclose = () => {
        if (this.fast === dc) {
          this.fast = null;
          this.fastOk = false;
        }
      };
      this.fast = dc;
    } catch {
      // not supported: everything goes through the reliable channel
      this.fast = null;
    }
  }

  private handleClose(reason: string) {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    for (const l of [...this.closeListeners]) l(reason);
  }

  /**
   * Typical round-trip time (median of the last pings, ms; 0 = unknown): a page
   * busy loading a fight answers late, a single slow pong must not raise the input delay.
   */
  get rttTypical(): number {
    const s = [...this.rttSamples].sort((a, b) => a - b);
    return s.length ? s[(s.length - 1) >> 1] : 0;
  }

  get connected() {
    return !!this.conn && this.conn.open && !this.closed;
  }

  send(m: NetMsg) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(m);
      } catch (e) {
        console.warn('send failed', e);
      }
    }
  }

  /**
   * Lossy, unordered send (fight inputs, pings): may be lost or overtaken.
   * Until the other side has proven it listens on that channel, a copy also
   * goes through the reliable one.
   */
  sendFast(m: NetMsg) {
    if (this.closed) return;
    const dc = this.fast;
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify(m));
      } catch {
        /* buffer full or closing: the next packet repeats the inputs */
      }
      if (this.fastOk) return;
    }
    this.send(m);
  }

  on(l: NetListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onClose(l: (reason: string) => void): () => void {
    this.closeListeners.add(l);
    return () => this.closeListeners.delete(l);
  }

  close() {
    if (!this.closed) this.send({ t: 'leave' });
    this.closed = true;
    window.clearInterval(this.pingTimer);
    setTimeout(() => {
      try {
        this.fast?.close();
        this.conn?.close();
        if (this.ownsPeer) this.peer.destroy();
      } catch {
        /* ignore */
      }
    }, 100);
  }
}

/**
 * Online tournament organiser: one peer that accepts every participant's
 * connection (star network). Each guest gets its own NetLink.
 */
export class NetHub {
  private closed = false;
  private constructor(
    private peer: Peer,
    readonly code: string,
  ) {}

  static async host(onStatus?: (s: string) => void): Promise<NetHub> {
    const code = randomCode();
    onStatus?.('Connexion au serveur de mise en relation…');
    const peer = await openPeer(ID_PREFIX + TN_TAG + code);
    return new NetHub(peer, code);
  }

  /** Called for every guest once its connection is open. */
  onGuest(cb: (link: NetLink) => void) {
    this.peer.on('connection', (c) => {
      if (this.closed) {
        c.close();
        return;
      }
      // a link only for connections that open (a page waking up may answer stale attempts)
      c.on('open', () => {
        if (!this.closed) cb(NetLink.fromConnection(this.peer, c));
      });
    });
  }

  /** The broker connection dropped (guests already connected stay connected). */
  onError(cb: (e: unknown) => void) {
    this.peer.on('error', cb);
  }

  /** Called when new guests can / can't reach the tournament any more (phone page put to sleep…). */
  onBroker(cb: (ok: boolean) => void) {
    watchBroker(this.peer, cb);
  }

  close() {
    this.closed = true;
    setTimeout(() => {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }, 300);
  }
}

/**
 * By default the free public PeerJS cloud broker is used. To use your own
 * (e.g. `npx peerjs --port 9000`), set VITE_PEER_HOST / VITE_PEER_PORT /
 * VITE_PEER_PATH / VITE_PEER_SECURE at build time (Vercel: Environment Variables).
 */
function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const opts: PeerOptions = { debug: 1, config: { iceServers: iceServers() } };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return opts;
}

/**
 * STUN (find each other's public address) + TURN relays (when the networks don't
 * allow a direct link, e.g. some 4G). PeerJS's free relays are kept; a dedicated
 * one can be added at build time: VITE_TURN_URLS (comma separated),
 * VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL.
 */
function iceServers(): RTCIceServer[] {
  const env = import.meta.env;
  const list: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const turn = String(env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (turn.length) list.unshift({ urls: turn, username: env.VITE_TURN_USERNAME ?? '', credential: env.VITE_TURN_CREDENTIAL ?? '' });
  return list;
}

/**
 * One connection attempt: the open connection, 'notFound' (nobody answered: no
 * such room, or its page is asleep) or 'blocked' (it answered but no network path).
 */
function connectOnce(peer: Peer, target: string): Promise<DataConnection | 'notFound' | 'blocked'> {
  return new Promise((resolve, reject) => {
    const c = peer.connect(target, { reliable: true, serialization: 'json' });
    let done = false;
    const finish = (r: DataConnection | 'notFound' | 'blocked' | Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      peer.off('error', onPeerError);
      if (r === c) return resolve(c);
      try {
        c.close();
      } catch {
        /* ignore */
      }
      if (r instanceof Error) reject(r);
      else resolve(r as 'notFound' | 'blocked');
    };
    const onPeerError = (e: unknown) => {
      const t = errType(e);
      if (t === 'peer-unavailable') finish('notFound');
      else if (t === 'browser-incompatible') finish(new NetError('browser', MSG_BROWSER));
      // broker hiccups: it reconnects by itself, this attempt ends with the timeout
    };
    peer.on('error', onPeerError);
    c.on('open', () => finish(c));
    // ICE failed: the other side answered but no direct / relayed path was found
    c.on('error', (e) => finish(errType(e) === 'negotiation-failed' ? 'blocked' : 'notFound'));
    const timer = window.setTimeout(() => finish(c.peerConnection?.remoteDescription ? 'blocked' : 'notFound'), 25000);
  });
}

/**
 * Keeps a peer registered with the broker: phones put background pages to sleep
 * and the broker forgets them (nobody could join that room / tournament any
 * more). Reconnects with growing pauses, and right away when the page shows again.
 */
function keepRegistered(peer: Peer) {
  let timer = 0;
  let tries = 0;
  const retry = () => {
    window.clearTimeout(timer);
    if (peer.destroyed || !peer.disconnected) return;
    try {
      peer.reconnect();
    } catch {
      /* still closing: next try */
    }
    timer = window.setTimeout(retry, Math.min(15000, 1000 * 2 ** Math.min(tries++, 4)));
  };
  const visible = () => {
    if (document.visibilityState === 'visible' && peer.disconnected && !peer.destroyed) {
      tries = 0;
      retry();
    }
  };
  peer.on('disconnected', () => {
    tries = 0;
    timer = window.setTimeout(retry, 500);
  });
  peer.on('open', () => window.clearTimeout(timer));
  document.addEventListener('visibilitychange', visible);
  peer.on('close', () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', visible);
  });
}

/** Reports the broker registration of a peer (true = reachable). */
function watchBroker(peer: Peer, cb: (ok: boolean) => void) {
  peer.on('disconnected', () => cb(false));
  peer.on('open', () => cb(true));
}

// ---- keep the phone's screen on while a peer is open (a sleeping page drops everything)
const awakePeers = new Set<Peer>();
let wakeLock: WakeLockSentinel | null = null;
async function updateWakeLock() {
  try {
    if (awakePeers.size && document.visibilityState === 'visible') {
      if (!wakeLock || wakeLock.released) wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } else if (wakeLock) {
      const w = wakeLock;
      wakeLock = null;
      await w.release();
    }
  } catch {
    /* not supported / refused */
  }
}
document.addEventListener('visibilitychange', () => void updateWakeLock());

let peerLib: Promise<typeof import('peerjs')> | null = null;

/** Starts downloading PeerJS (e.g. when the online menu opens). */
export function preloadNet(): Promise<typeof import('peerjs')> {
  peerLib ??= import('peerjs').catch((e) => {
    peerLib = null;
    throw e;
  });
  return peerLib;
}

async function openPeer(id?: string): Promise<Peer> {
  let Peer: typeof import('peerjs').Peer;
  try {
    ({ Peer } = await preloadNet());
  } catch {
    throw new NetError('broker', 'Impossible de charger le module en ligne : vérifie ta connexion internet et réessaie.');
  }
  if (typeof RTCPeerConnection === 'undefined') throw new NetError('browser', MSG_BROWSER);
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    let opened = false;
    const fail = (e: Error) => {
      window.clearTimeout(timer);
      peer.destroy();
      reject(e);
    };
    const timer = window.setTimeout(() => fail(new NetError('broker', MSG_BROKER)), 15000);
    peer.on('open', () => {
      if (opened) return;
      opened = true;
      window.clearTimeout(timer);
      keepRegistered(peer);
      awakePeers.add(peer);
      void updateWakeLock();
      peer.on('close', () => {
        awakePeers.delete(peer);
        void updateWakeLock();
      });
      resolve(peer);
    });
    peer.on('error', (e) => {
      if (opened) return;
      const t = errType(e);
      if (t === 'browser-incompatible') fail(new NetError('browser', MSG_BROWSER));
      else if (TRANSIENT.has(t)) fail(new NetError('broker', MSG_BROKER));
      else fail(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

export function roomFromUrl(): string | null {
  const q = new URLSearchParams(location.search);
  const r = q.get('room');
  return r && /^[a-z0-9]{4,12}$/.test(r) ? r : null;
}

/** `?tournoi=<code>` invitation of an online tournament */
export function tournamentFromUrl(): string | null {
  const q = new URLSearchParams(location.search);
  const r = q.get('tournoi');
  return r && /^[a-z0-9]{4,12}$/.test(r) ? r : null;
}

export function tournamentInviteUrl(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('tournoi', code);
  return u.toString();
}

export function inviteUrl(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}
