import type { CatalogData, FlavorAsset, MediaAsset } from './contracts';
import { isImageMedia } from './media-roles';

/** Membership follows actual links, including shared leaves, rather than guessing from file names. */
export function mediaFlavorIds(data: CatalogData, mediaId: string): string[] {
  const ids = new Set<string>();
  for (const asset of data.flavorAssets) if (asset.lifecycle === 'active' && asset.mediaId === mediaId) ids.add(asset.flavorId);
  for (const label of data.labels) if (label.lifecycle === 'active' && label.mediaId === mediaId && label.flavorId) ids.add(label.flavorId);
  for (const asset of data.assets2d) if (asset.lifecycle === 'active' && (asset.mediaId === mediaId || asset.galleryIds?.includes(mediaId)) && asset.flavorId) ids.add(asset.flavorId);
  for (const flavor of data.flavors) if (flavor.thumbnailId === mediaId || flavor.iconId === mediaId) ids.add(flavor.id);
  return [...ids];
}

export function flavorPoolLibrary(data: CatalogData, role: FlavorAsset['role'], flavorId = 'all', query = ''): { media: MediaAsset; flavorIds: string[] }[] {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return data.media.filter(media => media.role === role && media.lifecycle === 'active' && media.status === 'ready' && !!media.url && isImageMedia(media))
    .map(media => ({ media, flavorIds: mediaFlavorIds(data, media.id) }))
    .filter(row => {
      const text = normalize([row.media.name, row.media.slug, ...data.flavors.filter(flavor => row.flavorIds.includes(flavor.id)).map(flavor => flavor.name)].join(' '));
      return (flavorId === 'all' || (flavorId === 'unassigned' ? !row.flavorIds.length : row.flavorIds.includes(flavorId))) && words.every(word => text.includes(word));
    }).sort((a, b) => a.media.name.localeCompare(b.media.name, 'vi'));
}

/** Mirror the atomic pool save in both admin state owners without an extra workspace request per image. */
export function mergeFlavorPoolAsset(data: CatalogData, asset: FlavorAsset): CatalogData {
  return {
    ...data,
    flavorAssets: data.flavorAssets.some(item => item.id === asset.id) ? data.flavorAssets.map(item => item.id === asset.id ? asset : item) : [...data.flavorAssets, asset],
    flavors: asset.role !== 'ice' ? data.flavors : data.flavors.map(flavor => flavor.id === asset.flavorId && !flavor.icePoolConfigured ? { ...flavor, icePoolConfigured: true, revision: flavor.revision + 1, updatedAt: asset.updatedAt } : flavor),
  };
}
