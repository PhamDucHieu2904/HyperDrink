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
const baseNode = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(node => node.kind === 'fruit');
const node = (id, overrides = {}) => ({ ...baseNode, id, variants: undefined, ...overrides });
const sceneConfig = nodes => ({ ...DEFAULT_PRODUCT_ACCENT_SCENE, nodes });
const frame = overrides => ({
  deltaSeconds: 1 / 60, ready: true, viewerIdle: true, reducedMotion: false,
  paused: false, height: 2, width: 1.1, productRadius: 1.27, maximumProductScale: 1.2,
  camera: new THREE.PerspectiveCamera(30, 1, 0.01, 10), ...overrides,
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
async function harness(run, mount) {
  const textureRequests = [], gltfRequests = [];
  const loadTexture = THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = url => {
    const request = deferredRequest(url); textureRequests.push(request); return request.promise;
  };
  const scene = new THREE.Scene();
  let invalidations = 0;
  const layer = createAccentLayer(scene, {
    loadAsync(url) { const request = deferredRequest(url); gltfRequests.push(request); return request.promise; },
  }, () => { invalidations += 1; }, mount);
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

const { projectAccentImage } = loadSource('lib/viewer/blended-accent.ts');
test('CSS splash projection is invertible and matches real Three perspective at every image corner', () => {
  for (const [width, height] of [[390, 560], [800, 700]]) {
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 40);
    camera.position.set(0.1, -0.05, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const world = new THREE.Matrix4().compose(new THREE.Vector3(0.2, 0.1, -3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, -0.12)), new THREE.Vector3(3, 3, 3));
    const css = projectAccentImage(world, camera, width, height);
    assert.ok(Math.abs(css.determinant()) > 1e-10, 'Browsers discard singular matrix3d images');
    for (const x of [0, 384, 768]) for (const y of [0, 384, 768]) {
      const actual = new THREE.Vector3(x, y, 0).applyMatrix4(css);
      const projected = new THREE.Vector3(x / 768 - 0.5, 0.5 - y / 768, 0).applyMatrix4(world).project(camera);
      assert.ok(Math.abs(actual.x - (projected.x + 1) * width / 2) < 1e-9);
      assert.ok(Math.abs(actual.y - (1 - projected.y) * height / 2) < 1e-9);
      assert.equal(actual.z, 0);
    }
  }
});

test('Hard Light shares product readiness, fades continuously, resizes and disposes without a duplicate WebGL splash', async () => {
  const previousDocument = global.document, previousObserver = global.ResizeObserver;
  const element = () => ({ style: {}, dataset: {}, children: [], setAttribute() {},
    appendChild(child) { this.children.push(child); child.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(value => value !== this); },
  });
  let size = { left: 120, top: 80, width: 800, height: 700 }, observer;
  const hero = element(); hero.getBoundingClientRect = () => ({ left: 20, top: 10 });
  const mount = { closest: () => hero, getBoundingClientRect: () => size };
  global.document = { createElement: element };
  global.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the actual fake observer for resize/disposal assertions.
      observer = this;
    }
    observe() {} disconnect() { this.disconnected = true; }
  };
  try {
    await harness(async ({ layer, root, textureRequests, update, settle }) => {
      const splash = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(node => node.kind === 'splash');
      const configured = { ...sceneConfig([{ ...splash, opacity: 0.8 }]), opacity: 0.5 };
      layer.configure(configured, 'can-330:lime', 'lime');
      update(); textureRequests[0].resolve(fakeTexture()); await flush();
      const host = hero.children[0], image = host.children[0];
      assert.equal(image.style.mixBlendMode, 'hard-light');
      assert.equal(host.style.zIndex, 'auto', 'Wrapper must not isolate the image from the live flavor background');
      assert.equal(update().phase, 'waiting', 'Decoded Three texture alone cannot reveal a pending DOM image');
      image.onload();
      assert.equal(update({ viewerIdle: false }).phase, 'waiting');
      await settle();
      assert.equal(image.style.display, 'block');
      assert.equal(Number(image.style.opacity), 0.4);
      assert.equal(root.children[0].children[0].visible, false, 'Splash is composited only once');
      const oldTransform = image.style.transform;
      size = { left: 25, top: 110, width: 390, height: 560 }; observer.callback(); update();
      assert.equal(host.style.left, '5px'); assert.equal(host.style.top, '100px');
      assert.equal(host.style.width, '390px'); assert.notEqual(image.style.transform, oldTransform);
      layer.configure(configured, 'can-500:berry', 'berry');
      update({ viewerIdle: false, deltaSeconds: 0.04 });
      assert.ok(Number(image.style.opacity) > 0 && Number(image.style.opacity) < 0.4);
      update({ viewerIdle: false, deltaSeconds: 0.2 }); await flush();
      assert.equal(image.onload, null); assert.equal(host.children.length, 1);
      const replacement = host.children[0]; replacement.onerror();
      assert.equal(update({ reducedMotion: true }).phase, 'idle', 'Missing decoration cannot block the product');
      assert.equal(replacement.style.display, 'none', 'Failed image cannot expose a broken-image glyph');
      layer.configure({ ...configured, enabled: false }, 'can-500:berry', 'berry');
      assert.equal(host.children.length, 0);
      layer.dispose(); layer.dispose();
      assert.equal(hero.children.length, 0); assert.equal(observer.disconnected, true);
    }, mount);
  } finally { global.document = previousDocument; global.ResizeObserver = previousObserver; }
});
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

