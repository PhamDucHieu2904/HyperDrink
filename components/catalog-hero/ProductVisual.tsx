'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Box } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CatalogData, Display2D, Display3D, MediaAsset, Model3D, PackagingSlot, ProductVariant } from '@/lib/catalog/contracts';
import { mediaUrl, resolveDisplay3D } from '@/lib/catalog/resolve';
import { useLanguage } from '../LanguageProvider';
import { heroCopy } from './copy';
import ViewerLoading from './ViewerLoading';
import type { BackgroundRenderState } from '@/lib/background-render-state';
import type { BackgroundConfig } from '@/lib/background-config';
import { createHeroResourceWindow } from '@/lib/viewer/hero-resource-window';
import type { ResourceUrlLease, ViewerResourceCandidate, ViewerResourceWindow } from '@/lib/viewer/resource-prefetch';
import { decodeHomepageLayout, filterHomepageAccents, resolveHomepageLayout } from '@/lib/catalog/homepage-layout';
import type { GraphicsMode } from '@/lib/viewer/graphics-mode';

const subscribePreview = () => () => {};
const readPreview = () => new URLSearchParams(window.location.search).get('layoutTest') ?? '';
const serverPreview = () => '';

const ProductViewer = dynamic(() => import('../ProductViewer'), { ssr: false, loading: () => <div className="scene-shell catalog-viewer-chunk"><ViewerLoading /></div> });

export default function ProductVisual({ catalog, releaseId, seed, slot, variant, display3d, display2d, image2d, model, resourceDisplays, backgroundState, backgroundConfig, graphicsMode = 'standard', effectsVisible = true, resourcesReady = true, acquireResourceUrl, onViewerReady, onViewerUnavailable }: {
  catalog: CatalogData; releaseId: string; seed: string; slot: PackagingSlot; variant: ProductVariant;
  display3d?: Display3D; display2d?: Display2D; image2d?: MediaAsset; model?: Model3D;
  resourceDisplays?: readonly (Display3D | null)[];
  graphicsMode?: GraphicsMode;
  effectsVisible?: boolean; resourcesReady?: boolean;
  acquireResourceUrl?: (url: string) => ResourceUrlLease;
  onViewerReady?: () => void;
  backgroundState: BackgroundRenderState; backgroundConfig: BackgroundConfig; onViewerUnavailable: () => void;
}) {
  const { locale, t } = useLanguage();
  const copy = heroCopy(locale);
  const [failedDisplay, setFailedDisplay] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const preview = useSyncExternalStore(subscribePreview, readPreview, serverPreview);
  const renderKey = `${releaseId}:${variant.id}:${display3d?.revision ?? 0}`;
  const scene = useMemo(() => {
    if (!display3d) return null;
    const resolved = resolveDisplay3D(catalog, display3d, `${releaseId}:${seed}`);
    if (!resolved) return null;
    const layout = decodeHomepageLayout(preview) ?? resolveHomepageLayout(catalog.homepageLayout);
    return { ...resolved, accentScene: filterHomepageAccents(resolved.accentScene, layout) };
  }, [catalog, display3d, releaseId, seed, preview]);
  const resourceWindow = useMemo<ViewerResourceWindow | undefined>(() => {
    if (slot.mode === '2d' || !scene || !resourceDisplays?.length) return undefined;
    const selectedIndex = resourceDisplays.findIndex(display => display?.productVariantId === variant.id);
    const window = createHeroResourceWindow(resourceDisplays, selectedIndex, display => display.id);
    const candidates = new Map<string, ViewerResourceCandidate | null>();
    const candidateFor = (display: Display3D): ViewerResourceCandidate[] => {
      if (!candidates.has(display.id)) {
        const resolved = display.id === display3d?.id ? scene : resolveDisplay3D(catalog, display, `${releaseId}:${seed}`);
        candidates.set(display.id, resolved ? { asset: resolved.asset, appearance: resolved.appearance } : null);
      }
      const candidate = candidates.get(display.id);
      return candidate ? [candidate] : [];
    };
    return { ready: resourcesReady ? window.ready.flatMap(candidateFor) : [], files: acquireResourceUrl ? [] : window.files.flatMap(candidateFor), acquireUrl: acquireResourceUrl };
  }, [catalog, display3d, releaseId, resourceDisplays, scene, seed, slot.mode, variant.id, resourcesReady, acquireResourceUrl]);
  const canUse3d = slot.mode !== '2d' && scene && failedDisplay !== renderKey;
  useEffect(() => { if (!canUse3d) onViewerReady?.(); }, [canUse3d, onViewerReady]);
  const accentScene = useMemo(() => scene ? effectsVisible ? scene.accentScene : { ...scene.accentScene, enabled: false, nodes: [] } : undefined, [scene, effectsVisible]);
  // Keep the established lightweight decorations. Extra bottle transport is
  // opt-in and shares their single capture instead of allocating another one.
  const aloeLiquid = scene?.asset.materialSlots?.liquid?.includes('Aloe Vera Water');
  const basilHigh = scene?.asset.materialSlots?.body?.includes('basil-high-outer');
  const refractiveProduct = scene && ['glass', 'pet'].includes(scene.asset.packaging) && Boolean(scene.asset.materialSlots?.liquid?.length);
  const needsBackdrop = graphicsMode === 'enhanced' && refractiveProduct || basilHigh || !aloeLiquid && accentScene?.enabled && accentScene.nodes.some(node => node.enabled && !node.assetUrl && (node.kind === 'droplet' || node.kind === 'ice'));
  const poster = model ? catalog.media.find(item => item.id === model.posterId && item.role === 'poster' && item.lifecycle === 'active' && item.status === 'ready') : undefined;
  const candidates = [image2d, ...(slot.mode !== '2d' ? [poster] : [])].filter((item): item is MediaAsset => Boolean(item));
  const fallback = candidates.find(item => !failedImages.includes(mediaUrl(item)));
  const fallbackUrl = fallback ? mediaUrl(fallback) : '';
  if (canUse3d) return <ProductViewer asset={scene.asset} appearance={scene.appearance} graphicsMode={graphicsMode} resourceWindow={resourceWindow} accentScene={accentScene} loadingFallback={<ViewerLoading />} backdrop={needsBackdrop ? { state: backgroundState, config: backgroundConfig } : undefined} onStatus={status => { if (status.assetId !== scene.asset.id) return; if (status.phase === 'ready') onViewerReady?.(); else if (status.phase === 'error') { setFailedDisplay(renderKey); onViewerUnavailable(); } }} />;
  const isReference = Boolean(fallback && fallback.id === poster?.id && fallback.id !== image2d?.id);
  return <figure className="catalog-product-image" aria-label={variant.name}>
    {fallbackUrl ? <Image src={fallbackUrl} width={fallback?.width || 900} height={fallback?.height || 1200} alt={isReference ? `${model?.name} · ${copy.poster}` : display2d?.alt || variant.name} priority unoptimized onError={() => setFailedImages(previous => previous.includes(fallbackUrl) ? previous : [...previous, fallbackUrl])} /> : <div className="catalog-product-unavailable" role="status"><Box size={64} strokeWidth={1} /><p>{candidates.length ? copy.unavailable : copy.empty}</p></div>}
    <figcaption>{failedDisplay === renderKey && <span>{t('viewer.unavailable')}</span>}{fallbackUrl && <span>{isReference ? copy.poster : copy.image}</span>}</figcaption>
  </figure>;
}
