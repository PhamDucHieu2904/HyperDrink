/* Run with: node scripts/tests/accent-scene.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Executes the actual TypeScript contracts without a build. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '../..');
const sourceCache = new Map();
function loadSource(relativePath) {
  const absolute = path.resolve(projectRoot, relativePath);
  if (sourceCache.has(absolute)) return sourceCache.get(absolute);
  const source = fs.readFileSync(absolute, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = { exports: {} };
  sourceCache.set(absolute, loaded.exports);
  const localRequire = specifier => specifier.startsWith('.')
    ? loadSource(path.relative(projectRoot, path.resolve(path.dirname(absolute), `${specifier}.ts`)))
    : require(specifier);
  new Function('require', 'module', 'exports', outputText)(localRequire, loaded, loaded.exports);
  sourceCache.set(absolute, loaded.exports);
  return loaded.exports;
}

const config = loadSource('lib/viewer/accent-config.ts');
const motion = loadSource('lib/viewer/accent-motion.ts');
const scene = config.DEFAULT_PRODUCT_ACCENT_SCENE;
const input = { key: 'can-330:lime', ready: true, viewerIdle: true, reducedMotion: false, deltaSeconds: 1 / 60, nodeCount: scene.nodes.length };
const advance = (state, overrides = {}) => motion.advanceAccentMotion(state, { ...input, ...overrides }, scene.motion);
const sample = (state, index = 0) => motion.sampleAccentNode(scene.nodes[index], state, index, scene.motion);
function settle(state = motion.createAccentMotion(input.key)) {
  for (let index = 0; index < 90; index += 1) state = advance(state);
  assert.equal(state.phase, 'idle');
  return state;
}

test('scene data supports replaceable flavor assets, deliberate depth and independent admin controls', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(scene)), scene, 'Saved scene contains only JSON data');
  assert.equal(new Set(scene.nodes.map(node => node.id)).size, scene.nodes.length);
  const counts = scene.nodes.reduce((result, node) => ({ ...result, [node.kind]: (result[node.kind] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { fruit: 2, leaf: 5, ice: 2, droplet: 20 });
  const fruit = scene.nodes.filter(node => node.kind === 'fruit');
  assert.ok(fruit.every(node => Math.abs(node.position[0]) > 0.3 && node.position[2] < 0));
  assert.ok(scene.nodes.some(node => node.depth === 'near' && node.blur >= 3));
  assert.ok(scene.nodes.some(node => node.depth === 'far' && node.blur > 0));
  const phaseValues = new Set(config.normalizeAccentScene().nodes.map(node => node.idle.phase));
  assert.ok(phaseValues.size > 20, 'Sanitizing phases must not collapse varied droplet phases to one maximum');

  const assigned = { ...fruit[0], assetUrl: '/models/props/fruit.glb', variants: { lime: { sprite: 'lime', assetUrl: '/models/props/lime.glb' } } };
  const resolved = config.resolveAccentNodeForFlavor(assigned, 'lime');
  assert.equal(resolved.assetUrl, '/models/props/lime.glb');
  assert.equal(resolved.sprite, 'lime');
  assert.equal(assigned.assetUrl, '/models/props/fruit.glb');
  assert.equal(config.resolveAccentNodes(scene, 'berry')[0].sprite, 'berry');
  const normalized = config.normalizeAccentScene({
    opacity: 2, motion: { burstSeconds: Number.NaN, staggerSeconds: -5 },
    nodes: [{ ...assigned, scale: 100, blur: -2, position: [Infinity, 10, -10] }, assigned],
  });
  assert.equal(normalized.nodes.length, 1, 'Duplicate identifiers cannot produce duplicate scene objects');
  assert.equal(normalized.nodes[0].assetUrl, assigned.assetUrl);
  assert.equal(normalized.nodes[0].scale, 0.5);
  assert.deepEqual(normalized.nodes[0].position, [0, 1.5, -1.5]);
  assert.equal(normalized.nodes[0].blur, 0);
  assert.equal(normalized.opacity, 1);
  assert.equal(normalized.motion.burstSeconds, scene.motion.burstSeconds);
  assert.equal(normalized.motion.staggerSeconds, 0);
});

test('persisted malformed sprites, colors, tint and asset URLs are sanitized before rendering', () => {
  const configured = config.normalizeAccentScene({ nodes: [{
    ...scene.nodes[0],
    sprite: 'unsupported-fruit', color: 'rgb(1, 2, 3)', secondaryColor: 123,
    tint: '#gggggg', assetUrl: 'javascript:alert(1)',
    variants: {
      unknownFlavor: { sprite: 'lime', assetUrl: '/models/ignored.glb' },
      berry: { sprite: null, color: '#fff', tint: 'invalid', assetUrl: '//untrusted.example/fruit.png' },
      lime: { sprite: 'lime', color: '#AaBbCc', secondaryColor: '#445566', tint: '#e0ffcc', assetUrl: 'https://cdn.example/lime.glb' },
    },
  }] });
  const node = configured.nodes[0];
  assert.equal(node.sprite, undefined, 'Invalid node sprite cannot survive the outer node spread');
  assert.equal(node.color, '#ffffff');
  assert.equal(node.secondaryColor, undefined);
  assert.equal(node.tint, undefined);
  assert.equal(node.assetUrl, '');
  assert.equal(node.variants.unknownFlavor, undefined);
  const berry = config.resolveAccentNodeForFlavor(node, 'berry');
  assert.equal(berry.sprite, undefined);
  assert.equal(berry.color, '#ffffff');
  assert.equal(berry.tint, undefined);
  assert.equal(berry.assetUrl, '');
  const lime = config.resolveAccentNodeForFlavor(node, 'lime');
  assert.equal(lime.sprite, 'lime');
  assert.equal(lime.color, '#AaBbCc');
  assert.equal(lime.secondaryColor, '#445566');
  assert.equal(lime.tint, '#e0ffcc');
  assert.equal(lime.assetUrl, 'https://cdn.example/lime.glb');
  for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,script', '//cdn.example/object.glb', 'http://cdn.example/object.glb', 'file:///object.glb', 42]) {
    const result = config.normalizeAccentScene({ nodes: [{ ...scene.nodes[0], assetUrl: unsafe }] });
    assert.equal(result.nodes[0].assetUrl, '');
  }
  const valid = config.normalizeAccentScene({ nodes: [{ ...scene.nodes[0], sprite: 'orange', color: '#ff9900', tint: '#ffffff', assetUrl: '/models/orange.glb?v=1' }] });
  assert.equal(valid.nodes[0].assetUrl, '/models/orange.glb?v=1');
  assert.equal(valid.nodes[0].sprite, 'orange');
  assert.equal(valid.nodes[0].tint, '#ffffff');
});

test('accents stay hidden until all assets are ready and package zoom plus rebound have completed', () => {
  let state = motion.createAccentMotion(input.key);
  for (let index = 0; index < 200; index += 1) state = advance(state, { ready: false });
  assert.equal(state.phase, 'waiting');
  assert.equal(sample(state).visible, false);
  for (let index = 0; index < 200; index += 1) state = advance(state, { viewerIdle: false });
  assert.equal(state.phase, 'waiting');
  assert.equal(state.elapsed, 0, 'Waiting does not consume the burst before the product settles');
  state = advance(state);
  assert.equal(state.phase, 'entering');
  assert.ok(sample(state).opacity > 0);
  assert.equal(sample(state, 28).visible, false, 'Later droplets are staggered rather than appearing in a rigid ring');
  state = settle(state);
  assert.ok(scene.nodes.every((node, index) => motion.sampleAccentNode(node, state, index, scene.motion).visible));
});

test('fan burst decelerates into slow floating idle without a transform jump', () => {
  const positions = [0, 0.25, 0.5, 0.75, 1].map(motion.accentBurstProgress);
  assert.equal(positions[0], 0);
  assert.equal(positions[4], 1);
  for (let index = 1; index < 4; index += 1) {
    assert.ok(positions[index + 1] - positions[index] < positions[index] - positions[index - 1]);
  }
  let state = motion.createAccentMotion(input.key);
  let previousFrame = sample(state, 28);
  let crossedIdle = false;
  for (let index = 0; index < 160; index += 1) {
    const previousPhase = state.phase;
    state = advance(state, { deltaSeconds: 1 / 120 });
    const frame = sample(state, 28);
    if (previousPhase === 'entering' && state.phase === 'idle') {
      crossedIdle = true;
      assert.ok(Math.hypot(...frame.position.map((value, axis) => value - previousFrame.position[axis])) < 0.001);
      assert.ok(Math.abs(frame.scale - previousFrame.scale) < 0.00001);
    }
    previousFrame = frame;
  }
  assert.ok(crossedIdle);
  const first = sample(state);
  for (let index = 0; index < 120; index += 1) state = advance(state);
  const second = sample(state);
  assert.notDeepEqual(first.position, second.position, 'Idle gently floats instead of freezing after arrival');
  assert.ok(Math.abs(second.position[1] - scene.nodes[0].position[1]) <= scene.nodes[0].idle.floatAmplitude);
  assert.ok(Math.abs(second.rotation[2] - scene.nodes[0].rotation[2]) <= scene.nodes[0].idle.rockAmplitude);
});

test('rapid flavor and package selections fade old assets once and reveal only the latest settled target', () => {
  let state = settle();
  state = advance(state, { key: 'can-330:berry', ready: false, viewerIdle: false, deltaSeconds: 0.04 });
  assert.equal(state.phase, 'fading');
  assert.equal(state.renderedKey, input.key);
  const opacity = state.opacity;
  state = advance(state, { key: 'can-500:peach', ready: false, viewerIdle: false, deltaSeconds: 0.04 });
  assert.ok(state.opacity < opacity, 'Retargeting cannot restart the fade or brighten the outgoing composition');
  assert.equal(state.elapsed, 0.08);
  state = advance(state, { key: 'can-180:citrus', ready: false, viewerIdle: false, deltaSeconds: 0.15 });
  assert.equal(state.phase, 'waiting');
  assert.equal(state.renderedKey, 'can-180:citrus');
  assert.equal(state.opacity, 0);
  state = advance(state, { key: 'can-180:citrus', viewerIdle: false });
  assert.equal(state.phase, 'waiting');
  state = advance(state, { key: 'can-180:citrus' });
  assert.equal(state.phase, 'entering');
  assert.equal(state.renderedKey, 'can-180:citrus');
});

test('interrupting an entrance fades at its current position instead of snapping to the destination', () => {
  let state = motion.createAccentMotion(input.key);
  for (let index = 0; index < 8; index += 1) state = advance(state);
  const before = sample(state);
  state = advance(state, { key: 'can-250:berry', ready: false, viewerIdle: false, deltaSeconds: 0 });
  const after = sample(state);
  assert.equal(state.phase, 'fading');
  assert.deepEqual(after.position, before.position);
  assert.deepEqual(after.rotation, before.rotation);
  assert.equal(after.scale, before.scale);
  assert.equal(after.opacity, before.opacity);
  state = advance(state, { key: 'can-250:berry', ready: false, viewerIdle: false });
  assert.ok(sample(state).opacity < before.opacity);
});

test('reduced motion shows the settled composition without burst, drift or hidden asset flashes', () => {
  let state = motion.createAccentMotion(input.key);
  state = advance(state, { reducedMotion: true, viewerIdle: false });
  assert.equal(sample(state).visible, false);
  state = advance(state, { reducedMotion: true });
  assert.equal(state.phase, 'idle');
  const frame = sample(state);
  assert.deepEqual(frame.position, scene.nodes[0].position);
  assert.deepEqual(frame.rotation, scene.nodes[0].rotation);
  assert.equal(frame.scale, scene.nodes[0].scale);
  assert.equal(frame.opacity, 1);
  state = advance(state, { reducedMotion: true, deltaSeconds: 0.25 });
  assert.deepEqual(sample(state), frame);
  assert.equal(motion.sampleAccentNode({ ...scene.nodes[0], enabled: false }, state, 0, scene.motion).visible, false);
  state = advance(state, { reducedMotion: true, key: 'can-500:berry', ready: false });
  assert.equal(sample(state).visible, false);
});
