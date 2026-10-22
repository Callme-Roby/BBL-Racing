import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { ROSTER, type BodyType, type FaceGen, type FighterDef, type HairStyle, type TopStyle } from '../data/roster';
import { catalogueOf } from './rosterPages';
import { loadCustoms, saveCustoms } from '../game/settings';
import { input } from '../input/input';
import { cropFileToDataUrl } from '../render/faceTexture';
import { Showroom } from '../render/showroom';
import { backButton, h, phoneLayout, uiRoot } from '../ui/dom';
import { goMenu } from './flow';
import { PROFILE_INFO } from '../data/kartStats';
import type { Archetype } from '../data/roster';
import { profileBadge } from './profile';

function blank(): FighterDef {
  return {
    id: 'custom-' + Date.now().toString(36),
    name: 'NOUVEAU',
    title: 'Fait maison',
    face: '',
    skin: '#c8906c',
    hair: { style: 'short', color: '#3a2618' },
    outfit: { top: 'tank', topColor: '#f2f0e8', trimColor: '#d0ccc0', pantsColor: '#3b5a8c', shoesColor: '#1d1d1f', beltColor: '#4a2f1c' },
    build: 1,
    body: 'standard',
    headScale: 1.18,
    introLines: ['Je vais te tuer.'],
    winLines: ['Trop facile.'],
    superLines: ['Prends ça… BBL BUSTER !'],
    voice: { lang: 'fr-FR', pitch: 1, rate: 1 },
    faceGen: {},
    custom: true,
  };
}

/** Fighter creator: upload a photo, crop the face, pick hair & clothes. */
export class LabScreen implements Screen {
  private def: FighterDef = blank();
  private showroom = new Showroom();
  private src: string | null = null;
  private crop = { cx: 0.5, cy: 0.42, zoom: 1.6 };
  private cropCanvas!: HTMLCanvasElement;
  private img: HTMLImageElement | null = null;
  private form!: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private rebuildTimer = 0;
  private msg!: HTMLDivElement;
  private previewEl!: HTMLDivElement;

  constructor(private app: App) {
    this.showroom.positions = [0, 1.15];
    const wide = window.innerWidth > 720;
    this.showroom.cameraPos.set(wide ? -0.6 : 0, wide ? 1.45 : 1.6, wide ? 2.9 : 2.2);
    this.showroom.cameraLook.set(wide ? -0.6 : 0, wide ? 1.15 : 1.25, 0);
  }

  enter() {
    audio.playMusic('select');
    this.form = h('div', { class: 'form' });
    this.listEl = h('div', { class: 'customs' });
    this.msg = h('div', { class: 'status' });
    this.previewEl = h('div', { class: 'preview passthrough' });
    uiRoot().append(h('div', { class: 'lab' }, this.form, this.previewEl));
    this.renderForm();
    this.preview();
  }

  exit() {
    this.showroom.dispose();
    window.clearTimeout(this.rebuildTimer);
  }

