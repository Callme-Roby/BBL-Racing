/**
 * songs.ts — the procedural soundtrack of BBL FIGHTERZ.
 *
 * Every track is a `SongDef` (see sequencer.ts for the notation): a set of
 * instruments, a few sections (intro / A / B / A2 / break...) and an
 * arrangement. Loops are 28–32 bars long before repeating.
 *
 * Songs are built lazily on first use (`getSong`), so importing this module is cheap.
 */

import type { MusicId } from './types';
import type { SongDef } from './sequencer';
import type { TonePreset } from './synth';
import { midiToNote, noteToMidi, tokens } from './sequencer';

/* ------------------------------------------------------------------------ */
/* Notation helpers                                                          */
/* ------------------------------------------------------------------------ */

const REST_BAR = '. . . . . . . . . . . . . . . .';

/** Join melodic bars; warns when a bar is not exactly 16 steps (typo guard). */
function bars(...bs: string[]): string {
  for (const b of bs) {
    const n = tokens(b).length;
    if (n !== 16) console.warn(`[audio] bar has ${n} steps instead of 16: "${b}"`);
  }
  return bs.join(' ');
}

/** Repeat a pattern n times. */
const rep = (p: string, n: number): string => Array.from({ length: n }, () => p).join(' ');
/** n bars of melodic rest. */
const rest = (n: number): string => rep(REST_BAR, n);
/** n bars of drum rest. */
const D = (n: number): string => '.'.repeat(16 * n);
/** A single drum hit on the first step of an n-bar section (crash on the downbeat). */
const once = (n: number, c = 'X'): string => c + '.'.repeat(16 * n - 1);

/** Apply `fn` to every bar (chord symbol) of a progression and join the results. */
function prog<K extends string>(chords: K[], fn: (c: K) => string): string {
  return chords.map(fn).join(' ');
}

/** Transform every note of a melodic pattern (chords and velocity suffixes kept). */
function mapNotes(p: string, fn: (midi: number) => number): string {
  return tokens(p)
    .map((tok) => {
      if (tok === '.' || tok === '-') return tok;
      const suffix = /[!~]$/.test(tok) ? tok.slice(-1) : '';
      const body = suffix ? tok.slice(0, -1) : tok;
      return (
        body
          .split('+')
          .map((n) => midiToNote(fn(noteToMidi(n))))
          .join('+') + suffix
      );
    })
    .join(' ');
}

/** Sorted pitch classes of a scale. */
function scale(root: number, intervals: number[]): number[] {
  return intervals.map((i) => (root + i) % 12).sort((a, b) => a - b);
}
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** Move a note by `deg` scale degrees (non-scale notes snap down first). */
function shiftDegrees(midi: number, deg: number, pcs: number[]): number {
  let m = midi;
  for (let k = 0; k < 12 && !pcs.includes(((m % 12) + 12) % 12); k++) m--;
  const idx = pcs.indexOf(((m % 12) + 12) % 12);
  const oct = Math.floor(m / 12);
  const total = idx + deg;
  const n = pcs.length;
  return (oct + Math.floor(total / n)) * 12 + pcs[((total % n) + n) % n];
}

/** Diatonic harmony line: e.g. `harmonize(lead, -2, scale)` = a third below. */
const harmonize = (p: string, deg: number, pcs: number[]): string => mapNotes(p, (m) => shiftDegrees(m, deg, pcs));

/** Rhythm template for one token: 'x' hit, 'X' accent, 'o' soft, '-' hold, '.' rest. */
function rh(tok: string, tmpl: string): string {
  return [...tmpl.replace(/\s/g, '')]
    .map((c) => (c === 'x' ? tok : c === 'X' ? `${tok}!` : c === 'o' ? `${tok}~` : c))
    .join(' ');
}

/** A chord (or note) held for a whole bar. */
const hold = (chord: string): string => rh(chord, 'x---------------');

/** One bar of a riff written as semitone offsets from `root` ('.' rest, '-' hold). */
function riff(root: string, tmpl: string): string {
  const r = noteToMidi(root);
  const t = tokens(tmpl);
  return Array.from({ length: 16 }, (_, i) => {
    const tok = t[i % t.length];
    const m = /^(-?\d+)([!~]?)$/.exec(tok);
    return m ? midiToNote(r + Number(m[1])) + m[2] : tok;
  }).join(' ');
}

/** One bar of 16th-note arpeggio: `order` indexes into `notes` ('.' rest, '-' hold). */
function arp(notes: string, order: string): string {
  const ns = tokens(notes);
  const o = tokens(order);
  return Array.from({ length: 16 }, (_, i) => {
    const tok = o[i % o.length];
    return /^\d+$/.test(tok) ? ns[Number(tok) % ns.length] : tok;
  }).join(' ');
}

/* ------------------------------------------------------------------------ */
/* Synth patches                                                             */
/* ------------------------------------------------------------------------ */

const heroLead: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -8 }, { type: 'sawtooth', detune: 8 }, { type: 'square', oct: -1, gain: 0.3 }],
  a: 0.015, d: 0.3, s: 0.75, r: 0.15,
  cutoff: 1500, q: 1.5, fenv: 2600, fdecay: 0.25, ftrack: 0.5,
  glide: 0.03, vib: { rate: 5.5, depth: 18, delay: 0.25 }, level: 0.45,
};

const brass: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -6 }, { type: 'sawtooth', detune: 6 }],
  a: 0.03, d: 0.25, s: 0.7, r: 0.25,
  cutoff: 1100, q: 1, fenv: 2600, fdecay: 0.3, ftrack: 0.5,
  vib: { rate: 5.5, depth: 12, delay: 0.2 }, level: 0.5,
};

const sawBass: TonePreset = {
  osc: [{ type: 'sawtooth' }, { type: 'square', oct: -1, gain: 0.5 }],
  a: 0.004, d: 0.18, s: 0.55, r: 0.06,
  cutoff: 380, q: 4, fenv: 1300, fdecay: 0.12, level: 0.7,
};

const strings: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -12 }, { type: 'sawtooth', detune: 12 }, { type: 'triangle', oct: 1, gain: 0.3 }],
  a: 0.35, d: 0.6, s: 0.8, r: 0.6, cutoff: 1600, level: 0.45,
};

const arpPulse: TonePreset = {
  osc: [{ type: 'pulse25' }],
  a: 0.002, d: 0.11, s: 0.15, r: 0.05,
  cutoff: 3200, fenv: 1500, fdecay: 0.08,
};

