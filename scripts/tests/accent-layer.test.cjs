/* Run with: node scripts/tests/accent-layer.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Tests actual layer source with deterministic async asset loaders and real Three objects. */
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
  const { outputText } = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
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

const { DEFAULT_PRODUCT_ACCENT_SCENE } = loadSource('lib/viewer/accent-config.ts');
const { createAccentLayer } = loadSource('lib/viewer/accent-layer.ts');
const baseNode = DEFAULT_PRODUCT_ACCENT_SCENE.nodes[0];
const node = (id, overrides = {}) => ({ ...baseNode, id, variants: undefined, ...overrides });
const sceneConfig = nodes => ({ ...DEFAULT_PRODUCT_ACCENT_SCENE, nodes });
const frame = overrides => ({
  deltaSeconds: 1 / 60, ready: true, viewerIdle: true, reducedMotion: false,
  paused: false, height: 2, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 10), ...overrides,
});
const flush = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };
function fakeTexture() {
  return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
}
function deferredRequest(url) {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { url, promise, resolve, reject };
}
async function harness(run) {
  const textureRequests = [], gltfRequests = [];
  const loadTexture = THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = url => {
    const request = deferredRequest(url); textureRequests.push(request); return request.promise;
  };
  const scene = new THREE.Scene();
  let invalidations = 0;
  const layer = createAccentLayer(scene, {
    loadAsync(url) { const request = deferredRequest(url); gltfRequests.push(request); return request.promise; },
  }, () => { invalidations += 1; });
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  camera.position.z = 4;
  const update = overrides => layer.update(frame({ camera, ...overrides }));
  const settle = async overrides => {
    for (let index = 0; index < 120; index += 1) update(overrides);
    await flush();
    return update(overrides);
  };
  try {
    await run({ layer, scene, root: scene.children[0], textureRequests, gltfRequests, update, settle, invalidations: () => invalidations });
  } finally {
    layer.dispose();
    THREE.TextureLoader.prototype.loadAsync = loadTexture;
  }
}
function modelWithResources() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const texture = fakeTexture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const disposed = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => { disposed.geometry += 1; });
  material.addEventListener('dispose', () => { disposed.material += 1; });
  texture.addEventListener('dispose', () => { disposed.texture += 1; });
  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.PointLight());
  return { scene, disposed };
}

test('layer waits for product settle and every assigned sprite/GLB asset before revealing any accent', async () => harness(async ({ layer, root, textureRequests, gltfRequests, update, settle }) => {
  layer.configure(sceneConfig([
    node('fruit', { assetUrl: '/demo/fruit.png' }),
    node('custom-ice', { kind: 'ice', assetUrl: '/demo/ice.glb' }),
  ]), 'can-330:lime', 'lime');
  assert.equal(update().phase, 'waiting');
  assert.equal(textureRequests.length, 1);
  assert.equal(gltfRequests.length, 1);
  textureRequests[0].resolve(fakeTexture());
  await flush();
  assert.equal(update({ deltaSeconds: 0.25 }).phase, 'waiting');
  assert.ok(root.children.every(group => !group.visible), 'One ready sprite cannot reveal while the GLB is pending');
  const model = modelWithResources();
  gltfRequests[0].resolve(model);
  await flush();
  assert.equal(update({ viewerIdle: false }).phase, 'waiting');
  assert.ok(root.children.every(group => !group.visible), 'The product bounce controls the actual reveal gate');
  assert.equal(update().phase, 'entering');
  assert.equal((await settle()).phase, 'idle');
  assert.ok(root.children.every(group => group.visible));
  assert.equal(model.scene.children.some(child => child instanceof THREE.Light), false, 'Assigned objects cannot import competing lights');
}));

