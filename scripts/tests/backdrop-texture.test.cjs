/* Run with: node scripts/tests/backdrop-texture.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Browser boundaries are replaced while production painter and real Three.js texture lifecycle run. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
function loadSource(relativePath, requireModule = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(requireModule, loaded, loaded.exports);
  return loaded.exports;
}
const config = loadSource('lib/background-config.ts', () => loadSource('lib/showcase-flavors.ts'));
const rendering = loadSource('lib/background-render-state.ts');
const painter = loadSource('lib/viewer/backdrop-texture.ts', name => {
  if (name === 'three') return THREE;
  if (name.endsWith('background-config')) return config;
  if (name.endsWith('background-render-state')) return rendering;
  throw new Error(`Unexpected painter dependency: ${name}`);
});

function fixture(context, { mobile = false, withHero = true } = {}) {
  let time = 0, reads = 0, resize, disconnected = false;
  const images = [], observed = [], fills = [], transforms = [], gradients = [], patterns = [];
  const drawing = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '',
    setTransform(...args) { transforms.push(args); },
    fillRect(...area) { fills.push({ area, alpha: this.globalAlpha, composite: this.globalCompositeOperation, fill: this.fillStyle }); },
    save() { this.saved = { alpha: this.globalAlpha, composite: this.globalCompositeOperation }; },
    restore() { this.globalAlpha = this.saved.alpha; this.globalCompositeOperation = this.saved.composite; },
    translate() {}, scale() {},
    createRadialGradient() { const gradient = { stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; gradients.push(gradient); return gradient; },
    createPattern(image) { const pattern = { image, setTransform(matrix) { this.matrix = matrix; } }; patterns.push(pattern); return pattern; },
  };
  const canvas = { width: 300, height: 150, getContext: () => drawing };
  const rect = value => ({ getBoundingClientRect() { reads += 1; return value; } });
  const light = rect({ left: 580, top: 100, width: 900, height: 1000 });
  const hero = { ...rect({ left: 20, top: 30, width: 1800, height: 1000 }), querySelector: () => light };
  const mountBounds = { left: 650, top: 150, width: 800, height: 900 };
  const mount = { ...rect(mountBounds), closest: () => withHero ? hero : null };
  const previous = new Map(['document', 'Image', 'DOMMatrix', 'ResizeObserver', 'matchMedia', 'performance'].map(key => [key, global[key]]));
  Object.assign(global, {
    document: { createElement: () => canvas }, matchMedia: () => ({ matches: mobile }), performance: { now: () => time },
    Image: class { constructor() { this.complete = false; this.naturalWidth = 264; this.naturalHeight = 264; images.push(this); } },
    DOMMatrix: class { translate(x, y) { this.x = x; this.y = y; return this; } scale(x, y) { this.scaleX = x; this.scaleY = y; return this; } },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe(element) { observed.push(element); } disconnect() { disconnected = true; } },
  });
  const state = new rendering.BackgroundRenderState();
  const result = painter.createBackdropTexture(state, config.backgroundConfig, mount);
  let disposalEvents = 0;
  result.texture.addEventListener('dispose', () => { disposalEvents += 1; });
  context.after(() => {
    result.dispose();
    for (const [key, value] of previous) { if (value === undefined) delete global[key]; else global[key] = value; }
  });
  return { ...result, state, images, canvas, drawing, fills, transforms, gradients, patterns, observed,
    currentTexture: () => result.texture, mountBounds,
    at: value => { time = value; }, reads: () => reads, resize: () => resize(), disconnected: () => disconnected,
    disposalEvents: () => disposalEvents };
}

test('backdrop matches viewer crop, CSS theme compositing, live SVG origins and overlay light while throttling uploads', context => {
  const f = fixture(context);
  assert.equal(f.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(f.texture.flipY, true, 'WebGL lower-left coordinates must sample the matching canvas crop');
  assert.equal(f.texture.generateMipmaps, false);
  assert.ok(Math.max(f.canvas.width, f.canvas.height) <= 768);
  const [sx, , , sy, tx, ty] = f.transforms[0];
  assert.equal(tx, -(650 - 20) * sx); assert.equal(ty, -(150 - 30) * sy);
  assert.ok(f.gradients.some(gradient => gradient.stops.some(([at, color]) => at === 0.29 && color === 'rgba(255,255,255,0.88)')));
  assert.ok(f.fills.some(fill => fill.composite === 'overlay' && fill.alpha === config.backgroundConfig.productGlowOpacity));
  const reads = f.reads(), initialVersion = f.texture.version;
  f.state.weights.splice(0, 4, 0.4, 0.6, 0, 0); f.state.setPatternOffset(-12, 37);
  for (const image of f.images) { image.complete = true; image.onload(); }
  f.at(16); f.update(); assert.equal(f.texture.version, initialVersion, 'New input does not exceed 30 texture uploads/s');
  f.at(40); f.update(); assert.equal(f.texture.version, initialVersion + 1);
  assert.equal(f.reads(), reads, 'A frame never rereads layout');
  const patternFills = f.fills.filter(fill => fill.fill?.matrix);
  assert.deepEqual(patternFills.map(fill => fill.alpha), [0.4, 0.6]);
  for (const fill of patternFills) {
    assert.equal(fill.fill.matrix.x, -12); assert.equal(fill.fill.matrix.y, 37);
    assert.equal(fill.fill.matrix.scaleX, 1); assert.equal(fill.fill.matrix.scaleY, 1);
  }
  f.at(100); f.update(); assert.equal(f.texture.version, initialVersion + 1, 'Unchanged decorative data does not upload');
  const patternCount = f.patterns.length;
  f.state.setPatternOffset(10, 20); f.at(150); f.update();
  assert.equal(f.patterns.length, patternCount, 'Decoded SVG patterns are cached rather than recreated per frame');
});

test('mobile backdrop caps resolution, invalidates after resize and releases late image/observer/GPU resources idempotently', context => {
  const f = fixture(context, { mobile: true });
  assert.ok(Math.max(f.canvas.width, f.canvas.height) <= 512);
  assert.equal(f.observed.length, 3);
  const beforeResize = f.texture.version; f.resize(); f.at(40); f.update();
  assert.equal(f.texture.version, beforeResize + 1);
  const lateLoad = f.images[0].onload;
  f.dispose(); f.dispose();
  assert.equal(f.disconnected(), true); assert.equal(f.disposalEvents(), 1);
  assert.ok(f.images.every(image => image.onload === null && image.src === ''));
  const disposedVersion = f.texture.version; lateLoad(); f.at(100); f.update();
  assert.equal(f.texture.version, disposedVersion, 'A late SVG completion cannot revive a disposed painter');
});

test('generic viewers use a current-flavor solid fallback and observe only their own mount', context => {
  const f = fixture(context, { withHero: false });
  assert.equal(f.observed.length, 1);
  assert.equal(f.gradients.length, 0);
  assert.equal(f.patterns.length, 0);
  f.state.weights.splice(0, 4, 0, 0, 0, 1); f.at(40); f.update();
  assert.equal(f.fills.at(-1).fill, config.backgroundThemes[3].color);
  assert.equal(f.fills.at(-1).alpha, 1);
});

test('orientation changes replace immutable GPU texture storage and repaint the cleared canvas before capture', context => {
  const f = fixture(context);
  const oldTexture = f.currentTexture();
  let oldDisposals = 0;
  oldTexture.addEventListener('dispose', () => { oldDisposals += 1; });
  f.at(10);
  f.mountBounds.width = 360; f.mountBounds.height = 640;
  f.resize();
  const replacement = f.currentTexture();
  assert.notEqual(replacement, oldTexture, 'An uploaded GPU texture cannot retain the old dimensions');
  assert.equal(oldDisposals, 1);
  const version = replacement.version;
  f.update();
  assert.equal(replacement.version, version + 1, 'A resized canvas repaints immediately, within the normal 33ms throttle');
  assert.equal(replacement.colorSpace, THREE.SRGBColorSpace);
  let currentDisposals = 0;
  replacement.addEventListener('dispose', () => { currentDisposals += 1; });
  f.resize();
  assert.equal(f.currentTexture(), replacement, 'A position-only layout update retains matching texture dimensions');
  f.dispose(); f.dispose();
  assert.equal(oldDisposals, 1); assert.equal(currentDisposals, 1);
});
