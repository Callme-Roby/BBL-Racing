/**
 * synth.ts — a tiny procedural synthesis toolkit (Web Audio only, zero deps).
 *
 * Everything here schedules short-lived nodes on the AudioContext timeline:
 * sources are always start()ed and stop()ed, so once they finish (and nothing
 * references them any more) the browser garbage-collects the whole little graph.
 *
 * Used by the music sequencer (melodic voices + drum kit) and by the SFX.
 */

export type Ctx = BaseAudioContext;

/** Oscillator shapes: the native ones plus PS1/NES-style narrow pulse waves. */
export type Wave = Exclude<OscillatorType, 'custom'> | 'pulse25' | 'pulse12';

/* ------------------------------------------------------------------------ */
/* Per-context caches (noise buffer, periodic waves, distortion curves)      */
/* ------------------------------------------------------------------------ */

interface Cache {
  noise?: AudioBuffer;
  waves: Map<string, PeriodicWave>;
  curves: Map<number, Float32Array<ArrayBuffer>>;
}

const caches = new WeakMap<Ctx, Cache>();

function cacheOf(ctx: Ctx): Cache {
  let c = caches.get(ctx);
  if (!c) {
    c = { waves: new Map(), curves: new Map() };
    caches.set(ctx, c);
  }
  return c;
}

/** 2 seconds of white noise, shared by every noise-based sound. */
export function noiseBuffer(ctx: Ctx): AudioBuffer {
  const c = cacheOf(ctx);
  if (!c.noise) {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    c.noise = buf;
  }
  return c.noise;
}

/** A noise source that plays (looped, from a random offset) between `t` and `t + dur`. */
export function noise(ctx: Ctx, t: number, dur: number, rate = 1): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t, Math.random() * 1.5);
  src.stop(t + Math.max(0.01, dur));
  return src;
}

/**
 * Generated reverb impulse response: stereo noise with an exponential decay,
 * getting darker towards the tail (cheap "room/hall" for a ConvolverNode).
 */
export function impulseResponse(ctx: Ctx, seconds = 2.2, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // One-pole lowpass whose smoothing grows with time -> high frequencies die first.
      const a = 0.2 + 0.75 * k;
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.pow(1 - k, decay);
    }
  }
  return buf;
}

/** PeriodicWave for a pulse wave of the given duty cycle (0..1). */
function pulseWave(ctx: Ctx, duty: number): PeriodicWave {
  const c = cacheOf(ctx);
  const key = `pulse${duty}`;
  let w = c.waves.get(key);
  if (!w) {
    const n = 48;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const a = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      real[k] = a * Math.cos(k * Math.PI * duty);
      imag[k] = a * Math.sin(k * Math.PI * duty);
    }
    w = ctx.createPeriodicWave(real, imag);
    c.waves.set(key, w);
  }
  return w;
}

/** Create an (unstarted) oscillator of the given shape. */
export function osc(ctx: Ctx, type: Wave): OscillatorNode {
  const o = ctx.createOscillator();
  if (type === 'pulse25') o.setPeriodicWave(pulseWave(ctx, 0.25));
  else if (type === 'pulse12') o.setPeriodicWave(pulseWave(ctx, 0.125));
  else o.type = type;
  return o;
}

/** Soft-clipping WaveShaper (tanh). `amount` 0..2, higher = crunchier. */
export function shaper(ctx: Ctx, amount: number): WaveShaperNode {
  const c = cacheOf(ctx);
  const key = Math.round(amount * 100);
  let curve = c.curves.get(key);
  if (!curve) {
    const n = 1024;
    const k = 1 + amount * 8;
    const norm = Math.tanh(k);
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    c.curves.set(key, curve);
  }
  const ws = ctx.createWaveShaper();
  ws.curve = curve;
  return ws;
}

