import '../ui/controllers.css';
import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { clonePadMap, DIR_DOWN as IN_DOWN, DIR_LEFT as IN_LEFT, DIR_RIGHT as IN_RIGHT, DIR_UP as IN_UP, hatBits, input, PAD_ACTIONS, PAD_BIT, type PadAction, type PadInfo, type PadInput, type PadMap } from '../input/input';
import { Showroom } from '../render/showroom';
import { backButton, h, uiRoot } from '../ui/dom';
import { goOptions } from './flow';

/**
 * OPTIONS → MANETTES & STICKS: the connected controllers, a mapping wizard
 * (directions on a hat / axis / button, then every button), a live input display
 * and a reset. Mappings are saved per Gamepad.id by src/input/input.ts.
 */

export const ACTION_LABEL: Record<PadAction, string> = {
  up: 'HAUT',
  down: 'BAS',
  left: 'GAUCHE',
  right: 'DROITE',
  accel: 'ACCÉLÉRER',
  brake: 'FREINER',
  drift: 'DÉRAPAGE',
  item: 'OBJET',
  look: 'RÉTRO',
  start: 'PAUSE / START',
  back: 'RETOUR',
};
const ACTION_TAG: Partial<Record<PadAction, string>> = { accel: 'GAZ', drift: 'DRIFT' };
const DIR_ACTIONS: PadAction[] = ['up', 'down', 'left', 'right'];

// ---------------------------------------------------------------- device names & button prompts

export type PadKind = 'xbox' | 'ps' | 'switch' | 'generic';

export function padKind(id: string): PadKind {
  const s = id.toLowerCase();
  if (/xbox|xinput|vendor: 045e|^045e-/.test(s)) return 'xbox';
  if (/playstation|dualshock|dualsense|wireless controller|vendor: 054c|^054c-|\bps[345]\b/.test(s)) return 'ps';
  if (/nintendo|switch|joy-con|pro controller|vendor: 057e|^057e-/.test(s)) return 'switch';
  return 'generic';
}

const KIND_LABEL: Record<PadKind, string> = { xbox: 'XBOX', ps: 'PLAYSTATION', switch: 'SWITCH', generic: '' };

/** "Xbox 360 Controller (XInput STANDARD GAMEPAD)" → "Xbox 360 Controller" (Chrome), "054c-09cc-Wireless Controller" → … (Firefox) */
export function padName(id: string): string {
  let s = id.replace(/\([^()]*(vendor|product|standard gamepad|xinput)[^()]*\)/gi, ' ');
  s = s.replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').replace(/\s+/g, ' ').trim();
  if (s.length > 40) s = s.slice(0, 39) + '…';
  return s || 'Manette';
}

const DPAD = ['Croix ↑', 'Croix ↓', 'Croix ←', 'Croix →'];
const NAMES: Record<Exclude<PadKind, 'generic'>, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', ...DPAD, 'Xbox'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', ...DPAD, 'PS', 'Pavé'],
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', ...DPAD, 'Home', 'Capture'],
};
/** face button colours (standard layout: bottom, right, left, top) */
const FACE: Record<Exclude<PadKind, 'generic'>, string[]> = {
  xbox: ['green', 'red', 'blue', 'yellow'],
  ps: ['blue', 'red', 'pink', 'green'],
  switch: ['', '', '', ''],
};
const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

export function inputLabel(x: PadInput, standard: boolean, kind: PadKind): string {
  if (x.t === 'b') {
    if (standard) {
      if (kind !== 'generic' && NAMES[kind][x.i]) return NAMES[kind][x.i];
      if (x.i >= 12 && x.i <= 15) return DPAD[x.i - 12];
      if (x.i === 8) return 'Select';
      if (x.i === 9) return 'Start';
    }
    return 'B' + (x.i + 1);
  }
  if (x.t === 'h') return 'POV ' + ARROW[x.d];
  if (standard && x.i < 4) return (x.i < 2 ? 'Stick G ' : 'Stick D ') + (x.i % 2 === 0 ? (x.d < 0 ? '←' : '→') : x.d < 0 ? '↑' : '↓');
  return `Axe ${x.i + 1} ${x.d < 0 ? '−' : '+'}`;
}

function inputChip(x: PadInput, standard: boolean, kind: PadKind): HTMLElement {
  const color = x.t === 'b' && standard && kind !== 'generic' && x.i < 4 ? FACE[kind][x.i] : '';
  return h('span', { class: 'pk' + (color ? ' c-' + color : '') + (x.t !== 'b' ? ' dir' : '') }, inputLabel(x, standard, kind));
}

