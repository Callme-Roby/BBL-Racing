/**
 * sequencer.ts — a small 16th-note step sequencer with a lookahead scheduler.
 *
 * Song data (see songs.ts) is written in a tiny text notation, compiled once
 * into a flat list of steps, then played by `SongPlayer`, which wakes up every
 * 25 ms (setInterval, NOT requestAnimationFrame) and schedules every note that
 * falls within the next ~0.12 s on the AudioContext clock. The audio clock is
 * sample-accurate, so the groove stays tight even if the game's frame rate dips.
 *
 * ## Notation
 * Each section has `bars` bars of 16 steps (16th notes). Every track of a section
 * is a pattern that is repeated cyclically to fill the section (so a 1-bar hi-hat
 * pattern can drive an 8-bar section).
 *
 * - Melodic tracks: whitespace-separated tokens, one per step.
 *     `C4` note (`C#4`, `Bb3`...), `C4+E4+G4` chord, `-` hold previous note, `.` rest.
 *     Suffix `!` = accent, `~` = soft (e.g. `A4!`, `E5~`). `|` tokens are ignored.
 * - Drum tracks: one character per step, spaces and `|` ignored.
 *     `X` accent, `x` hit, `o` soft hit, `.` rest.
 */

import type { DrumKind, TonePreset } from './synth';
import { gainNode, playDrum, playTone, shaper } from './synth';

/* ------------------------------------------------------------------------ */
/* Song data types                                                           */
/* ------------------------------------------------------------------------ */

interface InstrumentBase {
  /** channel level */
  gain?: number;
  /** stereo position -1..1 */
  pan?: number;
  /** reverb send level */
  rev?: number;
  /** echo/delay send level */
  dly?: number;
  /** channel saturation (WaveShaper) */
  drive?: number;
}

export interface DrumInstrument extends InstrumentBase {
  drum: DrumKind;
  tune?: number;
  decay?: number;
}

export interface SynthInstrument extends InstrumentBase {
  synth: TonePreset;
}

export type InstrumentDef = DrumInstrument | SynthInstrument;

export interface SectionDef {
  bars: number;
  /** instrument name -> pattern */
  tracks: Record<string, string>;
}

export interface SongDef {
  bpm: number;
  /** delay of every off-beat 16th, as a fraction of a 16th (0.2 ~ MPC 60% swing) */
  swing?: number;
  /** default loop behaviour (true when omitted) */
  loop?: boolean;
  /** index in `arrangement` where the loop restarts (skips the intro) */
  loopFrom?: number;
  /** echo time in beats (default 0.75 = dotted 8th) */
  delayBeats?: number;
  delayFeedback?: number;
  /** reverb length in seconds */
  reverb?: number;
  /** overall song level */
  gain?: number;
  instruments: Record<string, InstrumentDef>;
  sections: Record<string, SectionDef>;
  arrangement: string[];
}

/* ------------------------------------------------------------------------ */
/* Notes                                                                     */
/* ------------------------------------------------------------------------ */

const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;
const PITCH_CLASS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 'A4' -> 69. Returns NaN for anything that is not a note name. */
export function noteToMidi(name: string): number {
  const m = NOTE_RE.exec(name);
  if (!m) return NaN;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1].toLowerCase()] + acc;
}

/** 69 -> 'A4' (sharps). */
export function midiToNote(m: number): string {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Split a melodic pattern into step tokens. */
export function tokens(p: string): string[] {
  return p.split(/\s+/).filter((t) => t !== '' && t !== '|');
}

/** Strip a velocity suffix: `!` accent, `~` soft. */
export function splitVelocity(tok: string): [string, number] {
  if (tok.endsWith('!')) return [tok.slice(0, -1), 1];
  if (tok.endsWith('~')) return [tok.slice(0, -1), 0.55];
  return [tok, 0.8];
}

/* ------------------------------------------------------------------------ */
/* Compilation                                                               */
/* ------------------------------------------------------------------------ */

interface Hit {
  midi: number[];
  steps: number;
  vel: number;
}

interface StepEvent {
  inst: string;
  hit: Hit;
}

export interface CompiledSong {
  steps: StepEvent[][];
  loopStep: number;
  total: number;
}

const DRUM_VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.5 };

function warn(msg: string): void {
  console.warn(`[audio] ${msg}`);
}

