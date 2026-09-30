/* Run with: node scripts/tests/product-viewer.test.cjs (no child-process isolation required). */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node-only harness evaluates the compiled CommonJS runtime in isolation. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const projectRoot = path.resolve(__dirname, '../..');

/** Execute the shipped TypeScript source, rather than a copied implementation. */
function loadSource(relativePath, requireModule = require) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(requireModule, loaded, loaded.exports);
  return loaded.exports;
}

const framing = loadSource('lib/viewer/framing.ts');
const config = loadSource('lib/viewer-config.ts');
const backgroundMotion = loadSource('lib/background-motion.ts');
const packageMotion = loadSource('lib/viewer/package-motion.ts');
const publicUrls = loadSource('lib/public-url.ts');

test('public asset URLs support repository paths without double prefixes or changing external URLs', () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink';
    assert.equal(publicUrls.publicUrl('/models/cans/can-330.glb?v=123'), '/HyperDrink/models/cans/can-330.glb?v=123');
    assert.equal(publicUrls.publicUrl('/HyperDrink/decoders/draco/'), '/HyperDrink/decoders/draco/');
    for (const url of ['https://cdn.example/model.glb', '//cdn.example/image.png', 'data:image/png;base64,abc']) assert.equal(publicUrls.publicUrl(url), url);
    process.env.NEXT_PUBLIC_BASE_PATH = '';
    assert.equal(publicUrls.publicUrl('/environments/studio.exr'), '/environments/studio.exr');
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});

test('package curves provide an upright lid view and a continuously moving entrance and rebound', () => {
  const motion = config.DEFAULT_VIEWER_PRESENTATION.motion;
  const { packageTilt, packageAnticipationScale, packageInSeconds, packageBounceSeconds, packageBounceAmount } = motion;
  const cap = packageMotion.packageCapPose(packageTilt);
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), packageTilt);
  assert.ok(cap.angleTo(expected) < 1e-7, 'Lid pose is an absolute X rotation, independent of idle yaw and roll');
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cap);
  const lidNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(cap);
  assert.ok(right.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-10, 'Lid view has no sideways roll or yaw');
  assert.ok(Math.abs(lidNormal.x) < 1e-10 && lidNormal.z > 0.9, 'Lid faces the camera and stays centered');

  const exit = [0, 0.25, 0.5, 0.75, 1].map(packageMotion.packageExitProgress);
  const entrance = [0, 0.25, 0.5, 0.75, 1].map(packageMotion.packageSpinProgress);
  for (let index = 1; index < 4; index += 1) {
    assert.ok(exit[index + 1] - exit[index] > exit[index] - exit[index - 1], 'Exit accelerates instead of stopping at shrink end');
    assert.ok(entrance[index + 1] - entrance[index] < entrance[index] - entrance[index - 1], 'Entrance spin slows toward idle');
  }
  const scale = (elapsed) => packageMotion.packageEntryScale(elapsed, 0.01, motion);
  const total = packageInSeconds + packageBounceSeconds;
  assert.equal(scale(0), 0.01);
  assert.equal(scale(packageInSeconds), 1);
  assert.equal(scale(total), 1, 'Entrance and rebound finish exactly at rest');
  const crest = scale(packageInSeconds + packageBounceSeconds * 0.24);
  const trough = scale(packageInSeconds + packageBounceSeconds * 0.58);
  const finalCrest = scale(packageInSeconds + packageBounceSeconds * 0.82);
  assert.ok(Math.abs(crest - (1 + packageBounceAmount)) < 1e-12, 'Configured amplitude is the exact crest');
  assert.ok(Math.abs(crest - 1.15) < 1e-12, 'Default crest is visibly stronger at 15%');
  assert.ok(trough > 0.94 && trough < 0.96, 'Crest has a restrained five-percent recoil');
  assert.ok(finalCrest > 1.01 && finalCrest < 1.03, 'Smaller final crest settles the rebound');
  assert.equal(packageMotion.packageMaximumScale(packageAnticipationScale, packageBounceAmount), Math.max(packageAnticipationScale, crest), 'Camera headroom is exact and does not depend on peak sampling');

  const epsilon = 1e-6;
  const leftVelocity = (scale(packageInSeconds) - scale(packageInSeconds - epsilon)) / epsilon;
  const rightVelocity = (scale(packageInSeconds + epsilon) - scale(packageInSeconds)) / epsilon;
  assert.ok(leftVelocity > 1.9 && leftVelocity < 2.0, 'Zoom carries positive momentum through resting scale');
  assert.ok(Math.abs(leftVelocity - rightVelocity) < 0.00001, 'No velocity discontinuity between zoom and overshoot');
  const leftAcceleration = (scale(packageInSeconds) - 2 * scale(packageInSeconds - epsilon) + scale(packageInSeconds - 2 * epsilon)) / (epsilon * epsilon);
  const rightAcceleration = (scale(packageInSeconds + 2 * epsilon) - 2 * scale(packageInSeconds + epsilon) + scale(packageInSeconds)) / (epsilon * epsilon);
  assert.ok(Math.abs(leftAcceleration) < 0.05 && Math.abs(rightAcceleration) < 0.05, 'Both sides join with zero acceleration');
  assert.ok(Math.abs((scale(epsilon) - scale(0)) / epsilon) < 0.001, 'Entrance starts at rest');
  assert.ok(Math.abs((scale(total) - scale(total - epsilon)) / epsilon) < 0.001, 'Rebound settles at zero velocity');
});

