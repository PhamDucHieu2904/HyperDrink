/* eslint-disable @typescript-eslint/no-require-imports -- Local Node/TypeScript verification harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../register-admin-typescript.cjs');
const THREE = require('three');
const camera = require('../../lib/mockup/camera.ts');
const focal = require('../../lib/mockup/focal-length.ts');
const { DEFAULT_VIEWER_PRESENTATION } = require('../../lib/viewer-config.ts');
const capture = require('../../lib/mockup/capture.ts');
const selection = require('../../lib/mockup/selection.ts');
const neutral = require('../../lib/mockup/appearance.ts');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let turn = 0; turn < 24; turn++) await Promise.resolve(); };

/** Real Three scene/camera objects; only the browser/GPU and asynchronous I/O are faked. */
function runtimeHarness({ floatingPoint = true, reducedMotion = false } = {}) {
  const globals = ['window', 'document', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'ImageData'];
  const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const statuses = []; const parses = new Map(); const models = new Map(); const pools = []; const rafs = new Map();
  const draws = []; const backdropPainters = [], backdropBindings = [];
  let nextRaf = 0; let interactions = 0; let observer; let renderReadback; let outputMaterial;
  class Element extends EventTarget {
    constructor() { super(); this.style = {}; this.dataset = {}; this.removed = false; this.captured = new Set(); }
    setAttribute() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 700, height: 700 }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    remove() { this.removed = true; }
  }
  const host = new Element(); host.clientWidth = 700; host.clientHeight = 700;
  host.appendChild = element => { if (element.dataset.productHitRegion) host.hitRegion = element; else host.canvas = element; };
  const document = new EventTarget(); document.hidden = false;
  document.createElement = tag => tag === 'div' ? new Element() : ({ width: 0, height: 0, getContext: () => ({ putImageData() {} }), toBlob: callback => callback(new Blob(['PNG'], { type: 'image/png' })) });
  const motionQuery = new EventTarget(); motionQuery.matches = reducedMotion;
  const window = { devicePixelRatio: 2, matchMedia: query => query.includes('reduced-motion') ? motionQuery : { matches: false } };
  class Renderer {
    constructor() {
      this.domElement = new Element(); this.capabilities = { maxSamples: 4, maxTextureSize: 4096 };
      this.extensions = { has: () => floatingPoint }; this.info = { memory: { geometries: 1, textures: 1 } };
      this.ratio = 1; this.target = null; this.viewport = new THREE.Vector4(0, 0, 700, 700); this.scissor = this.viewport.clone();
      this.clearColor = new THREE.Color(); this.clearAlpha = 0; this.scissorTest = false;
      Renderer.instance = this;
    }
    setClearColor(color, alpha) { this.clearColor.set(color); this.clearAlpha = alpha; }
    getClearColor(destination) { return destination.copy(this.clearColor); }
    getClearAlpha() { return this.clearAlpha; }
    setPixelRatio(ratio) { this.ratio = ratio; }
    setSize(width, height) { this.width = width; this.height = height; }
    getDrawingBufferSize(destination) { return destination.set(this.width * this.ratio, this.height * this.ratio); }
    setRenderTarget(target) { this.target = target; }
    getRenderTarget() { return this.target; }
    getViewport(destination) { return destination.copy(this.viewport); }
    setViewport(viewport) { this.viewport.copy(viewport); }
    getScissor(destination) { return destination.copy(this.scissor); }
    setScissor(scissor) { this.scissor.copy(scissor); }
    getScissorTest() { return this.scissorTest; }
    setScissorTest(value) { this.scissorTest = value; }
    getContext() { return { MAX_RENDERBUFFER_SIZE: 1, getParameter: () => 4096 }; }
    clear() {}
    render(scene, camera) { draws.push({ scene, camera: camera.clone(), cameraId: camera.id, target: this.target }); }
    compileAsync() { return Promise.resolve(); }
    compile() { return new Set(); }
    initTexture() {}
    readRenderTargetPixelsAsync(target, x, y, width, height, pixels) {
      pixels.fill(128); renderReadback = deferred(); return renderReadback.promise;
    }
    dispose() { this.disposed = true; }
  }
  class Controls extends THREE.EventDispatcher {
    constructor(camera) { super(); this.camera = camera; this.target = new THREE.Vector3(); this.enabled = true; Controls.instance = this; }
    update() { this.dispatchEvent({ type: 'change' }); }
    dispose() { this.disposed = true; }
  }
  class Decoder {
    setDecoderPath() { return this; } setTranscoderPath() { return this; } setWorkerLimit() { return this; }
    detectSupport() { return this; } dispose() {}
  }
  class EnvironmentLoader { loadAsync() { return Promise.resolve(new THREE.DataTexture()); } }
  class Loader {
    setDRACOLoader() { return this; } setKTX2Loader() { return this; } setMeshoptDecoder() { return this; }
    parseAsync(buffer) { const key = new TextDecoder().decode(buffer); const result = deferred(); parses.set(key, result); return result.promise; }
  }
  class PMREM { fromEquirectangular() { return new THREE.WebGLRenderTarget(4, 4); } dispose() {} }
  const makePool = (content, asset) => {
    let revision = 0; let disposed = false; const entries = new Map();
    const pool = {
      content, asset, disposed: false, window: [],
      edits: [],
      setLiveOverrides(value) { this.edits.push(value); content.userData.materialOverrides = value; },
      materialValues() { return { label: { roughness: .15, metalness: 0, textureOffsetX: 0 } }; },
      setWindow(values) { this.window = values; },
      has(value) { return entries.get(value?.id ?? 'blank')?.ready ?? false; },
      async apply(value) {
        const thisRevision = ++revision; const key = value?.id ?? 'blank';
        if (!entries.has(key)) entries.set(key, { ...deferred(), ready: false });
        const entry = entries.get(key);
        await entry.promise;
        if (!disposed && revision === thisRevision) content.userData.appearance = key;
      },
      finish(key) { const entry = entries.get(key); if (entry) { entry.ready = true; entry.resolve(); } },
      dispose() { disposed = true; revision++; this.disposed = true; },
    };
    pools.push(pool); return pool;
  };
  const setGlobal = (key, value) => Object.defineProperty(global, key, { value, writable: true, configurable: true });
  setGlobal('window', window); setGlobal('document', document);
  setGlobal('fetch', async url => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer }));
  setGlobal('requestAnimationFrame', callback => { const id = ++nextRaf; rafs.set(id, callback); return id; });
  setGlobal('cancelAnimationFrame', id => rafs.delete(id));
  setGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  setGlobal('IntersectionObserver', class { constructor(callback) { observer = callback; } observe() {} disconnect() {} });
  setGlobal('ImageData', class { constructor(data) { this.data = data; } });
  const replacements = {
    three: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM },
    'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader: Loader },
    'three/examples/jsm/loaders/EXRLoader.js': { EXRLoader: EnvironmentLoader },
    'three/examples/jsm/loaders/HDRLoader.js': { HDRLoader: EnvironmentLoader },
    'three/examples/jsm/loaders/DRACOLoader.js': { DRACOLoader: Decoder },
    'three/examples/jsm/loaders/KTX2Loader.js': { KTX2Loader: Decoder },
    'three/examples/jsm/libs/meshopt_decoder.module.js': { MeshoptDecoder: {} },
    'three/examples/jsm/controls/OrbitControls.js': { OrbitControls: Controls },
    'three/examples/jsm/postprocessing/Pass.js': { FullScreenQuad: class { constructor(material) { outputMaterial = material; } render() {} dispose() {} } },
    'three/examples/jsm/shaders/OutputShader.js': require('three/examples/jsm/shaders/OutputShader.js'),
    '../viewer/pooled-appearance': { createPooledAppearanceHandle: makePool },
    '../viewer/backdrop-texture': { createBackdropTexture(state, config, mount) {
      const texture = new THREE.Texture({ width: 512, height: 512 });
      const painter = { texture, state, config, mount, disposed: false,
        update() { texture.needsUpdate = true; }, dispose() { this.disposed = true; texture.dispose(); } };
      backdropPainters.push(painter); return painter;
    } },
    '../viewer/aloe-bottle-materials': { setAloeBottleBackdrop(root, texture) { backdropBindings.push({ root, texture }); } },
    '../viewer/resource-prefetch': { createResourcePrefetcher: () => ({ acquireUrl: url => ({ url, release() {} }), setEnabled() {}, configure() {}, dispose() {} }) },
    '../public-url': { publicUrl: url => url },
  };
  const filename = path.resolve(__dirname, '../../lib/mockup/runtime.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(request => replacements[request] ?? require(path.resolve(path.dirname(filename), request)), loaded, loaded.exports);
  const runtime = loaded.exports.createMockupRuntime(host, { onStatus: status => statuses.push(status), onInteraction: () => interactions++ });
  return {
    runtime, host, statuses, pools, draws, rafs, motionQuery, outputMaterial, backdropPainters, backdropBindings, controls: Controls.instance, renderer: Renderer.instance,
    get interactions() { return interactions; },
    parse(url) {
      assert.ok(parses.has(url), `Expected parse request for ${url}`);
      const root = new THREE.Group(); root.name = url;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 16), new THREE.MeshStandardMaterial());
      let disposals = 0; mesh.geometry.addEventListener('dispose', () => disposals++); root.add(mesh);
      const model = { root, get disposals() { return disposals; } }; models.set(url, model);
      parses.get(url).resolve({ scene: root }); return model;
    },
    finishLabel(id) { for (const pool of pools) pool.finish(id); },
    finishReadback() { assert.ok(renderReadback); renderReadback.resolve(); },
    pointer(type, x = 350, y = 350, pointerType = 'mouse', target) {
      const event = new Event(type);
      for (const [key, value] of Object.entries({ clientX: x, clientY: y, pointerId: 1, pointerType, button: 0, ...(target ? { target } : {}) })) Object.defineProperty(event, key, { value });
      host.dispatchEvent(event);
    },
    runFrame(now = performance.now() + 100) { const queued = [...rafs]; rafs.clear(); queued.forEach(([, work]) => work(now)); },
    hide(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
    intersect(value) { observer([{ isIntersecting: value }]); },
    close() {
      runtime.dispose();
      for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
    },
  };
}

