import * as THREE from 'three';
import type { FighterDef } from '../data/roster';
import { Afterimage } from './afterimage';
import { Animator } from './animator';
import { buildCharacter, type CharacterModel } from './characterModel';
import type { FaceAssets } from './faceTexture';
import { makeCanvasTexture } from './ps1Material';

let shadowTex: THREE.Texture | null = null;
export function shadowTexture() {
  if (!shadowTex) {
    shadowTex = makeCanvasTexture(32, 32, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.65)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
  return shadowTex;
}

/**
 * One friend's 3D character (skinned PS1 model + clip animator + blob shadow + ghost trail),
 * without any game logic: menus pose it directly, the race sits it in its kart (RacerView).
 */
export class CharacterView {
  readonly model: CharacterModel;
  readonly animator: Animator;
  readonly shadow: THREE.Mesh;
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private glow = 0;
  private glowColor = new THREE.Color(1, 0.55, 0.1);
  private trail: Afterimage | null = null;
  private parent: THREE.Object3D | null = null;
  private headPos = new THREE.Vector3();

  constructor(
    readonly def: FighterDef,
    face: FaceAssets,
  ) {
    this.model = buildCharacter(def, face);
    this.animator = new Animator(this.model);
    const mat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.shadow.renderOrder = 1;
  }

  get root() {
    return this.model.root;
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.model.root, this.shadow);
    this.parent = scene;
    if (this.trail) scene.add(this.trail.group);
  }

  /** Ghost trail: call every frame with a tint to leave afterimages behind (null = none, the ghosts fade out). */
  updateTrail(tint: THREE.ColorRepresentation | null, dtFrames: number, interval = 3, alpha = 0.5) {
    if (!this.trail) {
      if (tint === null) return;
      this.trail = new Afterimage(this.model);
      this.parent?.add(this.trail.group);
    }
    this.trail.update(tint, dtFrames, interval, alpha);
  }

  /** Builds the ghost trail now and compiles its shaders on the next frame (race prewarm). */
  prepareTrail() {
    if (!this.trail) {
      this.trail = new Afterimage(this.model);
      this.parent?.add(this.trail.group);
    }
    this.trail.prime();
  }

  clearTrail() {
    this.trail?.clear();
  }

  hitFlash(color: THREE.ColorRepresentation = 0xffffff, amount = 0.75) {
    this.flash = amount;
    this.flashColor.set(color);
  }

  /** steady colour glow (star power, boost): 0 = none */
  setGlow(v: number, color: THREE.ColorRepresentation = 0xff8c1a) {
    this.glow = v;
    this.glowColor.set(color);
  }

  /** world position of the head (cameras) */
  headWorld(out = this.headPos): THREE.Vector3 {
    this.model.bones.head.getWorldPosition(out);
    out.y += 0.1;
    return out;
  }

  /** Play a clip directly (menus, podium, in the kart). */
  pose(clip: string, frame: number, dtFrames: number, key = clip, blend = 6) {
    this.animator.update(key, clip, frame, dtFrames, blend);
    this.updateMaterials(dtFrames);
  }

  private updateMaterials(dtFrames: number) {
    this.flash = Math.max(0, this.flash - dtFrames * 0.12);
    for (const m of this.model.materials) {
      if (this.flash > 0) {
        m.uniforms.uFlash.value = this.flash;
        m.uniforms.uFlashColor.value.copy(this.flashColor);
      } else if (this.glow > 0) {
        m.uniforms.uFlash.value = this.glow;
        m.uniforms.uFlashColor.value.copy(this.glowColor);
      } else {
        m.uniforms.uFlash.value = 0;
      }
    }
  }

  dispose() {
    this.trail?.dispose();
    this.trail = null;
    this.model.root.removeFromParent();
    this.shadow.removeFromParent();
    this.model.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