test('outgoing flavor keeps its atlas crop through fading and a new flavor reuses the decoded atlas', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  layer.configure(sceneConfig([baseNode]), 'can-330:citrus', 'citrus');
  update();
  assert.equal(textureRequests.length, 1);
  const atlas = fakeTexture();
  textureRequests[0].resolve(atlas);
  await flush();
  await settle();
  const outgoing = root.children[0];
  const material = outgoing.children[0].material;
  assert.equal(material.map.offset.x, 0);
  layer.configure(sceneConfig([baseNode]), 'can-330:lime', 'lime');
  const result = update({ viewerIdle: false, deltaSeconds: 0.04 });
  assert.equal(result.phase, 'fading');
  assert.equal(root.children[0], outgoing);
  assert.equal(material.map.offset.x, 0, 'Old fruit remains an orange until invisible');
  assert.ok(material.opacity > 0 && material.opacity < 1);
  update({ viewerIdle: false, deltaSeconds: 0.2 });
  await flush();
  assert.notEqual(root.children[0], outgoing);
  assert.equal(root.children[0].visible, false);
  assert.equal(textureRequests.length, 1, 'Flavor variants share the atlas download');
  await settle();
  assert.equal(root.children[0].children[0].material.map.offset.x, 1 / 3);
  assert.equal(root.children[0].visible, true);
}));

test('the complete demo waits for both shared atlases, reuses them and releases every decoded texture', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  layer.configure(DEFAULT_PRODUCT_ACCENT_SCENE, 'can-330:lime', 'lime');
  assert.equal(update().count, 29);
  assert.equal(textureRequests.length, 2, 'Fruit/leaves and ice/drops each share one texture download');
  const atlases = textureRequests.map(() => fakeTexture());
  const disposals = [0, 0];
  atlases.forEach((atlas, index) => atlas.addEventListener('dispose', () => { disposals[index] += 1; }));
  textureRequests[0].resolve(atlases[0]); await flush();
  assert.equal(update({ reducedMotion: true }).phase, 'waiting');
  assert.ok(root.children.every(group => !group.visible), 'No partial fruit-only scene before the glass atlas is ready');
  textureRequests[1].resolve(atlases[1]); await flush();
  assert.equal(update({ reducedMotion: true }).phase, 'idle');
  const ice = root.children.find(group => group.name === 'ice-lower-left').children[0];
  const drop = root.children.find(group => group.name === 'droplet-01').children[0];
  assert.equal(ice.material.map.repeat.x, 0.5);
  assert.equal(ice.material.map.repeat.y, 1);
  assert.equal(ice.material.map.offset.x, 0);
  assert.equal(drop.material.map.offset.x, 0.5);
  assert.ok(ice.material.transparent && drop.material.transparent);
  layer.configure(DEFAULT_PRODUCT_ACCENT_SCENE, 'can-500:berry', 'berry');
  update({ reducedMotion: true }); await flush(); await settle();
  assert.equal(textureRequests.length, 2);
  layer.dispose();
  assert.deepEqual(disposals, [1, 1]);
  layer.dispose();
  assert.deepEqual(disposals, [1, 1], 'Repeated lifecycle disposal does not release cached textures twice');
}));

test('changing the explicit flavor prop also updates fruit when appearance IDs are omitted or reused', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  const configured = sceneConfig([baseNode]);
  layer.configure(configured, 'can-330:', 'citrus');
  update(); textureRequests[0].resolve(fakeTexture()); await flush(); await settle();
  const outgoing = root.children[0];
  layer.configure(configured, 'can-330:', 'lime');
  update(); await flush(); await settle();
  assert.notEqual(root.children[0], outgoing, 'A standalone flavor edit invalidates the rendered asset variant');
  assert.equal(root.children[0].children[0].material.map.offset.x, 1 / 3);
}));

