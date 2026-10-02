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
  const component = loadSource('components/FlavorBackground.tsx', name => {
    if (name === 'react') return { useRef: () => ({ current: null }), useMemo: factory => factory(), useEffect: effect => effects.push(effect) };
    if (name.endsWith('background-config')) return config;
    if (name.endsWith('background-render-state')) return rendering;
    if (name.endsWith('background-motion')) return loadSource('lib/background-motion.ts');
    return require(name);
  }).default;
  const catalogThemes = themes.map(theme => ({ ...theme, icon: 'leaf' }));
  const state = new rendering.BackgroundRenderState({}, catalogThemes);
  const tree = component({ flavorIndex: 23, themes: catalogThemes, renderState: state });
  const colors = tree.props.children[0], patterns = tree.props.children[1].props.children;
  assert.equal(colors.length, 32); assert.equal(patterns.length, 32);
  assert.equal(new Set(colors.map(layer => layer.key)).size, 32); assert.equal(new Set(patterns.map(layer => layer.key)).size, 32);
  assert.equal(colors[23].props.style.backgroundColor, catalogThemes[23].color);
  assert.equal(patterns[23].props.style.opacity, 1);
  const originalMedia = global.matchMedia, originalPerformance = global.performance;
  try {
    global.matchMedia = () => ({ matches: true }); global.performance = { now: () => 200 };
    effects[0](); assert.equal(state.flavorIndex, 23); assert.equal(state.weights[23], 1);
  } finally { global.matchMedia = originalMedia; global.performance = originalPerformance; }
});

test('the first FlavorBackground effect keeps the already selected startup color and icon at normal motion', () => {
  const effects = [];
  const component = loadSource('components/FlavorBackground.tsx', name => {
    if (name === 'react') return { useRef: () => ({ current: null }), useMemo: factory => factory(), useEffect: effect => effects.push(effect) };
    if (name.endsWith('background-config')) return config;
    if (name.endsWith('background-render-state')) return rendering;
    if (name.endsWith('background-motion')) return loadSource('lib/background-motion.ts');
    return require(name);
  }).default;
  const state = new rendering.BackgroundRenderState({}, themes);
  state.setFlavor(23, 0, true);
  const tree = component({ flavorIndex: 23, themes, renderState: state });
  assert.equal(tree.props.children[0][23].props.style.opacity, 1);
  assert.equal(tree.props.children[1].props.children[23].props.style.backgroundImage, `url("${rendering.backgroundTileUrl(themes[23].icon, config.backgroundConfig)}")`);
  const originalMedia = global.matchMedia, originalPerformance = global.performance;
  try {
    global.matchMedia = () => ({ matches: false }); global.performance = { now: () => 50 };
    effects[0](); state.advance(200, false);
    assert.equal(state.weights[23], 1); assert.equal(state.weights[0], 0);
  } finally { global.matchMedia = originalMedia; global.performance = originalPerformance; }
});
