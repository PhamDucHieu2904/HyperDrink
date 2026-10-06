'use client';

import { useEffect, useRef, useState } from 'react';
import type { Flavor, MediaAsset } from '@/lib/catalog/contracts';
import { useLanguage } from '../LanguageProvider';
import CatalogImage from './CatalogImage';
import { bindFlavorCarousel, type FlavorCarouselController } from './flavor-carousel-controller';

export interface CarouselFlavor { variantId: string; flavor: Flavor; fruitImage?: MediaAsset }

export default function FlavorCarousel({ items, selectedId, onSelect }: { items: CarouselFlavor[]; selectedId: string; onSelect: (id: string) => void }) {
  const { locale, t } = useLanguage();
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstSetRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<FlavorCarouselController | null>(null);
  const latest = useRef({ onSelect, selectedId });
  const [copies, setCopies] = useState(3);
  const canMove = items.length > 1;
  const signature = `${locale}:${items.map(item => `${item.variantId}:${item.flavor.shortName || item.flavor.name}`).join('|')}`;

  useEffect(() => { latest.current = { onSelect, selectedId }; });
  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const firstSet = firstSetRef.current;
    if (!viewport || !track || !firstSet) return;
    let live = true;
    const controller = bindFlavorCarousel({ viewport, track, firstSet, canMove, selectedId: latest.current.selectedId,
      onSelect: id => latest.current.onSelect(id),
      onCopies: count => queueMicrotask(() => { if (live) setCopies(count); }),
    });
    controllerRef.current = controller;
    return () => { live = false; controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [signature, canMove]);
  useEffect(() => { controllerRef.current?.setSelectedId(selectedId); }, [selectedId]);
  const renderSet = (index: number) => {
    const cloned = index !== (canMove ? 1 : 0);
    return <div key={index} ref={!cloned ? firstSetRef : undefined} className="flavor-set" aria-hidden={cloned || undefined}>
      {items.map(item => {
        const select = () => { controllerRef.current?.setSelectedId(item.variantId); onSelect(item.variantId); };
        const content = <><span><CatalogImage media={item.fruitImage} size={64} /></span><bdi>{item.flavor.shortName || item.flavor.name}</bdi></>;
        // Visual loops remain pointer-selectable, but contain no focusable
        // controls under aria-hidden. The canonical set provides keyboard/AT UI.
        return cloned
          ? <span key={item.variantId} className="flavor-choice" role="presentation" aria-hidden="true" data-carousel-item="true" data-variant-id={item.variantId} data-selected={item.variantId === selectedId} onClick={select}>{content}</span>
          : <button key={item.variantId} className="flavor-choice" type="button" data-carousel-item="true" data-variant-id={item.variantId} data-selected={item.variantId === selectedId} aria-pressed={item.variantId === selectedId} onClick={select}>{content}</button>;
      })}
    </div>;
  };

  return <div className={`flavor-dock catalog-flavor-dock${canMove ? '' : ' catalog-carousel-static'}`} aria-label={t('hero.chooseFlavor')}>
    <div ref={viewportRef} className="catalog-carousel-viewport">
      <div ref={trackRef} className="flavor-track">
        {Array.from({ length: canMove ? copies : 1 }, (_, index) => renderSet(index))}
      </div>
    </div>
  </div>;
}
