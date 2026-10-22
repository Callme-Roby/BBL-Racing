import './ui/styles.css';
import './ui/mobile-menus.css';
import './ui/mobile-game.css';
import './ui/kart-touch.css';
import './ui/race.css';
import { App } from './app';
import { initKeyLabels } from './input/input';
import { roomFromUrl } from './net/peer';
import * as flow from './screens/flow';
import { goTitle, initFlow } from './screens/flow';
import { ROSTER } from './data/roster';
import { CIRCUITS, CUPS } from './race/circuits';
import { goOnlineJoin } from './screens/online';
import { GrandPrix } from './game/grandPrix';

function boot() {
  const app = new App();
  initFlow(app);
  void initKeyLabels();
  const room = roomFromUrl();
  if (room) goOnlineJoin(room);
  else goTitle();
  // handy for debugging from the console
  (window as unknown as { bbl: App }).bbl = app;
  if (location.search.includes('debug')) {
    (window as unknown as { bblDebug: boolean }).bblDebug = true;
    // ?debug: jump to any screen from the console / tests, e.g. bblFlow.goSelect('race')
    (window as unknown as { bblFlow: typeof flow }).bblFlow = flow;
    (window as unknown as { bblRoster: typeof ROSTER }).bblRoster = ROSTER;
    // ?debug: start a race straight away, e.g. bblRace('zia'), bblRace('dylan', 'dojo', 'tt'), bblRace(['zia','dylan'], 'hood', 'split')
    (window as unknown as { bblRace: unknown }).bblRace = (who: string | string[], track?: string, mode?: 'race' | 'tt' | 'split') => {
      const ids = Array.isArray(who) ? who : [who];
      const defs = ids.map((id) => ROSTER.find((f) => f.id === id) ?? ROSTER[0]);
      const t = CIRCUITS.find((c) => c.id === track) ?? CIRCUITS[0];
      flow.quickRace(mode ?? (defs.length > 1 ? 'split' : 'race'), defs, t);
    };
    // ?debug: the podium of a pretend grand prix, e.g. bblPodium('zia')
    (window as unknown as { bblPodium: unknown }).bblPodium = (who: string) => {
      const gp = new GrandPrix(CUPS[0], [ROSTER.find((f) => f.id === who) ?? ROSTER[0]]);
      gp.entries.forEach((e, i) => {
        e.points = (gp.entries.length - i) * 7;
        e.results = [i, i, i, i];
      });
      gp.race = 4;
      flow.goPodium(gp);
    };
    // ?debug: a grand prix straight away, e.g. bblGP('zia'), bblGP(['zia','dylan'], 1)
    (window as unknown as { bblGP: unknown }).bblGP = (who: string | string[], cup = 0) => {
      const ids = Array.isArray(who) ? who : [who];
      flow.startGrandPrix(CUPS[cup] ?? CUPS[0], ids.map((id) => ROSTER.find((f) => f.id === id) ?? ROSTER[0]));
    };
  }
}

try {
  boot();
} catch (e) {
  console.error(e);
  document.getElementById('ui')!.innerHTML =
    '<div class="screen"><div class="h1">OUPS</div><div class="status err">Ton navigateur ne supporte pas WebGL ou une erreur est survenue.<br>' +
    String(e) +
    '</div></div>';
}
