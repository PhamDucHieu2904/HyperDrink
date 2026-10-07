/* Run with: node scripts/tests/background-themes.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Node harness executes production TS with browser boundaries replaced. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
function loadSource(file, importer = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', outputText)(importer, loaded, loaded.exports); return loaded.exports;
}
const config = loadSource('lib/background-config.ts', name => name === './showcase-flavors' ? loadSource('lib/showcase-flavors.ts') : require(name));
const rendering = loadSource('lib/background-render-state.ts', name => name === './background-config' ? config : require(name));
const themes = Array.from({ length: 32 }, (_, index) => ({ id: `flavor-${index}`, color: `#${(0x112233 + index).toString(16)}`, icon: index % 2 ? 'leaf' : 'citrus' }));
function normalizedWeights(state) {
  assert.ok(state.weights.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1));
  assert.ok(Math.abs(state.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-10);
}
function backgroundComponent(effects = []) {
  return loadSource('components/FlavorBackground.tsx', name => {
    if (name === 'react') return { useRef: () => ({ current: null }), useMemo: factory => factory(), useEffect: effect => effects.push(effect) };
    if (name.endsWith('background-config')) return config;
    if (name.endsWith('background-render-state')) return rendering;
    if (name === './BackgroundPattern') return { default: () => null };
    if (name.endsWith('background-motion')) return loadSource('lib/background-motion.ts');
    return require(name);
  }).default;
}

test('default themes remain compatible while arbitrary catalog counts and repeated icons transition correctly', () => {
  assert.deepEqual(new rendering.BackgroundRenderState().weights, [1, 0, 0, 0]);
  const state = new rendering.BackgroundRenderState(config.backgroundConfig, themes);
  assert.equal(state.weights.length, 32); assert.equal(state.fromWeights.length, 32);
  state.setFlavor(23, 100, false); state.advance(550, false);
  assert.equal(state.weights[0], .5); assert.equal(state.weights[23], .5); normalizedWeights(state);
  state.setFlavor(31, 550, false); state.advance(1000, false);
  assert.equal(state.weights[0], .25); assert.equal(state.weights[23], .25); assert.equal(state.weights[31], .5);
  state.advance(1450, false); assert.equal(state.weights[31], 1); normalizedWeights(state);
});

test('an immediately initialized catalog flavor stays settled when normal-motion effects and frames start', () => {
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(23, 0, true);
  for (const now of [50, 200]) {
    state.setFlavor(23, now, false);
    state.advance(now, false);
    assert.equal(state.weights[23], 1, 'Startup must not revive the first catalog theme');
    assert.equal(state.weights[0], 0);
    normalizedWeights(state);
  }
  state.setFlavor(31, 200, false); state.advance(650, false);
  assert.equal(state.weights[23], .5); assert.equal(state.weights[31], .5);
  assert.equal(state.weights[0], 0, 'A later user transition starts from the visible initialized theme');
  state.advance(1100, false); assert.equal(state.weights[31], 1); normalizedWeights(state);
});

test('theme replacements keep selection and in-flight weights by ID, retain pattern position and invalidate once', () => {
  const state = new rendering.BackgroundRenderState({}, themes);
  let wakes = 0; state.setWake(() => { wakes += 1; }); state.setPatternOffset(-25, 37);
  state.setFlavor(23, 0, false); state.advance(450, false);
  const reversed = [...themes].reverse(); state.setThemes(reversed, 450, false);
  assert.equal(state.flavorIndex, 8); assert.equal(state.themes[state.flavorIndex].id, 'flavor-23');
  assert.equal(state.weights[8], .5); assert.equal(state.weights[31], .5); normalizedWeights(state);
  assert.deepEqual(state.patternOffset, { x: -25, y: 37 }); assert.equal(state.themeRevision, 1); assert.equal(wakes, 2);
  state.setThemes(reversed.map(theme => ({ ...theme })), 460, false);
  assert.equal(state.themeRevision, 1); assert.equal(wakes, 2, 'An identical refresh does not restart animation or invalidate textures');
  state.advance(1350, false); assert.equal(state.weights[8], 1);
  state.setThemes([...reversed, { id: 'extra', color: '#abcdef', icon: 'mango' }], 1400, false);
  assert.equal(state.weights.length, 33); assert.equal(state.weights[8], 1); assert.equal(state.weights[32], 0);
});

test('removed or empty theme collections and invalid indices resolve to one finite visible theme', () => {
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(31, 0, true);
  state.setThemes(themes.slice(0, 2), 10, false); state.advance(910, false);
  assert.equal(state.flavorIndex, 1); assert.deepEqual(state.weights, [0, 1]); normalizedWeights(state);
  state.setFlavor(-30, 1000, true); assert.equal(state.flavorIndex, 0);
  state.setFlavor(Infinity, 1001, true); assert.equal(state.flavorIndex, 0);
  state.setFlavor(100, 1002, true); assert.equal(state.flavorIndex, 1);
  state.setThemes([], 1100, false); assert.equal(state.themes.length, 1); assert.deepEqual(state.weights, [1]); normalizedWeights(state);
});

test('reduced motion settles transitions immediately including live theme-array changes', () => {
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(24, 100, false); state.advance(200, false); assert.ok(state.weights[24] < 1);
  state.setFlavor(24, 200, true); assert.equal(state.weights[24], 1); normalizedWeights(state);
  state.advance(201, false); assert.equal(state.weights[24], 1, 'Disabling reduced motion cannot resume a settled transition');
  state.setThemes([...themes].reverse(), 201, true); assert.equal(state.flavorIndex, 7); assert.equal(state.weights[7], 1);
  state.setFlavor(7, 202, false); state.advance(203, false); assert.equal(state.weights[7], 1);
  state.setFlavor(30, 202, true); assert.equal(state.weights[30], 1); normalizedWeights(state);
});

test('icon registry safely defaults unknown values and normalized IDs remain unique when icons repeat', () => {
  const normalized = config.normalizeBackgroundThemes([{ id: 'same', color: '#123456', icon: 'leaf' }, { id: 'same', color: 'url(evil)', icon: '<script />' }, { id: 'same-1', color: '#abcdef', icon: ' MANGO ' }]);
  assert.equal(new Set(normalized.map(theme => theme.id)).size, 3); assert.equal(normalized[1].color, '#54684f');
  assert.equal(normalized[1].icon, 'leaf'); assert.equal(normalized[2].icon, 'mango');
  assert.equal(rendering.backgroundTileUrl('unknown', config.backgroundConfig), rendering.backgroundTileUrl('leaf', config.backgroundConfig));
  for (const icon of config.backgroundIconNames) {
    const svg = decodeURIComponent(rendering.backgroundTileUrl(icon, config.backgroundConfig));
    assert.ok(svg.includes('<path')); assert.ok(!svg.includes('undefined')); assert.ok(!svg.includes('<script'));
  }
});

test('FlavorBackground emits one layer per catalog item with unique keys even when every icon is identical', () => {
  const effects = [];
  const component = backgroundComponent(effects);
  const catalogThemes = themes.map(theme => ({ ...theme, icon: 'leaf' }));
  const state = new rendering.BackgroundRenderState({}, catalogThemes);
  const tree = component({ flavorIndex: 23, themes: catalogThemes, renderState: state });
  const colors = tree.props.children[0], patterns = tree.props.children[1].props.children;
  assert.equal(colors.length, 32); assert.equal(patterns.length, 32);
  assert.equal(new Set(colors.map(layer => layer.key)).size, 32); assert.equal(new Set(patterns.map(layer => layer.key)).size, 32);
  assert.equal(colors[23].props.style.backgroundColor, catalogThemes[23].color);
  assert.equal(patterns[23].props.opacity, 0, 'A requested theme must not flash before its fade begins');
  assert.equal(patterns[0].props.opacity, 1);
  const originalMedia = global.matchMedia, originalPerformance = global.performance;
  try {
    global.matchMedia = () => ({ matches: true }); global.performance = { now: () => 200 };
    effects[0](); assert.equal(state.flavorIndex, 23); assert.equal(state.weights[23], 0);
    state.advance(650, false); assert.ok(state.weights[23] > 0 && state.weights[23] < 1, 'OS reduced motion does not skip the theme crossfade');
    state.advance(1100, false); assert.equal(state.weights[23], 1);
  } finally { global.matchMedia = originalMedia; global.performance = originalPerformance; }
});

test('the first FlavorBackground effect keeps the already selected startup color and icon at normal motion', () => {
  const effects = [];
  const component = backgroundComponent(effects);
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(23, 0, true);
  const tree = component({ flavorIndex: 23, themes, renderState: state });
  assert.equal(tree.props.children[0][23].props.style.opacity, 1);
  assert.equal(tree.props.children[1].props.children[23].props.theme.icon, themes[23].icon);
  const originalMedia = global.matchMedia, originalPerformance = global.performance;
  try {
    global.matchMedia = () => ({ matches: false }); global.performance = { now: () => 50 };
    effects[0](); state.advance(200, false);
    assert.equal(state.weights[23], 1); assert.equal(state.weights[0], 0);
  } finally { global.matchMedia = originalMedia; global.performance = originalPerformance; }
});

test('React renders preserve the visible blend when a new selection interrupts an unfinished fade', () => {
  const component = backgroundComponent();
  const state = new rendering.BackgroundRenderState({}, themes);
  const render = flavorIndex => component({ flavorIndex, themes, renderState: state });
  const opacities = tree => [tree.props.children[0].map(layer => layer.props.style.opacity), tree.props.children[1].props.children.map(layer => layer.props.opacity)];
  state.setFlavor(23, 0, true);
  let tree = render(31);
  for (const layers of opacities(tree)) {
    assert.equal(layers[23], 1);
    assert.equal(layers[31], 0, 'The next requested color and icon cannot snap on during React commit');
  }
  state.setFlavor(31, 100, false); state.advance(550, false);
  tree = render(5);
  for (const layers of opacities(tree)) {
    assert.equal(layers[23], .5); assert.equal(layers[31], .5);
    assert.equal(layers[5], 0, 'Interrupting the fade keeps its current mixed image');
  }
  state.setFlavor(5, 550, false); state.advance(1000, false);
  tree = render(5);
  for (const layers of opacities(tree)) {
    assert.equal(layers[23], .25); assert.equal(layers[31], .25); assert.equal(layers[5], .5);
  }
});

test('React renders remap both color and icon opacity by theme ID before a reordered catalog effect runs', () => {
  const component = backgroundComponent();
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(23, 0, false); state.advance(450, false);
  const reordered = [...themes].reverse();
  const tree = component({ flavorIndex: 8, themes: reordered, renderState: state });
  const colors = tree.props.children[0], patterns = tree.props.children[1].props.children;
  assert.equal(colors[8].key, 'flavor-23'); assert.equal(colors[31].key, 'flavor-0');
  assert.equal(colors[8].props.style.opacity, .5); assert.equal(colors[31].props.style.opacity, .5);
  assert.equal(patterns[8].props.opacity, .5); assert.equal(patterns[31].props.opacity, .5);
  assert.equal(colors[0].props.style.opacity, 0); assert.equal(patterns[0].props.opacity, 0);
  assert.equal(state.themes[0].id, 'flavor-0', 'Rendering must not mutate controller order before its effect');
});

test('a catalog with no retained visible theme renders its selected color and icon immediately', () => {
  const component = backgroundComponent();
  const state = new rendering.BackgroundRenderState({}, themes);
  const replacement = themes.slice(0, 4).map(theme => ({ ...theme, id: `new-${theme.id}` }));
  const tree = component({ flavorIndex: 2, themes: replacement, renderState: state });
  assert.deepEqual(tree.props.children[0].map(layer => layer.props.style.opacity), [0, 0, 1, 0]);
  assert.deepEqual(tree.props.children[1].props.children.map(layer => layer.props.opacity), [0, 0, 1, 0]);
});


test('custom icon URLs survive normalization, reject unsafe schemes and invalidate a live theme replacement', () => {
  for (const url of ['/catalog/media/icon.webp', '/api/public/v1/media/icon', 'https://cdn.example.test/icon.webp']) {
    const state = new rendering.BackgroundRenderState({}, [{ id: 'one', color: '#123456', icon: 'apple', iconUrl: url }]);
    assert.equal(state.themes[0].iconUrl, url);
    state.setThemes([{ ...state.themes[0], iconUrl: '/catalog/media/replacement.webp' }], 500, true);
    assert.equal(state.themeRevision, 1); assert.equal(state.weights[0], 1);
  }
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//external.test/file', '/a\n.webp']) {
    assert.equal(config.normalizeBackgroundThemes([{ color: '#123456', icon: 'apple', iconUrl: url }])[0].iconUrl, undefined);
  }
});

const imageTiles = loadSource('lib/background-image-tile.ts', name => name.endsWith('background-render-state') ? rendering : require(name));
test('portrait, landscape and square custom symbols fit inside the same centered background slot', () => {
  for (const [width, height] of [[20, 80], [400, 80], [128, 128]]) {
    const rect = imageTiles.backgroundIconRect(width, height, 88, 38);
    assert.equal(rect.width / rect.height, width / height);
    assert.equal(Math.max(rect.width, rect.height), 38);
    assert.equal(rect.x + rect.width / 2, 44); assert.equal(rect.y + rect.height / 2, 44);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 88 && rect.y + rect.height <= 88);
  }
});

test('custom symbols produce one shared self-contained tile for DOM and water, with proportional size and opacity', async () => {
  const prior = new Map(['Image', 'document', 'window'].map(key => [key, global[key]]));
  const draws = [], images = [], context = { globalAlpha: 1, scale() {}, drawImage(image, ...area) { draws.push({ url: image.src, alpha: this.globalAlpha, area }); } };
  try {
    global.window = { location: { origin: 'http://127.0.0.1:3100' } };
    global.document = { createElement: () => ({ getContext: () => context, toDataURL: () => 'data:image/png;base64,tile' }) };
    global.Image = class {
      constructor() { images.push(this); }
      set src(value) { this.url = value; this.naturalWidth = value.startsWith('data:') ? 264 : 20; this.naturalHeight = value.startsWith('data:') ? 264 : 80; queueMicrotask(() => this.onload?.()); }
      get src() { return this.url; }
    };
    const theme = { icon: 'apple', iconUrl: '/catalog/media/narrow-test.webp' };
    const pending = imageTiles.loadBackgroundTile(theme, config.backgroundConfig);
    assert.equal(imageTiles.loadBackgroundTile(theme, config.backgroundConfig), pending, 'Both consumers reuse one conversion');
    assert.equal(await pending, 'data:image/png;base64,tile'); assert.equal(images.length, 2);
    const icon = draws[1]; assert.equal(icon.alpha, .65); assert.deepEqual(icon.area, [39.25, 25, 9.5, 38]);
    assert.doesNotMatch(decodeURIComponent(draws[0].url), /<circle/);
    global.Image = class { set src(value) { this.url = value; queueMicrotask(() => this.onerror?.()); } };
    assert.equal(await imageTiles.loadBackgroundTile({ icon: 'grape', iconUrl: '/catalog/media/missing.webp' }, config.backgroundConfig), rendering.backgroundTileUrl('grape', config.backgroundConfig));
  } finally { for (const [key, value] of prior) if (value === undefined) delete global[key]; else global[key] = value; }
});
