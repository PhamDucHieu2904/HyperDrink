'use client';

import { Heart, ArrowUpRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { favoritesCopy } from '@/lib/i18n/favorites';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { storefrontStatus } from '@/lib/i18n/storefront-status';
import { publicUrl } from '@/lib/public-url';
import { useLanguage } from '../LanguageProvider';
import CatalogProductImage from '../collection/CatalogProductImage';
import FavoriteButton from './FavoriteButton';
import { useFavorites } from './useFavorites';

export default function FavoritesPanel({ catalog, products, onClose }: { catalog?: CatalogData; products: StorefrontProduct[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useFavorites();
  const { locale } = useLanguage();
  const copy = favoritesCopy(locale);
  const collection = collectionCopy(locale);
  const byId = new Map(products.map(product => [product.variant.id, product]));
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <dialog id="favorites-panel" ref={dialog} className="favorites-panel" aria-labelledby="favorites-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    const first = targets[0], last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="favorites-heading"><div><span className="favorites-heading-icon"><Heart size={22} strokeWidth={1.5} aria-hidden="true" /></span><h2 id="favorites-title">{copy.title}</h2><span className="favorites-total" aria-live="polite">{ids.length}</span></div>
      <button type="button" autoFocus className="favorites-close" aria-label={copy.close} onClick={onClose}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className="favorites-content">
      {ids.length === 0 ? <div className="favorites-empty"><span><Heart size={38} strokeWidth={1.1} aria-hidden="true" /></span><h3>{copy.emptyTitle}</h3><p>{copy.emptyBody}</p><a href={publicUrl('/products/')} onClick={onClose}>{copy.browse}<ArrowUpRight size={18} aria-hidden="true" /></a></div>
        : !catalog ? <p role="status">{storefrontStatus[locale].loading}</p>
          : <ul className="favorites-list">{ids.map((id, index) => {
            const product = byId.get(id);
            const name = product ? product.catalogItem ? product.variant.name : product.flavor.shortName || product.flavor.name : copy.unavailable;
            return <li key={id} className="favorites-item">
              {product ? <a className="favorites-product" href={`${publicUrl('/products/')}?group=${encodeURIComponent(product.group.id)}&product=${encodeURIComponent(id)}`} aria-label={`${collection.viewProduct}: ${name}`}>
                <CatalogProductImage catalog={catalog} product={product} />
                <span className="favorites-product-copy"><strong><bdi>{name}</bdi></strong><span><bdi>{product.group.buttonLabel || product.group.name}</bdi></span><small><bdi>{product.packaging.volumeMl ? `${product.packaging.volumeMl} ml` : product.packaging.name}</bdi><ArrowUpRight size={16} aria-hidden="true" /></small></span>
              </a> : <p className="favorites-unavailable">{copy.unavailable}</p>}
              <FavoriteButton productId={id} name={name} onToggle={() => queueMicrotask(() => {
                const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('.favorites-item .favorite-button');
                const next = buttons?.[Math.min(index, buttons.length - 1)] ?? dialog.current?.querySelector<HTMLButtonElement>('.favorites-close');
                next?.focus({ preventScroll: true });
              })} />
            </li>;
          })}</ul>}
    </div>
    <footer className="favorites-footer">{copy.saved}</footer>
  </dialog>;
}