const same = (a: PadInput, b: PadInput) => a.t === b.t && a.i === b.i && ('d' in a ? a.d : 0) === ('d' in b ? b.d : 0);

// ---------------------------------------------------------------- keyboard / controller focus

/**
 * Focus moved with the menu events (keyboard, controllers): rows of elements,
 * ↑ ↓ between rows, ← → inside a row, confirm = click. The focused element gets `.kfocus`.
 */
export class FocusNav {
  r = 0;
  c = 0;
  private rows: HTMLElement[][] = [];

  set(rows: HTMLElement[][], focus?: HTMLElement | null) {
    this.rows = rows.filter((r) => r.length);
    const at = focus ? this.find(focus) : null;
    if (at) [this.r, this.c] = at;
    this.r = Math.max(0, Math.min(this.r, this.rows.length - 1));
    this.c = Math.max(0, Math.min(this.c, (this.rows[this.r]?.length ?? 1) - 1));
    this.apply(false);
  }

  private find(el: HTMLElement): [number, number] | null {
    for (let r = 0; r < this.rows.length; r++) {
      const c = this.rows[r].indexOf(el);
      if (c >= 0) return [r, c];
    }
    return null;
  }

  get current(): HTMLElement | undefined {
    return this.rows[this.r]?.[this.c];
  }

  move(dr: number, dc: number) {
    if (!this.rows.length) return;
    const before = this.current;
    if (dr) {
      this.r = Math.max(0, Math.min(this.rows.length - 1, this.r + dr));
      this.c = Math.min(this.c, this.rows[this.r].length - 1);
    }
    if (dc) this.c = Math.max(0, Math.min(this.rows[this.r].length - 1, this.c + dc));
    if (this.current !== before) audio.sfx('cursor');
    this.apply(true);
  }

  apply(scroll: boolean) {
    const cur = this.current;
    for (const row of this.rows) for (const el of row) el.classList.toggle('kfocus', el === cur);
    if (scroll) cur?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}

// ---------------------------------------------------------------- input display

/** Lever + buttons laid out like an arcade stick, lit live (TESTER, wizard). */
class PadViz {
  readonly el: HTMLElement;
  private ball: HTMLElement;
  private cells = new Map<PadAction, HTMLElement>();
  private flash = new Map<PadAction, number>();

  constructor() {
    this.ball = h('i', { class: 'pv-ball' });
    const arrow = (a: PadAction) => this.cell(a, h('i', { class: 'pv-arrow pv-' + a }));
    const lever = h('div', { class: 'pv-lever' }, h('i', { class: 'pv-gate' }), ...DIR_ACTIONS.map(arrow), this.ball);
    const b = (a: PadAction, label: string, cls = '') => this.cell(a, h('b', { class: 'pv-btn ' + cls }, label));
    const btns = h(
      'div',
      { class: 'pv-btns' },
      b('accel', 'GAZ', 'gold'),
      b('brake', 'FREIN'),
      b('drift', 'DRIFT', 'pill'),
      b('item', 'OBJET', 'teal pill'),
      b('look', 'RÉTRO', 'pill'),
    );
    const meta = h('div', { class: 'pv-meta' }, b('start', 'START', 'small'), b('back', 'RETOUR', 'small'));
    this.el = h('div', { class: 'pad-viz' }, lever, h('div', { class: 'pv-side' }, btns, meta));
  }

  private cell<T extends HTMLElement>(a: PadAction, el: T): T {
    this.cells.set(a, el);
    return el;
  }

