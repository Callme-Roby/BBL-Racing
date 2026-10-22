import * as THREE from 'three';
import type { NetLink, NetMsg } from '../net/peer';
import { KartAI } from '../race/ai';
import type { KartEvent } from '../race/kart';
import type { Race } from '../race/race';

/**
 * Online race, by "snapshot interpolation" (no rollback: a kart race forgives a little lag):
 *  - every browser simulates ITS OWN kart and sends its state 20 times a second on the fast
 *    unordered channel (a lost packet is replaced by the next one);
 *  - the other karts are shown where they were ~110 ms ago, smoothly interpolated between two
 *    states (slightly extrapolated when a packet is late);
 *  - the host runs the CPU drivers and arbitrates everything shared: item boxes, roulette, the
 *    objects on the track and who they hit, positions and the final order. It sends the world
 *    (every kart + the items) to the guests, and to each guest what happens to their kart.
 */

const DELAY = 110;
const SEND_EVERY = 3; // ticks (60 Hz / 3 = 20 Hz)

interface Snap {
  t: number;
  s: number[];
}

/** events of a guest's kart that the host forwards to its owner (sounds, effects to apply) */
const FORWARD = new Set(['itemHit', 'itemBlock', 'itemBox', 'itemGot', 'itemUse']);

export class NetRace {
  private buf = new Map<number, Snap[]>();
  private unsubs: (() => void)[] = [];
  private doneSent = false;
  private tmpP = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  /** host: guest link of each kart */
  private links = new Map<number, NetLink>();
  /** called when the host is gone (guests) */
  onLost: ((reason: string) => void) | null = null;

  constructor(
    private race: Race,
    /** my kart */
    private me: number,
    private host: boolean,
    links: { kart: number; link: NetLink }[],
  ) {
    race.remote = (i) => this.drive(i);
    if (host) {
      for (const { kart, link } of links) {
        this.links.set(kart, link);
        this.unsubs.push(link.on((m) => this.onGuestMsg(kart, m)));
        this.unsubs.push(link.onClose(() => this.dropGuest(kart)));
      }
    } else {
      const link = links[0].link;
      this.links.set(-1, link);
      this.unsubs.push(link.on((m) => this.onHostMsg(m)));
      this.unsubs.push(link.onClose((r) => this.onLost?.(r)));
      if (race.items) race.items.authority = false;
    }
  }

  private push(kart: number, s: number[]) {
    let b = this.buf.get(kart);
    if (!b) this.buf.set(kart, (b = []));
    b.push({ t: performance.now(), s });
    if (b.length > 30) b.shift();
  }

  /** a remote kart for this tick: interpolated ~DELAY ms in the past */
  private drive(i: number) {
    const b = this.buf.get(i);
    const k = this.race.karts[i];
    if (!b || !b.length) return;
    const rt = performance.now() - DELAY;
    let a = b[0];
    let c = b[b.length - 1];
    for (let j = 0; j < b.length - 1; j++) {
      if (b[j].t <= rt && b[j + 1].t >= rt) {
        a = b[j];
        c = b[j + 1];
        break;
      }
    }
    let f: number;
    if (rt >= c.t) {
      // late packet: extrapolate a little from the last two
      const p = b[b.length - 2] ?? c;
      a = p;
      f = c.t > p.t ? 1 + Math.min(0.5, (rt - c.t) / (c.t - p.t)) : 1;
    } else f = c.t > a.t ? Math.max(0, (rt - a.t) / (c.t - a.t)) : 1;
    const s0 = a.s;
    const s1 = c.s;
    this.tmpP.set(s0[0] + (s1[0] - s0[0]) * f, s0[1] + (s1[1] - s0[1]) * f, s0[2] + (s1[2] - s0[2]) * f);
    this.tmpQ.set(s0[3], s0[4], s0[5], s0[6]);
    this.tmpQ2.set(s1[3], s1[4], s1[5], s1[6]);
    this.tmpQ.slerp(this.tmpQ2, Math.min(1, f)).normalize();
    k.applyNet(s1, this.tmpP, this.tmpQ);
    // crossed the line on its own browser
    if (s1[23] === 1 && !k.finished) this.race.remoteFinish(i, s1[24]);
  }