const studioAsset = id => ({ id, name: id, src: `/${id}.glb`, packaging: 'can', materialSlots: { label: ['label'] } });
const studioLabel = id => ({ id, requiredSlots: ['label'], slots: { label: { color: '#ffffff' } } });
async function makeReady(harness, modelId = 'a', labelId = 'one') {
  harness.runtime.select(studioAsset(modelId), studioLabel(labelId)); await flush();
  const model = harness.parse(`/${modelId}.glb`); await flush();
  harness.finishLabel(labelId); await flush();
  assert.equal(harness.statuses.at(-1).phase, 'ready'); return model;
}

test('Studio uniform edits preserve selection readiness/camera and apply pending edits after label commit', async context => {
  const h = runtimeHarness(); context.after(() => h.close());
  await makeReady(h);
  const pool = h.pools[0], count = h.pools.length, revision = h.statuses.at(-1).revision, statusCount = h.statuses.length;
  const cameraBefore = h.controls.camera.position.toArray();
  const edit = { label: { textureOffsetX: -.125, roughness: .06 }, cap: { color: '#008b28' } };
  h.runtime.setMaterialOverrides(edit);
  assert.equal(pool.edits.at(-1), edit); assert.equal(h.pools.length, count); assert.equal(h.statuses.length, statusCount);
  assert.equal(h.statuses.at(-1).revision, revision); assert.deepEqual(h.controls.camera.position.toArray(), cameraBefore);
  h.runtime.select(studioAsset('a'), studioLabel('two')); await flush();
  h.runtime.setMaterialOverrides({}); h.finishLabel('two'); await flush();
  assert.equal(h.statuses.at(-1).phase, 'ready'); assert.deepEqual(pool.edits.at(-1), {});
  assert.equal(h.statuses.at(-1).materials.label.roughness, .15);
});