test('continuous package scale stays bounded across admin timings, amplitudes, damping and failure recovery', () => {
  const defaults = config.DEFAULT_VIEWER_PRESENTATION.motion;
  for (const entrance of [0.1, 0.5, 2]) for (const bounce of [0.2, 0.48, 1]) {
    for (const amount of [0, 0.001, 0.15, 0.2]) for (const damping of [0.6, 0.66, 0.9]) {
      for (const inScale of [0.01, 1, 1.1]) {
        const motion = { ...defaults, packageInSeconds: entrance, packageBounceSeconds: bounce,
          packageBounceAmount: amount, packageSpringDamping: damping };
        const total = amount ? entrance + bounce : entrance;
        const maximum = Math.max(inScale, 1 + amount);
        const minimum = Math.min(inScale, 1 - amount * 0.41);
        let previous = inScale;
        for (let step = 0; step <= 1000; step += 1) {
          const elapsed = total * step / 1000;
          const scale = packageMotion.packageEntryScale(elapsed, inScale, motion);
          assert.ok(Number.isFinite(scale) && scale >= minimum - 1e-12 && scale <= maximum + 1e-12, 'Allowed settings cannot create negative scale or exceed reserved headroom');
          if (elapsed <= entrance) {
            assert.ok(inScale <= 1 ? scale >= previous - 1e-12 : scale <= previous + 1e-12, 'Incoming growth or failed-load recovery stays monotonic before crossing scale 1');
          }
          previous = scale;
        }
        assert.equal(packageMotion.packageEntryScale(-1, inScale, motion), inScale);
        assert.ok(Math.abs(packageMotion.packageEntryScale(total, inScale, motion) - 1) < 1e-12);
        assert.equal(packageMotion.packageEntryScale(total + 1, inScale, motion), 1);
        if (amount && inScale < 1) {
          const epsilon = Math.min(entrance, bounce * 0.24) * 0.0001;
          const atBoundary = packageMotion.packageEntryScale(entrance, inScale, motion);
          const left = (atBoundary - packageMotion.packageEntryScale(entrance - epsilon, inScale, motion)) / epsilon;
          const right = (packageMotion.packageEntryScale(entrance + epsilon, inScale, motion) - atBoundary) / epsilon;
          assert.ok(left > 0 && right > 0, 'Every enabled rebound crosses scale 1 without stopping');
          assert.ok(Math.abs(left - right) < Math.max(left * 0.001, 0.00001), 'Velocity continuity survives wide duration ratios and tiny amplitudes');
        }
      }
    }
  }
});

