import type { CatalogData, MediaAsset } from './contracts';
import { isImageMedia } from './media-roles';

/** Shared by storefront buttons and preflight so a usable fruit pool image
 * counts as an image even when no separate thumbnail has been selected. */
export function resolveFlavorFruitImage(data: CatalogData, flavorId: string): MediaAsset | undefined {
  const assignments = data.flavorAssets.filter(item => item.flavorId === flavorId && item.role === 'fruit' && item.enabled && item.lifecycle === 'active')
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  for (const assignment of assignments) {
    const image = data.media.find(item => item.id === assignment.mediaId);
    if (image?.role === 'fruit' && image.status === 'ready' && image.lifecycle === 'active' && isImageMedia(image) && image.url) return image;
  }
  return undefined;
}
