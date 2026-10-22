import * as THREE from 'three';
import type { Difficulty } from '../game/settings';
import { kartStatsOf } from '../data/kartStats';
import type { FighterDef } from '../data/roster';
import { NO_INPUT, type KartInput } from '../input/input';
import { KartAI } from './ai';
import { ItemSystem } from './items';
import { DT, Kart, type KartEvent } from './kart';
import { Track, type TrackDef } from './track';

/**
 * One race: the karts on a track, the start (intro → countdown → GO), the rules between
 * karts (bumps, slipstream, anti-gravity spin boosts), positions, laps and the finish.
 * Items live in items.ts and plug in through `items`.
 *
 * Runs at a fixed 60 Hz (`tick`); the screen interpolates the views between two ticks.
 */

export interface RacerSetup {
  def: FighterDef;
  /** human on this machine (local player index), or a CPU / remote driver */
  local?: number;
  /** driven by another browser (online): its state comes from the network */
  remote?: boolean;
  /** shown name (online / split screen) */
  name?: string;
}

export interface RaceSetup {
  track: TrackDef;
  racers: RacerSetup[];
  laps: number;
  cc: number;
  difficulty: Difficulty;
  items: boolean;
  /** time trial: no CPU, no items, a ghost of the best lap */
  timeTrial?: boolean;
  seed: number;
}

export type RacePhase = 'intro' | 'countdown' | 'race' | 'done';

/** what a race extension (items) plugs in */
export interface RaceSystem {
  tick(race: Race): void;
  /** a kart's item button was pressed / is held this tick */
  onKart?(race: Race, k: Kart): void;
}

export class Race {
  readonly track: Track;
  readonly karts: Kart[];
  readonly ais: (KartAI | null)[];
  phase: RacePhase = 'intro';
  /** ticks since the phase started */
  phaseTicks = 0;
  /** race clock (s since GO) */
  time = 0;
  /** ticks since the race was created */
  ticks = 0;
  readonly laps: number;
  /** kart indices in finishing order */
  readonly finishOrder: number[] = [];
  /** karts sorted by position (index 0 = leader) */
  order: number[] = [];
  /** events of the last tick (kart index, event) */
  readonly events: { kart: number; ev: KartEvent }[] = [];
  readonly systems: RaceSystem[] = [];
  /** countdown length (ticks): 3, 2, 1, GO */
  static readonly COUNT = 3 * 60;
  /** length of the intro fly-over (ticks); the screen can skip it */
  introTicks = 0;

  constructor(readonly setup: RaceSetup) {
    this.track = new Track(setup.track);
    this.laps = setup.laps;
    this.karts = setup.racers.map((r, i) => {
      const k = new Kart(i, r.def, kartStatsOf(r.def), setup.cc, this.track);
      const slot = this.track.gridSlot(i);
      k.place(slot.pos, slot.fwd, slot.up);
      k.cpu = r.local === undefined;
      return k;
    });
    this.ais = setup.racers.map((r, i) => (r.local === undefined && !r.remote ? new KartAI(this.karts[i], setup.difficulty, setup.seed + i * 7) : null));
    this.order = this.karts.map((_, i) => i);
    this.updateOrder();
    if (setup.items || setup.timeTrial) {
      this.items = new ItemSystem(this);
      this.systems.push(this.items);
    }
  }

  /** the items (null in time trials / items off) */
  items: ItemSystem | null = null;

  get countdown(): number {
    return this.phase === 'countdown' ? Math.max(0, Race.COUNT - this.phaseTicks) / 60 : 0;
  }

  startCountdown() {
    if (this.phase === 'intro') {
      this.phase = 'countdown';
      this.phaseTicks = 0;
    }
  }

