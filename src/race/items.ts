import * as THREE from 'three';
import { DT, type Kart } from './kart';
import { curvatureOf } from './ai';
import { drawItem, ITEM_INFO, type ItemId } from './itemDefs';
import type { Race, RaceSystem } from './race';

/**
 * Items: boxes on the track, the roulette (the item depends on your position when you pick the
 * box), the objects thrown / dropped on the track and what they do to the karts.
 *
 * Objects live in track coordinates (main line distance `s`, lateral offset `d`, height `h`):
 * a kicked ball follows the road and bounces off its edges, the words of Billel steer toward
 * their target's `d`, the microphone flies along the line to the leader. Everything here is
 * plain data, so in online races the host runs it and sends the state to the others.
 */

export type ObjKind = 'sauce' | 'web' | 'ball' | 'words' | 'grenade' | 'mic';

export interface ItemObj {
  id: number;
  kind: ObjKind;
  owner: number;
  s: number;
  d: number;
  h: number;
  /** speed along the line (m/s), sideways (m/s), up (m/s) */
  vs: number;
  vd: number;
  vh: number;
  /** seconds alive (and fuse for the grenade) */
  age: number;
  life: number;
  /** kart chased (words, mic), -1 = none */
  target: number;
  /** lying on the road (traps), exploding (grenade / mic: seconds of blast left) */
  trap: boolean;
  boom: number;
  dead: boolean;
  bounces: number;
}

export interface Holding {
  item: ItemId | null;
  count: number;
  /** roulette spinning (seconds left) */
  roll: number;
  /** item that will come out of the roulette */
  next: ItemId | null;
}

export interface BoxState {
  /** seconds before it comes back (0 = there) */
  respawn: number;
}

const BOX_RADIUS = 1.9;
const ROULETTE = 1.25;

export class ItemSystem implements RaceSystem {
  readonly holds: Holding[];
  readonly boxes: BoxState[];
  readonly objs: ItemObj[] = [];
  private nextId = 1;
  private seed: number;
  /** AI: seconds before using the item held */
  private aiTimers: number[];
  /** karts riding the bazooka (seconds left) */
  readonly rocket: number[];
  /** « C'EST QUOI TA CONFIG ? »: seconds left of the question over the victims' heads */
  readonly confused: number[];
  /** false on online guests: the host decides, the state comes from the network */
  authority = true;

  constructor(private race: Race) {
    const n = race.karts.length;
    this.holds = race.karts.map(() => ({ item: null, count: 0, roll: 0, next: null }));
    // time trial: no boxes, three turbo cans to use wisely
    this.boxes = race.setup.timeTrial ? [] : race.track.boxes.map(() => ({ respawn: 0 }));
    if (race.setup.timeTrial)
      race.setup.racers.forEach((r, i) => {
        if (r.local !== undefined) this.holds[i] = { item: 'turbo3', count: 3, roll: 0, next: null };
      });
    this.aiTimers = race.karts.map(() => 0);
    this.rocket = new Array(n).fill(0);
    this.confused = new Array(n).fill(0);
    this.seed = race.setup.seed * 7 + 13;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** world position of an object */
  objPos(o: ItemObj, out = new THREE.Vector3()): THREE.Vector3 {
    const rb = this.race.track.main;
    const sm = rb.sample(rb.indexAt(o.s));
    return out.copy(sm.p).addScaledVector(sm.r, o.d).addScaledVector(sm.u, o.h);
  }

  /** track coordinates of a kart on the main line */
  private kartS(k: Kart): number {
    return k.loc.ribbon.isMain ? k.loc.s : k.loc.ribbon.mainS(k.loc.s);
  }

  private immune(k: Kart): boolean {
    return k.starT > 0 || this.rocket[k.index] > 0 || k.rescueT > 0;
  }

  tick(race: Race) {
    const ks = race.karts;
    for (let i = 0; i < ks.length; i++) {
      if (this.rocket[i] > 0) this.rideRocket(ks[i]);
      if (this.confused[i] > 0) this.confused[i] -= DT;
    }
    if (!this.authority) return;
    // boxes
    race.track.boxes.forEach((spot, bi) => {
      const b = this.boxes[bi];
      if (!b) return;
      if (b.respawn > 0) {
        b.respawn = Math.max(0, b.respawn - DT);
        return;
      }
      for (const k of ks) {
        if (k.rescueT > 0 || k.pos.distanceToSquared(spot.pos) > BOX_RADIUS * BOX_RADIUS) continue;
        b.respawn = 2.2;
        k.events.push({ k: 'itemBox' });
        const h = this.holds[k.index];
        if (!h.item && h.roll <= 0 && race.setup.items) {
          h.roll = ROULETTE;
          const leader = ks[race.order[0]];
          h.next = drawItem(k.rank, ks.length, () => this.rnd(), { leaderGap: leader.progress - k.progress });
        }
        break;
      }
    });
    // roulette & use
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      const h = this.holds[i];
      if (h.roll > 0) {
        h.roll -= DT;
        if (h.roll <= 0) {
          h.item = h.next;
          h.count = h.item ? ITEM_INFO[h.item].count : 0;
          h.next = null;
          this.aiTimers[i] = 0;
          if (h.item) k.events.push({ k: 'itemGot', item: h.item });
        }
        continue;
      }
      if (!h.item || k.rescueT > 0 || k.finished) continue;
      const ai = race.ais[i];
      let use = k.itemPressed;
      let aim = k.input.aim;
      if (ai) [use, aim] = this.aiDecide(race, k, h.item);
      if (use) this.use(k, h, aim);
    }
    this.updateObjects(race);
  }

