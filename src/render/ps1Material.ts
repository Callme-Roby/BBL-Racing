import * as THREE from 'three';

/**
 * PS1-style material: Gouraud (per-vertex) lighting, vertex snapping to a
 * low-res grid ("wobbly" polygons), affine texture mapping, linear fog.
 * Works with Mesh, SkinnedMesh and InstancedMesh.
 */

/** Uniforms shared by every PS1 material (update once per frame / per stage). */
export const PS1Globals = {
  uSnapRes: { value: new THREE.Vector2(320, 180) },
  uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() },
  uLightColor: { value: new THREE.Color(1, 0.97, 0.9) },
  uAmbient: { value: new THREE.Color(0.42, 0.42, 0.5) },
  uFogColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
  uFogNear: { value: 30 },
  uFogFar: { value: 120 },
};

export interface PS1Options {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  /** 0 = fully lit, 1 = ignores lighting (sky, emissive signs...) */
  unlit?: number;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  fog?: boolean;
  /** vertex snapping (default true) */
  snap?: boolean;
  /** affine (non perspective-correct) texture mapping (default true) */
  affine?: boolean;
  /** uv repeat multiplier */
  uvScale?: [number, number];
  depthWrite?: boolean;
}

const VERT_COMMON = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec2 uSnapRes;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uUnlit;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSnap;
uniform vec2 uUvScale;
varying vec3 vLight;
varying vec3 vVColor;
varying float vFog;
varying vec3 vUvw;
`;

const VERT_BODY = /* glsl */ `
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3( position );
  #include <skinning_vertex>
  #ifdef USE_INSTANCING
    transformed = ( instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
    objectNormal = mat3( instanceMatrix ) * objectNormal;
  #endif
  vec4 worldPos = modelMatrix * vec4( transformed, 1.0 );
  vec4 mvPosition = viewMatrix * worldPos;
  vec4 clip = projectionMatrix * mvPosition;

  // PS1 vertex snapping: quantize NDC xy to the low-res pixel grid
  if ( uSnap > 0.5 && clip.w > 0.0 ) {
    vec2 ndc = clip.xy / clip.w;
    ndc = floor( ndc * uSnapRes + 0.5 ) / uSnapRes;
    clip.xy = ndc * clip.w;
  }
  gl_Position = clip;

  vec3 wN = normalize( mat3( modelMatrix ) * objectNormal );
  float diff = max( dot( wN, normalize( uLightDir ) ), 0.0 );
  vec3 lit = uAmbient + uLightColor * diff;
  vLight = mix( lit, vec3( 1.0 ), uUnlit );

  #ifdef USE_COLOR
    vVColor = color.rgb;
  #else
    vVColor = vec3( 1.0 );
  #endif

  float depth = -mvPosition.z;
  vFog = clamp( ( depth - uFogNear ) / max( uFogFar - uFogNear, 0.001 ), 0.0, 1.0 );

  // affine mapping trick: interpolate uv*w and w, divide in the fragment shader
  float w = AFFINE_ON ? clip.w : 1.0;
  vUvw = vec3( uv * uUvScale * w, w );
`;

const VERT = /* glsl */ `
${VERT_COMMON}
void main() {
${VERT_BODY}
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlphaTest;
uniform vec3 uFogColor;
uniform float uFogOn;
uniform float uFlash;
uniform vec3 uFlashColor;
#ifdef USE_MAP
uniform sampler2D map;
#endif
varying vec3 vLight;
varying vec3 vVColor;
varying float vFog;
varying vec3 vUvw;
void main() {
  vec4 base = vec4( uColor * vVColor, uOpacity );
  #ifdef USE_MAP
    vec2 uv = vUvw.xy / vUvw.z;
    vec4 tex = texture2D( map, uv );
    base *= tex;
  #endif
  if ( base.a < uAlphaTest ) discard;
  vec3 col = base.rgb * vLight;
  col = mix( col, uFlashColor, uFlash );
  col = mix( col, uFogColor, vFog * uFogOn );
  gl_FragColor = vec4( col, base.a );
}
`;

export type PS1Material = THREE.ShaderMaterial & {
  uniforms: {
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
    uFlash: { value: number };
    uFlashColor: { value: THREE.Color };
    [k: string]: THREE.IUniform;
  };
};

export function createPS1Material(opts: PS1Options = {}): PS1Material {
  const affine = opts.affine !== false;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...PS1Globals,
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uOpacity: { value: opts.opacity ?? 1 },
      uAlphaTest: { value: opts.alphaTest ?? 0 },
      uUnlit: { value: opts.unlit ?? 0 },
      uFogOn: { value: opts.fog === false ? 0 : 1 },
      uSnap: { value: opts.snap === false ? 0 : 1 },
      uUvScale: { value: new THREE.Vector2(...(opts.uvScale ?? [1, 1])) },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      map: { value: opts.map ?? null },
    },
    vertexShader: VERT.replace('AFFINE_ON', affine ? 'true' : 'false'),
    fragmentShader: FRAG,
    vertexColors: !!opts.vertexColors,
    transparent: !!opts.transparent,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  }) as PS1Material;
  if (opts.map) {
    mat.defines = { ...(mat.defines ?? {}), USE_MAP: '' };
    // keep "map" accessible for three.js internals that look for it
    (mat as unknown as { map: THREE.Texture }).map = opts.map;
  }
  return mat;
}

/* ------------------------------------------------------------------------ */
/* Face material: projects a photo onto the front of the head with a soft   */
/* elliptical mask that blends into the character's skin colour. The face   */
/* texture's outer band is already colour-matched to that skin tone         */
/* (faceTexture.ts), and the whole head uses exactly the body's Gouraud     */
/* lighting, so face, head, ears, neck and arms read as one skin.           */
/* ------------------------------------------------------------------------ */

const FACE_VERT = /* glsl */ `
${VERT_COMMON}
uniform vec4 uFaceRect; // center.xy, halfSize.xy in mesh (bind pose) space
varying vec2 vFaceUv;
varying float vFront;
void main() {
${VERT_BODY}
  vFaceUv = ( position.xy - uFaceRect.xy ) / ( uFaceRect.zw * 2.0 ) + 0.5;
  vFront = normal.z;
}
`;

const FACE_FRAG = /* glsl */ `
uniform vec3 uSkin;
uniform sampler2D uFaceMap;
uniform vec3 uFogColor;
uniform float uFogOn;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uFaceFrontMin;
varying vec3 vLight;
varying float vFog;
varying vec2 vFaceUv;
varying float vFront;
void main() {
  vec2 p = ( vFaceUv - 0.5 ) * 2.0;
  // same oval as faceTexture.ts (ovalAt): d = 1 on the edge
  float d = length( vec2( p.x * 1.02, p.y * 0.98 ) );
  float mask = 1.0 - smoothstep( 0.72, 1.0, d );
  mask *= smoothstep( uFaceFrontMin, uFaceFrontMin + 0.35, vFront );
  vec2 uv = clamp( vFaceUv, 0.0, 1.0 );
  vec3 photo = texture2D( uFaceMap, uv ).rgb;
  vec3 base = mix( uSkin, photo, mask );
  // exactly the body's lighting (no extra boost on the photo): no brightness step at the oval's edge
  vec3 col = base * vLight;
  col = mix( col, uFlashColor, uFlash );
  col = mix( col, uFogColor, vFog * uFogOn );
  gl_FragColor = vec4( col, 1.0 );
}
`;

export function createFaceMaterial(
  faceMap: THREE.Texture,
  skin: THREE.Color,
  faceRect: THREE.Vector4,
): PS1Material {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...PS1Globals,
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
      uUnlit: { value: 0 },
      uFogOn: { value: 1 },
      uSnap: { value: 1 },
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uSkin: { value: skin.clone() },
      uFaceMap: { value: faceMap },
      uFaceRect: { value: faceRect.clone() },
      uFaceFrontMin: { value: 0.05 },
    },
    vertexShader: FACE_VERT.replace('AFFINE_ON', 'false'),
    fragmentShader: FACE_FRAG,
  }) as PS1Material;
  return mat;
}

/** Nearest-filtered texture from a canvas (PS1 had no bilinear filtering on most games). */
export function pixelTexture(canvas: HTMLCanvasElement | OffscreenCanvas, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // everything stays in display (gamma) space, like the original hardware
  tex.colorSpace = THREE.NoColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

/** Helper: draw into a small canvas and get a pixel texture. */
export function makeCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = false,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  return pixelTexture(c, repeat);
}
