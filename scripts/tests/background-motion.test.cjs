/* Run with: node scripts/tests/background-motion.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness executes compiled production sources with browser boundaries replaced. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

function loadSource(relativePath, requireModule = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(requireModule, loaded, loaded.exports);
  return loaded.exports;
}
const config = loadSource('lib/background-config.ts', () => loadSource('lib/showcase-flavors.ts'));
const motion = loadSource('lib/background-motion.ts');
const rendering = loadSource('lib/background-render-state.ts', name => name === './background-config' ? config : require(name));

test('older background settings inherit automatic steering and the 10% faster speed; admin intervals stay ordered and finite', () => {
  const defaults = config.normalizeBackgroundConfig({ cellSize: 72 });
  assert.ok(Math.abs(defaults.maxSpeed - 24 * 1.1) < 1e-10);
  assert.equal(defaults.autoDriftEnabled, true);
  assert.equal(defaults.autoDirectionMinSeconds, 2);
  assert.equal(defaults.autoDirectionMaxSeconds, 6);
  const inverted = config.normalizeBackgroundConfig({ autoDirectionMinSeconds: 20, autoDirectionMaxSeconds: 1 });
  assert.equal(inverted.autoDirectionMinSeconds, 20);
  assert.equal(inverted.autoDirectionMaxSeconds, 20);
  const invalid = config.normalizeBackgroundConfig({ autoDirectionMinSeconds: NaN, autoDirectionMaxSeconds: Infinity });
  assert.equal(invalid.autoDirectionMinSeconds, 2);
  assert.equal(invalid.autoDirectionMaxSeconds, 6);
  const disabled = config.normalizeBackgroundConfig({ enabled: false, autoDriftEnabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.autoDriftEnabled, false);
});

test('random steering holds each heading until its sampled 2–6 second deadline and restarts without replaying hidden time', () => {
  const samples = [0.25, 0, 0.5, 0.999, 0.75, 0.5];
  let reads = 0;
  const drift = new motion.BackgroundAutodrift(config.backgroundConfig, () => samples[reads++ % samples.length]);
  assert.equal(drift.direction(10), Math.PI / 2);
  assert.equal(drift.direction(11.999), Math.PI / 2);
  assert.equal(reads, 2, 'RAF frequency does not resample direction or timing');
  assert.equal(drift.direction(12), Math.PI);
  assert.equal(drift.direction(17.995), Math.PI);
  assert.equal(drift.direction(17.996), Math.PI * 1.5);
  assert.equal(reads, 6);
  drift.reset();
  assert.equal(drift.direction(1000), Math.PI / 2);
  assert.equal(reads, 8, 'Resume chooses one direction rather than catching up every missed interval');
});

function backgroundFixture(context, options = {}) {
  const target = () => {
    const events = new Map();
    return {
      addEventListener(type, callback) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(callback); },
      removeEventListener(type, callback) { events.get(type)?.delete(callback); },
      emit(type, value = {}) { events.get(type)?.forEach((callback) => callback(value)); },
      listenerCount() { return [...events.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
    };
  };
  const hero = { ...target(), getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, width: 600 }) };
  const track = { style: {} };
  const layers = Array.from({ length: 4 }, () => ({ style: {} }));
  const root = { parentElement: hero, querySelectorAll: () => layers };
  const effects = [];
  let ref = 0, time = 0, frameId = 0, intersection;
  const frames = new Map();
  const fine = { ...target(), matches: options.fine ?? false };
  const reduced = { ...target(), matches: false };
  const windowTarget = target();
  const documentTarget = { ...target(), hidden: false };
  const previous = new Map(['window', 'document', 'matchMedia', 'innerHeight', 'performance', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map((key) => [key, global[key]]));
  Object.assign(global, {
    window: windowTarget, document: documentTarget, innerHeight: 600,
    performance: { now: () => time }, matchMedia: (query) => query.includes('reduced') ? reduced : fine,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} disconnect() {} },
  });
  const component = loadSource('components/FlavorBackground.tsx', (name) => {
    if (name === 'react') return { useRef: () => ({ current: ref++ ? track : root }), useMemo: (factory) => factory(), useEffect: (effect) => effects.push(effect) };
    if (name.endsWith('background-config')) return config;
    if (name === './BackgroundPattern') return { default: () => null };
    if (name.endsWith('background-motion')) return motion;
    if (name.endsWith('background-render-state')) return rendering;
    return require(name);
  }).default;
  const renderState = new rendering.BackgroundRenderState();
  component({ flavorIndex: 0, config: options.config ?? config.backgroundConfig, renderState });
  const cleanups = effects.map((effect) => effect());
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanups.forEach((cleanup) => cleanup?.());
    for (const [key, value] of previous) { if (value === undefined) delete global[key]; else global[key] = value; }
  };
  context.after(dispose);
  const advance = (seconds) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) {
      time += 1000 / 60;
      const active = [...frames.values()]; frames.clear(); active.forEach((callback) => callback(time));
    }
  };
  const position = () => [...(track.style.transform ?? 'translate3d(0px,0px,0)').matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]));
  return { hero, track, advance, position, frames, windowTarget, documentTarget, reduced, fine, renderState, dispose,
    setVisible: (value) => intersection([{ isIntersecting: value }]) };
}

test('coarse-pointer mobile backgrounds drift without input and suspend cleanly for lifecycle and reduced motion', (context) => {
  const f = backgroundFixture(context);
  f.advance(1);
  assert.ok(Math.hypot(...f.position()) > 5, 'Touch hero must travel automatically before any interaction');
  f.hero.emit('pointermove', { pointerType: 'touch', clientX: 300, clientY: 300 });
  const before = f.track.style.transform; f.advance(1);
  assert.notEqual(f.track.style.transform, before, 'Touch input cannot freeze automatic movement');
  for (const [pause, resume] of [
    [() => { f.documentTarget.hidden = true; f.documentTarget.emit('visibilitychange'); }, () => { f.documentTarget.hidden = false; f.documentTarget.emit('visibilitychange'); }],
    [() => f.setVisible(false), () => f.setVisible(true)],
    [() => { f.reduced.matches = true; f.reduced.emit('change'); }, () => { f.reduced.matches = false; f.reduced.emit('change'); }],
  ]) {
    pause(); const paused = f.track.style.transform;
    assert.equal(f.frames.size, 0); f.advance(10); assert.equal(f.track.style.transform, paused);
    resume(); f.advance(1); assert.notEqual(f.track.style.transform, paused);
    assert.equal(f.frames.size, 1, 'Resume must create one RAF loop');
  }
  f.dispose();
  assert.equal(f.frames.size, 0);
  for (const surface of [f.hero, f.windowTarget, f.documentTarget, f.reduced, f.fine]) assert.equal(surface.listenerCount(), 0);
  assert.equal(f.renderState.wake, undefined);
});

test('visible backgrounds start at configured speed without focus, clicks or pointer input', (context) => {
  const f = backgroundFixture(context, { fine: true });
  // Browser previews and newly opened windows can blur before their first paint.
  f.windowTarget.emit('blur'); f.setVisible(true);
  assert.equal(f.frames.size, 1, 'Window focus must not gate visible-page animation');
  f.advance(0.1);
  assert.ok(Math.abs(Math.hypot(...f.position()) - config.backgroundConfig.maxSpeed * 0.1) < 0.001,
    'Autonomous travel begins immediately rather than waiting for an interaction or acceleration ramp');
  const before = f.track.style.transform;
  f.windowTarget.emit('blur'); f.advance(0.5);
  assert.notEqual(f.track.style.transform, before, 'Visible unfocused pages continue autonomous travel');
  assert.equal(f.frames.size, 1);
  f.hero.emit('pointermove', { pointerType: 'mouse', clientX: 300, clientY: 300 });
  const center = f.position(); f.advance(1 / 60);
  const after = f.position();
  assert.ok(Math.abs(Math.hypot(after[0] - center[0], after[1] - center[1]) - config.backgroundConfig.maxSpeed / 60) < 0.001,
    'A cursor at the exact hero center relinquishes steering without stopping travel');
});

test('mouse-to-autonomous handoff preserves speed and master disable keeps both input modes static', (context) => {
  const f = backgroundFixture(context, { fine: true });
  f.hero.emit('pointermove', { pointerType: 'mouse', clientX: 550, clientY: 300 }); f.advance(12);
  const before = f.position(); f.hero.emit('pointerleave'); f.advance(1 / 60);
  const after = f.position();
  assert.ok(Math.abs(Math.hypot(after[0] - before[0], after[1] - before[1]) - config.backgroundConfig.maxSpeed / 60) < 0.001,
    'Leaving the hero hands over steering without deceleration or a positional jump');
  f.dispose();
  const disabled = backgroundFixture(context, { fine: true, config: { enabled: false } });
  disabled.hero.emit('pointermove', { pointerType: 'mouse', clientX: 550, clientY: 300 }); disabled.advance(10);
  assert.deepEqual(disabled.position(), [0, 0]);
});
