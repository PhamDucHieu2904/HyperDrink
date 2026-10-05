import type { CatalogData, ProductDetail } from './contracts';
import type { StorefrontProduct } from './storefront';
import { isImageMedia } from './media-roles';

/** A detail belongs to the actual applied label, never another flavor's label. */
export function resolveProductDetail(catalog: CatalogData, product: StorefrontProduct): ProductDetail | undefined {
  if (!product.label || product.label.lifecycle !== 'active') return undefined;
  return (catalog.productDetails ?? []).find(detail => detail.lifecycle === 'active' && detail.enabled && detail.labelId === product.label!.id);
}

export function productDetailPoster(catalog: CatalogData, detail: ProductDetail | undefined) {
  return catalog.media.find(media => media.id === detail?.posterId && media.lifecycle === 'active' && media.status === 'ready' && isImageMedia(media));
}