function expandMelodic(p: string, len: number, where: string): (Hit | null)[] {
  const out: (Hit | null)[] = new Array<Hit | null>(len).fill(null);
  const toks = tokens(p);
  if (!toks.length) return out;
  if (len % toks.length !== 0) warn(`${where}: ${toks.length} steps do not fit a ${len}-step section`);
  const seq = Array.from({ length: len }, (_, i) => toks[i % toks.length]);
  for (let i = 0; i < len; i++) {
    const tok = seq[i];
    if (tok === '.' || tok === '-') continue;
    const [body, vel] = splitVelocity(tok);
    const midi = body.split('+').map(noteToMidi);
    if (midi.some((m) => Number.isNaN(m))) {
      warn(`${where}: bad token "${tok}" at step ${i}`);
      continue;
    }
    let steps = 1;
    while (i + steps < len && seq[i + steps] === '-') steps++;
    out[i] = { midi, steps, vel };
  }
  return out;
}

function expandDrums(p: string, len: number, where: string): (Hit | null)[] {
  const out: (Hit | null)[] = new Array<Hit | null>(len).fill(null);
  const chars = p.replace(/[\s|]/g, '');
  if (!chars.length) return out;
  if (len % chars.length !== 0) warn(`${where}: ${chars.length} steps do not fit a ${len}-step section`);
  for (let i = 0; i < len; i++) {
    const c = chars[i % chars.length];
    const vel = DRUM_VEL[c];
    if (vel !== undefined) out[i] = { midi: [], steps: 1, vel };
    else if (c !== '.') warn(`${where}: bad drum char "${c}"`);
  }
  return out;
}

/** Flatten a song's arrangement into a list of steps (done once per song). */
export function compileSong(def: SongDef, name = 'song'): CompiledSong {
  const steps: StepEvent[][] = [];
  let loopStep = 0;
  def.arrangement.forEach((secName, idx) => {
    const sec = def.sections[secName];
    if (!sec) {
      warn(`${name}: unknown section "${secName}"`);
      return;
    }
    if (idx === (def.loopFrom ?? 0)) loopStep = steps.length;
    const len = Math.max(1, Math.round(sec.bars)) * 16;
    const base = steps.length;
    for (let i = 0; i < len; i++) steps.push([]);
    for (const [inst, pat] of Object.entries(sec.tracks)) {
      const idef = def.instruments[inst];
      const where = `${name}/${secName}/${inst}`;
      if (!idef) {
        warn(`${where}: unknown instrument`);
        continue;
      }
      const hits = 'drum' in idef ? expandDrums(pat, len, where) : expandMelodic(pat, len, where);
      hits.forEach((h, i) => {
        if (h) steps[base + i].push({ inst, hit: h });
      });
    }
  });
  return { steps, loopStep, total: steps.length };
}

/* ------------------------------------------------------------------------ */
/* Playback                                                                  */
/* ------------------------------------------------------------------------ */

/** Seconds of audio scheduled ahead of the clock. */
const LOOKAHEAD = 0.12;
/** Background tabs throttle timers to ~1 Hz: schedule further ahead there. */
const LOOKAHEAD_HIDDEN = 1.5;
const TICK_MS = 25;

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

/**
 * Plays one compiled song into `dest`. Owns a small mixer: one channel per
 * instrument (level, pan, optional drive) with sends into a per-song reverb
 * and tempo-synced echo. Call `dispose()` to tear everything down.
 */
export class SongPlayer {
  /** Called once when a non-looping song reaches its last step (the reverb tail still rings). */
  onEnd: (() => void) | null = null;