  /**
   * `dirs` = IN_UP… bits the game gets (SOCD applied), `held` = PAD_BIT mask,
   * `taps` = actions seen since the last frame (a tap shorter than a frame still lights up).
   */
  update(dirs: number, held: number, taps: number, want: PadAction | null) {
    const now = performance.now();
    const x = (dirs & IN_RIGHT ? 1 : 0) - (dirs & IN_LEFT ? 1 : 0);
    const y = (dirs & IN_DOWN ? 1 : 0) - (dirs & IN_UP ? 1 : 0);
    this.ball.style.transform = `translate(${x * 62}%, ${y * 62}%)`;
    this.ball.classList.toggle('on', x !== 0 || y !== 0);
    const dirBit: Partial<Record<PadAction, number>> = { up: IN_UP, down: IN_DOWN, left: IN_LEFT, right: IN_RIGHT };
    for (const [a, el] of this.cells) {
      const d = dirBit[a];
      let on = d !== undefined ? (dirs & d) !== 0 : (held & PAD_BIT[a]) !== 0;
      if (!on && taps & PAD_BIT[a]) this.flash.set(a, now + 150);
      if (!on && (this.flash.get(a) ?? 0) > now) on = true;
      el.classList.toggle('on', on);
      el.classList.toggle('want', a === want);
    }
  }
}

// ---------------------------------------------------------------- screen

interface Wizard {
  index: number;
  id: string;
  standard: boolean;
  kind: PadKind;
  step: number;
  draft: PadMap;
  /** captured this run, for the recap */
  got: Partial<Record<PadAction, PadInput>>;
}

export class ControllersScreen implements Screen {
  private showroom = new Showroom();
  private root!: HTMLElement;
  private body!: HTMLElement;
  private mode: 'list' | 'wizard' | 'test' = 'list';
  /** browser slot of the controller shown */
  private sel = -1;
  private listKey = '';
  private seq = input.padSeq;
  private nav = new FocusNav();
  private viz: PadViz | null = null;
  private wiz: Wizard | null = null;
  private testIndex = -1;
  private testRest: number[] = [];
  private startSince = 0;
  private message = '';
  // live elements of the current view
  private askEl: HTMLElement | null = null;
  private subEl: HTMLElement | null = null;
  private stepEl: HTMLElement | null = null;
  private doneEl: HTMLElement | null = null;
  private rawEl: HTMLElement | null = null;

  constructor(private app: App) {}

  enter() {
    this.body = h('div', { class: 'pads-body' });
    this.root = h(
      'div',
      { class: 'screen dim pads-screen', style: 'overflow-y:auto;justify-content:flex-start;touch-action:pan-y' },
      h('div', { class: 'h1' }, 'MANETTES & STICKS'),
      this.body,
      // top-left ◀ RETOUR: one step back (wizard / test → the list)
      backButton(() => (this.mode === 'wizard' ? this.wizCancel() : this.mode === 'test' ? this.endTest() : this.leave())),
    );
    uiRoot().append(this.root);
    const pads = input.padList();
    this.sel = pads.find((p) => p.index === input.lastPad)?.index ?? pads[0]?.index ?? -1;
    this.renderList();
  }

  exit() {
    if (input.claimedPad >= 0) input.releasePad();
    this.showroom.dispose();
  }

  private leave() {
    audio.sfx('cancel');
    goOptions();
  }

  private key(pads: PadInfo[]) {
    return pads.map((p) => `${p.index}:${p.id}:${p.custom}:${p.seat}`).join('|');
  }

  // ---- list of controllers + mapping of the selected one
  /** what has the focus, to keep it when the list is rebuilt: 'config' | 'test' | 'reset' | 'back' | 'pad:<slot>' */
  private focusRole(): string {
    return this.nav.current?.dataset.role ?? 'config';
  }

