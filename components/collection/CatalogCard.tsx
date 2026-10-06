'use client';

import type { CatalogData } from '@/lib/catalog/contracts';
import { ArrowUpRight } from 'lucide-react';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { publicUrl } from '@/lib/public-url';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { useLanguage } from '../LanguageProvider';
import CatalogProductImage from './CatalogProductImage';

export default function CatalogCard({ catalog, product, onView }: { catalog: CatalogData; product: StorefrontProduct; onView?: (product: StorefrontProduct) => void }) {
  const { locale } = useLanguage();
  const copy = collectionCopy(locale);
  const name = product.flavor.shortName || product.flavor.name;
  const href = `${publicUrl('/products/')}?group=${encodeURIComponent(product.group.id)}&product=${encodeURIComponent(product.variant.id)}`;
  return <article className="collection-card" style={{ '--card-accent': product.flavor.accentColor } as React.CSSProperties} data-product={product.variant.id}>
    <a className="collection-card-link" href={href} aria-label={`${copy.viewProduct}: ${product.variant.name}`} onClick={event => { if (onView) { event.preventDefault(); onView(product); } }}>
      <CatalogProductImage catalog={catalog} product={product} />
      <div className="collection-card-copy"><h3><bdi>{name}</bdi></h3><p><bdi>{product.group.buttonLabel || product.group.name}</bdi><span aria-hidden="true"> — </span>{copy.netContent} <bdi className={product.packaging.volumeMl ? 'collection-card-volume' : undefined}>{product.packaging.volumeMl ? `${product.packaging.volumeMl} ml` : product.packaging.name}</bdi></p></div>
      <span className="collection-card-action">{copy.seeAll}<ArrowUpRight size={18} aria-hidden="true" /></span>
    </a>
  </article>;
}