  private readonly ctx: BaseAudioContext;
  private readonly def: SongDef;
  private readonly song: CompiledSong;
  private readonly loop: boolean;
  private readonly stepDur: number;
  private readonly mix: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly channels = new Map<string, AudioNode>();
  /** last note per instrument, for portamento: frequency + absolute step where it ends */
  private readonly lastNote = new Map<string, { freq: number; end: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pos = 0;
  private abs = 0;
  private nextTime = 0;
  private finished = false;

  constructor(ctx: BaseAudioContext, def: SongDef, song: CompiledSong, dest: AudioNode, opts: { loop: boolean; impulse: AudioBuffer }) {
    this.ctx = ctx;
    this.def = def;
    this.song = song;
    this.loop = opts.loop;
    this.stepDur = 60 / def.bpm / 4;

    this.mix = gainNode(ctx, def.gain ?? 1, dest);

    // Shared FX returns for this song.
    const reverb = ctx.createConvolver();
    reverb.buffer = opts.impulse;
    reverb.connect(this.mix);

    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, ((def.delayBeats ?? 0.75) * 60) / def.bpm);
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const feedback = gainNode(ctx, def.delayFeedback ?? 0.35);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(this.mix);
    this.nodes.push(reverb, delay, damp, feedback);

    for (const [name, inst] of Object.entries(def.instruments)) {
      const input = gainNode(ctx, inst.gain ?? 1);
      let tail: AudioNode = input;
      if (inst.drive) {
        const ws = shaper(ctx, inst.drive);
        tail.connect(ws);
        tail = ws;
        this.nodes.push(ws);
      }
      if (inst.pan && typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, inst.pan));
        tail.connect(pan);
        tail = pan;
        this.nodes.push(pan);
      }
      tail.connect(this.mix);
      if (inst.rev) this.nodes.push(this.send(tail, reverb, inst.rev));
      if (inst.dly) this.nodes.push(this.send(tail, delay, inst.dly));
      this.channels.set(name, input);
      this.nodes.push(input);
    }
  }

  private send(from: AudioNode, to: AudioNode, level: number): GainNode {
    const g = gainNode(this.ctx, level, to);
    from.connect(g);
    return g;
  }

  /**
   * Start playing at context time `at`. With `realtime` (default) a timer keeps
   * scheduling; pass false to drive it manually with `pump()` (offline rendering).
   */
  start(at: number, realtime = true): void {
    this.nextTime = at;
    if (this.song.total === 0) {
      this.end();
      return;
    }
    if (realtime) {
      this.timer = setInterval(() => this.pump(), TICK_MS);
      this.pump();
    }
  }

  /** Schedule every step that starts before `horizon` (default: now + lookahead). */
  pump(horizon?: number): void {
    if (this.finished) return;
    const now = this.ctx.currentTime;
    if (horizon === undefined) {
      // We fell behind (main thread stall, throttled tab): skip the missed steps
      // instead of firing them all at once.
      if (this.nextTime < now - 0.05) {
        const missed = Math.ceil((now - this.nextTime) / this.stepDur);
        for (let i = 0; i < missed && !this.finished; i++) this.advance();
      }
      horizon = now + (pageHidden() ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    }
    while (!this.finished && this.nextTime < horizon) {
      this.scheduleStep(this.pos, this.nextTime);
      this.advance();
    }
  }

  /** Stop scheduling new notes (already scheduled ones still play). */
  stop(): void {
    this.finished = true;
    this.clearTimer();
  }

  /** Stop and disconnect the whole song graph. */
  dispose(): void {
    this.stop();
    this.onEnd = null;
    try {
      this.mix.disconnect();
      for (const n of this.nodes) n.disconnect();
    } catch {
      /* already disconnected */
    }
    this.channels.clear();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private advance(): void {
    this.nextTime += this.stepDur;
    this.abs++;
    this.pos++;
    if (this.pos >= this.song.total) {
      if (this.loop) this.pos = this.song.loopStep;
      else this.end();
    }
  }

  private end(): void {
    if (this.finished) return;
    this.stop();
    const cb = this.onEnd;
    if (!cb) return;
    const delayMs = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
    setTimeout(() => {
      if (this.onEnd === cb) cb();
    }, delayMs);
  }

  private scheduleStep(pos: number, time: number): void {
    const events = this.song.steps[pos];
    if (!events || !events.length) return;
    const t = pos % 2 === 1 ? time + (this.def.swing ?? 0) * this.stepDur : time;
    for (const ev of events) {
      const inst = this.def.instruments[ev.inst];
      const ch = this.channels.get(ev.inst);
      if (!inst || !ch) continue;
      if ('drum' in inst) {
        playDrum(this.ctx, ch, inst.drum, t, ev.hit.vel, inst.tune, inst.decay);
        continue;
      }
      const p = inst.synth;
      const dur = ev.hit.steps * this.stepDur - 0.004;
      if (ev.hit.midi.length === 1) {
        const freq = mtof(ev.hit.midi[0]);
        const last = this.lastNote.get(ev.inst);
        // Portamento: from the previous note when legato (or always, for whiny leads).
        const from = p.glide && last && (p.glideAlways || last.end >= this.abs) ? last.freq : undefined;
        this.lastNote.set(ev.inst, { freq, end: this.abs + ev.hit.steps });
        playTone(this.ctx, ch, t, freq, dur, ev.hit.vel, p, from);
      } else {
        for (const m of ev.hit.midi) playTone(this.ctx, ch, t, mtof(m), dur, ev.hit.vel, p);
      }
    }
  }
}