  /** CPU: when to use the item it holds, and which way */
  private aiDecide(race: Race, k: Kart, item: ItemId): [boolean, number] {
    const i = k.index;
    this.aiTimers[i] += DT;
    const t = this.aiTimers[i];
    const lvl = race.ais[i]!.level.itemDelay;
    if (t < lvl) return [false, 0];
    const ks = race.karts;
    const ahead = race.order[k.rank - 1];
    const behind = race.order[k.rank + 1];
    const gapAhead = ahead !== undefined ? ks[ahead].progress - k.progress : 1e9;
    const gapBehind = behind !== undefined ? k.progress - ks[behind].progress : 1e9;
    switch (item) {
      case 'turbo':
      case 'turbo3': {
        const rb = k.loc.ribbon;
        const c = Math.abs(curvatureOf(rb)[Math.round(k.loc.i)] ?? 0);
        return [c < 0.01 || t > 6, 0];
      }
      case 'sauce':
      case 'web':
        if (gapBehind < 18 || t > 9) return [true, -1];
        if (item === 'web' && gapAhead < 22 && gapAhead > 4) return [true, 1];
        return [false, 0];
      case 'ball':
      case 'ball3':
        if (gapAhead < 26 && gapAhead > 3) return [true, 1];
        if (gapBehind < 10) return [true, -1];
        return [t > 8, 1];
      case 'words':
        return [k.rank > 0 && (gapAhead < 120 || t > 4), 1];
      case 'grenade':
        if (gapAhead < 20 && gapAhead > 6) return [true, 1];
        if (gapBehind < 10) return [true, -1];
        return [t > 7, 1];
      default:
        return [t > lvl + 0.8, 0];
    }
  }

