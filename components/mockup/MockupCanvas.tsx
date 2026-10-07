'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ProductAsset, ProductAppearance } from '@/lib/viewer-config';
import type { MockupAnimation, MockupBackground, MockupFocalPreset, MockupRuntime, MockupStatus } from '@/lib/mockup/contracts';
import styles from './mockup.module.css';

export interface MockupCanvasHandle {
  zoom: (factor: number) => void;
  reset: () => void;
  capture: (options: { longEdge: 1024 | 2048; aspect: number; signal?: AbortSignal }) => Promise<Blob>;
}
interface Props {
  asset: ProductAsset; appearance?: ProductAppearance; frontYaw?: number;
  background: MockupBackground; animation: MockupAnimation; aspect: number; focal: MockupFocalPreset;
  label: string; onStatus: (status: MockupStatus) => void; onInteraction: () => void; onReset: () => void; retry: number; locked: boolean;
}

const MockupCanvas = forwardRef<MockupCanvasHandle, Props>(function MockupCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<MockupRuntime | null>(null);
  const currentStatus = useRef<MockupStatus | null>(null);
  const latest = useRef(props);
  useEffect(() => { latest.current = props; });
  useImperativeHandle(ref, () => ({
    zoom: factor => runtime.current?.zoom(factor),
    reset: () => runtime.current?.resetView(),
    capture: options => runtime.current ? runtime.current.capture(options) : Promise.reject(new Error('Studio is still preparing.')),
  }), []);
  useEffect(() => {
    let live = true;
    void import('@/lib/mockup/runtime').then(({ createMockupRuntime }) => {
      if (!live || !host.current) return;
      const controller = createMockupRuntime(host.current, {
        onStatus: status => { currentStatus.current = status; if (live) latest.current.onStatus(status); },
        onInteraction: () => latest.current.onInteraction(),
      });
      runtime.current = controller;
      const next = latest.current;
      controller.setAspect(next.aspect); controller.setFocalLength(next.focal); controller.setBackground(next.background); controller.setAnimation(next.animation);
      controller.select(next.asset, next.appearance, next.frontYaw);
    }).catch(() => {
      if (live) latest.current.onStatus({ phase: 'error', assetId: latest.current.asset.id, revision: 0, hasProduct: false, error: 'webgl' });
    });
    return () => { live = false; runtime.current?.dispose(); runtime.current = null; };
  }, [props.retry]);
  useEffect(() => { runtime.current?.select(props.asset, props.appearance, props.frontYaw); }, [props.asset, props.appearance, props.frontYaw]);
  useEffect(() => { runtime.current?.setBackground(props.background); }, [props.background]);
  useEffect(() => { runtime.current?.setAnimation(props.animation); }, [props.animation]);
  useEffect(() => { runtime.current?.setAspect(props.aspect); }, [props.aspect]);
  useEffect(() => { runtime.current?.setFocalLength(props.focal); }, [props.focal]);
  return <div ref={host} className={styles.canvas} role="group" aria-label={props.label} tabIndex={0} onKeyDown={event => {
    if (latest.current.locked || !currentStatus.current?.hasProduct || currentStatus.current.phase === 'exporting' || !runtime.current) return;
    const key = event.key, step = Math.PI / 36;
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_','r','R'].includes(key)) return;
    event.preventDefault();
    if (key === 'ArrowLeft') runtime.current.orbitView(-step, 0);
    else if (key === 'ArrowRight') runtime.current.orbitView(step, 0);
    else if (key === 'ArrowUp') runtime.current.orbitView(0, -step);
    else if (key === 'ArrowDown') runtime.current.orbitView(0, step);
    else if (key === '+' || key === '=') runtime.current.zoom(1.15);
    else if (key === '-' || key === '_') runtime.current.zoom(1 / 1.15);
    else { runtime.current.resetView(); latest.current.onReset(); }
  }} />;
});

export default MockupCanvas;