test('Aloe transparent Studio preview refracts the live surface but PNG remains free of the decorative grid', async context => {
  const h = runtimeHarness(); context.after(() => h.close());
  const backdrop = { state: {}, config: {} };
  h.runtime.setBackdrop(backdrop);
  h.runtime.setBackground({ type: 'transparent' });
  h.runtime.select({ ...studioAsset('aloe'), packaging: 'pet', materialSlots: { liquid: ['Aloe Vera Water'] } }, studioLabel('one'));
  await flush(); h.parse('/aloe.glb'); await flush(); h.finishLabel('one'); await flush();
  assert.equal(h.statuses.at(-1).phase, 'ready');
  assert.equal(h.backdropPainters.length, 1);
  assert.equal(h.backdropBindings.at(-1).texture, h.backdropPainters[0].texture);
  assert.equal(h.draws.at(-1).target, null, 'Live preview uses the same final color-space composition as the hero');
  const bindingCount = h.backdropBindings.length;
  const exporting = h.runtime.capture({ longEdge: 2048 }); await flush();
  assert.ok(h.backdropBindings.slice(bindingCount).every(binding => binding.texture === null),
    'The PNG render must detach live CSS before the asynchronous GPU readback');
  assert.ok(h.draws.at(-1).target !== null, 'Native transparent PNG retains its linear/MSAA export stage');
  h.finishReadback(); await exporting; await flush(); h.runFrame(performance.now() + 1000);
  assert.equal(h.backdropBindings.at(-1).texture, h.backdropPainters[0].texture, 'Preview refraction resumes after export');
  h.runtime.setBackground({ type: 'white' }); h.runFrame(performance.now() + 2000);
  assert.equal(h.backdropBindings.at(-1).texture, null);
  assert.equal(h.backdropPainters[0].disposed, true, 'Solid backgrounds release the optional live sampler');
  assert.ok(h.draws.at(-1).target !== null, 'White beauty preview continues to share its output stage with PNG');
  h.runtime.setBackground({ type: 'transparent' }); h.runFrame(performance.now() + 3000);
  assert.equal(h.backdropPainters.length, 2);
  h.runtime.select(studioAsset('can'), studioLabel('one')); await flush(); h.parse('/can.glb'); await flush(); h.finishLabel('one'); await flush();
  assert.equal(h.backdropPainters[1].disposed, true, 'Switching packages cannot leave a borrowed texture on the cached bottle');
  assert.equal(h.backdropBindings.at(-1).texture, null);
});

test('ordinary Studio models do not allocate a refraction painter or a continuous still-preview loop', async context => {
  const h = runtimeHarness(); context.after(() => h.close());
  h.runtime.setBackdrop({ state: {}, config: {} }); h.runtime.setBackground({ type: 'transparent' });
  await makeReady(h); h.runFrame(performance.now() + 1000);
  assert.equal(h.backdropPainters.length, 0);
  assert.equal(h.rafs.size, 0);
});

test('Studio presets fit actual package geometry at portrait, square and landscape aspect', () => {
  let checked = 0;
  for (const dimensions of [[0.066, 0.091], [0.053, 0.11], [0.054, 0.133], [0.058, 0.146], [0.066, 0.168]]) {
    const geometry = new THREE.CylinderGeometry(dimensions[0] / 2, dimensions[0] / 2, dimensions[1], 48);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const bounds = new THREE.Box3().setFromObject(mesh);
    const envelope = camera.mockupOrbitBounds(bounds);
    for (const aspect of [0.4, 0.8, 1, 16 / 9, 3]) for (const preset of ['front', 'three-quarter', 'left', 'right', 'back', 'top']) {
      const direction = camera.mockupCameraDirection(preset);
      const distance = camera.fitMockupCamera(envelope, direction, aspect, 30);
      const view = new THREE.PerspectiveCamera(30, aspect, 0.00001, 20);
      view.position.copy(direction).multiplyScalar(distance); view.lookAt(0, 0, 0); view.updateMatrixWorld(true);
      for (const yaw of [0, 0.39, 1.72, 3.3, 4.64, 6.1]) for (let index = 0; index < geometry.attributes.position.count; index += 2) {
        const point = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).project(view);
        assert.ok(Math.abs(point.x) <= 0.800001 && Math.abs(point.y) <= 0.800001,
          `Package clipped at ${preset}, aspect ${aspect}, yaw ${yaw}`);
        assert.ok(point.z > -1 && point.z < 1); checked++;
      }
    }
    geometry.dispose(); mesh.material.dispose();
  }
  assert.ok(checked > 100000);
});

test('camera orbit starts at the current arbitrary view and retains radius and height', () => {
  const target = new THREE.Vector3(0.3, -0.21, 0.08);
  const original = new THREE.Vector3(1.2, 0.59, -0.84);
  const actual = original.clone(); const distance = actual.distanceTo(target);
  const expected = actual.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.73).add(target);
  camera.orbitMockupCamera(actual, target, 0.73);
  assert.ok(actual.distanceTo(expected) < 1e-12);
  assert.ok(Math.abs(actual.distanceTo(target) - distance) < 1e-12);
  assert.ok(Math.abs(actual.y - original.y) < 1e-12);
  camera.orbitMockupCamera(actual, target, -0.73);
  assert.ok(actual.distanceTo(original) < 1e-12);
});

test('arbitrary view fit works beyond the six toolbar directions without a +Z assumption', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-0.1, -0.3, -0.075), new THREE.Vector3(0.1, 0.3, 0.075));
  for (let sample = 0; sample < 180; sample++) {
    const direction = new THREE.Vector3(Math.cos(sample * 0.14), Math.sin(sample * 0.05) * 2, Math.sin(sample * 0.14)).normalize();
    const distance = camera.fitMockupCamera(bounds, direction, 0.8, 30);
    const view = new THREE.PerspectiveCamera(30, 0.8, 0.001, 100);
    view.position.copy(direction).multiplyScalar(distance); view.lookAt(0, 0, 0); view.updateMatrixWorld(true);
    for (const x of [-0.1, 0.1]) for (const y of [-0.3, 0.3]) for (const z of [-0.075, 0.075]) {
      const point = new THREE.Vector3(x, y, z).project(view);
      assert.ok(Math.abs(point.x) <= 0.800001 && Math.abs(point.y) <= 0.800001);
    }
  }
});