  private renderList(focus = 'config') {
    this.mode = 'list';
    this.viz = null;
    const pads = input.padList();
    this.listKey = this.key(pads);
    if (!pads.some((p) => p.index === this.sel)) this.sel = pads[0]?.index ?? -1;
    const cur = pads.find((p) => p.index === this.sel) ?? null;

    const rows = pads.map((p) => {
      const kind = padKind(p.id);
      const tags = [
        h('i', { class: p.standard ? 'ok' : 'warn' }, p.standard ? 'STANDARD' : 'NON STANDARD'),
        KIND_LABEL[kind] ? h('i', null, KIND_LABEL[kind]) : null,
        p.custom ? h('i', { class: 'perso' }, 'PERSO') : null,
        h('i', { class: 'seat s' + p.seat }, p.seat === 0 ? 'VERSUS : J1' : p.seat === 1 ? 'VERSUS : J2' : 'VERSUS : —'),
      ];
      const row = h(
        'button',
        { class: 'pad-row' + (p.index === this.sel ? ' sel' : ''), 'data-role': 'pad:' + p.index },
        h('span', { class: 'pad-num' }, String(p.index + 1)),
        h('span', { class: 'pad-txt' }, h('span', { class: 'pad-name' }, padName(p.id)), h('span', { class: 'pad-tags' }, ...tags)),
      );
      row.addEventListener('click', () => {
        if (this.sel === p.index) return;
        this.sel = p.index;
        audio.sfx('cursor');
        this.renderList('pad:' + p.index);
      });
      return row;
    });

    const list = h(
      'div',
      { class: 'panel pads-list' },
      h('div', { class: 'pads-h' }, 'CONNECTÉES'),
      ...(rows.length ? rows : [h('div', { class: 'pads-empty' }, 'Aucune manette. Branche une manette ou un stick arcade et appuie sur un de ses boutons.')]),
      h('div', { class: 'pads-foot' }, 'VERSUS : la 1re manette joue J1, la 2e J2. Une seule manette ? Elle joue J2 et le clavier J1.'),
    );

    const back = h('button', { class: 'btn primary pads-back', 'data-role': 'back' }, 'RETOUR');
    back.addEventListener('click', () => this.leave());
    const navRows: HTMLElement[][] = rows.map((r) => [r]);
    let focusEl: HTMLElement | null = null;

    let detail: HTMLElement | null = null;
    if (cur) {
      const kind = padKind(cur.id);
      const map = input.padMap(cur.index)!;
      const cfg = h('button', { class: 'btn primary', 'data-role': 'config' }, 'CONFIGURER');
      const test = h('button', { class: 'btn', 'data-role': 'test' }, 'TESTER');
      const reset = h('button', { class: 'btn', 'data-role': 'reset' }, 'RÉINITIALISER');
      cfg.addEventListener('click', () => this.startWizard(cur));
      test.addEventListener('click', () => this.startTest(cur));
      reset.addEventListener('click', () => {
        input.setPadMap(cur.id, null);
        audio.sfx('confirm');
        this.message = 'Réglages d’origine rétablis.';
        this.renderList('reset');
      });
      if (!cur.custom) reset.disabled = true;
      const table = h(
        'table',
        { class: 'pads-map' },
        ...PAD_ACTIONS.map((a) =>
          h(
            'tr',
            null,
            h('td', null, ACTION_LABEL[a], ACTION_TAG[a] ? h('small', null, ' ' + ACTION_TAG[a]) : null),
            h('td', null, ...(map[a].length ? map[a].map((x) => inputChip(x, cur.standard, kind)) : [h('span', { class: 'pk none' }, '—')])),
          ),
        ),
      );
      const noDirs = DIR_ACTIONS.every((a) => !map[a].length);
      const note = cur.custom
        ? 'Réglages perso, enregistrés pour ce modèle de manette.'
        : cur.standard
          ? 'Disposition standard reconnue par le navigateur.'
          : noDirs
            ? 'Disposition inconnue et aucune direction trouvée : lance CONFIGURER.'
            : 'Disposition inconnue : boutons devinés. Pour un stick arcade, lance CONFIGURER.';
      detail = h(
        'div',
        { class: 'panel pads-detail' },
        h('div', { class: 'pads-h' }, padName(cur.id)),
        h('div', { class: 'pads-actions' }, cfg, test, reset),
        this.message ? h('div', { class: 'pads-msg' }, this.message) : null,
        h('div', { class: 'pads-note' + (!cur.standard && !cur.custom ? ' warn' : '') }, note),
        table,
      );
      navRows.push([cfg, test, reset]);
      focusEl = focus === 'test' ? test : focus === 'reset' ? (reset.disabled ? cfg : reset) : focus === 'back' ? back : cfg;
    } else focusEl = back;
    if (focus.startsWith('pad:')) focusEl = rows.find((r) => r.dataset.role === focus) ?? focusEl;
    this.message = '';
    navRows.push([back]);

    this.body.replaceChildren(h('div', { class: 'pads-wrap' + (cur ? '' : ' empty') }, list, detail), back);
    this.nav.set(
      navRows.map((r) => r.filter((el) => !(el as HTMLButtonElement).disabled)),
      focusEl,
    );
  }