  private use(k: Kart, h: Holding, aim: number) {
    const item = h.item!;
    h.count--;
    if (h.count <= 0) {
      h.item = null;
      h.count = 0;
    }
    k.events.push({ k: 'itemUse', item });
    const s = this.kartS(k);
    const d = k.loc.d;
    const fwdSpeed = Math.max(0, k.speed);
    const spawn = (kind: ObjKind, back: boolean, extra: Partial<ItemObj> = {}) => {
      const o: ItemObj = {
        id: this.nextId++,
        kind,
        owner: k.index,
        s: s + (back ? -2.6 : 2.6),
        d,
        h: 0.3,
        vs: 0,
        vd: 0,
        vh: 0,
        age: 0,
        life: 60,
        target: -1,
        trap: false,
        boom: 0,
        dead: false,
        bounces: 0,
        ...extra,
      };
      this.objs.push(o);
      // too many things on the road: the oldest go
      if (this.objs.length > 40) this.objs.shift();
      return o;
    };
    switch (item) {
      case 'turbo':
      case 'turbo3':
        k.addBoost('item', 1.15, 1.3);
        break;
      case 'sauce':
        if (aim > 0) spawn('sauce', false, { vs: fwdSpeed + 10, vh: 7, life: 40 });
        else spawn('sauce', true, { trap: true, h: 0.02, life: 40 });
        break;
      case 'web':
        if (aim < 0) spawn('web', true, { trap: true, h: 0.05, life: 30 });
        else spawn('web', false, { vs: fwdSpeed + 26, life: 4 });
        break;
      case 'ball':
      case 'ball3':
        spawn('ball', aim < 0, { vs: aim < 0 ? -22 : fwdSpeed + 20, vd: k.steer * 3, life: 9 });
        break;
      case 'words': {
        const target = this.race.order[k.rank - 1];
        if (aim < 0) spawn('words', true, { vs: -20, life: 6 });
        else spawn('words', false, { vs: fwdSpeed + 14, target: target ?? -1, life: 12 });
        break;
      }
      case 'grenade':
        if (aim < 0) spawn('grenade', true, { life: 1.6, h: 0.3 });
        else spawn('grenade', false, { vs: fwdSpeed + 12, vh: 9, life: 2.2 });
        break;
      case 'mic': {
        const leader = this.race.order[0];
        if (leader !== k.index) spawn('mic', false, { vs: 60, h: 4, target: leader, life: 20 });
        else spawn('mic', false, { vs: 60, h: 4, life: 1.2 });
        break;
      }
      case 'sayan':
        k.starT = 7;
        k.addBoost('item', 0.8, 1.1);
        break;
      case 'bazooka':
        this.rocket[k.index] = 4.5;
        k.spinT = 0;
        k.drift = 0;
        break;
      case 'config':
        for (const o of this.race.karts) {
          if (o === k || o.rank > k.rank) continue;
          if (this.immune(o)) continue;
          o.spinOut(0.8);
          o.squashT = 3.5 - o.rank * 0.15;
          this.confused[o.index] = 3;
          o.events.push({ k: 'itemHit', item: 'config', by: k.index });
        }
        break;
    }
  }

  /** bazooka: autopilot at full speed along the racing line */
  private rideRocket(k: Kart) {
    const i = k.index;
    this.rocket[i] -= DT;
    // keep the kart at rocket speed (no new boost event every tick)
    k.boostT = Math.max(k.boostT, 0.1);
    k.boostPower = 1.6;
    k.boostKind = 'item';
    k.starT = Math.max(k.starT, 0.05);
    const rb = this.race.track.main;
    const s = this.kartS(k) + 16;
    const target = rb.pointAt(s, 0);
    const sm = rb.sample(rb.indexAt(s));
    // steer the kart's heading straight toward the line ahead (it flies just above the road)
    const to = target.sub(k.pos);
    to.addScaledVector(k.up, -to.dot(k.up)).normalize();
    k.fwd.lerp(to, 0.2).normalize();
    k.speed = Math.max(k.speed, k.params.top * 1.45);
    k.lat = 0;
    void sm;
    if (this.rocket[i] <= 0) {
      this.rocket[i] = 0;
      k.events.push({ k: 'rocketEnd' });
    }
  }

