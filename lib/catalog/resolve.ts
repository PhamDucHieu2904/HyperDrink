import type { CatalogData, Display3D, Flavor, MediaAsset, ProductVariant } from './contracts';
import type { ProductAsset, ProductAppearance } from '@/lib/viewer-config';
import { DEFAULT_PRODUCT_ACCENT_SCENE, type ProductAccentScene } from '@/lib/viewer/accent-config';
import { publicUrl } from '@/lib/public-url';
import { isImageMedia } from './media-roles';
export { resolveFlavorFruitImage } from './flavor-media';

export function mediaUrl(media: MediaAsset | string | null | undefined): string {
  const url = typeof media === 'string' ? media : media?.url || '';
  if (url.startsWith('/api/')) {
    const api = (process.env.NEXT_PUBLIC_ADMIN_API_URL || '').replace(/\/$/, '');
    return api ? `${api}${url}` : publicUrl(url);
  }
  return publicUrl(url);
}

export function resolveFlavorIcon(data: CatalogData, flavor: Pick<Flavor, 'iconId'>): MediaAsset | undefined {
  return data.media.find(item => item.id === flavor.iconId && item.role === 'icon' && item.lifecycle === 'active' && item.status === 'ready' && isImageMedia(item) && !!item.url);
}

function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const letter of seed) state = Math.imul(state ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => { state += 0x6D2B79F5; let next = state; next = Math.imul(next ^ next >>> 15, next | 1); next ^= next + Math.imul(next ^ next >>> 7, next | 61); return ((next ^ next >>> 14) >>> 0) / 4294967296; };
}

export function resolveFlavorScene(data: CatalogData, flavor: Flavor, seed: string): ProductAccentScene {
  const random = seeded(seed);
  const pools = new Map<string, MediaAsset[]>();
  for (const role of ['fruit', 'leaf', 'splash']) {
    const ids=new Set<string>();
    const pool = data.flavorAssets.filter(item => item.flavorId === flavor.id && item.role === role && item.enabled && item.lifecycle === 'active').sort((a, b) => a.position - b.position).map(item => data.media.find(asset => asset.id === item.mediaId)).filter((asset): asset is MediaAsset => {
      if(!asset||asset.status!=='ready'||asset.lifecycle!=='active'||asset.role!==role||ids.has(asset.id))return false;
      ids.add(asset.id);return true;
    });
    for (let index = pool.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [pool[index], pool[target]] = [pool[target], pool[index]]; }
    pools.set(role, pool);
  }
  const counters = new Map<string, number>();
  const nodes = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.flatMap(node => {
    const clean = { ...node, variants: undefined };
    if (!['fruit', 'leaf', 'splash'].includes(node.kind)) return [clean];
    const pool = pools.get(node.kind) || [];
    if (!pool.length) {
      // Water is a shared scene preset, unlike flavor-specific fruit/leaf artwork.
      // Retain its approved asset and complete transform when no flavor splash is assigned.
      // The template's enabled/opacity settings still control explicit suppression.
      return node.kind === 'splash' && node.id === 'water-splash-back' && node.assetUrl
        ? [{ ...clean, assetUrl: mediaUrl(node.assetUrl) }]
        : [];
    }
    const index = counters.get(node.kind) || 0;
    counters.set(node.kind, index + 1);
    const chosen = pool[index % pool.length];
    return [{ ...clean, assetUrl: mediaUrl(chosen), imageBounds: chosen.imageBounds || undefined, color: '#ffffff', tint: undefined }];
  });
  return { ...DEFAULT_PRODUCT_ACCENT_SCENE, nodes };
}

/** A “change set” action should not appear inert when a small pool draws the same set again. */
export function nextFlavorPreviewSeed(data: CatalogData, flavor: Flavor, seed: number, displayId: string): number {
  const signature = (value: number) => resolveFlavorScene(data, flavor, `preview-${value}:${displayId}:${flavor.id}`).nodes
    .filter(node => ['fruit', 'leaf', 'splash'].includes(node.kind)).map(node => `${node.id}:${node.assetUrl}`).join('|');
  const current = signature(seed);
  for (let next = seed + 1; next <= seed + 32; next++) if (signature(next) !== current) return next;
  return seed + 1;
}

export function resolveDisplay3D(data: CatalogData, display: Display3D, seed = 'preview'): { asset: ProductAsset; appearance: ProductAppearance; accentScene: ProductAccentScene; flavor: Flavor; variant: ProductVariant } | null {
  const variant = data.productVariants.find(item => item.id === display.productVariantId);
  const model = data.models3d.find(item => item.id === display.modelId);
  const flavor = data.flavors.find(item => item.id === variant?.flavorId);
  const packaging = data.packagingVariants.find(item => item.id === variant?.packagingVariantId);
  const category = data.packagingCategories.find(item => item.id === packaging?.categoryId);
  const modelMedia = data.media.find(item => item.id === model?.mediaId);
  const label = data.labels.find(item => item.id === display.labelId);
  const labelMedia = data.media.find(item => item.id === label?.mediaId);
  if (!variant || !model || !flavor || !packaging || !modelMedia || !labelMedia || modelMedia.status!=='ready'||labelMedia.status!=='ready'||modelMedia.lifecycle!=='active'||labelMedia.lifecycle!=='active'||modelMedia.role!=='model'||labelMedia.role!=='label') return null;
  const kind = category?.viewerKind || 'other';
  return {
    variant, flavor,
    asset: { id: model.id, name: model.name, src: mediaUrl(modelMedia), packaging: kind === 'pp' ? 'other' : kind, volumeMl: packaging.volumeMl || undefined, materialSlots: model.materialSlots, textureSamplers: model.layoutProfile === 'can-wrap-v1' ? { label: { wrapS: 'repeat', wrapT: 'clamp' } } : undefined, orientation: model.orientation, poster: mediaUrl(data.media.find(item => item.id === model.posterId)) || undefined },
    appearance: { id: `${display.id}:${label?.revision}`, requiredSlots: ['label'], slots: { label: { baseColorMap: mediaUrl(labelMedia), metalness: 0, roughness: 0.15, clearcoat: 0.2 } } },
    accentScene: resolveFlavorScene(data, flavor, `${seed}:${display.id}:${flavor.id}`),
  };
}
