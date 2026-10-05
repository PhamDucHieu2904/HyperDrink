import type { CatalogData, FlavorAsset, FlavorPoolAssetInput } from './contracts';
import { CatalogDomainError, updateCatalogRecord } from './service';

/** Run inside the repository transaction so concurrent imports always append to the latest pool. */
export function addFlavorPoolAsset(data: CatalogData, input: FlavorPoolAssetInput, now = new Date().toISOString()): { catalog: CatalogData; asset: FlavorAsset; created: boolean } {
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.id) || !['fruit', 'leaf', 'splash'].includes(input.role)) throw new CatalogDomainError('pool_invalid', 'Chọn vai trò hợp lệ cho ảnh.');
  const flavor = data.flavors.find(item => item.id === input.flavorId && item.lifecycle === 'active');
  if (!flavor) throw new CatalogDomainError('pool_flavor_invalid', 'Hương vị không còn hoạt động. Tải lại pool trước khi thêm ảnh.');
  const media = data.media.find(item => item.id === input.mediaId && item.lifecycle === 'active' && item.status === 'ready' && item.role === input.role && item.mime.startsWith('image/'));
  if (!media) throw new CatalogDomainError('pool_media_invalid', 'Ảnh chưa sẵn sàng hoặc không khớp vai trò đã chọn.');
  const existing = data.flavorAssets.find(item => item.id === input.id);
  if (existing) {
    if (existing.lifecycle !== 'active' || existing.flavorId !== input.flavorId || existing.mediaId !== input.mediaId || existing.role !== input.role) throw new CatalogDomainError('pool_request_conflict', 'Yêu cầu thêm ảnh đã được dùng cho dữ liệu khác. Tải lại pool.');
    return { catalog: data, asset: existing, created: false };
  }
  const position = data.flavorAssets.filter(item => item.flavorId === flavor.id && item.lifecycle === 'active').reduce((max, item) => Math.max(max, item.position), -1) + 1;
  const fileName = media.name.replace(/\.[^.]+$/, '').trim() || ({ fruit: 'Trái cây', leaf: 'Lá cây', splash: 'Splash' }[input.role]);
  const asset: FlavorAsset = { ...input, name: `${flavor.shortName || flavor.name} · ${fileName}`.slice(0, 160), slug: `pool-${input.id.toLowerCase()}`, position, enabled: true, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now };
  const catalog = updateCatalogRecord(data, 'flavorAssets', asset, null, now);
  return { catalog, asset: catalog.flavorAssets.find(item => item.id === input.id)!, created: true };
}
