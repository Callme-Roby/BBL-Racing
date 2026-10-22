import type { StageDef } from './types';
import { hood } from './hood';
import { dojo } from './dojo';
import { parking } from './parking';

/** All playable stages, in select-screen order. */
export const STAGES: StageDef[] = [hood, dojo, parking];

/** Stage by id (falls back to the first stage for unknown ids). */
export function getStage(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
