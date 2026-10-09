import type { CatalogData, Display3D, Flavor, Label, MediaAsset, Model3D, ProductVariant } from './contracts';
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

/** Shared geometry mapping; presentation-specific transforms stay in controllers. */
export function resolveModelAsset(data: CatalogData, model: Model3D): ProductAsset | null {
  const packaging = data.packagingVariants.find(item => item.id === model.packagingVariantId);
  const category = data.packagingCategories.find(item => item.id === packaging?.categoryId);
  const media = data.media.find(item => item.id === model.mediaId);
  if (!packaging || !media || media.role !== 'model' || media.status !== 'ready' || media.lifecycle !== 'active') return null;
  const kind = category?.viewerKind || 'other';
  return { id: model.id, name: model.name, src: mediaUrl(media), packaging: kind === 'pp' ? 'other' : kind, volumeMl: packaging.volumeMl || undefined, materialSlots: model.materialSlots, textureSamplers: ['can-wrap-v1', 'pet-wrap-v1', 'glass-290-basil-wrap-v1'].includes(model.layoutProfile) ? { label: { wrapS: 'repeat', wrapT: 'clamp' } } : undefined, orientation: model.orientation, poster: mediaUrl(data.media.find(item => item.id === model.posterId)) || undefined };
}

/** Artwork mapping is identical in sales previews and free compatible pairings. */
export function resolveLabelAppearance(data: CatalogData, label: Label, appearanceId = `${label.id}:${label.revision}`): ProductAppearance | null {
  const media = data.media.find(item => item.id === label.mediaId);
  if (!media || media.role !== 'label' || media.status !== 'ready' || media.lifecycle !== 'active') return null;
  return { id: appearanceId, requiredSlots: ['label'], slots: { label: { baseColorMap: mediaUrl(media), metalness: 0, roughness: 0.15, clearcoat: 0.2 } } };
}

/** Sales and Studio use the same liquid tint; imported PET/cloudiness settings stay intact. */
export function resolveModelLabelAppearance(data: CatalogData, model: Model3D, label: Label, flavor?: Pick<Flavor, 'accentColor'>, liquidColor?: string | null, appearanceId = `${label.id}:${label.revision}`, capColor?: string | null, labelOffset = 0): ProductAppearance | null {
  const appearance = resolveLabelAppearance(data, label, appearanceId);
  if (!appearance) return null;
  appearance.slots ??= {};
  if (Number.isFinite(labelOffset) && labelOffset !== 0) {
    const offset = Math.max(-50, Math.min(50, labelOffset));
    appearance.id += `:offset:${offset}`;
    appearance.slots.label.textureOffsetX = offset / 100;
  }
  const color = liquidColor ?? flavor?.accentColor;
  if (model.materialSlots.liquid?.length && color?.length === 7 && /^#[0-9a-f]{6}$/i.test(color)) {
    appearance.id += `:liquid:${color.toLowerCase()}`;
    appearance.slots.liquid = { color };
  }
  if (model.materialSlots.cap?.length && capColor?.length === 7 && /^#[0-9a-f]{6}$/i.test(capColor)) {
    appearance.id += `:cap:${capColor.toLowerCase()}`;
    appearance.slots.cap = { color: capColor };
  }
  return appearance;
}

function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const letter of seed) state = Math.imul(state ^ letter.charCodeAt(0), 16777619) >>> 0;
  return () => { state += 0x6D2B79F5; let next = state; next = Math.imul(next ^ next >>> 15, next | 1); next ^= next + Math.imul(next ^ next >>> 7, next | 61); return ((next ^ next >>> 14) >>> 0) / 4294967296; };
}

export function resolveFlavorScene(data: CatalogData, flavor: Flavor, seed: string): ProductAccentScene {
  const random = seeded(seed);
  const pools = new Map<string, MediaAsset[]>();
  for (const role of ['fruit', 'leaf', 'splash', 'ice']) {
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
    if (!['fruit', 'leaf', 'splash', 'ice'].includes(node.kind)) return [clean];
    const pool = pools.get(node.kind) || [];
    if (!pool.length) {
      // Old releases retain the preset. Empty or disabled pools hide ice after adoption.
      if (node.kind === 'ice' && flavor.icePoolConfigured !== true && !data.flavorAssets.some(item => item.flavorId === flavor.id && item.role === 'ice')) return [clean];
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
    .filter(node => ['fruit', 'leaf', 'splash', 'ice'].includes(node.kind)).map(node => `${node.id}:${node.assetUrl}`).join('|');
  const current = signature(seed);
  for (let next = seed + 1; next <= seed + 32; next++) if (signature(next) !== current) return next;
  return seed + 1;
}

export function resolveDisplay3D(data: CatalogData, display: Display3D, seed = 'preview'): { asset: ProductAsset; appearance: ProductAppearance; accentScene: ProductAccentScene; flavor: Flavor; variant: ProductVariant } | null {
  const variant = data.productVariants.find(item => item.id === display.productVariantId);
  const model = data.models3d.find(item => item.id === display.modelId);
  const flavor = data.flavors.find(item => item.id === variant?.flavorId);
  const packaging = data.packagingVariants.find(item => item.id === variant?.packagingVariantId);
  const modelMedia = data.media.find(item => item.id === model?.mediaId);
  const label = data.labels.find(item => item.id === display.labelId);
  const labelMedia = data.media.find(item => item.id === label?.mediaId);
  if (!variant || !model || !flavor || !packaging || !modelMedia || !labelMedia || modelMedia.status!=='ready'||labelMedia.status!=='ready'||modelMedia.lifecycle!=='active'||labelMedia.lifecycle!=='active'||modelMedia.role!=='model'||labelMedia.role!=='label') return null;
  const asset = resolveModelAsset(data, model);
  const appearance = label && resolveModelLabelAppearance(data, model, label, flavor, display.liquidColor, `${display.id}:${label.id}:${label.revision}`, display.capColor, display.labelOffset);
  if (!asset || !appearance) return null;
  return {
    variant, flavor,
    asset, appearance,
    accentScene: resolveFlavorScene(data, flavor, `${seed}:${display.id}:${flavor.id}`),
  };
}
