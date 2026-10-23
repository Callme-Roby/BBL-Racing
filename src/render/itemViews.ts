import * as THREE from 'three';
import type { ItemObj, ItemSystem } from '../race/items';
import type { Race } from '../race/race';
import type { Effects } from './effects';
import { buildProjectile, buildProp, disposeProp } from './props';
import { createPS1Material, makeCanvasTexture, type PS1Material } from './ps1Material';
import type { RacerView } from './racerView';

/**
 * What the items look like: rotating « ? » boxes, the objects on the track (the friends' props
 * from BBL FIGHTERZ, made big enough to read at racing speed), the bazooka under a kart, the
 * question marks over the karts « C'EST QUOI TA CONFIG ? » hit. Purely visual: reads the
 * ItemSystem state every frame (online guests get that state from the host).
 */

function textSprite(text: string, color: string, bg: string, w = 128, h = 40): THREE.Sprite {
  const tex = makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect?.(3, 3, w - 6, h - 12, 8);
    if (!ctx.roundRect) ctx.rect(3, 3, w - 6, h - 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, h - 10);
    ctx.lineTo(14, h - 2);
    ctx.lineTo(32, h - 10);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = 'bold 18px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, (h - 8) / 2 + 1);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.6, 0.8, 1);
  return sp;
}

let boxTex: THREE.Texture | null = null;
function itemBoxTexture(): THREE.Texture {
  if (!boxTex)
    boxTex = makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px Impact, Arial Black, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', w / 2, h / 2 + 1);
    });
  return boxTex;
}

