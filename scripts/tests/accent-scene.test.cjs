/* Run with: node scripts/tests/accent-scene.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Executes the actual TypeScript contracts without a build. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

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
const layout = loadSource('lib/viewer/accent-layout.ts');
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
  assert.deepEqual(counts, { splash: 1, fruit: 2, leaf: 6, ice: 2, droplet: 12 });
  const fruit = scene.nodes.filter(node => node.kind === 'fruit');
  assert.ok(fruit.every(node => Math.abs(node.position[0]) > 0.3 && node.position[2] < 0));
  assert.ok(scene.nodes.some(node => node.depth === 'near' && node.blur >= 3));
  assert.ok(scene.nodes.some(node => node.depth === 'far' && node.blur > 0));
  assert.ok(scene.nodes.every(node => node.position[2] < 0), 'Even the blurred legacy near leaf is behind the product');
  const drops = scene.nodes.filter(node => node.kind === 'droplet');
  assert.equal(Math.max(...drops.map(node => node.scale)), 0.12);
  assert.equal(Math.min(...drops.map(node => node.scale)), 0.062);
  assert.ok(new Set(drops.map(node => node.scale)).size > 10, 'Larger droplets retain natural size variation');
  assert.deepEqual(drops.map(node => node.id), ['droplet-01','droplet-02','droplet-03','droplet-05','droplet-07','droplet-09','droplet-11','droplet-13','droplet-14','droplet-16','droplet-17','droplet-20']);
  assert.ok(drops.every(node => node.idle.floatAmplitude <= 0.006 && node.idle.rockAmplitude <= 0.018));
  assert.ok(drops.every(node => node.idle.periodSeconds >= 9 && node.idle.periodSeconds <= 12));
  const phaseValues = new Set(config.normalizeAccentScene().nodes.map(node => node.idle.phase));
  assert.ok(phaseValues.size >= 20, 'Sanitizing phases must not collapse varied droplet phases to one maximum');

  const assigned = { ...fruit[0], assetUrl: '/models/props/fruit.glb', variants: { lime: { sprite: 'lime', assetUrl: '/models/props/lime.glb' } } };
  const resolved = config.resolveAccentNodeForFlavor(assigned, 'lime');
  assert.equal(resolved.assetUrl, '/models/props/lime.glb');
  assert.equal(resolved.sprite, 'lime');
  assert.equal(assigned.assetUrl, '/models/props/fruit.glb');
  assert.equal(config.resolveAccentNodes(scene, 'berry').find(node => node.kind === 'fruit').sprite, 'berry');
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

test('composition keeps the larger right fruit and a small leaf peeking from directly behind the left edge', () => {
  assert.equal(scene.nodes.length, 23);
  const leftFruit = scene.nodes.find(node => node.id === 'fruit-upper-left');
  assert.equal(leftFruit.position[1], 0.45, 'Left fruit is raised by 0.2 relative product heights without moving the right fruit');
  const rightFruit = scene.nodes.find(node => node.id === 'fruit-lower-right');
  assert.equal(rightFruit.scale, 0.32 * 1.1, 'Right fruit is exactly 10% larger than the previous 0.32 composition');
  const peek = scene.nodes.find(node => node.id === 'leaf-left-peek');
  assert.deepEqual(peek.position, [-0.225, -0.02, -0.24]);
  assert.equal(peek.scale, 0.11);
  assert.equal(peek.depth, 'far');
  assert.equal(peek.blur, 0.4);
  assert.ok(Math.abs(peek.position[0]) >= 0.21 && Math.abs(peek.position[0]) <= 0.24,
    'Leaf center sits at the can edge so a small part remains visible rather than being entirely occluded');
  assert.ok(Math.abs(peek.position[0]) < Math.abs(scene.nodes.find(node => node.id === 'leaf-left-middle').position[0]),
    'Peek leaf stays closer to the can than the existing outside middle leaf');
  for (const flavor of ['citrus', 'berry', 'peach', 'lime']) {
    assert.equal(config.resolveAccentNodeForFlavor(peek, flavor).sprite,
      flavor === 'lime' || flavor === 'berry' ? 'mint' : 'citrus-leaf');
  }
  const outer = scene.nodes.find(node => node.id === 'leaf-left-near');
  assert.equal(outer.blur, 5.5, 'Outer leaf retains a recognizable but clearly defocused silhouette');
  assert.ok(outer.scale > 0 && outer.position[2] < 0);
});

test('rear splash is a replaceable independent image with broad scale and neutral photographic colors', () => {
  const splash = scene.nodes.find(node => node.kind === 'splash');
  assert.equal(splash.assetUrl, '/assets/scene/water-splash-user.webp');
  assert.equal(splash.depth, 'far');
  assert.ok(splash.position[2] < Math.min(...scene.nodes.filter(node => node.kind !== 'splash').map(node => node.position[2])));
  assert.ok(splash.scale >= 1 && splash.scale <= 1.6);
  assert.equal(splash.color, '#ffffff');
  assert.equal(splash.tint, undefined);
  assert.equal(splash.opacity, 1);
  assert.equal(splash.blendMode, 'hard-light');
  for (const invalid of ['overlay', 'screen', null]) {
    assert.equal(config.normalizeAccentScene({ nodes: [{ ...splash, blendMode: invalid }] }).nodes[0].blendMode, 'normal');
  }
  assert.equal(splash.variants, undefined);
  assert.deepEqual(splash.imageBounds, [53 / 768, 86 / 768, 714 / 768, 680 / 768]);
  const extent = layout.accentImageExtent(splash);
  assert.ok(Math.abs(extent[0] - 331 / 768) < 1e-12);
  assert.ok(Math.abs(extent[1] - 298 / 768) < 1e-12);
  assert.equal(extent[2], 0);
  assert.ok(splash.idle.floatAmplitude < 0.006 && splash.idle.rockAmplitude < 0.018);
  assert.equal(config.normalizeAccentScene().nodes.find(node => node.kind === 'splash').scale, splash.scale,
    'Large splash is not clamped to the small object scale limit');
  assert.equal(config.normalizeAccentScene({ nodes: [{ ...splash, scale: 10 }] }).nodes[0].scale, 1.6);
  for (const flavor of ['citrus', 'berry', 'peach', 'lime']) assert.deepEqual(config.resolveAccentNodeForFlavor(splash, flavor), splash);
  for (const invalid of [null, [0, 0, 1], [0, 0, 2, 1], [0.5, 0, 0.4, 1], [0, Number.NaN, 1, 1]]) {
    assert.equal(config.normalizeAccentScene({ nodes: [{ ...splash, imageBounds: invalid }] }).nodes[0].imageBounds, undefined);
  }
  for (const [opacity, expected] of [[Number.NaN, 1], [Infinity, 1], [-0.5, 0], [1.5, 1], [0.6, 0.6]]) {
    assert.equal(config.normalizeAccentScene({ nodes: [{ ...splash, opacity }] }).nodes[0].opacity, expected);
  }
});

test('demo restores neutral refractive droplets while retaining the supplied white ice', () => {
  const normalized = config.normalizeAccentScene();
  const drops = normalized.nodes.filter(node => node.kind === 'droplet');
  assert.equal(drops.length, 12);
  assert.ok(drops.every(node => node.assetUrl === undefined), 'The requested preview uses the previous live-refraction water preset');
  assert.ok(drops.every(node => node.scale >= 0.062 && node.scale <= 0.12), 'Image-specific enlargement must not inflate native water planes');
  const glass = normalized.nodes.filter(node => node.kind === 'droplet' || node.kind === 'ice');
  assert.ok(glass.every(node => node.color === '#ffffff' && node.tint === undefined && node.variants === undefined));
  assert.ok(normalized.nodes.filter(node => node.kind === 'ice').every(node => node.assetUrl === '/assets/scene/ice-clear.webp'));
  for (const flavor of ['citrus', 'berry', 'peach', 'lime']) {
    assert.deepEqual(config.resolveAccentNodes(normalized, flavor).filter(node => node.kind === 'droplet' || node.kind === 'ice'), glass,
      'Neutral water settings stay identical across flavors while the live backdrop supplies their color');
  }
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
  assert.equal(sample(state, scene.nodes.length - 1).visible, false, 'Later droplets are staggered rather than appearing in a rigid ring');
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
  let previousFrame = sample(state, scene.nodes.length - 1);
  let crossedIdle = false;
  for (let index = 0; index < 160; index += 1) {
    const previousPhase = state.phase;
    state = advance(state, { deltaSeconds: 1 / 120 });
    const frame = sample(state, scene.nodes.length - 1);
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

test('adaptive spread broadens squat packages using width while preserving requested on-screen droplet size', () => {
  const slim = { height: 1, width: 0.4, productRadius: 0.575, maximumProductScale: 1.2 };
  const squat = { height: 1, width: 0.85, productRadius: 0.78, maximumProductScale: 1.2 };
  assert.ok(layout.accentLayoutMetrics(squat).horizontalSpan > layout.accentLayoutMetrics(slim).horizontalSpan * 1.4);
  const state = advance(motion.createAccentMotion(input.key), { reducedMotion: true });
  const leafIndex = scene.nodes.findIndex(node => node.id === 'leaf-upper-right');
  const node = scene.nodes[leafIndex];
  const camera = { distance: 3, fov: 30, aspect: 2, center: [0, 0, 0] };
  const original = sample(state, leafIndex);
  const narrow = layout.adaptAccentFrame(original, node, slim, camera, Math.SQRT1_2, [0.5, 0.5, 0]);
  const broad = layout.adaptAccentFrame(original, node, squat, camera, Math.SQRT1_2, [0.5, 0.5, 0]);
  const projectedX = frame => frame.position[0] / (camera.distance - frame.position[2]) * camera.distance;
  assert.ok(projectedX(broad) > projectedX(narrow) * 1.4, 'Extra depth does not cancel the broader visible composition');
  const dropletIndex = scene.nodes.findIndex(node => node.id === 'droplet-02');
  const droplet = scene.nodes[dropletIndex];
  const displayed = layout.adaptAccentFrame(sample(state, dropletIndex), droplet, slim, camera, Math.SQRT1_2 * 1.7, [0.85, 0.85, 0]);
  const apparentScale = displayed.scale * camera.distance / (camera.distance - displayed.position[2]);
  assert.ok(Math.abs(apparentScale - 0.12) < 1e-12, 'Depth compensation retains the largest readable droplet size on screen');
});

test('burst and idle geometry stay outside the swept product sphere and inside desktop/mobile viewer bounds', () => {
  const cases = [
    { height: 1, width: 0.4, productRadius: 0.575, maximumProductScale: 1.2 },
    { height: 1, width: 0.85, productRadius: 0.78, maximumProductScale: 1.2 },
    { height: 1, width: 1.1, productRadius: 0.93, maximumProductScale: 1.2 },
  ];
  let checked = 0;
  for (const envelope of cases) for (const aspect of [0.55, 1, 1.8]) {
    let state = motion.createAccentMotion(input.key);
    const viewport = { distance: 2.4, fov: 30, aspect, center: [0.04, -0.03, 0] };
    const tangent = Math.tan(viewport.fov * Math.PI / 360);
    const sweptRadius = layout.accentLayoutMetrics(envelope).sweptRadius;
    for (let tick = 0; tick < 200; tick += 1) {
      state = advance(state);
      for (const [index, node] of scene.nodes.entries()) {
        const size = node.kind === 'droplet' && !node.assetUrl ? 1.7 : 1;
        const localExtent = layout.accentImageExtent(node, size);
        const radius = Math.SQRT1_2 * size;
        const adapted = layout.adaptAccentFrame(sample(state, index), node, envelope, viewport, radius, localExtent);
        assert.ok(adapted.position[2] + radius * adapted.scale < -sweptRadius,
          `${node.id} intersects a possible rotated/overshooting product at tick ${tick}`);
        const rotation = new THREE.Euler(...adapted.rotation, 'XYZ');
        for (const x of [-localExtent[0], localExtent[0]]) for (const y of [-localExtent[1], localExtent[1]]) {
          const corner = new THREE.Vector3(x, y, 0).applyEuler(rotation).multiplyScalar(adapted.scale).add(new THREE.Vector3(...adapted.position));
          const depth = viewport.distance - corner.z;
          assert.ok(Math.abs(corner.x - viewport.center[0]) <= depth * tangent * aspect + 1e-10,
            `${node.id} leaks outside the viewer horizontally`);
          assert.ok(Math.abs(corner.y - viewport.center[1]) <= depth * tangent + 1e-10,
            `${node.id} leaks outside the viewer vertically`);
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, cases.length * 3 * 200 * scene.nodes.length);
  const state = advance(motion.createAccentMotion(input.key), { reducedMotion: true });
  const node = scene.nodes[0];
  const adapted = layout.adaptAccentFrame(sample(state), node, cases[1], { distance: 2.4, fov: 30, aspect: 1, center: [0, 0, 0] }, Math.sqrt(3) / 2, [0.5, 0.5, 0.5]);
  assert.ok(adapted.position[2] + Math.sqrt(3) / 2 * adapted.scale < -layout.accentLayoutMetrics(cases[1]).sweptRadius,
    'Approved normalized GLBs receive the same conservative rotation-safe clearance');
});
