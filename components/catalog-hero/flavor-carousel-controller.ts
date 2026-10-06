import { FlavorCarouselMotion } from '@/lib/catalog/flavor-carousel-motion';

export interface FlavorCarouselController {
  motion: FlavorCarouselMotion;
  setPaused: (paused: boolean) => void;
  setSelectedId: (id: string) => void;
  centerOn: (id: string) => void;
  dispose: () => void;
}

/** DOM boundary kept separate so pointer capture, focus and lifecycle are testable. */
export function bindFlavorCarousel({ viewport, track, firstSet, canMove, selectedId, onSelect, onCopies }: {
  viewport: HTMLDivElement; track: HTMLDivElement; firstSet: HTMLDivElement;
  canMove: boolean; selectedId: string; onSelect: (id: string) => void; onCopies: (count: number) => void;
}): FlavorCarouselController {
  const motion = new FlavorCarouselMotion(selectedId);
  let disposed = false, frame = 0, timer: ReturnType<typeof setTimeout> | null = null;
  let pointerId: number | null = null, pointerClock = 0, suppressUntil = 0, keyboardInput = false, focused = false;
  let focusedButton: HTMLButtonElement | null = null;
  let visible = !document.hidden, intersecting = true, measured = false;
  let centers: Array<{ button: HTMLButtonElement; center: number }> = [];
  const now = () => performance.now();
  const paint = () => {
    track.style.transform = `translate3d(${motion.translation}px,0,0)`;
    viewport.dataset.motion = motion.suspended ? 'paused' : motion.phase;
    viewport.dataset.dragging = String(motion.dragging);
    viewport.dataset.transforming = String(motion.transforming);
  };
  const stopSchedule = () => {
    if (frame) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = 0; timer = null;
  };
  const schedule = () => {
    if (disposed || !visible || !intersecting) return;
    if (motion.animating) { if (!frame) frame = requestAnimationFrame(tick); return; }
    const delay = motion.nextWake(now());
    if (delay !== null && timer === null) timer = setTimeout(() => { timer = null; if (disposed) return; tick(now()); }, Math.max(1, delay));
  };
  const tick = (at: number) => {
    frame = 0;
    if (disposed || !visible || !intersecting) return;
    const id = motion.tick(at);
    paint();
    if (id) onSelect(id);
    schedule();
  };
  const wake = () => { stopSchedule(); motion.resetClock(now()); paint(); schedule(); };
  const inputTime = (event: PointerEvent) => {
    const current = now();
    let at = event.timeStamp;
    if (!Number.isFinite(at) || at < 0) return current;
    // Older WebKit exposes epoch timestamps; modern PointerEvents use the performance origin.
    if (Math.abs(at - current) > 60000 && Number.isFinite(performance.timeOrigin)) at -= performance.timeOrigin;
    return at >= 0 && Math.abs(at - current) <= 60000 ? Math.min(current, at) : current;
  };
  const sampleTime = (event: PointerEvent) => { pointerClock = Math.max(pointerClock, inputTime(event)); return pointerClock; };
  const moveSamples = (event: PointerEvent): 'pending' | 'horizontal' | 'vertical' => {
    let samples: PointerEvent[] = [];
    try { samples = event.getCoalescedEvents?.() || []; } catch { /* Some browsers expose this API only for trusted secure-origin events. */ }
    // The dispatched event supplies final coordinates when a browser omits them from the batch.
    let axis: 'pending' | 'horizontal' | 'vertical' = 'pending';
    const chronological = [...samples, event].map(sample => ({ sample, at: inputTime(sample) })).sort((a, b) => a.at - b.at);
    for (const { sample, at } of chronological) {
      if (!Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) continue;
      if (at < pointerClock) continue;
      pointerClock = at;
      axis = motion.movePointer(sample.clientX, sample.clientY, at);
      if (axis === 'vertical') break;
    }
    return axis;
  };
  const releaseCapture = () => {
    const id = pointerId;
    pointerId = null;
    if (id !== null && viewport.hasPointerCapture(id)) {
      try { viewport.releasePointerCapture(id); } catch { /* A browser can release it while cancelling vertical pan. */ }
    }
  };
  const cancelGesture = () => {
    if (motion.cancelPointer(now())) suppressUntil = now() + 500;
    releaseCapture();
    wake();
  };
  const measure = () => {
    if (disposed) return;
    const bounds = firstSet.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 27;
    const period = bounds.width + gap;
    centers = Array.from(firstSet.querySelectorAll<HTMLButtonElement>('button[data-carousel-item]')).map(button => {
      const rect = button.getBoundingClientRect();
      return { button, center: rect.left - bounds.left + rect.width / 2 };
    });
    motion.setGeometry({ period, viewportWidth: viewport.clientWidth, canMove, centers: centers.map(item => ({ id: item.button.dataset.variantId || null, center: item.center })) }, now());
    if (!measured && bounds.width > 0) {
      motion.centerOn(selectedId, now());
      motion.startAuto(now());
      measured = true;
    }
    const active = centers.find(item => item.button === document.activeElement)?.button;
    const retained = centers.find(item => item.button === focusedButton)?.button;
    if ((focused && retained) || active?.matches(':focus-visible')) {
      keyboardInput = true;
      focusButton(active || retained!);
    } else if (focused && !retained) {
      focused = false; focusedButton = null;
      motion.setFocused(false, now());
    }
    onCopies(canMove && period > 0 ? Math.max(3, Math.ceil(viewport.clientWidth / period) + 2) : 1);
    wake();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    keyboardInput = false;
    focused = false;
    focusedButton = null;
    motion.setFocused(false, now());
    suppressUntil = 0;
    pointerId = event.pointerId;
    pointerClock = inputTime(event);
    motion.beginPointer(event.clientX, event.clientY, pointerClock);
    event.stopPropagation();
    // Leave taps on their real button. Capture only once horizontal dragging wins.
    wake();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const axis = moveSamples(event);
    if (axis === 'vertical') { suppressUntil = now() + 500; releaseCapture(); wake(); return; }
    event.stopPropagation();
    if (axis === 'horizontal') {
      if (!viewport.hasPointerCapture(event.pointerId)) { try { viewport.setPointerCapture(event.pointerId); } catch { cancelGesture(); return; } }
      if (event.cancelable) event.preventDefault();
      paint();
      const id = motion.consumeSelection();
      if (id) onSelect(id);
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    event.stopPropagation();
    // The final coordinates can arrive without a last pointermove.
    const axis = moveSamples(event);
    const id = axis === 'horizontal' ? motion.consumeSelection() : null;
    const release = motion.endPointer(sampleTime(event));
    if (release.dragged) suppressUntil = now() + 500;
    releaseCapture();
    wake();
    if (id) onSelect(id);
  };
  const onWindowPointerMove = (event: PointerEvent) => { if (!viewport.contains(event.target as Node)) onPointerMove(event); };
  const onPointerCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) cancelGesture(); };
  const onLostPointerCapture = (event: PointerEvent) => {
    // Touch starts with implicit capture on its button. Its capture-loss bubbles here
    // when control moves to the viewport; only losing our own capture cancels dragging.
    if (event.target === viewport && event.pointerId === pointerId) cancelGesture();
  };
  const onClickCapture = (event: MouseEvent) => {
    const pointerType = (event as PointerEvent).pointerType;
    const touchSource = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
    if ((event.detail > 0 || Boolean(pointerType) || touchSource) && now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const onDragStart = (event: DragEvent) => event.preventDefault();
  const focusButton = (button: HTMLButtonElement) => {
    const item = centers.find(item => item.button === button);
    if (!item) return;
    focused = true;
    focusedButton = button;
    motion.setFocused(true, now());
    motion.alignCenter(item.center, now());
    wake();
  };
  const originalButton = (button: HTMLButtonElement) => firstSet.contains(button) ? button : centers.find(item => item.button.dataset.variantId === button.dataset.variantId)?.button;
  const onFocusIn = (event: FocusEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-carousel-item]');
    if (button && (keyboardInput || button.matches(':focus-visible'))) {
      const original = originalButton(button);
      if (original && original !== button) original.focus({ preventScroll: true });
      else if (original) focusButton(original);
    }
  };
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget && viewport.contains(event.relatedTarget as Node)) return;
    if (focused) { focused = false; focusedButton = null; motion.setFocused(false, now()); wake(); }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    keyboardInput = true;
    if (!viewport.contains(event.target as Node)) return;
    if (event.key === 'Escape' && pointerId !== null) { cancelGesture(); return; }
    const targetButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-carousel-item]');
    const button = targetButton && originalButton(targetButton);
    if (!button) return;
    if (button !== targetButton) button.focus({ preventScroll: true });
    focusButton(button);
    const index = centers.findIndex(item => item.button === button);
    const next = event.key === 'ArrowLeft' ? (index - 1 + centers.length) % centers.length : event.key === 'ArrowRight' ? (index + 1) % centers.length : event.key === 'Home' ? 0 : event.key === 'End' ? centers.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); centers[next].button.focus({ preventScroll: true }); }
  };
  const onVisibility = () => {
    visible = !document.hidden;
    if (!visible) { cancelGesture(); stopSchedule(); }
    else wake();
  };
  const onWindowBlur = () => { cancelGesture(); visible = false; stopSchedule(); };
  const onWindowFocus = () => { visible = !document.hidden; wake(); };
  const resize = new ResizeObserver(measure);
  resize.observe(viewport); resize.observe(firstSet);
  const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    if (!intersecting) { cancelGesture(); stopSchedule(); } else wake();
  });
  intersection?.observe(viewport);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove, { passive: false });
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerCancel);
  viewport.addEventListener('lostpointercapture', onLostPointerCapture);
  viewport.addEventListener('click', onClickCapture, true);
  viewport.addEventListener('dragstart', onDragStart);
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('focusout', onFocusOut);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  measure();

  return {
    motion,
    setPaused: value => { motion.setPaused(value, now()); wake(); },
    setSelectedId: id => motion.setSelectedId(id),
    centerOn: id => { motion.centerOn(id, now()); wake(); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopSchedule();
      motion.cancelPointer(now());
      releaseCapture();
      resize.disconnect(); intersection?.disconnect();
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('lostpointercapture', onLostPointerCapture);
      viewport.removeEventListener('click', onClickCapture, true);
      viewport.removeEventListener('dragstart', onDragStart);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
