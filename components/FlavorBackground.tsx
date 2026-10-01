'use client';

import { useEffect, useMemo, useRef } from 'react';
import { backgroundConfig, backgroundThemes, normalizeBackgroundConfig, type BackgroundConfig } from '@/lib/background-config';
import { BackgroundRenderState, backgroundTileUrl } from '@/lib/background-render-state';
import { BackgroundAutodrift, backgroundPointerVelocity } from '@/lib/background-motion';

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
    const autodrift = new BackgroundAutodrift(settings);
    let targetAngle = 0, angle = 0, targetSpeed = 0, speed = 0, x = 0, y = 0;
    renderState.setPatternOffset(0, 0);
    let hasDirection = false, pointerPresent = false;
    let frame = 0, last = performance.now(), visible = true;
    const releasePointer = () => {
      pointerPresent = false;
      autodrift.reset();
      targetSpeed = settings.enabled && settings.autoDriftEnabled ? settings.maxSpeed : 0;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !fine.matches || !settings.enabled) return;
      const rect = hero.getBoundingClientRect();
      const centerY = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - centerY;
      const velocity = backgroundPointerVelocity(dx, dy, settings.maxSpeed);
      pointerPresent = true;
      targetSpeed = Math.hypot(velocity.x, velocity.y);
      // At the exact center there is no steering direction, so keep autonomous travel.
      if (!targetSpeed) { releasePointer(); return; }
      if (targetSpeed) {
        targetAngle = Math.atan2(velocity.y, velocity.x);
        if (!hasDirection) { angle = targetAngle; hasDirection = true; }
      }
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, .05);
      last = now;
      if (!pointerPresent) {
        targetSpeed = settings.enabled && settings.autoDriftEnabled ? settings.maxSpeed : 0;
        if (targetSpeed) {
          targetAngle = autodrift.direction(now / 1000);
          if (!hasDirection) { angle = targetAngle; hasDirection = true; }
        }
      }
      const blend = 1 - Math.exp(-dt / settings.dampingSeconds);
      // Dampen direction separately so steering does not reduce travel speed.
      const angleDelta = Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle));
      angle += angleDelta * blend;
      speed += (targetSpeed - speed) * blend;
      x = (x + Math.cos(angle) * speed * dt) % period;
      y = (y + Math.sin(angle) * speed * dt) % period;
      renderState.setPatternOffset(x, y);
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
      releasePointer(); last = performance.now(); speed = targetSpeed;
      schedule();
    };
    // A flavor transition wakes the renderer without stopping background movement.
    renderState.setWake(schedule);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(hero);
    hero.addEventListener('pointermove', move, { passive: true });
    hero.addEventListener('pointerleave', releasePointer);
    hero.addEventListener('pointercancel', releasePointer);
    // A visible page must drift even before the browser window gains input focus.
    // Blur relinquishes mouse steering; tab visibility/intersection owns suspension.
    window.addEventListener('blur', releasePointer);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync); fine.addEventListener('change', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderState.setWake(undefined);
      hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', releasePointer);
      hero.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releasePointer);
      document.removeEventListener('visibilitychange', sync);
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