test('export long edges, device limits and pixel budget remain independent from preview DPR', () => {
  assert.deepEqual(capture.mockupCaptureSize(2048, 1), { width: 2048, height: 2048, longEdge: 2048 });
  assert.deepEqual(capture.mockupCaptureSize(1024, 16 / 9), { width: 1024, height: 576, longEdge: 1024 });
  assert.deepEqual(capture.mockupCaptureSize(2048, 4 / 5), { width: 1638, height: 2048, longEdge: 2048 });
  const limited = capture.mockupCaptureSize(2048, 1, 768);
  assert.deepEqual(limited, { width: 768, height: 768, longEdge: 768 });
  const budgeted = capture.mockupCaptureSize(2048, 1, 2048, 512 * 512);
  assert.equal(budgeted.width * budgeted.height, 512 * 512);
  assert.equal(camera.normalizeMockupAspect(NaN), 1);
});

test('PNG rows flip once and preserve straight alpha and pixel color bytes', () => {
  const bottom = [11, 22, 33, 0, 44, 55, 66, 128];
  const top = [77, 88, 99, 255, 100, 110, 120, 31];
  const original = new Uint8Array([...bottom, ...top]);
  assert.deepEqual([...capture.flipMockupPixels(original, 2, 2)], [...top, ...bottom]);
  assert.deepEqual([...original], [...bottom, ...top]);
  assert.throws(() => capture.flipMockupPixels(original, 3, 2), /Invalid PNG pixel buffer/);
});

test('only one export holds the gate and rejection always restores before another export', async () => {
  const gate = capture.createMockupCaptureGate();
  let rejectPending; let restores = 0;
  const first = gate.run(() => new Promise((resolve, reject) => { rejectPending = reject; }), () => { assert.equal(gate.busy, true); restores++; });
  assert.equal(gate.busy, true);
  await assert.rejects(gate.run(async () => 'second', () => restores++), /already running/);
  rejectPending(new Error('Readback failed'));
  await assert.rejects(first, /Readback failed/);
  assert.equal(gate.busy, false); assert.equal(restores, 1);
  assert.equal(await gate.run(async () => 'recovered', () => restores++), 'recovered');
  assert.equal(restores, 2); assert.equal(gate.busy, false);
});

test('restore exceptions still release the export gate', async () => {
  const gate = capture.createMockupCaptureGate();
  await assert.rejects(gate.run(async () => 'image', () => { throw new Error('Restore failed'); }), /Restore failed/);
  assert.equal(gate.busy, false);
});

test('PNG encoder rejects null blobs and releases its temporary canvas', async () => {
  const savedDocument = global.document; const savedImageData = global.ImageData;
  const canvas = { width: 0, height: 0, getContext: () => ({ putImageData() {} }), toBlob: callback => callback(null) };
  global.document = { createElement: () => canvas };
  global.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  try {
    await assert.rejects(capture.encodeMockupPng(new Uint8Array(4), 1, 1), /empty image/);
    assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  } finally { global.document = savedDocument; global.ImageData = savedImageData; }
});

test('PNG encoder handles abort during asynchronous toBlob and clears timeout/listeners', async () => {
  const savedDocument = global.document; const savedImageData = global.ImageData;
  let encodeCallback;
  const canvas = { width: 0, height: 0, getContext: () => ({ putImageData() {} }), toBlob: callback => { encodeCallback = callback; } };
  global.document = { createElement: () => canvas };
  global.ImageData = class { constructor(data) { this.data = data; } };
  try {
    const abort = new AbortController();
    const exporting = capture.encodeMockupPng(new Uint8Array(4), 1, 1, abort.signal);
    abort.abort();
    await assert.rejects(exporting, error => error.name === 'AbortError');
    encodeCallback(new Blob(['late image'], { type: 'image/png' }));
    assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  } finally { global.document = savedDocument; global.ImageData = savedImageData; }
});

test('latest selection wins and a decoded stale GLB is disposed without becoming ready', async () => {
  const h = runtimeHarness();
  try {
    h.runtime.select(studioAsset('old'), studioLabel('old-label')); await flush();
    h.runtime.select(studioAsset('new'), studioLabel('new-label')); await flush();
    const stale = h.parse('/old.glb'); await flush();
    assert.equal(stale.disposals, 1);
    const latest = h.parse('/new.glb'); await flush();
    h.finishLabel('new-label'); await flush();
    assert.equal(h.statuses.at(-1).phase, 'ready'); assert.equal(h.statuses.at(-1).assetId, 'new');
    assert.equal(h.statuses.filter(value => value.phase === 'ready' && value.assetId === 'old').length, 0);
    assert.equal(latest.disposals, 0);
  } finally { h.close(); }
});

test('label changes retain the committed appearance and reject stale label completion', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const pool = h.pools[0]; assert.equal(pool.content.userData.appearance, 'one');
    h.runtime.select(studioAsset('a'), studioLabel('two')); await flush();
    assert.equal(pool.content.userData.appearance, 'one');
    await assert.rejects(h.runtime.capture({ longEdge: 1024 }), /not ready/);
    h.runtime.select(studioAsset('a'), studioLabel('three')); await flush();
    h.finishLabel('two'); await flush();
    assert.equal(pool.content.userData.appearance, 'one'); assert.equal(h.statuses.at(-1).phase, 'loading-label');
    h.finishLabel('three'); await flush();
    assert.equal(pool.content.userData.appearance, 'three'); assert.equal(h.statuses.at(-1).phase, 'ready');
    assert.equal(h.statuses.at(-1).appearanceId, 'three');
  } finally { h.close(); }
});

test('replacement model commits only after its label is warm and disposes both bounded models on exit', async () => {
  const h = runtimeHarness(); let first; let second;
  try {
    first = await makeReady(h);
    h.runtime.select(studioAsset('b'), studioLabel('two')); await flush();
    second = h.parse('/b.glb'); await flush();
    assert.ok(h.draws.at(-1).scene.getObjectByName('/a.glb'));
    assert.equal(first.disposals, 0); assert.equal(second.disposals, 0);
    assert.equal(h.host.dataset.productId, 'a');
    h.finishLabel('two'); await flush();
    assert.equal(h.host.dataset.productId, 'b'); assert.equal(h.host.dataset.modelPoolSize, '2');
    assert.equal(h.draws.at(-1).scene.getObjectByName('/a.glb'), undefined);
    assert.ok(h.draws.at(-1).scene.getObjectByName('/b.glb'));
  } finally { h.close(); }
  assert.equal(first.disposals, 1); assert.equal(second.disposals, 1);
});

