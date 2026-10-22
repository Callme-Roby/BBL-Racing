/**
 * audio.ts — the BBL FIGHTERZ audio engine.
 *
 *   import { audio } from './audio/audio';
 *   window.addEventListener('pointerdown', () => audio.unlock());
 *   audio.playMusic('hood');
 *   audio.sfx('hitHeavy', { pan: -0.4 });
 *   await audio.announcer('fight');
 *
 * Graph:
 *   music tracks (crossfade gains) -> music volume -> duck -> soft lowpass ┐
 *   sfx (per-play gain + pan, shared reverb)  -> sfx volume -> duck        ├-> master -> compressor -> speakers
 *   voice files                               -> voice volume              ┘
 *   (speechSynthesis lines bypass Web Audio; they get master*voice as utterance volume)
 *
 * Everything is a silent no-op until `unlock()` is called from a user gesture, and
 * when Web Audio / Web Speech are unavailable (headless tests, old browsers).
 * Nothing touches `window` or creates an AudioContext at import time.
 */

import type { AnnouncerLine, MusicId, SfxId, SfxOptions, VoiceOptions, Volumes } from './types';
import { ANNOUNCER_FILES, MUSIC_FILES, SFX_FILES } from './manifest';
import { loadBuffer, peekBuffer, warnOnce } from './assets';
import { compileSong, SongPlayer } from './sequencer';
import type { CompiledSong } from './sequencer';
import { getSong } from './songs';
import { playSfx, RANDOMIZED_SFX } from './sfx';
import { gainNode, impulseResponse } from './synth';
import { initSpeech, playAudioElement, speakTTS, VoiceQueue, warmUpSpeech } from './speech';
import type { SpeakerKind, VoiceJob } from './speech';

export interface AudioEngine {
  /** Must be called from a user gesture (click/keydown). Creates/resumes the AudioContext. Safe to call many times. */
  unlock(): void;
  /** Crossfade from the current music; same id already playing = no-op. */
  playMusic(id: MusicId, opts?: { fade?: number; loop?: boolean }): void;
  stopMusic(fade?: number): void;
  sfx(id: SfxId, opts?: SfxOptions): void;
  /**
   * Speak a character line. Uses opts.file if given and loadable, otherwise speechSynthesis
   * (prefers a voice matching opts.lang, default 'fr-FR'). Resolves when finished (or after a
   * timeout fallback if speech events never fire). Never rejects.
   */
  say(text: string, opts?: VoiceOptions): Promise<void>;
  /**
   * Arcade announcer (deep English voice). Plays the manifest file for that line if any.
   * Cancels any ongoing announcer speech first. Resolves when done, never rejects.
   */
  announcer(line: AnnouncerLine): Promise<void>;
  setVolumes(v: Partial<Volumes>): void;
  getVolumes(): Volumes;
  /** music/sfx ducking hint while voices talk (also applied automatically while a voice line plays). */
  duck(on: boolean): void;
  /** A continuous kart engine (+ drift skid) voice; null when the audio is not running yet. */
  engine(): EngineVoice | null;
}

/** A looping kart engine: call `set` every frame, `stop` when the race ends. */
export interface EngineVoice {
  /**
   * @param rpm 0 (idle) .. 1 (top speed), >1 while boosting
   * @param skid 0..1 drift / offroad rumble
   * @param vol 0..1
   */
  set(rpm: number, skid: number, vol: number, pan?: number): void;
  stop(): void;
}

/* ------------------------------------------------------------------------ */
/* Constants                                                                 */
/* ------------------------------------------------------------------------ */

const STORAGE_KEY = 'bbl.volumes';
const DEFAULT_VOLUMES: Volumes = { master: 0.8, music: 0.55, sfx: 0.8, voice: 1 };
const VOLUME_KEYS: (keyof Volumes)[] = ['master', 'music', 'sfx', 'voice'];

/** Default crossfade / fade-out time (s). */
const DEFAULT_FADE = 0.8;
/** The same effect fired twice within this window (s) is played once. */
const SFX_DEDUPE = 0.012;
/** Music / sfx levels while ducked. */
const DUCK_MUSIC = 0.4;
const DUCK_SFX = 0.85;