  // ---------------------------------------------------------------- host

  private onGuestMsg(kart: number, m: NetMsg) {
    if (m.t === 'k') this.push(kart, m.s);
    else if (m.t === 'use') this.race.items?.remoteUse(kart, m.aim);
  }

  /** a guest left in the middle of the race: the CPU takes the wheel */
  private dropGuest(kart: number) {
    const r = this.race.setup.racers[kart];
    if (!r.remote) return;
    r.remote = false;
    (this.race.ais as (KartAI | null)[])[kart] = new KartAI(this.race.karts[kart], 'normal', kart);
    this.race.karts[kart].cpu = true;
  }

  // ---------------------------------------------------------------- guest

  private onHostMsg(m: NetMsg) {
    const race = this.race;
    if (m.t === 'w') {
      m.k.forEach((s, i) => {
        if (i !== this.me) this.push(i, s);
      });
      race.items?.importState(m, this.me);
    } else if (m.t === 'fx') this.applyFx(m.ev as unknown as KartEvent);
    else if (m.t === 'done') {
      m.order.forEach((ki, n) => {
        if (!race.karts[ki].finished) race.remoteFinish(ki, m.times[n] ?? race.time);
      });
      race.forcedOrder = m.order;
    }
  }

  /** what the host says happened to my kart */
  private applyFx(ev: KartEvent) {
    const k = this.race.karts[this.me];
    const items = this.race.items;
    if (ev.k === 'itemHit') {
      const it = ev.item;
      k.spinOut(it === 'web' ? 1.5 : it === 'grenade' || it === 'mic' ? 1.6 : it === 'config' ? 0.8 : 1.1);
      if (it === 'web') k.speed *= 0.3;
      if (it === 'config') k.squashT = 3;
    } else if (ev.k === 'itemUse') {
      // my own item, executed by the host: its effect on my kart happens here
      if (ev.item === 'turbo' || ev.item === 'turbo3') k.addBoost('item', 1.15, 1.3);
      else if (ev.item === 'sayan') {
        k.starT = 7;
        k.addBoost('item', 0.8, 1.1);
      } else if (ev.item === 'bazooka' && items) items.rocket[this.me] = 4.5;
    }
    k.events.push(ev);
  }

  // ---------------------------------------------------------------- every tick

  /** call after each race tick */
  afterTick() {
    const race = this.race;
    const me = race.karts[this.me];
    if (this.host) {
      // what happened to the guests' karts: tell them
      for (const { kart, ev } of race.events) {
        const link = this.links.get(kart);
        if (link && race.setup.racers[kart].remote && FORWARD.has(ev.k)) link.send({ t: 'fx', ev: ev as unknown as { k: string } });
      }
      if (race.ticks % SEND_EVERY === 0) {
        const w = { t: 'w' as const, tick: race.ticks, k: race.karts.map((k) => k.netState()), ...(race.items?.exportState() ?? { o: [], b: [], h: [] }) };
        for (const l of this.links.values()) l.sendFast(w);
      }
      if (race.phase === 'done' && !this.doneSent) {
        this.doneSent = true;
        const order = race.finalOrder();
        const msg: NetMsg = { t: 'done', order, times: order.map((i) => (race.karts[i].finished ? race.karts[i].finishTime : race.time + 5)) };
        for (const l of this.links.values()) l.send(msg);
      }
    } else {
      const link = this.links.get(-1)!;
      if (race.ticks % SEND_EVERY === 0) link.sendFast({ t: 'k', s: me.netState() });
      const h = race.items?.holds[this.me];
      if (me.itemPressed && h?.item && h.roll <= 0 && race.phase === 'race') link.send({ t: 'use', aim: me.input.aim });
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.race.remote = null;
  }
}