  // ---- wizard
  private startWizard(p: PadInfo) {
    const map = input.padMap(p.index);
    if (!map) return;
    audio.sfx('confirm');
    this.wiz = { index: p.index, id: p.id, standard: p.standard, kind: padKind(p.id), step: 0, draft: clonePadMap(map), got: {} };
    input.claimPad(p.index);
    input.startCapture();
    this.mode = 'wizard';
    const skip = h('button', { class: 'btn' }, 'PASSER');
    const cancel = h('button', { class: 'btn' }, 'ANNULER');
    skip.addEventListener('click', () => this.wizNext(null));
    cancel.addEventListener('click', () => this.wizCancel());
    this.viz = new PadViz();
    this.stepEl = h('div', { class: 'pads-step' });
    this.askEl = h('div', { class: 'pads-ask' });
    this.subEl = h('div', { class: 'pads-sub' });
    this.doneEl = h('div', { class: 'pads-done' });
    this.body.replaceChildren(
      h(
        'div',
        { class: 'panel pads-wiz' },
        h('div', { class: 'pads-h' }, 'CONFIGURER · ' + padName(p.id)),
        this.stepEl,
        this.askEl,
        this.subEl,
        this.viz.el,
        this.doneEl,
        h('div', { class: 'pads-actions' }, skip, cancel),
        h('div', { class: 'pads-keys kbd-only' }, 'Clavier : Entrée = passer · Échap = annuler'),
      ),
    );
    this.nav.set([[skip, cancel]], skip);
    this.wizShow();
  }

  private wizShow() {
    const w = this.wiz!;
    const a = PAD_ACTIONS[w.step];
    this.stepEl!.textContent = `ÉTAPE ${w.step + 1} / ${PAD_ACTIONS.length}`;
    this.askEl!.replaceChildren('Appuie sur ', h('b', null, ACTION_LABEL[a] + (ACTION_TAG[a] ? ` (${ACTION_TAG[a]})` : '')), '…');
    this.doneEl!.replaceChildren(
      ...PAD_ACTIONS.slice(0, w.step).map((k) => {
        const g = w.got[k];
        // the same input for two fight actions (sharing one with START / RETOUR is fine: B = RK and RETOUR)
        const fightAct = (x: PadAction) => PAD_ACTIONS.indexOf(x) < 9;
        const dup = g && fightAct(k) && PAD_ACTIONS.some((o) => o !== k && fightAct(o) && w.got[o] && same(w.got[o]!, g));
        return h(
          'span',
          { class: 'pads-got' + (g ? '' : ' skip') + (dup ? ' dup' : '') },
          ACTION_TAG[k] ?? ACTION_LABEL[k],
          ' ',
          g ? inputChip(g, w.standard, w.kind) : h('span', { class: 'pk none' }, 'passé'),
        );
      }),
    );
  }

  /** `got` = captured input (null = PASSER: the current binding stays) */
  private wizNext(got: PadInput | null) {
    const w = this.wiz;
    if (!w) return;
    const a = PAD_ACTIONS[w.step];
    if (got) {
      w.got[a] = got;
      const keep: PadInput[] = [];
      // a standard pad keeps its left stick for the directions (the d-pad / lever is what was pressed)
      if (w.standard && DIR_ACTIONS.includes(a)) for (const x of input.defaultPadMap(w.index)?.[a] ?? []) if (x.t === 'a' && !same(x, got)) keep.push(x);
      w.draft[a] = [got, ...keep];
      audio.sfx('confirm');
    } else audio.sfx('cursor');
    w.step++;
    if (w.step >= PAD_ACTIONS.length) {
      input.setPadMap(w.id, w.draft);
      input.releasePad();
      this.wiz = null;
      this.message = 'C’est enregistré ! Vérifie avec TESTER.';
      this.renderList('test');
      return;
    }
    this.wizShow();
  }

  private wizCancel(msg = 'Configuration annulée : rien n’a changé.') {
    input.releasePad();
    this.wiz = null;
    audio.sfx('cancel');
    this.message = msg;
    this.renderList('config');
  }

  // ---- input display
  private startTest(p: PadInfo) {
    audio.sfx('confirm');
    this.mode = 'test';
    this.testIndex = p.index;
    this.startSince = 0;
    this.testRest = (input.padState(p.index)?.axes ?? []).map((v) => (Math.abs(v) < 0.35 ? 0 : v));
    input.claimPad(p.index);
    input.takePadTaps(p.index);
    this.viz = new PadViz();
    this.rawEl = h('div', { class: 'pads-raw' });
    const done = h('button', { class: 'btn primary' }, 'TERMINER');
    done.addEventListener('click', () => this.endTest());
    this.body.replaceChildren(
      h(
        'div',
        { class: 'panel pads-wiz pads-test' },
        h('div', { class: 'pads-h' }, 'TESTER · ' + padName(p.id)),
        h('div', { class: 'pads-sub' }, 'Ce que le jeu reçoit, en direct (haut + bas = haut, gauche + droite = neutre).'),
        this.viz.el,
        this.rawEl,
        h('div', { class: 'pads-sub' }, 'Maintiens START pour quitter.'),
        h('div', { class: 'pads-actions' }, done),
      ),
    );
    this.nav.set([[done]], done);
  }

