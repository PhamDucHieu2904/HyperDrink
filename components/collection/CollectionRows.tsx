'use client';

import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { CollectionSection } from '@/lib/catalog/collection';
import { productPage } from '@/lib/catalog/collection';
import { publicUrl } from '@/lib/public-url';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { useLanguage } from '../LanguageProvider';
import { trackUsage } from '@/lib/operations/client';
import CatalogCard from './CatalogCard';

export function CollectionPager({ page, totalPages, onPage, label }: { page: number; totalPages: number; onPage: (page: number) => void; label: string }) {
  const { locale } = useLanguage();
  const copy = collectionCopy(locale);
  const Previous = locale === 'ar' ? ChevronRight : ChevronLeft;
  const Next = locale === 'ar' ? ChevronLeft : ChevronRight;
  return <nav className="collection-pager" aria-label={label}>
    <button type="button" aria-label={`${copy.previous}: ${label}`} disabled={page === 0} onClick={() => onPage(page - 1)}><Previous size={20} /></button>
    <span aria-live="polite">{copy.page.replace('{current}', String(page + 1)).replace('{total}', String(totalPages))}</span>
    <button type="button" aria-label={`${copy.next}: ${label}`} disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)}><Next size={20} /></button>
  </nav>;
}

function CollectionRow({ catalog, section }: { catalog: CatalogData; section: CollectionSection }) {
  const { locale, t } = useLanguage();
  const copy = collectionCopy(locale);
  const row = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(6);
  const [requestedPage, setPage] = useState(0);
  const result = productPage(section.products, requestedPage, size);
  useEffect(() => {
    if (!row.current) return;
    const observer = new ResizeObserver(entries => setSize(Math.max(1, Math.min(6, Math.floor((entries[0].contentRect.width + 20) / 220)))));
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);
  const AllArrow = locale === 'ar' ? ArrowLeft : ArrowRight;
  return <section className="collection-row" aria-labelledby={`collection-${section.group.id}`}>
    <div className="collection-row-heading"><div><span className="collection-row-count">{t(section.products.length === 1 ? 'collection.countOne' : 'collection.count', { count: section.products.length })}</span><h3 id={`collection-${section.group.id}`}><bdi>{section.title}</bdi></h3></div><div className="collection-row-tools"><a href={`${publicUrl('/products/')}?group=${encodeURIComponent(section.group.id)}`} className="collection-see-all">{copy.allProducts}<AllArrow size={18} /></a><CollectionPager label={section.title} page={result.page} totalPages={result.totalPages} onPage={page => { setPage(page); trackUsage('collection_open', section.group.id); }} /></div></div>
    <div ref={row} className="collection-row-cards" style={{ '--row-count': size } as React.CSSProperties}>
      {result.items.map(product => <CatalogCard key={product.variant.id} catalog={catalog} product={product} />)}
    </div>
  </section>;
}

export default function CollectionRows({ catalog, sections }: { catalog: CatalogData; sections: CollectionSection[] }) {
  return <div className="collection-rows">{sections.map(section => <CollectionRow key={section.group.id} catalog={catalog} section={section} />)}</div>;
}
