'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { createSceneResourcePlan } from '@/lib/catalog/scene-resource-plan';
import { decodeHomepageLayout } from '@/lib/catalog/homepage-layout';
import { publicUrl } from '@/lib/public-url';
import { createSceneResourceLoader, INITIAL_SCENE_PROGRESS } from '@/lib/viewer/scene-resources';

const subscribePreview = () => () => {};
const readPreview = () => new URLSearchParams(window.location.search).get('layoutTest') ?? '';
const serverPreview = () => '';

export default function useSceneResources(catalog: CatalogData, products: StorefrontProduct[], releaseId: string) {
  const [progress, setProgress] = useState(INITIAL_SCENE_PROGRESS);
  const loader = useRef<ReturnType<typeof createSceneResourceLoader> | null>(null);
  const firstProductReady = useRef(false);
  const preview = useSyncExternalStore(subscribePreview, readPreview, serverPreview);
  const planSignature = useMemo(() => JSON.stringify(createSceneResourcePlan(catalog, products, decodeHomepageLayout(preview))), [catalog, products, preview]);
  useEffect(() => {
    let live = true;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const handle = createSceneResourceLoader(JSON.parse(planSignature), {
      cacheKey: releaseId,
      concurrency: connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '') ? 1 : 2,
      onProgress: value => { if (live) setProgress(value); },
    });
    loader.current = handle;
    const resume = () => handle.setEnabled(firstProductReady.current && !document.hidden);
    const retry = () => { if (handle.snapshot().phase === 'error') handle.retry(); resume(); };
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', retry);
    // Wait for the selected model AND its required label to finish first.
    queueMicrotask(() => { if (live) resume(); });
    return () => {
      live = false; loader.current = null; handle.dispose();
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', retry);
    };
  }, [planSignature, releaseId]);
  const onViewerReady = useCallback(() => {
    firstProductReady.current = true;
    loader.current?.setEnabled(!document.hidden);
  }, []);
  const acquireUrl = useCallback((original: string) => loader.current?.acquireUrl(original) ?? { url: publicUrl(original), release() {} }, []);
  const retry = useCallback(() => loader.current?.retry(), []);
  return { progress, acquireUrl, onViewerReady, retry };
}