  private endTest() {
    input.releasePad();
    this.testIndex = -1;
    audio.sfx('cancel');
    this.renderList('test');
  }

  /** "B2 · B5 · POV ↑ · Axe 3 +": what the controller sends, mapped or not (helps with odd sticks) */
  private rawText(index: number, standard: boolean, kind: PadKind): string {
    const st = input.padState(index);
    if (!st) return '';
    const parts: string[] = [];
    st.buttons.forEach((on, i) => on && parts.push(inputLabel({ t: 'b', i }, standard, kind)));
    st.axes.forEach((v, i) => {
      if (st.hats[i]) {
        const b = hatBits(v);
        if (b) parts.push('POV ' + (b & IN_UP ? '↑' : '') + (b & IN_DOWN ? '↓' : '') + (b & IN_LEFT ? '←' : '') + (b & IN_RIGHT ? '→' : ''));
        return;
      }
      // where it rested when the test began (a trigger rests at -1)
      const rest = this.testRest[i] ?? 0;
      if (Math.abs(v - rest) > 0.5) parts.push(inputLabel({ t: 'a', i, d: v < rest ? -1 : 1 }, standard, kind) + ` (${v.toFixed(2)})`);
    });
    return 'Reçu : ' + (parts.length ? parts.join(' · ') : 'rien');
  }

  // ---- loop
  frame(dt: number) {
    const events = input.menuEvents();
    const pads = input.padList();
    if (this.mode === 'list') {
      // the controller used last is the one shown
      if (input.padSeq !== this.seq) {
        this.seq = input.padSeq;
        if (input.lastPad !== this.sel && pads.some((p) => p.index === input.lastPad)) {
          this.sel = input.lastPad;
          this.renderList();
        }
      }
      if (this.key(pads) !== this.listKey) this.renderList(this.focusRole());
      for (const e of events) {
        if (this.mode !== 'list') break;
        if (e.action === 'back') return this.leave();
        if (e.action === 'up') this.nav.move(-1, 0);
        else if (e.action === 'down') this.nav.move(1, 0);
        else if (e.action === 'left') this.nav.move(0, -1);
        else if (e.action === 'right') this.nav.move(0, 1);
        else if (e.action === 'confirm' || e.action === 'start') this.nav.current?.click();
      }
    } else if (this.mode === 'wizard' && this.wiz) {
      const w = this.wiz;
      if (!pads.some((p) => p.index === w.index && p.id === w.id)) {
        this.wizCancel('Manette débranchée : configuration annulée.');
      } else {
        // the claimed controller makes no menu events: these come from the keyboard / other pads
        for (const e of events) {
          if (e.action === 'back') return this.wizCancel();
          if (e.action === 'confirm' || e.action === 'start') {
            this.wizNext(null);
            if (!this.wiz) break;
          }
        }
        const got = this.wiz ? input.takeCapture() : null;
        if (got) this.wizNext(got);
        if (this.wiz && this.viz) {
          this.subEl!.textContent = input.captureArmed ? 'Levier, croix, stick ou bouton : une seule pression.' : 'Relâche tout…';
          this.subEl!.classList.toggle('wait', !input.captureArmed);
          const st = input.padState(this.wiz.index);
          this.viz.update(input.padDirs(this.wiz.index), st?.held ?? 0, 0, PAD_ACTIONS[this.wiz.step]);
        }
      }
    } else if (this.mode === 'test') {
      const p = pads.find((q) => q.index === this.testIndex);
      if (!p) {
        this.endTest();
      } else {
        for (const e of events) {
          if (e.action === 'back' || e.action === 'confirm' || e.action === 'start') return this.endTest();
        }
        const held = input.padState(p.index)?.held ?? 0;
        this.viz?.update(input.padDirs(p.index), held, input.takePadTaps(p.index), null);
        if (this.rawEl) this.rawEl.textContent = this.rawText(p.index, p.standard, padKind(p.id));
        // hold START (1 s) to leave with the controller itself
        if (held & PAD_BIT.start) {
          if (!this.startSince) this.startSince = performance.now();
          else if (performance.now() - this.startSince > 900) return this.endTest();
        } else this.startSince = 0;
      }
    }
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