test('restored water uses the live sampler while white ice and rear splash retain their shared image resources', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  const backdrop = fakeTexture();
  let backdropDisposals = 0;
  backdrop.addEventListener('dispose', () => { backdropDisposals += 1; });
  layer.setBackdrop(backdrop);
  layer.configure(DEFAULT_PRODUCT_ACCENT_SCENE, 'can-330:lime', 'lime');
  assert.equal(update().count, 23);
  assert.equal(textureRequests.length, 3, 'Native droplets add no image downloads to the splash, fruit atlas and ice');
  const atlases = textureRequests.map(() => fakeTexture());
  const disposals = Array(3).fill(0);
  atlases.forEach((atlas, index) => atlas.addEventListener('dispose', () => { disposals[index] += 1; }));
  textureRequests[0].resolve(atlases[0]); await flush();
  assert.equal(update({ reducedMotion: true }).phase, 'waiting');
  assert.ok(root.children.every(group => !group.visible), 'No partial scene before all supplied glass and splash images are ready');
  textureRequests.slice(1).forEach((request, index) => request.resolve(atlases[index + 1])); await flush();
  assert.equal(update({ reducedMotion: true, resolution: [900, 1400] }).phase, 'idle');
  const ice = root.children.find(group => group.name === 'ice-lower-left').children[0];
  const drop = root.children.find(group => group.name === 'droplet-01').children[0];
  assert.ok(ice.material instanceof THREE.MeshBasicMaterial);
  assert.equal(ice.material.map.repeat.x, 1);
  assert.equal(ice.material.map.repeat.y, 1);
  assert.equal(ice.material.color.getHex(), 0xffffff, 'The supplied white reflections are not multiplied by the flavor color');
  assert.equal(ice.material.toneMapped, false, 'Can exposure cannot burn out the supplied ice artwork');
  let cropDisposals = 0;
  ice.material.map.addEventListener('dispose', () => { cropDisposals += 1; });
  assert.ok(drop.material instanceof THREE.ShaderMaterial);
  assert.equal(drop.geometry.parameters.width, 1.7, 'Native water retains the previous analytic footprint');
  const waterMeshes = root.children.filter(group => group.name.startsWith('droplet-')).map(group => group.children[0]);
  assert.ok(waterMeshes.every(mesh => mesh.material.name === 'colorless-water-droplet'));
  assert.ok(waterMeshes.every(mesh => mesh.material.uniforms.backdrop.value === backdrop));
  assert.ok(waterMeshes.every(mesh => mesh.material.uniforms.resolution.value.equals(new THREE.Vector2(900, 1400))));
  assert.equal(new Set(waterMeshes.map(mesh => mesh.material)).size, 12, 'Each drop retains independent fade and blur uniforms');
  assert.ok(ice.material.transparent && drop.material.transparent);
  const splash = root.children.find(group => group.name === 'water-splash-back').children[0];
  assert.ok(splash.material instanceof THREE.MeshBasicMaterial);
  assert.equal(splash.material.color.getHex(), 0xffffff);
  assert.equal(splash.material.toneMapped, false);
  assert.ok(splash.material.transparent && !splash.material.depthWrite);
  assert.equal(splash.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(splash.material.opacity, 1, 'Supplied splash keeps full alpha for its Hard Light composition');
  assert.equal(splash.renderOrder, -10, 'Rear splash blends before subsidiary fruit, leaves and glass');
  const leaf = root.children.find(group => group.name === 'leaf-left-middle').children[0];
  const leafUvs = leaf.geometry.getAttribute('uv');
  assert.ok(Math.min(...Array.from({ length: leafUvs.count }, (_, index) => leafUvs.getX(index))) > 0.1,
    'Leaf subject UVs exclude the orange peel fragment beside its atlas cell');
  assert.equal(leaf.material.map.repeat.x, 1 / 3);
  assert.equal(leaf.material.map.offset.x, 1 / 3, 'Subject cropping retains the original mint atlas cell');
  for (const group of root.children) {
    const mesh = group.children[0];
    mesh.geometry.computeBoundingSphere();
    assert.ok(group.position.z + mesh.geometry.boundingSphere.radius * group.scale.x < -1.27 * 1.2,
      `${group.name} enters the real viewer product's swept sphere`);
  }
  layer.configure(DEFAULT_PRODUCT_ACCENT_SCENE, 'can-500:berry', 'berry');
  update({ reducedMotion: true }); await flush(); await settle();
  assert.equal(textureRequests.length, 3, 'Flavor changes reuse ice and splash while water follows the shared live backdrop');
  assert.equal(cropDisposals, 1, 'The outgoing ice crop is released when its flavor scene is replaced');
  layer.dispose();
  assert.deepEqual(disposals, Array(3).fill(1));
  layer.dispose();
  assert.deepEqual(disposals, Array(3).fill(1), 'Repeated lifecycle disposal does not release cached textures twice');
  assert.equal(backdropDisposals, 0, 'Image accents do not own the optional viewer backdrop');
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

test('native droplets follow the shared backdrop, real buffer size and existing fade without extra downloads', async () => harness(async ({ layer, root, textureRequests, update, settle }) => {
  const waterNode = { ...DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(value => value.id === 'droplet-02'), assetUrl: undefined };
  const configured = sceneConfig([waterNode]);
  const backdrop = fakeTexture();
  let backdropDisposals = 0;
  backdrop.addEventListener('dispose', () => { backdropDisposals += 1; });
  layer.setBackdrop(backdrop);
  layer.configure(configured, 'can-330:lime', 'lime');
  update({ resolution: [900, 1400] }); await settle({ resolution: [900, 1400] });
  const material = root.children[0].children[0].material;
  assert.equal(textureRequests.length, 0, 'A water-only scene needs no atlas or custom image');
  assert.equal(material.uniforms.backdrop.value, backdrop);
  assert.deepEqual(material.uniforms.resolution.value.toArray(), [900, 1400]);
  assert.equal(material.uniforms.opacity.value, material.opacity);
  layer.configure(configured, 'can-330:berry', 'berry');
  update({ viewerIdle: false, deltaSeconds: 0.04, resolution: [600, 1000] });
  assert.ok(material.opacity > 0 && material.opacity < 1);
  assert.equal(material.uniforms.opacity.value, material.opacity, 'Water fades with the fruit before flavor replacement');
  layer.setBackdrop(null);
  update({ viewerIdle: false });
  assert.equal(material.uniforms.hasBackdrop.value, 0, 'A removed background switches safely to clear reflection fallback');
  layer.dispose();
  assert.equal(backdropDisposals, 0, 'The viewer, rather than individual droplets, owns the shared sampler');
}));

test('actual layer spreads a squat product more widely without shrinking the enlarged droplets in projection', async () => harness(async ({ layer, root, textureRequests, update }) => {
  layer.configure(DEFAULT_PRODUCT_ACCENT_SCENE, 'can-250-short:lime', 'lime');
  update(); textureRequests.forEach(request => request.resolve(fakeTexture())); await flush();
  const camera = new THREE.PerspectiveCamera(30, 2, 0.01, 10);
  camera.position.z = 4;
  update({ camera, reducedMotion: true, width: 0.8, productRadius: 1.16 });
  const leaf = root.children.find(group => group.name === 'leaf-upper-right');
  const narrowX = leaf.position.x / (4 - leaf.position.z) * 4;
  update({ camera, reducedMotion: true, width: 1.7, productRadius: 1.56 });
  const broadX = leaf.position.x / (4 - leaf.position.z) * 4;
  assert.ok(broadX > narrowX * 1.2, 'Width-aware staging reaches further around squat cans in the actual Three scene');
  const droplet = root.children.find(group => group.name === 'droplet-02');
  const projectedScale = droplet.scale.x * 4 / (4 - droplet.position.z);
  assert.ok(projectedScale >= 0.24 - 1e-10, 'The restored native drop retains its previous size after depth compensation');
}));

test('splash stays behind every accent throughout burst and idle while fitting broad/slim desktop/mobile frames', async () => harness(async ({ layer, root, textureRequests, update }) => {
  // Put a deep, larger admin-assigned object last so rear ordering cannot rely
  // on the default array order or simply on the saved splash Z coordinate.
  const extra = node('admin-rear-fruit', { position: [0.3, 0.1, -1.5], scale: 0.45 });
  layer.configure(sceneConfig([...DEFAULT_PRODUCT_ACCENT_SCENE.nodes, extra]), 'can-330:lime', 'lime');
  update(); textureRequests.forEach(request => request.resolve(fakeTexture())); await flush();
  for (const aspect of [0.55, 1, 1.8]) for (const width of [0.4, 0.85]) {
    const camera = new THREE.PerspectiveCamera(30, aspect, 0.01, 40);
    camera.position.z = 2.4;
    update({ viewerIdle: false, camera, height: 1, width, productRadius: 0.78, deltaSeconds: 0.25 });
    const tangent = Math.tan(camera.fov * Math.PI / 360);
    for (let tick = 0; tick < 100; tick += 1) {
      update({ camera, height: 1, width, productRadius: 0.78, deltaSeconds: 1 / 60 });
      const splash = root.children.find(group => group.name === 'water-splash-back');
      const frontEdge = splash.position.z + Math.SQRT1_2 * splash.scale.x;
      for (const group of root.children.filter(group => group !== splash)) {
        assert.ok(frontEdge < group.position.z - Math.SQRT1_2 * group.scale.x,
          `${aspect}/${width}/${tick}: Splash comes in front of ${group.name}`);
      }
      for (const x of [-331 / 768, 331 / 768]) for (const y of [-298 / 768, 298 / 768]) {
        const corner = new THREE.Vector3(x, y, 0).applyEuler(splash.rotation).multiplyScalar(splash.scale.x).add(splash.position);
        const distance = camera.position.z - corner.z;
        assert.ok(Math.abs(corner.x) <= distance * tangent * aspect + 1e-10, 'Splash cannot overlap adjacent UI outside the viewer');
        assert.ok(Math.abs(corner.y) <= distance * tangent + 1e-10);
      }
      if (tick === 99 && aspect === 0.55) {
        const apparentScale = splash.scale.x * camera.position.z / (camera.position.z - splash.position.z);
        assert.ok(apparentScale * (661 / 768) > 0.6, 'Visible water stays broad on mobile even when the supplied photo has different padding');
      }
    }
  }
}));

test('an empty configurable splash slot does not fall back to an unrelated fruit image', async () => harness(async ({ layer, root, textureRequests, update }) => {
  const splash = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(node => node.kind === 'splash');
  layer.configure(sceneConfig([{ ...splash, assetUrl: undefined }]), 'can-330:lime', 'lime');
  assert.equal(update({ reducedMotion: true }).phase, 'idle');
  assert.equal(textureRequests.length, 0);
  assert.equal(root.children[0].children.length, 0);
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

test('scene enabled/node enabled/opacity controls apply to the real layer', async () => harness(async ({ layer, root, textureRequests, gltfRequests, update, settle }) => {
  const configured = { ...sceneConfig([
    node('enabled', { opacity: 0.25 }), node('disabled', { enabled: false }),
    node('native-water', { kind: 'droplet', opacity: 0.5 }),
    node('model', { assetUrl: '/demo/opacity.glb', opacity: 0.5 }),
  ]), opacity: 0.4 };
  layer.configure(configured, 'can-330:citrus', 'citrus');
  assert.equal(update().count, 3);
  textureRequests[0].resolve(fakeTexture()); await flush();
  const model = modelWithResources();
  const importedMaterial = model.scene.children[0].material;
  importedMaterial.opacity = 0.6;
  gltfRequests[0].resolve(model); await flush();
  const result = update({ reducedMotion: true });
  assert.equal(result.phase, 'idle');
  assert.equal(root.children.length, 3);
  const imageMaterial = root.children[0].children[0].material;
  const nativeMaterial = root.children[1].children[0].material;
  assert.equal(imageMaterial.opacity, 0.4 * 0.25, 'Image alpha receives the scene and node opacity multipliers');
  assert.equal(nativeMaterial.opacity, 0.4 * 0.5);
  assert.equal(nativeMaterial.uniforms.opacity.value, nativeMaterial.opacity);
  assert.equal(importedMaterial.opacity, 0.4 * 0.5 * 0.6, 'Imported GLB base opacity is retained rather than replaced');
  await settle();
  layer.configure(configured, 'can-330:berry', 'berry');
  update({ viewerIdle: false, deltaSeconds: 0.04 });
  assert.ok(imageMaterial.opacity > 0 && imageMaterial.opacity < 0.4 * 0.25);
  assert.ok(Math.abs(nativeMaterial.opacity / imageMaterial.opacity - 2) < 1e-12);
  assert.ok(Math.abs(importedMaterial.opacity / imageMaterial.opacity - 1.2) < 1e-12,
    'Flavor fade multiplies all independent opacities without restarting or discarding GLB alpha');
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
