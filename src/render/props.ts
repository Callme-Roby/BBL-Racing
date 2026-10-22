import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
/** hand-held / worn props (BBL FIGHTERZ cinematics), reused as BBL KART items and podium gear */
export type PropId = 'smg' | 'grenade' | 'bazooka' | 'mic' | 'shades' | 'phone' | 'rose' | 'glove' | 'headgear' | 'gkglove' | 'football' | 'goal';
/** flying objects */
export type ProjectileKind = 'grenade' | 'rocket' | 'web' | 'bullet';
import { createPS1Material } from './ps1Material';

/**
 * Low-poly props held during the BBL MAX cinematics (see `cine.props` in
 * src/sim/ultimates.ts) and the projectiles they fire.
 *
 * Every prop is built in the space of the bone it is attached to (bind pose:
 * character faces +Z, +X = their left, arms hanging down):
 *  - guns / launchers: grip at the origin, barrel along -Y (along the arm), top toward +Z;
 *  - mic, rose, phone, grenade: held in the fist, sticking out on the thumb side (+Z);
 *  - shades: sit on the eyes when attached to the head bone.
 */

const mats = new Map<number, THREE.Material>();
function mat(color: number, unlit = 0): THREE.Material {
  const key = color * 4 + Math.round(unlit * 3);
  let m = mats.get(key);
  if (!m) {
    m = createPS1Material({ color, unlit });
    mats.set(key, m);
  }
  return m;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, unlit = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, unlit));
  m.position.set(x, y, z);
  return m;
}

/** cylinder along Y */
function cyl(r0: number, r1: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat(color));
  m.position.set(x, y, z);
  return m;
}

/** cylinder along Z */
function cylZ(r0: number, r1: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 8): THREE.Mesh {
  const m = cyl(r0, r1, h, color, x, y, z, seg);
  m.rotation.x = Math.PI / 2;
  return m;
}

function ball(r: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(color));
  m.position.set(x, y, z);
  return m;
}

const GUNMETAL = 0x2c2d33;
const BLACK = 0x141416;
const OLIVE = 0x4b5a2c;
const OLIVE_DARK = 0x37421f;

function smg(): THREE.Group {
  const g = new THREE.Group();
  g.add(
    box(0.05, 0.3, 0.075, GUNMETAL, 0, -0.1, 0.07), // receiver
    box(0.04, 0.05, 0.11, BLACK, 0, 0.0, 0.0), // grip (in the hand)
    box(0.034, 0.045, 0.16, BLACK, 0, -0.13, -0.02), // magazine
    cyl(0.014, 0.014, 0.12, GUNMETAL, 0, -0.29, 0.085), // barrel stub
    box(0.03, 0.16, 0.03, BLACK, 0, 0.11, 0.06), // folded stock
    box(0.012, 0.02, 0.02, BLACK, 0, -0.2, 0.12), // front sight
  );
  return g;
}

function grenade(): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.04, 0.04, 0.085, OLIVE, 0, 0, 0.06, 8);
  body.rotation.x = Math.PI / 2;
  g.add(body, ball(0.04, OLIVE, 0, 0, 0.02), ball(0.04, OLIVE, 0, 0, 0.1));
  g.add(box(0.016, 0.02, 0.05, 0x8a8a80, 0, 0.035, 0.12)); // lever
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 8), mat(0xc8c8c0));
  ring.position.set(0.03, 0.02, 0.14);
  g.add(ring);
  return g;
}

function bazooka(): THREE.Group {
  const g = new THREE.Group();
  // tube along -Y, resting above the hand (+Z), ~1.1 m long
  g.add(
    cyl(0.07, 0.07, 1.05, OLIVE, 0, -0.2, 0.1, 10),
    cyl(0.085, 0.075, 0.12, OLIVE_DARK, 0, -0.72, 0.1, 10), // muzzle
    cyl(0.1, 0.075, 0.14, OLIVE_DARK, 0, 0.38, 0.1, 10), // rear flare
    box(0.035, 0.06, 0.1, BLACK, 0, 0.0, 0.0), // grip
    box(0.035, 0.05, 0.09, BLACK, 0, -0.32, 0.02), // front grip
    box(0.03, 0.1, 0.05, BLACK, 0.07, -0.12, 0.17), // sight
    box(0.01, 0.4, 0.012, 0xd8c040, 0, -0.2, 0.172), // warning stripe
  );
  return g;
}

