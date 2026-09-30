'use client';

import { useEffect, useMemo, useRef } from 'react';
import { backgroundConfig, backgroundThemes, normalizeBackgroundConfig, type BackgroundConfig } from '@/lib/background-config';
import { BackgroundRenderState, backgroundTileUrl } from '@/lib/background-render-state';
import { backgroundPointerVelocity } from '@/lib/background-motion';

export default function FlavorBackground({ flavorIndex, config = backgroundConfig, renderState }: { flavorIndex: number; config?: Partial<BackgroundConfig>; renderState: BackgroundRenderState }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settings = useMemo(() => normalizeBackgroundConfig(config), [config]);
  const period = settings.cellSize * settings.iconSpacing;

  useEffect(() => {
    renderState.setFlavor(flavorIndex, performance.now(), matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, [flavorIndex, renderState]);

  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const hero = root?.parentElement;
    if (!root || !track || !hero) return;
    const colorLayers = root.querySelectorAll<HTMLElement>('.flavor-background-color');
    const patternLayers = root.querySelectorAll<HTMLElement>('.flavor-background-pattern');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(pointer: fine)');
    let targetAngle = 0, angle = 0, targetSpeed = 0, speed = 0, x = 0, y = 0;
    let hasDirection = false;
    let frame = 0, last = 0, visible = true;
    const reset = () => { targetSpeed = 0; };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !fine.matches || !settings.enabled) return;
      const rect = hero.getBoundingClientRect();
      const centerY = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - centerY;
      const velocity = backgroundPointerVelocity(dx, dy, settings.maxSpeed);
      targetSpeed = Math.hypot(velocity.x, velocity.y);
      if (targetSpeed) {
        targetAngle = Math.atan2(velocity.y, velocity.x);
        if (!hasDirection) { angle = targetAngle; hasDirection = true; }
      }
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, .05);
      last = now;
      const blend = 1 - Math.exp(-dt / settings.dampingSeconds);
      // Dampen direction separately so steering does not reduce travel speed.
      const angleDelta = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
      angle += angleDelta * blend;
      speed += (targetSpeed - speed) * blend;
      x = (x + Math.cos(angle) * speed * dt) % period;
      y = (y + Math.sin(angle) * speed * dt) % period;
      renderState.advance(now, motion.matches);
      colorLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
      patternLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
      track.style.transform = `translate3d(${x}px,${y}px,0)`;
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
      else {
        renderState.advance(performance.now(), motion.matches);
        colorLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
        patternLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
      }
    };
    const sync = () => {
      reset(); last = 0; speed = 0; hasDirection = false;
      schedule();
    };
    // A flavor transition wakes the renderer without stopping background movement.
    renderState.setWake(schedule);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(hero);
    hero.addEventListener('pointermove', move, { passive: true });
    hero.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync); fine.addEventListener('change', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderState.setWake(undefined);
      hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync); fine.removeEventListener('change', sync);
    };
  }, [settings, period, renderState]);

  return <div ref={rootRef} className="flavor-background" aria-hidden="true">
    {backgroundThemes.map((theme, i) => <div key={theme.icon} className="flavor-background-color" style={{ backgroundColor: theme.color, opacity: flavorIndex === i ? 1 : 0 }} />)}
    <div ref={trackRef} className="flavor-background-track" style={{ inset: -period }}>
      {backgroundThemes.map((theme, i) => <div key={theme.icon} className="flavor-background-pattern" style={{ backgroundImage: `url("${backgroundTileUrl(theme.icon, settings)}")`, backgroundSize: `${period}px ${period}px`, opacity: flavorIndex === i ? 1 : 0 }} />)}
    </div>
    <div className="flavor-background-light" />
    <div className="product-backlight" />
  </div>;
}
