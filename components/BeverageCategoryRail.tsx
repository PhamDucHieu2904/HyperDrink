'use client';

import { useEffect, useRef } from 'react';
import { beverageLines } from '@/lib/beverage-lines';
import { useLanguage } from './LanguageProvider';

/** Discrete 3s steps with critically damped movement, not a continuous marquee. */
export default function BeverageCategoryRail() {
  const { t, locale } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current, track = trackRef.current;
    if (!root || !track) return;
    let x = 0, target = 0, speed = 0, elapsed = 0, last = 0, frame = 0, index = 0;
    let period = 0, steps: number[] = [], hovering = false, visible = true;
    let overflow = false;
    const measure = () => {
      const set = track.querySelector<HTMLElement>('.category-set');
      if (!set) return;
      const items = Array.from(set.children) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      period = set.offsetWidth + gap;
      overflow = set.offsetWidth > root.clientWidth;
      root.dataset.overflow = String(overflow);
      steps = items.map((item, i) => (items[i + 1]?.offsetLeft ?? period) - item.offsetLeft);
      x = target = speed = elapsed = index = 0;
      track.style.transform = 'translate3d(0,0,0)';
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, .05); last = now;
      if (overflow && !hovering && period && steps.length) {
        elapsed += dt;
        if (elapsed >= 3) { elapsed -= 3; target += steps[index]; index = (index + 1) % steps.length; }
        // Analytic critically damped spring, stable at different refresh rates.
        const omega = 9, decay = Math.exp(-omega * dt), delta = x - target;
        const impulse = speed + omega * delta;
        x = target + (delta + impulse * dt) * decay;
        speed = (speed - omega * impulse * dt) * decay;
        if (x >= period) { x -= period; target -= period; }
        track.style.transform = `translate3d(${-x}px,0,0)`;
      }
      frame = requestAnimationFrame(tick);
    };
    const schedule = () => {
      cancelAnimationFrame(frame); last = 0;
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const enter = () => { hovering = true; }, leave = () => { hovering = false; };
    const resize = new ResizeObserver(measure); resize.observe(track); resize.observe(root);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
    intersection.observe(root);
    root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', schedule);
    measure(); schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect();
      root.removeEventListener('pointerenter', enter); root.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [locale]);
  const renderSet = (clone = false) => <div className="category-set" aria-hidden={clone || undefined}>
    {beverageLines.map(line => <span className="category-tag" key={line.id}>{t(`category.${line.id}`)}</span>)}
  </div>;
  return <div ref={rootRef} className="category-rail" role="region" aria-label={t('category.label')}>
    <div ref={trackRef} className="category-track">{renderSet()}{renderSet(true)}</div>
  </div>;
}