/** A GainNode with a fixed value, optionally connected to `dest`. */
export function gainNode(ctx: Ctx, value: number, dest?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

/* ------------------------------------------------------------------------ */
/* Envelopes                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * ADSR on an AudioParam. The release starts at `end` (note-off).
 * Returns the time after which the voice is silent (safe stop() time).
 */
export function adsr(
  p: AudioParam,
  t: number,
  end: number,
  peak: number,
  a: number,
  d: number,
  s: number,
  r: number,
): number {
  const ta = t + Math.max(a, 0.001);
  const rel = Math.max(end, ta + 0.001);
  const rr = Math.max(r, 0.005);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, ta);
  p.setTargetAtTime(peak * s, ta, Math.max(d, 0.003) / 3);
  p.setTargetAtTime(0, rel, rr / 3);
  return rel + rr * 2 + 0.02;
}

/** Percussive envelope: quick linear attack then exponential decay. Returns the end time. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const pk = Math.max(peak, 0.0002);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + Math.max(attack, 0.0005));
  p.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(decay, 0.005));
  return t + attack + decay + 0.02;
}

/* ------------------------------------------------------------------------ */
/* Generic one-shot building blocks (shared by drums and SFX)                */
/* ------------------------------------------------------------------------ */

export interface SweepOptions {
  type?: Wave;
  /** start frequency (Hz) */
  f0: number;
  /** end frequency (Hz) */
  f1: number;
  /** pitch sweep duration (s) */
  sweep: number;
  peak: number;
  attack?: number;
  decay: number;
}

/** An oscillator whose pitch drops (or rises) exponentially: kicks, toms, thumps, zaps. */
export function sweepTone(ctx: Ctx, dest: AudioNode, t: number, o: SweepOptions): number {
  const node = osc(ctx, o.type ?? 'sine');
  const g = ctx.createGain();
  node.frequency.setValueAtTime(Math.max(1, o.f0), t);
  if (o.f1 !== o.f0) node.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + Math.max(0.005, o.sweep));
  const end = perc(g.gain, t, o.peak, o.attack ?? 0.001, o.decay);
  node.connect(g);
  g.connect(dest);
  node.start(t);
  node.stop(end);
  return end;
}

export interface NoiseOptions {
  filter?: BiquadFilterType;
  freq: number;
  /** if set, the filter frequency glides to this value over `sweep` seconds */
  freqEnd?: number;
  sweep?: number;
  q?: number;
  peak: number;
  attack?: number;
  decay: number;
  /** noise playback rate (lower = grainier/darker) */
  rate?: number;
}

/** A filtered noise burst: hats, snares, swishes, crunches, dust... */
export function noiseBurst(ctx: Ctx, dest: AudioNode, t: number, o: NoiseOptions): number {
  const attack = o.attack ?? 0.001;
  const total = attack + o.decay + 0.03;
  const src = noise(ctx, t, total, o.rate ?? 1);
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.Q.value = o.q ?? 0.8;
  const nyq = ctx.sampleRate * 0.45;
  f.frequency.setValueAtTime(Math.min(nyq, o.freq), t);
  if (o.freqEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.min(nyq, Math.max(20, o.freqEnd)), t + (o.sweep ?? attack + o.decay));
  }
  const g = ctx.createGain();
  perc(g.gain, t, o.peak, attack, o.decay);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  return t + total;
}

/* ------------------------------------------------------------------------ */
/* Melodic voice                                                             */
/* ------------------------------------------------------------------------ */

export interface OscSpec {
  type: Wave;
  /** detune in cents */
  detune?: number;
  /** octave offset (-1 = one octave down) */
  oct?: number;
  /** relative level of this oscillator (default 1) */
  gain?: number;
}

/** A synth patch: a few oscillators -> optional filter (with envelope) -> optional drive -> ADSR amp. */
export interface TonePreset {
  osc: OscSpec[];
  /** amp envelope (seconds, sustain level 0..1) */
  a: number;
  d: number;
  s: number;
  r: number;
  /** filter cutoff in Hz; no filter when omitted */
  cutoff?: number;
  filterType?: BiquadFilterType;
  q?: number;
  /** filter envelope amount: Hz added to the cutoff at note-on */
  fenv?: number;
  /** filter envelope decay time (s) */
  fdecay?: number;
  /** keyboard tracking of the cutoff (0 = none, 1 = follows pitch) */
  ftrack?: number;
  /** portamento time (s). Glides from the previous note on legato notes... */
  glide?: number;
  /** ...or between every note when true (G-funk whine). */
  glideAlways?: boolean;
  /** vibrato: rate (Hz), depth (cents), delay before it fades in (s) */
  vib?: { rate: number; depth: number; delay?: number };
  /** WaveShaper saturation amount */
  drive?: number;
  /** per-note level multiplier */
  level?: number;
}

