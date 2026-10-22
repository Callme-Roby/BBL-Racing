// Headless race simulation (node): npx esbuild dev/simTest.ts --bundle --platform=node --outfile=/tmp/simtest.cjs && node /tmp/simtest.cjs
import { ROSTER } from '../src/data/roster';
import { CIRCUITS } from '../src/race/circuits';
import { Race } from '../src/race/race';

const trackId = process.argv[2] ?? CIRCUITS[0].id;
const secs = Number(process.argv[3] ?? 90);
const track = CIRCUITS.find((c) => c.id === trackId) ?? CIRCUITS[0];
const race = new Race({ track, racers: ROSTER.slice(0, 8).map((def) => ({ def })), laps: 3, cc: 100, difficulty: 'normal', items: false, seed: 1 });
race.introTicks = 0;
const L = race.track.length;
console.log(`${track.name}: ${L.toFixed(0)} m, ${race.track.main.count} samples`);
let worst = 0;
for (let t = 0; t < 60 * secs; t++) {
  race.tick([]);
  if (t % 120 === 0) {
    const row = race.karts.map((k) => `${k.def.id.slice(0, 4)} p${k.progress.toFixed(0).padStart(5)} d${k.loc.d.toFixed(1).padStart(6)} v${k.speed.toFixed(0).padStart(3)} ${k.surface.slice(0, 3)}${k.rescueT > 0 ? ' R' : ''}${k.drift ? ' D' + k.driftTier : ''}`);
    console.log(`t=${race.time.toFixed(0).padStart(3)} ` + row.slice(0, 4).join(' | '));
  }
  for (const k of race.karts) worst = Math.max(worst, Math.abs(k.loc.d) - k.loc.w);
}
console.log('order', race.order.map((i) => race.karts[i].def.id + ':' + race.karts[i].lap).join(' '), 'finished', race.finishOrder.length, 'worst offroad', worst.toFixed(1));