let webTex: THREE.Texture | null = null;
function webTexture(): THREE.Texture {
  if (!webTex)
    webTex = makeCanvasTexture(64, 64, (ctx, w, h) => {
      ctx.strokeStyle = 'rgba(250,250,250,0.95)';
      ctx.lineWidth = 2;
      for (let a = 0; a < 8; a++) {
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos((a * Math.PI) / 4) * 31, h / 2 + Math.sin((a * Math.PI) / 4) * 31);
        ctx.stroke();
      }
      for (const r of [7, 14, 21, 28]) {
        ctx.beginPath();
        for (let a = 0; a <= 8; a++) {
          const x = w / 2 + Math.cos((a * Math.PI) / 4) * r;
          const y = h / 2 + Math.sin((a * Math.PI) / 4) * r;
          if (a) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    });
  return webTex;
}

let sauceTex: THREE.Texture | null = null;
function sauceTexture(): THREE.Texture {
  if (!sauceTex)
    sauceTex = makeCanvasTexture(32, 32, (ctx, w, h) => {
      ctx.fillStyle = '#5a1a0c';
      ctx.beginPath();
      for (let a = 0; a <= 16; a++) {
        const r = 12 + 3 * Math.sin(a * 2.7) + 2 * Math.cos(a * 1.3);
        const x = w / 2 + Math.cos((a / 16) * Math.PI * 2) * r;
        const y = h / 2 + Math.sin((a / 16) * Math.PI * 2) * r;
        if (a) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.fill();
      ctx.fillStyle = '#a03a1c';
      ctx.beginPath();
      ctx.arc(w / 2 - 2, h / 2 - 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,220,180,0.7)';
      ctx.fillRect(w / 2 - 6, h / 2 - 6, 3, 2);
    });
  return sauceTex;
}

interface ObjView {
  root: THREE.Object3D;
  /** spinning / rolling part */
  spin: THREE.Object3D | null;
  kind: ItemObj['kind'];
  trap: boolean;
  boomSeen: boolean;
}

export class ItemViews {
  private boxMesh: THREE.InstancedMesh | null = null;
  private boxTmp = new THREE.Object3D();
  private boxMat: PS1Material;
  private objs = new Map<number, ObjView>();
  private rockets: (THREE.Object3D | null)[] = [];
  private time = 0;
  private qAcc: number[] = [];
  private tmp = new THREE.Vector3();
  private flatMats: THREE.Material[] = [];
  /** item events of the last frame worth a sound (boom positions) */
  readonly booms: { pos: THREE.Vector3; kind: string }[] = [];

  constructor(
    private scene: THREE.Scene,
    private race: Race,
    private items: ItemSystem,
    private views: RacerView[],
    private fx: Effects,
  ) {
    this.boxMat = createPS1Material({ map: itemBoxTexture(), vertexColors: true, transparent: true, unlit: 0.6 });
    const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    // rainbow vertex colours
    const cols: number[] = [];
    const pos = geo.getAttribute('position');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.setHSL(((pos.getX(i) + pos.getY(i) * 0.7 + pos.getZ(i) * 0.4) * 0.3 + 1) % 1, 0.9, 0.6);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    // all the item boxes in one draw call
    const spots = items.boxes.length ? race.track.boxes : [];
    this.boxMesh = new THREE.InstancedMesh(geo, this.boxMat, Math.max(1, spots.length));
    this.boxMesh.count = spots.length;
    this.boxMesh.frustumCulled = false;
    scene.add(this.boxMesh);
    this.rockets = race.karts.map(() => null);
    this.qAcc = race.karts.map(() => 0);
  }

  private build(o: ItemObj): ObjView {
    let root: THREE.Object3D;
    let spin: THREE.Object3D | null = null;
    const flat = (tex: THREE.Texture, size: number) => {
      const m = createPS1Material({ map: tex, transparent: true, alphaTest: 0.3, depthWrite: false, unlit: 0.3 });
      m.polygonOffset = true;
      m.polygonOffsetFactor = -3;
      m.polygonOffsetUnits = -6;
      this.flatMats.push(m);
      return new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), m);
    };
    switch (o.kind) {
      case 'ball': {
        root = new THREE.Group();
        spin = buildProp('football');
        spin.scale.setScalar(4.2);
        spin.position.y = 0.2;
        root.add(spin);
        break;
      }
      case 'grenade': {
        root = new THREE.Group();
        spin = buildProp('grenade');
        spin.scale.setScalar(6);
        root.add(spin);
        break;
      }
      case 'mic': {
        root = new THREE.Group();
        spin = buildProp('mic');
        spin.scale.setScalar(7);
        spin.rotation.x = Math.PI / 2;
        root.add(spin);
        break;
      }
      case 'words': {
        root = textSprite('LA MÉTA', '#c41e2a', '#f4f0e0');
        break;
      }
      case 'web': {
        root = new THREE.Group();
        if (o.trap) root.add(flat(webTexture(), 2.6));
        else {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: webTexture(), transparent: true, depthWrite: false }));
          sp.scale.set(1.6, 1.6, 1);
          root.add(sp);
          spin = sp;
        }
        break;
      }
      case 'sauce': {
        root = new THREE.Group();
        if (o.trap) root.add(flat(sauceTexture(), 2.4));
        else {
          const bm = createPS1Material({ color: 0x8a2414 });
          this.flatMats.push(bm);
          const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 6), bm);
          root.add(bottle);
          spin = bottle;
        }
        break;
      }
    }
    this.scene.add(root);
    return { root, spin, kind: o.kind, trap: o.trap, boomSeen: false };
  }

  private drop(v: ObjView) {
    v.root.removeFromParent();
    v.root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
      const sp = c as THREE.Sprite;
      if (sp.isSprite && sp.material.map && sp.material.map !== webTex) sp.material.map.dispose();
    });
    if (v.kind === 'ball' || v.kind === 'grenade' || v.kind === 'mic') disposeProp(v.root);
  }

  update(dt: number) {
    this.time += dt;
    this.booms.length = 0;
    const items = this.items;
    // boxes: spin, bob, pop back in
    const bm = this.boxMesh;
    if (bm) {
      const g = this.boxTmp;
      for (let i = 0; i < bm.count; i++) {
        const r = items.boxes[i]?.respawn ?? 0;
        const k = r <= 0 ? 1 : r < 0.3 ? Math.max(0, 1 - r / 0.3) : 0;
        g.scale.setScalar(Math.max(0.0001, k));
        g.rotation.set(this.time * 0.9, this.time * 1.3, 0.3);
        g.position.copy(this.race.track.boxes[i].pos);
        g.position.y += Math.sin(this.time * 2 + i) * 0.12;
        g.updateMatrix();
        bm.setMatrixAt(i, g.matrix);
      }
      bm.instanceMatrix.needsUpdate = true;
    }
    this.boxMat.uniforms.uColor.value.setHSL((this.time * 0.25) % 1, 0.5, 0.75);
    // objects
    const alive = new Set<number>();
    for (const o of items.objs) {
      alive.add(o.id);
      let v = this.objs.get(o.id);
      if (v && v.trap !== o.trap && (o.kind === 'web' || o.kind === 'sauce')) {
        // landed: from the flying look to the flat trap
        this.drop(v);
        v = undefined;
        this.objs.delete(o.id);
      }
      if (!v) {
        v = this.build(o);
        this.objs.set(o.id, v);
      }
      const p = items.objPos(o, this.tmp);
      v.root.position.copy(p);
      if (o.kind === 'words') v.root.position.y += 1.1 + Math.sin(this.time * 12) * 0.1;
      if (o.kind === 'ball') v.root.position.y += 0.35;
      if (o.kind === 'grenade') {
        v.root.position.y += 0.4;
        // blinking before it goes off
        const blink = Math.sin(o.age * (8 + o.age * 14)) > 0;
        v.root.traverse((c) => {
          const m = (c as THREE.Mesh).material as PS1Material | undefined;
          if (m?.uniforms?.uFlash) {
            m.uniforms.uFlash.value = blink ? 0.6 : 0;
            m.uniforms.uFlashColor.value.setRGB(1, 0.2, 0.1);
          }
        });
      }
      if (o.trap && (o.kind === 'web' || o.kind === 'sauce')) {
        const rb = this.race.track.main;
        const sm = rb.sample(rb.indexAt(o.s));
        v.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sm.u);
        v.root.position.addScaledVector(sm.u, 0.04);
      }
      if (v.spin) {
        if (o.kind === 'ball') v.spin.rotation.x += dt * o.vs * 1.5;
        else if (o.kind === 'mic') v.spin.rotation.z += dt * 10;
        else v.spin.rotation.y += dt * 8;
      }
      if (o.boom > 0) {
        v.root.visible = false;
        if (!v.boomSeen) {
          v.boomSeen = true;
          const at = p.clone().add(new THREE.Vector3(0, 1, 0));
          this.fx.cine('explosion', at, o.kind === 'mic' ? 4 : 3.5);
          if (o.kind === 'mic') {
            const t = textSprite('PUNCHLINE !', '#ffd23a', '#1a1a22', 160, 40);
            t.position.copy(at).add(new THREE.Vector3(0, 2, 0));
            t.scale.set(5, 1.3, 1);
            this.scene.add(t);
            setTimeout(() => {
              t.removeFromParent();
              t.material.map?.dispose();
              t.material.dispose();
            }, 1200);
          }
          this.booms.push({ pos: at, kind: o.kind });
        }
      }
    }
    for (const [id, v] of this.objs) {
      if (alive.has(id)) continue;
      if (!v.boomSeen) this.fx.cine('poof', v.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.8);
      this.drop(v);
      this.objs.delete(id);
    }
    // bazooka under the karts, question marks over the confused
    this.race.karts.forEach((k, i) => {
      const riding = items.rocket[i] > 0;
      let r = this.rockets[i];
      if (riding && !r) {
        r = buildProjectile('rocket');
        r.scale.setScalar(7);
        this.views[i].kart.body.add(r);
        r.position.set(0, 0.3, 0.2);
        this.rockets[i] = r;
      } else if (!riding && r) {
        r.removeFromParent();
        disposeProp(r);
        this.rockets[i] = null;
      }
      if (r) {
        r.rotation.z += dt * 6;
        const tail = new THREE.Vector3(0, 0.5, -1.6);
        this.views[i].kart.body.localToWorld(tail);
        this.fx.flame(tail, new THREE.Vector3(0, 0, 0), 0xffa020, 2);
      }
      if (items.confused[i] > 0) {
        this.qAcc[i] += dt;
        if (this.qAcc[i] > 0.35) {
          this.qAcc[i] = 0;
          this.fx.glyph('question', this.views[i].driver.headWorld().clone().add(new THREE.Vector3(0, 0.6, 0)), 1.4);
        }
      }
      if (k.starT > 0 && !riding && Math.random() < dt * 6) this.fx.cine('powerAura', this.views[i].driver.headWorld().clone(), 0.5);
    });
  }

  /** one of every object, for the shader warm-up (returned objects are removed by the caller) */
  samples(): THREE.Object3D[] {
    const kinds: ItemObj['kind'][] = ['ball', 'grenade', 'mic', 'words', 'web', 'sauce'];
    const out: THREE.Object3D[] = [];
    for (const kind of kinds)
      for (const trap of [false, true]) {
        const v = this.build({ kind, trap } as ItemObj);
        out.push(v.root);
      }
    const r = buildProjectile('rocket');
    this.scene.add(r);
    out.push(r);
    return out;
  }

  dispose() {
    this.boxMesh?.removeFromParent();
    this.boxMesh?.geometry.dispose();
    this.boxMesh?.dispose();
    this.boxMat.dispose();
    for (const v of this.objs.values()) this.drop(v);
    this.objs.clear();
    for (const r of this.rockets) if (r) disposeProp(r);
    for (const m of this.flatMats) m.dispose();
  }
}