test('capture locks the committed revision, matches preview aspect and restores controls and framebuffer', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.setAspect(0.8); h.runtime.setCamera('three-quarter');
    const position = h.controls.camera.position.clone(); const width = h.renderer.width; const height = h.renderer.height;
    const exporting = h.runtime.capture({ longEdge: 2048, aspect: 0.8 });
    assert.equal(h.statuses.at(-1).phase, 'exporting'); assert.equal(h.controls.enabled, false);
    h.runtime.select(studioAsset('b'), studioLabel('two')); h.runtime.select(studioAsset('a'), studioLabel('one'));
    h.runtime.zoom(1.5); h.runtime.setAspect(1);
    assert.equal(h.statuses.at(-1).assetId, 'a'); assert.ok(h.controls.camera.position.distanceTo(position) < 1e-12);
    await assert.rejects(h.runtime.capture({ longEdge: 1024 }), /not ready/);
    assert.equal(h.host.dataset.captureSize, '1638x2048');
    h.finishReadback(); await flush(); const png = await exporting;
    assert.equal(png.type, 'image/png'); assert.equal(h.statuses.at(-1).phase, 'ready');
    assert.equal(h.controls.enabled, true); assert.equal(h.renderer.getRenderTarget(), null);
    assert.equal(h.renderer.width, width); assert.equal(h.renderer.height, height);
    assert.ok(h.controls.camera.position.distanceTo(position) < 1e-12);
    await assert.rejects(h.runtime.capture({ longEdge: 1024, aspect: 1 }), /match the preview/);
  } finally { h.close(); }
});

test('successive PNG captures reuse a distinct camera ID while copying each current view and lens', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const previewId = h.controls.camera.id;
    const captures = [];
    for (const [aspect, preset, lens] of [[1, 'front', 'standard'], [0.8, 'three-quarter', 'wide'], [16 / 9, 'back', 'telephoto']]) {
      h.runtime.setAspect(aspect); h.runtime.setCamera(preset); h.runtime.setFocalLength(lens);
      const expected = h.controls.camera.clone();
      const exporting = h.runtime.capture({ longEdge: 1024, aspect });
      const draw = h.draws.at(-1); captures.push(draw);
      assert.notEqual(draw.cameraId, previewId, 'Capture retains a separate snapshot from the interactive camera');
      assert.equal(draw.camera.aspect, aspect); assert.equal(draw.camera.fov, focal.MOCKUP_FOCAL_FOV[lens]);
      assert.ok(draw.camera.position.distanceTo(expected.position) < 1e-12);
      assert.ok(draw.camera.quaternion.angleTo(expected.quaternion) < 1e-7);
      assert.deepEqual(draw.camera.projectionMatrix.elements, expected.projectionMatrix.elements);
      h.finishReadback(); await flush(); await exporting;
      assert.equal(h.statuses.at(-1).phase, 'ready');
      assert.equal(h.controls.camera.id, previewId); assert.equal(h.renderer.getRenderTarget(), null);
    }
    assert.equal(new Set(captures.map(draw => draw.cameraId)).size, 1, 'Native transmission caches one export buffer instead of one per PNG');
    assert.equal(new Set(captures.map(draw => draw.camera.fov)).size, 3, 'Reusing the camera cannot freeze a previous focal setting');
  } finally { h.close(); }
});

test('aborted capture restores the preview and context loss never publishes a false ready', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const cancellation = new AbortController();
    const exporting = h.runtime.capture({ longEdge: 1024, signal: cancellation.signal });
    cancellation.abort(); await assert.rejects(exporting, error => error.name === 'AbortError');
    assert.equal(h.statuses.at(-1).phase, 'ready'); assert.equal(h.controls.enabled, true);
    const interrupted = h.runtime.capture({ longEdge: 1024 });
    const event = new Event('webglcontextlost', { cancelable: true }); h.host.canvas.dispatchEvent(event);
    await assert.rejects(interrupted, error => error.name === 'AbortError');
    assert.equal(event.defaultPrevented, true); assert.equal(h.statuses.at(-1).phase, 'error');
    assert.equal(h.statuses.at(-1).error, 'webgl'); assert.equal(h.controls.enabled, false); assert.equal(h.rafs.size, 0);
    await assert.rejects(h.runtime.capture({ longEdge: 1024 }), /not ready/);
  } finally { h.close(); }
});

test('mockup animation runs with OS reduced motion while stationary scenes and hidden previews remain suspended', async () => {
  const h = runtimeHarness({ reducedMotion: true });
  try {
    await makeReady(h); h.runFrame(); assert.equal(h.rafs.size, 0);
    h.runtime.setAnimation({ mode: 'turntable', speed: 1, playing: true });
    assert.equal(h.rafs.size, 1);
    for (let frame = 1; frame < 10; frame++) { h.runFrame(performance.now() + frame * 100); assert.equal(h.rafs.size, 1); }
    const product = h.pools[0].content.parent.parent;
    const before = product.quaternion.clone();
    for (const matches of [false, true]) { h.motionQuery.matches = matches; h.motionQuery.dispatchEvent(new Event('change')); }
    h.runFrame(performance.now() + 1500);
    assert.equal(h.rafs.size, 1); assert.ok(product.quaternion.angleTo(before) > 0.001);
    h.hide(true); assert.equal(h.rafs.size, 0); h.hide(false); assert.equal(h.rafs.size, 1);
    h.controls.dispatchEvent({ type: 'start' }); h.runFrame(performance.now() + 2000);
    assert.equal(h.rafs.size, 0); assert.equal(h.interactions, 1);
    h.runtime.setAnimation({ mode: 'turntable', speed: 1, playing: true });
    h.intersect(false); assert.equal(h.rafs.size, 0); h.intersect(true); assert.equal(h.rafs.size, 1);
  } finally { h.close(); }
});