function mic(): THREE.Group {
  const g = new THREE.Group();
  g.add(cylZ(0.016, 0.022, 0.16, BLACK, 0, 0, 0.05), ball(0.038, 0x9c9ca4, 0, 0, 0.16), cylZ(0.024, 0.024, 0.012, 0x505058, 0, 0, 0.13));
  return g;
}

function shades(hs: number): THREE.Group {
  const g = new THREE.Group();
  const y = 0.12 * hs + 0.025 * hs;
  const z = 0.112 * hs + 0.012;
  const lens = 0x101018;
  g.add(
    box(0.072 * hs, 0.042 * hs, 0.012, lens, 0.045 * hs, y, z),
    box(0.072 * hs, 0.042 * hs, 0.012, lens, -0.045 * hs, y, z),
    box(0.03 * hs, 0.01 * hs, 0.01, BLACK, 0, y + 0.012 * hs, z),
    box(0.008, 0.012 * hs, 0.11 * hs, BLACK, 0.085 * hs, y + 0.01 * hs, z - 0.055 * hs),
    box(0.008, 0.012 * hs, 0.11 * hs, BLACK, -0.085 * hs, y + 0.01 * hs, z - 0.055 * hs),
    // glint
    box(0.02 * hs, 0.008 * hs, 0.004, 0xffffff, 0.06 * hs, y + 0.01 * hs, z + 0.008, 1),
  );
  return g;
}

function phone(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.075, 0.012, 0.15, BLACK, 0, 0, 0.06), box(0.065, 0.004, 0.13, 0x4aa0ff, 0, 0.008, 0.06, 0.8));
  return g;
}

function rose(): THREE.Group {
  const g = new THREE.Group();
  g.add(cylZ(0.006, 0.006, 0.28, 0x2f7a2a, 0, 0, 0.1, 5), ball(0.035, 0xd0182c, 0, 0, 0.25), box(0.04, 0.005, 0.02, 0x2f7a2a, 0.02, 0, 0.12));
  return g;
}

const GLOVE_RED = 0xc8141e;

/** Boxing glove around the fist (hand bone origin = wrist, the fist hangs along -Y). */
function glove(): THREE.Group {
  const g = new THREE.Group();
  const fist = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), mat(GLOVE_RED));
  fist.scale.set(1, 1.25, 1.1);
  fist.position.set(0, -0.07, 0.01);
  const thumb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.032, 0), mat(GLOVE_RED));
  thumb.position.set(0, -0.04, 0.07);
  // white cuff + lace
  g.add(fist, thumb, cyl(0.058, 0.064, 0.07, 0xf2f2ee, 0, 0.02, 0, 8), box(0.012, 0.06, 0.01, 0xf2f2ee, 0, 0.0, 0.064));
  return g;
}

/** Amateur boxing headgear: padded cap, cheek pads, chin strap (the face stays visible). */
function headgear(hs: number): THREE.Group {
  const g = new THREE.Group();
  const cy = 0.12 * hs; // head centre above the head bone
  const rx = 0.1 * hs + 0.018;
  const ry = 0.125 * hs + 0.018;
  const rz = 0.112 * hs + 0.018;
  // top + back of the skull (a sphere cut open in front)
  // SphereGeometry leaves its phi gap on -X: a ~100° gap turned toward +Z (the face)
  const shellGeo = new THREE.SphereGeometry(1, 12, 8, Math.PI * 0.28, Math.PI * 1.44, 0, Math.PI * 0.62);
  const shell = new THREE.Mesh(shellGeo, mat(0x1c3fb0));
  shell.scale.set(rx, ry, rz);
  shell.rotation.y = Math.PI / 2;
  shell.position.y = cy;
  shellGeo.computeVertexNormals();
  (shell.material as THREE.Material).side = THREE.DoubleSide;
  // brow pad, cheek pads, chin strap
  g.add(
    shell,
    box(0.15 * hs, 0.035 * hs, 0.04, 0x1c3fb0, 0, cy + 0.075 * hs, rz - 0.01),
    box(0.03, 0.09 * hs, 0.06, 0x1c3fb0, rx - 0.008, cy - 0.03 * hs, rz * 0.45),
    box(0.03, 0.09 * hs, 0.06, 0x1c3fb0, -rx + 0.008, cy - 0.03 * hs, rz * 0.45),
    box(0.17 * hs, 0.018, 0.02, 0x10101a, 0, cy - 0.125 * hs, rz * 0.35),
    box(0.06 * hs, 0.02 * hs, 0.012, 0xffffff, 0, cy + 0.075 * hs, rz + 0.012, 1),
  );
  return g;
}