test('presentation preserves bounce defaults and bounds persisted motion settings', () => {
  const defaults = config.resolveViewerPresentation({ motion: { packageInSeconds: 0.5 } }).motion;
  assert.equal(defaults.packageBounceSeconds, 0.48, 'Older saved configurations receive the rebound defaults');
  assert.equal(defaults.packageBounceAmount, 0.15);
  const minimum = config.resolveViewerPresentation({ motion: { packageBounceSeconds: -1, packageBounceAmount: -1, packageSpringDamping: -1 } }).motion;
  assert.equal(minimum.packageBounceSeconds, 0.2);
  assert.equal(minimum.packageBounceAmount, 0);
  assert.equal(minimum.packageSpringDamping, 0.6);
  const maximum = config.resolveViewerPresentation({ motion: { packageBounceSeconds: 9, packageBounceAmount: 9, packageSpringDamping: 9 } }).motion;
  assert.equal(maximum.packageBounceSeconds, 1);
  assert.equal(maximum.packageBounceAmount, 0.2);
  assert.equal(maximum.packageSpringDamping, 0.9);
  const invalid = config.resolveViewerPresentation({ motion: { packageBounceSeconds: NaN, packageBounceAmount: Infinity } }).motion;
  assert.equal(invalid.packageBounceSeconds, defaults.packageBounceSeconds);
  assert.equal(invalid.packageBounceAmount, defaults.packageBounceAmount);
});

test('background velocity has one speed at every noncentral pointer position', () => {
  const speed = 24;
  const near = backgroundMotion.backgroundPointerVelocity(0.00001, 0.00002, speed);
  const far = backgroundMotion.backgroundPointerVelocity(0.4, 0.8, speed);
  assert.ok(Math.abs(near.x - far.x) < 1e-10);
  assert.ok(Math.abs(near.y - far.y) < 1e-10);
  for (const [x, y] of [[1, 0], [0, -1], [-0.1, 0.3], [0.8, 0.8]]) {
    const velocity = backgroundMotion.backgroundPointerVelocity(x, y, speed);
    assert.ok(Math.abs(Math.hypot(velocity.x, velocity.y) - speed) < 1e-10);
    assert.ok(Math.abs(velocity.x * y - velocity.y * x) < 1e-10, 'Pointer controls direction only');
  }
  assert.deepEqual(backgroundMotion.backgroundPointerVelocity(0, 0, speed), { x: 0, y: 0 });
});

