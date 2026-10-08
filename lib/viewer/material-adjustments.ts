import type { MeshStandardMaterial } from 'three';

/** Session edits change uniforms/UVs, never the imported model or texture files. */
export interface LiveMaterialValues {
  color?: string;
  metalness?: number;
  roughness?: number;
  textureOffsetX?: number;
}
export type LiveMaterialOverrides = Record<string, LiveMaterialValues>;

// Optical shaders keep the juice/scattering colors separate from surface tint.
// Weak ownership follows each pooled material without retaining retired labels.
export const liquidColorUpdates = new WeakMap<MeshStandardMaterial, (color: string) => void>();
