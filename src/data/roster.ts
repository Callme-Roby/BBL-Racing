/**
 * ROSTER — edit this file to add your friends!
 *
 * Each fighter needs a face photo in `public/faces/` (a tight crop of the face,
 * portrait 3:4, hairline to chin — see public/faces/README.md). Everything else
 * is optional. Custom fighters can also be created in-game ("LABO").
 *
 * Fighters without a photo (`face: ''`) get a procedural pixel face built from
 * `faceGen` (eyes, brows, beard, sunglasses...).
 *
 * Body sizes: `height` scales the whole fighter (tall ≈ 1.08–1.1, short ≈ 0.92),
 * `build` widens it (0.88 slim … 1.28 thick), `body: 'fine'` gives a slimmer
 * silhouette, `belly` adds a round tummy.
 *
 * Non-playable cinematic characters (Baby Elies, Spider-Pote...) live in `cast.ts`.
 */

/** driving profile, mirrors the fight profile of BBL FIGHTERZ (lab creations are balanced) */
export type Archetype = 'heavy' | 'fast' | 'ranged' | 'balanced';

export type HairStyle =
  | 'spiky'
  /** short spiky crop with a short fringe falling on the forehead */
  | 'spikyfringe'
  | 'short'
  /** short, tight curls on top, short on the sides */
  | 'curlyshort'
  | 'buzz'
  | 'bald'
  | 'afro'
  | 'long'
  | 'mohawk'
  | 'ponytail'
  | 'bun'
  /** backwards baseball cap (colour: `accessories.cap`, else hair colour) */
  | 'cap'
  /** knit beanie worn low on the forehead (colour: `accessories.cap`, else hair colour; with a cap colour, the hair shows under it) */
  | 'beanie'
  /** bandana tied on the head, knot at the back (colour: `accessories.cap`, else hair colour) */
  | 'bandana'
  /** straight hair down to the chin / neck, covering the sides and back, open in front of the face */
  | 'midlong'
  /** long wavy hair falling to the shoulders (sides and back), open in front of the face */
  | 'wavy'
  /** voluminous curly / wavy mid-length cut: curls on top, over the ears, down to the jaw */
  | 'curlymid'
  /** huge, tall, spiky palm-tree mass of hair */
  | 'tahiti'
  /** long locks down to the belly (lower part drapes with the chest / spine) */
  | 'dreads'
  /** very voluminous afro */
  | 'bigafro'
  /** "super sayan": huge golden spikes standing up, slightly glowing */
  | 'ssj';

/** Every hair style, in the order shown by the lab (also used to validate network data). */
export const HAIR_STYLES: readonly HairStyle[] = [
  'short',
  'curlyshort',
  'spiky',
  'spikyfringe',
  'buzz',
  'afro',
  'bigafro',
  'midlong',
  'wavy',
  'curlymid',
  'long',
  'dreads',
  'mohawk',
  'tahiti',
  'ssj',
  'ponytail',
  'bun',
  'cap',
  'beanie',
  'bandana',
  'bald',
];

/** 'suit' = skin-tight full bodysuit (topColor main, trimColor side panels, pantsColor legs, shoesColor boots). */
export type TopStyle = 'tank' | 'tshirt' | 'tracksuit' | 'shirtless' | 'hoodie' | 'suit';

/** Silhouette: 'standard' (default) or 'fine' (narrower shoulders/chest, slimmer limbs, slightly wider hips). */
export type BodyType = 'standard' | 'fine';

export interface Outfit {
  top: TopStyle;
  topColor: string;
  /** stripe / trim colour (tracksuit stripes, tank-top hem, bodysuit side panels...) */
  trimColor: string;
  pantsColor: string;
  shoesColor: string;
  beltColor?: string;
  /** colour of the wrist bands / gloves (optional) */
  wristColor?: string;
  /** colour of a few stains on the top (barbecue sauce...) */
  stains?: string;
  /** wide, baggy trousers piling up on the sneakers */
  baggy?: boolean;
  /** shorts down to the knees (bare shins, white socks) */
  shorts?: boolean;
  /** thin web-line grid drawn over the main colour of a 'suit' (line colour) */
  web?: string;
}

export interface Accessories {
  /** gold chain around the neck (with a small medallion) */
  chain?: boolean;
  /** hang a whistle on the chain instead of the medallion */
  whistle?: boolean;
  /**
   * headwear colour (hex) for the 'cap', 'beanie' and 'bandana' hair styles. When set,
   * `hair.color` shows under it (sides / back); otherwise the headwear uses `hair.color`.
   */
  cap?: string;
}

