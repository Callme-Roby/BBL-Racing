import * as THREE from 'three';
import { BONE_NAMES, type BoneName, type CharacterModel } from './characterModel';
import { PS1Globals } from './ps1Material';

/**
 * Afterimages (ghost trails): a few translucent, tinted copies of a character
 * frozen in its recent poses, fading out quickly (dashes, super jumps, fast
 * heavy moves, throws...).
 *
 * Each ghost shares the character's body / head geometry and has its own copy
 * of the 19-bone skeleton: capturing a pose only copies bone transforms, nothing
 * is allocated per frame. A ghost is drawn twice (depth pre-pass, then colour
 * with depth test "equal or nearer") so its overlapping limbs blend as one
 * clean silhouette.
 */

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec2 uSnapRes;
varying float vRim;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3( position );
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4( transformed, 1.0 );
  vec4 clip = projectionMatrix * mv;
  if ( clip.w > 0.0 ) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor( ndc * uSnapRes + 0.5 ) / uSnapRes;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;
  vec3 n = normalize( normalMatrix * objectNormal );
  vRim = 1.0 - abs( n.z );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vRim;
void main() {
  float rim = smoothstep( 0.2, 1.0, vRim );
  vec3 col = uColor * ( 0.75 + 0.6 * rim );
  gl_FragColor = vec4( min( col, vec3( 1.0 ) ), uOpacity * ( 0.55 + 0.45 * rim ) );
}
`;

interface Ghost {
  root: THREE.Group;
  body: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  color: THREE.ShaderMaterial;
  depth: THREE.ShaderMaterial;
  life: number;
  /** opacity at capture */
  alpha: number;
}

export function ghostMaterial(colorPass: boolean): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uSnapRes: PS1Globals.uSnapRes,
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.5 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: !colorPass,
    colorWrite: colorPass,
    // pushed back a little: a ghost exactly on top of the character never tints it
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  return m;
}

export class Afterimage {
  readonly group = new THREE.Group();
  private ghosts: Ghost[] = [];
  private next = 0;
  private acc = 0;
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastYaw = 0;
  private tint = new THREE.Color();
  /** frames a ghost stays visible */
  lifeFrames = 14;

  constructor(
    private model: CharacterModel,
    count = 4,
  ) {
    const meshes: THREE.SkinnedMesh[] = [];
    model.body.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    const srcBones = model.bones;
    const inverses = model.skeleton.boneInverses;
    for (let g = 0; g < count; g++) {
      const root = new THREE.Group();
      const body = new THREE.Group();
      root.add(body);
      const bones = {} as Record<BoneName, THREE.Bone>;
      for (const n of BONE_NAMES) {
        const b = new THREE.Bone();
        b.name = n;
        b.position.copy(srcBones[n].position);
        b.quaternion.copy(srcBones[n].quaternion);
        b.scale.copy(srcBones[n].scale);
        bones[n] = b;
      }
      for (const n of BONE_NAMES) {
        const parent = srcBones[n].parent as THREE.Bone | null;
        if (parent && (parent as THREE.Bone).isBone) bones[parent.name as BoneName].add(bones[n]);
        else body.add(bones[n]);
      }
      const skeleton = new THREE.Skeleton(
        BONE_NAMES.map((n) => bones[n]),
        inverses.map((m) => m.clone()),
      );
      const color = ghostMaterial(true);
      const depth = ghostMaterial(false);
      // order: pre-pass then colour, oldest ghosts first
      for (const src of meshes) {
        for (const [mat, ord] of [
          [depth, 0],
          [color, 1],
        ] as const) {
          const m = new THREE.SkinnedMesh(src.geometry, mat);
          m.bind(skeleton, src.bindMatrix);
          m.frustumCulled = false;
          m.renderOrder = 3 + g * 2 + ord;
          body.add(m);
        }
      }
      root.visible = false;
      this.group.add(root);
      this.ghosts.push({ root, body, bones, skeleton, color, depth, life: 0, alpha: 0 });
    }
  }

  /**
   * Call every rendered frame after the character has been posed.
   * @param tint ghost colour (null = no new ghosts: the existing ones fade out)
   * @param interval frames between two ghosts
   */
  update(tint: THREE.ColorRepresentation | null, dtFrames: number, interval = 3, alpha = 0.5) {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dtFrames;
      if (g.life <= 0) {
        g.root.visible = false;
        continue;
      }
      g.color.uniforms.uOpacity.value = g.alpha * Math.pow(g.life / this.lifeFrames, 1.4);
    }
    if (tint === null || !this.model.root.visible) {
      this.acc = interval;
      this.lastPos.set(1e9, 0, 0);
      return;
    }
    this.acc += dtFrames;
    if (this.acc < interval) return;
    // nothing moved (hit stop, frozen): no ghost stacked on the character
    const hips = this.model.bones.hips;
    const pos = this.model.root.position;
    const moved = Math.abs(pos.x - this.lastPos.x) + Math.abs(pos.y - this.lastPos.y) + Math.abs(hips.position.y - this.lastYaw);
    if (moved < 0.06) return;
    this.acc = 0;
    this.lastPos.copy(pos);
    this.lastYaw = hips.position.y;
    this.capture(this.tint.set(tint), alpha);
  }

  private capture(color: THREE.Color, alpha: number) {
    const g = this.ghosts[this.next];
    this.next = (this.next + 1) % this.ghosts.length;
    const src = this.model;
    g.root.position.copy(src.root.position);
    g.root.quaternion.copy(src.root.quaternion);
    g.root.scale.copy(src.root.scale);
    g.body.position.copy(src.body.position);
    g.body.quaternion.copy(src.body.quaternion);
    g.body.scale.copy(src.body.scale);
    for (const n of BONE_NAMES) {
      const b = src.bones[n];
      const d = g.bones[n];
      d.position.copy(b.position);
      d.quaternion.copy(b.quaternion);
      d.scale.copy(b.scale);
    }
    g.color.uniforms.uColor.value.copy(color);
    g.color.uniforms.uOpacity.value = alpha;
    g.alpha = alpha;
    g.life = this.lifeFrames;
    g.root.visible = true;
    // the newest ghost is drawn last (closest to the character)
    this.ghosts.forEach((gh, i) => {
      const age = (i - this.next + this.ghosts.length) % this.ghosts.length;
      gh.body.children.forEach((m) => {
        const pre = (m as THREE.Mesh).material === gh.depth ? 0 : 1;
        m.renderOrder = 3 + age * 2 + pre;
      });
    });
  }

  /**
   * Draws one invisible ghost on the next frame so its shaders are compiled before
   * the first real trail (no hitch on the first dash of the match).
   */
  prime() {
    const g = this.ghosts[0];
    if (!g) return;
    g.color.uniforms.uOpacity.value = 0;
    g.alpha = 0;
    g.life = 1.5;
    g.root.position.copy(this.model.root.position);
    g.root.visible = true;
  }

  /** hide every ghost right away (round reset, cinematic cut) */
  clear() {
    for (const g of this.ghosts) {
      g.life = 0;
      g.root.visible = false;
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.ghosts) {
      g.skeleton.dispose();
      g.color.dispose();
      g.depth.dispose();
    }
    this.ghosts.length = 0;
  }
}
