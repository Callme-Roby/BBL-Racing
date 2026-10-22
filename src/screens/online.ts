import type { FighterDef } from '../data/roster';
import { goMenu } from './flow';

/** Online lobby (see step (e)). */
export function goOnlineLobby(_def: FighterDef) {
  goMenu();
}

/** Opened from an invitation link (see step (e)). */
export function goOnlineJoin(_code: string) {
  goMenu();
}
