'use client';

import Image from 'next/image';
import { Box } from 'lucide-react';
import { useState } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { mediaUrl, resolveFlavorFruitImage } from '@/lib/catalog/resolve';

/** Catalog cards use pre-rendered images, never a WebGL renderer. */
export default function CatalogProductImage({ catalog, product }: { catalog: CatalogData; product: StorefrontProduct }) {
  const [failed, setFailed] = useState<string[]>([]);
  const editorialItem = product.label && catalog.catalogItems?.find(item => item.lifecycle === 'active' && item.enabled && item.packagingVariantId === product.packaging.id && catalog.productDetails.some(detail => detail.id === item.productDetailId && detail.labelId === product.label?.id));
  const editorialImage = catalog.media.find(media => media.id === editorialItem?.mediaId && media.lifecycle === 'active' && media.status === 'ready' && media.role === 'image-2d');
  const candidates = [mediaUrl(product.image2d || editorialImage), ...(!product.catalogItem ? [mediaUrl(resolveFlavorFruitImage(catalog, product.flavor.id))] : [])].filter(Boolean);
  const src = candidates.find(url => !failed.includes(url));
  return <div className="collection-card-image">
    {src ? <Image unoptimized loading="lazy" src={src} alt={product.variant.name} width={1024} height={1024} sizes="(max-width:600px) 90vw, (max-width:1000px) 40vw, 24vw" onError={() => setFailed(previous => [...previous, src])} /> : <Box size={64} strokeWidth={1} aria-label={product.variant.name} />}
  </div>;
}
