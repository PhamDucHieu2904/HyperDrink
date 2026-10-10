import type { CatalogData } from './contracts';
import type { StorefrontProduct } from './storefront';
import { mediaUrl, resolveDisplay3D, resolveFlavorFruitImage, resolveFlavorIcon } from './resolve';
import { filterHomepageAccents, resolveHomepageLayout, type HomepageLayout } from './homepage-layout';
import type { SceneResourcePlan } from '../viewer/scene-resources';

/** Only products reachable from homepage buttons, including every enabled
 * flavor/packaging. All pool variants are covered, not just one random scene. */
export function createSceneResourcePlan(data: CatalogData, products: StorefrontProduct[], layout: HomepageLayout = resolveHomepageLayout(data.homepageLayout)): SceneResourcePlan {
  const models = new Set<string>(), labels = new Set<string>(), avatars = new Set<string>(), effects = new Set<string>();
  const flavorIds = new Set<string>();
  for (const product of products) {
    flavorIds.add(product.flavor.id);
    for (const image of [product.thumbnail, resolveFlavorFruitImage(data, product.flavor.id), resolveFlavorIcon(data, product.flavor), product.image2d]) {
      const url = mediaUrl(image); if (url) avatars.add(url);
    }
    const resolved = product.display3d && resolveDisplay3D(data, product.display3d);
    if (!resolved) continue;
    models.add(resolved.asset.src);
    for (const slot of Object.values(resolved.appearance.slots ?? {})) {
      for (const url of [slot.baseColorMap, slot.normalMap, slot.roughnessMap]) if (url) labels.add(url);
    }
    for (const node of filterHomepageAccents(resolved.accentScene, layout).nodes) {
      if (node.assetUrl) effects.add(node.assetUrl);
      else if (node.kind === 'ice') effects.add(mediaUrl('/assets/scene/ice-droplet-atlas.webp'));
      else if (node.kind === 'fruit' || node.kind === 'leaf') effects.add(mediaUrl('/assets/scene/fruit-leaf-atlas.webp'));
    }
  }
  const mediaById = new Map(data.media.map(media => [media.id, media]));
  for (const assignment of data.flavorAssets) {
    if (!flavorIds.has(assignment.flavorId) || !layout[assignment.role] || !assignment.enabled || assignment.lifecycle !== 'active') continue;
    const media = mediaById.get(assignment.mediaId);
    if (media?.role === assignment.role && media.status === 'ready' && media.lifecycle === 'active' && media.url) effects.add(mediaUrl(media));
  }
  const core = [...new Set([...models, ...labels, ...avatars])], coreSet = new Set(core);
  return { core, effects: [...effects].filter(url => !coreSet.has(url)) };
}
