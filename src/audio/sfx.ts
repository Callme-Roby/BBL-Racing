/**
 * sfx.ts — procedural, punchy, slightly crunchy retro sound effects.
 *
 * Each effect is a handful of short-lived oscillators / noise bursts scheduled
 * at time `t`. `p` is a pitch multiplier applied to every frequency.
 */

import type { SfxId } from './types';
import { gainNode, noise, noiseBurst, osc, perc, shaper, sweepTone } from './synth';
import type { Wave } from './synth';

export interface SfxEnv {
  ctx: BaseAudioContext;
  /** per-play output (already carries volume + pan) */
  out: AudioNode;
  /** shared SFX reverb input, if any */
  reverb: AudioNode | null;
}

/** Effects that get a tiny random pitch variation (±4 %) so repeats don't sound robotic. */
export const RANDOMIZED_SFX: ReadonlySet<SfxId> = new Set<SfxId>([
  'hitLight',
  'hitMedium',
  'hitHeavy',
  'block',
  'whiff',
  'whiffHeavy',
  'land',
  'step',
  'fall',
  'throw',
  'gunshot',
  'pin',
  'poof',
  'thwip',
  'scratch',
  'bonk',
  'boing',
  'crash',
  'crack',
  'dash',
  'bounce',
  'wallBreak',
  'superJump',
  'airDash',
  'toss',
  'zap',
  'splat',
  'guardBreak',
  'clutch',
  'tech',
  'hop',
  'turbo',
]);

/**
 * Per-effect trim so every effect sits at a sensible loudness (measured offline):
 * the heaviest impacts peak around 1.0 before the sfx/master volumes.
 */
const LEVEL: Record<SfxId, number> = {
  hitLight: 0.7,
  hitMedium: 0.7,
  hitHeavy: 0.45,
  block: 0.6,
  whiff: 1.6,
  whiffHeavy: 1.4,
  land: 1,
  step: 1,
  fall: 0.85,
  throw: 0.6,
  super: 0.45,
  ko: 0.5,
  cursor: 1,
  confirm: 1,
  cancel: 1,
  roundBell: 0.7,
  gunshot: 0.5,
  explosion: 0.48,
  rocket: 0.6,
  pin: 1.2,
  poof: 0.9,
  powerUp: 0.55,
  thwip: 2,
  crowdOoh: 1.1,
  crowdLaugh: 2.6,
  scratch: 0.62,
  recordStop: 0.65,
  bonk: 0.45,
  boing: 0.75,
  crash: 0.55,
  crack: 0.5,
  dash: 1.1,
  flex: 0.5,
  shine: 0.75,
  impact: 0.5,
  bounce: 0.7,
  wallBreak: 0.5,
  superJump: 0.8,
  airDash: 0.9,
  toss: 1.4,
  zap: 0.6,
  splat: 0.8,
  guardBreak: 0.42,
  clutch: 0.9,
  tech: 0.6,
  beep: 0.8,
  beepGo: 0.8,
  turbo: 0.9,
  spark: 0.7,
  itemBox: 0.8,
  roulette: 0.6,
  itemGet: 0.8,
  lap: 0.8,
  hop: 0.9,
  trick: 0.8,
  ding: 0.7,
};

/** Play a procedural effect. */
export function playSfx(env: SfxEnv, id: SfxId, t: number, p: number): void {
  const level = LEVEL[id] ?? 1;
  const out = level === 1 ? env.out : gainNode(env.ctx, level, env.out);
  SFX[id]({ ...env, out }, t, p);
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** A saturating insert feeding env.out: anything connected to it gets crunchy. */
function crunch(env: SfxEnv, amount: number, level = 0.8): AudioNode {
  const ws = shaper(env.ctx, amount);
  ws.connect(gainNode(env.ctx, level, env.out));
  return ws;
}

/** Uniform random number in [a, b). */
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Parallel band-pass "formants" (a vowel colour) feeding `dest`. Returns their shared
 * input. `bands` = [centre Hz, Q, gain] triples.
 */
function formants(env: SfxEnv, dest: AudioNode, bands: readonly (readonly [number, number, number])[]): AudioNode {
  const { ctx } = env;
  const input = ctx.createGain();
  const nyq = ctx.sampleRate * 0.45;
  for (const [f, q, g] of bands) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(nyq, f);
    bp.Q.value = q;
    input.connect(bp);
    bp.connect(gainNode(ctx, g, dest));
  }
  return input;
}

/** Send env.out into the shared reverb. */
function reverbSend(env: SfxEnv, amount: number): void {
  if (!env.reverb) return;
  env.out.connect(gainNode(env.ctx, amount, env.reverb));
}

/** A short pitched blip; `steps` = [time offset, frequency] pairs (instant pitch jumps). */
function blip(env: SfxEnv, t: number, type: Wave, steps: [number, number][], peak: number, decay: number, cutoff = 0): void {
  const { ctx } = env;
  const o = osc(ctx, type);
  for (const [dt, f] of steps) o.frequency.setValueAtTime(f, t + dt);
  const g = ctx.createGain();
  const end = perc(g.gain, t, peak, 0.002, decay);
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    f.connect(g);
  } else {
    o.connect(g);
  }
  g.connect(env.out);
  o.start(t);
  o.stop(end);
}

/** The body of a heavy impact (shared by hitHeavy / super / throw). */
function heavyImpact(env: SfxEnv, t: number, p: number, size = 1): void {
  const { ctx, out } = env;
  const cr = crunch(env, 1.0, 0.7);
  sweepTone(ctx, crunch(env, 0.5, 0.9), t, { f0: 150 * p, f1: 38 * p, sweep: 0.18 * size, peak: 1.0, decay: 0.45 * size });
  noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 900 * p, peak: 0.6, decay: 0.28 * size });
  noiseBurst(ctx, cr, t, { filter: 'bandpass', freq: 1100 * p, q: 0.7, peak: 0.9, decay: 0.16 * size });
  noiseBurst(ctx, out, t, { filter: 'highpass', freq: 4000 * p, peak: 0.4, decay: 0.035 });
}

/* ------------------------------------------------------------------------ */
/* The effects                                                               */
/* ------------------------------------------------------------------------ */

