'use client';

import { useEffect, useMemo, useRef } from 'react';
import { backgroundConfig, backgroundThemes, normalizeBackgroundConfig, normalizeBackgroundThemes, type BackgroundConfig, type BackgroundTheme } from '@/lib/background-config';
import { BackgroundRenderState } from '@/lib/background-render-state';
import BackgroundPattern from './BackgroundPattern';
import { BackgroundAutodrift, backgroundPointerVelocity } from '@/lib/background-motion';

export default function FlavorBackground({ flavorIndex, themes = backgroundThemes, config = backgroundConfig, renderState }: { flavorIndex: number; themes?: readonly BackgroundTheme[]; config?: Partial<BackgroundConfig>; renderState: BackgroundRenderState }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settings = useMemo(() => normalizeBackgroundConfig(config), [config]);
  const normalizedThemes = useMemo(() => normalizeBackgroundThemes(themes), [themes]);
  const period = settings.cellSize * settings.iconSpacing;
  // React must preserve the painted blend; the controller advances selection on RAF.
  // Stable IDs also preserve that blend before a reordered catalog effect runs.
  const weightsById = new Map(renderState.themes.map((theme, i) => [theme.id, renderState.weights[i]]));
  const visibleWeights = normalizedThemes.map(theme => weightsById.get(theme.id) ?? 0);
  const hasVisibleTheme = visibleWeights.some(weight => weight > 0);
  const opacity = (i: number) => hasVisibleTheme ? visibleWeights[i] : flavorIndex === i ? 1 : 0;

  useEffect(() => {
    const now = performance.now();
    renderState.setThemes(normalizedThemes, now);
    renderState.setFlavor(flavorIndex, now, false);
  }, [flavorIndex, normalizedThemes, renderState]);

  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const hero = root?.parentElement;
    if (!root || !track || !hero) return;
    const colorLayers = root.querySelectorAll<HTMLElement>('.flavor-background-color');
    const patternLayers = root.querySelectorAll<HTMLElement>('.flavor-background-pattern');
    const fine = matchMedia('(pointer: fine)');
    const autodrift = new BackgroundAutodrift(settings);
    let targetAngle = 0, angle = 0, targetSpeed = 0, speed = 0;
    let x = renderState.patternOffset.x % period, y = renderState.patternOffset.y % period;
    renderState.setPatternOffset(x, y);
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
      renderState.advance(now, false);
      colorLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
      patternLayers.forEach((layer, i) => { layer.style.opacity = String(renderState.weights[i]); });
      track.style.transform = `translate3d(${x}px,${y}px,0)`;
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
      else {
        renderState.advance(performance.now(), false);
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
    fine.addEventListener('change', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderState.setWake(undefined);
      hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', releasePointer);
      hero.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releasePointer);
      document.removeEventListener('visibilitychange', sync);
      fine.removeEventListener('change', sync);
    };
  }, [settings, period, renderState, normalizedThemes]);

  return <div ref={rootRef} className="flavor-background" aria-hidden="true">
    {normalizedThemes.map((theme, i) => <div key={theme.id} className="flavor-background-color" style={{ backgroundColor: theme.color, opacity: opacity(i) }} />)}
    <div ref={trackRef} className="flavor-background-track" style={{ inset: -period }}>
      {normalizedThemes.map((theme, i) => <BackgroundPattern key={theme.id} className="flavor-background-pattern" theme={theme} config={settings} opacity={opacity(i)} />)}
    </div>
    <div className="flavor-background-light" />
    <div className="product-backlight" />
  </div>;
}
