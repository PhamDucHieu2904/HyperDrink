import * as THREE from 'three';

/** Scene-owned sampler: pooled materials read it at draw time, never retaining
 * a render target after the user disables enhanced graphics. */
const sources = new WeakMap<THREE.Scene, THREE.Texture>();
export function setBottleBackdrop(scene: THREE.Scene, texture: THREE.Texture | null) {
  if (texture) sources.set(scene, texture); else sources.delete(scene);
}
export function createBottleBackdropUniforms() {
  return { bottleBackdrop: { value: null as THREE.Texture | null }, bottleBackdropEnabled: { value: 0 } };
}
export function updateBottleBackdropUniforms(uniforms: ReturnType<typeof createBottleBackdropUniforms>, scene: THREE.Scene) {
  uniforms.bottleBackdrop.value = sources.get(scene) ?? null;
  uniforms.bottleBackdropEnabled.value = uniforms.bottleBackdrop.value ? 1 : 0;
}
export const BOTTLE_BACKDROP_GLSL = /* glsl */`
uniform sampler2D bottleBackdrop;
uniform float bottleBackdropEnabled;
varying vec4 vBottleBackdropClip;
vec3 bottleBackdropAt(vec2 uv) {
  if (bottleBackdropEnabled < .5) return vec3(1.0);
  return texture2D(bottleBackdrop, clamp(uv, vec2(.001), vec2(.999))).rgb;
}
vec2 bottleBackdropUv() { return vBottleBackdropClip.xy / vBottleBackdropClip.w * .5 + .5; }
`;
export function addBottleBackdropProjection(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec4 vBottleBackdropClip;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvBottleBackdropClip = gl_Position;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${BOTTLE_BACKDROP_GLSL}`);
}

/** Retain native refraction of the bottle/gel and expose its projected exit UV.
 * The caller applies its own calibrated water absorption/scattering. */
export function trackBottleRefraction(source: string) {
  return 'vec2 bottleRefractionUv;\n' + source.replaceAll('refractionCoords /= 2.0;', 'refractionCoords /= 2.0;\n bottleRefractionUv = refractionCoords;');
}
