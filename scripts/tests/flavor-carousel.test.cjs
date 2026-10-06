/* eslint-disable @typescript-eslint/no-require-imports -- Exercise production physics, DOM binding and SSR UI with deterministic browser boundaries. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FlavorCarouselMotion, lastCarouselCrossing, flavorCarouselSettings } = require('../../lib/catalog/flavor-carousel-motion.ts');
const { bindFlavorCarousel } = require('../../components/catalog-hero/flavor-carousel-controller.ts');

const geometry = (count = 24) => ({ period: count * 91, viewportWidth: 420, canMove: count > 1, centers: Array.from({ length: count }, (_, index) => ({ id: `flavor-${index}`, center: index * 91 + 32 })) });
function motionFixture(count = 24) { const motion = new FlavorCarouselMotion('flavor-0'); motion.setGeometry(geometry(count), 0); return motion; }
function moveFrames(motion, start, duration) { const selected = []; for (let at = start + 16; at <= start + duration; at += 16) { const id = motion.tick(at); if (id) selected.push(id); } return selected; }

test('automatic looping stays continuous for 24 items without selecting any passing flavor', () => {
  const motion = motionFixture();
  assert.deepEqual(moveFrames(motion, 0, 10000), []);
  assert.ok(Math.abs(motion.position + 240) < 1e-8);
  assert.ok(motion.translation >= -geometry().period && motion.translation <= 0);
});
test('ordinary dragging changes the rail only and restarts auto exactly after a one-second rest', () => {
  const motion = motionFixture();
  motion.beginPointer(10, 10, 0);
  assert.equal(motion.movePointer(50, 12, 400), 'horizontal');
  motion.movePointer(90, 12, 800);
  assert.deepEqual(motion.endPointer(800), { dragged: true, flick: false, velocity: 0 });
  assert.equal(motion.position, 80);
  assert.equal(motion.tick(1799), null); assert.equal(motion.phase, 'rest'); assert.equal(motion.position, 80);
  motion.tick(1800); assert.equal(motion.phase, 'auto'); assert.equal(motion.position, 80);
  motion.tick(1816); assert.ok(motion.position < 80);
});
test('a short high-speed movement, an old fast swipe held before release and slow terminal movement are not flicks', () => {
  for (const steps of [[[10, 5]], [[120, 50], [120, 250]], [[120, 50], [121, 300], [122, 600]]]) {
    const motion = motionFixture(); motion.beginPointer(0, 0, 0);
    for (const [x, at] of steps) motion.movePointer(x, 0, at);
    assert.equal(motion.endPointer(steps.at(-1)[1]).flick, false);
  }
});
test('light, ordinary and short burst dragging never select or flick, even after a long travel or stationary dwell', () => {
  for (const direction of [-1, 1]) {
    for (const speed of [450, 1000, 1500]) {
      const motion = motionFixture(); motion.beginPointer(0, 0, 0);
      for (let at = 30; at <= 1200; at += 30) {
        motion.movePointer(direction * speed * at / 1000, 0, at);
        assert.equal(motion.consumeSelection(), null); assert.equal(motion.transforming, false);
      }
      assert.equal(motion.endPointer(1200).flick, false); assert.deepEqual(moveFrames(motion, 1200, 2500), []);
    }
    for (const steps of [[[160, 5], [160, 60]], [[0, 1000], [225, 1005]], [[40, 10], [80, 20], [120, 30]], [[100, 30], [100, 90], [200, 120]]]) {
      const motion = motionFixture(); motion.beginPointer(0, 0, 0);
      for (const [x, at] of steps) { motion.movePointer(direction * x, 0, at); assert.equal(motion.consumeSelection(), null); assert.equal(motion.transforming, false); }
      assert.equal(motion.endPointer(steps.at(-1)[1]).flick, false);
    }
  }
});

test('genuine sustained fast dragging selects crossings immediately, then slow inertial coast glides without additional changes', () => {
  const motion = motionFixture(); motion.beginPointer(0, 0, 0);
  const duringDrag = [];
  for (let at = 20; at <= 160; at += 20) { motion.movePointer(-2 * at, 0, at); const id = motion.consumeSelection(); if (id) duringDrag.push(id); }
  assert.ok(duringDrag.length > 0); assert.equal(motion.transforming, true); assert.equal(motion.endPointer(160).flick, true);
  let at = 160; const duringCoast = [];
  while (motion.phase === 'flick' && Math.abs(motion.velocity) >= 1000) { at += 16; const id = motion.tick(at); if (id) duringCoast.push(id); }
  assert.ok(duringCoast.length > 0); assert.equal(motion.transforming, false);
  const slowStart = motion.position;
  while (motion.phase === 'flick') { at += 16; assert.equal(motion.tick(at), null); }
  assert.ok(motion.position < slowStart, 'Deceleration still moves the rail below the selection threshold');
  const stopped = motion.position; motion.tick(at + 999); assert.equal(motion.position, stopped);
  motion.tick(at + 1000); assert.equal(motion.phase, 'auto'); assert.deepEqual(moveFrames(motion, at + 1000, 1000), []);
});
test('a fresh strong swipe coasts in its release direction, selects real center crossings and decelerates to rest', () => {
  const motion = motionFixture(); motion.beginPointer(0, 0, 0); motion.movePointer(-60, 1, 30); motion.movePointer(-160, 2, 80);
  const release = motion.endPointer(80); assert.equal(release.flick, true); assert.equal(release.velocity, -2000);
  const selected = []; let lastSpeed = Math.abs(motion.velocity), at = 80;
  while (motion.phase === 'flick') {
    at += 16; const id = motion.tick(at); if (id) selected.push(id);
    assert.ok(Math.abs(motion.velocity) <= lastSpeed); lastSpeed = Math.abs(motion.velocity);
  }
  assert.ok(selected.length >= 3); assert.ok(selected.every((id, index) => id !== selected[index - 1]));
  const stopped = motion.position; assert.equal(motion.tick(at + 999), null); assert.equal(motion.position, stopped);
  motion.tick(at + 1000); assert.equal(motion.phase, 'auto');
  assert.deepEqual(moveFrames(motion, at + 1000, 1000), []);
});
test('center crossings are direction-aware at the loop seam and collapse multiple crossings to one latest update', () => {
  const g = { period: 400, viewportWidth: 200, canMove: true, centers: [{ id: 'a', center: 50 }, { id: 'b', center: 150 }, { id: 'c', center: 250 }, { id: null, center: 350 }] };
  assert.equal(lastCarouselCrossing(0, 700, g), 'c'); assert.equal(lastCarouselCrossing(0, -700, g), 'c');
  assert.equal(lastCarouselCrossing(40, 50, g), 'a'); assert.equal(lastCarouselCrossing(50, 60, g), null);
  assert.equal(lastCarouselCrossing(0, 20, g), null);
});
test('vertical pan cancels pending horizontal control and reduced motion keeps manual drag but disables inertia and auto', () => {
  const motion = motionFixture(); motion.beginPointer(0, 0, 0);
  assert.equal(motion.movePointer(2, 30, 20), 'vertical'); assert.equal(motion.position, 0); assert.equal(motion.phase, 'rest');
  motion.setReducedMotion(true, 30); motion.beginPointer(0, 0, 40); motion.movePointer(200, 0, 100);
  assert.equal(motion.endPointer(100).flick, false); assert.deepEqual(moveFrames(motion, 100, 4000), []); assert.equal(motion.position, 200);
});
test('manual pause and keyboard focus freeze motion without replaying elapsed time', () => {
  const motion = motionFixture(); motion.tick(16); const before = motion.position;
  motion.setPaused(true, 16); motion.tick(5000); assert.equal(motion.position, before);
  motion.setPaused(false, 5000); motion.tick(5016); assert.ok(Math.abs(motion.position - before + .384) < 1e-8);
  motion.setFocused(true, 5016); motion.centerOn('flavor-23', 5016);
  const focused = motion.position; motion.tick(9000); assert.equal(motion.position, focused);
  const originalCenter = geometry().period + motion.translation + geometry().centers[23].center;
  assert.equal(originalCenter, geometry().viewportWidth / 2);
});

function domFixture(context, count = 24, reducedMotion = false) {
  const globals = ['window', 'document', 'matchMedia', 'getComputedStyle', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'ResizeObserver', 'IntersectionObserver'];
  const prior = new Map(globals.map(key => [key, global[key]]));
  let time = 0, nextId = 0, observer, intersection, focus;
  const frames = new Map(), timers = new Map(), selected = [], copies = [], captures = new Set(), implicitCaptures = new Map();
  const target = () => {
    const events = new Map();
    return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); }, removeEventListener(type, fn) { events.get(type)?.delete(fn); },
      emit(type, value = {}) { const event = { target: this, detail: 1, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, stopImmediatePropagation() { this.stopped = true; this.propagationStopped = true; }, ...value }; for (const fn of events.get(type) || []) { fn(event); if (event.stopped) break; } return event; },
      listenerCount() { return [...events.values()].reduce((sum, listeners) => sum + listeners.size, 0); } };
  };
  const windowTarget = target(), documentTarget = { ...target(), hidden: false }, reduced = { ...target(), matches: reducedMotion };
  const viewport = { ...target(), dataset: {}, clientWidth: 420,
    contains(node) { return node === this || node?.owner === this; },
    hasPointerCapture: id => captures.has(id), setPointerCapture(id) { captures.add(id); const previous = implicitCaptures.get(id); if (previous) { implicitCaptures.delete(id); this.emit('lostpointercapture', { pointerId: id, target: previous }); } },
    releasePointerCapture(id) { captures.delete(id); this.emit('lostpointercapture', { pointerId: id }); }, };
  const track = { style: {} };
  const period = count * 91;
  const translation = () => Number(track.style.transform?.match(/translate3d\(([-\d.]+)px/)?.[1] || 0);
  const firstSet = { getBoundingClientRect: () => ({ left: period + translation(), width: period - 27 }), contains: node => buttons.includes(node), querySelectorAll: () => buttons };
  const buttons = Array.from({ length: count }, (_, index) => ({ owner: viewport, dataset: { variantId: `flavor-${index}` },
    getBoundingClientRect: () => ({ left: period + translation() + index * 91, width: 64 }), closest() { return this; }, matches() { return Boolean(this.focusVisible); },
    focus() { const previous = focus; focus = buttons[index]; documentTarget.activeElement = buttons[index]; buttons[index].focusVisible = true; if (previous) viewport.emit('focusout', { target: previous, relatedTarget: buttons[index] }); viewport.emit('focusin', { target: buttons[index], relatedTarget: previous }); } }));
  Object.assign(global, { window: windowTarget, document: documentTarget, performance: { now: () => time, timeOrigin: 1700000000000 }, matchMedia: () => reduced, getComputedStyle: () => ({ columnGap: '27px' }),
    requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { timers.set(++nextId, { fn, at: time + delay }); return nextId; }, clearTimeout: id => timers.delete(id),
    ResizeObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} disconnect() {} }, });
  const binding = () => bindFlavorCarousel({ viewport, track, firstSet, canMove: count > 1, selectedId: 'flavor-0', onSelect: id => selected.push(id), onCopies: count => copies.push(count) });
  let controller = binding();
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; controller.dispose(); for (const [key, value] of prior) { if (value === undefined) delete global[key]; else global[key] = value; } };
  context.after(dispose);
  const advance = duration => { const stop = time + duration; while (time < stop) { time = Math.min(stop, time + 16); for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } const active = [...frames.values()]; frames.clear(); active.forEach(fn => fn(time)); } };
  const pointer = (type, x, y = 0, surface = viewport, options = {}) => {
    const values = { target: surface === viewport ? buttons[0] : surface, pointerType: 'mouse', button: 0, isPrimary: true, pointerId: 7, clientX: x, clientY: y, timeStamp: time, ...options };
    if (type === 'pointerdown' && values.pointerType === 'touch') implicitCaptures.set(values.pointerId, values.target);
    const event = surface.emit(type, values);
    if (surface === viewport && !event.propagationStopped) windowTarget.emit(type, event);
    if (type === 'pointerup' || type === 'pointercancel') implicitCaptures.delete(values.pointerId);
    return event;
  };
  return { viewport, track, firstSet, buttons, windowTarget, documentTarget, reduced, frames, timers, selected, copies, captures, implicitCaptures, get controller() { return controller; }, advance, pointer, dispose,
    focus: () => focus, setTime: value => { time = value; }, getTime: () => time,
    resize: () => observer(), setVisible: value => intersection([{ isIntersecting: value }]), rebind: () => { controller.dispose(); controller = binding(); } };
}

test('the DOM binder keeps a normal tap on the original button and never captures/suppresses it', context => {
  const f = domFixture(context); f.pointer('pointerdown', 80); assert.equal(f.captures.size, 0);
  f.setTime(40); f.pointer('pointerup', 82);
  const click = f.viewport.emit('click', { target: f.buttons[0], detail: 1 });
  assert.equal(click.defaultPrevented, false); assert.equal(f.captures.size, 0); assert.deepEqual(f.selected, []);
});
test('DOM horizontal drag captures after threshold, suppresses its click and resumes while the mouse stays over the rail', context => {
  const f = domFixture(context); f.pointer('pointerdown', 100); f.setTime(400); f.pointer('pointermove', 150);
  assert.equal(f.captures.size, 1); assert.equal(f.viewport.dataset.dragging, 'true');
  f.setTime(800); f.pointer('pointermove', 200); f.pointer('pointerup', 200);
  const position = f.track.style.transform;
  assert.equal(f.captures.size, 0); assert.equal(f.viewport.dataset.dragging, 'false');
  assert.equal(f.viewport.emit('click', { detail: 1 }).defaultPrevented, true);
  assert.equal(f.viewport.emit('click', { detail: 0 }).defaultPrevented, false, 'Keyboard clicks remain usable after dragging');
  f.advance(999); assert.equal(f.track.style.transform, position); f.advance(33); assert.notEqual(f.track.style.transform, position);
  assert.deepEqual(f.selected, []);
});
test('release outside the viewport before capture does not strand the pending gesture', context => {
  const f = domFixture(context); f.pointer('pointerdown', 1); f.setTime(100); f.pointer('pointermove', -2, 0, f.windowTarget);
  assert.equal(f.captures.size, 0); f.pointer('pointerup', -2, 0, f.windowTarget);
  assert.equal(f.controller.motion.phase, 'rest'); const before = f.track.style.transform;
  f.advance(1050); assert.notEqual(f.track.style.transform, before); assert.deepEqual(f.selected, []);
});
test('DOM sustained fast dragging and coast select crossings, then cancel cleanly on capture loss, hidden document or leaving view', context => {
  const f = domFixture(context); f.pointer('pointerdown', 0); f.setTime(30); f.pointer('pointermove', -60); f.setTime(80); f.pointer('pointermove', -180); f.pointer('pointerup', -180);
  assert.equal(f.controller.motion.phase, 'flick'); assert.ok(f.selected.length <= 1);
  f.advance(160); assert.ok(f.selected.length > 0);
  const selectedCount = f.selected.length; f.documentTarget.hidden = true; f.documentTarget.emit('visibilitychange');
  assert.equal(f.controller.motion.phase, 'rest'); assert.equal(f.frames.size, 0); f.advance(3000); assert.equal(f.selected.length, selectedCount);
  f.documentTarget.hidden = false; f.documentTarget.emit('visibilitychange'); f.advance(100); assert.equal(f.selected.length, selectedCount);
  f.pointer('pointerdown', 0); f.setTime(f.getTime() + 30); f.pointer('pointermove', 60); f.setTime(f.getTime() + 50); f.pointer('pointermove', 180); f.pointer('pointerup', 180);
  const selectedBeforeLeaving = f.selected.length;
  f.setVisible(false); assert.equal(f.frames.size, 0); assert.equal(f.controller.motion.phase, 'rest');
  f.setVisible(true); f.advance(100); assert.equal(f.selected.length, selectedBeforeLeaving);
  f.pointer('pointerdown', 0); f.setTime(f.getTime() + 80); f.pointer('pointermove', 180);
  f.viewport.emit('lostpointercapture', { pointerId: 7 }); assert.equal(f.controller.motion.phase, 'rest'); assert.equal(f.captures.size, 0);
});

test('mobile implicit button capture transfers to the viewport without cancelling horizontal touch dragging', context => {
  const f = domFixture(context), touch = { pointerType: 'touch' };
  f.pointer('pointerdown', 200, 20, f.viewport, touch); assert.equal(f.implicitCaptures.size, 1);
  const before = f.controller.motion.position;
  f.setTime(100); const move = f.pointer('pointermove', 175, 22, f.viewport, touch);
  assert.equal(move.defaultPrevented, true); assert.equal(f.implicitCaptures.size, 0); assert.equal(f.captures.size, 1);
  assert.equal(f.viewport.dataset.dragging, 'true'); assert.equal(f.controller.motion.position, before - 25);
  f.setTime(220); f.pointer('pointermove', 125, 24, f.viewport, touch);
  assert.equal(f.controller.motion.position, before - 75); assert.deepEqual(f.selected, []);
  f.setTime(240); f.pointer('pointerup', 125, 24, f.viewport, touch);
  assert.equal(f.captures.size, 0); assert.equal(f.controller.motion.phase, 'rest');
  assert.equal(f.viewport.emit('click', { target: f.buttons[0], pointerType: 'touch', detail: 0 }).defaultPrevented, true, 'A mobile pointer click cannot choose the release button even when click.detail is zero');
  assert.equal(f.viewport.emit('click', { target: f.buttons[0], pointerType: '', detail: 0 }).defaultPrevented, false, 'Keyboard activation remains available');
  const stopped = f.track.style.transform; f.advance(999); assert.equal(f.track.style.transform, stopped);
  f.advance(40); assert.notEqual(f.track.style.transform, stopped); assert.deepEqual(f.selected, []);
});

test('touch taps remain genuine button clicks while vertical touch pans leave page scrolling available', context => {
  const f = domFixture(context), touch = { pointerType: 'touch' }; let ancestorDowns = 0, ancestorMoves = 0;
  f.windowTarget.addEventListener('pointerdown', () => { ancestorDowns++; }); f.windowTarget.addEventListener('pointermove', () => { ancestorMoves++; });
  f.pointer('pointerdown', 80, 20, f.viewport, touch); f.setTime(50); f.pointer('pointerup', 82, 21, f.viewport, touch);
  assert.equal(f.captures.size, 0); assert.equal(f.viewport.emit('click', { pointerType: 'touch', detail: 1 }).defaultPrevented, false);
  f.pointer('pointerdown', 100, 20, f.viewport, touch); f.setTime(70); const vertical = f.pointer('pointermove', 104, 55, f.viewport, touch);
  assert.equal(vertical.defaultPrevented, false); assert.equal(vertical.propagationStopped, undefined); assert.equal(ancestorMoves, 1);
  assert.equal(ancestorDowns, 0, 'An ancestor viewer cannot capture the carousel pointerdown');
  assert.equal(f.captures.size, 0); assert.equal(f.controller.motion.phase, 'rest'); assert.deepEqual(f.selected, []);
  assert.equal(f.viewport.emit('click', { detail: 0, sourceCapabilities: { firesTouchEvents: true } }).defaultPrevented, true);
});

test('touch input uses sampled event timestamps rather than delayed delivery times, including old WebKit epoch timestamps', context => {
  const f = domFixture(context);
  for (const origin of [0, performance.timeOrigin]) {
    const start = f.getTime();
    f.pointer('pointerdown', 200, 0, f.viewport, { pointerType: 'touch', timeStamp: origin + start });
    f.setTime(start + 500); f.pointer('pointermove', 150, 0, f.viewport, { pointerType: 'touch', timeStamp: origin + start + 100 });
    f.setTime(start + 501); f.pointer('pointermove', 100, 0, f.viewport, { pointerType: 'touch', timeStamp: origin + start + 200 });
    f.setTime(start + 502); f.pointer('pointerup', 100, 0, f.viewport, { pointerType: 'touch', timeStamp: origin + start + 210 });
    assert.equal(f.controller.motion.phase, 'rest'); assert.deepEqual(f.selected, []);
    assert.equal(f.viewport.emit('click', { pointerType: 'touch', detail: 1 }).defaultPrevented, true);
    f.advance(1100); assert.deepEqual(f.selected, []);
  }
});

test('coalesced mobile samples preserve the complete drag and emit at most one latest crossing per dispatch', context => {
  const f = domFixture(context), touch = { pointerType: 'touch' };
  f.pointer('pointerdown', 300, 0, f.viewport, touch); const before = f.controller.motion.position;
  f.setTime(120);
  f.pointer('pointermove', 60, 3, f.viewport, { ...touch, getCoalescedEvents: () => [
    { clientX: 260, clientY: 0, timeStamp: 20 }, { clientX: 220, clientY: 1, timeStamp: 40 },
    { clientX: 180, clientY: 1, timeStamp: 60 }, { clientX: 140, clientY: 2, timeStamp: 80 }, { clientX: 100, clientY: 2, timeStamp: 100 },
  ] });
  assert.equal(f.controller.motion.position, before - 240); assert.equal(f.captures.size, 1); assert.equal(f.viewport.dataset.transforming, 'true');
  assert.equal(f.selected.length, 1, 'Several crossings in one coalesced event produce a single product update');
  f.pointer('pointerup', 60, 3, f.viewport, touch); assert.equal(f.controller.motion.phase, 'flick');
  const count = f.selected.length; f.pointer('pointercancel', 60, 3, f.viewport, touch); f.setVisible(false); f.advance(3000);
  assert.equal(f.selected.length, count);
});

test('coalesced vertical touch starts never become horizontal dragging and cancelling touch releases all scheduling/capture', context => {
  const f = domFixture(context), touch = { pointerType: 'touch' };
  f.pointer('pointerdown', 200, 0, f.viewport, touch); const before = f.controller.motion.position;
  f.setTime(100); const vertical = f.pointer('pointermove', 120, 80, f.viewport, { ...touch, getCoalescedEvents: () => [
    { clientX: 199, clientY: 15, timeStamp: 20 }, { clientX: 180, clientY: 40, timeStamp: 60 },
  ] });
  assert.equal(vertical.defaultPrevented, false); assert.equal(f.captures.size, 0); assert.equal(f.controller.motion.position, before); assert.deepEqual(f.selected, []);
  f.pointer('pointerdown', 200, 0, f.viewport, touch); f.setTime(180); f.pointer('pointermove', 180, 0, f.viewport, touch);
  assert.equal(f.captures.size, 1); f.pointer('pointercancel', 180, 0, f.viewport, touch);
  assert.equal(f.captures.size, 0); assert.equal(f.viewport.dataset.dragging, 'false'); assert.equal(f.controller.motion.phase, 'rest');
  assert.equal(f.viewport.emit('click', { pointerType: 'touch', detail: 0 }).defaultPrevented, true);
  f.controller.dispose(); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); assert.deepEqual(f.selected, []);
});

test('coalesced samples are processed chronologically and stale samples cannot rewind a later touch position', context => {
  const f = domFixture(context), touch = { pointerType: 'touch' };
  f.pointer('pointerdown', 200, 0, f.viewport, touch); const before = f.controller.motion.position;
  f.setTime(100); f.pointer('pointermove', 150, 0, f.viewport, touch);
  f.setTime(300); f.pointer('pointermove', 50, 0, f.viewport, { ...touch, getCoalescedEvents: () => [
    { clientX: 75, clientY: 0, timeStamp: 250 }, { clientX: 190, clientY: 0, timeStamp: 20 },
    { clientX: 100, clientY: 0, timeStamp: 200 }, { clientX: 125, clientY: 0, timeStamp: 150 },
  ] });
  assert.equal(f.controller.motion.position, before - 150); assert.equal(f.controller.motion.velocity, -500); assert.deepEqual(f.selected, []);
  f.setTime(320); f.pointer('pointerup', 50, 0, f.viewport, touch);
  assert.equal(f.controller.motion.phase, 'rest'); assert.deepEqual(f.selected, []);
});

test('touch dragging remains usable when the optional coalesced event API throws or no timestamps are supplied', context => {
  const f = domFixture(context), touch = { pointerType: 'touch', timeStamp: undefined };
  f.pointer('pointerdown', 200, 0, f.viewport, touch); const before = f.controller.motion.position;
  f.setTime(150); f.pointer('pointermove', 150, 0, f.viewport, { ...touch, getCoalescedEvents() { throw new Error('Restricted browser API'); } });
  assert.equal(f.controller.motion.position, before - 50); assert.equal(f.captures.size, 1);
  f.setTime(300); f.pointer('pointerup', 100, 0, f.viewport, touch);
  assert.equal(f.controller.motion.position, before - 100); assert.equal(f.captures.size, 0); assert.equal(f.controller.motion.phase, 'rest'); assert.deepEqual(f.selected, []);
});
test('OS reduced motion at startup or changing later does not stop automatic flavor movement or touch inertia', context => {
  const f = domFixture(context, 24, true); f.pointer('pointerdown', 0); f.setTime(20); const vertical = f.pointer('pointermove', 2, 35);
  assert.equal(vertical.defaultPrevented, false); assert.equal(f.captures.size, 0); assert.equal(f.controller.motion.phase, 'rest');
  assert.equal(f.viewport.emit('click', { detail: 1 }).defaultPrevented, true, 'A vertical drag also cannot become an accidental flavor tap');
  f.advance(1100); assert.equal(f.frames.size, 1);
  for (const matches of [false, true]) {
    f.reduced.matches = matches; f.reduced.emit('change');
    const before = f.track.style.transform; f.advance(500); assert.notEqual(f.track.style.transform, before);
    assert.equal(f.frames.size, 1);
  }
  const start = f.getTime();
  f.pointer('pointerdown', 200, 0, f.viewport, { pointerType: 'touch' });
  f.setTime(start + 30); f.pointer('pointermove', 140, 0, f.viewport, { pointerType: 'touch' });
  f.setTime(start + 80); f.pointer('pointermove', 20, 0, f.viewport, { pointerType: 'touch' });
  f.pointer('pointerup', 20, 0, f.viewport, { pointerType: 'touch' });
  assert.equal(f.controller.motion.phase, 'flick');
});
test('keyboard focus reveals the original 24th button, pauses transforms and arrow navigation stays on original buttons', context => {
  const f = domFixture(context); f.documentTarget.emit('keydown', { key: 'Tab', target: f.documentTarget }); f.buttons[23].focus();
  const rect = f.buttons[23].getBoundingClientRect(); assert.ok(rect.left >= 0 && rect.left + rect.width <= f.viewport.clientWidth);
  const before = f.track.style.transform; assert.equal(f.frames.size, 0); f.advance(3000); assert.equal(f.track.style.transform, before);
  const key = f.documentTarget.emit('keydown', { key: 'ArrowLeft', target: f.buttons[23] }); assert.equal(key.defaultPrevented, true); assert.equal(f.focus(), f.buttons[22]);
  assert.deepEqual(f.selected, [], 'Focusing a button does not change the product');
  f.viewport.emit('focusout', { target: f.buttons[22], relatedTarget: f.windowTarget }); f.advance(1040); assert.equal(f.frames.size, 1);
});
test('resize covers wide viewports with enough identical loops and disposal releases every frame, timer, capture and listener', context => {
  const f = domFixture(context, 2); f.viewport.clientWidth = 1400; f.resize();
  assert.ok(f.copies.at(-1) >= Math.ceil(1400 / (2 * 91)) + 2);
  f.pointer('pointerdown', 0); f.setTime(50); f.pointer('pointermove', 100);
  assert.equal(f.captures.size, 1); f.controller.dispose();
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.captures.size, 0);
  assert.equal(f.viewport.listenerCount(), 0); assert.equal(f.documentTarget.listenerCount(), 0); assert.equal(f.windowTarget.listenerCount(), 0); assert.equal(f.reduced.listenerCount(), 0);
});
test('viewport resize and component rebind retain visible keyboard focus and keep automatic motion paused', context => {
  const f = domFixture(context); f.documentTarget.emit('keydown', { key: 'Tab', target: f.documentTarget }); f.buttons[23].focus();
  f.viewport.clientWidth = 180; f.resize();
  const rect = f.buttons[23].getBoundingClientRect(); assert.ok(rect.left >= 0 && rect.left + rect.width <= 180);
  assert.equal(f.frames.size, 0); const before = f.track.style.transform;
  f.rebind(); assert.equal(f.frames.size, 0); assert.equal(f.controller.motion.suspended, true);
  f.advance(3000); assert.equal(f.track.style.transform, before); assert.deepEqual(f.selected, []);
});
test('keyboard interaction after clicking an aria-hidden clone moves focus to its reachable original without choosing a flavor', context => {
  const f = domFixture(context);
  const clone = { owner: f.viewport, dataset: { variantId: 'flavor-23' }, closest() { return this; }, matches: () => false };
  f.documentTarget.emit('keydown', { key: 'Enter', target: clone });
  assert.equal(f.focus(), f.buttons[23]); assert.equal(f.frames.size, 0); assert.deepEqual(f.selected, []);
});

require.extensions['.tsx'] = function(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(output.outputText, filename);
};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const FlavorCarousel = require('../../components/catalog-hero/FlavorCarousel.tsx').default;
const { LanguageProvider } = require('../../components/LanguageProvider.tsx');
const items = count => Array.from({ length: count }, (_, index) => ({ variantId: `flavor-${index}`, flavor: { id: `flavor-${index}`, name: `Admin flavor ${index}`, shortName: `Flavor ${index}` } }));
const render = count => renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(FlavorCarousel, { items: items(count), selectedId: `flavor-${count - 1}`, onSelect() {} })));

test('production SSR keeps original flavors keyboard reachable and visual loops free of focusable controls', () => {
  const html = render(24);
  assert.equal((html.match(/data-variant-id=/g) || []).length, 72);
  assert.equal((html.match(/<button\b/g) || []).length, 24, 'Each flavor has exactly one reachable control');
  assert.equal((html.match(/role="presentation"/g) || []).length, 48, 'Copies are nonfocusable visuals, still pointer selectable');
  const hiddenSets = [...html.matchAll(/<div class="flavor-set" aria-hidden="true">([\s\S]*?)<\/div>/g)];
  assert.equal(hiddenSets.length, 2);
  for (const [, content] of hiddenSets) assert.doesNotMatch(content, /<button\b|tabindex=|role="button"|aria-pressed=/, 'Hidden copies cannot retain focus');
  assert.equal((html.match(/data-carousel-item=/g) || []).length, 72, 'Every visual copy remains associated with its flavor');
  assert.equal((html.match(/aria-hidden="true"/g) || []).filter(Boolean).length >= 2, true);
  assert.doesNotMatch(html, /All flavors|catalog-carousel-controls|catalog-carousel-motion|24 \/ 24|Previous flavor|Next flavor|Pause flavor carousel/);
  assert.match(html, /Admin|Flavor 23/); assert.doesNotMatch(html, /scrollIntoView|animation-duration/);
});
test('one flavor renders once with no cloned loops, motion controls or moving animation contract', () => {
  const html = render(1); assert.match(html, /catalog-carousel-static/);
  assert.equal((html.match(/data-variant-id=/g) || []).length, 1);
  assert.doesNotMatch(html, /tabindex="-1"|catalog-carousel-controls/);
});
test('the production stylesheet preserves original rings/gradient and delegates all motion to the controller with vertical touch pan', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../app/flavor-carousel.css'), 'utf8');
  assert.match(css, /touch-action:pan-y/); assert.match(css, /--flavor-gap:27px/); assert.match(css, /--flavor-gap:16px/);
  assert.match(css, /flavor-set \.flavor-choice \{ touch-action:pan-y; -webkit-user-drag:none/); assert.match(css, /-webkit-touch-callout:none/);
  assert.match(css, /linear-gradient\(40deg,#ff7970,#ffdd93\)/); assert.match(css, /width:64px; height:64px/);
  assert.match(css, /width:58px; height:58px/); assert.match(css, /width:46px; height:46px; object-fit:contain/);
  assert.doesNotMatch(css, /animation-play-state:paused|animation:flavor-marquee|catalog-carousel-controls|catalog-carousel-motion/);
  assert.equal(flavorCarouselSettings.resumeDelayMs, 1000);
});
