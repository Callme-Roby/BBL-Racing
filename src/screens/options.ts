import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { saveSettings, settings } from '../game/settings';
import { input } from '../input/input';
import { Showroom } from '../render/showroom';
import { backButton, h, syncTouchUi, uiRoot } from '../ui/dom';
import { ControllersScreen } from './controllers';
import { goMenu } from './flow';
import { controlsHelp } from './help';

function chips<T extends string | number>(options: [T, string][], get: () => T, set: (v: T) => void) {
  const wrap = h('div', { class: 'chips' });
  const render = () => {
    wrap.replaceChildren(
      ...options.map(([v, label]) => {
        const b = h('button', { class: get() === v ? 'on' : '' }, label);
        b.addEventListener('click', () => {
          set(v);
          audio.sfx('cursor');
          render();
        });
        return b;
      }),
    );
  };
  render();
  return wrap;
}

/** A row of the options moved through with the keyboard / a controller (↑ ↓), changed with ← → or confirm. */
interface NavItem {
  el: HTMLElement;
  /** ← / → (-1 / 1) */
  step?: (d: number) => void;
  press?: () => void;
}

/** chips field: ← → pick the neighbour, confirm the next one (wrapping) */
function chipsItem(field: HTMLElement): NavItem {
  const pick = (d: number, wrap: boolean) => {
    const bs = Array.from(field.querySelectorAll<HTMLButtonElement>('.chips button'));
    const i = bs.findIndex((b) => b.classList.contains('on'));
    let j = i + d;
    if (wrap) j = (j + bs.length) % bs.length;
    bs[j]?.click();
  };
  return { el: field, step: (d) => pick(d, false), press: () => pick(1, true) };
}

function sliderItem(field: HTMLElement): NavItem {
  const inp = field.querySelector('input')!;
  return {
    el: field,
    step: (d) => {
      const v = Math.max(0, Math.min(1, Math.round((Number(inp.value) + d * 0.05) * 20) / 20));
      if (String(v) === inp.value) return;
      inp.value = String(v);
      inp.dispatchEvent(new Event('input'));
    },
  };
}

export class OptionsScreen implements Screen {
  private showroom = new Showroom();
  private nav: NavItem[] = [];
  private at = 0;
  private padsSub: HTMLElement | null = null;
  private padsCount = -1;

  constructor(private app: App) {}