const slapBass: TonePreset = {
  osc: [{ type: 'square' }, { type: 'sawtooth', gain: 0.6 }],
  a: 0.002, d: 0.14, s: 0.35, r: 0.05,
  cutoff: 500, q: 5, fenv: 2600, fdecay: 0.09, level: 0.6,
};

const stab: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -10 }, { type: 'sawtooth', detune: 10 }, { type: 'square', gain: 0.5 }],
  a: 0.003, d: 0.16, s: 0, r: 0.07,
  cutoff: 2200, fenv: 1500, fdecay: 0.1, level: 0.4,
};

const bell: TonePreset = {
  osc: [{ type: 'pulse25' }, { type: 'triangle', oct: 1, gain: 0.45 }],
  a: 0.003, d: 0.3, s: 0.3, r: 0.12,
  vib: { rate: 6, depth: 10, delay: 0.15 }, level: 0.7,
};

const flute: TonePreset = {
  osc: [{ type: 'triangle' }, { type: 'sine', oct: 1, gain: 0.15 }],
  a: 0.04, d: 0.2, s: 0.8, r: 0.12,
  glide: 0.04, vib: { rate: 5, depth: 15, delay: 0.2 },
};

/** Deep "Moog" bass for the G-funk track: saws + sub through a resonant lowpass, legato glide. */
const moog: TonePreset = {
  osc: [{ type: 'sawtooth' }, { type: 'sawtooth', detune: 7, gain: 0.6 }, { type: 'sine', oct: -1, gain: 0.6 }],
  a: 0.006, d: 0.35, s: 0.75, r: 0.08,
  cutoff: 320, q: 6, fenv: 900, fdecay: 0.22, ftrack: 0.3,
  glide: 0.07, drive: 0.25, level: 0.5,
};

/** The signature G-funk whistle: high sine with portamento between every note + delayed vibrato. */
const whine: TonePreset = {
  osc: [{ type: 'sine' }, { type: 'triangle', gain: 0.2 }],
  a: 0.03, d: 0.2, s: 0.9, r: 0.1,
  glide: 0.09, glideAlways: true, vib: { rate: 5.6, depth: 28, delay: 0.18 },
};

const rhodes: TonePreset = {
  osc: [{ type: 'triangle' }, { type: 'sine', oct: 1, gain: 0.3 }],
  a: 0.004, d: 1.4, s: 0.25, r: 0.3, cutoff: 2600, level: 0.75,
};

const funkPad: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -9 }, { type: 'sawtooth', detune: 9 }],
  a: 0.6, d: 0.5, s: 0.8, r: 0.9, cutoff: 900, level: 0.5,
};

const koto: TonePreset = {
  osc: [{ type: 'triangle' }, { type: 'sawtooth', oct: 1, gain: 0.25 }],
  a: 0.001, d: 0.45, s: 0, r: 0.25,
  cutoff: 3800, fenv: 2000, fdecay: 0.1, level: 0.8,
};

const dojoLead: TonePreset = {
  osc: [{ type: 'square' }, { type: 'sawtooth', detune: 7, gain: 0.5 }],
  a: 0.01, d: 0.2, s: 0.7, r: 0.1,
  cutoff: 2400, fenv: 2000, fdecay: 0.15, ftrack: 0.4,
  glide: 0.03, vib: { rate: 6.2, depth: 20, delay: 0.2 }, level: 0.6,
};

const sawArp: TonePreset = {
  osc: [{ type: 'sawtooth' }],
  a: 0.002, d: 0.15, s: 0.1, r: 0.1,
  cutoff: 1200, q: 3, fenv: 2800, fdecay: 0.09,
};

const darkPad: TonePreset = {
  osc: [{ type: 'sawtooth', detune: -12 }, { type: 'sawtooth', detune: 12 }],
  a: 1.2, d: 1, s: 0.85, r: 1.4, cutoff: 800, q: 2, level: 0.45,
};

const pulseBass: TonePreset = {
  osc: [{ type: 'sawtooth' }, { type: 'square', oct: -1, gain: 0.4 }],
  a: 0.002, d: 0.09, s: 0.25, r: 0.03,
  cutoff: 500, q: 6, fenv: 1400, fdecay: 0.07, level: 0.7,
};

const darkLead: TonePreset = {
  osc: [{ type: 'square' }, { type: 'pulse25', detune: 9, gain: 0.6 }],
  a: 0.02, d: 0.3, s: 0.7, r: 0.25,
  cutoff: 2000, fenv: 1000, fdecay: 0.2,
  glide: 0.05, vib: { rate: 5, depth: 15, delay: 0.3 }, level: 0.6,
};

/** Dusty sampled-piano feel for boom-bap: muffled, quick decay, a little detuned. */
const dustyKeys: TonePreset = {
  osc: [{ type: 'triangle' }, { type: 'square', detune: 6, gain: 0.18 }, { type: 'sine', oct: 1, gain: 0.25 }],
  a: 0.003, d: 0.9, s: 0.12, r: 0.25,
  cutoff: 1300, fenv: 1400, fdecay: 0.12, ftrack: 0.3, level: 0.6,
};

/** Deep round boom-bap bass: sine + a touch of triangle/saw for definition on small speakers. */
const boomBass: TonePreset = {
  osc: [{ type: 'sine' }, { type: 'triangle', gain: 0.5 }, { type: 'sawtooth', gain: 0.12 }],
  a: 0.006, d: 0.5, s: 0.55, r: 0.1,
  cutoff: 420, fenv: 250, fdecay: 0.1,
  glide: 0.05, level: 0.9,
};

/** Fake turntable scratch: a gritty band-passed tone gliding between every note ("wicka"). */
const scratchy: TonePreset = {
  osc: [{ type: 'sawtooth' }, { type: 'square', detune: 20, gain: 0.5 }],
  a: 0.004, d: 0.06, s: 0.7, r: 0.03,
  cutoff: 900, filterType: 'bandpass', q: 1.6, ftrack: 1,
  glide: 0.035, glideAlways: true, drive: 0.6, level: 0.5,
};

/* ------------------------------------------------------------------------ */
/* TITLE — epic arcade title theme, D minor, 128 bpm                         */
/* ------------------------------------------------------------------------ */

