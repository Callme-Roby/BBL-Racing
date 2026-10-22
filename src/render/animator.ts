import * as THREE from 'three';
import { BONE_NAMES, type BoneName, type CharacterModel } from './characterModel';
import { CLIPS, type Clip, type Euler3, type Pose } from './poses';

const DEG = Math.PI / 180;

function ease(t: number, kind: string | undefined): number {
  switch (kind) {
    case 'linear':
      return t;
    case 'out':
      return 1 - (1 - t) * (1 - t);
    case 'in':
      return t * t;
    default:
      return t * t * (3 - 2 * t);
  }
}

const ZERO: Euler3 = [0, 0, 0];
const tmpEuler = new THREE.Euler();

export function samplePose(clip: Clip, frame: number): { bones: Record<string, Euler3>; root: Euler3 } {
  let f = frame;
  if (clip.loop && clip.length > 0) f = ((f % clip.length) + clip.length) % clip.length;
  const keys = clip.keys;
  let k0 = keys[0];
  let k1 = keys[0];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].f <= f) {
      k0 = keys[i];
      k1 = keys[Math.min(i + 1, keys.length - 1)];
    }
  }
  const span = k1.f - k0.f;
  const t = span > 0 ? ease(Math.min(1, Math.max(0, (f - k0.f) / span)), k1.ease) : 0;
  const bones: Record<string, Euler3> = {};
  for (const b of BONE_NAMES) {
    const a = (k0.p as Pose)[b] ?? ZERO;
    const c = (k1.p as Pose)[b] ?? ZERO;
    bones[b] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  }
  const ra = k0.p.root ?? ZERO;
  const rc = k1.p.root ?? ZERO;
  const root: Euler3 = [ra[0] + (rc[0] - ra[0]) * t, ra[1] + (rc[1] - ra[1]) * t, ra[2] + (rc[2] - ra[2]) * t];
  return { bones, root };
}

/**
 * Drives a CharacterModel's skeleton from the clip library with short
 * cross-fades between clips (quaternion slerp).
 */
export class Animator {
  private key = '';
  private blend = 1;
  private blendFrames = 4;
  private from = new Map<BoneName, THREE.Quaternion>();
  private fromRoot = new THREE.Vector3();
  private target = new THREE.Quaternion();
  private hipsBind: THREE.Vector3;
  /** extra per-bone additive rotations (degrees), e.g. procedural head look */
  extra: Partial<Record<BoneName, Euler3>> = {};

  constructor(private model: CharacterModel) {
    this.hipsBind = model.bones.hips.position.clone();
    for (const b of BONE_NAMES) this.from.set(b, new THREE.Quaternion());
  }

  /**
   * @param key   changes whenever a new clip instance starts (triggers a cross-fade)
   * @param clipId clip name in CLIPS
   * @param frame frame inside the clip (can be fractional)
   * @param dtFrames elapsed frames since last update (for blending)
   */
  update(key: string, clipId: string, frame: number, dtFrames: number, blendFrames = 4) {
    const clip = CLIPS[clipId] ?? CLIPS.idle;
    const bones = this.model.bones;
    if (key !== this.key) {
      this.key = key;
      for (const b of BONE_NAMES) this.from.get(b)!.copy(bones[b].quaternion);
      this.fromRoot.copy(bones.hips.position);
      this.blend = blendFrames <= 0 ? 1 : 0;
      this.blendFrames = Math.max(1, blendFrames);
    }
    this.blend = Math.min(1, this.blend + dtFrames / this.blendFrames);
    const w = this.blend >= 1 ? 1 : this.blend * this.blend * (3 - 2 * this.blend);

    const pose = samplePose(clip, frame);
    for (const b of BONE_NAMES) {
      const e = pose.bones[b];
      const x = this.extra[b];
      tmpEuler.set((e[0] + (x?.[0] ?? 0)) * DEG, (e[1] + (x?.[1] ?? 0)) * DEG, (e[2] + (x?.[2] ?? 0)) * DEG, 'XYZ');
      this.target.setFromEuler(tmpEuler);
      const q = bones[b].quaternion;
      if (w >= 1) q.copy(this.target);
      else q.copy(this.from.get(b)!).slerp(this.target, w);
    }
    const r = pose.root;
    const tx = this.hipsBind.x + r[0];
    const ty = this.hipsBind.y + r[1];
    const tz = this.hipsBind.z + r[2];
    const hp = bones.hips.position;
    if (w >= 1) hp.set(tx, ty, tz);
    else hp.set(this.fromRoot.x + (tx - this.fromRoot.x) * w, this.fromRoot.y + (ty - this.fromRoot.y) * w, this.fromRoot.z + (tz - this.fromRoot.z) * w);
  }
}