const GK_GREEN = 0xb6ea2a;
const GK_DARK = 0x1b1c20;

/**
 * Goalkeeper glove: a big padded open hand (hand bone origin = wrist, the hand hangs along -Y,
 * palm toward the body's centre line), black palm, neon back, wide strap on the wrist.
 */
function gkglove(): THREE.Group {
  const g = new THREE.Group();
  g.add(
    box(0.075, 0.17, 0.15, GK_GREEN, 0, -0.1, 0.01), // padded back of the hand
    box(0.068, 0.11, 0.135, GK_GREEN, 0, -0.225, 0.006), // fingers
    box(0.012, 0.11, 0.004, GK_DARK, 0, -0.225, 0.075), // finger seams (front)
    box(0.078, 0.004, 0.13, GK_DARK, 0, -0.2, 0.006), // finger seam
    box(0.078, 0.004, 0.13, GK_DARK, 0, -0.245, 0.006), // finger seam
    box(0.05, 0.1, 0.05, GK_GREEN, 0, -0.1, 0.095), // thumb
    box(0.088, 0.065, 0.165, GK_DARK, 0, 0.0, 0.01), // wrist strap
    box(0.09, 0.02, 0.02, 0xf2f2ee, 0, 0.0, 0.095), // strap logo
  );
  return g;
}

const BALL_R = 0.13;

/** Classic football: white icosphere with the 12 black pentagons (centred on the origin). */
function football(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), mat(0xf4f4f0)));
  const ico = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
  const dirs: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < ico.count; i++) {
    v.fromBufferAttribute(ico, i).normalize();
    if (!dirs.some((d) => d.distanceToSquared(v) < 1e-4)) dirs.push(v.clone());
  }
  const parts: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();
  for (const d of dirs) {
    const pent = new THREE.CircleGeometry(BALL_R * 0.4, 5);
    o.position.copy(d).multiplyScalar(BALL_R * 1.005);
    o.lookAt(d.clone().multiplyScalar(2));
    o.updateMatrix();
    pent.applyMatrix4(o.matrix);
    parts.push(pent);
  }
  g.add(new THREE.Mesh(mergeGeometries(parts), mat(0x141416)));
  return g;
}

/**
 * Football goal (a bit smaller than a real one, fighters must fit in): white posts and crossbar,
 * a box-shaped net behind. Origin = middle of the goal line on the floor, mouth toward +Z,
 * width along X, the net goes back toward -Z.
 */
const GOAL_W = 3.4;
const GOAL_H = 2.05;
const GOAL_D = 1.5;
function goal(): THREE.Group {
  const g = new THREE.Group();
  const W = GOAL_W / 2;
  const H = GOAL_H;
  const D = GOAL_D;
  const r = 0.055;
  // frame
  const frame: THREE.BufferGeometry[] = [];
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    frame.push(b);
  };
  bar(r * 2, H + r, r * 2, -W, (H + r) / 2, 0); // posts
  bar(r * 2, H + r, r * 2, W, (H + r) / 2, 0);
  bar(GOAL_W + r * 2, r * 2, r * 2, 0, H, 0); // crossbar
  g.add(new THREE.Mesh(mergeGeometries(frame), mat(0xf6f6f2)));
  // back supports (grey)
  const sup: THREE.BufferGeometry[] = [];
  const sbar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    sup.push(b);
  };
  const s = 0.025;
  for (const x of [-W, W]) {
    sbar(s, H * 0.85, s, x, (H * 0.85) / 2, -D); // back stanchions
    sbar(s, s, D, x, 0.02, -D / 2); // floor bars
    sbar(s, s, D, x, H * 0.85 + (H - H * 0.85) / 2, -D / 2); // top bars
  }
  sbar(GOAL_W, s, s, 0, 0.02, -D); // back floor bar
  sbar(GOAL_W, s, s, 0, H * 0.85, -D);
  g.add(new THREE.Mesh(mergeGeometries(sup), mat(0x9a9ca4)));
  // net: thin cords in a grid (roof slopes from the crossbar down to the back)
  const net: THREE.BufferGeometry[] = [];
  const t = 0.014;
  const step = 0.17;
  const cord = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const c = new THREE.BoxGeometry(t, t, len);
    const o = new THREE.Object3D();
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.lookAt(b);
    o.updateMatrix();
    c.applyMatrix4(o.matrix);
    net.push(c);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const hb = H * 0.85;
  const nx = Math.round(GOAL_W / step);
  for (let i = 0; i <= nx; i++) {
    const x = -W + (GOAL_W * i) / nx;
    cord(V(x, 0, -D), V(x, hb, -D)); // back, vertical
    cord(V(x, H, 0), V(x, hb, -D)); // roof, front to back
  }
  const ny = Math.round(hb / step);
  for (let j = 1; j <= ny; j++) {
    const y = (hb * j) / ny;
    cord(V(-W, y, -D), V(W, y, -D)); // back, horizontal
  }
  const nz = Math.round(D / step);
  for (let j = 1; j < nz; j++) {
    const z = -(D * j) / nz;
    const y = H + (hb - H) * (j / nz);
    cord(V(-W, y, z), V(W, y, z)); // roof, across
    for (const x of [-W, W]) cord(V(x, 0, z), V(x, y, z)); // sides, vertical
  }
  const nyS = Math.round(H / step);
  for (let j = 1; j < nyS; j++) {
    const y = (H * j) / nyS;
    const zEnd = y <= hb ? -D : -D * ((H - y) / (H - hb));
    for (const x of [-W, W]) cord(V(x, y, 0), V(x, y, zEnd)); // sides, horizontal
  }
  g.add(new THREE.Mesh(mergeGeometries(net), mat(0xe2e4e8)));
  return g;
}

