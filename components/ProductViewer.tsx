'use client';

import { useEffect, useRef, useState } from 'react';
import { publicUrl } from '@/lib/public-url';
import { Box } from 'lucide-react';
import { ProductAppearance, ProductAsset, resolveViewerPresentation, ViewerPresentationInput } from '@/lib/viewer-config';
import { createProductViewer, ProductViewerController, ViewerStatus } from '@/lib/viewer/runtime';
import type { AccentFlavor, ProductAccentSceneInput } from '@/lib/viewer/accent-config';
import type { ProductViewerBackdropInput } from '@/lib/viewer/backdrop-texture';
import { useLanguage } from './LanguageProvider';
import { trackUsage } from '@/lib/operations/client';

export interface ProductViewerProps {
  asset: ProductAsset;
  appearance?: ProductAppearance;
  presentation?: ViewerPresentationInput;
  paused?: boolean;
  resetKey?: string | number;
  onStatus?: (status: ViewerStatus) => void;
  accentScene?: ProductAccentSceneInput;
  accentFlavor?: AccentFlavor;
  backdrop?: ProductViewerBackdropInput;
  /** Optional presentation for the first load; the model poster remains an error fallback. */
  loadingFallback?: React.ReactNode;
}

/** Generic container: geometry, appearance and lighting are independent data contracts. */
export default function ProductViewer({ asset, appearance, presentation, paused = false, resetKey, onStatus, accentScene, accentFlavor = 'citrus', backdrop, loadingFallback }: ProductViewerProps) {
  const { t } = useLanguage();
  const mountRef = useRef<HTMLDivElement>(null);
  const lastInteraction = useRef(0);
  const reportInteraction = () => {if(Date.now()-lastInteraction.current<3000)return;lastInteraction.current=Date.now();trackUsage('model_interact',asset.id);};
  const controller = useRef<ProductViewerController | null>(null);
  const latest = useRef({ asset, appearance, presentation, paused, onStatus, accentScene, accentFlavor, backdrop });
  const [status, setStatus] = useState<ViewerStatus>({ phase: 'loading', assetId: asset.id });
  // Plain JSON signatures prevent reinitializing WebGL when parents rebuild objects.
  const assetSignature = JSON.stringify(asset);
  const appearanceSignature = JSON.stringify(appearance ?? null);
  const presentationSignature = JSON.stringify(presentation ?? null);
  const accentSignature = JSON.stringify(accentScene ?? null);
  const accentKey = `${asset.id}:${appearance?.id ?? ''}`;
  const backdropSignature = JSON.stringify(backdrop?.config ?? null);

  useEffect(() => { latest.current = { asset, appearance, presentation, paused, onStatus, accentScene, accentFlavor, backdrop }; });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let live = true;
    const publish = (value: ViewerStatus) => {
      if (!live) return;
      setStatus(value);
      latest.current.onStatus?.(value);
    };
    try {
      controller.current = createProductViewer(mount, resolveViewerPresentation(latest.current.presentation), publish);
      controller.current.backdrop(latest.current.backdrop);
      controller.current.accents(latest.current.accentScene, `${latest.current.asset.id}:${latest.current.appearance?.id ?? ''}`, latest.current.accentFlavor);
      controller.current.pause(latest.current.paused);
      controller.current.select(latest.current.asset, latest.current.appearance);
    } catch {
      // Defer the exception fallback out of the mount effect's synchronous path.
      queueMicrotask(() => publish({ phase: 'error', assetId: latest.current.asset.id, message: 'Thiết bị chưa hỗ trợ chế độ 3D.' }));
    }
    return () => {
      live = false;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.select(latest.current.asset, latest.current.appearance);
  }, [assetSignature, appearanceSignature]);
  useEffect(() => {
    controller.current?.configure(resolveViewerPresentation(latest.current.presentation));
  }, [presentationSignature]);
  useEffect(() => {
    controller.current?.accents(latest.current.accentScene, accentKey, latest.current.accentFlavor);
  }, [accentSignature, accentKey, accentFlavor]);
  useEffect(() => { controller.current?.backdrop(latest.current.backdrop); }, [backdrop?.state, backdropSignature]);
  useEffect(() => { controller.current?.pause(paused); }, [paused]);
  useEffect(() => { if (resetKey !== undefined) controller.current?.reset(); }, [resetKey]);

  const loading = status.phase === 'loading';
  const failed = status.phase === 'error';
  const showFallback = (loading || failed) && !status.hasProduct && status.assetId === asset.id;
  const customLoading = loading && !status.hasProduct && loadingFallback !== undefined;
  return (
    <div className="scene-shell product-viewer" ref={mountRef} role="group" aria-roledescription={t('viewer.description')} onPointerDownCapture={reportInteraction} onKeyDownCapture={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))reportInteraction();}}
      aria-label={t('viewer.controls', { name: asset.packaging === 'can' ? t('viewer.canName', { volume: asset.volumeMl ?? '' }) : asset.name })}
      aria-busy={loading} data-packaging={asset.packaging} data-asset-id={asset.id}
      data-viewer-status={status.phase} data-environment-ready={status.environmentReady ? 'true' : 'false'}>
      {customLoading ? loadingFallback : showFallback && <div className="scene-fallback" aria-hidden="true">
        {asset.poster
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={publicUrl(asset.poster)} alt="" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
          : <Box size={60} strokeWidth={1} style={{ opacity: 0.45 }} />}
      </div>}
      {loading && !customLoading && <span className="scene-loading" aria-live="polite">{t('viewer.loading')}</span>}
      {failed && <span className="scene-error" role="status">{t('viewer.unavailable')}</span>}
    </div>
  );
}
