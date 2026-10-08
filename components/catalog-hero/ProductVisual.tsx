'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Box } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CatalogData, Display2D, Display3D, MediaAsset, Model3D, PackagingSlot, ProductVariant } from '@/lib/catalog/contracts';
import { mediaUrl, resolveDisplay3D } from '@/lib/catalog/resolve';
import { useLanguage } from '../LanguageProvider';
import { heroCopy } from './copy';
import ViewerLoading from './ViewerLoading';
import type { BackgroundRenderState } from '@/lib/background-render-state';
import type { BackgroundConfig } from '@/lib/background-config';
import { createHeroResourceWindow } from '@/lib/viewer/hero-resource-window';
import type { ViewerResourceCandidate, ViewerResourceWindow } from '@/lib/viewer/resource-prefetch';

const ProductViewer = dynamic(() => import('../ProductViewer'), { ssr: false, loading: () => <div className="scene-shell catalog-viewer-chunk"><ViewerLoading /></div> });

export default function ProductVisual({ catalog, releaseId, seed, slot, variant, display3d, display2d, image2d, model, resourceDisplays, backgroundState, backgroundConfig, onViewerUnavailable }: {
  catalog: CatalogData; releaseId: string; seed: string; slot: PackagingSlot; variant: ProductVariant;
  display3d?: Display3D; display2d?: Display2D; image2d?: MediaAsset; model?: Model3D;
  resourceDisplays?: readonly (Display3D | null)[];
  backgroundState: BackgroundRenderState; backgroundConfig: BackgroundConfig; onViewerUnavailable: () => void;
}) {
  const { locale, t } = useLanguage();
  const copy = heroCopy(locale);
  const [failedDisplay, setFailedDisplay] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const renderKey = `${releaseId}:${variant.id}:${display3d?.revision ?? 0}`;
  const scene = useMemo(() => display3d ? resolveDisplay3D(catalog, display3d, `${releaseId}:${seed}`) : null, [catalog, display3d, releaseId, seed]);
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
    return { ready: window.ready.flatMap(candidateFor), files: window.files.flatMap(candidateFor) };
  }, [catalog, display3d, releaseId, resourceDisplays, scene, seed, slot.mode, variant.id]);
  const canUse3d = slot.mode !== '2d' && scene && failedDisplay !== renderKey;
  // Aloe uses a white liquid reservoir with internal refraction. Its scene
  // never needs the optional per-frame capture of rear artwork or accents.
  const whiteLiquid = scene?.asset.materialSlots?.liquid?.includes('Aloe Vera Water');
  const needsBackdrop = !whiteLiquid && (scene?.accentScene.enabled && scene.accentScene.nodes.some(node => node.enabled && !node.assetUrl && (node.kind === 'droplet' || node.kind === 'ice')));
  const poster = model ? catalog.media.find(item => item.id === model.posterId && item.role === 'poster' && item.lifecycle === 'active' && item.status === 'ready') : undefined;
  const candidates = [image2d, ...(slot.mode !== '2d' ? [poster] : [])].filter((item): item is MediaAsset => Boolean(item));
  const fallback = candidates.find(item => !failedImages.includes(mediaUrl(item)));
  const fallbackUrl = fallback ? mediaUrl(fallback) : '';
  if (canUse3d) return <ProductViewer asset={scene.asset} appearance={scene.appearance} resourceWindow={resourceWindow} accentScene={scene.accentScene} loadingFallback={<ViewerLoading />} backdrop={needsBackdrop ? { state: backgroundState, config: backgroundConfig } : undefined} onStatus={status => { if (status.phase === 'error' && status.assetId === scene.asset.id) { setFailedDisplay(renderKey); onViewerUnavailable(); } }} />;
  const isReference = Boolean(fallback && fallback.id === poster?.id && fallback.id !== image2d?.id);
  return <figure className="catalog-product-image" aria-label={variant.name}>
    {fallbackUrl ? <Image src={fallbackUrl} width={fallback?.width || 900} height={fallback?.height || 1200} alt={isReference ? `${model?.name} · ${copy.poster}` : display2d?.alt || variant.name} priority unoptimized onError={() => setFailedImages(previous => previous.includes(fallbackUrl) ? previous : [...previous, fallbackUrl])} /> : <div className="catalog-product-unavailable" role="status"><Box size={64} strokeWidth={1} /><p>{candidates.length ? copy.unavailable : copy.empty}</p></div>}
    <figcaption>{failedDisplay === renderKey && <span>{t('viewer.unavailable')}</span>}{fallbackUrl && <span>{isReference ? copy.poster : copy.image}</span>}</figcaption>
  </figure>;
}
