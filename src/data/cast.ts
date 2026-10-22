import { ROSTER, type FighterDef } from './roster';

/**
 * Non-playable characters and alternate looks used only during BBL MAX
 * cinematics (spawned as extra actors, or swapped in for the attacker).
 * Ids are referenced from the scripts in src/sim/ultimates.ts.
 *
 *  - babyelies  : Elies as a toddler (waist-high), replaces Elies mid-cinematic
 *  - spiderpote : Enola's masked spider-hero friend who joins the combo
 *  - isis_buff  : Isis with a bodybuilder body (muscle transformation)
 *  - mihai_ssj  : Mihaï "super sayan" (golden spiky hair)
 *
 * Every entry is a complete FighterDef (build it with loadFace + buildCharacter
 * like a roster fighter). Alternate looks copy the roster fighter (same photo,
 * skin, voice...) and only override what changes.
 */

/** Deep copy of a roster fighter with a few overrides (falls back to a neutral fighter if the id is gone). */
function derive(id: string, patch: Partial<FighterDef> & Pick<FighterDef, 'id' | 'name'>): FighterDef {
  const base = ROSTER.find((f) => f.id === id);
  const copy: FighterDef = base
    ? (JSON.parse(JSON.stringify(base)) as FighterDef)
    : {
        id,
        name: id.toUpperCase(),
        title: '',
        face: '',
        hair: { style: 'short', color: '#2a1c14' },
        outfit: { top: 'tank', topColor: '#f2f0e8', trimColor: '#d0ccc0', pantsColor: '#3b5a8c', shoesColor: '#1d1d1f' },
        introLines: ['Je vais te tuer.'],
        winLines: ['Trop facile.'],
      };
  return { ...copy, ...patch };
}

export const CAST: Record<string, FighterDef> = {
  babyelies: {
    id: 'babyelies',
    name: 'BÉBÉ ELIES',
    title: 'Petit mais teigneux',
    face: 'faces/babyelies.jpg',
    hair: { style: 'curlyshort', color: '#1e1b1a' },
    outfit: {
      top: 'tshirt',
      topColor: '#ffc83a',
      trimColor: '#ff8a3a',
      pantsColor: '#3a8ad8',
      shoesColor: '#e0403a',
      shorts: true,
    },
    // toddler: barely reaches the other fighters' belt, big head, chubby
    height: 0.55,
    headScale: 1.35,
    build: 1.06,
    belly: 0.4,
    introLines: ['Areuh… je vais te tuer !', 'C’est qui le bébé, maintenant ?'],
    winLines: ['Encore ! Encore !', 'Gâteau, s’il te plaît !'],
    superLines: ['Colère de bébé… BBL MAX !', 'Pas de sieste pour toi !'],
    voice: { lang: 'fr-FR', pitch: 1.9, rate: 1.15 },
  },

  spiderpote: {
    id: 'spiderpote',
    name: 'SPIDER-POTE',
    title: 'Ton sympathique voisin',
    face: '',
    // mask / gloves / neck: suit red
    skin: '#c41e2a',
    hair: { style: 'bald', color: '#c41e2a' },
    faceGen: { mask: 'spider', maskLine: '#121216' },
    outfit: {
      top: 'suit',
      topColor: '#c41e2a',
      trimColor: '#2446a8',
      pantsColor: '#2446a8',
      shoesColor: '#c41e2a',
      web: '#141418',
    },
    // slim athletic hero
    height: 1.04,
    build: 0.95,
    muscles: 0.3,
    headScale: 1.06,
    introLines: ['Ton voisin arrive… et il va te tuer !', 'Toile prête, adversaire repéré.'],
    winLines: ['Toile tissée, affaire classée.', 'Ton voisin te salue !'],
    superLines: ['Toile… BBL MAX !', 'Emballé, c’est pesé !'],
    voice: { lang: 'fr-FR', pitch: 1.05, rate: 1.15 },
  },

  isis_buff: derive('isis', {
    id: 'isis_buff',
    name: 'ISIS',
    title: 'Mode culturiste',
    outfit: {
      top: 'tank',
      topColor: '#178a8a',
      trimColor: '#f2f2ea',
      pantsColor: '#178a8a',
      shoesColor: '#1a1a1e',
      beltColor: '#101012',
    },
    height: 1.03,
    build: 1.2,
    belly: 0,
    muscles: 1,
    introLines: ['Regarde-moi ces bras… je vais te tuer.'],
    winLines: ['Séance terminée.', 'Jour des bras, jour de gloire.'],
    superLines: ['Biceps… BBL MAX !', 'Prends la gonflette !'],
  }),

  mihai_ssj: derive('mihai', {
    id: 'mihai_ssj',
    name: 'MIHAÏ',
    title: 'Super Sayan',
    hair: { style: 'ssj', color: '#ffd84a' },
    introLines: ['Ma puissance dépasse les 9000… je vais te tuer.'],
    winLines: ['Même pas à pleine puissance.', 'Sourire doré, victoire assurée.'],
    superLines: ['Super Sayan… BBL MAX !', 'Ma puissance est… au-delà !'],
  }),
};