/**
 * Play one note of a preset. `dur` is the gate time (release starts after it).
 * `from` = previous frequency, for portamento.
 */
export function playTone(
  ctx: Ctx,
  dest: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vel: number,
  p: TonePreset,
  from?: number,
): void {
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const stopAt = adsr(amp.gain, t, t + Math.max(0.01, dur), vel * (p.level ?? 1), p.a, p.d, p.s, p.r);
  amp.connect(dest);

  // Signal chain is built backwards: oscillators -> filter -> drive -> amp.
  let input: AudioNode = amp;
  if (p.drive) {
    const ws = shaper(ctx, p.drive);
    ws.connect(input);
    input = ws;
  }
  if (p.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = p.filterType ?? 'lowpass';
    f.Q.value = p.q ?? 0.7;
    const nyq = ctx.sampleRate * 0.45;
    const base = Math.min(nyq, p.cutoff * Math.pow(freq / 261.63, p.ftrack ?? 0));
    if (p.fenv) {
      // A finite ramp (rather than setTargetAtTime) lets the browser stop
      // recomputing filter coefficients per sample once the sweep is over.
      f.frequency.setValueAtTime(Math.min(nyq, base + p.fenv * vel), t);
      f.frequency.exponentialRampToValueAtTime(base, t + Math.max(0.01, p.fdecay ?? 0.2));
    } else {
      f.frequency.setValueAtTime(base, t);
    }
    f.connect(input);
    input = f;
  }

  // Optional vibrato LFO shared by all oscillators of the note (modulates detune, in cents).
  let lfoGain: GainNode | null = null;
  if (p.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vib.rate;
    lfoGain = ctx.createGain();
    const vd = t + (p.vib.delay ?? 0);
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.setValueAtTime(0, vd);
    lfoGain.gain.linearRampToValueAtTime(p.vib.depth, vd + 0.15);
    lfo.connect(lfoGain);
    lfo.start(t);
    lfo.stop(stopAt);
  }

  const glide = from !== undefined && p.glide ? p.glide : 0;
  for (const o of p.osc) {
    const node = osc(ctx, o.type);
    const mul = Math.pow(2, o.oct ?? 0);
    const target = freq * mul;
    if (glide > 0 && from !== undefined) {
      node.frequency.setValueAtTime(from * mul, t);
      node.frequency.exponentialRampToValueAtTime(target, t + glide);
    } else {
      node.frequency.setValueAtTime(target, t);
    }
    if (o.detune) node.detune.value = o.detune;
    if (lfoGain) lfoGain.connect(node.detune);
    if (o.gain !== undefined && o.gain !== 1) {
      const g = gainNode(ctx, o.gain, input);
      node.connect(g);
    } else {
      node.connect(input);
    }
    node.start(t);
    node.stop(stopAt);
  }
}

/* ------------------------------------------------------------------------ */
/* Drum kit                                                                  */
/* ------------------------------------------------------------------------ */

export type DrumKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openHat'
  | 'crash'
  | 'tom'
  | 'taiko'
  | 'rim'
  | 'shaker'
  | 'riser';

/**
 * Play a synthesized drum hit. `tune` scales its pitch, `decay` its length.
 */
