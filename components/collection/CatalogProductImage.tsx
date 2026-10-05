'use client';

import Image from 'next/image';
import { Box } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { mediaUrl, resolveDisplay3D, resolveFlavorFruitImage } from '@/lib/catalog/resolve';

export default function CatalogProductImage({ catalog, product }: { catalog: CatalogData; product: StorefrontProduct }) {
  const frame = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => !product.image2d && product.display3d ? resolveDisplay3D(catalog, product.display3d) : null, [catalog, product.image2d, product.display3d]);
  const renderKey = JSON.stringify(scene && [scene.asset, scene.appearance]);
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const fruit = resolveFlavorFruitImage(catalog, product.flavor.id);
  const candidates = [mediaUrl(product.image2d), rendered?.key === renderKey ? rendered.url : '', mediaUrl(fruit)].filter(Boolean);
  const src = candidates.find(url => !failed.includes(url));

  useEffect(() => {
    const element = frame.current;
    if (!element || !scene) return;
    let live = true;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void import('@/lib/viewer/catalog-thumbnail').then(module => module.catalogThumbnail(scene.asset, scene.appearance))
        .then(url => { if (live) setRendered({ key: renderKey, url }); }).catch(() => { /* Keep the matching fruit fallback. */ });
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: '180px' });
    observer.observe(element);
    return () => { live = false; observer.disconnect(); };
  }, [scene, renderKey]);

  return <div ref={frame} className="collection-card-image">
    {src ? <Image unoptimized src={src} alt={product.variant.name} width={512} height={512} sizes="(max-width:600px) 90vw, (max-width:1000px) 40vw, 24vw" onError={() => setFailed(previous => [...previous, src])} /> : <Box size={64} strokeWidth={1} aria-label={product.flavor.name} />}
  </div>;
}