test('rapid retargets never build intermediate flavor assets or reveal an obsolete selection', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  const configured = sceneConfig([node('fruit', {
    assetUrl: '/demo/orange.png',
    variants: { berry: { assetUrl: '/demo/berry.png' }, peach: { assetUrl: '/demo/peach.png' }, lime: { assetUrl: '/demo/lime.png' } },
  })]);
  layer.configure(configured, 'can-330:citrus', 'citrus');
  update(); textureRequests[0].resolve(fakeTexture()); await flush(); await settle();
  const outgoing = root.children[0];
  for (const flavor of ['berry', 'peach', 'lime']) {
    layer.configure(configured, `can-180:${flavor}`, flavor);
    update({ ready: false, viewerIdle: false, deltaSeconds: 0.04 });
    assert.equal(root.children[0], outgoing);
  }
  assert.deepEqual(textureRequests.map(request => request.url), ['/demo/orange.png']);
  update({ ready: false, viewerIdle: false, deltaSeconds: 0.1 });
  assert.deepEqual(textureRequests.map(request => request.url), ['/demo/orange.png', '/demo/lime.png']);
  assert.equal(root.children[0].visible, false);
  textureRequests[1].resolve(fakeTexture()); await flush();
  assert.equal(update({ ready: false }).phase, 'waiting');
  await settle();
  assert.equal(root.children[0].visible, true);
}));

test('late GLBs and external images are disposed after scene replacement or viewer disposal', async () => harness(async ({ layer, root, gltfRequests, textureRequests, update }) => {
  layer.configure(sceneConfig([node('old-model', { assetUrl: '/demo/old.glb' })]), 'can-330:citrus', 'citrus');
  update();
  layer.configure(sceneConfig([node('new-model', { assetUrl: '/demo/new.glb' })]), 'can-330:citrus', 'citrus');
  update();
  const old = modelWithResources();
  gltfRequests[0].resolve(old); await flush();
  assert.deepEqual(old.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(root.children[0].name, 'new-model');
  assert.equal(root.children[0].children.length, 0, 'Stale load cannot attach to the replacement slot');
  const current = modelWithResources();
  gltfRequests[1].resolve(current); await flush();
  layer.configure(sceneConfig([node('late-image', { assetUrl: '/demo/late.png' })]), 'can-330:citrus', 'citrus');
  update();
  assert.deepEqual(current.disposed, { geometry: 1, material: 1, texture: 1 });
  const lateTexture = fakeTexture();
  let textureDisposals = 0;
  lateTexture.addEventListener('dispose', () => { textureDisposals += 1; });
  layer.dispose();
  textureRequests[0].resolve(lateTexture); await flush();
  assert.equal(textureDisposals, 1);
  assert.equal(root.parent, null);
  assert.equal(root.children.length, 0);
}));

test('scene enabled/node enabled/opacity controls apply to the real layer', async () => harness(async ({ layer, root, textureRequests, update }) => {
  const configured = { ...sceneConfig([
    node('enabled'), node('disabled', { enabled: false }),
  ]), opacity: 0.4 };
  layer.configure(configured, 'can-330:citrus', 'citrus');
  assert.equal(update().count, 1);
  textureRequests[0].resolve(fakeTexture()); await flush();
  const result = update({ reducedMotion: true });
  assert.equal(result.phase, 'idle');
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].children[0].material.opacity, 0.4);
  layer.configure({ ...configured, enabled: false }, 'can-330:citrus', 'citrus');
  assert.equal(root.visible, false);
  assert.equal(update().count, 0);
  assert.equal(root.children.length, 0);
}));

test('paused and reduced-motion viewers show the current ready composition without frozen outgoing flavor', async () => harness(async ({ layer, root, textureRequests, update }) => {
  const configured = sceneConfig([node('fruit')]);
  layer.configure(configured, 'can-330:citrus', 'citrus');
  update({ paused: true });
  textureRequests[0].resolve(fakeTexture()); await flush();
  assert.equal(update({ paused: true }).phase, 'idle');
  assert.equal(root.children[0].visible, true);
  const position = root.children[0].position.clone();
  update({ paused: true, deltaSeconds: 0.2 });
  assert.ok(root.children[0].position.equals(position), 'Pause retains a fully visible static composition');
  layer.configure(configured, 'can-500:lime', 'lime');
  update({ paused: true }); await flush();
  assert.equal(update({ paused: true }).phase, 'idle');
  assert.equal(root.children[0].visible, true, 'Paused selection must not retain old fruit stuck in a fade');
  const frame = root.children[0].position.clone();
  update({ reducedMotion: true, deltaSeconds: 0.2 });
  assert.ok(root.children[0].position.equals(frame));
}));
