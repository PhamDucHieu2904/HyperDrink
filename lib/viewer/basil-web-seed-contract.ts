/** Runtime-generated material, backed by the source GLB's hydrated-seed metadata. */
export const BASIL_WEB_SEED_MATERIAL = 'basil-web-seed-gel';

export interface BasilWebSeedMetadata {
  formatVersion: number;
  count: number;
  nativeToGlbMatrix: number[];
  gelThicknessNative: number;
  seeds: { center: number[]; inverseX: number[]; inverseY: number[]; inverseZ: number[] }[];
}

export function isBasilWebSeedMetadata(value: unknown): value is BasilWebSeedMetadata {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<BasilWebSeedMetadata>;
  const vector = (values: unknown, length: number): values is number[] => Array.isArray(values) && values.length === length && values.every(value => typeof value === 'number' && Number.isFinite(value));
  return data.formatVersion === 1 && data.count === 330 && vector(data.nativeToGlbMatrix, 16) &&
    typeof data.gelThicknessNative === 'number' && Number.isFinite(data.gelThicknessNative) && data.gelThicknessNative > 0 &&
    Array.isArray(data.seeds) && data.seeds.length === data.count && data.seeds.every(seed =>
      seed && vector(seed.center, 3) && [seed.inverseX, seed.inverseY, seed.inverseZ].every(axis => vector(axis, 3) && Math.hypot(...axis) > 0));
}
