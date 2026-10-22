/**
 * speech.ts — character voices and the arcade announcer.
 *
 * - `VoiceQueue` serialises everything that "talks" (TTS or voice files), with
 *   two speaker kinds: a new character line cuts off the current character line,
 *   a new announcer line cuts off the current announcer line, and lines of
 *   different kinds wait their turn (e.g. "K.O.!" then the winner's quote).
 * - `speakTTS` wraps the Web Speech API with all the browser quirks handled:
 *   async voice loading, GC'd utterances, missing `end` events (timeout fallback).
 */

export type SpeakerKind = 'char' | 'announcer';

/** Handle given to a running voice job. `abort` is set by whoever plays it. */
export interface VoiceJob {
  readonly kind: SpeakerKind;
  aborted: boolean;
  abort: () => void;
}

interface QueuedJob extends VoiceJob {
  run: (job: VoiceJob) => Promise<void>;
  resolve: () => void;
  settled: boolean;
}

export class VoiceQueue {
  private active: QueuedJob | null = null;
  private waiting: QueuedJob[] = [];
  private readonly onBusy: (busy: boolean) => void;

  constructor(onBusy: (busy: boolean) => void) {
    this.onBusy = onBusy;
  }

  /** Queue a line. Resolves when it has been spoken, skipped or interrupted (never rejects). */
  enqueue(kind: SpeakerKind, run: (job: VoiceJob) => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const job: QueuedJob = { kind, run, resolve, settled: false, aborted: false, abort: () => {} };
      // A newer line replaces the not-yet-started lines of the same speaker...
      this.waiting = this.waiting.filter((w) => {
        if (w.kind !== kind) return true;
        this.settle(w);
        return false;
      });
      this.waiting.push(job);
      if (!this.active) this.next();
      // ...and cuts off the one currently talking.
      else if (this.active.kind === kind) this.interrupt(this.active);
    });
  }

  private interrupt(job: QueuedJob): void {
    job.aborted = true;
    try {
      job.abort();
    } catch {
      /* ignore */
    }
    this.complete(job);
  }

  private settle(job: QueuedJob): void {
    if (job.settled) return;
    job.settled = true;
    job.resolve();
  }

  private complete(job: QueuedJob): void {
    this.settle(job);
    if (this.active === job) {
      this.active = null;
      this.next();
    }
  }

  private next(): void {
    const job = this.waiting.shift();
    if (!job) {
      this.active = null;
      this.onBusy(false);
      return;
    }
    this.active = job;
    this.onBusy(true);
    let p: Promise<void>;
    try {
      p = job.run(job);
    } catch {
      p = Promise.resolve();
    }
    p.then(
      () => this.complete(job),
      () => this.complete(job),
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Web Speech API                                                            */
/* ------------------------------------------------------------------------ */

export function hasSpeech(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

let voices: SpeechSynthesisVoice[] = [];
let listening = false;
const picked = new Map<string, SpeechSynthesisVoice | null>();
/** Keeps utterances referenced until they finish (Chrome may GC them and drop `end`). */
const live = new Set<SpeechSynthesisUtterance>();
let lastCancel = -Infinity;

function refreshVoices(): void {
  try {
    voices = window.speechSynthesis.getVoices() ?? [];
  } catch {
    voices = [];
  }
  picked.clear();
}

/** Start listening for the (async) voice list. Safe to call many times. */
export function initSpeech(): void {
  if (listening || !hasSpeech()) return;
  listening = true;
  refreshVoices();
  const synth = window.speechSynthesis;
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoices);
  else synth.onvoiceschanged = refreshVoices;
}

/** Speak a silent utterance from a user gesture: unlocks speech on iOS/Safari. */
export function warmUpSpeech(): void {
  if (!hasSpeech()) return;
  initSpeech();
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

const MALE_HINT = /\b(male|man|daniel|david|alex|fred|guy|mark|george|james|arthur|ryan|thomas|aaron|oliver|eddy|reed|rocko|ralph|bruce|paul|henri|nicolas)\b/i;
const FEMALE_HINT = /\b(female|woman|samantha|victoria|zira|susan|karen|moira|tessa|fiona|kate|serena|aria|jenny|libby|sonia|hazel|amelie|amélie|audrey|marie|julie|denise|flo|sandy|shelley|grandma)\b/i;
/** macOS novelty voices: never what we want. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical)\b/i;

const normLang = (l: string): string => l.toLowerCase().replace(/_/g, '-');

/**
 * Best installed voice for a language: exact match first, then same language prefix.
 * `deep` favours male-sounding voice names (announcer).
 */
export function pickVoice(lang: string, deep: boolean): SpeechSynthesisVoice | null {
  if (!hasSpeech()) return null;
  if (!voices.length) refreshVoices();
  const key = `${lang}|${deep ? 'deep' : ''}`;
  const cached = picked.get(key);
  if (cached !== undefined) return cached;

  const want = normLang(lang);
  const prefix = want.split('-')[0];
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const vl = normLang(v.lang || '');
    let s: number;
    if (vl === want) s = 100;
    else if (vl.split('-')[0] === prefix) s = 60;
    else continue;
    if (v.localService) s += 4;
    if (v.default) s += 2;
    if (NOVELTY.test(v.name)) s -= 80;
    if (deep) {
      if (MALE_HINT.test(v.name)) s += 25;
      if (FEMALE_HINT.test(v.name)) s -= 15;
    }
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  // Don't cache a miss while the voice list is still loading.
  if (voices.length) picked.set(key, best);
  return best;
}

export interface TtsOptions {
  lang: string;
  pitch: number;
  rate: number;
  volume: number;
  /** prefer a deep/male voice */
  deep: boolean;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Play a voice file with a plain <audio> element (used when Web Audio is not
 * available/running). Resolves true once played (or aborted), false if it could
 * not be loaded/started (caller falls back to TTS).
 */
export function playAudioElement(job: VoiceJob, url: string, volume: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve(false);
      return;
    }
    let el: HTMLAudioElement;
    try {
      el = new Audio(url);
      el.volume = clamp(volume, 0, 1);
    } catch {
      resolve(false);
      return;
    }
    let started = false;
    let done = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      if (guard !== undefined) clearTimeout(guard);
      el.onended = null;
      el.onerror = null;
      if (!ok) console.warn(`[audio] could not play "${url}", falling back to speech synthesis.`);
      resolve(ok);
    };
    const arm = (ms: number): void => {
      if (guard !== undefined) clearTimeout(guard);
      guard = setTimeout(() => {
        el.pause();
        finish(started);
      }, ms);
    };
    el.onended = () => finish(true);
    el.onerror = () => finish(started);
    job.abort = () => {
      el.pause();
      finish(true);
    };
    arm(15000);
    el.play().then(
      () => {
        started = true;
        const d = el.duration;
        arm((Number.isFinite(d) && d > 0 ? d + 1 : 15) * 1000);
      },
      () => finish(false),
    );
  });
}