test('camera keeps varied packages inside the viewport during upright lid turns and peak anticipation/rebound', () => {
  let seed = 90130;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let checked = 0;
  let maximumNdc = 0;
  for (let packageIndex = 0; packageIndex < 120; packageIndex += 1) {
    const dimensions = new THREE.Vector3(
      0.035 + random() * 0.13,
      0.055 + random() * 0.26,
      0.02 + random() * 0.10,
    );
    const bounds = new THREE.Box3(dimensions.clone().multiplyScalar(-0.5), dimensions.clone().multiplyScalar(0.5));
    const radius = dimensions.length() / 2;
    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
    const target = new THREE.Vector3((random() - 0.5) * radius * 0.1, (random() - 0.5) * radius * 0.1, 0);
    const aspect = 0.45 + random() * 1.2;
    const { fov, fill } = config.DEFAULT_VIEWER_PRESENTATION.camera;
    const rocking = config.DEFAULT_VIEWER_PRESENTATION.motion.rocking;
    const capTilt = config.DEFAULT_VIEWER_PRESENTATION.motion.packageTilt;
    const cap = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), capTilt);
    const damping = [0.6, 0.66, 0.9][packageIndex % 3];
    const anticipationScale = packageIndex % 2 ? 1.06 : 1.12;
    const bounceAmount = packageIndex % 2 ? 0.15 : 0.2;
    const maximumScale = packageMotion.packageMaximumScale(anticipationScale, bounceAmount);
    const motion = { ...config.DEFAULT_VIEWER_PRESENTATION.motion, packageBounceAmount: bounceAmount, packageSpringDamping: damping };
    const actualMaximumScale = Math.max(anticipationScale,
      packageMotion.packageEntryScale(motion.packageInSeconds + motion.packageBounceSeconds * 0.24, 0.01, motion));
    const distance = framing.fitProductCamera(bounds, rest, aspect, fov, fill, rocking, target, radius, capTilt, maximumScale);
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.0001, 10);
    camera.position.set(target.x, target.y, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();

    // Test random continuous angles instead of repeating the solver's 24 samples.
    for (let rotation = 0; rotation < 400; rotation += 1) {
      const orientation = rest.clone().slerp(cap, rotation % 5 === 0 ? 1 : rotation % 2 ? random() : 0)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2));
      orientation.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (random() * 2 - 1) * rocking, 0, (random() * 2 - 1) * rocking,
      )));
      const lift = random() * radius * 0.055;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const point = new THREE.Vector3(x, y, z).multiplyScalar(actualMaximumScale).applyQuaternion(orientation);
            point.y += lift;
            // The actual Three.js camera projection is the independent oracle.
            point.project(camera);
            const ndc = Math.max(Math.abs(point.x), Math.abs(point.y));
            maximumNdc = Math.max(maximumNdc, ndc);
            checked += 1;
            assert.ok(ndc <= 1, `Package ${packageIndex} clips the viewport at ${ndc}`);
            assert.ok(point.z >= -1 && point.z <= 1, 'Package is outside camera near/far planes');
          }
        }
      }
    }
  }
  assert.equal(checked, 384000);
  assert.ok(maximumNdc <= config.DEFAULT_VIEWER_PRESENTATION.camera.fill + 0.015, 'Framing lost its requested edge clearance');
});

