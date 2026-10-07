'use client';

import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import ProductDetailPanel from '../product-detail/ProductDetailPanel';

export default function ProductDialog({ catalog, product, onClose }: { catalog: CatalogData; product: StorefrontProduct; onClose: () => void }) {
  return <ProductDetailPanel catalog={catalog} product={product} preview={product.productDetail} catalogImage onClose={onClose} />;
}
