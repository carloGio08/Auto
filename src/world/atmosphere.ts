import {
  Color,
  Material,
  ShaderChunk,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { config } from '../config';

/**
 * Atmosphere shared by every fogged material (one set of uniform objects, updated once per
 * frame):
 * - aerial perspective: with distance colours lighten, lose saturation and shift towards the
 *   horizon colour of the sky (exponential, so overlapping ridges get distinct tone steps and
 *   nothing ever ends on a hard band);
 * - height fog: denser low down, thinning with altitude, integrated analytically along the
 *   view ray (valleys fill with haze, crests stay clear).
 */
export const atmosphereUniforms = {
  uHazeColor: { value: new Color('#b8cbe0') },
  /** Distance (m) at which the haze reaches 63 %. */
  uHazeDistance: { value: 9000 },
  /** Maximum strength of the haze (0..1) and desaturation at full haze. */
  uHazeStrength: { value: 0.92 },
  uHazeDesaturate: { value: 0.2 },
  /**
   * Visibility fog: everything fades into the horizon colour of the sky with distance,
   * 1 - exp(-(d / V)²) (63 % at V, 95 % at 1.7 V). 0 switches it off.
   */
  uFogVisibility: { value: 650 },
  /** Distance (m) where the visibility fog starts: the foreground and middle stay crisp. */
  uFogStart: { value: 300 },
  /**
   * Height (m) over which the visibility fog thins above the camera: high snowy peaks show
   * through it while distant valleys and low ground fade out.
   */
  uFogHeight: { value: 450 },
  /** Height fog: colour, base altitude, density (1/m at the base) and falloff height (m). */
  uFogLowColor: { value: new Color('#d9e2ea') },
  uFogBase: { value: 0 },
  uFogDensity: { value: 0.00025 },
  uFogFalloff: { value: 180 },
  /** World camera position (set every frame). */
  uAtmoCamera: { value: new Vector3() },
};

let installed = false;

/** Adds the shared atmosphere uniforms to a shader being compiled. */
export function applyAtmosphere(shader: WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, atmosphereUniforms);
}

/**
 * Replaces three.js' fog chunks with the atmosphere above, once. Every material that has
 * `fog: true` (the default) and lives in a scene with a `Fog` gets it; materials with their
 * own `onBeforeCompile` call `applyAtmosphere()` themselves.
 */
export function installAtmosphere(): void {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying vec3 vFogWorld;
#endif`;
  ShaderChunk.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vec4 fogWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
fogWorld = instanceMatrix * fogWorld;
#endif
fogWorld = modelMatrix * fogWorld;
vFogWorld = fogWorld.xyz;
#endif`;
  ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
varying vec3 vFogWorld;
uniform vec3 uHazeColor;
uniform float uHazeDistance;
uniform float uHazeStrength;
uniform float uHazeDesaturate;
uniform float uFogVisibility;
uniform float uFogStart;
uniform float uFogHeight;
uniform vec3 uFogLowColor;
uniform float uFogBase;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform vec3 uAtmoCamera;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG
if ( uHazeDistance > 0.0 ) {
  vec3 ray = vFogWorld - uAtmoCamera;
  float dist = length( ray );
  // Height fog: density d(h) = D · exp(-(h - base) / F), integrated along the ray.
  float h0 = ( uAtmoCamera.y - uFogBase ) / uFogFalloff;
  float h1 = ( vFogWorld.y - uFogBase ) / uFogFalloff;
  float dh = h1 - h0;
  float e0 = exp( - clamp( h0, -4.0, 40.0 ) );
  float e1 = exp( - clamp( h1, -4.0, 40.0 ) );
  float column = abs( dh ) > 1e-3 ? ( e0 - e1 ) / dh : e0;
  float fogLow = 1.0 - exp( - uFogDensity * dist * max( column, 0.0 ) );
  // Aerial perspective: lighter, greyer, bluer with distance.
  float haze = ( 1.0 - exp( - dist / uHazeDistance ) ) * uHazeStrength;
  vec3 col = gl_FragColor.rgb;
  float lum = dot( col, vec3( 0.3, 0.59, 0.11 ) );
  col = mix( col, vec3( lum ), haze * uHazeDesaturate );
  col = mix( col, uHazeColor, haze );
  col = mix( col, uFogLowColor, clamp( fogLow, 0.0, 0.95 ) );
  if ( uFogVisibility > 0.0 ) {
    float v = max( dist - uFogStart, 0.0 ) / uFogVisibility;
    float above = max( vFogWorld.y - uAtmoCamera.y - 60.0, 0.0 ) / uFogHeight;
    col = mix( col, uHazeColor, ( 1.0 - exp( - v * v ) ) * exp( - above ) );
  }
  gl_FragColor.rgb = col;
} else {
#ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
#else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
#endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}
#endif`;
  // Colour grade after the ACES tone mapping: a little more saturation and contrast (around
  // mid grey) for a vibrant, punchy look. Constants, so materials need no extra uniforms.
  const g = config.graphics.grade;
  const f = (v: number): string => v.toFixed(4);
  ShaderChunk.tonemapping_fragment = `#if defined( TONE_MAPPING )
gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
{
  vec3 c = max( gl_FragColor.rgb, vec3( 0.0 ) );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = max( mix( vec3( l ), c, ${f(g.saturation)} ), vec3( 0.0 ) );
  c = 0.18 * pow( c / 0.18 + 1e-5, vec3( ${f(g.contrast)} ) );
  gl_FragColor.rgb = clamp( c, 0.0, 1.0 );
}
#endif`;
  // Default hook: every material without its own onBeforeCompile gets the uniforms.
  Material.prototype.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms) {
    applyAtmosphere(shader);
  };
}

/**
 * Visibility of the clouds: they live in the sky, far past the ground fog, so they get a much
 * longer visibility (they still melt into the horizon low down).
 */
export const cloudFogVisibility = { value: 2600 };

/** Atmosphere for the clouds: the shared uniforms with their own, longer visibility. */
export function applyCloudAtmosphere(shader: WebGLProgramParametersWithUniforms): void {
  applyAtmosphere(shader);
  shader.uniforms.uFogVisibility = cloudFogVisibility;
}

/** Atmosphere settings of a world: colours from the sky and time of day, weather density. */
export function setAtmosphere(o: {
  haze: Color;
  low: Color;
  hazeDistance: number;
  /** Visibility fog distance V (m), 0 = off, and start distance (m). */
  visibility: number;
  start: number;
  base: number;
  density: number;
  falloff: number;
}): void {
  const u = atmosphereUniforms;
  // three.js applies fog after the output colour space conversion: the fog colours are given
  // in sRGB so fogged objects end exactly on the sky's horizon colour.
  u.uHazeColor.value.copy(o.haze).convertLinearToSRGB();
  u.uFogLowColor.value.copy(o.low).convertLinearToSRGB();
  u.uHazeDistance.value = o.hazeDistance;
  u.uFogVisibility.value = o.visibility;
  u.uFogStart.value = o.start;
  cloudFogVisibility.value = o.visibility * 5;
  u.uFogBase.value = o.base;
  u.uFogDensity.value = o.density;
  u.uFogFalloff.value = o.falloff;
}
