// Top view of the circuits in the terminal: npx esbuild dev/trackMap.ts --bundle --platform=node --outfile=/tmp/map.cjs && node /tmp/map.cjs [id]
import { CIRCUITS } from '../src/race/circuits';
import { Track } from '../src/race/track';

const id = process.argv[2];
for (const def of CIRCUITS.filter((c) => !id || c.id === id)) {
  const tr = new Track(def);
  const W = 110;
  const H = 46;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
  for (const rb of tr.ribbons) for (const s of rb.samples) {
    minX = Math.min(minX, s.p.x); maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z); maxZ = Math.max(maxZ, s.p.z);
    minY = Math.min(minY, s.p.y); maxY = Math.max(maxY, s.p.y);
  }
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  const put = (x: number, z: number, c: string) => {
    // +X drawn to the LEFT (a kart going +Z has +X on its left), +Z up
    const gx = Math.round(((maxX - x) / (maxX - minX || 1)) * (W - 1));
    const gz = Math.round(((maxZ - z) / (maxZ - minZ || 1)) * (H - 1));
    if (gz >= 0 && gz < H && gx >= 0 && gx < W) grid[gz][gx] = c;
  };
  tr.branches.forEach((rb) => rb.samples.forEach((s) => put(s.p.x, s.p.z, '.')));
  for (const s of tr.main.samples) put(s.p.x, s.p.z, s.gap ? 'G' : s.ramp ? 'R' : s.antigrav ? 'A' : s.wallL || s.wallR ? '=' : '#');
  for (const b of tr.boxes) put(b.pos.x, b.pos.z, '?');
  for (const b of tr.boosts) { const p = b.ribbon.pointAt(b.s, b.d); put(p.x, p.z, '>'); }
  def.points.forEach((p, i) => put(p[0], p[2], String(i % 10)));
  put(tr.main.samples[0].p.x, tr.main.samples[0].p.z, 'S');
  console.log(`\n${def.name}  ${tr.length.toFixed(0)} m  (${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m, y ${minY.toFixed(0)}..${maxY.toFixed(0)})  branches ${tr.branches.map((b) => b.length.toFixed(0) + 'm for ' + (b.s1 - b.s0).toFixed(0) + 'm').join(', ')}`);
  console.log(grid.map((r) => r.join('')).join('\n'));
}
