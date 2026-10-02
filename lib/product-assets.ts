import type { ProductAsset } from './viewer-config';
import manifest from '@/public/models/cans/assets.manifest.json';

/** Model geometry is shared across flavor appearances; IDs never depend on display names. */
export const canAssets: ProductAsset[] = manifest.assets.map(asset => ({
  id: asset.id,
  name: `Lon ${asset.label}${asset.id === 'can-250-short' ? ' thấp' : ''}`,
  volumeMl: asset.volumeMl,
  src: `${asset.src}?v=${asset.sha256.slice(0, 12)}`,
  packaging: 'can',
  materialSlots: asset.materialSlots,
  textureSamplers: { label: { wrapS: asset.labelUv.wrapS === 'repeat' ? 'repeat' : 'clamp', wrapT: 'clamp' } },
}));
