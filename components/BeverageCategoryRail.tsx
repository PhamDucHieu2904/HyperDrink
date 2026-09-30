'use client';

import { useEffect, useRef } from 'react';
import { beverageLines, type BeverageLineId } from '@/lib/beverage-lines';

/** Discrete 3s steps with critically damped movement, not a continuous marquee. */
export default function BeverageCategoryRail({ selected, onSelect }: {
  selected: BeverageLineId | null;
  onSelect: (id: BeverageLineId) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current, track = trackRef.current;
    if (!root || !track) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let x = 0, target = 0, speed = 0, elapsed = 0, last = 0, frame = 0, index = 0;
    let period = 0, steps: number[] = [], hovering = false, focused = false, visible = true;
    const measure = () => {
      const set = track.querySelector<HTMLElement>('.category-set');
      if (!set) return;
      const items = Array.from(set.children) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      period = set.offsetWidth + gap;
      steps = items.map((item, i) => (items[i + 1]?.offsetLeft ?? period) - item.offsetLeft);
      x = target = speed = elapsed = index = 0;
      track.style.transform = 'translate3d(0,0,0)';
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000 || 0, .05); last = now;
      if (!hovering && !focused && period && steps.length) {
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
      if (!motion.matches && visible && !document.hidden) frame = requestAnimationFrame(tick);
      else if (motion.matches) { measure(); }
    };
    const enter = () => { hovering = true; }, leave = () => { hovering = false; };
    const pointer = () => { focused = false; };
    const focus = (event: FocusEvent) => {
      const item = event.target;
      if (!(item instanceof HTMLButtonElement) || !item.matches(':focus-visible')) return;
      focused = true;
      if (!motion.matches) {
        const set = track.querySelector('.category-set');
        const items = set ? Array.from(set.children) : [];
        const focusedIndex = items.indexOf(item);
        if (focusedIndex >= 0) {
          index = focusedIndex; x = target = item.offsetLeft; speed = elapsed = 0;
          root.scrollLeft = 0;
          track.style.transform = `translate3d(${-x}px,0,0)`;
        }
      }
    };
    const blur = (event: FocusEvent) => { if (!root.contains(event.relatedTarget as Node)) focused = false; };
    const resize = new ResizeObserver(measure); resize.observe(track);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
    intersection.observe(root);
    root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
    root.addEventListener('pointerdown', pointer);
    root.addEventListener('focusin', focus); root.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', schedule); motion.addEventListener('change', schedule);
    measure(); schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect();
      root.removeEventListener('pointerenter', enter); root.removeEventListener('pointerleave', leave);
      root.removeEventListener('pointerdown', pointer);
      root.removeEventListener('focusin', focus); root.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', schedule); motion.removeEventListener('change', schedule);
    };
  }, []);
  const renderSet = (clone = false) => <div className="category-set" aria-hidden={clone || undefined}>
    {beverageLines.map(line => <button type="button" key={line.id} tabIndex={clone ? -1 : undefined}
      aria-pressed={selected === line.id} onClick={() => onSelect(line.id)}>{line.label}</button>)}
  </div>;
  return <div ref={rootRef} className="category-rail" aria-label="Nhóm đồ uống">
    <div ref={trackRef} className="category-track">{renderSet()}{renderSet(true)}</div>
  </div>;
}