  private preview() {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.showroom.invalidate();
      void this.showroom.show(0, { ...this.def });
    }, 120);
  }

  private async updateFace() {
    if (!this.src) return;
    this.def.face = await cropFileToDataUrl(this.src, this.crop, 150, 200);
    this.def.skin = undefined; // sample it from the photo
    this.drawCrop();
    this.preview();
  }

  private drawCrop() {
    const c = this.cropCanvas;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, c.width, c.height);
    if (!this.def.face) {
      ctx.fillStyle = '#888';
      ctx.font = '10px monospace';
      ctx.fillText('pas de photo', 40, 120);
      return;
    }
    const im = new Image();
    im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height);
    im.src = this.def.face;
  }

  private renderForm() {
    const d = this.def;
    const field = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'field' }, label, ...els);
    const row = (...els: HTMLElement[]) => h('div', { class: 'row' }, ...els);
    const text = (value: string, max: number, set: (v: string) => void) => {
      const i = h('input', { value, maxLength: max });
      i.addEventListener('input', () => {
        set(i.value);
        this.preview();
      });
      return i;
    };
    const color = (value: string, set: (v: string) => void) => {
      const i = h('input', { type: 'color', value });
      i.addEventListener('input', () => {
        set(i.value);
        this.preview();
      });
      return i;
    };
    const range = (min: number, max: number, stepv: number, value: number, set: (v: number) => void) => {
      const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(stepv), value: String(value) });
      i.addEventListener('input', () => {
        set(Number(i.value));
        this.preview();
      });
      return i;
    };
    const chips = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'chips' });
      const render = () =>
        wrap.replaceChildren(
          ...opts.map(([v, l]) => {
            const b = h('button', { class: get() === v ? 'on' : '' }, l);
            b.addEventListener('click', () => {
              set(v);
              render();
              this.preview();
            });
            return b;
          }),
        );
      render();
      return wrap;
    };
    /** several independent on/off buttons */
    const toggles = (opts: [string, string, () => boolean, (on: boolean) => void][]) => {
      const wrap = h('div', { class: 'chips' });
      const render = () =>
        wrap.replaceChildren(
          ...opts.map(([, l, get, set]) => {
            const b = h('button', { class: get() ? 'on' : '' }, l);
            b.addEventListener('click', () => {
              set(!get());
              render();
              this.preview();
            });
            return b;
          }),
        );
      render();
      return wrap;
    };
    const fgFlag = (key: 'glasses' | 'sunglasses' | 'moustache' | 'beard' | 'freckles', label: string): [string, string, () => boolean, (on: boolean) => void] => [
      key,
      label,
      () => !!d.faceGen?.[key],
      (on) => (d.faceGen = { ...d.faceGen, [key]: on } as FaceGen),
    ];
    const capColor = () => d.accessories?.cap ?? (d.hair.style === 'bandana' ? '#2a8a3a' : d.hair.style === 'beanie' ? '#1c1c20' : '#c83030');
    const capInput = color(capColor(), (v) => (d.accessories = { ...d.accessories, cap: v }));

    // photo
    const file = h('input', { type: 'file', accept: 'image/*' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.src = String(reader.result);
        this.img = new Image();
        this.img.src = this.src;
        this.crop = { cx: 0.5, cy: 0.42, zoom: 1.6 };
        this.renderForm();
        void this.updateFace();
      };
      reader.readAsDataURL(f);
    });
    this.cropCanvas = h('canvas', { class: 'crop', width: 150, height: 200 });
    const cropRange = (label: string, key: 'cx' | 'cy' | 'zoom', min: number, max: number) => {
      const i = h('input', { type: 'range', min: String(min), max: String(max), step: '0.01', value: String(this.crop[key]) });
      i.addEventListener('input', () => {
        this.crop[key] = Number(i.value);
        void this.updateFace();
      });
      return field(label, i);
    };

    const save = h('button', { class: 'btn primary' }, 'ENREGISTRER');
    save.addEventListener('click', () => this.save());
    const fresh = h('button', { class: 'btn' }, 'NOUVEAU');
    fresh.addEventListener('click', () => {
      this.def = blank();
      this.src = null;
      this.renderForm();
      this.preview();
    });
    const testVoice = h('button', { class: 'btn' }, 'TESTER LA VOIX');
    testVoice.addEventListener('click', () => {
      audio.unlock();
      void audio.say(d.introLines[0] || 'Je vais te tuer.', { lang: 'fr-FR', pitch: d.voice?.pitch, rate: d.voice?.rate });
    });
    const back = h('button', { class: 'btn' }, 'RETOUR');
    back.addEventListener('click', () => goMenu());

    this.form.replaceChildren(
      h('div', { class: 'lab-head' }, backButton(() => goMenu()), h('div', { class: 'h1' }, 'LABO')),
      field('1. PHOTO DU VISAGE (de face, bien éclairée)', file),
      this.cropCanvas,
      this.src ? cropRange('ZOOM', 'zoom', 1, 4) : '',
      this.src ? cropRange('CADRAGE HORIZONTAL', 'cx', 0, 1) : '',
      this.src ? cropRange('CADRAGE VERTICAL', 'cy', 0, 1) : '',
      h('div', { class: 'status', style: 'font-size:9px;text-align:left' }, 'Cadre le visage dans l’ovale : du haut du front au menton.'),
      field('2. NOM', text(d.name, 12, (v) => (d.name = v.toUpperCase() || 'NOUVEAU'))),
      field('SURNOM', text(d.title, 32, (v) => (d.title = v))),
      // driving profile (stats of the kart)
      field(
        'PROFIL DE PILOTE',
        chips<Archetype>(
          (['balanced', 'heavy', 'fast', 'ranged'] as Archetype[]).map((a) => [a, PROFILE_INFO[a].label]),
          () => d.archetype ?? 'balanced',
          (v) => (d.archetype = v),
        ),
      ),
      h('div', { class: 'status', style: 'font-size:9px;text-align:left' }, profileBadge(PROFILE_INFO[d.archetype ?? 'balanced'], 'mini'), ' ', PROFILE_INFO[d.archetype ?? 'balanced'].line),
      field(
        'CHEVEUX',
        chips<HairStyle>(
          [
            ['short', 'COURTS'],
            ['curlyshort', 'BOUCLES COURTES'],
            ['spiky', 'PIQUES'],
            ['buzz', 'RASÉS'],
            ['afro', 'AFRO'],
            ['bigafro', 'AFRO XXL'],
            ['midlong', 'MI-LONGS'],
            ['wavy', 'LONGS ONDULÉS'],
            ['curlymid', 'BOUCLÉS'],
            ['long', 'LONGS'],
            ['dreads', 'DREADS'],
            ['mohawk', 'IROQUOIS'],
            ['tahiti', 'PALMIER'],
            ['ssj', 'SUPER SAYAN'],
            ['ponytail', 'QUEUE'],
            ['bun', 'CHIGNON'],
            ['cap', 'CASQUETTE'],
            ['beanie', 'BONNET'],
            ['bandana', 'BANDANA'],
            ['bald', 'CHAUVE'],
          ],
          () => d.hair.style,
          (v) => {
            d.hair.style = v;
            // headwear gets its own colour so the hair still shows under it
            if ((v === 'cap' || v === 'beanie' || v === 'bandana') && !d.accessories?.cap) {
              d.accessories = { ...d.accessories, cap: capColor() };
              capInput.value = capColor();
            }
          },
        ),
        row(
          color(d.hair.color, (v) => {
            d.hair.color = v;
            if (d.beard3d) d.beard3d = { ...d.beard3d, color: v };
          }),
        ),
      ),
      field('COULEUR CASQUETTE / BONNET / BANDANA', row(capInput)),
      field(
        'HAUT',
        chips<TopStyle>(
          [
            ['tank', 'DÉBARDEUR'],
            ['tshirt', 'T-SHIRT'],
            ['tracksuit', 'SURVÊT'],
            ['hoodie', 'SWEAT'],
            ['suit', 'COMBI'],
            ['shirtless', 'TORSE NU'],
          ],
          () => d.outfit.top,
          (v) => (d.outfit.top = v),
        ),
        row(color(d.outfit.topColor, (v) => (d.outfit.topColor = v)), color(d.outfit.trimColor, (v) => (d.outfit.trimColor = v))),
        toggles([
          ['shorts', 'SHORT', () => !!d.outfit.shorts, (on) => (d.outfit = { ...d.outfit, shorts: on || undefined })],
          ['web', 'MOTIF TOILE (COMBI)', () => !!d.outfit.web, (on) => (d.outfit = { ...d.outfit, web: on ? '#141418' : undefined })],
        ]),
      ),
      field('PANTALON / CHAUSSURES', row(color(d.outfit.pantsColor, (v) => (d.outfit.pantsColor = v)), color(d.outfit.shoesColor, (v) => (d.outfit.shoesColor = v)))),
      field('CARRURE', range(0.85, 1.25, 0.01, d.build ?? 1, (v) => (d.build = v))),
      field(
        'SILHOUETTE',
        chips<BodyType>(
          [
            ['standard', 'STANDARD'],
            ['fine', 'FINE'],
          ],
          () => d.body ?? 'standard',
          (v) => (d.body = v),
        ),
      ),
      field('BIDON', range(0, 1, 0.05, d.belly ?? 0, (v) => (d.belly = v))),
      field('MUSCLES', range(0, 1, 0.05, d.muscles ?? 0, (v) => (d.muscles = v || undefined))),
      field(
        'BARBE 3D (couleur des cheveux)',
        chips<'none' | 'short' | 'big'>(
          [
            ['none', 'AUCUNE'],
            ['short', 'COURTE'],
            ['big', 'GROSSE'],
          ],
          () => (!d.beard3d ? 'none' : (d.beard3d.size ?? 1) > 1.1 ? 'big' : 'short'),
          (v) => (d.beard3d = v === 'none' ? undefined : { color: d.hair.color, size: v === 'big' ? 1.35 : 0.8 }),
        ),
      ),
      field(
        'ACCESSOIRES',
        chips<'none' | 'chain' | 'whistle'>(
          [
            ['none', 'AUCUN'],
            ['chain', 'CHAÎNE EN OR'],
            ['whistle', 'CHAÎNE + SIFFLET'],
          ],
          () => (d.accessories?.chain ? (d.accessories.whistle ? 'whistle' : 'chain') : 'none'),
          (v) => (d.accessories = { ...d.accessories, chain: v !== 'none', whistle: v === 'whistle' }),
        ),
      ),
      field(
        'VISAGE SANS PHOTO',
        toggles([
          fgFlag('glasses', 'LUNETTES'),
          fgFlag('sunglasses', 'LUNETTES NOIRES'),
          fgFlag('moustache', 'MOUSTACHE'),
          fgFlag('beard', 'BARBE'),
          fgFlag('freckles', 'TACHES DE ROUSSEUR'),
          ['mask', 'MASQUE ARAIGNÉE (couleur = peau)', () => d.faceGen?.mask === 'spider', (on) => (d.faceGen = { ...d.faceGen, mask: on ? 'spider' : undefined })],
        ]),
      ),
      field('TAILLE DE LA TÊTE', range(1, 1.4, 0.01, d.headScale ?? 1.18, (v) => (d.headScale = v))),
      field('PHRASE D’ENTRÉE', text(d.introLines[0] ?? '', 60, (v) => (d.introLines = [v || 'Je vais te tuer.']))),
      field('PHRASE DE VICTOIRE', text(d.winLines[0] ?? '', 60, (v) => (d.winLines = [v || 'Trop facile.']))),
      field('PHRASE DE L’ULTIME', text(d.superLines?.[0] ?? '', 50, (v) => (d.superLines = v ? [v] : undefined))),
      field('VOIX (GRAVE ↔ AIGUË)', range(0.3, 1.8, 0.05, d.voice?.pitch ?? 1, (v) => (d.voice = { ...d.voice, pitch: v }))),
      h('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap' }, save, testVoice, fresh, back),
      this.msg,
      field('MES PERSOS'),
      this.listEl,
    );
    this.drawCrop();
    this.renderList();
  }

  private renderList() {
    const list = loadCustoms();
    if (!list.length) {
      this.listEl.replaceChildren(h('div', { class: 'status', style: 'font-size:9px' }, 'Aucun perso perso pour l’instant.'));
      return;
    }
    this.listEl.replaceChildren(
      ...list.map((c) => {
        const edit = h('button', { class: 'btn', style: 'padding:6px 8px;font-size:9px' }, 'MODIFIER');
        edit.addEventListener('click', () => {
          this.def = structuredClone(c);
          this.src = null;
          this.renderForm();
          this.preview();
        });
        const del = h('button', { class: 'btn', style: 'padding:6px 8px;font-size:9px' }, 'X');
        del.addEventListener('click', () => {
          if (!confirm(`Supprimer ${c.name} ?`)) return;
          saveCustoms(loadCustoms().filter((x) => x.id !== c.id));
          this.renderList();
        });
        return h('div', { class: 'it' }, h('div', { class: 'ph', style: c.face ? `background-image:url(${c.face})` : '' }), h('span', null, c.name), edit, del);
      }),
    );
  }

  private save() {
    const list = loadCustoms().filter((x) => x.id !== this.def.id);
    list.push(structuredClone(this.def));
    if (saveCustoms(list)) {
      this.msg.textContent = `${this.def.name} est prêt au combat ! Il apparaît dans la sélection${new Set(catalogueOf(ROSTER)).size > 1 ? ' (dernier catalogue)' : ''}.`;
      this.msg.classList.remove('err');
      audio.sfx('confirm');
    } else {
      this.msg.textContent = 'Stockage plein : supprime un perso.';
      this.msg.classList.add('err');
    }
    this.renderList();
  }

  frame(dt: number) {
    for (const e of input.menuEvents()) {
      if (e.action === 'back' && !(document.activeElement instanceof HTMLInputElement)) {
        goMenu();
        return;
      }
    }
    // phones: the fighter (head to knees) fills the preview box, above / beside the form
    const r = phoneLayout() ? this.previewEl.getBoundingClientRect() : null;
    this.showroom.fit = r && r.width > 40 && r.height > 40 ? { box: r, worldH: 1.65, worldW: 1.3, centerY: 1.36, slotX: [r.left + r.width / 2, r.right + r.width] } : null;
    this.showroom.render(this.app.pipeline, dt, this.app.aspect);
  }
}
