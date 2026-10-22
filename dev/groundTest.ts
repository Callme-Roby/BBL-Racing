// Ground / camera torture test: karts driven by a CPU with random human mistakes (drift spam,
// steering bursts, driving off the edges), checking every tick that nobody ends up under the
// road or under the terrain. npx esbuild dev/groundTest.ts --bundle --platform=node --outfile=/tmp/gt.cjs && node /tmp/gt.cjs [track] [secs]
import { ROSTER } from '../src/data/roster';
import { NO_INPUT, type KartInput } from '../src/input/input';
import { KartAI } from '../src/race/ai';
import { CIRCUITS } from '../src/race/circuits';
import { Race } from '../src/race/race';

const only = process.argv[2];
const secs = Number(process.argv[3] ?? 150);
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let total = 0;
for (const track of CIRCUITS) {
  if (only && only !== 'all' && track.id !== only) continue;
  const race = new Race({ track, racers: ROSTER.slice(0, 8).map((def, i) => ({ def, local: i < 6 ? i : undefined })), laps: 99, cc: 150, difficulty: 'hard', items: true, seed: 3 });
  race.introTicks = 0;
  const ais = race.karts.map((k, i) => new KartAI(k, 'hard', i * 11));
  const chaos = race.karts.map(() => ({ t: 0, steer: 0, drift: false, off: 0 }));
  const issues: Record<string, number> = {};
  const first: string[] = [];
  const note = (key: string, msg: string) => {
    issues[key] = (issues[key] ?? 0) + 1;
    if ((issues[key] ?? 0) <= 2 && first.length < 12) first.push(msg);
  };
  for (let t = 0; t < 60 * secs; t++) {
    const inputs: (KartInput | null)[] = race.karts.map((k, i) => {
      if (i >= 6) return null;
      if (race.phase !== 'race') return { ...NO_INPUT, accel: true };
      const base = ais[i].think(race.track, race.time);
      const c = chaos[i];
      c.t -= 1 / 60;
      if (c.t <= 0) {
        c.t = 0.3 + rand() * 1.5;
        const m = rand();
        c.steer = m < 0.25 ? (rand() < 0.5 ? -1 : 1) : 0;
        c.drift = m > 0.4 && m < 0.75;
        c.off = m > 0.92 ? 1 : 0;
      }
      const inp = { ...base };
      if (c.steer) inp.steer = c.steer;
      if (c.drift) {
        inp.drift = true;
        if (Math.abs(inp.steer) < 0.3) inp.steer = rand() < 0.5 ? -1 : 1;
      }
      inp.accel = true;
      inp.brake = false;
      return inp;
    });
    race.tick(inputs);
    for (const k of race.karts) {
      if (k.rescueT > 0) continue;
      k.locateGround();
      const l = k.loc;
      const lim = l.w + race.track.shoulder;
      const tag = `${track.id} t=${race.time.toFixed(1)} ${k.def.id} s=${l.s.toFixed(0)} d=${l.d.toFixed(1)} h=${l.h.toFixed(2)} g=${k.grounded} ag=${l.antigrav} v=${k.speed.toFixed(0)}`;
      const gap = l.ribbon.sample(Math.round(l.i)).gap;
      // missed a jump (just after a gap): falling, that's fair
      const afterGap = race.track.gaps.some(([, g1]) => l.ribbon.isMain && l.s >= g1 - 1 && l.s < g1 + 40) && !k.grounded;
      const canal = race.track.gaps.some(([g0, g1]) => l.ribbon.isMain && l.s >= g0 - 2 && l.s <= g1 + 2) && Math.abs(l.d) <= lim + 8.5;
      if (Math.abs(l.d) <= lim && !gap && !afterGap && l.h < -0.25 && l.h > -6) note('under-road', 'UNDER ROAD ' + tag);
      if (Math.abs(l.d) > lim + 0.5 && !race.track.hasVoid && !canal && k.pos.y < race.track.groundY - 0.25) note('under-terrain', 'UNDER TERRAIN ' + tag + ' y=' + k.pos.y.toFixed(2));
      if (k.grounded && Math.abs(l.d) <= lim && l.h > 0.6) note('floating', 'FLOATING ' + tag);
    }
    for (const e of race.events) if (e.ev.k === 'fall') issues.falls = (issues.falls ?? 0) + 1;
  }
  const bad = (issues['under-road'] ?? 0) + (issues['under-terrain'] ?? 0) + (issues.floating ?? 0);
  total += bad;
  console.log(track.id.padEnd(12), JSON.stringify(issues));
  for (const f of first) console.log('   ', f);
}
console.log(total ? `PROBLEMS: ${total}` : 'OK');
