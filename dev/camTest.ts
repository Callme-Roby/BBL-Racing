// Chase camera check (node): follows every kart around every circuit and reports when the
// camera goes under the road, under the terrain or through the far side of a wall — the
// moments the circuit "disappears" on screen. npx esbuild dev/camTest.ts --bundle --platform=node --outfile=/tmp/ct.cjs && node /tmp/ct.cjs [track] [secs]
import * as THREE from 'three';
import { ROSTER } from '../src/data/roster';
import { ChaseCam } from '../src/game/raceWorld';
import { CIRCUITS } from '../src/race/circuits';
import { Race } from '../src/race/race';
import { newLocate } from '../src/race/track';

const only = process.argv[2];
const secs = Number(process.argv[3] ?? 120);
let total = 0;
for (const track of CIRCUITS) {
  if (only && only !== 'all' && track.id !== only) continue;
  const race = new Race({ track, racers: ROSTER.slice(0, 8).map((def) => ({ def })), laps: 99, cc: 150, difficulty: 'hard', items: true, seed: 5 });
  race.introTicks = 0;
  const cams = race.karts.map((k) => new ChaseCam(k));
  const issues: Record<string, number> = {};
  const first: string[] = [];
  const loc = newLocate();
  const hints = race.track.ribbons.map(() => -1);
  for (let t = 0; t < 60 * secs; t++) {
    race.tick([]);
    race.karts.forEach((k, i) => {
      const cam = cams[i];
      cam.update(1 / 60, 16 / 9, k.pos.clone(), k.quat.clone());
      (cam as unknown as { shakeT: number }).shakeT = 0;
      if (race.phase !== 'race' || k.rescueT > 0) return;
      const p = cam.camera.position;
      // under the terrain
      if (!race.track.hasVoid && p.y < race.track.groundY + 0.15) {
        issues.terrain = (issues.terrain ?? 0) + 1;
        if (first.length < 10) first.push(`TERRAIN ${k.def.id} s=${k.loc.s.toFixed(0)} cam y=${p.y.toFixed(2)}`);
      }
      // under a road (any ribbon) close above
      race.track.ribbons.forEach((rb, r) => {
        const j = rb.nearest(p, -1, 30);
        if (j < 0) return;
        hints[r] = j;
        rb.locate(p, j, loc);
        const sm = rb.sample(j);
        if (sm.gap) return;
        const lim = loc.w + race.track.shoulder;
        if (Math.abs(loc.d) < lim && loc.h < 0.12 && loc.h > -4) {
          issues.road = (issues.road ?? 0) + 1;
          if (first.length < 10) first.push(`ROAD ${k.def.id} kart s=${k.loc.s.toFixed(0)} cam s=${loc.s.toFixed(0)} d=${loc.d.toFixed(1)} h=${loc.h.toFixed(2)} ag=${sm.antigrav} ${rb.isMain ? '' : 'branch'}`);
        }
        if ((sm.wallL || sm.wallR) && Math.abs(loc.d) > lim + 0.3 && Math.abs(loc.d) < lim + 6 && loc.h > -1 && loc.h < 1.3 && rb === k.loc.ribbon) {
          const side = loc.d > 0 ? sm.wallR : sm.wallL;
          if (side) {
            issues.wall = (issues.wall ?? 0) + 1;
            if (first.length < 10) first.push(`WALL ${k.def.id} kart s=${k.loc.s.toFixed(0)} d=${k.loc.d.toFixed(1)} cam s=${loc.s.toFixed(0)} d=${loc.d.toFixed(1)} h=${loc.h.toFixed(1)} lim=${lim.toFixed(1)}`);
          }
        }
      });
    });
  }
  const n = Object.values(issues).reduce((a, b) => a + b, 0);
  total += n;
  console.log(track.id.padEnd(12), JSON.stringify(issues));
  for (const f of first) console.log('   ', f);
}
console.log(total ? `PROBLEMS: ${total} (camera-frames)` : 'OK');
void THREE;
