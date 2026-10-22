import * as THREE from 'three';
import type { FighterDef } from '../data/roster';
import { loadFace } from './faceTexture';
import { CharacterView } from './characterView';
import { RacerView } from './racerView';
import type { RetroPipeline } from './pipeline';
import { createPS1Material, makeCanvasTexture, PS1Globals } from './ps1Material';

/**
 * Frames the studio in a box of the screen instead of the whole canvas
 * (phone layouts: the fighters stand in the free space between the menus).
 */
export interface ShowroomFit {
  /** screen box in CSS px, e.g. an element's getBoundingClientRect() */
  box: { left: number; top: number; width: number; height: number };
  /** world height shown in the box (default 2.35: a whole fighter, feet to hair) */
  worldH?: number;
  /** minimum world width shown in the box (default 1.5: one fighter) */
  worldW?: number;
  /** world height at the centre of the box (default 1.08) */
  centerY?: number;
  /** screen x (CSS px) where each slot stands; overrides `positions` */
  slotX?: [number, number];
}

/**
 * Small studio scene used by menus (select screen, lab): fighters face the
 * camera on a lit platform in front of a gradient backdrop.
 */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 100);
  private views = new Map<string, Promise<CharacterView>>();
  private karts = new Map<string, Promise<RacerView>>();
  private slots: (CharacterView | null)[] = [null, null, null, null];
  private kartSlots: (RacerView | null)[] = [null, null, null, null];
  private slotKeys: (string | null)[] = [null, null, null, null];
  private slotClip: string[] = ['showcase', 'showcase', 'showcase', 'showcase'];
  private slotClipStart: number[] = [0, 0, 0, 0];
  /** BBL KART: the friends are shown sitting in their karts (turntable) */
  kartMode = false;
  /** number of slots used in kart mode (1..4) */
  slotCount = 2;
  private time = 0;
  private disposables: { dispose(): void }[] = [];
  readonly clear = new THREE.Color(0x0d0a1c);
  /** x positions of the two slots */
  positions: [number, number] = [-1.15, 1.15];
  cameraPos = new THREE.Vector3(0, 1.42, 4.6);
  cameraLook = new THREE.Vector3(0, 1.08, 0);
  /** set (every frame) by screens with a phone layout; null = classic full-screen framing */
  fit: ShowroomFit | null = null;
  private discs: THREE.Mesh[] = [];

  constructor() {
    // backdrop: big curved gradient wall
    const wallGeo = new THREE.CylinderGeometry(9, 9, 10, 24, 6, true, Math.PI * 0.6, Math.PI * 0.8);
    const col: number[] = [];
    const pos = wallGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + 5) / 10;
      const c = new THREE.Color().setRGB(0.05 + t * 0.25, 0.04 + t * 0.06, 0.15 + t * 0.2);
      col.push(c.r, c.g, c.b);
    }
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const wallMat = createPS1Material({ vertexColors: true, unlit: 1, fog: false, side: THREE.BackSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 4, 2);
    this.scene.add(wall);

    // floor with grid texture
    const floorTex = makeCanvasTexture(
      32,
      32,
      (ctx, w, hh) => {
        ctx.fillStyle = '#1c1830';
        ctx.fillRect(0, 0, w, hh);
        ctx.fillStyle = '#2c2650';
        ctx.fillRect(0, 0, w, 2);
        ctx.fillRect(0, 0, 2, hh);
      },
      true,
    );
    const floorMat = createPS1Material({ map: floorTex, uvScale: [10, 10] });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20, 8, 8).rotateX(-Math.PI / 2), floorMat);
    this.scene.add(floor);
    // glowing discs under the slots
    const discTex = makeCanvasTexture(32, 32, (ctx, w, hh) => {
      const g = ctx.createRadialGradient(w / 2, hh / 2, 2, w / 2, hh / 2, w / 2);
      g.addColorStop(0, 'rgba(255,170,60,0.9)');
      g.addColorStop(0.6, 'rgba(255,90,30,0.35)');
      g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, hh);
    });
    for (const x of this.positions) {
      const m = createPS1Material({ map: discTex, unlit: 1, transparent: true, depthWrite: false, fog: false });
      m.blending = THREE.AdditiveBlending;
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), m);
      disc.position.set(x, 0.01, 0);
      this.scene.add(disc);
      this.discs.push(disc);
      this.disposables.push(m);
    }
    this.disposables.push(wallGeo, wallMat, floorTex, floorMat, discTex, floor.geometry);
  }

  private getView(def: FighterDef): Promise<CharacterView> {
    const key = def.id + '|' + def.face.length + '|' + JSON.stringify(def.outfit) + JSON.stringify(def.hair) + def.build + def.headScale + def.skin;
    let p = this.views.get(key);
    if (!p) {
      p = loadFace(def).then((face) => new CharacterView(def, face));
      this.views.set(key, p);
    }
    return p;
  }

  private getKart(def: FighterDef): Promise<RacerView> {
    const key = def.id + '|' + def.face.length + '|' + JSON.stringify(def.outfit) + JSON.stringify(def.hair) + def.build + def.headScale + def.skin;
    let p = this.karts.get(key);
    if (!p) {
      p = loadFace(def).then((face) => new RacerView(def, face));
      this.karts.set(key, p);
    }
    return p;
  }

  /** Show `def` in slot 0 (left) or 1 (right) (kart mode: slots 0..3). null hides the slot. */
  async show(slot: number, def: FighterDef | null) {
    const key = def ? def.id + '|' + def.face.length + '|' + JSON.stringify(def.outfit) + JSON.stringify(def.hair) + def.build + def.headScale + def.skin : null;
    if (this.kartMode) {
      this.slotKeys[slot] = key;
      const old = this.kartSlots[slot];
      if (!def) {
        if (old) old.setVisible(false);
        this.kartSlots[slot] = null;
        return;
      }
      const v = await this.getKart(def);
      if (this.slotKeys[slot] !== key) return;
      if (old && old !== v && !this.kartSlots.some((o, i) => i !== slot && o === old)) old.setVisible(false);
      this.kartSlots[slot] = v;
      if (!v.kart.root.parent) v.addTo(this.scene);
      v.setVisible(true);
      return;
    }
    this.slotKeys[slot] = key;
    if (!def) {
      this.slots[slot]?.root.removeFromParent();
      this.slots[slot]?.shadow.removeFromParent();
      this.slots[slot] = null;
      return;
    }
    const v = await this.getView(def);
    if (this.slotKeys[slot] !== key) return; // changed meanwhile
    const old = this.slots[slot];
    if (old && old !== v) {
      old.root.removeFromParent();
      old.shadow.removeFromParent();
    }
    this.slots[slot] = v;
    v.addTo(this.scene);
    v.root.position.set(this.positions[slot], 0, 0);
    v.shadow.position.set(this.positions[slot], 0.015, 0);
    v.shadow.scale.set(0.9, 1, 0.7);
    // face the camera, slightly turned toward the centre
    v.model.body.rotation.y = slot === 0 ? 0.55 : -0.55;
    v.model.body.scale.set(slot === 0 ? 1 : -1, 1, 1).multiplyScalar(def.height ?? 1);
    this.slotClip[slot] = 'showcase';
  }

  /** Forget cached views of this definition (lab edits). */
  invalidate() {
    for (const p of this.views.values()) p.then((v) => v.dispose());
    this.views.clear();
    this.slots = [null, null];
  }

  play(slot: number, clip: string) {
    this.slotClip[slot] = clip;
    this.slotClipStart[slot] = this.time;
  }

  render(pipeline: RetroPipeline, dt: number, aspect: number) {
    this.time += dt;
    if (this.kartMode) {
      this.renderKarts(pipeline, dt, aspect);
      return;
    }
    for (let i = 0; i < 2; i++) {
      const v = this.slots[i];
      if (!v) continue;
      const clip = this.slotClip[i];
      const frame = clip === 'showcase' ? (this.time + i * 0.7) * 60 : (this.time - this.slotClipStart[i]) * 60;
      v.pose(clip, frame, dt * 60, clip + this.slotClipStart[i]);
    }
    PS1Globals.uLightDir.value.set(0.3, 0.7, 0.9).normalize();
    PS1Globals.uLightColor.value.setRGB(0.85, 0.8, 0.75);
    PS1Globals.uAmbient.value.setRGB(0.4, 0.36, 0.5);
    PS1Globals.uFogColor.value.copy(this.clear);
    PS1Globals.uFogNear.value = 12;
    PS1Globals.uFogFar.value = 30;
    let xs: [number, number] = this.positions;
    if (this.fit && this.fit.box.width > 8 && this.fit.box.height > 8) xs = this.applyFit(this.fit, pipeline.renderer.domElement) ?? xs;
    else {
      this.camera.clearViewOffset();
      this.camera.aspect = aspect;
      const narrow = aspect < 1.1;
      this.camera.fov = narrow ? 50 : 32;
      this.camera.position.copy(this.cameraPos);
      if (narrow) this.camera.position.z += 1.5;
      this.camera.lookAt(this.cameraLook);
    }
    // slots (and their floor discs) follow `positions` (or the fit), which may change with the layout
    for (let i = 0; i < 2; i++) {
      const x = xs[i];
      const v = this.slots[i];
      if (v) {
        v.root.position.x = x;
        v.shadow.position.x = x;
      }
      if (this.discs[i]) this.discs[i].position.x = x;
    }
    this.camera.updateProjectionMatrix();
    pipeline.render(this.scene, this.camera, this.clear);
  }

  /** kart mode: up to 4 karts side by side on the platform, slowly turning */
  private renderKarts(pipeline: RetroPipeline, dt: number, aspect: number) {
    const n = Math.max(1, Math.min(4, this.slotCount));
    const gap = n === 1 ? 0 : n === 2 ? 2.6 : 2.3;
    const shown = new Set<RacerView>();
    for (let i = 0; i < n; i++) {
      const v = this.kartSlots[i];
      if (!v || shown.has(v)) continue;
      shown.add(v);
      const x = (i - (n - 1) / 2) * gap;
      const clip = this.slotClip[i] === 'showcase' ? 'kart:sit' : this.slotClip[i];
      v.showcase(new THREE.Vector3(x, 0, 0), n === 1 ? 0.5 + this.time * 0.5 : 0.45 * Math.sin(this.time * 0.6 + i) - (x / 6), dt, clip);
    }
    for (const d of this.discs) d.visible = n <= 2;
    PS1Globals.uLightDir.value.set(0.3, 0.7, 0.9).normalize();
    PS1Globals.uLightColor.value.setRGB(0.85, 0.8, 0.75);
    PS1Globals.uAmbient.value.setRGB(0.45, 0.4, 0.55);
    PS1Globals.uFogColor.value.copy(this.clear);
    PS1Globals.uFogNear.value = 12;
    PS1Globals.uFogFar.value = 30;
    const width = n * gap + 1.8;
    if (this.fit && this.fit.box.width > 8 && this.fit.box.height > 8) {
      this.applyFit({ ...this.fit, worldW: Math.max(this.fit.worldW ?? 0, width), worldH: this.fit.worldH ?? 2.2, centerY: this.fit.centerY ?? 0.75 }, pipeline.renderer.domElement);
    } else {
      this.camera.clearViewOffset();
      this.camera.aspect = aspect;
      this.camera.fov = 32;
      const t = Math.tan((this.camera.fov * Math.PI) / 360);
      const d = Math.max(4.2, width / 2 / (t * aspect) + 1, 2.2 / t);
      this.camera.position.set(0, 1.5 + d * 0.12, d);
      this.camera.lookAt(0, 0.65, 0);
    }
    this.camera.updateProjectionMatrix();
    pipeline.render(this.scene, this.camera, this.clear);
  }

  /**
   * Camera for a screen box: the subject (worldW × worldH) fills the box, and
   * the projection is shifted (view offset) so the box lands where it is on screen.
   */
  private applyFit(f: ShowroomFit, canvas: HTMLCanvasElement): [number, number] | null {
    const b = f.box;
    const fov = 30;
    const t = Math.tan((fov * Math.PI) / 360);
    const ra = b.width / b.height;
    const worldH = f.worldH ?? 2.35;
    const worldW = f.worldW ?? 1.5;
    const d = Math.min(9, Math.max(2, worldH / 2 / t, worldW / 2 / (t * ra)));
    const cy = f.centerY ?? 1.08;
    this.camera.fov = fov;
    this.camera.aspect = ra;
    this.camera.position.set(0, cy + d * 0.07, d);
    this.camera.lookAt(0, cy, 0);
    // the box is in viewport px: place it relative to the canvas
    const c = canvas.getBoundingClientRect();
    this.camera.setViewOffset(b.width, b.height, c.left - b.left, c.top - b.top, Math.max(1, c.width), Math.max(1, c.height));
    if (!f.slotX) return null;
    const halfW = d * t * ra;
    const cx = b.left + b.width / 2;
    return [((f.slotX[0] - cx) / (b.width / 2)) * halfW, ((f.slotX[1] - cx) / (b.width / 2)) * halfW];
  }

  dispose() {
    for (const p of this.views.values()) p.then((v) => v.dispose());
    this.views.clear();
    for (const p of this.karts.values()) p.then((v) => v.dispose());
    this.karts.clear();
    for (const d of this.disposables) d.dispose();
  }
}