/** every prop / projectile (a missing one is a compile error) */
export const ALL_PROPS = Object.keys({
  smg: 1,
  grenade: 1,
  bazooka: 1,
  mic: 1,
  shades: 1,
  phone: 1,
  rose: 1,
  glove: 1,
  headgear: 1,
  gkglove: 1,
  football: 1,
  goal: 1,
} satisfies Record<PropId, 1>) as PropId[];
export const ALL_PROJECTILES = Object.keys({ grenade: 1, rocket: 1, web: 1, bullet: 1 } satisfies Record<ProjectileKind, 1>) as ProjectileKind[];

/** Builds a prop; `headScale` sizes the head props to the wearer's head. */
export function buildProp(id: PropId, headScale = 1.15): THREE.Object3D {
  switch (id) {
    case 'smg':
      return smg();
    case 'grenade':
      return grenade();
    case 'bazooka':
      return bazooka();
    case 'mic':
      return mic();
    case 'shades':
      return shades(headScale);
    case 'phone':
      return phone();
    case 'rose':
      return rose();
    case 'glove':
      return glove();
    case 'headgear':
      return headgear(headScale);
    case 'gkglove':
      return gkglove();
    case 'football':
      return football();
    case 'goal':
      return goal();
  }
}

/**
 * Projectile meshes, oriented to fly along +Z (the director points +Z along the velocity).
 * `web` is a unit-length strand along +Z stretched by the director from the shooter to its tip.
 */
export function buildProjectile(kind: ProjectileKind): THREE.Object3D {
  const g = new THREE.Group();
  switch (kind) {
    case 'grenade': {
      const gr = grenade();
      gr.position.z = -0.06;
      g.add(gr);
      break;
    }
    case 'rocket': {
      g.add(cylZ(0.05, 0.05, 0.36, OLIVE_DARK, 0, 0, 0), cylZ(0.0, 0.05, 0.14, 0xb03020, 0, 0, 0.25, 8));
      for (let i = 0; i < 4; i++) {
        const fin = box(0.004, 0.09, 0.08, OLIVE, 0, 0, -0.16);
        const pivot = new THREE.Group();
        pivot.rotation.z = (i * Math.PI) / 2;
        fin.position.y = 0.07;
        pivot.add(fin);
        g.add(pivot);
      }
      g.add(box(0.07, 0.07, 0.12, 0xffa020, 0, 0, -0.26, 1)); // exhaust flame
      break;
    }
    case 'web':
      g.add(box(0.012, 0.012, 1, 0xf4f4f4, 0, 0, 0.5, 0.6));
      break;
    case 'bullet':
      g.add(box(0.012, 0.012, 0.18, 0xffe060, 0, 0, 0, 1));
      break;
  }
  return g;
}

/** Disposes the geometries of a prop/projectile (materials are shared and kept). */
export function disposeProp(o: THREE.Object3D) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose();
  });
}