const SFX: Record<SfxId, (env: SfxEnv, t: number, p: number) => void> = {
  /** Slap / snap. */
  hitLight(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 2600 * p, q: 0.9, peak: 0.85, decay: 0.07 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 5000 * p, peak: 0.45, attack: 0.0005, decay: 0.018 });
    sweepTone(ctx, out, t, { f0: 340 * p, f1: 120 * p, sweep: 0.05, peak: 0.55, decay: 0.09 });
  },

  /** Solid punch: crunchy mid burst + thump. */
  hitMedium(env, t, p) {
    const { ctx, out } = env;
    const cr = crunch(env, 0.6);
    noiseBurst(ctx, cr, t, { filter: 'bandpass', freq: 1500 * p, q: 0.8, peak: 0.9, decay: 0.12 });
    sweepTone(ctx, cr, t, { f0: 240 * p, f1: 70 * p, sweep: 0.08, peak: 0.8, decay: 0.18 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3800 * p, peak: 0.35, decay: 0.03 });
  },

  /** Big thump + crunch + low boom. */
  hitHeavy(env, t, p) {
    heavyImpact(env, t, p);
  },

  /** Short metallic tick / clack. */
  block(env, t, p) {
    const { ctx, out } = env;
    // Inharmonic partials = metal.
    for (const [f, g, d] of [
      [1720, 0.22, 0.09],
      [2630, 0.16, 0.07],
      [4150, 0.1, 0.05],
    ] as const) {
      sweepTone(ctx, out, t, { type: 'square', f0: f * p, f1: f * p * 0.97, sweep: 0.05, peak: g, decay: d });
    }
    sweepTone(ctx, out, t, { type: 'triangle', f0: 650 * p, f1: 420 * p, sweep: 0.04, peak: 0.5, decay: 0.05 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3000 * p, peak: 0.5, decay: 0.025 });
  },

  /** Quick filtered-noise swish. */
  whiff(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 600 * p, freqEnd: 2800 * p, sweep: 0.12, q: 1.8,
      peak: 0.55, attack: 0.05, decay: 0.12,
    });
  },

  /** Longer, lower swish. */
  whiffHeavy(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 260 * p, freqEnd: 1300 * p, sweep: 0.22, q: 1.4,
      peak: 0.7, attack: 0.09, decay: 0.24, rate: 0.8,
    });
    noiseBurst(ctx, out, t + 0.04, { filter: 'lowpass', freq: 500 * p, peak: 0.25, attack: 0.06, decay: 0.18 });
  },

  /** Soft thud. */
  land(env, t, p) {
    const { ctx, out } = env;
    sweepTone(ctx, out, t, { f0: 115 * p, f1: 50 * p, sweep: 0.08, peak: 0.5, decay: 0.14 });
    noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 500 * p, peak: 0.3, decay: 0.08 });
  },

  /** Very soft tick. */
  step(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 2500 * p, peak: 0.12, decay: 0.02 });
    sweepTone(ctx, out, t, { f0: 140 * p, f1: 90 * p, sweep: 0.03, peak: 0.12, decay: 0.04 });
  },

  /** Body hitting the ground: low thud, a small bounce and a cloud of dust. */
  fall(env, t, p) {
    const { ctx, out } = env;
    sweepTone(ctx, crunch(env, 0.4, 0.9), t, { f0: 85 * p, f1: 32 * p, sweep: 0.2, peak: 1.0, decay: 0.4 });
    noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 700 * p, peak: 0.5, attack: 0.005, decay: 0.3 });
    sweepTone(ctx, out, t + 0.14, { f0: 75 * p, f1: 35 * p, sweep: 0.12, peak: 0.45, decay: 0.2 });
    noiseBurst(ctx, out, t + 0.02, { filter: 'bandpass', freq: 420 * p, q: 0.6, peak: 0.25, attack: 0.04, decay: 0.5, rate: 0.6 });
  },

  /** Grab (cloth) then slam. */
  throw(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1200 * p, q: 1.5, peak: 0.45, decay: 0.06 });
    noiseBurst(ctx, out, t + 0.03, {
      filter: 'bandpass', freq: 400 * p, freqEnd: 1600 * p, sweep: 0.12, q: 1.4, peak: 0.35, attack: 0.05, decay: 0.1,
    });
    const tt = t + 0.2;
    sweepTone(ctx, crunch(env, 0.5, 0.9), tt, { f0: 100 * p, f1: 34 * p, sweep: 0.16, peak: 1.0, decay: 0.35 });
    noiseBurst(ctx, out, tt, { filter: 'lowpass', freq: 900 * p, peak: 0.6, decay: 0.25 });
    noiseBurst(ctx, crunch(env, 1, 0.6), tt, { filter: 'bandpass', freq: 900 * p, q: 0.8, peak: 0.7, decay: 0.1 });
  },

  /** Rising charge zap, then a big impact. */
  super(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.35);
    const charge = 0.5;
    // Zappy saw + square sweeping up, frequency-wobbled by a fast LFO.
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 28;
    const lfoAmt = gainNode(ctx, 250);
    lfo.connect(lfoAmt);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(400 * p, t);
    bp.frequency.exponentialRampToValueAtTime(3500 * p, t + charge);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + charge * 0.9);
    g.gain.linearRampToValueAtTime(0, t + charge + 0.02);
    for (const [type, mul] of [['sawtooth', 1], ['square', 0.5]] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(180 * p * mul, t);
      o.frequency.exponentialRampToValueAtTime(1500 * p * mul, t + charge);
      lfoAmt.connect(o.detune);
      o.connect(bp);
      o.start(t);
      o.stop(t + charge + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + charge + 0.05);
    bp.connect(g);
    g.connect(out);
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 400 * p, freqEnd: 5000 * p, sweep: charge, q: 2, peak: 0.22, attack: charge * 0.9, decay: 0.05,
    });
    // Impact + sparkle.
    const ti = t + charge;
    heavyImpact(env, ti, p, 1.2);
    noiseBurst(ctx, out, ti, { filter: 'highpass', freq: 6000 * p, peak: 0.3, attack: 0.002, decay: 0.4 });
    blip(env, ti, 'square', [[0, 1320 * p], [0.05, 1760 * p]], 0.08, 0.25, 4000);
  },

  /** Huge impact with a long reverb tail, slightly slowed down. */
  ko(env, t, p) {
    const { ctx, out } = env;
    const q = p * 0.85;
    reverbSend(env, 0.6);
    sweepTone(ctx, crunch(env, 0.6, 1), t, { f0: 120 * q, f1: 26 * q, sweep: 0.5, peak: 1.1, decay: 1.2 });
    noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 1200 * q, peak: 0.8, decay: 0.7, rate: 0.85 });
    noiseBurst(ctx, crunch(env, 1.2, 0.7), t, { filter: 'bandpass', freq: 900 * q, q: 0.7, peak: 1.0, decay: 0.3, rate: 0.85 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3500 * q, peak: 0.5, decay: 0.05 });
    noiseBurst(ctx, out, t + 0.03, { filter: 'lowpass', freq: 220, peak: 0.45, attack: 0.05, decay: 1.8, rate: 0.5 });
  },

  /** Menu cursor blip. */
  cursor(env, t, p) {
    blip(env, t, 'pulse25', [[0, 880 * p], [0.03, 1320 * p]], 0.16, 0.07);
  },

  /** Menu confirm chime: quick rising arpeggio. */
  confirm(env, t, p) {
    const notes = [1046.5, 1568, 2093];
    notes.forEach((f, i) => {
      const ti = t + i * 0.065;
      blip(env, ti, 'square', [[0, f * p]], 0.1, 0.22, 5000);
      blip(env, ti, 'triangle', [[0, f * p * 0.5]], 0.18, 0.3);
    });
    reverbSend(env, 0.15);
  },

  /** Low "back" blip. */
  cancel(env, t, p) {
    blip(env, t, 'square', [[0, 392 * p], [0.06, 262 * p]], 0.15, 0.12, 1800);
  },

  /** Boxing bell ding: inharmonic bell partials with a long ring. */
  roundBell(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.3);
    const f = 1180 * p;
    for (const [ratio, g, d] of [
      [1, 0.4, 2.2],
      [1.004, 0.3, 2.0],
      [2.0, 0.18, 1.4],
      [2.76, 0.25, 1.1],
      [5.4, 0.12, 0.6],
      [8.93, 0.06, 0.35],
    ] as const) {
      sweepTone(ctx, out, t, { f0: f * ratio, f1: f * ratio, sweep: 0, peak: g, attack: 0.001, decay: d });
    }
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3000, peak: 0.35, decay: 0.02 });
  },

  /* ---------------- BBL MAX cinematics ---------------- */

  /** One sub-machine-gun shot: sharp crack + low thump (< 0.1 s, fired in fast bursts, so kept cheap). */
  gunshot(env, t, p) {
    const { ctx, out } = env;
    const cr = crunch(env, 1.1, 0.7);
    noiseBurst(ctx, cr, t, { filter: 'bandpass', freq: 2300 * p, q: 0.6, peak: 1.0, attack: 0.0004, decay: 0.035 });
    sweepTone(ctx, cr, t, { f0: 200 * p, f1: 55 * p, sweep: 0.035, peak: 0.9, decay: 0.065 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 5500 * p, peak: 0.45, attack: 0.0003, decay: 0.012 });
    reverbSend(env, 0.12);
  },

  /** Grenade / bazooka blast: big crunchy boom, long rumbling tail and flying debris. */
  explosion(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.45);
    const cr = crunch(env, 1.3, 0.7);
    sweepTone(ctx, crunch(env, 0.7, 1), t, { f0: 125 * p, f1: 26 * p, sweep: 0.55, peak: 1.1, attack: 0.002, decay: 1.0 });
    noiseBurst(ctx, cr, t, { filter: 'bandpass', freq: 1000 * p, q: 0.6, peak: 1.0, decay: 0.3, rate: 0.8 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3000 * p, peak: 0.6, decay: 0.06 });
    // Rumble: dark grainy noise whose lowpass slowly closes.
    noiseBurst(ctx, cr, t, {
      filter: 'lowpass', freq: 2400 * p, freqEnd: 170 * p, sweep: 1.1, q: 1.2, peak: 0.9, attack: 0.01, decay: 1.2, rate: 0.5,
    });
    noiseBurst(ctx, out, t + 0.05, { filter: 'lowpass', freq: 240 * p, peak: 0.6, attack: 0.08, decay: 1.3, rate: 0.35 });
    // Debris crackling down.
    for (let i = 0; i < 7; i++) {
      const dt = 0.12 + Math.random() * 0.8;
      noiseBurst(ctx, out, t + dt, {
        filter: 'bandpass', freq: rnd(1500, 4000) * p, q: 1.5, peak: rnd(0.1, 0.22) * (1 - dt / 1.2), decay: rnd(0.01, 0.03),
      });
    }
  },

  /** Bazooka launch: thump, exhaust hiss and a motor whistle rising then falling away. */
  rocket(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.2);
    sweepTone(ctx, crunch(env, 0.6, 0.9), t, { f0: 160 * p, f1: 50 * p, sweep: 0.08, peak: 0.8, decay: 0.16 });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1400 * p, q: 0.8, peak: 0.6, decay: 0.05 });
    noiseBurst(ctx, out, t + 0.01, {
      filter: 'bandpass', freq: 1200 * p, freqEnd: 4500 * p, sweep: 0.2, q: 1.1, peak: 0.45, attack: 0.04, decay: 0.42,
    });
    const T = 0.55;
    const peakAt = t + 0.16;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(900 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * p, peakAt);
    bp.frequency.exponentialRampToValueAtTime(800 * p, t + T);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.05);
    g.gain.setValueAtTime(0.3, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + T);
    bp.connect(g);
    g.connect(out);
    for (const [type, mul] of [['sawtooth', 1], ['square', 1.007]] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(260 * p * mul, t);
      o.frequency.exponentialRampToValueAtTime(820 * p * mul, peakAt);
      o.frequency.exponentialRampToValueAtTime(320 * p * mul, t + T);
      o.connect(bp);
      o.start(t);
      o.stop(t + T + 0.02);
    }
  },

  /** Grenade pin pulled: a short metal slide, a click and the ring clinking. */
  pin(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 4500 * p, q: 2.5, peak: 0.25, attack: 0.012, decay: 0.035 });
    const tc = t + 0.05;
    noiseBurst(ctx, out, tc, { filter: 'highpass', freq: 2500 * p, peak: 0.5, attack: 0.0003, decay: 0.008 });
    for (const [f, g, d] of [
      [3150, 0.16, 0.12],
      [4720, 0.1, 0.09],
      [7010, 0.06, 0.05],
    ] as const) {
      sweepTone(ctx, out, tc, { type: 'triangle', f0: f * p, f1: f * p, sweep: 0, peak: g, decay: d });
    }
    const t2 = t + 0.13;
    for (const [f, g, d] of [
      [3420, 0.08, 0.09],
      [5130, 0.05, 0.06],
    ] as const) {
      sweepTone(ctx, out, t2, { type: 'triangle', f0: f * p, f1: f * p, sweep: 0, peak: g, decay: d });
    }
  },

  /** Cartoon smoke puff: soft "pff" of filtered noise and a little upward blip. */
  poof(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.15);
    noiseBurst(ctx, out, t, {
      filter: 'lowpass', freq: 3500 * p, freqEnd: 500 * p, sweep: 0.3, q: 1, peak: 0.55, attack: 0.012, decay: 0.32, rate: 0.7,
    });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 900 * p, q: 0.9, peak: 0.35, attack: 0.004, decay: 0.12 });
    sweepTone(ctx, out, t + 0.015, { f0: 420 * p, f1: 1300 * p, sweep: 0.09, peak: 0.16, attack: 0.005, decay: 0.12 });
  },

  /** Dragon-Ball-style power-up: buzzing aura rising for ~1.1 s, then a bright hit. */
  powerUp(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.3);
    const T = 1.15;
    // Detuned saws + a square fifth + a sub saw, shaken by a speeding-up vibrato.
    const lfo = osc(ctx, 'sine');
    lfo.frequency.setValueAtTime(7, t);
    lfo.frequency.linearRampToValueAtTime(32, t + T);
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.setValueAtTime(20, t);
    lfoAmt.gain.linearRampToValueAtTime(70, t + T);
    lfo.connect(lfoAmt);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(350 * p, t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(ctx.sampleRate * 0.45, 5000 * p), t + T);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + T);
    g.gain.linearRampToValueAtTime(0, t + T + 0.03);
    lp.connect(crunch({ ...env, out: g }, 0.8, 1));
    g.connect(out);
    for (const [type, mul, det] of [
      ['sawtooth', 1, -14],
      ['sawtooth', 1, 14],
      ['square', 1.5, 0],
      ['sawtooth', 0.5, 0],
    ] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(70 * p * mul, t);
      o.frequency.exponentialRampToValueAtTime(620 * p * mul, t + T);
      o.detune.value = det;
      lfoAmt.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + T + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + T + 0.05);
    // Rising air + ground rumble.
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 300 * p, freqEnd: 6000 * p, sweep: T, q: 2.5, peak: 0.3, attack: T * 0.95, decay: 0.06,
    });
    noiseBurst(ctx, crunch(env, 0.8, 0.8), t, { filter: 'lowpass', freq: 160 * p, peak: 0.45, attack: T * 0.9, decay: 0.15, rate: 0.5 });
    // Release: thump + bright shimmering chord.
    const ti = t + T;
    sweepTone(ctx, crunch(env, 0.6, 0.9), ti, { f0: 220 * p, f1: 50 * p, sweep: 0.2, peak: 0.85, decay: 0.45 });
    noiseBurst(ctx, out, ti, { filter: 'bandpass', freq: 1800 * p, q: 0.7, peak: 0.55, decay: 0.18 });
    noiseBurst(ctx, out, ti, { filter: 'highpass', freq: 6500 * p, peak: 0.35, attack: 0.002, decay: 0.6 });
    for (const [f, d] of [
      [1046.5, 0.7],
      [1568, 0.6],
      [2093, 0.5],
      [3136, 0.35],
    ] as const) {
      sweepTone(ctx, out, ti, { type: 'triangle', f0: f * p, f1: f * p, sweep: 0, peak: 0.07, decay: d });
    }
  },

  /** Web-shooter "thwip": quick rising swoosh, a chirp and the line twanging. */
  thwip(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 1800 * p, freqEnd: 7500 * p, sweep: 0.06, q: 2.2, peak: 0.55, attack: 0.006, decay: 0.07,
    });
    sweepTone(ctx, out, t + 0.01, { f0: 1100 * p, f1: 3200 * p, sweep: 0.04, peak: 0.22, attack: 0.003, decay: 0.05 });
    sweepTone(ctx, out, t + 0.03, { type: 'triangle', f0: 1500 * p, f1: 1150 * p, sweep: 0.08, peak: 0.16, decay: 0.12 });
    noiseBurst(ctx, out, t + 0.03, { filter: 'highpass', freq: 6000 * p, peak: 0.2, decay: 0.012 });
  },

  /** A crowd going "Ooooh!": a dozen detuned voices through "oo" formants, gliding up then down. */
  crowdOoh(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.35);
    const T = 1.05;
    const men = formants(env, out, [
      [300 * p, 4, 2.6],
      [760 * p, 6, 1.5],
      [2300 * p, 8, 0.35],
    ]);
    const women = formants(env, out, [
      [390 * p, 4, 2.2],
      [900 * p, 6, 1.3],
      [2700 * p, 8, 0.3],
    ]);
    // Shared breath (crowd wash) through both vowels.
    const br = noise(ctx, t, T + 0.1, 0.8);
    const brG = ctx.createGain();
    brG.gain.setValueAtTime(0, t);
    brG.gain.linearRampToValueAtTime(0.3, t + 0.15);
    brG.gain.linearRampToValueAtTime(0, t + T);
    br.connect(brG);
    brG.connect(men);
    brG.connect(women);
    for (let i = 0; i < 12; i++) {
      const female = i >= 7;
      const f = (female ? rnd(190, 280) : rnd(95, 155)) * p;
      const t0 = t + rnd(0, 0.1);
      const end = t0 + T * rnd(0.82, 1);
      const o = osc(ctx, 'sawtooth');
      o.frequency.setValueAtTime(f * 0.93, t0);
      o.frequency.linearRampToValueAtTime(f * rnd(1.04, 1.1), t0 + rnd(0.15, 0.26));
      o.frequency.exponentialRampToValueAtTime(f * rnd(0.72, 0.86), end);
      const pk = rnd(0.08, 0.13);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(pk, t0 + rnd(0.1, 0.18));
      g.gain.linearRampToValueAtTime(pk * 0.75, t0 + 0.6);
      g.gain.linearRampToValueAtTime(0, end);
      o.connect(g);
      g.connect(female ? women : men);
      o.start(t0);
      o.stop(end + 0.02);
    }
  },

  /** A crowd laughing / cheering: voices bursting "ha-ha-ha" at their own pace, over a cheering wash. */
  crowdLaugh(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.35);
    const T = 1.1;
    const vowel = formants(env, out, [
      [760 * p, 4, 2.2],
      [1250 * p, 5, 1.3],
      [2600 * p, 7, 0.4],
    ]);
    // Breath shared by every voice: the "h" of each "ha".
    const br = noise(ctx, t, T + 0.4);
    const brG = gainNode(ctx, 0.5);
    br.connect(brG);
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1400 * p, q: 0.6, peak: 0.12, attack: 0.15, decay: 0.9 });
    for (let i = 0; i < 8; i++) {
      // Two loud "lead" laughers on top of a bed of quieter ones.
      const lead = i < 2;
      const female = i % 3 === 1;
      const f0 = (female ? rnd(210, 310) : rnd(115, 175)) * p;
      const per = 1 / (lead ? rnd(5, 6) : rnd(5, 7.5));
      const amp = lead ? rnd(0.18, 0.22) : rnd(0.06, 0.11);
      let tp = t + (lead ? rnd(0, 0.04) : rnd(0.02, 0.15));
      const n = Math.max(2, Math.floor((T - (tp - t)) / per));
      const o = osc(ctx, 'sawtooth');
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let k = 0; k < n; k++) {
        const a = amp * (1 - (0.6 * k) / n);
        const fk = f0 * (1.12 - 0.04 * k) * rnd(0.97, 1.03);
        o.frequency.setValueAtTime(fk, tp);
        o.frequency.exponentialRampToValueAtTime(fk * 0.86, tp + per * 0.7);
        g.gain.setValueAtTime(0.0001, tp);
        g.gain.linearRampToValueAtTime(a, tp + 0.014);
        g.gain.exponentialRampToValueAtTime(0.001, tp + per * 0.62);
        tp += per * rnd(0.92, 1.08);
      }
      g.gain.setValueAtTime(0, tp);
      o.connect(g);
      brG.connect(g);
      g.connect(vowel);
      o.start(t);
      o.stop(tp + 0.02);
    }
  },

  /** DJ scratch: an "ahh" sample dragged forward and back (pitch and brightness follow the hand). */
  scratch(env, t, p) {
    const { ctx } = env;
    const T = 0.36;
    const N = 160;
    const nyq = ctx.sampleRate * 0.45;
    // Hand strokes: [share of T, peak speed]; the speed falls to 0 at each change of direction.
    const strokes: readonly (readonly [number, number])[] = [
      [0.2, 1],
      [0.27, 0.7],
      [0.19, 1.1],
      [0.34, 0.55],
    ];
    const speed = new Float32Array(N);
    let s0 = 0;
    let k = 0;
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      while (k < strokes.length - 1 && x > s0 + strokes[k][0]) s0 += strokes[k++][0];
      const local = Math.min(1, Math.max(0, (x - s0) / strokes[k][0]));
      speed[i] = strokes[k][1] * Math.sin(Math.PI * local);
    }
    const o = osc(ctx, 'sawtooth');
    o.frequency.setValueCurveAtTime(speed.map((s) => (70 + 620 * s) * p), t, T);
    const vinyl = noise(ctx, t, T + 0.02);
    vinyl.playbackRate.setValueCurveAtTime(speed.map((s) => 0.05 + 0.95 * s), t, T);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.8;
    bp.frequency.setValueCurveAtTime(speed.map((s) => Math.min(nyq, (300 + 2800 * s) * p)), t, T);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(speed.map((s) => 0.6 * Math.pow(Math.max(0, s), 0.7)), t, T);
    o.connect(bp);
    vinyl.connect(gainNode(ctx, 0.4, bp));
    bp.connect(g);
    g.connect(crunch(env, 0.5, 0.9));
    o.start(t);
    o.stop(t + T + 0.02);
  },

  /** Record stop: the "music" slows down to a halt ("vvvwwwooo"). */
  recordStop(env, t, p) {
    const { ctx, out } = env;
    const T = 0.62;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(Math.min(ctx.sampleRate * 0.45, 3500 * p), t);
    lp.frequency.exponentialRampToValueAtTime(90 * p, t + T);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.012);
    g.gain.setValueAtTime(0.3, t + T * 0.45);
    g.gain.linearRampToValueAtTime(0, t + T);
    lp.connect(g);
    g.connect(out);
    // A turntable brakes about linearly: the playback rate (so every pitch) falls in a straight line.
    for (const [type, f, lvl] of [
      ['sawtooth', 55, 0.8],
      ['sawtooth', 110, 1],
      ['sawtooth', 220.6, 0.6],
      ['square', 330, 0.35],
    ] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(f * p, t);
      o.frequency.linearRampToValueAtTime(f * p * 0.03, t + T);
      o.connect(gainNode(ctx, lvl, lp));
      o.start(t);
      o.stop(t + T + 0.02);
    }
    const hiss = noise(ctx, t, T + 0.02);
    hiss.playbackRate.setValueAtTime(1, t);
    hiss.playbackRate.linearRampToValueAtTime(0.03, t + T);
    hiss.connect(gainNode(ctx, 0.3, lp));
  },

  /** Cartoon bonk on the head: hollow wooden "tok" with a pitched resonance. */
  bonk(env, t, p) {
    const { ctx, out } = env;
    sweepTone(ctx, crunch(env, 0.4, 0.9), t, { f0: 780 * p, f1: 470 * p, sweep: 0.09, peak: 0.75, decay: 0.22 });
    sweepTone(ctx, out, t, { type: 'triangle', f0: 2100 * p, f1: 1700 * p, sweep: 0.03, peak: 0.25, decay: 0.04 });
    sweepTone(ctx, out, t, { f0: 220 * p, f1: 120 * p, sweep: 0.05, peak: 0.45, decay: 0.08 });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1600 * p, q: 1.5, peak: 0.5, attack: 0.0005, decay: 0.015 });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 560 * p, q: 14, peak: 1.2, attack: 0.001, decay: 0.15 });
  },

  /** Cartoon spring "boiing": a twangy tone with a big, slowing pitch + wah wobble. */
  boing(env, t, p) {
    const { ctx, out } = env;
    const T = 0.55;
    const lfo = osc(ctx, 'sine');
    lfo.frequency.setValueAtTime(16, t);
    lfo.frequency.linearRampToValueAtTime(10, t + T);
    const vib = ctx.createGain(); // cents
    vib.gain.setValueAtTime(500, t);
    vib.gain.exponentialRampToValueAtTime(40, t + T);
    const wah = ctx.createGain(); // Hz on the filter
    wah.gain.setValueAtTime(700 * p, t);
    wah.gain.exponentialRampToValueAtTime(60 * p, t + T);
    lfo.connect(vib);
    lfo.connect(wah);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.value = Math.min(ctx.sampleRate * 0.3, 1100 * p);
    wah.connect(lp.frequency);
    const g = ctx.createGain();
    const end = perc(g.gain, t, 0.35, 0.004, T);
    lp.connect(g);
    g.connect(out);
    for (const [type, mul, lvl] of [
      ['square', 1, 0.7],
      ['triangle', 2, 1],
    ] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(150 * p * mul, t);
      o.frequency.exponentialRampToValueAtTime(330 * p * mul, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(260 * p * mul, t + T);
      vib.connect(o.detune);
      o.connect(gainNode(ctx, lvl, lp));
      o.start(t);
      o.stop(end);
    }
    lfo.start(t);
    lfo.stop(end);
  },

  /** Cartoon brawl crash: pots and pans clattering, a couple of thuds. */
  crash(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.2);
    const cr = crunch(env, 0.7, 0.8);
    for (let i = 0; i < 8; i++) {
      const dt = i === 0 ? 0 : rnd(0.02, 0.5);
      const lvl = i === 0 ? 1 : rnd(0.4, 0.85) * (1 - dt * 0.9);
      const f = rnd(600, 2400) * p;
      for (const [ratio, g, d] of [
        [1, 0.2, rnd(0.08, 0.25)],
        [rnd(1.35, 1.6), 0.14, rnd(0.05, 0.18)],
        [rnd(2.3, 2.9), 0.09, rnd(0.04, 0.1)],
      ] as const) {
        sweepTone(ctx, cr, t + dt, { type: 'square', f0: f * ratio, f1: f * ratio * rnd(0.94, 0.99), sweep: 0.08, peak: g * lvl, decay: d });
      }
      noiseBurst(ctx, out, t + dt, { filter: 'bandpass', freq: rnd(2000, 5000) * p, q: 1.2, peak: 0.35 * lvl, decay: rnd(0.02, 0.06) });
    }
    sweepTone(ctx, out, t, { f0: 150 * p, f1: 55 * p, sweep: 0.08, peak: 0.55, decay: 0.15 });
    sweepTone(ctx, out, t + rnd(0.18, 0.3), { f0: 130 * p, f1: 50 * p, sweep: 0.08, peak: 0.4, decay: 0.14 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 5000 * p, peak: 0.25, attack: 0.003, decay: 0.55 });
  },

  /** Knee joint "crrack": a quick run of dry clicks ending on a pop. */
  crack(env, t, p) {
    const { ctx, out } = env;
    let tc = t;
    const n = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      noiseBurst(ctx, out, tc, {
        filter: 'bandpass', freq: rnd(1800, 3800) * p, q: 1.3, peak: rnd(0.35, 0.6), attack: 0.0003, decay: rnd(0.006, 0.014),
      });
      tc += rnd(0.008, 0.02);
    }
    sweepTone(ctx, out, tc, { type: 'triangle', f0: 1300 * p, f1: 600 * p, sweep: 0.02, peak: 0.35, decay: 0.05 });
    sweepTone(ctx, out, tc, { f0: 260 * p, f1: 120 * p, sweep: 0.03, peak: 0.35, decay: 0.06 });
    noiseBurst(ctx, crunch(env, 1, 0.7), tc, { filter: 'highpass', freq: 1500 * p, peak: 0.8, attack: 0.0003, decay: 0.02 });
  },

  /** Running away super fast: smooth descending cartoon whoosh. */
  dash(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 5000 * p, freqEnd: 350 * p, sweep: 0.32, q: 2, peak: 0.6, attack: 0.025, decay: 0.33,
    });
    sweepTone(ctx, out, t, { type: 'triangle', f0: 1900 * p, f1: 240 * p, sweep: 0.3, peak: 0.2, attack: 0.01, decay: 0.32 });
    sweepTone(ctx, out, t, { f0: 230 * p, f1: 60 * p, sweep: 0.1, peak: 0.35, decay: 0.12 });
  },

  /** Muscle flex: a leathery stretching creak and a strained "hnnng". */
  flex(env, t, p) {
    const { ctx, out } = env;
    const T = 0.5;
    // Creak: stick-slip clicks (a slow, wavering sawtooth) ringing a narrow band-pass.
    const c = osc(ctx, 'sawtooth');
    c.frequency.setValueAtTime(28 * p, t);
    c.frequency.linearRampToValueAtTime(55 * p, t + 0.18);
    c.frequency.linearRampToValueAtTime(38 * p, t + 0.32);
    c.frequency.linearRampToValueAtTime(62 * p, t + T);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(900 * p, t);
    bp.frequency.linearRampToValueAtTime(1400 * p, t + T);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(1, t + 0.05);
    cg.gain.setValueAtTime(1, t + T - 0.12);
    cg.gain.linearRampToValueAtTime(0, t + T);
    c.connect(bp);
    bp.connect(cg);
    cg.connect(out);
    c.start(t);
    c.stop(t + T + 0.02);
    // Grunt: buzzy narrow pulse, muffled (nasal "ng"), slightly strained and shaking.
    const v = osc(ctx, 'pulse12');
    v.frequency.setValueAtTime(116 * p, t);
    v.frequency.linearRampToValueAtTime(132 * p, t + 0.35);
    v.frequency.linearRampToValueAtTime(124 * p, t + T + 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.value = 650 * p;
    const shake = gainNode(ctx, 1);
    const lfo = osc(ctx, 'sine');
    lfo.frequency.value = 22;
    const shakeAmt = gainNode(ctx, 0.2);
    lfo.connect(shakeAmt);
    shakeAmt.connect(shake.gain);
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.setValueAtTime(0, t + 0.02);
    vg.gain.linearRampToValueAtTime(0.5, t + 0.12);
    vg.gain.linearRampToValueAtTime(0.4, t + 0.4);
    vg.gain.linearRampToValueAtTime(0, t + T + 0.05);
    v.connect(lp);
    lp.connect(shake);
    shake.connect(vg);
    vg.connect(crunch(env, 0.5, 0.9));
    for (const node of [v, lfo]) {
      node.start(t);
      node.stop(t + T + 0.08);
    }
  },

  /** Sparkle / glint "ting!": a quick upward twinkle into a bright bell partial set. */
  shine(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.3);
    [3136, 3951, 4699, 5274].forEach((f, i) => {
      sweepTone(ctx, out, t + i * 0.022, { f0: f * p, f1: f * p, sweep: 0, peak: 0.06, decay: 0.12 });
    });
    const tt = t + 0.07;
    const f = 2093 * p;
    for (const [r, g, d] of [
      [1, 0.28, 0.9],
      [2.0, 0.1, 0.5],
      [2.76, 0.09, 0.35],
      [5.4, 0.05, 0.15],
    ] as const) {
      sweepTone(ctx, out, tt, { f0: f * r, f1: f * r, sweep: 0, peak: g, decay: d });
    }
    noiseBurst(ctx, out, tt, { filter: 'highpass', freq: 7000 * p, peak: 0.12, attack: 0.005, decay: 0.3 });
  },

  /** Impact frame: a deep sub "boom" under a sharp crack, with a short room tail. */
  impact(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.3);
    sweepTone(ctx, crunch(env, 0.7, 0.9), t, { f0: 95 * p, f1: 28 * p, sweep: 0.35, peak: 1.0, decay: 0.6 });
    noiseBurst(ctx, crunch(env, 1.2, 0.6), t, { filter: 'highpass', freq: 2500 * p, peak: 0.8, attack: 0.0005, decay: 0.05 });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 700 * p, q: 0.6, peak: 0.5, decay: 0.22 });
    noiseBurst(ctx, out, t + 0.01, { filter: 'lowpass', freq: 300 * p, peak: 0.45, attack: 0.01, decay: 0.5, rate: 0.5 });
  },

  /** Body bouncing off a wall / the floor: hollow thud with a short rubbery rebound. */
  bounce(env, t, p) {
    const { ctx, out } = env;
    sweepTone(ctx, crunch(env, 0.4, 0.9), t, { f0: 160 * p, f1: 55 * p, sweep: 0.09, peak: 0.9, decay: 0.2 });
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 900 * p, q: 0.9, peak: 0.45, decay: 0.08 });
    sweepTone(ctx, out, t + 0.07, { type: 'triangle', f0: 110 * p, f1: 240 * p, sweep: 0.12, peak: 0.3, attack: 0.005, decay: 0.14 });
  },

  /** Destruction finish: a wall bursting — boom, rubble raining down, glass shards. */
  wallBreak(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.35);
    heavyImpact(env, t, p * 0.8, 1.6);
    noiseBurst(ctx, crunch(env, 0.9, 0.7), t, { filter: 'lowpass', freq: 1400 * p, peak: 0.8, attack: 0.003, decay: 0.9, rate: 0.6 });
    // rubble: lots of small knocks
    for (let i = 0; i < 16; i++) {
      const dt = rnd(0.04, 1.1);
      const lvl = rnd(0.25, 0.6) * (1 - dt * 0.6);
      sweepTone(ctx, out, t + dt, { f0: rnd(160, 420) * p, f1: rnd(60, 120) * p, sweep: 0.04, peak: lvl, decay: rnd(0.04, 0.09) });
      noiseBurst(ctx, out, t + dt, { filter: 'bandpass', freq: rnd(900, 2600) * p, q: 1.1, peak: lvl * 0.7, decay: rnd(0.015, 0.04) });
    }
    // glass / barrier shards
    for (let i = 0; i < 7; i++) {
      const dt = rnd(0.02, 0.5);
      const f = rnd(2600, 5200) * p;
      sweepTone(ctx, out, t + dt, { type: 'triangle', f0: f, f1: f * 0.97, sweep: 0.1, peak: 0.07, decay: rnd(0.12, 0.3) });
    }
  },

  /** Super jump: a springy launch and a rising rush of air. */
  superJump(env, t, p) {
    const { ctx, out } = env;
    sweepTone(ctx, out, t, { f0: 90 * p, f1: 200 * p, sweep: 0.12, peak: 0.5, decay: 0.16 });
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 400 * p, freqEnd: 4200 * p, sweep: 0.3, q: 1.6, peak: 0.6, attack: 0.03, decay: 0.3,
    });
    noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 400 * p, peak: 0.35, decay: 0.1 });
  },

  /** Air dash: a short, sharp whoosh. */
  airDash(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 3600 * p, freqEnd: 700 * p, sweep: 0.16, q: 1.8, peak: 0.65, attack: 0.012, decay: 0.17,
    });
    sweepTone(ctx, out, t, { type: 'triangle', f0: 900 * p, f1: 300 * p, sweep: 0.12, peak: 0.12, decay: 0.14 });
  },

  /* ---------------- profiles & guard gauge ---------------- */

  /** Overarm throw: a quick rising swish of the arm and a flick at the release. */
  toss(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, {
      filter: 'bandpass', freq: 450 * p, freqEnd: 2600 * p, sweep: 0.11, q: 1.6, peak: 0.55, attack: 0.05, decay: 0.09,
    });
    noiseBurst(ctx, out, t + 0.1, { filter: 'highpass', freq: 3500 * p, peak: 0.25, attack: 0.002, decay: 0.03 });
    sweepTone(ctx, out, t + 0.09, { type: 'triangle', f0: 520 * p, f1: 260 * p, sweep: 0.06, peak: 0.12, decay: 0.07 });
  },

  /** Energy ball: a buzzy downward zap with a soft low "whomp" under it. */
  zap(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(3200 * p, t);
    bp.frequency.exponentialRampToValueAtTime(500 * p, t + 0.22);
    const g = ctx.createGain();
    const end = perc(g.gain, t, 0.45, 0.004, 0.24);
    bp.connect(g);
    g.connect(crunch(env, 0.6, 0.9));
    for (const [type, mul] of [['sawtooth', 1], ['square', 1.5]] as const) {
      const o = osc(ctx, type);
      o.frequency.setValueAtTime(1400 * p * mul, t);
      o.frequency.exponentialRampToValueAtTime(220 * p * mul, t + 0.22);
      o.connect(bp);
      o.start(t);
      o.stop(end);
    }
    sweepTone(ctx, out, t, { f0: 210 * p, f1: 70 * p, sweep: 0.14, peak: 0.55, decay: 0.18 });
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 5000 * p, peak: 0.25, decay: 0.05 });
  },

  /** Web ball hitting: a wet slap and a sticky stretch. */
  splat(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1100 * p, q: 1.3, peak: 0.85, attack: 0.001, decay: 0.07 });
    noiseBurst(ctx, out, t, { filter: 'lowpass', freq: 600 * p, peak: 0.5, attack: 0.002, decay: 0.12 });
    sweepTone(ctx, out, t, { f0: 320 * p, f1: 85 * p, sweep: 0.07, peak: 0.45, decay: 0.12 });
    // the strands stretching
    noiseBurst(ctx, out, t + 0.05, {
      filter: 'bandpass', freq: 2200 * p, freqEnd: 900 * p, sweep: 0.18, q: 4, peak: 0.2, attack: 0.03, decay: 0.16,
    });
  },

  /** Guard crush: a heavy crunch, glass bursting into shards and the guard "powering down". */
  guardBreak(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.4);
    heavyImpact(env, t, p * 0.9, 1.1);
    // glass burst: bright noise + a shower of inharmonic tinkles
    noiseBurst(ctx, crunch(env, 0.8, 0.6), t, { filter: 'highpass', freq: 2800 * p, peak: 0.9, attack: 0.0005, decay: 0.16 });
    noiseBurst(ctx, out, t + 0.01, { filter: 'bandpass', freq: 6000 * p, q: 0.8, peak: 0.45, attack: 0.002, decay: 0.35, rate: 0.9 });
    for (let i = 0; i < 14; i++) {
      const dt = i < 4 ? rnd(0, 0.04) : rnd(0.04, 0.6);
      const f = rnd(2400, 6400) * p;
      const lvl = rnd(0.05, 0.11) * (1 - dt);
      sweepTone(ctx, out, t + dt, { type: 'triangle', f0: f, f1: f * rnd(0.97, 1.0), sweep: 0.1, peak: lvl, decay: rnd(0.08, 0.25) });
      sweepTone(ctx, out, t + dt, { type: 'triangle', f0: f * 1.48, f1: f * 1.46, sweep: 0.1, peak: lvl * 0.5, decay: rnd(0.05, 0.15) });
    }
    // the guard deflating: a falling buzzy tone
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(2400 * p, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(260 * p, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.06);
    g.gain.linearRampToValueAtTime(0.22, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    lp.connect(g);
    g.connect(out);
    const o = osc(ctx, 'square');
    o.frequency.setValueAtTime(620 * p, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(95 * p, t + 0.6);
    o.connect(lp);
    o.start(t + 0.06);
    o.stop(t + 0.64);
  },
  /** Hands closing on clothes: a short fabric rustle and a dull grip thud. */
  clutch(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1800 * p, freqEnd: 900 * p, sweep: 0.08, q: 1.2, peak: 0.6, attack: 0.004, decay: 0.09 });
    noiseBurst(ctx, out, t + 0.035, { filter: 'bandpass', freq: 1100 * p, q: 1.6, peak: 0.4, attack: 0.003, decay: 0.07 });
    sweepTone(ctx, out, t, { f0: 170 * p, f1: 80 * p, sweep: 0.06, peak: 0.55, decay: 0.12 });
  },

  /** Throw escape: two sharp slaps (hands knocked apart) + a bright ringing ping. */
  tech(env, t, p) {
    const { ctx, out } = env;
    reverbSend(env, 0.25);
    for (const dt of [0, 0.045]) {
      noiseBurst(ctx, crunch(env, 0.5, 0.8), t + dt, { filter: 'bandpass', freq: 2900 * p, q: 0.9, peak: 0.9, attack: 0.0005, decay: 0.06 });
      noiseBurst(ctx, out, t + dt, { filter: 'highpass', freq: 5200 * p, peak: 0.5, attack: 0.0005, decay: 0.02 });
      sweepTone(ctx, out, t + dt, { f0: 380 * p, f1: 150 * p, sweep: 0.04, peak: 0.45, decay: 0.07 });
    }
    // the spark between them: metallic ping, slightly detuned pair
    sweepTone(ctx, out, t + 0.01, { type: 'triangle', f0: 1980 * p, f1: 1960 * p, sweep: 0.3, peak: 0.22, decay: 0.38 });
    sweepTone(ctx, out, t + 0.01, { type: 'triangle', f0: 2970 * p, f1: 2950 * p, sweep: 0.3, peak: 0.12, decay: 0.26 });
    // air pushed out as they skid apart
    noiseBurst(ctx, out, t + 0.05, { filter: 'bandpass', freq: 500 * p, freqEnd: 1600 * p, sweep: 0.14, q: 1.3, peak: 0.3, attack: 0.04, decay: 0.12 });
  },

  /* ---------------- BBL KART ---------------- */

  /** countdown beep */
  beep(env, t, p) {
    blip(env, t, 'square', [[0, 660 * p]], 0.32, 0.25, 3000);
    blip(env, t, 'triangle', [[0, 330 * p]], 0.32, 0.3);
  },

  /** GO! beep, an octave up and longer */
  beepGo(env, t, p) {
    blip(env, t, 'square', [[0, 1320 * p]], 0.7, 0.25, 4000);
    blip(env, t, 'triangle', [[0, 660 * p]], 0.7, 0.3);
    reverbSend(env, 0.2);
  },

  /** turbo: a rising whoosh with a jet roar */
  turbo(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 600 * p, freqEnd: 3200 * p, sweep: 0.35, q: 1.1, peak: 0.8, attack: 0.03, decay: 0.45 });
    sweepTone(ctx, crunch(env, 0.6, 0.5), t, { type: 'sawtooth', f0: 90 * p, f1: 260 * p, sweep: 0.3, peak: 0.35, attack: 0.02, decay: 0.45 });
  },

  /** mini-turbo tier: bright crackle */
  spark(env, t, p) {
    const { ctx, out } = env;
    for (let i = 0; i < 4; i++) noiseBurst(ctx, out, t + i * 0.025, { filter: 'highpass', freq: 4500 * p, peak: 0.5, attack: 0.001, decay: 0.03 });
    blip(env, t, 'square', [[0, 1760 * p], [0.05, 2640 * p]], 0.12, 0.12, 6000);
  },

  /** item box shattering: glassy sparkle */
  itemBox(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'highpass', freq: 3000 * p, peak: 0.6, attack: 0.001, decay: 0.12 });
    [1568, 2093, 2637, 3136].forEach((f, i) => blip(env, t + i * 0.04, 'triangle', [[0, f * p]], 0.18, 0.18));
  },

  /** roulette tick */
  roulette(env, t, p) {
    blip(env, t, 'pulse25', [[0, 1200 * p]], 0.04, 0.12, 5000);
  },

  /** item obtained: two-note chime */
  itemGet(env, t, p) {
    blip(env, t, 'square', [[0, 1046 * p]], 0.1, 0.18, 5000);
    blip(env, t + 0.08, 'square', [[0, 1568 * p]], 0.2, 0.2, 5000);
  },

  /** lap: ascending three notes */
  lap(env, t, p) {
    [784, 988, 1175].forEach((f, i) => blip(env, t + i * 0.09, 'square', [[0, f * p]], 0.14, 0.2, 4000));
    reverbSend(env, 0.15);
  },

  /** hop: short boing + suspension creak */
  hop(env, t, p) {
    blip(env, t, 'triangle', [[0, 220 * p], [0.08, 440 * p]], 0.1, 0.25);
  },

  /** trick: whoosh + "ta-da" */
  trick(env, t, p) {
    const { ctx, out } = env;
    noiseBurst(ctx, out, t, { filter: 'bandpass', freq: 1800 * p, freqEnd: 900 * p, sweep: 0.2, q: 2, peak: 0.5, attack: 0.02, decay: 0.2 });
    blip(env, t + 0.05, 'square', [[0, 1318 * p]], 0.08, 0.16, 5000);
    blip(env, t + 0.13, 'square', [[0, 1975 * p]], 0.2, 0.18, 5000);
  },

  /** ding */
  ding(env, t, p) {
    blip(env, t, 'triangle', [[0, 2093 * p]], 0.3, 0.25);
    blip(env, t, 'triangle', [[0, 3136 * p]], 0.2, 0.12);
  },
};