/**
 * Speak `text` with speechSynthesis. Resolves on `end`/`error`, on abort, or after a
 * timeout (~text.length * 80 ms + 800 ms) when the browser never fires events
 * (no voices installed, headless, etc.). Never rejects.
 */
export function speakTTS(job: VoiceJob, text: string, o: TtsOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!hasSpeech() || !text.trim() || job.aborted) {
      resolve();
      return;
    }
    initSpeech();
    const synth = window.speechSynthesis;
    const rate = clamp(o.rate, 0.1, 2);
    let u: SpeechSynthesisUtterance;
    try {
      u = new SpeechSynthesisUtterance(text);
      u.lang = o.lang;
      u.pitch = clamp(o.pitch, 0, 2);
      u.rate = rate;
      u.volume = clamp(o.volume, 0, 1);
      const v = pickVoice(o.lang, o.deep);
      if (v) u.voice = v;
    } catch {
      resolve();
      return;
    }

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      live.delete(u);
      resolve();
    };
    const arm = (ms: number): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(finish, ms);
    };
    const estimate = (text.length * 80) / rate + 800;

    u.onend = finish;
    u.onerror = finish;
    // Events do work: trust `end`, but keep a generous safety net (Chrome sometimes drops it).
    u.onstart = () => arm(estimate * 2.5 + 2000);
    live.add(u);

    job.abort = () => {
      lastCancel = nowMs();
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      finish();
    };

    const go = (): void => {
      if (done) return;
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch {
        finish();
      }
    };
    // Chrome drops a speak() issued right after cancel(): give it a beat.
    const justCancelled = nowMs() - lastCancel < 150;
    arm(estimate + (justCancelled ? 100 : 0));
    if (justCancelled) setTimeout(go, 90);
    else go();
  });
}