test('dispose aborts pending decode, destroys controls/renderer and releases a late GLB exactly once', async () => {
  const h = runtimeHarness();
  try {
    h.runtime.select(studioAsset('late'), studioLabel('label')); await flush();
    h.runtime.dispose(); const late = h.parse('/late.glb'); await flush();
    assert.equal(late.disposals, 1); assert.equal(h.controls.disposed, true); assert.equal(h.renderer.disposed, true);
    assert.equal(h.host.canvas.removed, true); assert.equal(h.rafs.size, 0);
    assert.equal(h.statuses.some(value => value.phase === 'ready'), false);
  } finally { h.close(); }
});

test('WebGL2 devices without float color buffers use an explicit compatible render target', async () => {
  const h = runtimeHarness({ floatingPoint: false });
  try {
    await makeReady(h); assert.equal(h.host.dataset.mockupQuality, 'compatible');
    assert.equal(h.draws.at(-1).target.texture.type, THREE.UnsignedByteType);
  } finally { h.close(); }
});

test('r180 output shader composites white, gradient and transparent background inside canvas/PNG', () => {
  const h = runtimeHarness();
  try {
    const shader = h.outputMaterial.fragmentShader;
    assert.match(shader, /uniform vec3 backgroundTop;/);
    assert.match(shader, /uniform vec3 backgroundBottom;/);
    assert.match(shader, /vec3 backdrop = mix\(backgroundBottom, backgroundTop, vUv\.y\);/);
    assert.match(shader, /mix\(backdrop, gl_FragColor\.rgb, gl_FragColor\.a\)/);
    assert.match(shader, /gl_FragColor\.rgb \/= gl_FragColor\.a/);
    h.runtime.setBackground({ type: 'white' });
    assert.equal(h.outputMaterial.uniforms.backgroundAlpha.value, 1);
    assert.equal(h.outputMaterial.uniforms.backgroundTop.value.getHexString(), 'ffffff');
    h.runtime.setBackground({ type: 'gradient', color: '#112233', colorEnd: '#aabbcc' });
    assert.equal(h.outputMaterial.uniforms.backgroundTop.value.getHexString(), '112233');
    assert.equal(h.outputMaterial.uniforms.backgroundBottom.value.getHexString(), 'aabbcc');
    h.runtime.setBackground({ type: 'transparent' });
    assert.equal(h.outputMaterial.uniforms.backgroundAlpha.value, 0);
  } finally { h.close(); }
});

test('reselecting the committed scene re-emits ready without loading or preparing again', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const revision = h.statuses.at(-1).revision; const statusCount = h.statuses.length; const poolCount = h.pools.length;
    h.runtime.select(studioAsset('a'), studioLabel('one')); await flush();
    assert.equal(h.statuses.length, statusCount + 1); assert.equal(h.statuses.at(-1).phase, 'ready');
    assert.equal(h.statuses.at(-1).revision, revision); assert.equal(h.pools.length, poolCount);
  } finally { h.close(); }
});

test('keyboard free orbit retains distance, pauses motion and clamps polar angle safely', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); const distance = h.controls.camera.position.distanceTo(h.controls.target);
    const initial = h.controls.camera.position.clone();
    h.runtime.setAnimation({ mode: 'turntable', speed: 1, playing: true });
    h.runtime.orbitView(Math.PI / 36, -Math.PI / 36);
    assert.ok(h.controls.camera.position.distanceTo(initial) > 0.001);
    assert.ok(Math.abs(h.controls.camera.position.distanceTo(h.controls.target) - distance) < 1e-12);
    h.runFrame(performance.now() + 100); assert.equal(h.rafs.size, 0); assert.equal(h.interactions, 1);
    h.runtime.orbitView(0, -100);
    const top = new THREE.Spherical().setFromVector3(h.controls.camera.position.clone().sub(h.controls.target));
    assert.ok(Math.abs(top.phi - h.controls.minPolarAngle) < 1e-12);
    h.runtime.orbitView(0, 100);
    const bottom = new THREE.Spherical().setFromVector3(h.controls.camera.position.clone().sub(h.controls.target));
    assert.ok(Math.abs(bottom.phi - h.controls.maxPolarAngle) < 1e-12);
  } finally { h.close(); }
});

test('capture queues the latest label selection and applies it after restoration unlocks the scene', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const originalKey = selection.mockupSelectionKey(studioAsset('a'), studioLabel('one'));
    assert.equal(h.statuses.at(-1).selectionKey, originalKey);
    const exporting = h.runtime.capture({ longEdge: 1024 });
    h.runtime.select(studioAsset('a'), studioLabel('two')); h.runtime.select(studioAsset('a'), studioLabel('three'));
    assert.equal(h.statuses.at(-1).phase, 'exporting'); assert.equal(h.statuses.at(-1).selectionKey, originalKey);
    assert.equal(h.pools[0].content.userData.appearance, 'one');
    h.finishReadback(); await flush(); await exporting;
    assert.equal(h.statuses.at(-1).phase, 'loading-label'); assert.equal(h.statuses.at(-1).appearanceId, 'three');
    assert.equal(h.statuses.at(-1).selectionKey, selection.mockupSelectionKey(studioAsset('a'), studioLabel('three')));
    assert.equal(h.pools[0].content.userData.appearance, 'one');
    await assert.rejects(h.runtime.capture({ longEdge: 1024 }), /not ready/);
    h.finishLabel('three'); await flush();
    assert.equal(h.statuses.at(-1).phase, 'ready'); assert.equal(h.pools[0].content.userData.appearance, 'three');
  } finally { h.close(); }
});

test('camera presets remain relative to the label front after turntable rotation and preserve its phase', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h);
    const product = h.pools[0].content.parent.parent; product.rotation.y = Math.PI;
    h.runtime.setCamera('front');
    const relative = h.controls.camera.position.clone().sub(h.controls.target).normalize();
    const expected = camera.mockupCameraDirection('front').applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    assert.ok(relative.distanceTo(expected) < 1e-12); assert.equal(product.rotation.y, Math.PI);
    h.runtime.setCamera('left');
    const left = h.controls.camera.position.clone().sub(h.controls.target).normalize();
    assert.ok(left.distanceTo(camera.mockupCameraDirection('left').applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)) < 1e-12);
    h.runtime.resetView(); assert.equal(product.rotation.y, 0);
    assert.ok(h.controls.camera.position.clone().sub(h.controls.target).normalize().distanceTo(camera.mockupCameraDirection('front')) < 1e-12);
  } finally { h.close(); }
});

