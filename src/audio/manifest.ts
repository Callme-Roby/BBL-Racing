/**
 * manifest.ts — optional real audio files that replace the procedural sounds.
 *
 * Drop a file under `public/audio/...` and list it here (relative URL, NO leading
 * slash: the site is served with base './'). Files are fetched lazily, decoded once
 * and cached; if a file is missing or cannot be decoded, the built-in procedural
 * sound is used instead (with a single console warning).
 *
 * Formats: .mp3 and .ogg/.m4a work in all modern browsers (.ogg not on old Safari).
 * Character voice files are not listed here: see `voice.introFile` etc. in
 * src/data/roster.ts.
 */

import type { AnnouncerLine, MusicId, SfxId } from './types';

/** Music tracks. Looping tracks should be seamless loops. */
export const MUSIC_FILES: Partial<Record<MusicId, string>> = {
  // title: 'audio/music/title.mp3',
  // select: 'audio/music/select.mp3',
  // hood: 'audio/music/hood.mp3',
  // dojo: 'audio/music/dojo.mp3',
  // parking: 'audio/music/parking.mp3',
  // victory: 'audio/music/victory.mp3',
};

/** Sound effects (keep them short and tightly trimmed: they are played instantly). */
export const SFX_FILES: Partial<Record<SfxId, string>> = {
  // hitHeavy: 'audio/sfx/hit_heavy.wav',
  // roundBell: 'audio/sfx/bell.mp3',
};

/** Announcer lines (otherwise spoken by the browser's text-to-speech). */
export const ANNOUNCER_FILES: Partial<Record<AnnouncerLine, string>> = {
  // round1: 'audio/announcer/round1.mp3',
  // fight: 'audio/announcer/fight.mp3',
  // ko: 'audio/announcer/ko.mp3',
};