/** Procedural pixel face options (only used when `face` is empty). */
export interface FaceGen {
  /** iris colour */
  eyes?: string;
  /** eyebrow colour */
  brows?: string;
  /** eyebrow thickness, 0.5 (thin) .. 2 (bushy), default 1 */
  browSize?: number;
  /** full short beard (jaw + chin + moustache) */
  beard?: boolean;
  /** chin beard */
  goatee?: boolean;
  moustache?: boolean;
  /** three-day shadow */
  stubble?: boolean;
  /** beard / moustache colour (defaults to the brow colour) */
  beardColor?: string;
  glasses?: boolean;
  sunglasses?: boolean;
  lips?: string;
  wrinkles?: boolean;
  freckles?: boolean;
  /** small scar across the left eyebrow */
  scar?: boolean;
  /** rosy cheeks */
  blush?: boolean;
  mouth?: 'neutral' | 'smile' | 'smirk' | 'frown' | 'grin';
  /**
   * full-head hero mask instead of a face: 'spider' = web lines + big white eye lenses outlined
   * in black. The mask colour is the fighter's `skin` (also used for the neck / hands).
   */
  mask?: 'spider';
  /** line colour of the mask (web + lens outlines), default near-black */
  maskLine?: string;
}

export interface FighterDef {
  id: string;
  name: string;
  /** character profile (heavy / fast / ranged / balanced); lab creations are balanced */
  archetype?: Archetype;
  /** select-screen catalogue (1 = first page, 2 = second page; default 1) */
  page?: number;
  /** short line under the name on the select screen */
  title: string;
  /** face photo url (relative, no leading slash) or data URL */
  face: string;
  /** true while the friend's photo hasn't arrived yet (a procedural placeholder face is used) */
  photoPending?: boolean;
  /** skin colour override (hex). When omitted it is sampled from the photo's cheeks. */
  skin?: string;
  hair: { style: HairStyle; color: string };
  outfit: Outfit;
  /** body build: 1 = normal, 0.88 = slim, 1.15+ = beefy (CJ after the gym) */
  build?: number;
  /** silhouette, see BodyType (default 'standard') */
  body?: BodyType;
  /** round belly, 0 (none) .. 1 (barbecue king) */
  belly?: number;
  /** bodybuilder muscles, 0 (none) .. 1 (huge arms / shoulders / chest / thighs), on top of `build` */
  muscles?: number;
  /** 3D beard volume around the jaw / chin / lower cheeks (below the mouth, never over the face) */
  beard3d?: { color: string; /** 0.5 (short) .. 1.6 (huge), default 1 */ size?: number };
  accessories?: Accessories;
  /** head size multiplier (bigger heads = more recognisable faces) */
  headScale?: number;
  /** overall size (uniform scale): 1 = medium, ~1.1 = tall, ~0.92 = short */
  height?: number;
  /** lines said during the intro (one is picked at random) */
  introLines: string[];
  winLines: string[];
  /** big line shouted during the BBL MAX (ultimate) close-up */
  superLines?: string[];
  /** BBL MAX cinematic script id (src/sim/ultimates.ts) — built-in fighters use src/data/ultimates.ts */
  ultimate?: string;
  /** title shown when the BBL MAX starts (custom fighters) */
  ultimateName?: string;
  voice?: {
    lang?: string;
    pitch?: number;
    rate?: number;
    /** optional recorded files (relative urls), e.g. 'audio/voices/dylan_intro.mp3' */
    introFile?: string;
    winFile?: string;
  };
  /** procedural pixel face used when `face` is empty */
  faceGen?: FaceGen;
  /** true for fighters created in the in-game lab */
  custom?: boolean;
}

