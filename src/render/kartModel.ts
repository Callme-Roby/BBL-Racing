import * as THREE from 'three';
import type { FighterDef } from '../data/roster';
import type { FaceAssets } from './faceTexture';
import { createPS1Material, makeCanvasTexture, pixelTexture, type PS1Material } from './ps1Material';
import { Batch, T } from './stages/kit';

/**
 * Low-poly PS1 kart, painted in the friend's outfit colours (body = top colour, stripes = trim,
 * seat = trousers), with the friend's pixel face on the nose plate.
 *
 * Local axes: +Z forward, +Y up, +X = the driver's left. The root sits on the ground under
 * the middle of the kart.
 */
export interface KartModel {
  root: THREE.Group;
  /** child of root: lean / bounce / hop offsets */
  body: THREE.Group;
  /** front wheels (steer: rotation.y) holding their spinning tyre */
  steerL: THREE.Group;
  steerR: THREE.Group;
  /** the four spinning tyres (rotation.x) */
  wheels: THREE.Object3D[];
  /** wheel mounts (anti-gravity: they turn flat) */
  mounts: THREE.Group[];
  steeringWheel: THREE.Object3D;
  /** the driver sits here (character root position / orientation) */
  seat: THREE.Object3D;
  /** exhaust pipe ends (flames, smoke) and rear wheel contacts (drift sparks) */
  exhausts: THREE.Object3D[];
  rearContacts: THREE.Object3D[];
  /** blue glow under the wheels in anti-gravity sections */
  hover: THREE.Mesh;
  materials: PS1Material[];
  /** wheel radius (spin speed) */
  wheelR: number;
  dispose(): void;
}

let tyreTex: THREE.Texture | null = null;
function tyreTexture(): THREE.Texture {
  if (!tyreTex) {
    tyreTex = makeCanvasTexture(
      16,
      16,
      (ctx, w, h) => {
        ctx.fillStyle = '#1a1a1c';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#323236';
        for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
        ctx.fillStyle = '#0c0c0e';
        for (let y = 2; y < h; y += 4) for (let x = (y / 2) % 4; x < w; x += 4) ctx.fillRect(x, y, 2, 1);
      },
      true,
    );
  }
  return tyreTex;
}