test('blank Studio surfaces remove baked label artwork while retaining other imported PBR and texture ownership', () => {
  const root = new THREE.Group(); const labelMap = new THREE.Texture(); const capMap = new THREE.Texture(); const normalMap = new THREE.Texture();
  let labelDisposals = 0; let capDisposals = 0;
  labelMap.addEventListener('dispose', () => labelDisposals++); capMap.addEventListener('dispose', () => capDisposals++);
  const label = new THREE.MeshPhysicalMaterial({ map: labelMap, normalMap, metalness: 0.81, roughness: 0.23, clearcoat: 0.34 }); label.name = 'label';
  const cap = new THREE.MeshStandardMaterial({ map: capMap, metalness: 0.93 }); cap.name = 'cap';
  const geometry = new THREE.BoxGeometry(); const mesh = new THREE.Mesh(geometry, [label, cap]); root.add(mesh);
  const detached = neutral.neutralizeMockupLabelArtwork(root, studioAsset('a'));
  assert.equal(label.map, null); assert.equal(label.normalMap, normalMap);
  assert.equal(label.metalness, 0.81); assert.equal(label.roughness, 0.23); assert.equal(label.clearcoat, 0.34);
  assert.equal(cap.map, capMap); assert.equal(detached.has(labelMap), true); assert.equal(detached.has(capMap), false);
  assert.equal(labelDisposals, 0); neutral.disposeMockupDetachedTextures(detached); neutral.disposeMockupDetachedTextures(detached);
  assert.equal(labelDisposals, 1); assert.equal(capDisposals, 0);
  geometry.dispose(); label.dispose(); cap.dispose(); capMap.dispose(); normalMap.dispose();
});


test('five focal levels preserve the standard lens and fit the tilted spinning package in every export frame', () => {
  assert.deepEqual(focal.MOCKUP_FOCAL_PRESETS, ['ultraWide', 'wide', 'standard', 'long', 'telephoto']);
  assert.equal(focal.MOCKUP_FOCAL_FOV.standard, 30);
  const geometry = new THREE.CylinderGeometry(0.033, 0.033, 0.146, 48);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const bounds = new THREE.Box3().setFromObject(mesh);
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
  const envelope = camera.mockupShowcaseBounds(bounds, rest);
  for (const aspect of [0.8, 1, 16 / 9]) for (const fov of Object.values(focal.MOCKUP_FOCAL_FOV)) {
    const direction = new THREE.Vector3(0, 0, 1);
    const view = new THREE.PerspectiveCamera(fov, aspect, 0.00001, 20);
    view.position.z = camera.fitMockupCamera(envelope, direction, aspect, fov);
    view.lookAt(0, 0, 0); view.updateMatrixWorld(true);
    for (const yaw of [0, 0.7, 1.8, 3.4, 4.9, 6.1]) {
      const pose = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      for (let index = 0; index < geometry.attributes.position.count; index += 2) {
        const point = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index).applyQuaternion(pose).project(view);
        assert.ok(Math.abs(point.x) <= 0.800001 && Math.abs(point.y) <= 0.800001, `Clipped at FOV ${fov}, aspect ${aspect}, yaw ${yaw}`);
      }
    }
  }
  geometry.dispose(); mesh.material.dispose();
});

test('lens changes compensate distance, preserve view direction and zoom, and reset to Standard', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.orbitView(0.4, 0.1);
    const direction = h.controls.camera.position.clone().sub(h.controls.target).normalize();
    const product = h.pools[0].content.parent;
    const bounds = camera.mockupOrbitBounds(new THREE.Box3().setFromObject(product));
    h.runtime.zoom(1.2);
    let lastDistance = 0;
    for (const preset of focal.MOCKUP_FOCAL_PRESETS) {
      h.runtime.setFocalLength(preset);
      const view = h.controls.camera, fov = focal.MOCKUP_FOCAL_FOV[preset];
      const expectedDistance = camera.fitMockupCamera(bounds, direction, view.aspect, fov) / 1.2;
      assert.equal(view.fov, fov);
      assert.ok(Math.abs(view.position.distanceTo(h.controls.target) - expectedDistance) < 1e-10);
      assert.ok(view.position.clone().sub(h.controls.target).normalize().distanceTo(direction) < 1e-10);
      assert.ok(view.position.distanceTo(h.controls.target) > lastDistance);
      lastDistance = view.position.distanceTo(h.controls.target);
    }
    h.runtime.resetView(); assert.equal(h.controls.camera.fov, 30); assert.equal(h.host.dataset.focalLength, 'standard');
  } finally { h.close(); }
});