export const ROSTER: FighterDef[] = [
  {
    id: 'dylan',
    name: 'DYLAN',
    archetype: 'heavy',
    title: 'Petit format, gros dégâts',
    face: 'faces/dylan.jpg',
    hair: { style: 'short', color: '#5a3a28' },
    outfit: {
      top: 'tank',
      topColor: '#f2f0e8',
      trimColor: '#d8d4c8',
      pantsColor: '#3b5a8c',
      shoesColor: '#1d1d1f',
      beltColor: '#4a2f1c',
    },
    // shorter but thick
    height: 0.92,
    build: 1.28,
    belly: 0.7,
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Viens par là, toi !', "T'es mort, mon pote."],
    winLines: ['Trop facile.', 'Retourne chez ta mère !', 'Grove Street, baby.'],
    superLines: ['Prends ça… BBL BUSTER !', 'Bulldozer à lunettes, puissance MAX !'],
    voice: { lang: 'fr-FR', pitch: 0.9, rate: 1 },
  },
  {
    id: 'clement',
    name: 'CLÉMENT',
    archetype: 'ranged',
    title: 'Calme, barbu, dangereux',
    face: 'faces/clement.jpg',
    hair: { style: 'buzz', color: '#1e1610' },
    beard3d: { color: '#2a1a10', size: 1.35 },
    outfit: {
      top: 'tracksuit',
      topColor: '#16171c',
      trimColor: '#c9a646',
      pantsColor: '#16171c',
      shoesColor: '#f0f0f0',
    },
    // medium height, medium build
    height: 1,
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Tu vas finir au sol.', "Regarde-moi bien, c'est la dernière fois."],
    winLines: ['Même pas transpiré.', 'Le survêt est resté propre.', 'Au suivant !'],
    superLines: ["C'est fini pour toi !", 'Zéro émotion… BBL MAX !'],
    voice: { lang: 'fr-FR', pitch: 0.75, rate: 0.95 },
  },
  {
    id: 'alex',
    name: 'ALEX',
    archetype: 'balanced',
    title: 'Mèche rebelle, droite fatale',
    face: 'faces/alex.jpg',
    hair: { style: 'midlong', color: '#6f4f32' },
    outfit: {
      top: 'hoodie',
      topColor: '#e0742a',
      trimColor: '#f4d8b0',
      pantsColor: '#2b2f3a',
      shoesColor: '#f0f0f0',
    },
    // medium height, slim
    height: 1,
    build: 0.88,
    body: 'fine',
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Approche, si tu oses.', 'Mes boucles sont prêtes, et toi ?'],
    winLines: ['Trop facile.', 'Même pas décoiffé.', 'Au suivant !'],
    superLines: ['Prends ça… BBL BUSTER !', 'Tornade de boucles !'],
    voice: { lang: 'fr-FR', pitch: 1, rate: 1.05 },
  },
  {
    id: 'benji',
    name: 'BENJI',
    archetype: 'fast',
    title: 'Brushing tropical',
    face: 'faces/benji.jpg',
    hair: { style: 'afro', color: '#1c140e' },
    outfit: {
      top: 'tshirt',
      topColor: '#2c64c8',
      trimColor: '#f2f2ea',
      pantsColor: '#3a3a40',
      shoesColor: '#e8e2d0',
      beltColor: '#1a1a1c',
    },
    // medium height, slim
    height: 1,
    build: 0.88,
    body: 'fine',
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Admire la coupe, après tu dors.', 'Attention, ça décoiffe !'],
    winLines: ['Pas un cheveu de travers.', 'Retourne chez le coiffeur !', 'Trop facile, mon pote.'],
    superLines: ['Palmier… BBL BUSTER !', 'Coup de brushing tropical !'],
    voice: { lang: 'fr-FR', pitch: 1.1, rate: 1.1 },
  },
  {
    id: 'isis',
    name: 'ISIS',
    archetype: 'heavy',
    title: 'Afro XXL, coups XXL',
    face: 'faces/isis.jpg',
    // the photo is lit with a purple light (sampled tone = grey-mauve): explicit body tone halfway to a
    // natural brown; the face texture's edges are colour-matched to it, so there is no seam
    skin: '#8e6456',
    hair: { style: 'bigafro', color: '#151010' },
    outfit: {
      top: 'tracksuit',
      topColor: '#178a8a',
      trimColor: '#f2f2ea',
      pantsColor: '#178a8a',
      shoesColor: '#1a1a1e',
    },
    // shorter, semi-thick
    height: 0.93,
    build: 1.15,
    belly: 0.12,
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Tu vas regretter ce combat.', 'Échauffement terminé.'],
    winLines: ['Au tapis, sans discuter.', "C'était même pas sérieux.", 'Suivant !'],
    superLines: ["C'est fini pour toi !", 'Afro power… BBL MAX !'],
    voice: { lang: 'fr-FR', pitch: 1.1, rate: 1 },
  },
  {
    id: 'enola',
    name: 'ENOLA',
    archetype: 'ranged',
    title: 'Lunettes noires, sang-froid',
    face: 'faces/enola.jpg',
    hair: { style: 'midlong', color: '#a4452a' },
    outfit: {
      top: 'tshirt',
      topColor: '#c8323a',
      trimColor: '#f0e0e0',
      pantsColor: '#1e1e24',
      shoesColor: '#f2f2f2',
      beltColor: '#101012',
    },
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Tu trembles déjà, non ?', 'On danse ?'],
    winLines: ['Trop lent, trop tard.', "Respire, c'est fini.", "Je t'avais dit de partir."],
    superLines: ['Tempête… BBL MAX !', 'Tu ne verras rien venir !'],
    voice: { lang: 'fr-FR', pitch: 0.95, rate: 0.95 },
  },
  {
    id: 'zia',
    name: 'ZIA',
    archetype: 'fast',
    title: 'Reine des dreads',
    face: 'faces/zia.jpg',
    hair: { style: 'dreads', color: '#3b3631' },
    outfit: {
      top: 'tank',
      topColor: '#f0c030',
      trimColor: '#d8a820',
      pantsColor: '#4a5a32',
      shoesColor: '#2a2a2e',
      beltColor: '#2a1e14',
      wristColor: '#1a1a1e',
    },
    // medium height, semi-thick
    height: 1,
    build: 1.15,
    headScale: 1.18,
    introLines: ['Je vais te tuer.', 'Prépare tes excuses.', 'Ça va piquer.'],
    winLines: ['Bisous, au revoir.', 'Pas de quartier !', 'Une revanche ? Non merci.'],
    superLines: ['Prends ça en pleine face !', 'Z comme… ZÉRO PITIÉ !'],
    voice: { lang: 'fr-FR', pitch: 1.2, rate: 1.1 },
  },
  {
    id: 'elies',
    name: 'ELIES',
    archetype: 'heavy',
    title: 'Moustache de velours, poings de fer',
    face: 'faces/elies.jpg',
    hair: { style: 'curlyshort', color: '#1c1714' },
    outfit: {
      top: 'hoodie',
      topColor: '#ebe4d6',
      trimColor: '#2a2a30',
      pantsColor: '#24262e',
      shoesColor: '#f2f2f2',
    },
    // tall, medium build
    height: 1.09,
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer, tranquille.', 'Regarde bien la moustache, c’est la dernière chose que tu verras.', 'On va faire ça proprement.'],
    winLines: ['Même pas décoiffé, frérot.', 'Propre, net, sans bavure.', 'La moustache a parlé.'],
    superLines: ['Moustache… BBL MAX !', 'Souviens-toi de ce visage !'],
    voice: { lang: 'fr-FR', pitch: 0.95, rate: 1.05 },
  },
  {
    id: 'thomas',
    name: 'THOMAS',
    archetype: 'fast',
    title: 'Bonnet vissé, regard froid',
    face: 'faces/thomas.jpg',
    hair: { style: 'beanie', color: '#2a1d16' },
    accessories: { cap: '#1a1a1c' },
    outfit: {
      top: 'hoodie',
      topColor: '#2a2b31',
      trimColor: '#b8bcc4',
      pantsColor: '#5a6646',
      shoesColor: '#f0f0f0',
    },
    // tall and slim
    height: 1.1,
    build: 0.88,
    body: 'fine',
    headScale: 1.18,
    introLines: ['Bonnet vissé… je vais te tuer.', 'Je vais te tuer sans enlever le bonnet.', "T'as froid ? Moi non."],
    winLines: ['Même pas eu besoin d’enlever le bonnet.', 'Rentre au chaud, va.', 'Froid comme l’hiver.'],
    superLines: ['Coup de bonnet… BBL MAX !', 'Ça caille… pour toi !'],
    voice: { lang: 'fr-FR', pitch: 0.85, rate: 0.95 },
  },
  {
    id: 'mihai',
    name: 'MIHAÏ',
    archetype: 'balanced',
    title: 'Le sourire qui fait mal',
    face: 'faces/mihai.jpg',
    hair: { style: 'wavy', color: '#5a3e2a' },
    beard3d: { color: '#5e4230', size: 0.6 },
    outfit: {
      top: 'tshirt',
      topColor: '#6e3fa3',
      trimColor: '#e8dcf4',
      pantsColor: '#b89e74',
      shoesColor: '#3a2a20',
      beltColor: '#3a2618',
    },
    // medium height, medium build
    height: 1,
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer… avec le sourire.', 'Souris, ça va faire mal.', 'Les cheveux au vent, les poings en avant !'],
    winLines: ['Toujours le sourire !', 'Merci, bonne soirée !', 'Pas une mèche de travers.'],
    superLines: ['Sourire de la mort… BBL MAX !', 'Coup de crinière !'],
    voice: { lang: 'fr-FR', pitch: 1, rate: 1.05 },
  },
  {
    id: 'rayan',
    name: 'RAYAN',
    archetype: 'balanced',
    title: 'Pacifiste… jusqu’au premier round',
    face: 'faces/rayan.jpg',
    // the thin moustache and light chin beard come from the photo (a 3D beard looked far too full)
    hair: { style: 'curlyshort', color: '#121010' },
    outfit: {
      top: 'tshirt',
      topColor: '#8fc4e8',
      trimColor: '#d6ecfa',
      pantsColor: '#2e3a52',
      shoesColor: '#f2f2f2',
      beltColor: '#2a1c14',
    },
    // same build as Elies: tall, medium build
    height: 1.09,
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer… pacifiquement.', 'Moi, je suis pacifiste. Mais toi, je vais te tuer.', 'Peace and love… et crochet du droit.'],
    winLines: ['Désolé, c’était pour la paix.', 'La violence ne résout rien… sauf ça.', 'Paix à ton âme, frérot.'],
    superLines: ['Je suis pacifiste… OU PAS !', 'La paix, c’est fini… BBL MAX !', 'Peace and love… et uppercut !'],
    voice: { lang: 'fr-FR', pitch: 1.05, rate: 1.12 },
  },
  {
    id: 'billel',
    name: 'BILLEL',
    archetype: 'ranged',
    title: 'Il a lu tous les patch notes',
    face: 'faces/billel.jpg',
    // curls on top, faded sides
    hair: { style: 'curlyshort', color: '#5a3a24' },
    // dark jacket over a white shirt: near-black hoodie with white cuffs
    outfit: {
      top: 'hoodie',
      topColor: '#1d1f26',
      trimColor: '#f0efea',
      pantsColor: '#46536e',
      shoesColor: '#f0f0f0',
    },
    // medium height, medium build
    height: 1,
    build: 1,
    headScale: 1.18,
    introLines: ['Je vais te tuer. C’est la méta, désolé.', 'Ton build est nul. Je vais te tuer.', 'T’es pas dans la méta, toi.'],
    winLines: ['GG ez. Report le jungler.', 'T’as pas lu les patch notes, hein ?', 'FF à quinze, la prochaine fois.'],
    superLines: ['Écoute bien… c’est LA MÉTA !', 'Tier S, zéro counter… BBL MAX !', 'Ton champion est nerf, le mien est cheaté !'],
    voice: { lang: 'fr-FR', pitch: 0.92, rate: 1.18 },
  },
  {
    id: 'matteo',
    name: 'MATTEO',
    archetype: 'heavy',
    page: 2,
    title: 'Solide sur les appareils',
    face: 'faces/matteo.jpg',
    // short blond spiky hair with a fringe; the light moustache and short beard come from the photo
    hair: { style: 'spikyfringe', color: '#cdaa68' },
    outfit: {
      top: 'hoodie',
      topColor: '#1f2a4a',
      trimColor: '#c8cedc',
      pantsColor: '#2c2e36',
      shoesColor: '#f2f2f2',
    },
    // gym guy: a bit tall, broad, muscular
    height: 1.05,
    build: 1.18,
    muscles: 0.55,
    headScale: 1.18,
    introLines: ['Je sors de la salle… je vais te tuer.', 'Jour des jambes ? Non, jour de ta défaite.', 'Échauffé, gonflé, prêt.'],
    winLines: ['Même pas une série complète.', 'Je retourne à la salle.', 'Repos entre deux séries, et toi au tapis.'],
    superLines: ['Place le ballon… LE M6 !', 'Lucarne garantie… BBL MAX !', 'Tirs au but, mon pote !'],
    voice: { lang: 'fr-FR', pitch: 0.95, rate: 1.08 },
  },
];

/** Profile of a fighter (lab creations and unknown fighters are balanced). */
export function archetypeOf(def: FighterDef): Archetype {
  return def.archetype ?? 'balanced';
}
