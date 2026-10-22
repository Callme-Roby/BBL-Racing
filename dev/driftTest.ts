// Scripted human driver: holds a drift through the first corners, does a trick on the ramp.
import { ROSTER } from '../src/data/roster';
import { CIRCUITS } from '../src/race/circuits';
import { KartAI } from '../src/race/ai';
import { Race } from '../src/race/race';

const race = new Race({ track: CIRCUITS[0], racers: [{ def: ROSTER[1], local: 0 }, { def: ROSTER[2] }], laps: 2, cc: 100, difficulty: 'normal', items: false, seed: 3 });
race.introTicks = 0;
const me = race.karts[0];
const pilot = new KartAI(me, 'hard', 1);
let hold = 0;
for (let t = 0; t < 60 * 70; t++) {
  // accelerate during the countdown from "2" (start boost)
  const cd = race.phase === 'countdown' ? race.countdown : 0;
  let inp = race.phase === 'countdown' ? { steer: 0, accel: cd < 1.6, brake: false, drift: false, item: false, look: false, aim: 0 } : pilot.think(race.track, race.time);
  // press drift in the air (trick)
  if (!me.grounded && me.trickable && !me.tricked) inp = { ...inp, drift: (hold++ % 2) === 0 };
  race.tick([inp, null]);
  for (const e of race.events) if (e.kart === 0 && e.ev.k !== 'hop' && e.ev.k !== 'land') console.log(race.time.toFixed(2), JSON.stringify(e.ev), 's=' + me.loc.s.toFixed(0));
}
console.log('lap', me.lap, 'progress', me.progress.toFixed(0), 'finished', me.finished, me.finishTime.toFixed(2));