function runtimeFixture(context, immediateAppearance = false) {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
  };
  const geometryRequests = [];
  const appearanceRequests = [];
  const statuses = [];
  const environment = deferred();
  const motionListeners = new Set();
  let productsDisposed = 0;
  const renderers = [];
  let viewer;

  // Replace browser/GPU boundaries only. Scene graph, quaternions, camera,
  // framing and the runtime selection/lifecycle code remain real production code.
  const canvas = {
    style: {}, tabIndex: 0,
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {},
    setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 700 }; },
  };
  class Renderer {
    constructor() { this.domElement = canvas; renderers.push(this); }
    setClearColor() {} setPixelRatio() {} setSize() {} dispose() {}
    setAnimationLoop(frame) { this.frame = frame; }
    render(scene, camera) { this.scene = scene; this.camera = camera; scene.updateMatrixWorld(); camera.updateMatrixWorld(); }
  }
  class PMREM {
    compileEquirectangularShader() {} dispose() {}
    fromEquirectangular() { return { texture: new THREE.Texture(), dispose() {} }; }
  }
  class GltfLoader {
    setMeshoptDecoder() { return this; } setDRACOLoader() { return this; } setKTX2Loader() { return this; }
    loadAsync(src) { const request = deferred(); geometryRequests.push({ src, ...request }); return request.promise; }
  }
  class ExrLoader { loadAsync() { return environment.promise; } }
  class Decoder {
    setDecoderPath() { return this; } setTranscoderPath() { return this; }
    setWorkerLimit() { return this; } detectSupport() { return this; } dispose() {}
  }
  const originalGlobals = new Map(['window', 'document', 'ResizeObserver', 'IntersectionObserver', 'performance'].map((key) => [key, global[key]]));
  // The browser clock and RAF timestamps share one deterministic origin.
  let frameTime = 0;
  global.performance = { now: () => frameTime };
  global.window = {
    devicePixelRatio: 1, innerWidth: 1440,
    matchMedia() { return { matches: false, addEventListener(_type, listener) { motionListeners.add(listener); },
      removeEventListener(_type, listener) { motionListeners.delete(listener); } }; },
  };
  global.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  context.after(() => {
    viewer?.dispose();
    for (const [key, value] of originalGlobals) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  });
  const runtime = loadSource('lib/viewer/runtime.ts', (name) => {
    if (name === '../public-url') return publicUrls;
    if (name === 'three') return { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM };
    if (name.includes('GLTFLoader')) return { GLTFLoader: GltfLoader };
    if (name.includes('EXRLoader')) return { EXRLoader: ExrLoader };
    if (name.includes('HDRLoader')) return { HDRLoader: ExrLoader };
    if (name.includes('DRACOLoader')) return { DRACOLoader: Decoder };
    if (name.includes('KTX2Loader')) return { KTX2Loader: Decoder };
    if (name.includes('meshopt_decoder')) return { MeshoptDecoder: {} };
    if (name.endsWith('viewer-config')) return config;
    if (name === './framing') return framing;
    if (name === './package-motion') return packageMotion;
    if (name === './appearance') return {
      createAppearanceHandle(root, asset) {
        return {
          apply(value) {
            if (immediateAppearance) return Promise.resolve();
            const request = deferred();
            appearanceRequests.push({ assetId: asset.id, value, ...request });
            return request.promise;
          },
          dispose() {},
        };
      },
      disposeProduct() { productsDisposed += 1; },
    };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  });
  const mount = { clientWidth: 500, clientHeight: 700, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {} };
  viewer = runtime.createProductViewer(mount, config.DEFAULT_VIEWER_PRESENTATION, (status) => statuses.push(status));
  const model = (height = 0.115) => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.065, height, 0.065), new THREE.MeshPhysicalMaterial()));
    return { scene };
  };
  const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
  const asset = (id) => ({ id, name: id.toUpperCase(), src: `/${id}.glb`, packaging: 'can' });
  const advance = (seconds) => {
    for (let frame = 0; frame < Math.round(seconds * 120); frame += 1) {
      frameTime += 1000 / 120;
      renderers[0].frame(frameTime);
    }
  };
  return { viewer, mount, renderer: renderers[0], geometryRequests, appearanceRequests, environment, statuses,
    model, asset, flush, advance, setReducedMotion: (matches) => motionListeners.forEach((listener) => listener({ matches })),
    disposedCount: () => productsDisposed };
}

test('runtime resolves selection races, preserves loading state, respects pause and disposes late loads', async (context) => {
  const { viewer, mount, geometryRequests, appearanceRequests, environment, statuses, model, asset, flush, disposedCount } = runtimeFixture(context);

  viewer.select(asset('a'), { id: 'red' });
  geometryRequests[0].resolve(model());
  await flush();
  assert.equal(appearanceRequests[0].value.id, 'red');
  viewer.select(asset('a'), { id: 'blue' });
  appearanceRequests[0].resolve();
  await flush();
  assert.equal(appearanceRequests[1].value.id, 'blue', 'Latest appearance must be reapplied before activation');
  assert.equal(statuses.at(-1).phase, 'loading', 'Outdated appearance must not complete loading');
  appearanceRequests[1].resolve();
  await flush();
  assert.equal(mount.dataset.productId, 'a');
  assert.equal(statuses.at(-1).phase, 'ready');

  viewer.pause(true);
  viewer.select(asset('b'), { id: 'green' });
  assert.equal(statuses.at(-1).phase, 'loading');
  environment.resolve(new THREE.Texture());
  await flush();
  assert.equal(statuses.at(-1).assetId, 'b');
  assert.equal(statuses.at(-1).environmentReady, true);
  assert.equal(statuses.at(-1).phase, 'loading', 'HDRI must not announce an unfinished asset as ready');
  geometryRequests[1].resolve(model());
  await flush();
  appearanceRequests[2].resolve();
  await flush();
  // No animation frame has run: a paused switch must activate synchronously.
  assert.equal(mount.dataset.productId, 'b');
  assert.equal(statuses.at(-1).phase, 'ready');

  viewer.select(asset('c'));
  viewer.dispose();
  geometryRequests[2].resolve(model());
  await flush();
  assert.equal(statuses.at(-1).phase, 'loading', 'Disposed viewer must not publish a late ready status');
  assert.ok(disposedCount() >= 3, 'Active, outgoing and late-loading product resources must be released');
});