function hex(c: string | undefined, fb: string) {
  return new THREE.Color(c && /^#/.test(c) ? c : fb);
}

export function buildKart(def: FighterDef, face: FaceAssets | null): KartModel {
  const o = def.outfit;
  const main = hex(o.topColor, '#d03030');
  const trim = hex(o.trimColor, '#f0f0f0');
  const seatC = hex(o.pantsColor, '#2a2a30');
  // very dark tops (black hoodies) get a lighter body so the kart reads
  const lum = main.r * 0.3 + main.g * 0.59 + main.b * 0.11;
  if (lum < 0.12) main.lerp(trim, 0.25).offsetHSL(0, 0, 0.06);
  const dark = new THREE.Color(0x26262c);
  const metal = new THREE.Color(0x9a9ca4);
  const chrome = new THREE.Color(0xd8dae0);

  const materials: PS1Material[] = [];
  const mat = (opts: Parameters<typeof createPS1Material>[0]) => {
    const m = createPS1Material(opts);
    materials.push(m);
    return m;
  };
  const vc = mat({ vertexColors: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const b = new Batch(vc, body, 'kart');
  const I = T();

  // floor pan (tapered toward the nose)
  b.hexa(
    I,
    [
      [-0.58, 0.1, -0.95],
      [0.58, 0.1, -0.95],
      [0.4, 0.1, 0.95],
      [-0.4, 0.1, 0.95],
      [-0.6, 0.2, -0.95],
      [0.6, 0.2, -0.95],
      [0.42, 0.2, 0.95],
      [-0.42, 0.2, 0.95],
    ],
    { color: main.clone().multiplyScalar(0.8), bottom: dark, skip: [] },
  );
  // front cowl, sloping down to the nose
  b.hexa(
    I,
    [
      [-0.4, 0.2, 0.25],
      [0.4, 0.2, 0.25],
      [0.36, 0.2, 1.02],
      [-0.36, 0.2, 1.02],
      [-0.34, 0.5, 0.3],
      [0.34, 0.5, 0.3],
      [0.26, 0.3, 1.0],
      [-0.26, 0.3, 1.0],
    ],
    { color: main, bottom: main.clone().multiplyScalar(0.75) },
  );
  // front bumper
  b.box(I, 0, 0.12, 1.08, 1.12, 0.12, 0.16, { color: trim, bottom: trim.clone().multiplyScalar(0.7) });
  b.box(I, 0, 0.14, 1.0, 0.16, 0.1, 0.12, { color: metal });
  // side pods with a stripe
  for (const sx of [-1, 1]) {
    b.hexa(
      I,
      [
        [sx * 0.42, 0.14, -0.62],
        [sx * 0.66, 0.14, -0.62],
        [sx * 0.62, 0.14, 0.28],
        [sx * 0.42, 0.14, 0.34],
        [sx * 0.42, 0.38, -0.55],
        [sx * 0.64, 0.34, -0.55],
        [sx * 0.6, 0.3, 0.22],
        [sx * 0.42, 0.34, 0.28],
      ],
      { color: main, bottom: main.clone().multiplyScalar(0.7) },
    );
    b.box(I, sx * 0.66, 0.24, -0.16, 0.04, 0.06, 0.76, { color: trim });
  }
  // seat: pan + backrest (trousers colour)
  b.box(I, 0, 0.2, -0.35, 0.52, 0.08, 0.5, { color: seatC });
  b.hexa(
    T(0, 0.26, -0.62, 0, -0.32),
    [
      [-0.28, 0, -0.06],
      [0.28, 0, -0.06],
      [0.28, 0, 0.06],
      [-0.28, 0, 0.06],
      [-0.26, 0.36, -0.06],
      [0.26, 0.36, -0.06],
      [0.26, 0.36, 0.06],
      [-0.26, 0.36, 0.06],
    ],
    { color: seatC.clone().multiplyScalar(1.1), bottom: seatC.clone().multiplyScalar(0.7) },
  );
  // engine block + exhausts
  b.box(I, 0, 0.18, -0.92, 0.6, 0.3, 0.32, { color: metal, bottom: dark });
  b.box(I, 0, 0.48, -0.92, 0.44, 0.08, 0.24, { color: dark });
  for (const sx of [-1, 1]) b.cyl(T(sx * 0.2, 0.36, -1.02, 0, Math.PI / 2), 0, 0, 0, 0.06, 0.07, 0.3, 6, { color: chrome, bottom: metal });
  // rear bumper bar
  b.box(I, 0, 0.16, -1.14, 1.2, 0.08, 0.08, { color: trim });
  for (const sx of [-1, 1]) b.box(I, sx * 0.5, 0.1, -1.06, 0.06, 0.08, 0.16, { color: metal });
  // steering column
  b.beam(I, [0, 0.3, 0.6], [0, 0.6, 0.3], 0.05, { color: dark });
  const chassis = new THREE.Mesh(b.toGeometry(), vc);
  body.add(chassis);

  // steering wheel (rotates with the steering)
  const swPivot = new THREE.Group();
  swPivot.position.set(0, 0.63, 0.27);
  swPivot.rotation.x = -0.95;
  const swMat = mat({ color: 0x1c1c20 });
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 4, 8), swMat);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.03), swMat);
  sw.add(spoke);
  swPivot.add(sw);
  body.add(swPivot);

  // number plate on the nose: the friend's face
  if (face) {
    const tex = pixelTexture(face.portrait);
    const plateMat = mat({ map: tex, unlit: 0.25 });
    plateMat.polygonOffset = true;
    plateMat.polygonOffsetFactor = -2;
    plateMat.polygonOffsetUnits = -4;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), plateMat);
    // lying on the sloped cowl, facing up-forward
    plate.position.set(0, 0.42, 0.62);
    plate.rotation.x = -Math.PI / 2 + 0.26;
    body.add(plate);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.46), mat({ color: trim }));
    frame.position.set(0, 0.415, 0.62);
    frame.rotation.x = -Math.PI / 2 + 0.26;
    body.add(frame);
  }

  // wheels
  const wheelR = 0.24;
  const tyreMat = mat({ map: tyreTexture(), uvScale: [2, 1] });
  const hubMat = mat({ color: chrome.clone().lerp(trim, 0.3) });
  const tyreGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 10, 1, false).rotateZ(Math.PI / 2);
  const rearGeo = new THREE.CylinderGeometry(wheelR + 0.03, wheelR + 0.03, 0.3, 10, 1, false).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.26, 6).rotateZ(Math.PI / 2);
  const wheels: THREE.Object3D[] = [];
  const mounts: THREE.Group[] = [];
  const mk = (x: number, z: number, rear: boolean) => {
    const mount = new THREE.Group();
    mount.position.set(x, rear ? wheelR + 0.03 : wheelR, z);
    const steerG = new THREE.Group();
    mount.add(steerG);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(rear ? rearGeo : tyreGeo, tyreMat));
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.x = x > 0 ? 0.03 : -0.03;
    spin.add(hub);
    steerG.add(spin);
    body.add(mount);
    wheels.push(spin);
    mounts.push(mount);
    return steerG;
  };
  const steerL = mk(0.62, 0.68, false);
  const steerR = mk(-0.62, 0.68, false);
  mk(0.66, -0.68, true);
  mk(-0.66, -0.68, true);

  const marker = (x: number, y: number, z: number) => {
    const m = new THREE.Object3D();
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  const exhausts = [marker(0.2, 0.36, -1.18), marker(-0.2, 0.36, -1.18)];
  const rearContacts = [marker(0.66, 0.04, -0.8), marker(-0.66, 0.04, -0.8)];
  const seat = marker(0, 0.06, -0.12);

  // anti-gravity glow
  const glowTex = makeCanvasTexture(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(120,230,255,0.95)');
    g.addColorStop(0.5, 'rgba(60,140,255,0.5)');
    g.addColorStop(1, 'rgba(40,60,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const hoverMat = mat({ map: glowTex, unlit: 1, transparent: true, depthWrite: false, fog: false });
  hoverMat.blending = THREE.AdditiveBlending;
  const hover = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.6).rotateX(-Math.PI / 2), hoverMat);
  hover.position.y = 0.04;
  hover.visible = false;
  body.add(hover);

  return {
    root,
    body,
    steerL,
    steerR,
    wheels,
    mounts,
    steeringWheel: sw,
    seat,
    exhausts,
    rearContacts,
    hover,
    materials,
    wheelR,
    dispose() {
      root.removeFromParent();
      root.traverse((ob) => {
        const m = ob as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of materials) {
        const map = (m.uniforms.map?.value as THREE.Texture | null) ?? null;
        if (map && map !== tyreTex) map.dispose();
        m.dispose();
      }
      glowTex.dispose();
    },
  };
}
