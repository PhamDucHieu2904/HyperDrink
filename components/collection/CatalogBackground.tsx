'use client';

import { useEffect, useRef } from 'react';
import { backgroundConfig, normalizeBackgroundConfig } from '@/lib/background-config';
import { BackgroundAutodrift, backgroundPointerVelocity } from '@/lib/background-motion';
import { backgroundTileUrl } from '@/lib/background-render-state';

// Keep the home page's grid proportions and leaf artwork, with quieter catalog colors.
const settings = normalizeBackgroundConfig({
  ...backgroundConfig,
  cellSize: 88,
  iconSize: 32,
  iconSpacing: 3,
  lineOpacity: .12,
  iconOpacity: .23,
  maxSpeed: 9,
  autoDirectionMinSeconds: 8,
  autoDirectionMaxSeconds: 16,
});
const period = settings.cellSize * settings.iconSpacing;
const source = backgroundTileUrl('leaf', settings);
const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1)).replaceAll('stroke="white"', 'stroke="#347967"');
const tileUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;

export default function CatalogBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const page = root?.parentElement;
    if (!root || !track || !page) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(pointer: fine)');
    const drift = new BackgroundAutodrift(settings);
    let frame = 0;
    let visible = true;
    let last = 0;
    let elapsed = 0;
    let x = 0;
    let y = 0;
    let angle = 0;
    let pointerAngle: number | undefined;
    const releasePointer = () => {
      pointerAngle = undefined;
      drift.reset();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !fine.matches || reduced.matches) return;
      const rect = page.getBoundingClientRect();
      const centerY = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const velocity = backgroundPointerVelocity(event.clientX - (rect.left + rect.width / 2), event.clientY - centerY, settings.maxSpeed);
      if (!velocity.x && !velocity.y) { releasePointer(); return; }
      pointerAngle = Math.atan2(velocity.y, velocity.x);
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, .05);
      last = now;
      elapsed += dt;
      const targetAngle = pointerAngle ?? drift.direction(elapsed);
      const delta = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
      angle += delta * (1 - Math.exp(-dt / settings.dampingSeconds));
      x = (x + Math.cos(angle) * settings.maxSpeed * dt) % period;
      y = (y + Math.sin(angle) * settings.maxSpeed * dt) % period;
      track.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      releasePointer();
      cancelAnimationFrame(frame);
      frame = 0;
      if (visible && !document.hidden && !reduced.matches) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(root);
    page.addEventListener('pointermove', move, { passive: true });
    page.addEventListener('pointerleave', releasePointer);
    page.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', releasePointer);
    fine.addEventListener('change', sync);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      page.removeEventListener('pointermove', move);
      page.removeEventListener('pointerleave', releasePointer);
      page.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releasePointer);
      fine.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return <div ref={rootRef} className="catalog-background" aria-hidden="true">
    <div ref={trackRef} className="catalog-background__pattern" style={{ inset: -period, backgroundImage: `url("${tileUrl}")`, backgroundSize: `${period}px ${period}px` }} />
    <div className="catalog-background__wash" />
  </div>;
}