/** Spoken announcer lines (spelled for TTS pronunciation). */
const ANNOUNCER_TEXT: Record<AnnouncerLine, string> = {
  round1: 'Round one!',
  round2: 'Round two!',
  round3: 'Round three!',
  finalRound: 'Final round!',
  fight: 'Fight!',
  ko: 'K. O.!',
  doubleKo: 'Double K. O.!',
  perfect: 'Perfect!',
  timeUp: 'Time up!',
  youWin: 'You win!',
  youLose: 'You lose!',
  draw: 'Draw!',
  chooseFighter: 'Choose your fighter!',
  gameTitle: 'B. B. L. Kart!',
  three: 'Three!',
  two: 'Two!',
  one: 'One!',
  go: 'Go!',
  finalLap: 'Final lap!',
  finish: 'Finish!',
  chooseDriver: 'Choose your driver!',
};
const ANNOUNCER_VOICE = { lang: 'en-US', pitch: 0.6, rate: 0.85 };

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

interface Bus {
  master: GainNode;
  music: GainNode;
  musicDuck: GainNode;
  sfx: GainNode;
  sfxDuck: GainNode;
  voice: GainNode;
  sfxReverb: ConvolverNode;
}

/** One playing music track (procedural or file), with its own crossfade gain. */
interface Playback {
  id: MusicId;
  out: GainNode;
  stopping: boolean;
  disposed: boolean;
  player: SongPlayer | null;
  source: AudioBufferSourceNode | null;
}

interface VoiceSpec {
  lang: string;
  pitch: number;
  rate: number;
  file?: string;
  deep: boolean;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** A finite number or the fallback. */
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

function loadVolumes(): Volumes {
  const v: Volumes = { ...DEFAULT_VOLUMES };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const k of VOLUME_KEYS) v[k] = clamp(num((parsed as Record<string, unknown>)[k], v[k]), 0, 1);
      }
    }
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  return v;
}

function saveVolumes(v: Volumes): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked / full */
  }
}

/** Smoothly move a param to a value (no zipper noise). */
function glideParam(p: AudioParam, value: number, t: number, tau: number): void {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(value, t, tau);
}

/* ------------------------------------------------------------------------ */
/* Engine                                                                    */
/* ------------------------------------------------------------------------ */