  private updateObjects(race: Race) {
    const rb = race.track.main;
    const L = rb.length;
    const ks = race.karts;
    const p = new THREE.Vector3();
    for (const o of this.objs) {
      if (o.dead) continue;
      o.age += DT;
      if (o.boom > 0) {
        o.boom -= DT;
        if (o.boom <= 0) o.dead = true;
        continue;
      }
      if (o.age > o.life) {
        if (o.kind === 'grenade' || o.kind === 'mic') this.explode(o);
        else o.dead = true;
        continue;
      }
      // motion
      const sm = rb.sample(rb.indexAt(o.s));
      const limit = sm.w + race.track.shoulder * 0.5;
      if (o.kind === 'words' && o.target >= 0) {
        const t = ks[o.target];
        const ts = this.kartS(t);
        let ds = ts - o.s;
        if (ds < -L / 2) ds += L;
        if (ds > L / 2) ds -= L;
        o.vs = Math.max(o.vs, t.speed + 8);
        // close enough: aim straight at it
        const want = ds < 40 ? (t.loc.d - o.d) * 3 : (0 - o.d) * 0.8;
        o.vd += (want - o.vd) * Math.min(1, DT * 5);
      }
      if (o.kind === 'mic') {
        if (o.target >= 0) {
          const t = ks[o.target];
          const ts = this.kartS(t);
          let ds = ts - o.s;
          if (ds < -L / 2) ds += L;
          if (ds > L / 2) ds -= L;
          o.d += (t.loc.d - o.d) * Math.min(1, DT * 2);
          if (ds < 8) {
            o.vs = t.speed;
            o.h = Math.max(0.5, o.h - DT * 9);
            if (o.h <= 0.6) this.explode(o);
          }
        } else if (o.age > 1) this.explode(o);
      }
      if (!o.trap) {
        o.s += o.vs * DT;
        o.d += o.vd * DT;
        if (o.vh || o.h > 0.35) {
          o.vh -= 26 * DT;
          o.h += o.vh * DT;
          if (o.h <= 0.3 && o.kind !== 'mic') {
            o.h = 0.3;
            o.vh = 0;
            if (o.kind === 'sauce') {
              o.trap = true;
              o.h = 0.02;
            } else if (o.kind === 'grenade') o.vs *= 0.4;
          }
        }
        o.s = ((o.s % L) + L) % L;
        // edges: the ball bounces, the rest stops / falls
        if (Math.abs(o.d) > limit) {
          if (o.kind === 'ball') {
            o.d = Math.sign(o.d) * limit;
            o.vd = -o.vd || -Math.sign(o.d) * 4;
            o.bounces++;
          } else if (o.kind === 'web') o.dead = true;
          else o.d = Math.sign(o.d) * limit;
        }
      }
      // hits
      this.objPos(o, p);
      for (const k of ks) {
        if (k.rescueT > 0) continue;
        // a fresh object never hits its own thrower
        if (k.index === o.owner && o.age < 0.6) continue;
        const r = o.kind === 'mic' ? 0 : o.trap ? 1.5 : 1.35;
        if (r === 0 || k.pos.distanceToSquared(p) > r * r) continue;
        if (o.kind === 'grenade') {
          this.explode(o);
          break;
        }
        o.dead = true;
        if (this.immune(k)) {
          k.events.push({ k: 'itemBlock', item: o.kind });
          break;
        }
        k.spinOut(o.kind === 'web' ? 1.5 : 1.1);
        if (o.kind === 'web') k.speed *= 0.3;
        k.events.push({ k: 'itemHit', item: o.kind, by: o.owner });
        break;
      }
    }
    // objects colliding with each other (a ball breaks a trap)
    for (const a of this.objs) {
      if (a.dead || a.trap || a.boom > 0 || (a.kind !== 'ball' && a.kind !== 'words')) continue;
      for (const b of this.objs) {
        if (b === a || b.dead || b.boom > 0 || b.kind === 'mic') continue;
        let ds = a.s - b.s;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        if (Math.abs(ds) < 1.2 && Math.abs(a.d - b.d) < 1.2) {
          a.dead = true;
          if (b.kind === 'grenade') this.explode(b);
          else b.dead = true;
        }
      }
    }
    for (let i = this.objs.length - 1; i >= 0; i--) if (this.objs[i].dead) this.objs.splice(i, 1);
  }

  private explode(o: ItemObj) {
    if (o.boom > 0) return;
    o.boom = 0.6;
    o.trap = true;
    const p = this.objPos(o);
    const R = o.kind === 'mic' ? 6 : 6.5;
    for (const k of this.race.karts) {
      if (k.pos.distanceTo(p) > R || k.rescueT > 0) continue;
      if (this.immune(k)) continue;
      k.spinOut(1.6);
      // blown in the air a little
      if (k.grounded) {
        k.speed *= 0.4;
      }
      k.events.push({ k: 'itemHit', item: o.kind, by: o.owner });
    }
  }
}
