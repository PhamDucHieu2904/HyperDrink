'use client';

import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { resolveDisplay3D } from '@/lib/catalog/resolve';
import { useLanguage } from '../LanguageProvider';
import CatalogProductImage from './CatalogProductImage';
import { collectionCopy } from '@/lib/i18n/collection-copy';

const ProductViewer = dynamic(() => import('../ProductViewer'), { ssr: false });

export default function ProductDialog({ catalog, product, onClose }: { catalog: CatalogData; product: StorefrontProduct; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t, locale } = useLanguage();
  const copy = collectionCopy(locale);
  const scene = useMemo(() => product.display3d ? resolveDisplay3D(catalog, product.display3d) : null, [catalog, product.display3d]);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="collection-product-dialog" aria-labelledby="collection-product-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button type="button" className="collection-dialog-close" aria-label={t('common.close')} onClick={onClose}><X size={22} /></button>
    <div className="collection-dialog-visual">{scene && !failed ? <ProductViewer asset={scene.asset} appearance={scene.appearance} presentation={{ camera: { fill: 0.82, mobileFill: 0.82, productScale: 1, mobileProductScale: 1 }, motion: { idleSpeed: 0.1 } }} loadingFallback={<CatalogProductImage catalog={catalog} product={product} />} onStatus={status => { if (status.phase === 'error') setFailed(true); }} /> : <CatalogProductImage catalog={catalog} product={product} />}</div>
    <div className="collection-dialog-copy"><p className="collection-kicker"><bdi>{product.group.collectionTitle || product.group.buttonLabel || product.group.name}</bdi></p><h2 id="collection-product-title"><bdi>{product.flavor.name}</bdi></h2><p>{product.variant.description || product.flavor.description}</p><dl><div><dt>{copy.netContent}</dt><dd><bdi>{product.packaging.volumeMl ? `${product.packaging.volumeMl} ml` : product.packaging.name}</bdi></dd></div><div><dt>{t('hero.packaging')}</dt><dd>{product.category.name}</dd></div></dl>{scene && !failed && <p className="collection-dialog-hint">{t('viewer.controls', { name: product.variant.name })}</p>}</div>
  </dialog>;
}
