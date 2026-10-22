import type * as THREE from 'three';
import type { MusicId } from '../../audio/types';

/**
 * World conventions shared by every stage:
 *  - 1 unit = 1 metre, Y up. Ground is the plane y = 0.
 *  - Fighters move on the X axis only, at z = 0, inside x ∈ [-ARENA_HALF_WIDTH, ARENA_HALF_WIDTH].
 *  - The gameplay camera sits around z = +3.5..+7, y = 1..2, looking towards -Z.
 *  - The intro / KO cameras orbit the fighters at a radius of ~2.5..5 m, so keep a
 *    clear, flat floor for x ∈ [-11, 11], z ∈ [-5, 7] (no props in there).
 */
export interface StageEnv {
  /** Everything visual of the stage. */
  group: THREE.Group;
  /** Background colour behind everything (renderer clear colour). */
  clearColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** Direction TO the sun/key light, world space. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  ambient: THREE.Color;
  /** Animate clouds, flickering lights, etc. `t` = seconds since stage start. */
  update(t: number, dt: number): void;
  dispose(): void;
}

export interface StageDef {
  id: string;
  name: string;
  subtitle: string;
  music: MusicId;
  build(): StageEnv;
}