test('Website mode uses the homepage tilt and idle speed, drags the product, then settles and resumes without moving the camera', async () => {
  const h = runtimeHarness({ reducedMotion: true });
  try {
    await makeReady(h);
    const product = h.pools[0].content.parent.parent;
    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
    h.runtime.setAnimation({ mode: 'showcase', playing: true, speed: 1 });
    assert.ok(product.quaternion.angleTo(rest) < 1e-7); assert.equal(h.controls.enableRotate, false);
    const cameraPosition = h.controls.camera.position.clone();
    let now = performance.now(); h.runFrame(now);
    const before = product.quaternion.clone(); now += 50; h.runFrame(now);
    assert.ok(Math.abs(product.quaternion.angleTo(before) - DEFAULT_VIEWER_PRESENTATION.motion.idleSpeed * 0.05) < 1e-7);
    h.pointer('pointerdown'); assert.equal(h.host.canvas.hasPointerCapture(1), true);
    h.pointer('pointermove', 430, 390);
    for (let frame = 0; frame < 8; frame++) { now += 50; h.runFrame(now); }
    assert.ok(product.quaternion.angleTo(rest) > 0.1);
    assert.ok(h.controls.camera.position.distanceTo(cameraPosition) < 1e-12);
    h.pointer('pointerup', 430, 390); assert.equal(h.host.canvas.hasPointerCapture(1), false);
    for (let frame = 0; frame < 52; frame++) { now += 50; h.runFrame(now); }
    assert.ok(product.quaternion.angleTo(rest) < 0.06, 'Returns to the homepage tilt after the two-second input delay');
    const resumed = product.quaternion.clone(); now += 50; h.runFrame(now);
    assert.ok(product.quaternion.angleTo(resumed) > 0.001); assert.equal(h.interactions, 0);
    h.hide(true); assert.equal(h.rafs.size, 0); h.hide(false); assert.equal(h.rafs.size, 1);
    const frozen = product.quaternion.clone();
    h.runtime.setAnimation({ mode: 'off', playing: false, speed: 1 }); h.runFrame(now + 100);
    assert.ok(product.quaternion.angleTo(frozen) < 1e-7);
    assert.equal(h.controls.enableRotate, true); assert.equal(h.rafs.size, 0);
  } finally { h.close(); }
});

test('Website mode touch ownership follows the product silhouette and cancellation releases capture', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.setAnimation({ mode: 'showcase', playing: true, speed: 1 }); h.runFrame();
    assert.equal(h.host.hitRegion.style.touchAction, 'none'); assert.equal(h.host.hitRegion.style.display, 'block');
    h.pointer('pointerdown', 350, 350, 'touch'); assert.equal(h.host.canvas.hasPointerCapture(1), false);
    h.pointer('pointerdown', 350, 350, 'touch', h.host.hitRegion); assert.equal(h.host.canvas.hasPointerCapture(1), true);
    h.pointer('pointercancel', 350, 350, 'touch'); assert.equal(h.host.canvas.hasPointerCapture(1), false);
    h.pointer('pointerdown', 350, 350, 'touch', h.host.hitRegion); assert.equal(h.host.canvas.hasPointerCapture(1), true);
    h.hide(true); assert.equal(h.host.canvas.hasPointerCapture(1), false); assert.equal(h.host.hitRegion.style.display, 'none');
  } finally { h.close(); }
  assert.equal(h.host.hitRegion.removed, true);
});

test('Website mode stays animated across label/model changes and PNG captures the selected lens and exact current pose', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.setAnimation({ mode: 'showcase', playing: true, speed: 1 });
    h.runtime.setFocalLength('telephoto'); h.runFrame();
    h.runtime.select(studioAsset('a'), studioLabel('two')); await flush(); h.finishLabel('two'); await flush();
    assert.equal(h.host.dataset.motionMode, 'showcase'); assert.equal(h.interactions, 0); assert.equal(h.rafs.size, 1);
    h.runtime.select(studioAsset('b'), studioLabel('three')); await flush(); h.parse('/b.glb'); await flush(); h.finishLabel('three'); await flush();
    const product = h.pools.at(-1).content.parent.parent;
    assert.equal(h.controls.camera.fov, 16); assert.equal(h.rafs.size, 1);
    h.runFrame(); const currentPose = product.quaternion.clone(); const currentCamera = h.controls.camera.clone();
    const exporting = h.runtime.capture({ longEdge: 2048, aspect: 1 });
    assert.equal(h.rafs.size, 0); assert.equal(h.draws.at(-1).camera.fov, 16);
    assert.ok(h.draws.at(-1).camera.position.distanceTo(currentCamera.position) < 1e-12);
    h.runtime.setFocalLength('wide'); h.runtime.orbitView(1, 1); h.runFrame();
    assert.ok(product.quaternion.angleTo(currentPose) < 1e-7); assert.equal(h.controls.camera.fov, 16);
    h.finishReadback(); await flush(); assert.equal((await exporting).type, 'image/png');
    assert.equal(h.rafs.size, 1); assert.equal(h.controls.enableRotate, false);
    h.runtime.setAnimation({ mode: 'showcase', playing: false, speed: 1 }); h.runFrame(performance.now() + 1000); assert.equal(h.rafs.size, 0);
    h.runtime.orbitView(0.16, 0.12);
    for (let frame = 0; frame < 40; frame++) h.runFrame(performance.now() + 1100 + frame * 50);
    assert.equal(h.rafs.size, 0, 'Paused showcase remains interactive and stops scheduling when settled');
  } finally { h.close(); }
});


test('changing labels during showcase never bakes animated parent transforms into the next lens fit', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.setAnimation({ mode: 'showcase', playing: true, speed: 1 });
    const original = h.controls.camera.position.clone();
    for (let frame = 0; frame < 30; frame++) h.runFrame(performance.now() + frame * 50);
    h.runtime.select(studioAsset('a'), studioLabel('two')); await flush(); h.finishLabel('two'); await flush();
    h.runtime.setFocalLength('wide'); h.runtime.setFocalLength('standard');
    assert.ok(h.controls.camera.position.distanceTo(original) < 1e-10, 'The same lens has identical framing after a label switch');
  } finally { h.close(); }
});

test('showcase wheel zoom works over the silhouette while browser Ctrl-zoom stays available', async () => {
  const h = runtimeHarness();
  try {
    await makeReady(h); h.runtime.setAnimation({ mode: 'showcase', playing: true, speed: 1 });
    const distance = h.controls.camera.position.distanceTo(h.controls.target);
    const wheel = ctrlKey => {
      const event = new Event('wheel', { cancelable: true });
      for (const [key, value] of Object.entries({ deltaY: -120, deltaMode: 0, ctrlKey, target: h.host.hitRegion })) Object.defineProperty(event, key, { value });
      h.host.dispatchEvent(event); return event;
    };
    assert.equal(wheel(false).defaultPrevented, true);
    const zoomed = h.controls.camera.position.distanceTo(h.controls.target); assert.ok(zoomed < distance);
    assert.equal(h.interactions, 0); assert.equal(h.rafs.size, 1);
    assert.equal(wheel(true).defaultPrevented, false); assert.equal(h.controls.camera.position.distanceTo(h.controls.target), zoomed);
  } finally { h.close(); }
});
