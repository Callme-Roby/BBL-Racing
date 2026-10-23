import * as THREE from 'three';
import { PS1Globals } from './ps1Material';

/**
 * Low-resolution render target + "PS1 output" post pass:
 * nearest upscale, 15-bit colour with ordered dithering, light scanlines.
 *
 * Also draws the "hit feel" overlays of the fight (see FightWorld):
 *  - impact frames (DBFZ style): for 1-2 frames the picture becomes a flat
 *    high-contrast drawing, the characters (found in the depth buffer: anything
 *    standing on the fight lane z ≈ 0, above the floor) as ink silhouettes on a
 *    paper background (`uImpactMode` 1), or bright shapes on black (mode 2),
 *    with a jagged starburst behind them at the impact point;
 *  - radial speed lines converging on the impact point (`uLines`).
 */
export class RetroPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private rt: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;
  lowW = 480;
  lowH = 270;
  /** number of vertical pixels of the internal image (set from the settings) */
  lines = 480;
  dither = true;

  constructor(canvas: HTMLCanvasElement) {
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = true;
    this.rt = new THREE.WebGLRenderTarget(this.lowW, this.lowH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      // read by the impact frames (silhouettes of the fighters)
      depthTexture: new THREE.DepthTexture(this.lowW, this.lowH),
    });
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uLow: { value: new THREE.Vector2(this.lowW, this.lowH) },
        uDither: { value: 1 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uFade: { value: 0 },
        tDepth: { value: this.rt.depthTexture },
        uInvVP: { value: new THREE.Matrix4() },
        uImpactMode: { value: 0 },
        uImpactTint: { value: new THREE.Color(1, 0.2, 0.1) },
        uImpactCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uImpactSeed: { value: 0 },
        uLines: { value: 0 },
        uLinesCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uLinesSeed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uLow;
        uniform float uDither;
        uniform float uFlash;
        uniform vec3 uFlashColor;
        uniform float uFade;
        uniform sampler2D tDepth;
        uniform mat4 uInvVP;
        uniform float uImpactMode;
        uniform vec3 uImpactTint;
        uniform vec2 uImpactCenter;
        uniform float uImpactSeed;
        uniform float uLines;
        uniform vec2 uLinesCenter;
        uniform float uLinesSeed;
        varying vec2 vUv;
        float hash1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
        // manga speed lines converging on c: 0..1 coverage of this pixel
        float speedLines(vec2 uv, vec2 c, float seed, float strength) {
          vec2 d = (uv - c) * vec2(uLow.x / uLow.y, 1.0);
          float r = length(d);
          float a = atan(d.y, d.x) / 6.2831853 + 0.5;
          float cells = 72.0;
          float k = a * cells;
          float id = floor(k);
          float h = hash1(id + seed * 17.0);
          float h2 = hash1(id * 3.7 + seed * 5.0);
          // only some cells carry a line; thin wedges that start at a random radius
          float on = step(0.42, h2);
          float w = 0.12 + 0.3 * h;
          float edge = abs(fract(k) - 0.5) * 2.0;
          float wedge = step(edge, w * smoothstep(0.0, 1.2, r));
          float r0 = mix(0.36, 0.85, h) * (1.25 - 0.45 * strength);
          return on * wedge * smoothstep(r0, r0 + 0.12, r);
        }
        // 4x4 ordered dither threshold, computed (no array / loop: cheap on phone GPUs)
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 p) { return bayer2(0.5 * p) * 0.25 + bayer2(p); }
        void main() {
          vec2 px = floor(vUv * uLow);
          vec3 c = texture2D(tDiffuse, (px + 0.5) / uLow).rgb;
          if (uDither > 0.5) {
            float d = (bayer4(px) - 0.5) / 32.0;
            c = floor((c + d) * 32.0 + 0.5) / 32.0;
          }
          vec2 uvp = (px + 0.5) / uLow;
          if (uImpactMode > 0.5) {
            // impact frame: characters (on the fight lane, above the floor) vs everything else
            float dz = texture2D(tDepth, uvp).r;
            vec4 wp = uInvVP * vec4(uvp * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0);
            wp /= wp.w;
            float fg = (dz < 0.99999 && abs(wp.z) < 1.1 && wp.y > 0.03) ? 1.0 : 0.0;
            float lum = dot(c, vec3(0.299, 0.587, 0.114));
            // jagged starburst behind the characters
            vec2 sd = (uvp - uImpactCenter) * vec2(uLow.x / uLow.y, 1.0);
            float sr = length(sd);
            float sa = atan(sd.y, sd.x);
            float spikes = 0.5 + 0.5 * cos(sa * 9.0 + uImpactSeed * 6.0);
            spikes = pow(spikes, 3.0) + 0.35 * pow(0.5 + 0.5 * cos(sa * 23.0 + uImpactSeed * 11.0), 6.0);
            float star = step(sr, 0.08 + 0.32 * spikes);
            float lines = speedLines(uvp, uImpactCenter, uImpactSeed, 1.0);
            vec3 ink = vec3(0.05, 0.04, 0.07);
            vec3 paper = vec3(0.98, 0.95, 0.88);
            if (uImpactMode < 1.5) {
              // flat ink silhouettes on paper
              vec3 bg = mix(paper, uImpactTint, star * 0.85);
              bg = mix(bg, ink, lines * (1.0 - star) * 0.9);
              vec3 fgc = ink;
              c = mix(bg, fgc, fg);
            } else {
              // negative: bright, posterized characters on black
              vec3 bg = mix(ink, uImpactTint * 0.9, star);
              bg = mix(bg, paper, lines * (1.0 - star) * 0.75);
              vec3 fgc = mix(uImpactTint, paper, step(0.32, lum));
              c = mix(bg, fgc, fg);
            }
          } else {
            if (uLines > 0.001) {
              float l = speedLines(uvp, uLinesCenter, uLinesSeed, uLines);
              c = mix(c, vec3(1.0), l * uLines * 0.7);
            }
            // (an impact frame is its own flash: it stays crisp)
            c = mix(c, uFlashColor, uFlash);
          }
          c *= 1.0 - uFade;
          // subtle scanline darkening on odd low-res rows
          float scan = mod(px.y, 2.0) < 1.0 ? 1.0 : 0.94;
          gl_FragColor = vec4(c * scan, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  get post() {
    return this.postMat.uniforms as {
      uFlash: { value: number };
      uFlashColor: { value: THREE.Color };
      uFade: { value: number };
      uDither: { value: number };
      /** 0 = off, 1 = ink silhouettes on paper, 2 = negative (bright on black) */
      uImpactMode: { value: number };
      uImpactTint: { value: THREE.Color };
      /** screen uv (0..1, origin bottom-left) of the impact */
      uImpactCenter: { value: THREE.Vector2 };
      uImpactSeed: { value: number };
      /** speed lines strength (0 = none) */
      uLines: { value: number };
      uLinesCenter: { value: THREE.Vector2 };
      uLinesSeed: { value: number };
    };
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    const lowH = this.lines;
    const lowW = Math.max(160, Math.round((lowH * w) / Math.max(1, h)));
    if (lowW !== this.lowW || lowH !== this.lowH) {
      this.lowW = lowW;
      this.lowH = lowH;
      this.rt.setSize(lowW, lowH);
      (this.postMat.uniforms.uLow.value as THREE.Vector2).set(lowW, lowH);
    }
    PS1Globals.uSnapRes.value.set(this.lowW / 2, this.lowH / 2);
  }

  /**
   * Split screen: every view is drawn into its own rectangle of the low-res image
   * (x, y, w, h in 0..1, origin bottom-left), then the PS1 pass runs once on the whole image.
   */
  renderViews(scene: THREE.Scene, views: { camera: THREE.Camera; x: number; y: number; w: number; h: number; before?: () => void }[], clearColor: THREE.Color) {
    this.postMat.uniforms.uDither.value = this.dither ? 1 : 0;
    const r = this.renderer;
    r.setClearColor(clearColor, 1);
    this.rt.scissorTest = false;
    this.rt.viewport.set(0, 0, this.lowW, this.lowH);
    r.setRenderTarget(this.rt);
    r.clear();
    // each view only touches its own rectangle (the target's scissor), nothing clears in between
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.rt.scissorTest = true;
    for (const v of views) {
      const x = Math.round(v.x * this.lowW);
      const y = Math.round(v.y * this.lowH);
      const w = Math.round((v.x + v.w) * this.lowW) - x;
      const h = Math.round((v.y + v.h) * this.lowH) - y;
      this.rt.viewport.set(x, y, w, h);
      this.rt.scissor.set(x, y, w, h);
      // vertex snapping on this view's own pixel grid
      PS1Globals.uSnapRes.value.set(w / 2, h / 2);
      v.before?.();
      r.setRenderTarget(this.rt);
      // the clear colour behind this view (sky gaps), then the depth of this rectangle only
      r.clearDepth();
      r.render(scene, v.camera);
    }
    r.autoClear = autoClear;
    this.rt.scissorTest = false;
    this.rt.viewport.set(0, 0, this.lowW, this.lowH);
    this.rt.scissor.set(0, 0, this.lowW, this.lowH);
    PS1Globals.uSnapRes.value.set(this.lowW / 2, this.lowH / 2);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, clearColor: THREE.Color) {
    this.postMat.uniforms.uDither.value = this.dither ? 1 : 0;
    this.renderer.setClearColor(clearColor, 1);
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    if (this.postMat.uniforms.uImpactMode.value > 0.5) {
      // world position of each pixel (impact-frame silhouettes): inverse view-projection
      // (the camera's matrices are up to date once the scene has been rendered)
      (this.postMat.uniforms.uInvVP.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  /**
   * Compiles the shaders of everything in `scene` (hidden objects included) for
   * the low-res target and uploads its textures, so that the first frame showing
   * something new does not stall.
   */
  async prewarm(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    const r = this.renderer;
    // same render target as the real frames: same shader variants
    r.setRenderTarget(this.rt);
    let ready: Promise<unknown>;
    try {
      ready = r.compileAsync(scene, camera);
    } finally {
      r.setRenderTarget(null);
    }
    await ready;
    const textures = new Set<THREE.Texture>();
    const tex = (v: unknown) => {
      if (v && (v as THREE.Texture).isTexture && !(v as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) textures.add(v as THREE.Texture);
    };
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        // without KHR_parallel_shader_compile the driver links a program on its first use: now
        (r.properties.get(mat) as { currentProgram?: { getUniforms(): unknown } }).currentProgram?.getUniforms();
        for (const v of Object.values(mat)) tex(v);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) tex(x?.value);
      }
    });
    for (const t of textures) r.initTexture(t);
  }

  /** Render directly at low res into an offscreen canvas (thumbnails). */
  snapshot(scene: THREE.Scene, camera: THREE.Camera, clearColor: THREE.Color, w: number, h: number): string {
    const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const prevSnap = PS1Globals.uSnapRes.value.clone();
    PS1Globals.uSnapRes.value.set(w / 2, h / 2);
    this.renderer.setClearColor(clearColor, 1);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    PS1Globals.uSnapRes.value.copy(prevSnap);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  dispose() {
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.postMat.dispose();
    this.renderer.dispose();
  }
}
