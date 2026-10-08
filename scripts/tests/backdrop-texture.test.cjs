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
const rendering = loadSource('lib/background-render-state.ts', name => name === './background-config' ? config : require(name));
const painter = loadSource('lib/viewer/backdrop-texture.ts', name => {
  if (name === 'three') return THREE;
  if (name.endsWith('background-config')) return config;
  if (name.endsWith('background-render-state')) return rendering;
  if (name.endsWith('background-image-tile')) return loadSource('lib/background-image-tile.ts', dependency => dependency.endsWith('background-render-state') ? rendering : require(dependency));
  throw new Error(`Unexpected painter dependency: ${name}`);
});

function fixture(context, { mobile = false, withHero = true, withStudio = false } = {}) {
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
  const mount = { ...rect(mountBounds), closest: selector => withHero || withStudio && selector.includes('[data-refraction-backdrop]') ? hero : null };
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

test('Studio refraction crops its own live grid/icons and glow in the same coordinates as FlavorBackground', context => {
  const f = fixture(context, { withHero: false, withStudio: true });
  f.images.forEach(image => { image.complete = true; image.onload(); });
  f.state.setPatternOffset(17, -8); f.at(100); f.update();
  assert.equal(f.observed.length, 3, 'The Studio surface, viewer and aligned glow all invalidate the crop');
  assert.ok(f.patterns.length > 0, 'A Studio preview needs the live patterned surface, not the generic solid fallback');
  assert.ok(f.patterns.every(pattern => pattern.matrix.x === 17 && pattern.matrix.y === -8));
  assert.equal(f.gradients.length > 0, true);
});

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

test('water backdrop paints the actual 24th catalog flavor and refreshes colors/icons when the count stays unchanged', context => {
  const f = fixture(context);
  const catalogThemes = Array.from({ length: 24 }, (_, index) => ({ id: `catalog-${index}`, color: `#${(0x335500 + index).toString(16)}`, icon: 'leaf' }));
  const initialImages = [...f.images];
  f.state.setThemes(catalogThemes, 0, true); f.state.setFlavor(23, 0, true);
  f.state.setPatternOffset(-18, 26); f.at(40); f.update();
  assert.equal(f.state.weights.length, 24); assert.equal(f.state.weights[23], 1);
  assert.ok(f.fills.some(fill => fill.fill === catalogThemes[23].color && fill.alpha === 1), 'Water uses catalog flavor 23 rather than a four-item fallback');
  assert.ok(initialImages.every(image => image.onload === null && image.src === ''), 'Previous theme images release handlers and sources');
  const firstImages = f.images.slice(initialImages.length);
  assert.equal(firstImages.length, 24);
  firstImages.forEach(image => { image.complete = true; image.onload(); });
  f.at(80); f.update();
  const firstPatternFill = f.fills.filter(fill => fill.fill?.matrix).at(-1);
  assert.equal(firstPatternFill.alpha, 1); assert.equal(firstPatternFill.fill.image, firstImages[23]);
  assert.equal(firstPatternFill.fill.matrix.x, -18); assert.equal(firstPatternFill.fill.matrix.y, 26);
  const originalRevision = f.state.themeRevision, previousVersion = f.texture.version;
  const revised = catalogThemes.map((theme, index) => index === 23 ? { ...theme, color: '#fedcba', icon: 'mango' } : theme);
  f.state.setThemes(revised, 80, true); f.at(120); f.update();
  assert.equal(f.state.themeRevision, originalRevision + 1); assert.equal(f.state.weights.length, 24);
  assert.equal(f.state.flavorIndex, 23); assert.equal(f.texture.version, previousVersion + 1);
  assert.ok(f.fills.some(fill => fill.fill === '#fedcba' && fill.alpha === 1), 'A same-count palette update must repaint even when weights and offsets are unchanged');
  assert.ok(firstImages.every(image => image.onload === null && image.src === ''), 'All replaced image resources are detached');
  const revisedImages = f.images.slice(initialImages.length + firstImages.length);
  assert.equal(revisedImages.length, 24); assert.equal(revisedImages[23].src, rendering.backgroundTileUrl('mango', config.backgroundConfig));
  revisedImages.forEach(image => { image.complete = true; image.onload(); });
  f.at(160); f.update();
  const revisedPatternFill = f.fills.filter(fill => fill.fill?.matrix).at(-1);
  assert.equal(revisedPatternFill.fill.image, revisedImages[23]); assert.notEqual(revisedPatternFill.fill, firstPatternFill.fill);
  assert.equal(revisedPatternFill.alpha, 1); assert.equal(revisedPatternFill.fill.matrix.x, -18); assert.equal(revisedPatternFill.fill.matrix.y, 26);
  const patternCount = f.patterns.length, version = f.texture.version;
  f.at(200); f.update(); assert.equal(f.texture.version, version, 'An unchanged refreshed palette remains cached');
  f.state.setPatternOffset(9, 11); f.at(240); f.update();
  assert.equal(f.patterns.length, patternCount, 'Movement reuses the new pattern cache');
  f.dispose(); assert.ok(f.images.every(image => image.onload === null && image.src === ''));
});

test('water backdrop keeps the selected catalog ID and matching icon after theme reorder or removal', context => {
  const f = fixture(context, { withHero: false });
  const catalogThemes = Array.from({ length: 24 }, (_, index) => ({ id: `catalog-${index}`, color: `#${(0x224400 + index).toString(16)}`, icon: index === 23 ? 'coconut' : 'leaf' }));
  f.state.setThemes(catalogThemes, 0, true); f.state.setFlavor(23, 0, true); f.at(40); f.update();
  assert.equal(f.fills.at(-1).fill, catalogThemes[23].color); assert.equal(f.fills.at(-1).alpha, 1);
  f.state.setThemes([...catalogThemes].reverse(), 40, true); f.at(80); f.update();
  assert.equal(f.state.flavorIndex, 0); assert.equal(f.state.themes[0].id, 'catalog-23');
  assert.equal(f.images.at(-24).src, rendering.backgroundTileUrl('coconut', config.backgroundConfig));
  const visibleFills = f.fills.filter(fill => typeof fill.fill === 'string' && fill.alpha === 1);
  assert.equal(visibleFills.at(-1).fill, catalogThemes[23].color);
  f.state.setThemes([{ id: 'only', color: '#aabbcc', icon: 'citrus' }], 80, true); f.at(120); f.update();
  assert.equal(f.fills.at(-1).fill, '#aabbcc'); assert.equal(f.fills.at(-1).alpha, 1); assert.deepEqual(f.state.weights, [1]);
  assert.equal(f.patterns.length, 0, 'Generic viewers retain their solid-color fallback');
});
