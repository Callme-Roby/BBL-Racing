import * as THREE from 'three';
import { audio } from '../audio/audio';
import type { App, Screen } from '../app';
import { Cinematic, type Framing, type Shot } from '../game/cinematic';
import type { GrandPrix } from '../game/grandPrix';
import { input } from '../input/input';
import { CharacterView } from '../render/characterView';
import { Effects } from '../render/effects';
import { loadFace } from '../render/faceTexture';
import { createPS1Material } from '../render/ps1Material';
import { PS1Globals } from '../render/ps1Material';
import { getStage } from '../render/stages';
import type { StageEnv } from '../render/stages/types';
import { h, Menu, uiRoot } from '../ui/dom';
import { ordinal } from '../ui/raceHud';

/** Gold / silver / bronze trophy (a lathe cup on a base). */
function trophy(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = createPS1Material({ color, unlit: 0.25 });
  const prof = [
    [0.0, 0],
    [0.16, 0],
    [0.16, 0.05],
    [0.06, 0.08],
    [0.04, 0.22],
    [0.08, 0.26],
    [0.2, 0.32],
    [0.24, 0.5],
    [0.25, 0.62],
    [0.22, 0.62],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 10), mat));
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 4, 8, Math.PI), mat);
    handle.position.set(s * 0.25, 0.48, 0);
    handle.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(handle);
  }
  return g;
}

/**
 * The end of a grand prix: the top three on the podium in the arena of the last circuit
 * (the BBL FIGHTERZ stages), a scripted cinematic (third, second, first with the trophy),
 * their voices, confetti, then your result.
 */
