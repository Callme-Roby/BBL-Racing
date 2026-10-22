import { PROFILE_INFO } from '../data/kartStats';
import { archetypeOf, ROSTER, type Archetype } from '../data/roster';
import { keyLabel, P1_KEYS, P2_KEYS, SOLO_KEYS } from '../input/input';
import { h } from '../ui/dom';
import { ITEM_INFO } from '../race/itemDefs';

const k = (codes: string[]) => codes.map((c) => h('kbd', null, keyLabel(c)));

/** Little copy of an on-screen touch button (see #touch in mobile-game.css). */
const tb = (label: string, cls = '') => h('i', { class: 'tbtn ' + cls }, label);

/** Driving techniques, the same for every control scheme. */
function techRows(touch: boolean): [string, (HTMLElement | string)[]][] {
  const drift = touch ? tb('DRIFT', 'pill') : 'DÉRAPAGE';
  return [
    ['Dérapage + mini-turbo', ['maintiens ', drift, ' en tournant : le kart saute puis glisse · les étincelles passent du bleu à l’orange puis au violet · relâche = turbo (plus long à chaque palier)']],
    ['Turbo au départ', ['accélère pile entre le « 2 » et le « 1 » du compte à rebours · trop tôt = le moteur cale']],
    ['Figure (tremplins)', ['en l’air après un tremplin, appuie sur ', drift, ' : petit turbo à l’atterrissage']],
    ['Aspiration', ['reste juste derrière un adversaire : le vent t’aspire, puis turbo']],
    ['Hors-piste', ['herbe, sable, terre : ça freine fort… sauf pendant un turbo (les champignons coupent les virages)']],
    ['Anti-gravité', ['zones bleues : les roues se mettent à plat, la route peut monter sur les murs · cogner un adversaire = turbo pour les deux']],
    ['Tomber', ['un pote vient te chercher et te repose sur la piste (tu perds un peu de temps)']],
    ['Objets', ['roule dans les boîtes « ? » : les derniers reçoivent les meilleurs objets · ' + (touch ? 'stick vers le bas + OBJET = lancer derrière' : 'BAS + OBJET = lancer derrière, HAUT = devant')]],
  ];
}

/** The four profiles and who is what (lab creations are balanced). */
function profileRows(): [string, (HTMLElement | string)[]][] {
  const nice = (n: string) => n.charAt(0) + n.slice(1).toLowerCase();
  const order: Archetype[] = ['heavy', 'fast', 'ranged', 'balanced'];
  return order.map((a) => {
    const info = PROFILE_INFO[a];
    const who = ROSTER.filter((d) => archetypeOf(d) === a).map((d) => nice(d.name));
    if (a === 'balanced') who.push('les persos du LABO');
    return [info.label, [`${who.join(', ')} : ${info.line.toLowerCase()}`]];
  });
}

function itemRows(): [string, (HTMLElement | string)[]][] {
  return Object.values(ITEM_INFO).map((it) => [it.name, [it.help]]);
}

const table = (rows: [string, (HTMLElement | string)[]][], cls = '') =>
  h('table', { class: 'controls-table ' + cls }, ...rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, ...b))));

/** The touch controls explained (phones / tablets). */
export function touchControlsHelp(): HTMLElement {
  const rows: [string, (HTMLElement | string)[]][] = [
    ['Stick (à gauche)', ['gauche / droite = tourner (plus tu pousses, plus ça tourne) · haut / bas = viser avec un objet']],
    ['Accélérer', [tb('GAZ', 'pill gold'), ' (ou accélération automatique : OPTIONS)']],
    ['Freiner / reculer', [tb('FREIN', 'pill')]],
    ['Dérapage / figure', [tb('DRIFT', 'pill')]],
    ['Objet', [tb('OBJET', 'pill teal'), ' (l’objet que tu tiens est dessus)']],
    ['Pause', [tb('II', 'pill'), ' met la course en pause']],
  ];
  return h(
    'div',
    { class: 'touch-help' },
    h('div', { class: 'help-h' }, 'COMMANDES TACTILES'),
    table(rows, 'touch'),
    h('div', { class: 'help-h' }, 'TECHNIQUES'),
    table(techRows(true), 'touch'),
    h('div', { class: 'help-h' }, 'PROFILS'),
    table(profileRows(), 'touch'),
    h('div', { class: 'help-h' }, 'OBJETS'),
    table(itemRows(), 'touch'),
  );
}

/** Controls + techniques, as a DOM table (touch = explain the on-screen controls instead of the keys). */
export function controlsHelp(split: boolean, touch = false): HTMLElement {
  if (touch && !split) return touchControlsHelp();
  const rows: [string, (HTMLElement | string)[]][] = [];
  if (split) {
    rows.push(['J1 diriger / accélérer / freiner', k([...P1_KEYS.left, ...P1_KEYS.right, ...P1_KEYS.accel, ...P1_KEYS.brake])]);
    rows.push(['J1 dérapage / objet / rétro', [...k(P1_KEYS.drift), ' / ', ...k(P1_KEYS.item), ' / ', ...k(P1_KEYS.look)]]);
    rows.push(['J2 diriger / accélérer / freiner', k([...P2_KEYS.left, ...P2_KEYS.right, ...P2_KEYS.accel, ...P2_KEYS.brake])]);
    rows.push(['J2 dérapage / objet / rétro', [...k(P2_KEYS.drift.slice(0, 2)), ' / ', ...k(P2_KEYS.item.slice(0, 2)), ' / ', ...k(P2_KEYS.look.slice(0, 1))]]);
    rows.push(['J3 / J4', ['manettes (1re manette = dernier joueur sans manette… voir OPTIONS → MANETTES)']]);
  } else {
    rows.push(['Diriger', [...k(['KeyA', 'KeyD']), ' ou ', ...k(['ArrowLeft', 'ArrowRight'])]]);
    rows.push(['Accélérer / freiner-reculer', [...k(['KeyW', 'ArrowUp']), ' / ', ...k(['KeyS', 'ArrowDown'])]]);
    rows.push(['Dérapage / figure', k(SOLO_KEYS.drift.slice(0, 3))]);
    rows.push(['Objet', k(SOLO_KEYS.item.slice(0, 3))]);
    rows.push(['Regarder derrière', k(SOLO_KEYS.look)]);
  }
  rows.push(['Manette', ['✕ / A = accélérer · ○ / B = freiner · R1 / R2 = dérapage · L1 / L2 = objet · □ / X = rétro · stick = diriger (analogique) · stick arcade ou manette non reconnue : OPTIONS → MANETTES & STICKS']]);
  rows.push(['Pause', [...k(['Escape']), ' / Start']]);
  rows.push(...techRows(false));
  rows.push(...profileRows());
  rows.push(...itemRows());
  return table(rows);
}