function title(): SongDef {
  const PAD = { Dm: 'D4+F4+A4', Bb: 'D4+F4+Bb4', C: 'E4+G4+C5', A: 'C#4+E4+A4', Gm: 'D4+G4+Bb4' };
  const ARP = { Dm: 'D4 F4 A4 D5', Bb: 'D4 F4 Bb4 D5', C: 'E4 G4 C5 E5', A: 'E4 A4 C#5 E5', Gm: 'D4 G4 Bb4 D5' };
  const ROOT = { Dm: 'D2', Bb: 'Bb1', C: 'C2', A: 'A1', Gm: 'G1' };
  type C = keyof typeof PAD;
  const progIntro: C[] = ['Dm', 'Dm', 'Bb', 'C'];
  const progA: C[] = ['Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A'];
  const progB: C[] = ['Gm', 'Bb', 'C', 'A', 'Gm', 'Bb', 'C', 'A'];
  const progBreak: C[] = ['Bb', 'C', 'A', 'A'];

  const pad = (p: C[]) => prog(p, (c) => hold(PAD[c]));
  const arps = (p: C[]) => prog(p, (c) => arp(ARP[c], '0 1 2 3'));
  const bass = (p: C[]) => prog(p, (c) => riff(ROOT[c], '0 . 0 0 12 . 0 . 0 . 0 0 12 . 7 .'));
  const bassHold = (p: C[]) => prog(p, (c) => hold(ROOT[c]));

  const leadA = bars(
    'D5 - - - A4 - - - D5 - E5 - F5 - - -',
    'F5 - E5 - D5 - - - Bb4 - - - D5 - - -',
    'E5 - - - C5 - - - E5 - F5 - G5 - - -',
    'A5 - - - - - - - - - - - G5 - F5 -',
    'D5 - - - A4 - - - D5 - E5 - F5 - G5 -',
    'A5 - - - - - Bb5 - A5 - G5 - F5 - - -',
    'G5 - - - E5 - C5 - E5 - G5 - C6 - - -',
    'A5 - - - - - - - E5 - - - C#5 - - -',
  );
  const leadB = bars(
    'G5 - - - Bb5 - - - D6 - - - C6 - Bb5 -',
    'A5 - - - F5 - - - - - - - D5 - F5 -',
    'G5 - - - E5 - - - C5 - E5 - G5 - Bb5 -',
    'A5 - - - - - - - C#6 - - - E6 - - -',
    'Bb5 - - - A5 - - - G5 - - - D5 - - -',
    'F5 - - - G5 - - - A5 - Bb5 - A5 - F5 -',
    'E5 - - - G5 - - - C6 - - - Bb5 - G5 -',
    'A5 - - - - - - - - - - - - - - -',
  );

  const snare8 = '....x.......x...'.repeat(7) + '....x...x.x.xxXX';
  return {
    bpm: 128,
    loopFrom: 1,
    gain: 0.75,
    instruments: {
      kick: { drum: 'kick', gain: 0.9 },
      snare: { drum: 'snare', gain: 0.5, rev: 0.25 },
      hat: { drum: 'hat', gain: 0.22, pan: 0.25 },
      ohat: { drum: 'openHat', gain: 0.16, pan: 0.25 },
      crash: { drum: 'crash', gain: 0.3, pan: -0.2, rev: 0.2 },
      tom: { drum: 'tom', gain: 0.55, rev: 0.25 },
      bass: { synth: sawBass, gain: 0.46 },
      pad: { synth: strings, gain: 0.16, rev: 0.45 },
      arp: { synth: arpPulse, gain: 0.08, pan: -0.35, dly: 0.35 },
      lead: { synth: heroLead, gain: 0.42, rev: 0.25, dly: 0.2 },
      harm: { synth: heroLead, gain: 0.22, pan: 0.3, rev: 0.3 },
    },
    sections: {
      intro: {
        bars: 4,
        tracks: {
          kick: 'x...............'.repeat(3) + 'x.......x.......',
          tom: 'X.....x.....x...'.repeat(3) + 'x.x.x.x.xoxoxXXX',
          snare: D(3) + '........xxxxXXXX',
          crash: once(4),
          pad: pad(progIntro),
          arp: arps(progIntro),
          bass: bassHold(progIntro),
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick: 'x.......x.x.....',
          snare: snare8,
          hat: 'x.x.x.x.x.x.x.x.',
          ohat: '..............x.',
          crash: once(8),
          bass: bass(progA),
          pad: pad(progA),
          arp: arps(progA),
          lead: leadA,
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick: 'x.......x.x...x.',
          snare: snare8,
          hat: 'xoxoxoxoxoxoxoxo',
          crash: once(8),
          bass: bass(progB),
          pad: pad(progB),
          arp: arps(progB),
          lead: leadB,
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick: 'x.......x.x.....',
          snare: snare8,
          hat: 'xoxoxoxoxoxoxoxo',
          ohat: '..............x.',
          crash: once(8),
          bass: bass(progA),
          pad: pad(progA),
          arp: arps(progA),
          lead: leadA,
          harm: harmonize(leadA, -2, scale(2, MINOR)),
        },
      },
      brk: {
        bars: 4,
        tracks: {
          kick: 'x.......x.......'.repeat(2) + 'x...x...x...x...' + 'x...x...x.x.x.x.',
          snare: D(2) + '....x.......x...' + 'x.x.x.x.xxxxXXXX',
          hat: 'x...x...x...x...',
          pad: pad(progBreak),
          arp: arps(progBreak),
          bass: bassHold(progBreak),
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'A2', 'brk'],
  };
}

/* ------------------------------------------------------------------------ */
/* SELECT — bouncy character-select loop, C major, 118 bpm                   */
/* ------------------------------------------------------------------------ */

function select(): SongDef {
  const STAB = { F: 'F3+A3+C4+E4', Em: 'E3+G3+B3+D4', Dm: 'D3+F3+A3+C4', G: 'D3+G3+B3+D4', Am: 'E3+G3+A3+C4', G7: 'F3+G3+B3+D4' };
  const ARP = { F: 'F5 A5 C6 E6', Em: 'E5 G5 B5 D6', Dm: 'D5 F5 A5 C6', G: 'D5 G5 B5 D6', Am: 'E5 A5 C6 E6', G7: 'F5 G5 B5 D6' };
  const ROOT = { F: 'F2', Em: 'E2', Dm: 'D2', G: 'G2', Am: 'A2', G7: 'G2' };
  type C = keyof typeof STAB;
  const progIntro: C[] = ['F', 'G7'];
  const progA: C[] = ['F', 'Em', 'Dm', 'G', 'F', 'Em', 'Dm', 'G7'];
  const progB: C[] = ['Dm', 'G', 'Em', 'Am', 'Dm', 'G', 'F', 'G7'];
  const progBreak: C[] = ['F', 'Em', 'Dm', 'G7'];

  const bass = (p: C[]) => prog(p, (c) => riff(ROOT[c], '0 . 12 . . 0 12 . 0 . 12 . 0 12 7 .'));
  const stabs = (p: C[], tmpl: string) => prog(p, (c) => rh(STAB[c], tmpl));
  const plucks = (p: C[]) => prog(p, (c) => arp(ARP[c], '0 . 1 . 2 . 1 . 0 . 1 . 2 . 3 .'));

  const hook = bars(
    'C5 . A4 . . C5 . A4 - . G4 . A4 . . .',
    'B4 . G4 . . B4 . G4 - . E4 . G4 . . .',
    'A4 . F4 . . A4 . F4 - . D4 . F4 . E4 .',
    'D4 - - . G4 - - . B4 - - . D5 - . .',
    'C5 . A4 . . C5 . A4 - . G4 . A4 . C5 .',
    'D5 . B4 . . D5 . B4 - . G4 . B4 . D5 .',
    'E5 . D5 . C5 . A4 . . F4 . A4 . C5 . .',
    'B4 - - - . . G4 . . . . . . . . .',
  );
  const counter = bars(
    'F5 - - - E5 - D5 - . . A4 - C5 - D5 -',
    'D5 - - - - - . . B4 - D5 - G5 - - -',
    'G5 - - - E5 - D5 - . . B4 - D5 - E5 -',
    'E5 - - - - - . . C5 - E5 - A5 - - -',
    'A5 - - - G5 - F5 - . . D5 - F5 - A5 -',
    'B5 - - - A5 - G5 - . . D5 - G5 - B5 -',
    'C6 - - - B5 - A5 - G5 - - - E5 - - -',
    'D5 - - - - - - - . . . . . . . .',
  );

  const snare8 = '....x.......x...'.repeat(7) + '....x.......xxXX';
  return {
    bpm: 118,
    loopFrom: 1,
    gain: 0.8,
    delayBeats: 0.75,
    instruments: {
      kick: { drum: 'kick', gain: 0.85 },
      clap: { drum: 'clap', gain: 0.4, rev: 0.2 },
      snare: { drum: 'snare', gain: 0.25 },
      hat: { drum: 'hat', gain: 0.17, pan: -0.2 },
      ohat: { drum: 'openHat', gain: 0.13, pan: -0.2 },
      shaker: { drum: 'shaker', gain: 0.12, pan: 0.35 },
      crash: { drum: 'crash', gain: 0.25, rev: 0.2 },
      bass: { synth: slapBass, gain: 0.4 },
      stab: { synth: stab, gain: 0.25, pan: 0.1, dly: 0.15 },
      lead: { synth: bell, gain: 0.6, pan: -0.1, rev: 0.2, dly: 0.2 },
      flute: { synth: flute, gain: 0.23, pan: 0.2, rev: 0.3, dly: 0.15 },
      pluck: { synth: arpPulse, gain: 0.12, pan: 0.4, dly: 0.3 },
    },
    sections: {
      intro: {
        bars: 2,
        tracks: {
          kick: 'x.....x.x.x.....',
          clap: '....x.......x...',
          hat: 'x.x.x.x.x.x.x.x.',
          snare: D(1) + '........xxxxXXXX',
          bass: bass(progIntro),
          stab: stabs(progIntro, '..x...x...x...x.'),
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick: 'x.....x.x.x.....',
          clap: '....x.......x...',
          snare: snare8,
          hat: 'x.x.x.x.x.x.x.x.',
          ohat: '..............x.',
          crash: once(8),
          bass: bass(progA),
          stab: stabs(progA, '..x...x...x...x.'),
          lead: hook,
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick: 'x.....x.x.x.....',
          clap: '....x.......x...',
          snare: snare8,
          hat: 'xoxoxoxoxoxoxoxo',
          shaker: 'o.x.o.x.o.x.o.x.',
          crash: once(8),
          bass: bass(progB),
          stab: stabs(progB, '..x..x....x..x..'),
          flute: counter,
          pluck: plucks(progB),
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick: 'x.....x.x.x.....',
          clap: '....x.......x...',
          snare: snare8,
          hat: 'xoxoxoxoxoxoxoxo',
          ohat: '..............x.',
          crash: once(8),
          bass: bass(progA),
          stab: stabs(progA, '..x...x...x...x.'),
          lead: hook,
          flute: harmonize(hook, -2, scale(0, MAJOR)),
        },
      },
      brk: {
        bars: 4,
        tracks: {
          kick: 'x.....x.........',
          clap: '....x.......x...',
          snare: D(3) + '....x...x.xxxxXX',
          shaker: 'o.x.o.x.o.x.o.x.',
          bass: bass(progBreak),
          stab: stabs(progBreak, '..x..x....x..x..'),
          pluck: plucks(progBreak),
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'A2', 'brk'],
  };
}

/* ------------------------------------------------------------------------ */
/* HOOD — West-coast G-funk for "Sunset Hood", E dorian, 92 bpm, swung       */
/* ------------------------------------------------------------------------ */

function hood(): SongDef {
  const KEYS = {
    Em9: 'G3+B3+D4+F#4',
    A9: 'G3+B3+C#4+E4',
    Cmaj7: 'G3+B3+C4+E4',
    Bm7: 'F#3+A3+B3+D4',
    Am7: 'G3+A3+C4+E4',
    B7: 'F#3+A3+B3+D#4',
  };
  type C = keyof typeof KEYS;
  const progA: C[] = ['Em9', 'A9', 'Em9', 'A9', 'Em9', 'A9', 'Em9', 'A9'];
  const progB: C[] = ['Cmaj7', 'Bm7', 'Am7', 'B7', 'Cmaj7', 'Bm7', 'Am7', 'B7'];
  const progShort: C[] = ['Em9', 'A9', 'Em9', 'A9'];

  const keys = (p: C[]) => prog(p, (c) => rh(KEYS[c], 'x--...x---......'));
  const pad = (p: C[]) => prog(p, (c) => hold(KEYS[c]));

  // Moog bass: long notes sliding into fills, locked with the kick (steps 1, 8, 11).
  const bEm = 'E2 - - - - - - E2 - . B1 - D2 - E2 -';
  const bA = 'A1 - - - - - - A2 - . G2 - E2 - D2 -';
  const bEm2 = 'E2 - - - - - - B1 - . E2 - G2 - A2 -';
  const bA2 = 'A1 - - - - - - A2 - . E2 - G2 - B2 -';
  const bassA = bars(bEm, bA, bEm, bA, bEm, bA, bEm2, bA2);
  const bassB = rep(
    bars(
      'C2 - - - - - - C2 - . G1 - B1 - C2 -',
      'B1 - - - - - - B1 - . F#1 - A1 - B1 -',
      'A1 - - - - - - A1 - . E1 - G1 - A1 -',
      'B1 - - - - - - B1 - . D#2 - F#2 - A2 -',
    ),
    2,
  );
  const bassShort = bars(bEm, bA, bEm, bA2);

  const whineA4 = bars(
    'B5 - - - - - - - - - A5 - G5 - E5 -',
    'G5 - - - - - - - . . . . . . . .',
    'B5 - - - - - D6 - B5 - - - A5 - G5 -',
    'A5 - - - - - - - - - - - . . E5 -',
  );
  const whineA = whineA4 + ' ' + bars(
    'G5 - - - - - - - E5 - G5 - A5 - B5 -',
    'C#6 - - - - - - - B5 - - - A5 - - -',
    'B5 - - - - - - - - - - - G5 - A5 -',
    'E5 - - - - - - - - - - - . . . .',
  );
  const whineB = bars(
    'G5 - - - - - - - B5 - - - - - E6 -',
    'D6 - - - - - - - B5 - - - A5 - - -',
    'C6 - - - - - - - A5 - - - G5 - E5 -',
    'F#5 - - - - - - - A5 - - - B5 - - -',
    'E6 - - - - - - - D6 - - - B5 - G5 -',
    'F#5 - - - - - - - - - - - A5 - B5 -',
    'C6 - - - - - - - B5 - - - A5 - - -',
    'B5 - - - - - - - A5 - - - F#5 - - -',
  );
  const whineA2 = whineA4 + ' ' + bars(
    'E6 - - - - - - - D6 - - - B5 - - -',
    'C#6 - - - - - - - - - - - A5 - B5 -',
    'G5 - - - - - - - E5 - - - D5 - E5 -',
    'E5 - - - - - - - - - - - . . . .',
  );
  const whineIntro = rest(1) + ' ' + bars(
    'B5 - - - - - - - - - - - - - - -',
    'A5 - - - - - - - G5 - - - E5 - - -',
    'E5 - - - - - - - - - - - . . . .',
  );

  const kick2 = 'x......x..x.....' + 'x......x..x..x..';
  const hats = 'xoxoxoxoxoxoxo.o';
  return {
    bpm: 92,
    swing: 0.2,
    loopFrom: 1,
    gain: 0.7,
    delayFeedback: 0.3,
    instruments: {
      kick: { drum: 'kick', tune: 0.85, decay: 1.2, gain: 0.45, drive: 0.35 },
      snare: { drum: 'snare', tune: 0.9, gain: 0.25, rev: 0.2 },
      clap: { drum: 'clap', gain: 0.6, rev: 0.3 },
      hat: { drum: 'hat', gain: 0.15, pan: 0.2 },
      ohat: { drum: 'openHat', gain: 0.12, pan: 0.2 },
      rim: { drum: 'rim', gain: 0.2, pan: -0.2, rev: 0.2 },
      bass: { synth: moog, gain: 0.35 },
      whine: { synth: whine, gain: 0.18, pan: -0.1, rev: 0.3, dly: 0.25 },
      keys: { synth: rhodes, gain: 0.15, pan: 0.15, rev: 0.3 },
      pad: { synth: funkPad, gain: 0.08, pan: -0.15, rev: 0.5 },
    },
    sections: {
      intro: {
        bars: 4,
        tracks: {
          hat: hats,
          kick: D(3) + 'x......x..x.....',
          clap: D(3) + '....x.......x.xx',
          keys: keys(progShort),
          pad: pad(progShort),
          whine: whineIntro,
          bass: rest(2) + ' ' + bars(bEm, bA2),
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick: kick2,
          snare: '....x.......x...',
          clap: '....x.......x...',
          hat: hats,
          ohat: '..............x.',
          bass: bassA,
          keys: keys(progA),
          whine: whineA,
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick: kick2,
          snare: '....x.......x...',
          clap: '....x.......x...',
          hat: hats,
          ohat: '..............x.',
          bass: bassB,
          keys: keys(progB),
          pad: pad(progB),
          whine: whineB,
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick: kick2,
          snare: '....x.......x...',
          clap: '....x.......x...',
          hat: hats,
          ohat: '..............x.',
          rim: '...x......x....x',
          bass: bassA,
          keys: keys(progA),
          pad: pad(progA),
          whine: whineA2,
        },
      },
      brk: {
        bars: 4,
        tracks: {
          kick: 'x......x..x.....',
          rim: '....x.......x...',
          clap: D(3) + '....x.......x.xx',
          hat: 'x.x.x.x.x.x.x.x.',
          bass: bassShort,
          keys: keys(progShort),
          whine: rest(2) + ' ' + bars('B5 - - - - - - - - - - - - - - -', 'A5 - - - - - - - G5 - - - E5 - - -'),
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'A2', 'brk'],
  };
}

/* ------------------------------------------------------------------------ */
/* DOJO — Tekken-3-style mountain-top stage, A minor / In scale, 150 bpm     */
/* ------------------------------------------------------------------------ */

function dojo(): SongDef {
  const PAD = { Am: 'A3+C4+E4', F: 'A3+C4+F4', G: 'B3+D4+G4', Em: 'B3+E4+G4', Dm: 'A3+D4+F4', E: 'G#3+B3+E4', A5: 'A3+E4+A4' };
  const ARP = { Am: 'A4 C5 E5 A5', F: 'F4 A4 C5 F5', G: 'G4 B4 D5 G5', Em: 'E4 G4 B4 E5', Dm: 'D4 F4 A4 D5', E: 'E4 G#4 B4 E5', A5: 'A4 E5 A5 E5' };
  const ROOT = { Am: 'A2', F: 'F2', G: 'G2', Em: 'E2', Dm: 'D2', E: 'E2', A5: 'A2' };
  type C = keyof typeof PAD;
  const progIntro: C[] = ['A5', 'A5', 'A5', 'A5'];
  const progA: C[] = ['Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'Em'];
  const progB: C[] = ['Dm', 'Am', 'F', 'E', 'Dm', 'Am', 'F', 'E'];
  const progBreak: C[] = ['Am', 'Am', 'F', 'E'];

  const pad = (p: C[]) => prog(p, (c) => hold(PAD[c]));
  const arpUp = (p: C[]) => prog(p, (c) => arp(ARP[c], '0 1 2 3'));
  const arpDown = (p: C[]) => prog(p, (c) => arp(ARP[c], '3 2 1 0 2 1 3 1'));
  const bass8 = (p: C[]) => prog(p, (c) => riff(ROOT[c], '0 . 12 . 0 . 12 . 0 . 12 . 0 12 0 12'));
  const bass16 = (p: C[]) => prog(p, (c) => riff(ROOT[c], '0 0 12 0 0 12 0 12'));
  const bassHold = (p: C[]) => prog(p, (c) => hold(ROOT[c]));

  const leadA = bars(
    'E5 - - G5 A5 - - - C6 - A5 - G5 - E5 -',
    'D5 - - - - - E5 - G5 - - - A5 - - -',
    'G5 - - A5 B5 - - - D6 - B5 - A5 - G5 -',
    'E5 - - - - - - - - - - - . . . .',
    'E5 - - G5 A5 - - - C6 - D6 - E6 - - -',
    'D6 - C6 - A5 - - - C6 - - - D6 - - -',
    'B5 - - - G5 - - - D6 - - - B5 - G5 -',
    'E5 - - - - - - - - - - - - - - -',
  );
  // "In" scale (A Bb D E F): the eastern flavour.
  const leadB = bars(
    'D6 - - - - - Bb5 - A5 - - - F5 - - -',
    'E5 - - - F5 - E5 - D5 - - - E5 - - -',
    'F5 - - - A5 - - - Bb5 - A5 - F5 - - -',
    'E5 - - - - - - - F5 - - - E5 - - -',
    'A5 - - - Bb5 - - - D6 - - - E6 - - -',
    'E6 - - - D6 - - - Bb5 - - - A5 - - -',
    'F5 - - - A5 - - - Bb5 - - - D6 - - -',
    'B5 - - - - - - - G#5 - - - E5 - - -',
  );
  const kotoIntro = bars(
    'A4 . Bb4 . D5 . E5 . F5 . . . E5 . . .',
    'D5 . . . Bb4 . . . A4 . . . . . . .',
    'E5 . F5 . A5 . . . Bb5 . A5 . F5 . E5 .',
    'D5 . E5 . . . A4 - - - - - - - . .',
  );
  const kotoBreak = bars(
    'A5 . E5 . F5 . E5 . D5 . . . E5 . . .',
    'A4 . Bb4 . D5 . E5 . F5 . E5 . D5 . Bb4 .',
    'A4 . C5 . F5 . A5 . C6 . A5 . F5 . C5 .',
    'E5 . F5 . G#5 . B5 . E6 . . . . . . .',
  );

  const breakKick = 'x.........x.....' + 'x.x.......x...x.';
  const breakSnare2 = '....x.......x...' + '....x..o.o..x..o';
  const snareA = breakSnare2.repeat(3) + '....x.......x...' + '....x...x.xxXXXX';
  return {
    bpm: 150,
    loopFrom: 1,
    gain: 0.73,
    delayBeats: 0.75,
    instruments: {
      kick: { drum: 'kick', gain: 0.9 },
      snare: { drum: 'snare', gain: 0.45, rev: 0.2 },
      hat: { drum: 'hat', gain: 0.15, pan: 0.25 },
      ohat: { drum: 'openHat', gain: 0.12, pan: 0.25 },
      crash: { drum: 'crash', gain: 0.25, rev: 0.2 },
      taiko: { drum: 'taiko', gain: 0.7, rev: 0.35 },
      rim: { drum: 'rim', gain: 0.22, pan: -0.4, rev: 0.2 },
      riser: { drum: 'riser', gain: 0.25, decay: 1.65, rev: 0.3 },
      bass: { synth: sawBass, gain: 0.36 },
      arp: { synth: arpPulse, gain: 0.09, pan: -0.35, dly: 0.3 },
      arp2: { synth: sawArp, gain: 0.07, pan: 0.35, dly: 0.25 },
      lead: { synth: dojoLead, gain: 0.27, rev: 0.25, dly: 0.2 },
      harm: { synth: dojoLead, gain: 0.15, pan: 0.3, rev: 0.3 },
      koto: { synth: koto, gain: 0.25, pan: -0.15, rev: 0.35, dly: 0.2 },
      pad: { synth: strings, gain: 0.13, rev: 0.5 },
    },
    sections: {
      intro: {
        bars: 4,
        tracks: {
          taiko: 'X.....x.x.......'.repeat(3) + 'x.x.x.x.xxxxXXXX',
          rim: '........x.......',
          pad: pad(progIntro),
          koto: kotoIntro,
          riser: D(2) + once(2, 'x'),
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick: breakKick,
          snare: snareA,
          hat: 'x.x.x.x.x.x.x.x.',
          ohat: D(1) + '..............x.',
          crash: once(8),
          bass: bass8(progA),
          arp: arpUp(progA),
          pad: pad(progA),
          lead: leadA,
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick: 'x...x...x...x...',
          snare: '....x.......x...'.repeat(7) + '....x...xxxxXXXX',
          ohat: '..x...x...x...x.',
          hat: 'xo.oxo.oxo.oxo.o',
          rim: '...x.....x....x.',
          crash: once(8),
          bass: bass16(progB),
          arp: arpUp(progB),
          arp2: arpDown(progB),
          pad: pad(progB),
          lead: leadB,
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick: 'x...x...x...x...',
          snare: snareA,
          hat: 'xo.oxo.oxo.oxo.o',
          ohat: '..x...x...x...x.',
          crash: once(8),
          taiko: once(8),
          bass: bass8(progA),
          arp: arpUp(progA),
          arp2: arpDown(progA),
          lead: leadA,
          harm: harmonize(leadA, -2, scale(9, MINOR)),
        },
      },
      brk: {
        bars: 4,
        tracks: {
          taiko: 'X.......x.x.....'.repeat(2) + 'X...x...X...x...' + 'X.x.X.x.XxXxXXXX',
          rim: '..x...x...x...x.',
          snare: D(3) + '....x...xxxxXXXX',
          riser: D(2) + once(2, 'x'),
          bass: bassHold(progBreak),
          pad: pad(progBreak),
          koto: kotoBreak,
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'A2', 'brk'],
  };
}

/* ------------------------------------------------------------------------ */
/* PARKING — night "Neon Parking": dark synthwave/techno, F minor, 124 bpm   */
/* ------------------------------------------------------------------------ */

function parking(): SongDef {
  const PAD = { Fm: 'F3+C4+Ab4', Db: 'F3+Db4+Ab4', Eb: 'G3+Eb4+Bb4', C: 'G3+E4+C5' };
  const ARP = { Fm: 'F4 Ab4 C5 F5', Db: 'F4 Ab4 Db5 F5', Eb: 'G4 Bb4 Eb5 G5', C: 'G4 C5 E5 G5' };
  const ROOT = { Fm: 'F2', Db: 'Db2', Eb: 'Eb2', C: 'C2' };
  type C = keyof typeof PAD;
  const progIntro: C[] = ['Fm', 'Fm', 'Db', 'C'];
  const progA: C[] = ['Fm', 'Db', 'Eb', 'C', 'Fm', 'Db', 'Eb', 'C'];
  const progBreak: C[] = ['Db', 'Eb', 'Fm', 'C'];

  const pad = (p: C[]) => prog(p, (c) => hold(PAD[c]));
  const arps = (p: C[]) => prog(p, (c) => arp(ARP[c], '0 1 2 1 3 1 2 1'));
  // Pulsing 16ths that duck around the kick (fake sidechain).
  const bass = (p: C[]) => prog(p, (c) => riff(ROOT[c], '. 0 0 0 . 0 0 0 . 0 0 0 . 0 0 12'));

  const lead = bars(
    'F5 - - - - - Eb5 - C5 - - - - - - -',
    'Db5 - - - - - C5 - Ab4 - - - - - - -',
    'Bb4 - - - - - C5 - Eb5 - - - G5 - - -',
    'E5 - - - - - - - - - - - G5 - - -',
    'Ab5 - - - - - G5 - F5 - - - C5 - - -',
    'F5 - - - - - Eb5 - Db5 - - - Ab4 - - -',
    'G4 - - - Bb4 - - - Eb5 - - - G5 - - -',
    'E5 - - - - - - - - - - - - - - -',
  );

  return {
    bpm: 124,
    loopFrom: 1,
    gain: 0.77,
    delayBeats: 0.75,
    delayFeedback: 0.45,
    reverb: 3,
    instruments: {
      kick: { drum: 'kick', gain: 0.45, drive: 0.2 },
      clap: { drum: 'clap', gain: 0.42, rev: 0.35 },
      hat: { drum: 'hat', gain: 0.12, pan: 0.3 },
      ohat: { drum: 'openHat', gain: 0.15, pan: -0.25 },
      crash: { drum: 'crash', gain: 0.22, rev: 0.3 },
      riser: { drum: 'riser', gain: 0.22, decay: 2, rev: 0.4 },
      bass: { synth: pulseBass, gain: 0.6 },
      pad: { synth: darkPad, gain: 0.2, rev: 0.6 },
      arp: { synth: sawArp, gain: 0.1, pan: -0.3, rev: 0.2, dly: 0.45 },
      lead: { synth: darkLead, gain: 0.25, rev: 0.4, dly: 0.3 },
      harm: { synth: darkLead, gain: 0.13, pan: 0.35, rev: 0.4 },
    },
    sections: {
      intro: {
        bars: 4,
        tracks: {
          kick: D(2) + 'x...x...x...x...'.repeat(2),
          hat: '.x.x.x.x.x.x.x.x',
          ohat: D(2) + '..x...x...x...x.'.repeat(2),
          pad: pad(progIntro),
          bass: rest(2) + ' ' + bass(['Db', 'C']),
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick: 'x...x...x...x...',
          clap: '....x.......x...',
          hat: '.x.x.x.x.x.x.x.x',
          ohat: '..x...x...x...x.',
          crash: once(8),
          bass: bass(progA),
          pad: pad(progA),
          arp: arps(progA),
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick: 'x...x...x...x...',
          clap: '....x.......x...',
          hat: '.x.x.x.x.x.x.x.x',
          ohat: '..x...x...x...x.',
          crash: once(8),
          bass: bass(progA),
          pad: pad(progA),
          arp: arps(progA),
          lead,
        },
      },
      brk: {
        bars: 4,
        tracks: {
          hat: '.x.x.x.x.x.x.x.x',
          clap: D(3) + '....x...x.x.xxxx',
          riser: D(2) + once(2, 'x'),
          pad: pad(progBreak),
          arp: arps(progBreak),
          bass: rest(2) + ' ' + bass(['Fm', 'C']),
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick: 'x...x...x...x...',
          clap: '....x.......x...',
          hat: 'xxx.xxx.xxx.xxx.',
          ohat: '..x...x...x...x.',
          crash: once(8),
          bass: bass(progA),
          pad: pad(progA),
          arp: arps(progA),
          lead,
          harm: harmonize(lead, -2, scale(5, MINOR)),
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'brk', 'A2'],
  };
}

/* ------------------------------------------------------------------------ */
/* RAP — 90's boom-bap instrumental for the rap battles, C minor, 90 bpm     */
/* ------------------------------------------------------------------------ */

function rap(): SongDef {
  // Rootless, low voicings: the mids stay free for the voices on top.
  const KEYS = { Cm: 'Eb3+G3+Bb3+D4', Ab: 'Eb3+G3+Ab3+C4', Fm: 'F3+Ab3+C4+Eb4', G: 'F3+Ab3+B3+D4' };
  const PAD = { Cm: 'C3+G3+Eb4', Ab: 'C3+Ab3+Eb4', Fm: 'C3+F3+Ab3', G: 'B2+F3+D4' };
  // The "sampled" piano line: same dotted rhythm every bar, dark minor seconds.
  const LOOP = {
    Cm: 'C5 . . G4 . . Eb5 - - . D5 - . . . .',
    Ab: 'C5 . . G4 . . Eb5 - - . C5 - . . . .',
    Fm: 'C5 . . Ab4 . . Eb5 - - . C5 - . . . .',
    G: 'B4 . . G4 . . D5 - - . Ab4 - . . G4 .',
  };
  // Long bass notes locked with the kick (steps 1, 8, 11), sliding into the next bar.
  const BASS = {
    Cm: 'C2 - - - - - - C2 - - G1 - - - Bb1 -',
    Ab: 'Ab1 - - - - - - Ab1 - - Eb2 - - - C2 -',
    Fm: 'F1 - - - - - - F1 - - C2 - - - Ab1 -',
    G: 'G1 - - - - - - G1 - - D2 - - - B1 -',
  };
  type C = keyof typeof KEYS;
  const progA: C[] = ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Ab', 'Fm', 'G'];
  const progB: C[] = ['Fm', 'Fm', 'Cm', 'Cm', 'Ab', 'Ab', 'G', 'G'];
  const progShort: C[] = ['Cm', 'Ab', 'Fm', 'G'];

  const keys = (p: C[]) => prog(p, (c) => rh(KEYS[c], 'x--...........x-'));
  const stabs = (p: C[]) => prog(p, (c) => rh(KEYS[c], 'x-....x-..x-....'));
  const pad = (p: C[]) => prog(p, (c) => hold(PAD[c]));
  const loop = (p: C[]) => prog(p, (c) => bars(LOOP[c]));
  const bass = (p: C[]) => prog(p, (c) => bars(BASS[c]));
  const bassHold = (p: C[]) => prog(p, (c) => hold(BASS[c].split(' ')[0]));

  // Turntable "wicka-wicka" on the last two beats of a bar.
  const scratchBar = bars('. . . . . . . . C5 G5 C5 . G4! C5 G5 .');
  const scratch4 = rest(3) + ' ' + scratchBar;

  const kick = 'x......x..x.....' + 'x......x..x...x.';
  const snare = '....x.......x...' + '....x......ox..o';
  const hats = 'x.xox.x.x.xox.x.';
  return {
    bpm: 90,
    swing: 0.22,
    loopFrom: 1,
    gain: 0.72,
    reverb: 1.6,
    delayBeats: 0.75,
    delayFeedback: 0.25,
    instruments: {
      kick: { drum: 'kick', tune: 0.8, decay: 1.3, gain: 0.46, drive: 0.4 },
      snare: { drum: 'snare', tune: 0.8, decay: 1.3, gain: 0.22, rev: 0.18, drive: 0.2 },
      clap: { drum: 'clap', tune: 0.9, gain: 0.3, rev: 0.2 },
      hat: { drum: 'hat', tune: 0.85, decay: 0.9, gain: 0.13, pan: 0.2 },
      ohat: { drum: 'openHat', tune: 0.85, decay: 0.6, gain: 0.08, pan: 0.2 },
      rim: { drum: 'rim', tune: 0.9, gain: 0.12, pan: -0.25, rev: 0.15 },
      bass: { synth: boomBass, gain: 0.18, drive: 0.15 },
      keys: { synth: dustyKeys, gain: 0.085, pan: -0.1, rev: 0.25, drive: 0.25 },
      loop: { synth: dustyKeys, gain: 0.15, pan: 0.15, rev: 0.25, dly: 0.12, drive: 0.25 },
      // The intro plays the sample "through a closed filter" before the beat drops.
      keysLo: { synth: { ...dustyKeys, cutoff: 420, fenv: 250 }, gain: 0.15, pan: -0.1, rev: 0.25 },
      loopLo: { synth: { ...dustyKeys, cutoff: 420, fenv: 250 }, gain: 0.24, pan: 0.15, rev: 0.25 },
      pad: { synth: darkPad, gain: 0.1, rev: 0.5 },
      scratch: { synth: scratchy, gain: 0.25, pan: 0.1, rev: 0.1 },
    },
    sections: {
      intro: {
        bars: 4,
        tracks: {
          keysLo: keys(progShort),
          loopLo: loop(progShort),
          hat: D(2) + hats.repeat(2),
          kick: D(3) + 'x.........x.....',
          bass: rest(2) + ' ' + bass(['Fm', 'G']),
          scratch: scratch4,
        },
      },
      A: {
        bars: 8,
        tracks: {
          kick,
          snare,
          clap: '....x.......x...',
          hat: hats,
          ohat: D(1) + '..............x.',
          bass: bass(progA),
          keys: keys(progA),
          loop: loop(progA),
        },
      },
      B: {
        bars: 8,
        tracks: {
          kick,
          snare,
          clap: '....x.......x...',
          hat: hats,
          rim: '..o......o....o.',
          bass: bass(progB),
          keys: stabs(progB),
          pad: pad(progB),
        },
      },
      A2: {
        bars: 8,
        tracks: {
          kick,
          snare,
          clap: '....x.......x...',
          hat: hats,
          ohat: D(1) + '..............x.',
          rim: '..o......o....o.',
          bass: bass(progA),
          keys: keys(progA),
          loop: loop(progA),
          pad: pad(progA),
          scratch: scratch4,
        },
      },
      brk: {
        bars: 4,
        tracks: {
          kick: 'x...............'.repeat(3) + 'x.........x.....',
          snare: D(3) + '....x.......x.xx',
          hat: hats,
          bass: bassHold(progShort),
          keys: keys(progShort),
          loop: loop(progShort),
          scratch: scratch4,
        },
      },
    },
    arrangement: ['intro', 'A', 'B', 'A2', 'brk'],
  };
}

/* ------------------------------------------------------------------------ */
/* VICTORY — short triumphant jingle (plays once), C major, 140 bpm          */
/* ------------------------------------------------------------------------ */

function victory(): SongDef {
  const lead = bars(
    'G4 . C5 . E5 . G5 - - - E5 . G5 - - -',
    'A5 - - - F5 - - - B5 - - - D6 - - -',
    'C6 - - - - - - - - - - - - - - -',
  );
  return {
    bpm: 140,
    loop: false,
    gain: 0.85,
    reverb: 2.6,
    instruments: {
      kick: { drum: 'kick', gain: 0.6 },
      snare: { drum: 'snare', gain: 0.4, rev: 0.3 },
      timp: { drum: 'tom', tune: 0.6, decay: 1.4, gain: 0.45, rev: 0.4 },
      crash: { drum: 'crash', gain: 0.32, rev: 0.4 },
      lead: { synth: brass, gain: 0.4, rev: 0.35, dly: 0.15 },
      harm: { synth: brass, gain: 0.22, pan: 0.3, rev: 0.35 },
      chords: { synth: brass, gain: 0.12, pan: -0.25, rev: 0.4 },
      bass: { synth: sawBass, gain: 0.36 },
    },
    sections: {
      jingle: {
        bars: 3,
        tracks: {
          lead,
          harm: harmonize(lead, -2, scale(0, MAJOR)),
          chords: bars(hold('E4+G4+C5'), rh('F4+A4+C5', 'x-------') + ' ' + rh('G4+B4+D5', 'x-------'), hold('E4+G4+C5+E5')),
          bass: bars('C2 - - - . . C2 - C2 - - - . . G1 -', 'F2 - - - - - - - G2 - - - - - - -', 'C2 - - - - - - - - - - - - - - -'),
          kick: 'x.......x.......' + 'x.......x.......' + 'X...............',
          timp: 'x...x...x...x...' + 'x.......x...xxxx' + 'X...............',
          snare: D(1) + '........xxxxXXXX' + D(1),
          crash: D(2) + 'X...............',
        },
      },
    },
    arrangement: ['jingle'],
  };
}

/* ------------------------------------------------------------------------ */

const BUILDERS: Record<MusicId, () => SongDef> = { title, select, hood, dojo, parking, victory, rap, beach: () => ({ ...select(), bpm: 132 }) };
const built = new Map<MusicId, SongDef>();

/** The song definition of a track (built on first use). */
export function getSong(id: MusicId): SongDef {
  let s = built.get(id);
  if (!s) {
    s = BUILDERS[id]();
    built.set(id, s);
  }
  return s;
}
