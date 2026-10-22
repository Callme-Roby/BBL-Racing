import * as THREE from 'three';
import { audio } from '../audio/audio';
import type { MusicId, SfxId } from '../audio/types';
import type { FighterDef } from '../data/roster';
import { loadFace } from '../render/faceTexture';
import { h } from '../ui/dom';

/**
 * Scripted cameras for the cut-scenes of BBL KART (circuit fly-over, podium…), in the spirit of
 * the BBL MAX cinematics of BBL FIGHTERZ: a list of shots, each one moving the camera from one
 * framing to another, with comic-book texts, a friend's voice line (subtitled with their
 * portrait), sound effects and music cues.
 */

export interface Framing {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov?: number;
}

export interface Shot {
  /** seconds */
  dur: number;
  from: Framing | (() => Framing);
  to?: Framing | (() => Framing);
  ease?: 'linear' | 'smooth' | 'out';
  /** comic-book text shown during the shot */
  text?: { content: string; style: 'boom' | 'punch' | 'caption'; color?: string; at?: [number, number] };
  /** a friend says a line (voice + subtitle with the portrait) */
  say?: { def: FighterDef; line: string };
  sfx?: SfxId;
  music?: MusicId;
  /** called when the shot starts (poses, confetti…) */
  onStart?: () => void;
}

const ease = (t: number, k: Shot['ease']) => (k === 'linear' ? t : k === 'out' ? 1 - (1 - t) * (1 - t) : t * t * (3 - 2 * t));

export class Cinematic {
  private i = -1;
  private t = 0;
  private from: Framing | null = null;
  private to: Framing | null = null;
  private overlay: HTMLElement;
  done = false;

  constructor(
    private shots: Shot[],
    layer: HTMLElement,
  ) {
    this.overlay = h('div', { class: 'cine-layer' });
    layer.append(this.overlay);
    this.next();
  }

  private next() {
    this.i++;
    this.t = 0;
    this.overlay.replaceChildren();
    const s = this.shots[this.i];
    if (!s) {
      this.done = true;
      return;
    }
    const resolve = (f: Shot['from'] | undefined) => (typeof f === 'function' ? f() : f);
    this.from = resolve(s.from) ?? null;
    this.to = resolve(s.to) ?? this.from;
    s.onStart?.();
    if (s.sfx) audio.sfx(s.sfx);
    if (s.music) audio.playMusic(s.music);
    if (s.text) {
      const el = h('div', { class: 'comic ' + s.text.style, style: s.text.color ? `--comic:${s.text.color}` : '' }, s.text.content);
      if (s.text.at) {
        el.style.left = s.text.at[0] * 100 + '%';
        el.style.top = s.text.at[1] * 100 + '%';
      } else if (s.text.style === 'boom') {
        el.style.left = '50%';
        el.style.top = '40%';
      }
      this.overlay.append(el);
    }
    if (s.say) {
      const { def, line } = s.say;
      const ph = h('div', { class: 'ph' });
      void loadFace(def).then((f) => (ph.style.backgroundImage = `url(${f.portraitUrl})`));
      this.overlay.append(h('div', { class: 'subtitle' }, ph, h('div', null, h('div', { class: 'who' }, def.name), h('div', { class: 'line' }, line))));
      void audio.say(line, def.voice ?? {});
    }
  }

  /** skip to the end */
  skip() {
    this.i = this.shots.length;
    this.overlay.replaceChildren();
    this.done = true;
  }

  /** Move `camera` for this frame; returns false once the cinematic is over. */
  update(dt: number, camera: THREE.PerspectiveCamera, aspect: number): boolean {
    if (this.done) return false;
    const s = this.shots[this.i];
    this.t += dt;
    const k = ease(Math.min(1, this.t / s.dur), s.ease);
    if (this.from && this.to) {
      camera.position.copy(this.from.pos).lerp(this.to.pos, k);
      const look = this.from.look.clone().lerp(this.to.look, k);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      const fov = (this.from.fov ?? 50) + ((this.to.fov ?? this.from.fov ?? 50) - (this.from.fov ?? 50)) * k;
      camera.fov = aspect < 1 ? fov * 1.35 : fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    if (this.t >= s.dur) this.next();
    return !this.done;
  }

  dispose() {
    this.overlay.remove();
  }
}
