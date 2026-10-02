export interface FlavorCarouselCenter { id: string | null; center: number }
export interface FlavorCarouselGeometry { period: number; viewportWidth: number; centers: FlavorCarouselCenter[]; canMove: boolean }
export type FlavorCarouselPhase = 'auto' | 'drag' | 'flick' | 'rest' | 'static';
export interface FlavorCarouselRelease { dragged: boolean; flick: boolean; velocity: number }

export const flavorCarouselSettings = {
  autoSpeed: 24, dragThreshold: 6, flickDistance: 96, recentDistance: 96,
  flickVelocity: 1600, selectionVelocity: 1000, minVelocityDurationMs: 60,
  stationaryResetMs: 24,
  maxVelocity: 2600, recentWindowMs: 140, freshReleaseMs: 60,
  deceleration: 1100, stopVelocity: 18, resumeDelayMs: 1000,
} as const;

type CarouselPointer = {
  x: number; y: number; offset: number; lastX: number; lastMovement: number;
  dragged: boolean; fast: boolean; samples: Array<{ x: number; at: number }>;
};

export function carouselModulo(value: number, period: number): number {
  return period > 0 ? ((value % period) + period) % period : 0;
}

/** Pick the last real button crossing this frame, including across any loop seam. */
export function lastCarouselCrossing(from: number, to: number, geometry: FlavorCarouselGeometry): string | null {
  if (!(geometry.period > 0) || from === to || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  let selected: string | null = null;
  let latest = to > from ? -Infinity : Infinity;
  for (const item of geometry.centers) {
    if (!item.id) continue;
    const base = geometry.viewportWidth / 2 - item.center;
    const turns = to > from ? Math.floor((to - base) / geometry.period) : Math.ceil((to - base) / geometry.period);
    const crossing = base + turns * geometry.period;
    if (to > from ? crossing > from && crossing <= to && crossing > latest : crossing < from && crossing >= to && crossing < latest) {
      latest = crossing;
      selected = item.id;
    }
  }
  return selected;
}

/** Fast, sustained gestures can select. Ordinary drag and automatic travel never do. */
export class FlavorCarouselMotion {
  private geometry: FlavorCarouselGeometry = { period: 0, viewportWidth: 0, centers: [], canMove: false };
  private offset = 0;
  private speed = 0;
  private phaseValue: FlavorCarouselPhase = 'static';
  private resumeAt = 0;
  private lastTick = 0;
  private paused = false;
  private focused = false;
  private reduced = false;
  private selectedId: string;
  private pointer: CarouselPointer | null = null;
  private pendingSelection: string | null = null;

  constructor(selectedId = '') { this.selectedId = selectedId; }
  get position() { return this.offset; }
  get phase() { return this.phaseValue; }
  get velocity() { return this.speed; }
  get dragging() { return Boolean(this.pointer?.dragged); }
  get transforming() { return !this.suspended && (Boolean(this.pointer?.fast) || this.phaseValue === 'flick' && Math.abs(this.speed) >= flavorCarouselSettings.selectionVelocity); }
  get suspended() { return this.paused || this.focused || this.reduced || !this.geometry.canMove; }
  get translation() { return this.geometry.canMove ? -this.geometry.period + (this.focused ? this.offset : carouselModulo(this.offset, this.geometry.period)) : 0; }
  get animating() { return !this.suspended && (this.phaseValue === 'auto' || this.phaseValue === 'flick'); }

  setSelectedId(id: string) { this.selectedId = id; }
  consumeSelection(): string | null { const id = this.pendingSelection; this.pendingSelection = null; return id; }
  startAuto(now: number) { this.pointer = null; this.pendingSelection = null; this.speed = 0; this.phaseValue = this.geometry.canMove ? 'auto' : 'static'; this.lastTick = now; }
  setGeometry(geometry: FlavorCarouselGeometry, now: number) {
    const period = Number.isFinite(geometry.period) && geometry.period > 0 ? geometry.period : 0;
    if (this.geometry.period > 0 && period > 0 && this.geometry.period !== period) {
      const scale = period / this.geometry.period;
      this.offset *= scale;
      if (this.pointer) this.pointer.offset *= scale;
    }
    this.geometry = { period, viewportWidth: Math.max(0, geometry.viewportWidth), centers: geometry.centers.filter(item => Number.isFinite(item.center)), canMove: geometry.canMove && period > 0 };
    if (!this.geometry.canMove) { this.speed = 0; this.phaseValue = 'static'; this.pointer = null; }
    else if (this.phaseValue === 'static') this.phaseValue = 'auto';
    this.lastTick = now;
  }
  setPaused(value: boolean, now: number) { this.paused = value; this.lastTick = now; }
  setFocused(value: boolean, now: number) {
    if (this.focused === value) return;
    this.focused = value;
    this.lastTick = now;
    if (!value) this.rest(now);
  }
  setReducedMotion(value: boolean, now: number) {
    if (this.reduced === value) return;
    this.reduced = value;
    this.speed = 0;
    this.lastTick = now;
    if (!this.pointer) this.rest(now);
  }
  centerOn(id: string, now: number) {
    const item = this.geometry.centers.find(item => item.id === id);
    if (item) this.alignCenter(item.center, now);
  }
  alignCenter(center: number, now: number) {
    if (!this.geometry.canMove || !Number.isFinite(center)) return;
    this.offset = Math.min(this.geometry.period, this.geometry.viewportWidth / 2 - center);
    this.rest(now);
  }
  beginPointer(x: number, y: number, now: number) {
    this.pointer = { x, y, offset: this.offset, lastX: x, lastMovement: now, dragged: false, fast: false, samples: [{ x, at: now }] };
    this.pendingSelection = null;
    this.speed = 0;
    this.phaseValue = this.geometry.canMove ? 'drag' : 'static';
    this.lastTick = now;
  }
  movePointer(x: number, y: number, now: number): 'pending' | 'horizontal' | 'vertical' {
    const pointer = this.pointer;
    if (!pointer || !this.geometry.canMove) return 'pending';
    const dx = x - pointer.x, dy = y - pointer.y;
    if (!pointer.dragged) {
      if (Math.abs(dy) > flavorCarouselSettings.dragThreshold && Math.abs(dy) > Math.abs(dx) * 1.2) { this.cancelPointer(now); return 'vertical'; }
      if (Math.abs(dx) < flavorCarouselSettings.dragThreshold || Math.abs(dx) <= Math.abs(dy) * 1.2) return 'pending';
      pointer.dragged = true;
    }
    if (Math.abs(x - pointer.lastX) >= .5) pointer.lastMovement = now;
    pointer.lastX = x;
    pointer.samples.push({ x, at: now });
    while (pointer.samples.length > 2 && pointer.samples[1].at < now - flavorCarouselSettings.recentWindowMs) pointer.samples.shift();
    const measured = this.recentMotion(pointer, now);
    this.speed = measured.velocity;
    // Require travel across a meaningful distance and a sustained sample window;
    // one short event spike must not turn a gentle drag into a flavor change.
    const qualified = measured.fastSegments >= 2 && measured.fastDuration >= flavorCarouselSettings.minVelocityDurationMs
      && Math.abs(dx) >= flavorCarouselSettings.flickDistance
      && Math.abs(measured.distance) >= flavorCarouselSettings.recentDistance
      && Math.abs(measured.velocity) >= flavorCarouselSettings.flickVelocity;
    pointer.fast = !this.suspended && (qualified || pointer.fast && Math.abs(measured.velocity) >= flavorCarouselSettings.selectionVelocity);
    const before = this.offset;
    this.offset = pointer.offset + dx;
    if (pointer.fast && Math.sign(this.offset - before) === Math.sign(measured.velocity)) this.pendingSelection = this.crossing(before, this.offset) || this.pendingSelection;
    this.lastTick = now;
    return 'horizontal';
  }
  endPointer(now: number): FlavorCarouselRelease {
    const pointer = this.pointer;
    this.pointer = null;
    if (!pointer) return { dragged: false, flick: false, velocity: 0 };
    const { distance, fastDuration, fastSegments, velocity } = this.recentMotion(pointer, now);
    const flick = pointer.dragged && !this.suspended
      && fastSegments >= 2 && fastDuration >= flavorCarouselSettings.minVelocityDurationMs
      && Math.abs(pointer.lastX - pointer.x) >= flavorCarouselSettings.flickDistance
      && Math.abs(distance) >= flavorCarouselSettings.recentDistance
      && Math.abs(velocity) >= flavorCarouselSettings.flickVelocity
      && now - pointer.lastMovement <= flavorCarouselSettings.freshReleaseMs;
    if (flick) {
      this.speed = Math.sign(velocity) * Math.min(flavorCarouselSettings.maxVelocity, Math.abs(velocity));
      this.phaseValue = 'flick';
      this.lastTick = now;
    } else this.rest(now);
    return { dragged: pointer.dragged, flick, velocity: flick ? this.speed : 0 };
  }
  cancelPointer(now: number): boolean {
    const dragged = Boolean(this.pointer?.dragged);
    this.pointer = null;
    this.pendingSelection = null;
    this.rest(now);
    return dragged;
  }
  resetClock(now: number) { this.lastTick = now; }
  nextWake(now: number): number | null {
    return !this.suspended && this.phaseValue === 'rest' ? Math.max(0, this.resumeAt - now) : null;
  }
  tick(now: number): string | null {
    const dt = Math.min(.064, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    if (this.suspended || this.pointer) return null;
    if (this.phaseValue === 'rest') {
      if (now >= this.resumeAt) this.phaseValue = 'auto';
      return null;
    }
    if (this.phaseValue === 'auto') { this.offset -= flavorCarouselSettings.autoSpeed * dt; return null; }
    if (this.phaseValue !== 'flick') return null;
    const before = this.offset;
    const previous = this.speed;
    const next = Math.sign(previous) * Math.max(0, Math.abs(previous) - flavorCarouselSettings.deceleration * dt);
    this.offset += (previous + next) * .5 * dt;
    this.speed = next;
    // Integrate only the fast portion of the frame for automatic selection.
    // The rail still coasts smoothly after this threshold, without more changes.
    const fastDuration = Math.min(dt, Math.max(0, (Math.abs(previous) - flavorCarouselSettings.selectionVelocity) / flavorCarouselSettings.deceleration));
    const fastEnd = before + Math.sign(previous) * (Math.abs(previous) * fastDuration - .5 * flavorCarouselSettings.deceleration * fastDuration ** 2);
    const crossed = fastDuration > 0 ? this.crossing(before, fastEnd) : null;
    if (Math.abs(next) <= flavorCarouselSettings.stopVelocity) this.rest(now);
    return crossed;
  }
  private crossing(from: number, to: number): string | null {
    const crossed = lastCarouselCrossing(from, to, this.geometry);
    if (!crossed || crossed === this.selectedId) return null;
    this.selectedId = crossed;
    return crossed;
  }
  private recentMotion(pointer: CarouselPointer, now: number) {
    const samples = pointer.samples;
    const last = samples[samples.length - 1];
    const cutoff = now - flavorCarouselSettings.recentWindowMs;
    let first = samples.find(sample => sample.at >= cutoff) || last;
    const prior = [...samples].reverse().find(sample => sample.at < cutoff);
    if (prior && first.at > cutoff) {
      const fraction = Math.max(0, Math.min(1, (cutoff - prior.at) / (first.at - prior.at)));
      first = { x: prior.x + (first.x - prior.x) * fraction, at: cutoff };
    }
    const distance = last.x - first.x;
    const duration = Math.max(0, now - first.at);
    const velocity = duration > 0 ? distance * 1000 / duration : 0;
    let fastDuration = 0, fastSegments = 0;
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1], sample = samples[index];
      const elapsed = sample.at - previous.at;
      const delta = sample.x - previous.x;
      const observed = sample.at - Math.max(previous.at, cutoff);
      if (!(elapsed > 0) || !(observed > 0)) continue;
      if (Math.abs(delta) < .5) {
        if (elapsed >= flavorCarouselSettings.stationaryResetMs) { fastDuration = 0; fastSegments = 0; }
        continue;
      }
      const segmentSpeed = delta * 1000 / elapsed;
      if (Math.sign(segmentSpeed) === Math.sign(velocity) && Math.abs(segmentSpeed) >= flavorCarouselSettings.flickVelocity) {
        fastDuration += observed;
        fastSegments++;
      } else { fastDuration = 0; fastSegments = 0; }
    }
    // Interpolation estimates speed across sparse samples, but cannot turn stationary
    // dwell or a single dispatch spike into evidence of sustained fast movement.
    return { distance, duration, velocity, fastDuration, fastSegments };
  }
  private rest(now: number) {
    this.speed = 0;
    this.phaseValue = this.geometry.canMove ? 'rest' : 'static';
    this.resumeAt = now + flavorCarouselSettings.resumeDelayMs;
    this.lastTick = now;
  }
}
