import { input } from '../input/input';
import { settings } from '../game/settings';
import { h } from './dom';

/**
 * On-screen driving controls for phones / tablets (player 1).
 * Left: the steering stick (left / right = steer, analog; up / down = throw an item forward /
 * backward). Right: ACCÉLÉRER (big), FREIN, DÉRAPAGE (hold to drift; tap in the air = trick)
 * and the OBJET button, which shows the item you hold.
 * Layout is pure CSS (src/ui/mobile-game.css + kart-touch.css): landscape = translucent controls in
 * the bottom corners over the picture; portrait (#app.split) = a control deck under the race.
 */
export class TouchControls {
  private pad: HTMLDivElement;
  private knob: HTMLDivElement;
  private btns: HTMLDivElement;
  private padPointer = -1;
  private gameplay = false;
  private shownState = false;
  private held = { accel: false, brake: false, drift: false, item: false };
  private steer = 0;
  private aim = 0;
  private itemBtn!: HTMLElement;
  private itemIcon!: HTMLDivElement;
  private accelBtn!: HTMLElement;
  onPause: (() => void) | null = null;
  /** called when the controls appear / disappear (the app re-lays out the screen) */
  onLayout: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    this.knob = h('div', { class: 'knob' });
    this.pad = h('div', { class: 'pad steer' }, h('i', { class: 'arr l' }, '◀'), h('i', { class: 'arr r' }, '▶'), this.knob);
    this.btns = h('div', { class: 'btns kart' });
    const layout: [keyof TouchControls['held'], string, string][] = [
      ['accel', 'GAZ', 'ACCÉLÉRER'],
      ['brake', 'FREIN', ''],
      ['drift', 'DRIFT', 'DÉRAPAGE'],
      ['item', 'OBJET', ''],
    ];
    for (const [key, label, sub] of layout) {
      const b = h('b', { class: key }, h('span', null, label), sub ? h('small', null, sub) : null);
      if (key === 'item') {
        this.itemIcon = h('div', { class: 'icon' });
        b.prepend(this.itemIcon);
        this.itemBtn = b;
      }
      if (key === 'accel') this.accelBtn = b;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          // synthetic pointers (tests) cannot always be captured
        }
        this.held[key] = true;
        if (key === 'item') input.touchItemLatch = true;
        b.classList.add('on');
        this.flush();
      };
      const off = () => {
        this.held[key] = false;
        b.classList.remove('on');
        this.flush();
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      this.btns.append(b);
    }
    const pause = h('button', { class: 'pausebtn', 'aria-label': 'Pause' }, 'II');
    pause.addEventListener('click', () => this.onPause?.());
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.padPointer = e.pointerId;
      try {
        this.pad.setPointerCapture(e.pointerId);
      } catch {
        // see above
      }
      this.movePad(e);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.padPointer) this.movePad(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.padPointer) return;
      this.padPointer = -1;
      this.steer = 0;
      this.aim = 0;
      this.knob.style.transform = '';
      this.pad.classList.remove('on');
      this.flush();
    };
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);
    root.append(this.pad, this.btns, pause);
    this.setItem(null);
    this.refresh();
    window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', () => this.refresh());
  }

  private movePad(e: PointerEvent) {
    const r = this.pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - r.width * 0.12;
    const kx = Math.max(-max, Math.min(max, dx));
    const ky = Math.max(-max * 0.6, Math.min(max * 0.6, dy));
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    // analog steering with a small dead zone, full lock a bit before the edge
    const dead = r.width * 0.07;
    const v = Math.abs(dx) < dead ? 0 : (dx - Math.sign(dx) * dead) / (max * 0.85 - dead);
    this.steer = Math.max(-1, Math.min(1, v));
    this.aim = dy < -max * 0.45 ? 1 : dy > max * 0.45 ? -1 : 0;
    this.pad.classList.toggle('on', this.steer !== 0 || this.aim !== 0);
    this.flush();
  }

  private flush() {
    const auto = settings.autoAccel && this.shown;
    input.touch = {
      steer: this.steer,
      accel: this.held.accel || (auto && !this.held.brake),
      brake: this.held.brake,
      drift: this.held.drift,
      item: this.held.item,
      look: false,
      aim: this.aim,
    };
    this.accelBtn.classList.toggle('auto', auto);
  }

  private release() {
    this.held = { accel: false, brake: false, drift: false, item: false };
    this.steer = 0;
    this.aim = 0;
    this.padPointer = -1;
    this.knob.style.transform = '';
    this.pad.classList.remove('on');
    for (const b of Array.from(this.btns.children)) b.classList.remove('on');
    input.touch = { steer: 0, accel: false, brake: false, drift: false, item: false, look: false, aim: 0 };
  }

  get enabled() {
    if (settings.touch === 'on') return true;
    if (settings.touch === 'off') return false;
    return !!window.matchMedia?.('(pointer: coarse)').matches;
  }

  /** true while the controls are on screen (race in progress on a touch device) */
  get shown() {
    return this.gameplay && this.enabled;
  }

  /** item held (icon url) or null; `rolling` = the roulette is spinning */
  setItem(url: string | null, rolling = false) {
    this.itemIcon.style.backgroundImage = url ? `url(${url})` : '';
    this.itemBtn.classList.toggle('has', !!url);
    this.itemBtn.classList.toggle('rolling', rolling);
  }

  /** Fade the controls while they do nothing (intro, finish). */
  setIdle(on: boolean) {
    this.root.classList.toggle('idle', on);
  }

  /** Hide the controls under a menu (pause, results); the deck stays in place. */
  setCovered(on: boolean) {
    if (on && !this.root.classList.contains('covered')) this.release();
    this.root.classList.toggle('covered', on);
  }

  setGameplay(on: boolean) {
    this.gameplay = on;
    if (!on) {
      this.root.classList.remove('idle', 'covered');
      this.setItem(null);
    }
    this.refresh();
    this.flush();
  }

  refresh() {
    const show = this.shown;
    this.root.classList.toggle('on', show);
    this.root.style.display = show ? '' : 'none';
    if (!show) this.release();
    if (show !== this.shownState) {
      this.shownState = show;
      this.onLayout?.();
    }
  }
}