test('packaging grows continuously into a visible upright rebound without a camera jump', async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('short'));
  geometryRequests[0].resolve(model(0.08)); await flush(); advance(0.05);
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  const outgoingDistance = renderer.camera.position.z;
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
  const cap = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), config.DEFAULT_VIEWER_PRESENTATION.motion.packageTilt);

  viewer.select(asset('tall'));
  geometryRequests[1].resolve(model(0.18)); await flush();
  assert.equal(mount.dataset.transitionPhase, 'package-aim');
  // Cross the phase boundary by one RAF tick, avoiding floating-point equality.
  advance(0.3 + 1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'package-anticipate');
  assert.ok(product.quaternion.angleTo(cap) < 1e-7, 'Aim must present the lid without inheriting idle yaw or roll');
  assert.equal(product.scale.x, 1);
  assert.ok(Math.abs(renderer.camera.position.z - outgoingDistance) < 1e-12, 'Decoded incoming model cannot refit the outgoing camera');
  advance(0.06);
  assert.equal(mount.dataset.transitionPhase, 'package-anticipate');
  assert.ok(product.scale.x > 1.02 && product.scale.x < 1.045, 'Visible small growth provides anticipation before launch');
  assert.equal(product.visible, true);
  for (let tick = 0; tick < 12 && mount.dataset.transitionPhase === 'package-anticipate'; tick += 1) advance(1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'package-out');
  assert.ok(Math.abs(product.scale.x - 1.06) < 1e-10, 'Anticipation lands at the configured launch scale');
  const launchScale = product.scale.x;
  const launchPose = product.quaternion.clone();
  advance(0.1);
  const firstExitScale = product.scale.x;
  const firstExitPose = product.quaternion.clone();
  advance(0.1);
  const secondExitScale = product.scale.x;
  assert.ok(firstExitScale - secondExitScale > (launchScale - firstExitScale) * 3, 'Equal time intervals produce increasing shrink speed');
  assert.ok(firstExitPose.angleTo(product.quaternion) > launchPose.angleTo(firstExitPose) * 3, 'Rotation accelerates along with shrink');
  assert.ok(product.scale.x > 0.88 && product.scale.x < 0.95, 'Exit retains size early, then contracts rapidly');
  assert.equal(mount.dataset.productId, 'short');
  assert.ok(Math.abs(renderer.camera.position.z - outgoingDistance) < 1e-12);
  advance(0.2 + 1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'package-hold');
  assert.ok(Math.abs(product.scale.x - 0.01) < 1e-10, 'Outgoing scale is exactly 1/100');
  assert.equal(product.visible, false);
  advance(0.1);
  assert.equal(mount.dataset.productId, 'short', 'No swap before the full hidden gap');
  advance(0.1 + 1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'package-in');
  assert.equal(mount.dataset.productId, 'tall');
  assert.ok(renderer.camera.position.z > outgoingDistance * 1.25, 'Different package dimensions refit only in the hidden gap');
  const incomingDistance = renderer.camera.position.z;
  const entranceScales = [];
  const bounceScales = [];
  const entryScales = [];
  for (let frame = 0; frame < 125; frame += 1) {
    advance(1 / 120);
    if (['package-in', 'package-bounce'].includes(mount.dataset.transitionPhase)) entryScales.push(product.scale.x);
    if (mount.dataset.transitionPhase === 'package-in') entranceScales.push(product.scale.x);
    if (mount.dataset.transitionPhase === 'package-bounce') {
      bounceScales.push(product.scale.x);
      assert.ok(product.quaternion.angleTo(rest) < 1e-7, 'Scale rebound is shown only after pose and spin reach idle');
    }
    assert.ok(Math.abs(renderer.camera.position.z - incomingDistance) < 1e-12, 'Incoming camera must stay fixed during growth and rebound');
  }
  assert.ok(entranceScales.length >= 55, 'Entrance retains the configured half-second timing');
  assert.ok(entranceScales.every((value, index) => value <= 1 && (index === 0 || value >= entranceScales[index - 1])), 'Entrance growth is monotonic up to the resting scale');
  assert.ok(bounceScales.length >= 55, 'Rebound remains visible while the pose stays upright');
  const crossingIndex = entryScales.findIndex((value) => value >= 1);
  assert.ok(crossingIndex > 0 && crossingIndex + 1 < entryScales.length);
  const beforeCrossing = entryScales[crossingIndex] - entryScales[crossingIndex - 1];
  const afterCrossing = entryScales[crossingIndex + 1] - entryScales[crossingIndex];
  assert.ok(beforeCrossing > 0.005 && afterCrossing > 0.005, 'Visible frames keep growing through scale 1 instead of pausing before the crest');
  assert.ok(Math.abs(beforeCrossing - afterCrossing) < 0.004, 'Crossing scale speed is continuous at frame boundaries');
  const bouncePeak = Math.max(...bounceScales);
  const peakIndex = bounceScales.indexOf(bouncePeak);
  assert.ok(bouncePeak > 1.148 && bouncePeak <= 1.15, 'Runtime visibly expands approximately 15% after reaching idle');
  assert.ok(Math.min(...bounceScales.slice(peakIndex)) > 0.94 && Math.min(...bounceScales.slice(peakIndex)) < 0.96, 'Runtime shows a restrained five-percent contraction after the crest');
  assert.ok(Math.max(...bounceScales.slice(Math.ceil(bounceScales.length * 2 / 3))) > 1, 'Runtime shows the smaller final rebound before rest');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.scale.x, 1);
  assert.equal(product.visible, true);
  assert.ok(product.quaternion.angleTo(rest) < 0.025, 'Incoming motion returns directly to default idle');

  const motion = config.resolveViewerPresentation({ motion: { transitionSeconds: 1.65 / 2.5, settleSeconds: 1.15 / 2.5 } }).motion;
  assert.ok(Math.abs(motion.transitionSeconds - 0.66) < 1e-10, 'Normalization must preserve the faster flavor timing');
  viewer.select(asset('tall'), { id: 'lime' });
  assert.equal(mount.dataset.transitionPhase, 'flavor');
  advance(0.6);
  assert.equal(mount.dataset.transitionPhase, 'flavor');
  advance(0.075);
  assert.equal(mount.dataset.transitionPhase, 'idle', 'Flavor spin completes within 0.66s');
});