class Engine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private vols: Volumes | null = null;
  private current: Playback | null = null;
  private pendingMusic: { id: MusicId; opts: { fade?: number; loop?: boolean } } | null = null;
  private manualDuck = false;
  private voiceBusy = false;
  private unlockedOnce = false;
  private readonly impulses = new Map<number, AudioBuffer>();
  private readonly compiled = new Map<MusicId, CompiledSong>();
  private readonly lastSfx = new Map<SfxId, number>();
  private readonly voices = new VoiceQueue((busy) => {
    this.voiceBusy = busy;
    this.applyDuck();
  });

  /* ---------------- lifecycle ---------------- */

  unlock(): void {
    try {
      if (this.ensureContext() && this.ctx && this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
      if (!this.unlockedOnce) {
        this.unlockedOnce = true;
        warmUpSpeech();
        this.preloadFiles();
      }
      if (this.pendingMusic && this.ctx) {
        const { id, opts } = this.pendingMusic;
        this.pendingMusic = null;
        this.playMusic(id, opts);
      }
    } catch (err) {
      warnOnce('unlock', '[audio] unlock failed:', err);
    }
  }

  private ensureContext(): boolean {
    if (this.ctx) return true;
    const AC = audioContextCtor();
    if (!AC) return false;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        return false;
      }
    }
    const v = this.volumes();

    // A light glue compressor on everything.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    const master = gainNode(ctx, v.master, comp);

    // Music: volume -> duck -> gentle lowpass (softer, PS1-ish top end) -> master.
    const musicLp = ctx.createBiquadFilter();
    musicLp.type = 'lowpass';
    musicLp.frequency.value = 12000;
    musicLp.connect(master);
    const musicDuck = gainNode(ctx, 1, musicLp);
    const music = gainNode(ctx, v.music, musicDuck);

    const sfxDuck = gainNode(ctx, 1, master);
    const sfx = gainNode(ctx, v.sfx, sfxDuck);
    const voice = gainNode(ctx, v.voice, master);

    // Shared SFX reverb (KO tail, bell, super...): per-play sends feed it.
    const sfxReverb = ctx.createConvolver();
    sfxReverb.buffer = impulseResponse(ctx, 1.8, 3.5);
    sfxReverb.connect(gainNode(ctx, 0.6, sfx));

    this.ctx = ctx;
    this.bus = { master, music, musicDuck, sfx, sfxDuck, voice, sfxReverb };
    this.applyDuck();
    return true;
  }

  /** Start fetching the SFX / announcer files listed in the manifest, so they play without delay. */
  private preloadFiles(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const url of [...Object.values(SFX_FILES), ...Object.values(ANNOUNCER_FILES)]) {
      if (url) void loadBuffer(ctx, url);
    }
  }

  private impulse(seconds: number): AudioBuffer {
    const key = Math.round(seconds * 10) / 10;
    let buf = this.impulses.get(key);
    if (!buf) {
      buf = impulseResponse(this.ctx!, key, 3);
      this.impulses.set(key, buf);
    }
    return buf;
  }

  /* ---------------- music ---------------- */

  playMusic(id: MusicId, opts: { fade?: number; loop?: boolean } = {}): void {
    try {
      if (!this.ctx || !this.bus) {
        // Not unlocked yet: remember the request, start it on unlock().
        this.pendingMusic = { id, opts };
        return;
      }
      if (this.current && this.current.id === id && !this.current.stopping) return;
      const fade = Math.max(0, num(opts.fade, DEFAULT_FADE));
      const loop = opts.loop ?? getSong(id).loop ?? true;
      if (this.current) this.stopPlayback(this.current, fade);
      this.current = this.startPlayback(id, loop, fade);
    } catch (err) {
      warnOnce(`music:${id}`, `[audio] playMusic("${id}") failed:`, err);
    }
  }

  stopMusic(fade?: number): void {
    try {
      this.pendingMusic = null;
      if (this.current) this.stopPlayback(this.current, Math.max(0, num(fade, DEFAULT_FADE)));
      this.current = null;
    } catch (err) {
      warnOnce('stopMusic', '[audio] stopMusic failed:', err);
    }
  }

  private startPlayback(id: MusicId, loop: boolean, fade: number): Playback {
    const ctx = this.ctx!;
    const out = gainNode(ctx, 0, this.bus!.music);
    const pb: Playback = { id, out, stopping: false, disposed: false, player: null, source: null };

    const fadeIn = (): void => {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      if (fade > 0.01) {
        out.gain.setValueAtTime(0, t);
        out.gain.linearRampToValueAtTime(1, t + fade);
      } else {
        out.gain.setValueAtTime(1, t);
      }
    };
    const procedural = (): void => {
      if (pb.stopping) return;
      fadeIn();
      this.startSong(pb, loop);
    };

    const url = MUSIC_FILES[id];
    if (!url) {
      procedural();
    } else {
      void loadBuffer(ctx, url).then((buf) => {
        if (pb.stopping) return;
        if (!buf) {
          procedural();
          return;
        }
        try {
          fadeIn();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = loop;
          src.connect(out);
          src.onended = () => this.trackEnded(pb);
          src.start(ctx.currentTime + 0.02);
          pb.source = src;
        } catch (err) {
          warnOnce(url, `[audio] could not play "${url}":`, err);
          procedural();
        }
      });
    }
    return pb;
  }

  private startSong(pb: Playback, loop: boolean): void {
    const ctx = this.ctx!;
    const def = getSong(pb.id);
    let song = this.compiled.get(pb.id);
    if (!song) {
      song = compileSong(def, pb.id);
      this.compiled.set(pb.id, song);
    }
    const player = new SongPlayer(ctx, def, song, pb.out, { loop, impulse: this.impulse(def.reverb ?? 2.2) });
    player.onEnd = () => this.trackEnded(pb);
    pb.player = player;
    player.start(ctx.currentTime + 0.06);
  }

  /** Fade a track out, then tear it down. */
  private stopPlayback(pb: Playback, fade: number): void {
    if (pb.stopping) return;
    pb.stopping = true;
    const ctx = this.ctx;
    if (!ctx) return;
    const f = Math.max(0.03, fade);
    const t = ctx.currentTime;
    const g = pb.out.gain;
    const v = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(0, t + f);
    // Keep sequencing during the fade so it doesn't go silent early.
    setTimeout(() => this.disposePlayback(pb), (f + 0.15) * 1000);
  }

  /** A non-looping track reached its end (e.g. the victory jingle). */
  private trackEnded(pb: Playback): void {
    if (this.current === pb) this.current = null;
    if (pb.disposed) return;
    pb.stopping = true;
    // Let the reverb tail ring before tearing down.
    setTimeout(() => this.disposePlayback(pb), 4000);
  }

  private disposePlayback(pb: Playback): void {
    if (pb.disposed) return;
    pb.disposed = true;
    pb.player?.dispose();
    pb.player = null;
    try {
      if (pb.source) {
        pb.source.onended = null;
        pb.source.stop();
        pb.source.disconnect();
      }
    } catch {
      /* already stopped */
    }
    pb.source = null;
    try {
      pb.out.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /* ---------------- sfx ---------------- */

  sfx(id: SfxId, opts: SfxOptions = {}): void {
    try {
      const ctx = this.ctx;
      const bus = this.bus;
      // Not unlocked (or suspended): drop it, so effects don't pile up and burst on resume.
      if (!ctx || !bus || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const last = this.lastSfx.get(id);
      if (last !== undefined && Math.abs(now - last) < SFX_DEDUPE) return;
      this.lastSfx.set(id, now);

      let pitch = clamp(num(opts.pitch, 1), 0.1, 4);
      if (RANDOMIZED_SFX.has(id)) pitch *= 1 + (Math.random() * 2 - 1) * 0.04;

      // Per-play output: volume -> pan -> sfx bus.
      const out = gainNode(ctx, clamp(num(opts.volume, 1), 0, 2));
      const pan = clamp(num(opts.pan, 0), -1, 1);
      if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        out.connect(panner);
        panner.connect(bus.sfx);
      } else {
        out.connect(bus.sfx);
      }

      const procedural = (): void => playSfx({ ctx, out, reverb: bus.sfxReverb }, id, ctx.currentTime, pitch);
      const url = SFX_FILES[id];
      if (url) {
        const buf = peekBuffer(url);
        if (buf) {
          this.playBuffer(buf, out, pitch);
          return;
        }
        if (buf === undefined) {
          // Still loading (normally preloaded at unlock): play whichever is available when ready.
          void loadBuffer(ctx, url).then((b) => (b ? this.playBuffer(b, out, pitch) : procedural()));
          return;
        }
      }
      procedural();
    } catch (err) {
      warnOnce(`sfx:${id}`, `[audio] sfx("${id}") failed:`, err);
    }
  }

  engine(): EngineVoice | null {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return null;
    try {
      const out = gainNode(ctx, 0, bus.sfx);
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (panner) {
        out.disconnect();
        out.connect(panner);
        panner.connect(bus.sfx);
      }
      // two detuned buzzy oscillators through a crunchy lowpass: a small 2-stroke engine
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 2;
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * 2 - 1;
        curve[i] = Math.tanh(x * 2.5);
      }
      ws.curve = curve;
      ws.connect(lp);
      lp.connect(out);
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      const g1 = gainNode(ctx, 0.35, ws);
      const g2 = gainNode(ctx, 0.22, ws);
      o1.connect(g1);
      o2.connect(g2);
      // drift skid: filtered noise
      const len = ctx.sampleRate;
      const nb = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = nb;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 1.2;
      const skidG = gainNode(ctx, 0, out);
      noise.connect(bp);
      bp.connect(skidG);
      const t0 = ctx.currentTime;
      o1.start(t0);
      o2.start(t0);
      noise.start(t0);
      let stopped = false;
      return {
        set: (rpm: number, skid: number, vol: number, pan = 0) => {
          if (stopped) return;
          const t = ctx.currentTime;
          const f = 46 + 120 * Math.max(0, Math.min(1.4, rpm));
          o1.frequency.setTargetAtTime(f, t, 0.05);
          o2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
          lp.frequency.setTargetAtTime(500 + 1600 * Math.min(1.4, rpm), t, 0.08);
          out.gain.setTargetAtTime(0.16 * vol, t, 0.05);
          skidG.gain.setTargetAtTime(0.09 * skid * vol, t, 0.04);
          if (panner) panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
        },
        stop: () => {
          if (stopped) return;
          stopped = true;
          const t = ctx.currentTime;
          out.gain.setTargetAtTime(0, t, 0.08);
          for (const n of [o1, o2, noise]) {
            try {
              n.stop(t + 0.5);
            } catch {
              /* already stopped */
            }
          }
          setTimeout(() => {
            try {
              out.disconnect();
              panner?.disconnect();
            } catch {
              /* gone */
            }
          }, 800);
        },
      };
    } catch (err) {
      warnOnce('engine', '[audio] engine voice failed:', err);
      return null;
    }
  }

  private playBuffer(buf: AudioBuffer, out: AudioNode, rate: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(out);
    src.start();
  }

  /* ---------------- voices ---------------- */

  say(text: string, opts: VoiceOptions = {}): Promise<void> {
    return this.speak('char', typeof text === 'string' ? text : String(text ?? ''), {
      lang: opts.lang || 'fr-FR',
      pitch: num(opts.pitch, 1),
      rate: num(opts.rate, 1),
      file: opts.file,
      deep: false,
    });
  }

  announcer(line: AnnouncerLine): Promise<void> {
    return this.speak('announcer', ANNOUNCER_TEXT[line] ?? '', {
      ...ANNOUNCER_VOICE,
      file: ANNOUNCER_FILES[line],
      deep: true,
    });
  }

  private speak(kind: SpeakerKind, text: string, v: VoiceSpec): Promise<void> {
    try {
      initSpeech();
      return this.voices.enqueue(kind, (job) => this.runVoice(job, text, v)).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  /** Play the line's file if possible, otherwise (or if it fails) use text-to-speech. */
  private async runVoice(job: VoiceJob, text: string, v: VoiceSpec): Promise<void> {
    if (v.file) {
      const played = await this.playVoiceFile(job, v.file);
      if (played || job.aborted) return;
    }
    if (job.aborted) return;
    const vol = this.volumes();
    await speakTTS(job, text, { lang: v.lang, pitch: v.pitch, rate: v.rate, volume: vol.master * vol.voice, deep: v.deep });
  }

  /** Resolves true when the file was played (or interrupted), false when it could not be played. */
  private async playVoiceFile(job: VoiceJob, url: string): Promise<boolean> {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus || ctx.state !== 'running') {
      const vol = this.volumes();
      return playAudioElement(job, url, vol.master * vol.voice);
    }
    const buf = await loadBuffer(ctx, url);
    if (!buf) return false;
    if (job.aborted) return true;
    return new Promise<boolean>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(bus.voice);
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        resolve(true);
      };
      const guard = setTimeout(finish, (buf.duration + 1) * 1000);
      src.onended = finish;
      job.abort = () => {
        try {
          src.stop();
        } catch {
          /* not started */
        }
        finish();
      };
      src.start();
    });
  }

  /* ---------------- volumes & ducking ---------------- */

  setVolumes(v: Partial<Volumes>): void {
    try {
      const cur = this.volumes();
      for (const k of VOLUME_KEYS) {
        const x = v?.[k];
        if (typeof x === 'number' && Number.isFinite(x)) cur[k] = clamp(x, 0, 1);
      }
      saveVolumes(cur);
      this.applyVolumes();
    } catch (err) {
      warnOnce('volumes', '[audio] setVolumes failed:', err);
    }
  }

  getVolumes(): Volumes {
    return { ...this.volumes() };
  }

  duck(on: boolean): void {
    this.manualDuck = !!on;
    this.applyDuck();
  }

  /** Lazily loaded from localStorage (not at import time). */
  private volumes(): Volumes {
    if (!this.vols) this.vols = loadVolumes();
    return this.vols;
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const v = this.volumes();
    const t = ctx.currentTime;
    glideParam(bus.master.gain, v.master, t, 0.015);
    glideParam(bus.music.gain, v.music, t, 0.015);
    glideParam(bus.sfx.gain, v.sfx, t, 0.015);
    glideParam(bus.voice.gain, v.voice, t, 0.015);
  }

  private applyDuck(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    try {
      const on = this.manualDuck || this.voiceBusy;
      const t = ctx.currentTime;
      // Duck fast, recover slowly.
      const tau = on ? 0.06 : 0.35;
      glideParam(bus.musicDuck.gain, on ? DUCK_MUSIC : 1, t, tau);
      glideParam(bus.sfxDuck.gain, on ? DUCK_SFX : 1, t, tau);
    } catch {
      /* ignore */
    }
  }
}

/** The game's single audio engine. */
export const audio: AudioEngine = new Engine();