  /**
   * One fixed step. `inputs[i]` = input of kart i when it is driven on this machine
   * (humans); CPU karts think for themselves, remote karts are moved by the network.
   */
  tick(inputs: (KartInput | null)[]) {
    this.events.length = 0;
    this.ticks++;
    this.phaseTicks++;
    if (this.phase === 'intro' && this.phaseTicks >= this.introTicks) this.startCountdown();
    if (this.phase === 'countdown' && this.phaseTicks >= Race.COUNT) {
      this.phase = 'race';
      this.phaseTicks = 0;
      for (const k of this.karts) k.launch();
    }
    const racing = this.phase === 'race' || this.phase === 'done';
    if (racing) this.time += DT;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      const r = this.setup.racers[i];
      if (r.remote) {
        this.remote?.(i);
        continue;
      }
      let inp: KartInput = inputs[i] ?? NO_INPUT;
      const ai = this.ais[i];
      if (ai) inp = this.phase === 'countdown' ? { ...NO_INPUT, accel: this.phaseTicks > Race.COUNT - 50 + (i % 4) * 4 } : ai.think(this.track, this.time);
      // finished humans are driven by the CPU (victory lap)
      if (k.finished && !ai) inp = this.autopilot(i);
      k.step(inp, racing, this.time);
    }
    if (racing) {
      this.bumps();
      this.slipstream();
      for (const s of this.systems) s.tick(this);
      this.rubberBand();
    }
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      for (const ev of k.events) {
        this.events.push({ kart: i, ev });
        if (ev.k === 'lap' && ev.lap > this.laps && !k.finished) this.finish(i);
      }
      k.events.length = 0;
    }
    this.updateOrder();
    if (this.phase === 'race' && this.allHumansDone()) {
      this.phase = 'done';
      this.phaseTicks = 0;
    }
  }

  /** online: moves the remote karts each tick (NetRace) */
  remote: ((i: number) => void) | null = null;
  /** online guests: the order decided by the host */
  forcedOrder: number[] | null = null;

  /** online: a remote kart crossed the line on its own browser */
  remoteFinish(i: number, time: number) {
    const k = this.karts[i];
    if (k.finished) return;
    k.finished = true;
    k.finishTime = time;
    this.finishOrder.push(i);
    this.events.push({ kart: i, ev: { k: 'finish' } });
  }

  /** tests: everybody crosses the line now, in the current order */
  debugFinish() {
    for (const i of this.order) if (!this.karts[i].finished) this.finish(i);
    this.phase = 'done';
    this.phaseTicks = 0;
  }

  private autopilotAIs = new Map<number, KartAI>();
  private autopilot(i: number): KartInput {
    let ai = this.autopilotAIs.get(i);
    if (!ai) {
      ai = new KartAI(this.karts[i], 'normal', i);
      this.autopilotAIs.set(i, ai);
    }
    const inp = ai.think(this.track, this.time);
    inp.drift = false;
    return inp;
  }

  private finish(i: number) {
    const k = this.karts[i];
    k.finished = true;
    k.finishTime = this.time;
    this.finishOrder.push(i);
    k.events.length = 0;
    this.events.push({ kart: i, ev: { k: 'finish' } });
  }

  /** every human (local or remote) has crossed the line */
  allHumansDone(): boolean {
    let any = false;
    for (let i = 0; i < this.karts.length; i++) {
      const r = this.setup.racers[i];
      if (r.local === undefined && !r.remote) continue;
      any = true;
      if (!this.karts[i].finished) return false;
    }
    return any || this.finishOrder.length === this.karts.length;
  }

  /** finishing position of the CPUs still racing when the humans are done: by progress */
  finalOrder(): number[] {
    if (this.forcedOrder) return this.forcedOrder;
    const rest = this.order.filter((i) => !this.karts[i].finished);
    return [...this.finishOrder, ...rest];
  }

  private updateOrder() {
    const ks = this.karts;
    this.order.sort((a, b) => {
      const ka = ks[a];
      const kb = ks[b];
      if (ka.finished !== kb.finished) return ka.finished ? -1 : 1;
      if (ka.finished && kb.finished) return this.finishOrder.indexOf(a) - this.finishOrder.indexOf(b);
      return kb.progress - ka.progress;
    });
    this.order.forEach((k, pos) => (ks[k].rank = pos));
  }

  /** kart vs kart: push apart by weight; anti-gravity bumps give both a spin boost */
  private bumps() {
    const ks = this.karts;
    const n = new THREE.Vector3();
    for (let a = 0; a < ks.length; a++) {
      const A = ks[a];
      if (A.rescueT > 0) continue;
      for (let b = a + 1; b < ks.length; b++) {
        const B = ks[b];
        if (B.rescueT > 0) continue;
        n.subVectors(B.pos, A.pos);
        const d2 = n.lengthSq();
        const R = 1.5;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        n.divideScalar(d);
        // only in the road plane
        n.addScaledVector(A.up, -n.dot(A.up));
        if (n.lengthSq() < 1e-6) continue;
        n.normalize();
        const pen = R - d;
        const ma = A.params.mass * (A.starT > 0 ? 6 : 1);
        const mb = B.params.mass * (B.starT > 0 ? 6 : 1);
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        A.pos.addScaledVector(n, -pen * wa);
        B.pos.addScaledVector(n, pen * wb);
        // relative speed along the normal
        const rel = B.vel.clone().sub(A.vel).dot(n);
        const strength = Math.min(1, Math.abs(rel) / 10 + 0.2);
        const kick = 2.2 + Math.abs(rel) * 0.4;
        A.lat += -kick * wa * n.dot(A.right) * 2;
        B.lat += kick * wb * n.dot(B.right) * 2;
        // a heavier kart barely slows down, a light one loses speed
        if (rel < -1) {
          A.speed *= 1 - 0.08 * wa;
          B.speed *= 1 - 0.08 * wb;
        }
        A.events.push({ k: 'bump', other: b, strength });
        B.events.push({ k: 'bump', other: a, strength });
        if (A.starT > 0 && B.starT <= 0) B.spinOut(1.2);
        if (B.starT > 0 && A.starT <= 0) A.spinOut(1.2);
        // anti-gravity: bumping is a boost for both
        if (A.loc.antigrav && B.loc.antigrav) {
          if (A.boostKind !== 'bump') A.addBoost('bump', 0.6, 0.75);
          if (B.boostKind !== 'bump') B.addBoost('bump', 0.6, 0.75);
        }
      }
    }
  }

  /** being right behind another kart charges a slipstream boost */
  private slipstream() {
    const ks = this.karts;
    const to = new THREE.Vector3();
    for (const A of ks) {
      if (!A.grounded || A.speed < 12 || A.boostT > 0) {
        A.slipT = Math.max(0, A.slipT - DT * 2);
        continue;
      }
      let behind = false;
      for (const B of ks) {
        if (B === A || B.speed < 9) continue;
        to.subVectors(B.pos, A.pos);
        const d = to.length();
        if (d < 2.5 || d > 15) continue;
        if (to.dot(A.fwd) / d > 0.975 && B.fwd.dot(A.fwd) > 0.85) {
          behind = true;
          break;
        }
      }
      if (behind) {
        A.slipT += DT;
        if (A.slipT >= 1.35) {
          A.addBoost('slip', 1.0, 0.8);
          A.slipT = 0;
        }
      } else A.slipT = Math.max(0, A.slipT - DT * 1.5);
    }
  }

  /** gentle catch-up: CPUs far behind the best human go a little faster, far ahead a little slower */
  private rubberBand() {
    let best = -1e9;
    for (let i = 0; i < this.karts.length; i++) {
      const r = this.setup.racers[i];
      if (r.local !== undefined || r.remote) best = Math.max(best, this.karts[i].progress);
    }
    if (best < -1e8) return;
    for (let i = 0; i < this.karts.length; i++) {
      const ai = this.ais[i];
      if (!ai) continue;
      const k = this.karts[i];
      const gap = (k.progress - best) / 100;
      const lvl = ai.level.speed;
      ai.speedScale = lvl * (1 - Math.max(-0.1, Math.min(0.08, gap * 0.05)));
      // scale the CPU's top speed (params are per kart: adjust the live value)
      (k.params as { top: number }).top = this.baseTop(k) * ai.speedScale;
    }
  }

  private baseTops = new Map<Kart, number>();
  private baseTop(k: Kart) {
    let t = this.baseTops.get(k);
    if (t === undefined) {
      t = k.params.top;
      this.baseTops.set(k, t);
    }
    return t;
  }
}