for (const interruptionPhase of ['in', 'bounce']) test(`reselection during ${interruptionPhase} preserves visible pose and scale without compounding anticipation`, async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('a')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  viewer.select(asset('b')); geometryRequests[1].resolve(model(0.18)); await flush();
  advance(1.05);
  assert.equal(mount.dataset.transitionPhase, 'package-in');
  if (interruptionPhase === 'bounce') {
    advance(0.55);
    assert.equal(mount.dataset.transitionPhase, 'package-bounce');
    assert.ok(product.scale.x > 1.08, 'Interrupt at the visible upright rebound crest');
  } else {
    advance(0.15);
    assert.ok(product.scale.x > 0.1 && product.scale.x < 0.5, 'Interrupt while the incoming model is still growing');
  }
  const visibleScale = product.scale.x;
  const visiblePose = product.quaternion.clone();
  const visibleDistance = renderer.camera.position.z;
  viewer.select(asset('c'));
  assert.equal(mount.dataset.transitionPhase, 'package-aim');
  assert.equal(product.scale.x, visibleScale, 'New choice must not snap an incoming scale back to 1');
  assert.ok(product.quaternion.angleTo(visiblePose) < 1e-7, 'New choice starts from the exact visible orientation');
  geometryRequests[2].resolve(model(0.08)); await flush();
  const maximumScale = packageMotion.packageMaximumScale(
    config.DEFAULT_VIEWER_PRESENTATION.motion.packageAnticipationScale,
    config.DEFAULT_VIEWER_PRESENTATION.motion.packageBounceAmount,
  );
  for (let frame = 0; frame < 260; frame += 1) {
    advance(1 / 120);
    assert.ok(product.scale.x <= maximumScale + 0.0001, 'Repeated choices cannot multiply the anticipation scale');
    if (mount.dataset.productId === 'b') assert.ok(Math.abs(renderer.camera.position.z - visibleDistance) < 1e-12, 'Incoming geometry cannot perturb the visible outgoing camera');
  }
  assert.equal(mount.dataset.productId, 'c');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.scale.x, 1);
  assert.equal(product.visible, true);
});

