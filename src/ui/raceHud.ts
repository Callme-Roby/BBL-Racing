import type { Kart } from '../race/kart';
import type { Race } from '../race/race';
import type { Track } from '../race/track';
import type { ViewRect } from '../game/raceWorld';
import { h } from './dom';

/** « 1er », « 2e »… */
export function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`;
}

export function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) return '-:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Track outline drawn once, karts as dots on top. */
class MiniMap {
  readonly el: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private map: (x: number, z: number) => [number, number];

  constructor(track: Track, size = 128) {
    this.el = h('canvas', { class: 'minimap', width: size, height: size });
    this.base = document.createElement('canvas');
    this.base.width = size;
    this.base.height = size;
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    for (const s of track.main.samples) {
      minX = Math.min(minX, s.p.x);
      maxX = Math.max(maxX, s.p.x);
      minZ = Math.min(minZ, s.p.z);
      maxZ = Math.max(maxZ, s.p.z);
    }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const pad = 10;
    const k = (size - pad * 2) / span;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    // seen from above with the start line at the bottom: x mirrored (+X = left of a kart going +Z)
    this.map = (x, z) => [size / 2 - (x - cx) * k, size / 2 - (z - cz) * k];
    const ctx = this.base.getContext('2d')!;
    const path = (rb: Track['main'], close: boolean) => {
      ctx.beginPath();
      rb.samples.forEach((s, i) => {
        const [x, y] = this.map(s.p.x, s.p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
    };
    ctx.lineJoin = 'round';
    for (const rb of track.ribbons) {
      path(rb, rb.closed);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = rb.isMain ? 'rgba(235,235,245,0.92)' : 'rgba(210,180,120,0.9)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    // anti-gravity in blue
    const ag = (track.def.features.antigrav ?? []).map((sp) => track.main.spanOf(sp));
    for (const [a, b] of ag) {
      ctx.beginPath();
      for (let s = a; s <= b; s += 2) {
        const p = track.main.sample(track.main.indexAt(s)).p;
        const [x, y] = this.map(p.x, p.z);
        if (s === a) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#3ad8ff';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    const s0 = track.main.sample(0);
    const [sx, sy] = this.map(s0.p.x, s0.p.z);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 4, sy - 1, 8, 2);
  }

  draw(race: Race, me: number[]) {
    const ctx = this.el.getContext('2d')!;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.base, 0, 0);
    const ks = race.karts;
    // others first, then the local players on top
    const order = ks.map((_, i) => i).sort((a, b) => Number(me.includes(a)) - Number(me.includes(b)));
    for (const i of order) {
      const k = ks[i];
      const [x, y] = this.map(k.pos.x, k.pos.z);
      const mine = me.indexOf(i);
      ctx.fillStyle = mine >= 0 ? PLAYER_COLORS[mine] : k.def.outfit.topColor;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, mine >= 0 ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

export const PLAYER_COLORS = ['#3aa0ff', '#ff4a4a', '#46e070', '#ffd23a'];

/** Driver's HUD over one view: lap, time, position, item, messages, minimap, positions column. */
export class RaceHud {
  readonly el: HTMLDivElement;
  private lapEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private posEl: HTMLDivElement;
  private itemEl: HTMLDivElement;
  private itemIcon: HTMLDivElement;
  private itemCount: HTMLSpanElement;
  private msgEl: HTMLDivElement;
  private bigEl: HTMLDivElement;
  private wrongEl: HTMLDivElement;
  private slipEl: HTMLDivElement;
  private list: HTMLDivElement | null = null;
  private listRows: HTMLDivElement[] = [];
  private mini: MiniMap | null = null;
  private msgT = 0;
  private bigT = 0;
  private lastPos = -1;
  private lastLap = -1;
  private lastTime = '';
  private wrongT = 0;
  faces: string[] = [];

  constructor(
    private race: Race,
    private kartIndex: number,
    rect: ViewRect,
    private player: number,
    players: number,
  ) {
    this.lapEl = h('div', { class: 'rh-lap' });
    this.timeEl = h('div', { class: 'rh-time' });
    this.posEl = h('div', { class: 'rh-pos' });
    this.itemIcon = h('div', { class: 'rh-icon' });
    this.itemCount = h('span', { class: 'rh-count' });
    this.itemEl = h('div', { class: 'rh-item' }, this.itemIcon, this.itemCount);
    this.msgEl = h('div', { class: 'rh-msg' });
    this.bigEl = h('div', { class: 'rh-big' });
    this.wrongEl = h('div', { class: 'rh-wrong' }, 'MAUVAIS SENS !');
    this.slipEl = h('div', { class: 'rh-slip' });
    const small = players > 2;
    this.el = h(
      'div',
      {
        class: `rhud p${player + 1}` + (players > 1 ? ' multi' : '') + (small ? ' small' : ''),
        style: `left:${rect.x * 100}%;width:${rect.w * 100}%;bottom:${rect.y * 100}%;height:${rect.h * 100}%;--pc:${PLAYER_COLORS[player]}`,
      },
      h('div', { class: 'rh-top' }, h('div', { class: 'rh-left' }, this.lapEl, this.itemEl), this.timeEl),
      this.posEl,
      this.msgEl,
      this.bigEl,
      this.wrongEl,
      this.slipEl,
      players > 1 ? h('div', { class: 'rh-tag' }, `J${player + 1}`) : null,
    );
    if (players <= 2) {
      this.mini = new MiniMap(race.track, players === 1 ? 132 : 104);
      this.el.append(this.mini.el);
    }
    if (players === 1) {
      this.list = h('div', { class: 'rh-list' });
      this.el.append(this.list);
    }
  }

  get kart(): Kart {
    return this.race.karts[this.kartIndex];
  }

  /** short message in the middle (MINI-TURBO !, TOUR FINAL !…) */
  message(text: string, cls = '', seconds = 1.4) {
    this.msgEl.textContent = text;
    this.msgEl.className = 'rh-msg on ' + cls;
    this.msgT = seconds;
  }

  /** big centred text (countdown, PARTEZ !, ARRIVÉE !) */
  big(text: string, cls = '', seconds = 0.9) {
    this.bigEl.textContent = text;
    this.bigEl.className = 'rh-big on ' + cls;
    void this.bigEl.offsetWidth;
    this.bigEl.classList.add('pop');
    this.bigT = seconds;
  }

  setItem(url: string | null, count: number, rolling: boolean) {
    this.itemIcon.style.backgroundImage = url ? `url(${url})` : '';
    this.itemEl.classList.toggle('has', !!url);
    this.itemEl.classList.toggle('rolling', rolling);
    this.itemCount.textContent = count > 1 ? '×' + count : '';
  }

  update(dt: number, locals: number[]) {
    const k = this.kart;
    const race = this.race;
    const lap = Math.min(race.laps, Math.max(1, k.lap));
    if (lap !== this.lastLap) {
      this.lastLap = lap;
      this.lapEl.innerHTML = `<small>TOUR</small> ${lap}<small>/${race.laps}</small>`;
    }
    const t = fmtTime(k.finished ? k.finishTime : race.time);
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.timeEl.textContent = t;
    }
    const pos = k.rank + 1;
    if (pos !== this.lastPos) {
      this.lastPos = pos;
      this.posEl.innerHTML = `${pos}<small>${pos === 1 ? 'er' : 'e'}</small>`;
      this.posEl.classList.remove('bump');
      void this.posEl.offsetWidth;
      this.posEl.classList.add('bump');
      this.posEl.dataset.p = String(pos);
    }
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.msgEl.classList.remove('on');
    }
    if (this.bigT > 0) {
      this.bigT -= dt;
      if (this.bigT <= 0) this.bigEl.classList.remove('on');
    }
    // wrong way: driving against the track for a while
    const wrong = race.phase === 'race' && !k.finished && k.grounded && k.speed > 4 && k.fwd.dot(k.loc.fwd) < -0.5;
    this.wrongT = wrong ? this.wrongT + dt : 0;
    this.wrongEl.classList.toggle('on', this.wrongT > 1);
    this.slipEl.classList.toggle('on', k.slipT > 0.25);
    this.mini?.draw(race, locals);
    if (this.list) this.drawList();
    void this.player;
  }

  private drawList() {
    const race = this.race;
    const n = race.karts.length;
    if (this.listRows.length !== n) {
      this.listRows = race.karts.map(() => h('div', { class: 'rh-row' }));
      this.list!.replaceChildren(...this.listRows);
    }
    race.order.forEach((ki, pos) => {
      const row = this.listRows[pos];
      const key = ki + '|' + pos;
      if (row.dataset.k === key) return;
      row.dataset.k = key;
      row.className = 'rh-row' + (ki === this.kartIndex ? ' me' : '');
      row.style.backgroundImage = this.faces[ki] ? `url(${this.faces[ki]})` : '';
      row.textContent = String(pos + 1);
    });
  }
}