export class PodiumScreen implements Screen {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.05, 600);
  private env: StageEnv;
  private views: CharacterView[] = [];
  private fx = new Effects();
  private cine: Cinematic | null = null;
  private menu: Menu | null = null;
  private time = 0;
  private cup: THREE.Group;
  private root!: HTMLElement;
  private clips: string[] = [];
  private confettiT = 0;

  constructor(
    private app: App,
    private gp: GrandPrix,
    private again: () => void,
    private quit: () => void,
  ) {
    const theme = gp.cup.tracks[gp.cup.tracks.length - 1].theme;
    this.env = getStage(theme === 'beach' ? 'hood' : theme).build();
    this.scene.add(this.env.group);
    this.scene.add(this.fx.group);
    // the podium blocks: 2nd (left), 1st (middle), 3rd (right)
    const blocks: [number, number, number][] = [
      [-1.6, 0.75, 0xc8ccd8],
      [0, 1.15, 0xffd23a],
      [1.6, 0.5, 0xd08a4a],
    ];
    for (const [x, hgt, col] of blocks) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, hgt, 1.4).translate(0, hgt / 2, 0), createPS1Material({ color: col }));
      m.position.set(x, 0, 0);
      this.scene.add(m);
    }
    this.cup = trophy(0xffd23a);
    this.cup.scale.setScalar(1.3);
    this.scene.add(this.cup);
  }

  enter() {
    audio.playMusic('victory', { loop: false });
    this.root = h('div', { class: 'podium-screen' });
    uiRoot().append(this.root);
    const gp = this.gp;
    const order = gp.standings();
    const top = order.slice(0, 3);
    // places: index 0 = 1st (middle, highest), 1 = 2nd (left), 2 = 3rd (right)
    const spots: [number, number][] = [
      [0, 1.15],
      [-1.6, 0.75],
      [1.6, 0.5],
    ];
    void Promise.all(top.map((ei) => loadFace(gp.entries[ei].def))).then((faces) => {
      top.forEach((ei, i) => {
        const v = new CharacterView(gp.entries[ei].def, faces[i]);
        v.addTo(this.scene);
        v.root.position.set(spots[i][0], spots[i][1], 0);
        v.model.body.rotation.y = i === 1 ? 0.25 : i === 2 ? -0.25 : 0;
        v.model.body.scale.setScalar(gp.entries[ei].def.height ?? 1);
        v.shadow.position.set(spots[i][0], spots[i][1] + 0.01, 0);
        this.views[i] = v;
        this.clips[i] = 'stance';
      });
      this.startCine(top);
    });
  }

  private startCine(top: number[]) {
    const gp = this.gp;
    const head = (i: number): THREE.Vector3 => this.views[i]?.headWorld().clone() ?? new THREE.Vector3(0, 2, 0);
    const close = (i: number, side: number): (() => Framing) => () => {
      const p = head(i);
      return { pos: p.clone().add(new THREE.Vector3(side * 0.6, 0.1, 2.2)), look: p.clone().add(new THREE.Vector3(0, -0.15, 0)), fov: 40 };
    };
    const closer = (i: number, side: number): (() => Framing) => () => {
      const p = head(i);
      return { pos: p.clone().add(new THREE.Vector3(side * 0.3, 0.05, 1.6)), look: p.clone().add(new THREE.Vector3(0, -0.1, 0)), fov: 40 };
    };
    const wide = (d: number): Framing => ({ pos: new THREE.Vector3(0, 2.2, d), look: new THREE.Vector3(0, 1.4, 0), fov: 45 });
    const line = (ei: number) => {
      const d = gp.entries[ei].def;
      return d.winLines[Math.floor(Math.random() * d.winLines.length)] ?? 'Trop facile.';
    };
    const shots: Shot[] = [
      { dur: 3, from: wide(11), to: wide(7.5), text: { content: gp.cup.name, style: 'caption' }, sfx: 'crowdOoh' },
    ];
    if (top[2] !== undefined)
      shots.push({
        dur: 3,
        from: close(2, -1),
        to: closer(2, -1),
        text: { content: '3e', style: 'boom', color: '#e8a060', at: [0.25, 0.3] },
        say: { def: gp.entries[top[2]].def, line: line(top[2]) },
        onStart: () => (this.clips[2] = 'win2'),
      });
    if (top[1] !== undefined)
      shots.push({
        dur: 3,
        from: close(1, 1),
        to: closer(1, 1),
        text: { content: '2e', style: 'boom', color: '#dfe6f0', at: [0.75, 0.3] },
        say: { def: gp.entries[top[1]].def, line: line(top[1]) },
        onStart: () => (this.clips[1] = 'win1'),
      });
    shots.push({
      dur: 4.5,
      from: close(0, 0),
      to: () => ({ ...closer(0, 0)(), pos: head(0).add(new THREE.Vector3(0, 0.5, 2.6)) }),
      text: { content: '1er !', style: 'boom', color: '#ffe04a', at: [0.5, 0.25] },
      say: { def: gp.entries[top[0]].def, line: line(top[0]) },
      sfx: 'shine',
      onStart: () => {
        this.clips[0] = 'win0';
        this.confettiT = 6;
      },
    });
    const humans = gp.entries.map((e, i) => ({ e, i })).filter((x) => x.e.local !== undefined);
    const mine = humans.map(({ e, i }) => `${e.name ?? e.def.name} : ${ordinal(order0(gp).indexOf(i) + 1)} · ${e.points} PTS`).join('   ');
    shots.push({ dur: 3, from: wide(7.5), to: wide(9), text: { content: mine || 'BRAVO !', style: 'caption' } });
    this.cine = new Cinematic(shots, this.root);
    function order0(g: GrandPrix) {
      return g.standings();
    }
  }

  private showMenu() {
    if (this.menu) return;
    const gp = this.gp;
    const order = gp.standings();
    const me = gp.entries.findIndex((e) => e.local === 0);
    const pos = order.indexOf(me) + 1;
    this.menu = new Menu(
      [
        { label: 'REJOUER LA COUPE', action: () => this.again() },
        { label: 'MENU', action: () => this.quit() },
      ],
      () => audio.sfx('cursor'),
    );
    this.root.append(
      h(
        'div',
        { class: 'podium-ui' },
        h('div', { class: 'h1' }, pos === 1 ? 'TU GAGNES LA COUPE !' : pos <= 3 ? `TU FINIS ${ordinal(pos)} !` : `TU FINIS ${ordinal(pos)}…`),
        this.menu.el,
      ),
    );
  }

  exit() {
    this.cine?.dispose();
    for (const v of this.views) v.dispose();
    this.fx.dispose();
    this.env.dispose();
  }

  frame(dt: number) {
    this.time += dt;
    for (const e of input.menuEvents()) {
      if (this.menu) {
        if (e.action === 'up') this.menu.move(-1);
        else if (e.action === 'down') this.menu.move(1);
        else if (e.action === 'confirm' || e.action === 'start') {
          audio.sfx('confirm');
          this.menu.activate();
          return;
        }
      } else if (e.action === 'confirm' || e.action === 'start' || e.action === 'back') this.cine?.skip();
    }
    this.views.forEach((v, i) => v?.pose(this.clips[i] ?? 'stance', this.time * 60, dt * 60, this.clips[i]));
    // the trophy over the winner's head
    if (this.views[0]) {
      const p = this.views[0].headWorld().clone();
      this.cup.position.copy(p).add(new THREE.Vector3(0, this.clips[0] === 'win0' ? 0.35 : 3, 0));
      this.cup.rotation.y += dt;
    }
    if (this.confettiT > 0) {
      this.confettiT -= dt;
      if (Math.random() < dt * 8) this.fx.confetti(new THREE.Vector3(0, 3.5, 0), 12, 3);
    }
    this.fx.update(dt * 60);
    this.env.update(this.time, dt);
    const e = this.env;
    PS1Globals.uLightDir.value.copy(e.lightDir);
    PS1Globals.uLightColor.value.copy(e.lightColor);
    PS1Globals.uAmbient.value.copy(e.ambient);
    PS1Globals.uFogColor.value.copy(e.fogColor);
    PS1Globals.uFogNear.value = e.fogNear;
    PS1Globals.uFogFar.value = e.fogFar;
    if (this.cine && !this.cine.update(dt, this.camera, this.app.aspect)) {
      this.showMenu();
      // slow orbit behind the menu
      const a = this.time * 0.15;
      this.camera.position.set(Math.sin(a) * 8, 2.4, Math.cos(a) * 8 + 1);
      this.camera.lookAt(0, 1.4, 0);
      this.camera.fov = this.app.aspect < 1 ? 62 : 45;
      this.camera.aspect = this.app.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.app.pipeline.render(this.scene, this.camera, e.clearColor);
  }
}