export function playDrum(ctx: Ctx, dest: AudioNode, kind: DrumKind, t: number, vel: number, tune = 1, decay = 1): void {
  switch (kind) {
    case 'kick':
      // Sine with a fast pitch drop + a tiny beater click.
      sweepTone(ctx, dest, t, { f0: 160 * tune, f1: 44 * tune, sweep: 0.1 * decay, peak: vel, attack: 0.002, decay: 0.36 * decay });
      noiseBurst(ctx, dest, t, { filter: 'highpass', freq: 2500, peak: vel * 0.22, decay: 0.012 });
      break;
    case 'snare':
      sweepTone(ctx, dest, t, { type: 'triangle', f0: 240 * tune, f1: 165 * tune, sweep: 0.04, peak: vel * 0.55, decay: 0.09 * decay });
      noiseBurst(ctx, dest, t, { filter: 'highpass', freq: 1400 * tune, q: 0.7, peak: vel * 0.75, decay: 0.15 * decay });
      noiseBurst(ctx, dest, t, { filter: 'bandpass', freq: 4200 * tune, q: 0.8, peak: vel * 0.3, decay: 0.07 * decay });
      break;
    case 'clap': {
      // Three quick bursts then a short tail, through a band-pass.
      const tail = 0.17 * decay;
      const src = noise(ctx, t, 0.04 + tail + 0.03);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1150 * tune;
      f.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        const ti = t + i * 0.011;
        g.gain.setValueAtTime(vel, ti);
        g.gain.exponentialRampToValueAtTime(vel * 0.12, ti + 0.009);
      }
      const tl = t + 0.034;
      g.gain.setValueAtTime(vel * 0.85, tl);
      g.gain.exponentialRampToValueAtTime(0.0001, tl + tail);
      src.connect(f);
      f.connect(g);
      g.connect(dest);
      break;
    }
    case 'hat':
      noiseBurst(ctx, dest, t, { filter: 'highpass', freq: 7200 * tune, q: 0.9, peak: vel * 0.6, decay: 0.045 * decay });
      break;
    case 'openHat':
      noiseBurst(ctx, dest, t, { filter: 'highpass', freq: 6800 * tune, q: 0.9, peak: vel * 0.5, attack: 0.003, decay: 0.3 * decay });
      break;
    case 'crash':
      noiseBurst(ctx, dest, t, { filter: 'highpass', freq: 4800 * tune, q: 0.6, peak: vel * 0.55, attack: 0.002, decay: 1.5 * decay });
      noiseBurst(ctx, dest, t, { filter: 'bandpass', freq: 3200 * tune, q: 0.6, peak: vel * 0.25, decay: 0.8 * decay });
      break;
    case 'tom':
      sweepTone(ctx, dest, t, { f0: 210 * tune, f1: 105 * tune, sweep: 0.18, peak: vel, attack: 0.002, decay: 0.32 * decay });
      noiseBurst(ctx, dest, t, { filter: 'lowpass', freq: 1500, peak: vel * 0.2, decay: 0.04 });
      break;
    case 'taiko':
      // Big low drum: deep sine body, triangle overtone and a skin slap.
      sweepTone(ctx, dest, t, { f0: 115 * tune, f1: 60 * tune, sweep: 0.22, peak: vel, attack: 0.003, decay: 0.6 * decay });
      sweepTone(ctx, dest, t, { type: 'triangle', f0: 190 * tune, f1: 125 * tune, sweep: 0.1, peak: vel * 0.35, decay: 0.2 * decay });
      noiseBurst(ctx, dest, t, { filter: 'lowpass', freq: 800, peak: vel * 0.5, decay: 0.09 });
      break;
    case 'rim':
      // Woodblock / rim click.
      sweepTone(ctx, dest, t, { f0: 1250 * tune, f1: 1150 * tune, sweep: 0.03, peak: vel * 0.6, decay: 0.06 * decay });
      sweepTone(ctx, dest, t, { type: 'triangle', f0: 1900 * tune, f1: 1800 * tune, sweep: 0.02, peak: vel * 0.25, decay: 0.03 });
      noiseBurst(ctx, dest, t, { filter: 'bandpass', freq: 3500, q: 1.5, peak: vel * 0.3, decay: 0.012 });
      break;
    case 'shaker':
      noiseBurst(ctx, dest, t, { filter: 'bandpass', freq: 7500 * tune, q: 1.2, peak: vel * 0.5, attack: 0.012, decay: 0.05 * decay });
      break;
    case 'riser':
      // Noise sweeping upwards for ~2 s (transition FX).
      noiseBurst(ctx, dest, t, {
        filter: 'bandpass',
        freq: 300,
        freqEnd: 7000,
        sweep: 1.9 * decay,
        q: 3,
        peak: vel * 0.6,
        attack: 1.8 * decay,
        decay: 0.12,
      });
      break;
  }
}