test('packaging holds for a slow latest selection and restores the old package on load failure', async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, flush, advance, statuses } = runtimeFixture(context, true);
  viewer.select(asset('a')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  viewer.select(asset('b')); advance(0.35);
  viewer.select(asset('c'));
  geometryRequests[1].resolve(model(0.18)); await flush();
  advance(0.75);
  assert.equal(mount.dataset.transitionPhase, 'package-hold');
  assert.equal(mount.dataset.productId, 'a', 'Stale package cannot replace the latest selection');
  assert.equal(product.visible, false);
  geometryRequests[2].resolve(model(0.08)); await flush(); advance(1 / 120);
  assert.equal(mount.dataset.productId, 'c');
  advance(1.05);
  assert.equal(mount.dataset.transitionPhase, 'idle');
  viewer.select(asset('missing')); advance(0.9);
  geometryRequests[3].reject(new Error('Missing model')); await flush(); advance(1.05);
  assert.equal(mount.dataset.productId, 'c');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.visible, true);
  assert.equal(product.scale.x, 1);
  assert.equal(statuses.at(-1).phase, 'error');
});

test('reduced motion interrupts rebound safely and zero amplitude skips the rebound duration', async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, flush, advance, setReducedMotion } = runtimeFixture(context, true);
  viewer.select(asset('a')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
  viewer.select(asset('b')); geometryRequests[1].resolve(model(0.18)); await flush(); advance(1.65);
  assert.equal(mount.dataset.transitionPhase, 'package-bounce');
  assert.ok(product.scale.x > 1.1);
  setReducedMotion(true); advance(1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.scale.x, 1, 'Reduced motion clears overshoot immediately');
  assert.ok(product.quaternion.angleTo(rest) < 1e-7);
  viewer.select(asset('c')); geometryRequests[2].resolve(model(0.08)); await flush();
  assert.equal(mount.dataset.productId, 'c', 'Reduced motion activates decoded geometry without a timed animation');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  setReducedMotion(false);
  viewer.configure({ ...config.DEFAULT_VIEWER_PRESENTATION,
    motion: { ...config.DEFAULT_VIEWER_PRESENTATION.motion, packageBounceAmount: 0 } });
  viewer.select(asset('d')); geometryRequests[3].resolve(model()); await flush();
  const phases = [];
  for (let frame = 0; frame < 188; frame += 1) {
    advance(1 / 120); phases.push(mount.dataset.transitionPhase);
    assert.ok(product.scale.x <= 1.06 + 1e-12, 'Disabled rebound keeps only the anticipation scale');
  }
  assert.equal(mount.dataset.productId, 'd');
  assert.equal(mount.dataset.transitionPhase, 'idle', 'Zero amplitude finishes at entrance end, without spending the unused rebound duration');
  assert.ok(phases.includes('package-in') && !phases.includes('package-bounce'));
  assert.equal(product.scale.x, 1);
});
