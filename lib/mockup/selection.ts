import type { ProductAppearance, ProductAsset } from '../viewer-config';

export function mockupModelKey(asset: ProductAsset): string {
  return JSON.stringify([asset.id, asset.src, asset.orientation, asset.materialSlots, asset.textureSamplers]);
}

/** Same stable scene signature is checked by React and the committed runtime. */
export function mockupSelectionKey(asset: ProductAsset, appearance?: ProductAppearance, frontYaw = 0): string {
  return JSON.stringify([mockupModelKey(asset), appearance ?? null, Number.isFinite(frontYaw) ? frontYaw : 0]);
}