  enter() {
    const vol = audio.getVolumes();
    const slider = (label: string, key: keyof typeof vol) => {
      const inp = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(vol[key]) });
      inp.addEventListener('input', () => {
        audio.setVolumes({ [key]: Number(inp.value) });
        if (key === 'sfx') audio.sfx('turbo');
      });
      return h('label', { class: 'field' }, label, inp);
    };
    const apply = () => {
      saveSettings();
      this.app.applySettings();
      this.app.touch.refresh();
      syncTouchUi();
    };
    const back = h('button', { class: 'btn primary' }, 'RETOUR');
    back.addEventListener('click', () => goMenu());
    // gamepads & arcade sticks: their own screen (src/screens/controllers.ts)
    this.padsSub = h('span', { class: 'sub' });
    const pads = h('button', { class: 'btn pads-open' }, 'MANETTES & STICKS', this.padsSub);
    pads.addEventListener('click', () => {
      audio.sfx('confirm');
      this.app.go(new ControllersScreen(this.app));
    });
    const fields = [
      h('div', { class: 'field' }, 'DIFFICULTÉ DU CPU', chips([['easy', 'FACILE'], ['normal', 'NORMAL'], ['hard', 'DUR']], () => settings.difficulty, (v) => ((settings.difficulty = v), apply()))),
      h('div', { class: 'field' }, 'CYLINDRÉE', chips([[50, '50cc'], [100, '100cc'], [150, '150cc']], () => settings.cc, (v) => ((settings.cc = v as 50 | 100 | 150), apply()))),
      h('div', { class: 'field' }, 'TOURS PAR COURSE', chips([[2, '2'], [3, '3'], [5, '5']], () => settings.laps, (v) => ((settings.laps = v), apply()))),
      h('div', { class: 'field' }, 'PILOTES EN COURSE', chips([[8, '8'], [10, '10'], [12, '12']], () => settings.racers, (v) => ((settings.racers = v), apply()))),
      h('div', { class: 'field' }, 'OBJETS', chips([[1, 'OUI'], [0, 'NON']], () => (settings.items ? 1 : 0), (v) => ((settings.items = v === 1), apply()))),
      h('div', { class: 'field' }, 'ACCÉLÉRATION AUTO (TACTILE)', chips([[1, 'OUI'], [0, 'NON']], () => (settings.autoAccel ? 1 : 0), (v) => ((settings.autoAccel = v === 1), apply()))),
      h(
        'div',
        { class: 'field' },
        'RÉSOLUTION (PLUS BAS = PLUS RÉTRO)',
        chips([[240, '240p PS1'], [270, '270p'], [360, '360p'], [480, '480p'], [720, '720p']], () => settings.lines, (v) => ((settings.lines = v), apply())),
      ),
      h('div', { class: 'field' }, 'TRAMAGE 15 BITS', chips([[1, 'OUI'], [0, 'NON']], () => (settings.dither ? 1 : 0), (v) => ((settings.dither = v === 1), apply()))),
      h('div', { class: 'field' }, 'COMMANDES TACTILES', chips([['auto', 'AUTO'], ['on', 'TOUJOURS'], ['off', 'JAMAIS']], () => settings.touch, (v) => ((settings.touch = v), apply()))),
    ];
    const sliders = [slider('VOLUME GÉNÉRAL', 'master'), slider('MUSIQUE', 'music'), slider('BRUITAGES', 'sfx'), slider('VOIX', 'voice')];
    uiRoot().append(
      h(
        'div',
        { class: 'screen dim options-screen', style: 'overflow-y:auto;justify-content:flex-start;touch-action:pan-y' },
        h('div', { class: 'h1' }, 'OPTIONS'),
        h('div', { class: 'panel options options-main' }, h('div', { class: 'field pads-field' }, pads), ...fields, ...sliders),
        h(
          'div',
          { class: 'options-keys-wrap' },
          // touch screens: the on-screen controls; keyboards: the keys (the CSS follows the setting live)
          h('div', { class: 'panel options touch-only' }, controlsHelp(false, true)),
          h('div', { class: 'panel options kbd-only' }, h('div', { class: 'field' }, 'COMMANDES (1 JOUEUR)'), controlsHelp(false)),
          h('div', { class: 'panel options kbd-only' }, h('div', { class: 'field' }, 'COMMANDES (ÉCRAN PARTAGÉ, MÊME CLAVIER)'), controlsHelp(true)),
        ),
        back,
        // scrolls away with the page (RETOUR again at the bottom)
        backButton(() => goMenu()),
      ),
    );
    this.nav = [{ el: pads, press: () => pads.click() }, ...fields.map(chipsItem), ...sliders.map(sliderItem), { el: back, press: () => back.click() }];
    this.at = 0;
    this.focus(false);
    this.updatePads();
  }

  exit() {
    this.showroom.dispose();
  }

  private focus(scroll: boolean) {
    this.nav.forEach((it, i) => it.el.classList.toggle('kfocus', i === this.at));
    if (scroll) this.nav[this.at]?.el.scrollIntoView?.({ block: 'nearest' });
  }

  /** "2 connectées · configurer, tester" under MANETTES & STICKS */
  private updatePads() {
    const n = input.padList().length;
    if (n === this.padsCount || !this.padsSub) return;
    this.padsCount = n;
    this.padsSub.textContent = n === 0 ? 'Aucune branchée · sticks arcade, manettes' : `${n} branchée${n > 1 ? 's' : ''} · configurer, tester`;
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (e.action === 'back') {
        audio.sfx('cancel');
        goMenu();
        return;
      }
      const it = this.nav[this.at];
      if (e.action === 'up' || e.action === 'down') {
        const j = Math.max(0, Math.min(this.nav.length - 1, this.at + (e.action === 'up' ? -1 : 1)));
        if (j !== this.at) audio.sfx('cursor');
        this.at = j;
        this.focus(true);
      } else if (e.action === 'left' || e.action === 'right') it?.step?.(e.action === 'left' ? -1 : 1);
      else if (e.action === 'confirm' || e.action === 'start') {
        it?.press?.();
        // the screen may have changed (MANETTES & STICKS, RETOUR)
        if (it === this.nav[0] || it === this.nav[this.nav.length - 1]) return;
      }
    }
    this.updatePads();
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
