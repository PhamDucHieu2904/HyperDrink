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
const environments = loadSource('lib/viewer/environment.ts');
const backgrounds = loadSource('lib/background-config.ts', name => name === './showcase-flavors'
  ? loadSource('lib/showcase-flavors.ts') : require(name));
const backgroundRender = loadSource('lib/background-render-state.ts', name => name === './background-config' ? backgrounds : require(name));
const hitRegions = loadSource('lib/viewer/product-hit-region.ts');

// CSS uses nonzero winding. Check the generated boundary independently against real raycasts.
function insidePath(cssPath, x, y) {
  let winding = 0;
  for (const section of cssPath.match(/M[^Z]+Z/g) ?? []) {
    const points = [...section.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
  }
  return winding !== 0;
}

test('real product silhouette excludes blank corners and holes instead of claiming the bounding rectangle', () => {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.z = 6; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.3, 24, 60), new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  const silhouette = new hitRegions.ProductSilhouette();
  const path = silhouette.project([mesh], camera, 400, 400);
  const ray = new THREE.Raycaster();
  for (const [x, y] of [[200, 200], [300, 200], [10, 10], [200, 300], [320, 320]]) {
    ray.setFromCamera(new THREE.Vector2(x / 200 - 1, 1 - y / 200), camera);
    assert.equal(insidePath(path, x, y), hitRegions.hitVisibleProduct(ray, [mesh]), `Silhouette disagrees at ${x},${y}`);
  }
  assert.equal(insidePath(path, 200, 200), false, 'A hole remains scrollable');
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  box.rotation.set(0.4, 0.6, 0); box.updateMatrixWorld();
  assert.equal(insidePath(silhouette.project([box], camera, 400, 400), 200, 200), true,
    'Scalar materials apply to all geometry groups, including the front group');
  const mirrored = box.clone(); mirrored.scale.x = -1; mirrored.updateMatrixWorld();
  assert.equal(insidePath(silhouette.project([box, mirrored], camera, 400, 400), 200, 200), true,
    'A mirrored overlapping mesh must not cancel the visible model hit region');
});

test('hit routing respects hidden ancestors and materials and excludes scene decorations', () => {
  const scene = new THREE.Scene(), root = new THREE.Group(), hiddenGroup = new THREE.Group();
  const visible = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const hidden = visible.clone(); hidden.position.x = 2; hiddenGroup.add(hidden); hiddenGroup.visible = false;
  const transparent = visible.clone(); transparent.position.x = -2; transparent.material = new THREE.MeshBasicMaterial({ opacity: 0 });
  const decoration = visible.clone(); decoration.scale.setScalar(20); scene.add(decoration);
  root.add(visible, hiddenGroup, transparent); scene.add(root); scene.updateMatrixWorld();
  assert.deepEqual(hitRegions.visibleProductMeshes(root), [visible]);
  root.visible = false;
  assert.deepEqual(hitRegions.visibleProductMeshes(visible), [], 'Hidden parent cancels even an individually visible mesh');
  root.visible = true; visible.material.visible = false;
  assert.deepEqual(hitRegions.visibleProductMeshes(root), []);
});

test('projection clips the frustum safely and updates after a material or draw-range change', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10); camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const silhouette = new hitRegions.ProductSilhouette();
  mesh.position.z = 2; mesh.updateMatrixWorld();
  assert.equal(silhouette.project([mesh], camera, 400, 400), '', 'Behind-camera geometry cannot own a touch region');
  mesh.position.z = -0.2; mesh.rotation.y = 0.3; mesh.updateMatrixWorld();
  const path = silhouette.project([mesh], camera, 400, 400);
  assert.ok(!path.includes('NaN') && !path.includes('Infinity'));
  for (const match of path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
    assert.ok(Number(match[1]) >= 0 && Number(match[1]) <= 400);
    assert.ok(Number(match[2]) >= 0 && Number(match[2]) <= 400);
  }
  mesh.position.z = -2; mesh.updateMatrixWorld();
  assert.ok(silhouette.project([mesh], camera, 400, 400));
  mesh.geometry.setDrawRange(0, 0);
  assert.equal(silhouette.project([mesh], camera, 400, 400), '');
});

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
  const crest = scale(packageInSeconds + packageBounceSeconds * 0.14);
  const trough = scale(packageInSeconds + packageBounceSeconds * 0.36);
  const secondCrest = scale(packageInSeconds + packageBounceSeconds * 0.57);
  const secondTrough = scale(packageInSeconds + packageBounceSeconds * 0.74);
  const finalCrest = scale(packageInSeconds + packageBounceSeconds * 0.87);
  assert.ok(Math.abs(crest - (1 + packageBounceAmount)) < 1e-12, 'Configured amplitude is the exact crest');
  assert.ok(Math.abs(crest - 1.2) < 1e-12, 'Default crest is visibly stronger at 20%');
  assert.ok(trough > 0.89 && trough < 0.91, 'First recoil preserves a visible spring response');
  assert.ok(secondCrest > 1.04 && secondCrest < 1.06, 'Second crest visibly rebounds before the extra pulse');
  assert.ok(secondTrough > 0.97 && secondTrough < 0.98, 'Extra rebound follows a smaller second contraction');
  assert.ok(finalCrest > 1.01 && finalCrest < 1.02, 'Third crest settles the added rebound');
  const entranceSamples = [0, 0.25, 0.5, 0.75, 1].map((t) => scale(packageInSeconds * t));
  for (let index = 1; index < 4; index += 1) {
    assert.ok(entranceSamples[index + 1] - entranceSamples[index] > entranceSamples[index] - entranceSamples[index - 1], 'Equal intervals grow from slow to fast for a more sudden appearance');
  }
  assert.ok(entranceSamples[2] < 0.13 && entranceSamples[3] < 0.46, 'Most visible growth happens late in the entrance');
  assert.ok(Math.abs(packageMotion.packageMaximumScale(packageAnticipationScale, packageBounceAmount) - Math.max(packageAnticipationScale, crest)) < 1e-12, 'Camera headroom is exact and does not depend on peak sampling');

  const epsilon = 1e-6;
  const leftVelocity = (scale(packageInSeconds) - scale(packageInSeconds - epsilon)) / epsilon;
  const rightVelocity = (scale(packageInSeconds + epsilon) - scale(packageInSeconds)) / epsilon;
  assert.ok(leftVelocity > 4.9 && leftVelocity < 5.0, 'Accelerating zoom carries stronger momentum directly into the 20% crest');
  assert.ok(Math.abs(leftVelocity - rightVelocity) < 0.00001, 'No velocity discontinuity between zoom and overshoot');
  const leftAcceleration = (scale(packageInSeconds) - 2 * scale(packageInSeconds - epsilon) + scale(packageInSeconds - 2 * epsilon)) / (epsilon * epsilon);
  const rightAcceleration = (scale(packageInSeconds + 2 * epsilon) - 2 * scale(packageInSeconds + epsilon) + scale(packageInSeconds)) / (epsilon * epsilon);
  assert.ok(Math.abs(leftAcceleration) < 0.05 && Math.abs(rightAcceleration) < 0.05, 'Both sides join with zero acceleration');
  assert.ok(Math.abs((scale(epsilon) - scale(0)) / epsilon) < 0.001, 'Entrance starts at rest');
  assert.ok(Math.abs((scale(total) - scale(total - epsilon)) / epsilon) < 0.001, 'Rebound settles at zero velocity');
});

test('continuous package scale stays bounded across admin timings, amplitudes, damping and failure recovery', () => {
  const defaults = config.DEFAULT_VIEWER_PRESENTATION.motion;
  for (const entrance of [0.1, 0.5, 2]) for (const bounce of [0.2, 0.7, 1]) {
    for (const amount of [0, 0.001, 0.15, 0.2]) for (const damping of [0.6, 0.66, 0.9]) {
      for (const inScale of [0.01, 1, 1.1]) {
        const motion = { ...defaults, packageInSeconds: entrance, packageBounceSeconds: bounce,
          packageBounceAmount: amount, packageSpringDamping: damping };
        const total = amount ? entrance + bounce : entrance;
        const maximum = Math.max(inScale, 1 + amount);
        const minimum = Math.min(inScale, 1 - amount * 0.59);
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
          const epsilon = Math.min(entrance, bounce * 0.14) * 0.0001;
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
  assert.equal(defaults.packageBounceSeconds, 0.7, 'Older saved configurations receive enough duration for the extra rebound');
  assert.equal(defaults.packageBounceAmount, 0.2);
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

test('persisted presentations retain supported tone mapping and safely upgrade older or invalid settings', () => {
  const previous = { schemaVersion: 1, exposure: 0.85, environment: { intensity: 0.7 } };
  const upgraded = config.resolveViewerPresentation(previous);
  assert.equal(upgraded.toneMapping, 'neutral', 'Existing saved presentations acquire the studio default without a migration');
  assert.equal(upgraded.exposure, previous.exposure);
  assert.equal(upgraded.environment.intensity, previous.environment.intensity);
  for (const toneMapping of ['neutral', 'agx', 'aces']) {
    const resolved = config.resolveViewerPresentation({ toneMapping });
    assert.equal(resolved.toneMapping, toneMapping);
    assert.deepEqual(config.resolveViewerPresentation(JSON.parse(JSON.stringify(resolved))), resolved, 'Admin settings survive a JSON round trip');
  }
  for (const toneMapping of [undefined, null, '', 'Neutral', 'linear', 4, {}, ['agx']]) {
    assert.equal(config.resolveViewerPresentation({ toneMapping }).toneMapping, 'neutral', 'Unrecognized saved values never reach the renderer');
  }
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
      packageMotion.packageEntryScale(motion.packageInSeconds + motion.packageBounceSeconds * 0.14, 0.01, motion));
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

function runtimeFixture(context, immediateAppearance = false, pixelRatio = 1, options = {}) {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
  };
  const geometryRequests = [];
  const appearanceRequests = [];
  const appearanceCalls = [];
  const disposedProducts = [];
  const accentFrames = [];
  const backdropResources = [];
  const backdropBindings = [];
  const waterPassResources = [];
  const renderEvents = [];
  const statuses = [];
  const environment = deferred();
  const motionListeners = new Set();
  let productsDisposed = 0;
  const renderers = [];
  const labelTextures = [];
  const idleCallbacks = new Map();
  let nextIdleId = 0;
  let viewer;
  if (options.controlledIdle) context.mock.timers.enable({ apis: ['setTimeout'] });

  // Replace browser/GPU boundaries only. Scene graph, quaternions, camera,
  // framing and the runtime selection/lifecycle code remain real production code.
  const domElement = () => ({
    style: {}, dataset: {}, listeners: new Map(), captures: new Set(), removed: false,
    setAttribute() {},
    addEventListener(type, listener) { const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries); },
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
    emit(type, event) { for (const listener of this.listeners.get(type) ?? []) listener({ button: 0, target: this, preventDefault() {}, ...event }); },
    remove() { this.removed = true; },
    setPointerCapture(id) { this.captures.add(id); }, hasPointerCapture(id) { return this.captures.has(id); }, releasePointerCapture(id) { this.captures.delete(id); },
  });
  const canvas = {
    ...domElement(), tabIndex: 0,
    getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 700 }; },
  };
  class Renderer {
    constructor() { this.domElement = canvas; this.info = { programs: [] }; this.resolutionTargets = new Set(); this.draws = []; this.warmedTextures = []; this.compiledRoots = []; this.asyncCompiledRoots = []; renderers.push(this); }
    setClearColor() {} dispose() {}
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) { this.width = width; this.height = height; }
    getDrawingBufferSize(target) {
      this.resolutionTargets.add(target);
      return target.set(Math.floor(this.width * this.pixelRatio), Math.floor(this.height * this.pixelRatio));
    }
    setAnimationLoop(frame) { this.frame = frame; }
    initTexture(texture) { this.warmedTextures.push(texture); }
    compile(root) {
      this.compiledRoots.push(root);
      const materials = new Set();
      root.traverse(node => {
        if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      });
      return materials;
    }
    compileAsync(root) {
      this.asyncCompiledRoots.push(root);
      return options.unfinishedAsyncCompile ? new Promise(() => {}) : Promise.resolve();
    }
    render(scene, camera) {
      this.scene = scene; this.camera = camera;
      this.draws.push({ scene, camera }); renderEvents.push({ type: 'main', scene, camera });
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
    }
  }
  class PMREM {
    compileEquirectangularShader() {} dispose() {}
    fromEquirectangular() { return { texture: new THREE.Texture(), dispose() {} }; }
  }
  class GltfLoader {
    setMeshoptDecoder() { return this; } setDRACOLoader() { return this; } setKTX2Loader() { return this; }
    setResourcePath(value) { this.resourcePath = value; return this; }
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
    devicePixelRatio: pixelRatio, innerWidth: 1440,
    matchMedia(query) { return { matches: query.includes('prefers-reduced-motion') && Boolean(options.reducedMotion), addEventListener(_type, listener) { motionListeners.add(listener); },
      removeEventListener(_type, listener) { motionListeners.delete(listener); } }; },
  };
  if (options.controlledIdle) {
    global.window.requestIdleCallback = callback => { const id = ++nextIdleId; idleCallbacks.set(id, callback); return id; };
    global.window.cancelIdleCallback = id => idleCallbacks.delete(id);
  }
  global.document = { hidden: false, createElement: domElement, addEventListener() {}, removeEventListener() {} };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  context.after(() => {
    viewer?.dispose();
    for (const [key, value] of originalGlobals) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  });
  const appearanceBoundary = {
    createAppearanceHandle(root, asset) {
      return {
        apply(value) {
          appearanceCalls.push({ root, assetId: asset.id, asset, value });
          if (immediateAppearance) {
            if (options.labelTextures && value?.slots?.label?.baseColorMap) {
              const texture = new THREE.Texture(); texture.name = value.id;
              labelTextures.push(texture);
              root.traverse(node => {
                if (!(node instanceof THREE.Mesh)) return;
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                const cloned = materials.map(original => { const material = original.clone(); material.map = texture; return material; });
                node.material = Array.isArray(node.material) ? cloned : cloned[0];
              });
            }
            return Promise.resolve();
          }
          const request = deferred();
          appearanceRequests.push({ assetId: asset.id, asset, value, ...request });
          return request.promise;
        },
        dispose() {},
      };
    },
    disposeProduct(root) { productsDisposed += 1; disposedProducts.push(root); },
  };
  const pooledAppearance = loadSource('lib/viewer/pooled-appearance.ts', name => {
    if (name === 'three') return THREE;
    if (name === './appearance') return appearanceBoundary;
    throw new Error(`Unexpected pooled appearance dependency: ${name}`);
  });
  const resourcePrefetch = loadSource('lib/viewer/resource-prefetch.ts', name => {
    if (name === '../public-url') return publicUrls;
    if (name === '../viewer-config') return config;
    throw new Error(`Unexpected resource prefetch dependency: ${name}`);
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
    if (name === './environment') return environments;
    if (name === './product-hit-region') return hitRegions;
    if (name === './pooled-appearance') return pooledAppearance;
    if (name === './resource-prefetch') return {
      // The real queue/lifetime implementation remains installed; this fixture
      // disables only its background network boundary, tested separately.
      createResourcePrefetcher: prefetchOptions => resourcePrefetch.createResourcePrefetcher({ ...prefetchOptions, allowBackground: () => Boolean(options.allowBackground) }),
    };
    if (name === './backdrop-texture') return {
      createBackdropTexture(state, config, mount) {
        const resource = { state, config, mount, texture: new THREE.Texture(), updates: 0, disposals: 0, paintNext: true };
        resource.update = () => {
          resource.updates += 1;
          if (resource.paintNext) { resource.texture.needsUpdate = true; resource.paintNext = false; }
        };
        resource.dispose = () => { resource.disposals += 1; resource.texture.dispose(); };
        backdropResources.push(resource);
        return resource;
      },
    };
    if (name === './water-backdrop-pass') return {
      createWaterBackdropPass(renderer, scene, product) {
        const resource = { renderer, scene, product, texture: new THREE.Texture(), renders: [], disposals: 0 };
        resource.render = (background, camera) => {
          resource.renders.push({ background, camera });
          renderEvents.push({ type: 'water-pass', resource, background, camera });
        };
        resource.dispose = () => { resource.disposals += 1; resource.texture.dispose(); };
        waterPassResources.push(resource);
        return resource;
      },
    };
    if (name === './accent-layer') return { createAccentLayer: () => ({
      configure() {},
      setBackdrop(texture) { backdropBindings.push(texture); },
      update(frame) { accentFrames.push(frame); return { phase: 'waiting', count: 0 }; },
      dispose() {},
    }) };
    if (name === './appearance') return appearanceBoundary;
    throw new Error(`Unexpected runtime dependency: ${name}`);
  });
  const classes = new Set();
  const mount = { ...domElement(), clientWidth: 500, clientHeight: 700, children: [],
    classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
    appendChild(child) { this.children.push(child); } };
  // This fixture deliberately exercises asynchronous HDRI loading races.
  viewer = runtime.createProductViewer(mount, config.resolveViewerPresentation({environment:{mode:'hdri'}}), (status) => statuses.push(status));
  const model = (height = 0.115) => {
    const scene = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial();
    if (options.importedTexture) material.roughnessMap = new THREE.Texture();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.065, height, 0.065), material));
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
  return { viewer, mount, canvas, hitRegion: mount.children.find(child => child.dataset.productHitRegion), renderer: renderers[0], geometryRequests, appearanceRequests, appearanceCalls, labelTextures, idleCallbacks, disposedProducts, accentFrames, backdropResources, backdropBindings, waterPassResources, renderEvents, environment, statuses,
    tickIdleTimers: milliseconds => context.mock.timers.tick(milliseconds),
    releaseIdle() { const next = idleCallbacks.entries().next().value; assert.ok(next, 'An idle task must actually be queued'); idleCallbacks.delete(next[0]); next[1]({ didTimeout: false, timeRemaining: () => 50 }); },
    advanceFrames(timestamps) { for (const timestamp of timestamps) { frameTime = timestamp; renderers[0].frame(frameTime); } },
    model, asset, flush, advance, setReducedMotion: (matches) => motionListeners.forEach((listener) => listener({ matches })),
    disposedCount: () => productsDisposed };
}

test('OS reduced motion does not disable idle spin, flavor turns, packaging transitions or accents', async context => {
  const f = runtimeFixture(context, true, 1, { reducedMotion: true });
  f.viewer.select(f.asset('can'), { id: 'orange' });
  f.geometryRequests[0].resolve(f.model()); await f.flush(); f.advance(0.05);
  const product = f.renderer.scene.children.find(node => node instanceof THREE.Group);
  const before = product.quaternion.clone(); f.advance(2);
  assert.ok(product.quaternion.angleTo(before) > 0.3, 'Idle spin starts without user input even with reduced motion enabled');
  f.setReducedMotion(false); f.setReducedMotion(true);
  const changed = product.quaternion.clone(); f.advance(1);
  assert.ok(product.quaternion.angleTo(changed) > 0.1, 'Changing the OS preference cannot freeze the product');
  f.viewer.select(f.asset('can'), { id: 'lime' }); await f.flush();
  assert.equal(f.mount.dataset.transitionPhase, 'flavor');
  f.advance(3); assert.equal(f.mount.dataset.appearanceId, 'lime');
  f.viewer.select(f.asset('tall'), { id: 'mango' });
  f.geometryRequests[1].resolve(f.model(0.18)); await f.flush();
  f.setReducedMotion(true); f.advance(0.2);
  assert.match(f.mount.dataset.transitionPhase, /^package-/);
  f.advance(3); assert.equal(f.mount.dataset.productId, 'tall');
  assert.equal(f.mount.dataset.transitionPhase, 'idle');
  assert.ok(f.accentFrames.every(frame => frame.reducedMotion === false), 'Decorative motion uses the same website policy');
  f.viewer.pause(true); f.advance(2); const paused = product.quaternion.toArray(); f.advance(1);
  assert.deepEqual(product.quaternion.toArray(), paused, 'Explicit viewer pause remains effective after an in-flight return settles');
});

test('60 Hz animation frames with ordinary timestamp jitter retain nearly every draw instead of falling to half the frame rate', async context => {
  const f = runtimeFixture(context, true);
  f.viewer.select(f.asset('can')); f.geometryRequests[0].resolve(f.model()); await f.flush();
  const timestamps = Array.from({ length: 120 }, (_, index) => (index + 1) * (1000 / 60) + 1 + (index % 2 ? 0.02 : 0.18));
  const before = f.renderer.draws.length;
  f.advanceFrames(timestamps);
  const draws = f.renderer.draws.length - before;
  assert.ok(draws >= 119, `Two seconds at 60 Hz should keep at least 119 draws; got ${draws}`);
  assert.ok(draws <= 120, 'A render loop must not create extra draws between animation frames');
});

test('blank mobile canvas preserves native vertical scrolling while only the projected can accepts rotation', async context => {
  const { viewer, mount, canvas, hitRegion, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('can')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  viewer.pause(true); advance(0.05);
  const product = renderer.scene.children.find(node => node instanceof THREE.Group);
  assert.equal(canvas.style.touchAction, 'pan-y pinch-zoom', 'Scroll permission is declared before touchstart');
  assert.equal(hitRegion.style.touchAction, 'none', 'Only the actual object surface owns the gesture');
  assert.equal(hitRegion.style.display, 'block');
  assert.ok(insidePath(hitRegion.style.clipPath, 250, 350));
  assert.equal(insidePath(hitRegion.style.clipPath, 10, 10), false);
  const before = product.quaternion.clone();
  let prevented = false;
  const event = { pointerId: 1, pointerType: 'touch', target: canvas, clientX: 10, clientY: 10, preventDefault() { prevented = true; } };
  mount.emit('pointerdown', event); mount.emit('pointermove', { ...event, clientY: 150 }); advance(0.1);
  assert.equal(canvas.captures.size, 0);
  assert.equal(mount.classList.contains('is-dragging'), false);
  assert.equal(prevented, false, 'Blank swipe is not prevented by JavaScript');
  assert.ok(product.quaternion.angleTo(before) < 1e-7);
  mount.emit('pointerdown', { ...event, target: hitRegion, clientX: 250, clientY: 350 });
  assert.equal(canvas.hasPointerCapture(1), true);
  assert.equal(mount.classList.contains('is-dragging'), true);
  mount.emit('pointermove', { ...event, clientX: 280, clientY: 370 }); advance(0.15);
  assert.ok(product.quaternion.angleTo(before) > 0.03, 'A can drag still rotates the real scene graph');
  mount.emit('pointercancel', event);
  assert.equal(canvas.captures.size, 0); assert.equal(mount.classList.contains('is-dragging'), false);
});

test('raycast rejects decorations and hidden geometry even if a stale touch target is delivered', async context => {
  const { viewer, mount, hitRegion, canvas, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('can')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  const product = renderer.scene.children.find(node => node instanceof THREE.Group);
  const decoration = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  renderer.scene.add(decoration);
  const touch = { target: hitRegion, pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 };
  mount.emit('pointerdown', touch);
  assert.equal(canvas.captures.size, 0, 'Scene accents are not part of model raycasts');
  product.children[0].visible = false;
  mount.emit('pointerdown', { ...touch, clientX: 250, clientY: 350 });
  assert.equal(canvas.captures.size, 0, 'A stale silhouette cannot accept a hidden mesh');
  advance(0.05); assert.equal(hitRegion.style.display, 'none');
  product.children[0].visible = true;
  let body; product.traverse(node => { if (node instanceof THREE.Mesh) body = node; });
  body.geometry.setDrawRange(0, 0); advance(0.1);
  assert.equal(hitRegion.style.display, 'none', 'Empty draw range invalidates the cached outline');
  body.geometry.setDrawRange(0, Infinity); advance(0.1);
  assert.equal(hitRegion.style.display, 'block', 'Restoring a draw range restores ownership without a resize');
  body.material.opacity = 0; advance(0.1); assert.equal(hitRegion.style.display, 'none');
  body.material.opacity = 1; advance(0.1); assert.equal(hitRegion.style.display, 'block');
});

test('touch capture transfer, multitouch cancellation, mouse and keyboard remain consistent and dispose releases ownership', async context => {
  const { viewer, mount, hitRegion, canvas, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('can')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  viewer.pause(true); advance(0.05);
  const product = renderer.scene.children.find(node => node instanceof THREE.Group);
  const touch = { target: hitRegion, pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 350 };
  mount.emit('pointerdown', touch);
  mount.emit('lostpointercapture', touch);
  assert.equal(mount.classList.contains('is-dragging'), true, 'Implicit capture transfer from the surface is not cancellation');
  mount.emit('pointerdown', { ...touch, pointerId: 2 });
  const beforeMulti = product.quaternion.clone();
  mount.emit('pointermove', { ...touch, clientX: 280 });
  mount.emit('pointermove', { ...touch, pointerId: 2, clientY: 380 }); advance(0.1);
  assert.ok(product.quaternion.angleTo(beforeMulti) < 1e-7, 'Two touches freeze product rotation');
  mount.emit('pointercancel', { ...touch, pointerId: 2 });
  assert.equal(canvas.hasPointerCapture(1), true); assert.equal(canvas.hasPointerCapture(2), false);
  mount.emit('pointermove', { ...touch, clientX: 282 }); advance(0.1);
  assert.ok(product.quaternion.angleTo(beforeMulti) < 0.025, 'Remaining touch uses its latest position without a multi-touch jump');
  mount.emit('lostpointercapture', { ...touch, target: canvas });
  assert.equal(mount.classList.contains('is-dragging'), false);
  const beforeMouse = product.quaternion.clone();
  mount.emit('pointerdown', { ...touch, target: canvas, pointerType: 'mouse', pointerId: 3 });
  mount.emit('pointermove', { ...touch, target: canvas, pointerType: 'mouse', pointerId: 3, clientX: 280 }); advance(0.1);
  assert.ok(product.quaternion.angleTo(beforeMouse) > 0.03);
  mount.emit('pointerup', { ...touch, pointerId: 3 });
  viewer.pause(false);
  const beforeKey = product.quaternion.clone(); let keyPrevented = false;
  canvas.emit('keydown', { key: 'ArrowRight', preventDefault() { keyPrevented = true; } }); advance(0.1);
  assert.equal(keyPrevented, true); assert.ok(product.quaternion.angleTo(beforeKey) > 0.02);
  mount.emit('pointerdown', touch);
  assert.equal(canvas.captures.size, 1);
  viewer.dispose();
  assert.equal(canvas.captures.size, 0); assert.equal(hitRegion.removed, true);
  assert.equal(hitRegion.style.display, 'none');
  assert.ok([...mount.listeners.values()].every(listeners => listeners.size === 0));
});

test('object hit region follows resize and hides while packaging changes or the required label fails', async context => {
  const { viewer, mount, hitRegion, geometryRequests, appearanceRequests, model, asset, flush, advance } = runtimeFixture(context);
  viewer.select(asset('can'), { id: 'valid', requiredSlots: ['label'] });
  geometryRequests[0].resolve(model()); await flush(); appearanceRequests[0].resolve(); await flush(); advance(0.05);
  const initialPath = hitRegion.style.clipPath;
  mount.clientWidth = 300; mount.clientHeight = 400;
  viewer.configure(config.DEFAULT_VIEWER_PRESENTATION); advance(0.05);
  assert.notEqual(hitRegion.style.clipPath, initialPath);
  assert.ok(insidePath(hitRegion.style.clipPath, 150, 200));
  viewer.select(asset('can'), { id: 'bad', requiredSlots: ['label'] });
  appearanceRequests[1].reject(new Error('required label failed')); await flush(); advance(0.05);
  assert.equal(hitRegion.style.display, 'none');
  viewer.select(asset('other'), { id: 'valid', requiredSlots: ['label'] });
  assert.equal(hitRegion.style.display, 'none', 'Changing package hides the hit region immediately');
});

test('live lighting edits update tone mapping and HDRI settings without reloading geometry or interrupting a flavor turn', async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, environment, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('can'), { id: 'citrus' });
  geometryRequests[0].resolve(model());
  environment.resolve(new THREE.Texture());
  await flush(); advance(0.1);
  assert.equal(mount.dataset.environment, 'ready');
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  const geometry = product.children[0];
  const hdrTexture = renderer.scene.environment;
  assert.ok(hdrTexture instanceof THREE.Texture);
  viewer.select(asset('can'), { id: 'berry' });
  await flush(); advance(0.2);
  assert.equal(mount.dataset.transitionPhase, 'flavor');

  for (const [index, [toneMapping, rendererMode]] of [
    ['neutral', THREE.NeutralToneMapping], ['agx', THREE.AgXToneMapping], ['aces', THREE.ACESFilmicToneMapping],
  ].entries()) {
    const pose = product.quaternion.clone();
    const settings = config.resolveViewerPresentation({ toneMapping, exposure: 0.8 + index * 0.15,
      environment: { mode:'hdri', intensity: 0.6 + index * 0.1, rotation: [0.1, 0.3 + index * 0.2, -0.1] } });
    viewer.configure(settings);
    assert.equal(renderer.toneMapping, rendererMode, 'Serialized renderer mode maps to the actual Three.js constant');
    assert.equal(renderer.toneMappingExposure, settings.exposure);
    assert.equal(renderer.scene.environmentIntensity, settings.environment.intensity);
    assert.deepEqual(renderer.scene.environmentRotation.toArray().slice(0, 3), settings.environment.rotation);
    assert.equal(renderer.scene.environment, hdrTexture, 'Editing HDRI strength or rotation reuses the decoded environment');
    assert.equal(product.children[0], geometry, 'The active geometry remains attached');
    assert.equal(geometryRequests.length, 1, 'Lighting edits do not trigger another model download');
    assert.ok(product.quaternion.angleTo(pose) < 1e-7, 'Lighting edits preserve the visible orientation');
    assert.equal(mount.dataset.transitionPhase, 'flavor', 'Updating presentation does not cancel the in-progress turn');
    advance(0.04);
    assert.ok(product.quaternion.angleTo(pose) > 0.001, 'The existing motion continues after the lighting update');
  }
  advance(0.4);
  assert.equal(mount.dataset.transitionPhase, 'idle', 'The same turn still completes normally');
  assert.equal(mount.dataset.productId, 'can');
});

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

test('hero resources reuse geometry for A to B to A and keep only two models when a third package is selected', async context => {
  const f = runtimeFixture(context, true);
  const candidate = id => ({ asset: f.asset(id), appearance: { id: `label-${id}` } });
  const a = candidate('a'), b = candidate('b'), c = candidate('c');
  f.viewer.pause(true);
  f.viewer.resources({ ready: [a, b, c], files: [a, b, c] });
  f.viewer.select(a.asset, a.appearance);
  f.geometryRequests[0].resolve(f.model()); await f.flush(); f.advance(0.05);
  const product = f.renderer.scene.children.find(node => node instanceof THREE.Group);
  const firstA = product.children[0];
  assert.equal(f.mount.dataset.productId, 'a');
  assert.equal(f.mount.dataset.modelPoolSize, '1');

  f.viewer.select(b.asset, b.appearance);
  f.geometryRequests[1].resolve(f.model()); await f.flush();
  const firstB = product.children[0];
  assert.equal(f.mount.dataset.productId, 'b');
  assert.equal(f.mount.dataset.modelPoolSize, '2');
  assert.equal(f.disposedCount(), 0, 'The outgoing A geometry remains reusable');

  f.viewer.select(a.asset, a.appearance); await f.flush();
  assert.equal(f.geometryRequests.length, 2, 'Returning to A does not load its GLB again');
  assert.equal(product.children[0], firstA, 'The exact scene object is reused');
  assert.equal(f.mount.dataset.productId, 'a');
  assert.equal(f.mount.dataset.modelPoolSize, '2');

  f.viewer.select(c.asset, c.appearance);
  assert.ok(f.disposedProducts.includes(firstB), 'The unused B model is evicted before the third geometry loads');
  assert.equal(f.geometryRequests.length, 3);
  f.geometryRequests[2].resolve(f.model()); await f.flush();
  assert.equal(f.mount.dataset.productId, 'c');
  assert.equal(f.mount.dataset.modelPoolSize, '2');

  f.viewer.select(b.asset, b.appearance);
  assert.equal(f.geometryRequests.length, 4, 'An evicted model is loaded only when it is selected again');
  f.geometryRequests[3].resolve(f.model()); await f.flush();
  assert.equal(f.mount.dataset.productId, 'b');
  assert.equal(f.mount.dataset.modelPoolSize, '2');
  f.viewer.dispose();
  assert.equal(f.disposedCount(), 4, 'Both evictions and both retained model instances are released once');
});

test('hero label pool switches back to a ready appearance without repeating its loader or shader warmup', async context => {
  const f = runtimeFixture(context, true);
  const asset = f.asset('can');
  const red = { id: 'red' }, blue = { id: 'blue' };
  f.viewer.pause(true);
  f.viewer.resources({ ready: [{ asset, appearance: red }, { asset, appearance: blue }], files: [] });
  f.viewer.select(asset, red); f.geometryRequests[0].resolve(f.model()); await f.flush();
  assert.equal(f.appearanceCalls.length, 1);
  assert.equal(f.mount.dataset.labelPoolReady, '1');

  f.viewer.select(asset, blue); await f.flush();
  assert.equal(f.appearanceCalls.length, 2);
  assert.equal(f.mount.dataset.labelPoolReady, '2');
  assert.equal(f.mount.dataset.labelCacheHit, 'false');
  const compileCount = f.renderer.compiledRoots.length;
  assert.equal(compileCount, 2, 'Each material set binds through the renderer program cache without polling');
  assert.equal(f.renderer.asyncCompiledRoots.length, 0, 'Speculative clones never start uncancellable shader polling');

  f.viewer.select(asset, red); await f.flush();
  assert.equal(f.mount.dataset.labelCacheHit, 'true');
  assert.equal(f.appearanceCalls.length, 2, 'Cached appearance bypasses its loader');
  assert.equal(f.renderer.compiledRoots.length, compileCount, 'Cached appearance bypasses shader preparation');
  assert.equal(f.geometryRequests.length, 1, 'Every label uses the same can scene');
  assert.equal(f.mount.dataset.labelPoolReady, '2');
  assert.equal(f.statuses.at(-1).phase, 'ready');
});

test('selected textured labels become ready without waiting for idle callbacks or asynchronous shader polling', async context => {
  const f = runtimeFixture(context, true, 1, {
    importedTexture: true, labelTextures: true, controlledIdle: true, unfinishedAsyncCompile: true,
  });
  const asset = f.asset('textured-can');
  const red = { id: 'red', slots: { label: { baseColorMap: '/red.webp' } } };
  const blue = { id: 'blue', slots: { label: { baseColorMap: '/blue.webp' } } };
  f.viewer.pause(true);
  f.viewer.resources({ ready: [{ asset, appearance: red }, { asset, appearance: blue }], files: [] });
  f.viewer.select(asset, red);
  f.geometryRequests[0].resolve(f.model());
  await f.flush(); await f.flush();
  f.tickIdleTimers(1000);
  await f.flush();
  assert.equal(f.statuses.at(-1).phase, 'ready', 'Demand must finish even when requestIdleCallback never runs');
  assert.ok(f.renderer.warmedTextures.includes(f.labelTextures[0]), 'The real texture boundary is exercised');
  assert.equal(f.mount.dataset.labelPoolReady, '1');

  f.viewer.select(asset, blue);
  await f.flush(); await f.flush();
  assert.equal(f.mount.dataset.labelPoolReady, '2', 'The next selected label is uploaded in the foreground too');
  assert.ok(f.renderer.warmedTextures.includes(f.labelTextures[1]));
  assert.equal(f.renderer.compiledRoots.length, 2, 'Both selected material sets are prepared without asynchronous polling');
  assert.equal(f.renderer.asyncCompiledRoots.length, 0, 'A never-settling compileAsync cannot hold a selection or teardown hostage');
  f.viewer.dispose();
  assert.equal(f.renderer.asyncCompiledRoots.length, 0);
});

test('selecting a neighbor parked in GPU warmup promotes it without an idle callback or a second label load', async context => {
  const f = runtimeFixture(context, true, 1, {
    importedTexture: true, labelTextures: true, controlledIdle: true, allowBackground: true, unfinishedAsyncCompile: true,
  });
  const asset = f.asset('neighbor-can');
  const red = { id: 'red', slots: { label: { baseColorMap: '/red.webp' } } };
  const blue = { id: 'blue', slots: { label: { baseColorMap: '/blue.webp' } } };
  // Put the unselected neighbor first so the background worker reaches it directly.
  f.viewer.resources({ ready: [{ asset, appearance: blue }, { asset, appearance: red }], files: [] });
  f.viewer.select(asset, red); f.geometryRequests[0].resolve(f.model());
  await f.flush(); await f.flush();
  assert.equal(f.statuses.at(-1).phase, 'ready');

  f.tickIdleTimers(40); f.releaseIdle();
  await f.flush(); await f.flush();
  f.tickIdleTimers(40);
  assert.equal(f.appearanceCalls.length, 2, 'A neighbor decode must actually have started');
  const neighborTexture = f.labelTextures[1];
  assert.ok(neighborTexture);
  assert.equal(f.renderer.warmedTextures.includes(neighborTexture), false, 'Background upload is genuinely parked behind idle');
  assert.ok(f.idleCallbacks.size > 0, 'The blocked idle callback is deliberately never released');

  f.viewer.select(asset, blue);
  await f.flush(); await f.flush();
  assert.ok(f.renderer.warmedTextures.includes(neighborTexture), 'The click promotes an already-started texture upload immediately');
  assert.equal(f.mount.dataset.labelPoolReady, '2');
  assert.equal(f.appearanceCalls.length, 2, 'Promotion reuses the in-flight label instead of decoding another copy');
  assert.equal(f.geometryRequests.length, 1);
  assert.equal(f.renderer.compiledRoots.length, 2);
  assert.equal(f.renderer.asyncCompiledRoots.length, 0);
});

test('image-cutout storefront without a backdrop allocates no painter or capture pass, including paused repaints', async (context) => {
  const { viewer, mount, renderer, geometryRequests, backdropResources, waterPassResources, renderEvents,
    model, asset, flush, advance } = runtimeFixture(context, true);
  const { DEFAULT_PRODUCT_ACCENT_SCENE } = loadSource('lib/viewer/accent-config.ts', name => name === '../viewer-config' ? config : require(name));
  const can = asset('can');
  viewer.accents(DEFAULT_PRODUCT_ACCENT_SCENE, 'can:citrus', 'citrus');
  viewer.backdrop(undefined);
  viewer.select(can, { id: 'citrus' });
  geometryRequests[0].resolve(model()); await flush();
  advance(0.2);
  assert.ok(renderer.draws.length > 1, 'The animated image-cutout scene actually renders across multiple frames');

  viewer.pause(true); advance(0.1);
  const pausedDraws = renderer.draws.length;
  advance(0.2);
  assert.equal(renderer.draws.length, pausedDraws, 'An unchanged paused scene spends no GPU draws');

  mount.clientWidth = 360;
  mount.clientHeight = 620;
  global.window.innerWidth = 390;
  viewer.configure(config.resolveViewerPresentation({ quality: { mobileDpr: 1.25 } }));
  advance(0.1);
  assert.ok(renderer.draws.length > pausedDraws, 'A paused layout change still repaints the main scene');
  advance(2); // Allow the existing camera-fit damping to settle after the resize.
  const resizedDraws = renderer.draws.length;
  advance(0.2);
  assert.equal(renderer.draws.length, resizedDraws, 'The paused resize finishes without continuous repainting');

  viewer.accents(DEFAULT_PRODUCT_ACCENT_SCENE, 'can:berry', 'berry');
  viewer.select(can, { id: 'berry' }); await flush();
  viewer.backdrop(undefined);
  advance(0.1);
  assert.ok(renderer.draws.length > resizedDraws, 'A paused flavor change remains visible without a capture pass');
  const beforeResume = renderer.draws.length;
  viewer.pause(false); advance(0.2);
  assert.ok(renderer.draws.length > beforeResume + 1, 'Idle rendering resumes normally');

  assert.equal(backdropResources.length, 0, 'Image cutouts never allocate a background canvas painter or texture upload source');
  assert.equal(waterPassResources.length, 0, 'Image cutouts never allocate the optional refraction render target');
  assert.equal(renderEvents.length, renderer.draws.length, 'Every rendered frame costs one main draw without an offscreen capture');
  assert.ok(renderEvents.every(event => event.type === 'main'), 'No hidden capture renders occur during animation, resize or pause');
});

test('viewer backdrop shares live background state, avoids identical recreation and owns replacement/disposal', (context) => {
  const { viewer, mount, backdropResources, backdropBindings, waterPassResources, advance } = runtimeFixture(context, true);
  const state = new backgroundRender.BackgroundRenderState();
  const settings = { ...backgrounds.backgroundConfig };
  viewer.backdrop({ state, config: settings });
  assert.equal(backdropResources.length, 1);
  assert.equal(waterPassResources.length, 1);
  const first = backdropResources[0];
  const firstPass = waterPassResources[0];
  assert.equal(first.state, state, 'Backdrop consumes the same live motion/theme state as the decorative DOM');
  assert.equal(first.mount, mount);
  assert.equal(backdropBindings.at(-1), firstPass.texture, 'All droplets sample the shared offscreen composition rather than bare CSS beneath fruit');
  assert.notEqual(backdropBindings.at(-1), first.texture);
  advance(0.1);
  assert.ok(first.updates > 0, 'Owning viewer drives canvas updates from its existing render lifecycle');

  state.setPatternOffset(37, -21);
  state.setFlavor(3, 100, false);
  viewer.backdrop({ state, config: { ...settings } });
  assert.equal(backdropResources.length, 1, 'Fresh prop objects with identical config do not recreate the canvas');
  assert.equal(waterPassResources.length, 1, 'Identical config also retains the lightweight offscreen render target');
  assert.equal(first.disposals, 0);
  const updates = first.updates;
  advance(0.1);
  assert.ok(first.updates > updates);
  assert.equal(first.state.patternOffset.x, 37, 'Shared state remains live after movement changes');

  settings.lineOpacity = 0.1;
  viewer.backdrop({ state, config: settings });
  assert.equal(backdropResources.length, 2, 'Even in-place config edits are detected through the saved JSON signature');
  assert.equal(waterPassResources.length, 2);
  assert.equal(first.disposals, 1);
  assert.equal(firstPass.disposals, 1);
  const second = backdropResources[1];
  assert.equal(backdropBindings.at(-1), waterPassResources[1].texture);
  const stoppedAt = first.updates;
  advance(0.1);
  assert.equal(first.updates, stoppedAt, 'Replaced resources no longer receive frame callbacks');
  assert.ok(second.updates > 0);

  viewer.backdrop();
  assert.equal(second.disposals, 1);
  assert.equal(waterPassResources[1].disposals, 1);
  assert.equal(backdropBindings.at(-1), null, 'Clearing the optional source removes the disposed sampler from droplet materials');
  const bindingsAfterClear = backdropBindings.length;
  viewer.backdrop(undefined);
  assert.equal(backdropBindings.length, bindingsAfterClear, 'Clearing twice is a no-op');
  const nextState = new backgroundRender.BackgroundRenderState();
  viewer.backdrop({ state: nextState, config: { ...settings } });
  assert.equal(backdropResources.length, 3);
  assert.equal(waterPassResources.length, 3);
  assert.equal(backdropResources[2].state, nextState, 'An independent source identity creates its own live canvas');
  viewer.dispose();
  assert.deepEqual(backdropResources.map(resource => resource.disposals), [1, 1, 1]);
  assert.deepEqual(waterPassResources.map(resource => resource.disposals), [1, 1, 1]);
  viewer.dispose();
  viewer.backdrop({ state, config: settings });
  assert.equal(backdropResources.length, 3, 'A disposed viewer cannot create another background resource');
  assert.deepEqual(backdropResources.map(resource => resource.disposals), [1, 1, 1]);
  assert.deepEqual(waterPassResources.map(resource => resource.disposals), [1, 1, 1]);
});

test('water composition renders once before each actual main draw using the same camera and CSS texture', (context) => {
  const { viewer, renderer, backdropResources, waterPassResources, renderEvents, advance } = runtimeFixture(context, true);
  viewer.backdrop({ state: new backgroundRender.BackgroundRenderState(), config: { ...backgrounds.backgroundConfig } });
  advance(0.2);
  const pass = waterPassResources[0];
  assert.equal(pass.renderer, renderer);
  assert.equal(pass.scene, renderer.scene);
  assert.ok(pass.product.parent === renderer.scene, 'The offscreen module receives the real product group for exclusion');
  assert.ok(renderer.draws.length > 0 && renderer.draws.length < 24, 'Main drawing remains capped below the 120Hz fixture RAF rate');
  assert.equal(pass.renders.length, renderer.draws.length, 'Skipped main frames do not spend an additional offscreen pass');
  for (const [index, call] of pass.renders.entries()) {
    assert.equal(call.background, backdropResources[0].texture);
    assert.equal(call.camera, renderer.draws[index].camera);
    assert.equal(renderEvents[index * 2].type, 'water-pass', 'The complete backdrop is available before water is drawn');
    assert.equal(renderEvents[index * 2 + 1].type, 'main');
  }
  viewer.pause(true); advance(0.05);
  const atRest = renderer.draws.length;
  advance(0.2);
  assert.equal(renderer.draws.length, atRest, 'Unchanged paused scenes do not repaint the water composition');
  backdropResources[0].paintNext = true;
  advance(0.05);
  assert.ok(renderer.draws.length > atRest, 'A real backdrop texture repaint wakes refraction even when object motion is paused');
  assert.equal(pass.renders.length, renderer.draws.length);
});

test('droplet frames receive physical drawing-buffer resolution after DPR and viewer size changes', (context) => {
  const { viewer, mount, renderer, accentFrames, advance } = runtimeFixture(context, true, 2);
  viewer.configure(config.resolveViewerPresentation({ quality: { maxDpr: 2 } }));
  advance(1 / 120);
  const first = accentFrames.at(-1);
  assert.deepEqual(first.resolution, [1000, 1400], 'Shader gl_FragCoord uses physical pixels instead of CSS dimensions');
  mount.clientWidth = 360;
  mount.clientHeight = 620;
  global.window.innerWidth = 390;
  viewer.configure(config.resolveViewerPresentation({ quality: { mobileDpr: 1.25 } }));
  advance(1 / 120);
  assert.deepEqual(accentFrames.at(-1).resolution, [450, 775]);
  assert.deepEqual(first.resolution, [1000, 1400], 'Earlier frame resolutions remain stable after resizing');
  assert.equal(renderer.resolutionTargets.size, 1, 'Resize reuses the same drawing-buffer Vector2');
});

test('accent reveal stays gated when a pending package receives a slow newer label texture', async (context) => {
  const { viewer, mount, geometryRequests, appearanceRequests, accentFrames, model, asset, flush, advance } = runtimeFixture(context);
  viewer.select(asset('short'), { id: 'citrus' });
  geometryRequests[0].resolve(model(0.08)); await flush();
  appearanceRequests[0].resolve(); await flush(); advance(0.05);
  assert.equal(accentFrames.at(-1).ready, true);

  viewer.select(asset('tall'), { id: 'citrus' });
  geometryRequests[1].resolve(model(0.18)); await flush();
  appearanceRequests[1].resolve(); await flush();
  assert.equal(mount.dataset.productId, 'short', 'Decoded package remains pending during the outgoing trajectory');
  viewer.select(asset('tall'), { id: 'berry', slots: { label: { baseColorMap: '/slow/berry.png' } } });
  assert.equal(appearanceRequests[2].value.slots.label.baseColorMap, '/slow/berry.png');
  advance(2.4);
  assert.equal(mount.dataset.productId, 'tall');
  assert.equal(mount.dataset.transitionPhase, 'idle', 'Package zoom and all rebounds have actually completed');
  assert.equal(accentFrames.at(-1).viewerIdle, true);
  assert.equal(accentFrames.at(-1).ready, false, 'A newly active model retains its pending appearance readiness');
  appearanceRequests[2].resolve(); await flush(); advance(1 / 120);
  assert.equal(accentFrames.at(-1).ready, true, 'The latest texture completion finally releases the reveal gate');
});

test('an obsolete pending label completion cannot release accents before the latest texture revision', async (context) => {
  const { viewer, mount, geometryRequests, appearanceRequests, accentFrames, model, asset, flush, advance } = runtimeFixture(context);
  viewer.select(asset('a'), { id: 'citrus' });
  geometryRequests[0].resolve(model()); await flush(); appearanceRequests[0].resolve(); await flush(); advance(0.05);
  viewer.select(asset('b'), { id: 'citrus' });
  geometryRequests[1].resolve(model(0.18)); await flush(); appearanceRequests[1].resolve(); await flush();
  viewer.select(asset('b'), { id: 'berry', slots: { label: { baseColorMap: '/slow/berry.png' } } });
  viewer.select(asset('b'), { id: 'lime', slots: { label: { baseColorMap: '/slow/lime.png' } } });
  appearanceRequests[2].resolve(); await flush(); advance(2.4);
  assert.equal(mount.dataset.productId, 'b');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(accentFrames.at(-1).ready, false, 'Old berry completion cannot mark the later lime request ready');
  appearanceRequests[3].reject(new Error('Optional label image unavailable')); await flush(); advance(1 / 120);
  assert.equal(accentFrames.at(-1).ready, true, 'Documented imported-material fallback releases a failed optional texture gate');
});

const requiredLabel = id => ({ id, requiredSlots: ['label'], slots: { label: { baseColorMap: `/labels/${id}.webp` } } });

test('a failed initial required label never activates imported artwork, disposes its product and permits an identical retry', async context => {
  const f = runtimeFixture(context);
  const appearance = requiredLabel('orange');
  f.viewer.select(f.asset('can'), appearance); f.geometryRequests[0].resolve(f.model()); await f.flush();
  f.appearanceRequests[0].reject(new Error('Required image 404')); await f.flush(); f.advance(.1);
  assert.equal(f.statuses.at(-1).phase, 'error'); assert.equal(f.mount.dataset.productId, undefined);
  assert.equal(f.disposedCount(), 1); assert.equal(f.accentFrames.at(-1).ready, false);
  assert.ok(!f.statuses.some(status => status.phase === 'ready'), 'The template label never becomes a ready selected product');
  f.viewer.select(f.asset('can'), appearance); assert.equal(f.geometryRequests.length, 2);
  f.geometryRequests[1].resolve(f.model()); await f.flush(); f.appearanceRequests[1].resolve(); await f.flush(); f.advance(.1);
  assert.equal(f.statuses.at(-1).phase, 'ready'); assert.equal(f.mount.dataset.productId, 'can'); assert.equal(f.accentFrames.at(-1).ready, true);
});

test('failure of an obsolete initial required label applies the newer flavor instead of failing it', async context => {
  const f = runtimeFixture(context);
  f.viewer.select(f.asset('can'), requiredLabel('orange')); f.geometryRequests[0].resolve(f.model()); await f.flush();
  f.viewer.select(f.asset('can'), requiredLabel('mango'));
  f.appearanceRequests[0].reject(new Error('Old orange label failed')); await f.flush();
  assert.equal(f.appearanceRequests[1].value.id, 'mango'); assert.equal(f.statuses.at(-1).phase, 'loading');
  assert.equal(f.disposedCount(), 0); assert.ok(!f.statuses.some(status => status.phase === 'error'));
  f.appearanceRequests[1].resolve(); await f.flush(); f.advance(.1);
  assert.equal(f.statuses.at(-1).phase, 'ready'); assert.equal(f.accentFrames.at(-1).ready, true);
});

test('required live texture failures hide the stale label and keep accents blocked until a successful retry', async context => {
  const f = runtimeFixture(context);
  f.viewer.select(f.asset('can'), requiredLabel('orange')); f.geometryRequests[0].resolve(f.model()); await f.flush();
  f.appearanceRequests[0].resolve(); await f.flush(); f.advance(.1);
  const product = f.renderer.scene.children.find(child => child instanceof THREE.Group), loaded = product.children[0];
  f.viewer.select(f.asset('can'), requiredLabel('mango')); f.appearanceRequests[1].reject(new Error('Current mango label failed'));
  await f.flush(); f.advance(2);
  assert.equal(f.statuses.at(-1).phase, 'error'); assert.equal(loaded.visible, false); assert.equal(f.accentFrames.at(-1).ready, false);
  f.viewer.select(f.asset('can'), requiredLabel('mango'));
  assert.equal(f.geometryRequests.length, 1, 'Retry uses compatible geometry without retaining the wrong label as visible');
  assert.equal(f.appearanceRequests[2].value.id, 'mango'); assert.equal(f.statuses.at(-1).phase, 'loading');
  f.appearanceRequests[2].resolve(); await f.flush(); f.advance(.1);
  assert.equal(f.statuses.at(-1).phase, 'ready'); assert.equal(loaded.visible, true); assert.equal(f.accentFrames.at(-1).ready, true);
});

test('obsolete required live failures cannot hide or fail a newer active flavor or package', async context => {
  const f = runtimeFixture(context);
  f.viewer.select(f.asset('can'), requiredLabel('orange')); f.geometryRequests[0].resolve(f.model()); await f.flush();
  f.appearanceRequests[0].resolve(); await f.flush(); f.advance(.1);
  const product = f.renderer.scene.children.find(child => child instanceof THREE.Group), loaded = product.children[0];
  f.viewer.select(f.asset('can'), requiredLabel('mango')); f.viewer.select(f.asset('can'), requiredLabel('apple'));
  f.appearanceRequests[1].reject(new Error('Obsolete mango label')); await f.flush(); f.advance(.1);
  assert.equal(loaded.visible, true); assert.ok(!f.statuses.some(status => status.phase === 'error')); assert.equal(f.accentFrames.at(-1).ready, false);
  f.appearanceRequests[2].resolve(); await f.flush(); f.advance(1);
  assert.equal(f.accentFrames.at(-1).ready, true);
  f.viewer.select(f.asset('can'), requiredLabel('grape')); f.viewer.select(f.asset('other'), requiredLabel('coconut'));
  f.appearanceRequests[3].reject(new Error('Outgoing grape failed')); await f.flush();
  assert.equal(f.statuses.at(-1).phase, 'loading'); assert.equal(loaded.visible, true);
  f.geometryRequests[1].resolve(f.model(.18)); await f.flush(); f.appearanceRequests[4].resolve(); await f.flush(); f.advance(3);
  assert.equal(f.statuses.at(-1).phase, 'ready'); assert.equal(f.mount.dataset.productId, 'other');
});

test('a failed required pending package is discarded and choosing another flavor reloads its geometry without activating a template', async context => {
  const f = runtimeFixture(context);
  f.viewer.select(f.asset('short'), requiredLabel('orange')); f.geometryRequests[0].resolve(f.model(.08)); await f.flush();
  f.appearanceRequests[0].resolve(); await f.flush(); f.advance(.1);
  f.viewer.select(f.asset('tall'), requiredLabel('orange')); f.geometryRequests[1].resolve(f.model(.18)); await f.flush();
  f.appearanceRequests[1].resolve(); await f.flush();
  f.viewer.select(f.asset('tall'), requiredLabel('mango')); f.appearanceRequests[2].reject(new Error('Required pending print failed'));
  await f.flush(); f.advance(3);
  assert.equal(f.statuses.at(-1).phase, 'error'); assert.equal(f.mount.dataset.productId, 'short'); assert.equal(f.accentFrames.at(-1).ready, false);
  const product = f.renderer.scene.children.find(child => child instanceof THREE.Group);
  assert.equal(product.children[0].visible, false, 'A failed incoming label cannot recover visibly to the previous package');
  assert.ok(f.disposedCount() >= 1);
  f.viewer.select(f.asset('tall'), requiredLabel('apple')); assert.equal(f.geometryRequests.length, 3);
  f.geometryRequests[2].resolve(f.model(.18)); await f.flush(); assert.equal(f.appearanceRequests[3].value.id, 'apple');
  f.appearanceRequests[3].resolve(); await f.flush(); f.advance(3);
  assert.equal(f.mount.dataset.productId, 'tall'); assert.equal(f.statuses.at(-1).phase, 'ready'); assert.equal(f.accentFrames.at(-1).ready, true);
});

for (const change of ['source', 'sampler']) test(`paused asset ${change} replacement with the same ID waits for new geometry and appearance`, async (context) => {
  const { viewer, renderer, geometryRequests, appearanceRequests, accentFrames, model, asset, flush, advance } = runtimeFixture(context);
  const original = asset('can');
  viewer.select(original, { id: 'citrus' });
  geometryRequests[0].resolve(model(0.08)); await flush(); appearanceRequests[0].resolve(); await flush(); advance(0.05);
  assert.equal(accentFrames.at(-1).ready, true);
  const product = renderer.scene.children.find(child => child instanceof THREE.Group);
  const outgoing = product.children[0];
  viewer.pause(true);
  viewer.select(original, { id: 'lime', slots: { label: { baseColorMap: '/slow/old-lime.png' } } });
  const replacement = change === 'source' ? { ...original, src: '/replacement-can.glb' }
    : { ...original, textureSamplers: { label: { wrapS: 'repeat', wrapT: 'clamp' } } };
  viewer.select(replacement, { id: 'berry', slots: { label: { baseColorMap: '/slow/replacement-berry.png' } } });
  assert.equal(geometryRequests.length, 2, 'A new sampler must replace the old appearance handle even when model ID and URL match');
  assert.equal(geometryRequests[1].src, replacement.src);
  advance(0.05);
  assert.equal(accentFrames.at(-1).viewerIdle, true, 'Static mode has no package animation to provide a secondary readiness guard');
  assert.equal(accentFrames.at(-1).ready, false, 'Matching asset ID alone cannot release replacement accents');
  assert.equal(product.children[0], outgoing, 'The previous model remains visible while its replacement downloads');
  appearanceRequests[1].resolve(); await flush(); advance(1 / 120);
  assert.equal(accentFrames.at(-1).ready, false, 'An outgoing model texture completion cannot release the desired replacement gate');
  geometryRequests[1].resolve(model(0.18)); await flush(); advance(1 / 120);
  assert.deepEqual(appearanceRequests[2].asset.textureSamplers, replacement.textureSamplers, 'The new appearance handle receives the replacement UV contract');
  assert.equal(accentFrames.at(-1).ready, false, 'Decoded replacement still waits for its own latest material');
  assert.equal(product.children[0], outgoing);
  appearanceRequests[2].resolve(); await flush(); advance(1 / 120);
  assert.equal(accentFrames.at(-1).ready, true);
  assert.notEqual(product.children[0], outgoing);
  const bounds = new THREE.Box3().setFromObject(product.children[0]);
  assert.ok(bounds.max.y - bounds.min.y > 0.17, 'The real incoming geometry was attached before revealing its accents');
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
  for (let frame = 0; frame < 150; frame += 1) {
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
  assert.ok(bounceScales.length >= 80, 'Additional rebound has enough visible frames while the pose stays upright');
  const crossingIndex = entryScales.findIndex((value) => value >= 1);
  assert.ok(crossingIndex > 0 && crossingIndex + 1 < entryScales.length);
  const beforeCrossing = entryScales[crossingIndex] - entryScales[crossingIndex - 1];
  const afterCrossing = entryScales[crossingIndex + 1] - entryScales[crossingIndex];
  assert.ok(beforeCrossing > 0.005 && afterCrossing > 0.005, 'Visible frames keep growing through scale 1 instead of pausing before the crest');
  assert.ok(Math.abs(beforeCrossing - afterCrossing) < 0.004, 'Crossing scale speed is continuous at frame boundaries');
  const bouncePeak = Math.max(...bounceScales);
  const peakIndex = bounceScales.indexOf(bouncePeak);
  assert.ok(bouncePeak > 1.198 && bouncePeak <= 1.2, 'Runtime visibly expands approximately 20% after reaching idle');
  assert.ok(Math.min(...bounceScales.slice(peakIndex)) > 0.89 && Math.min(...bounceScales.slice(peakIndex)) < 0.91, 'Runtime shows a visible contraction after the stronger crest');
  const visibleCrests = bounceScales.filter((value, index) => value > 1 && index > 0 && index < bounceScales.length - 1
    && value > bounceScales[index - 1] && value > bounceScales[index + 1]);
  assert.equal(visibleCrests.length, 3, 'Actual rendered frames show three progressively smaller crests');
  assert.ok(visibleCrests[0] > visibleCrests[1] && visibleCrests[1] > visibleCrests[2], 'Each visible rebound damps toward idle');
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
    advance(0.25);
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
  for (let frame = 0; frame < 300; frame += 1) {
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
  advance(1.3);
  assert.equal(mount.dataset.transitionPhase, 'idle');
  viewer.select(asset('missing')); advance(0.9);
  geometryRequests[3].reject(new Error('Missing model')); await flush(); advance(1.3);
  assert.equal(mount.dataset.productId, 'c');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.visible, true);
  assert.equal(product.scale.x, 1);
  assert.equal(statuses.at(-1).phase, 'error');
});

test('explicit pause interrupts rebound safely and zero amplitude skips the rebound duration', async (context) => {
  const { viewer, mount, renderer, geometryRequests, model, asset, flush, advance } = runtimeFixture(context, true);
  viewer.select(asset('a')); geometryRequests[0].resolve(model()); await flush(); advance(0.05);
  const product = renderer.scene.children.find((node) => node instanceof THREE.Group);
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.DEFAULT_VIEWER_PRESENTATION.pose, 'YXZ'));
  viewer.select(asset('b')); geometryRequests[1].resolve(model(0.18)); await flush(); advance(1.65);
  assert.equal(mount.dataset.transitionPhase, 'package-bounce');
  assert.ok(product.scale.x > 1.1);
  viewer.pause(true); advance(1 / 120);
  assert.equal(mount.dataset.transitionPhase, 'idle');
  assert.equal(product.scale.x, 1, 'Explicit pause clears overshoot immediately');
  assert.ok(product.quaternion.angleTo(rest) < 1e-7);
  viewer.select(asset('c')); geometryRequests[2].resolve(model(0.08)); await flush();
  assert.equal(mount.dataset.productId, 'c', 'Explicit pause activates decoded geometry without a timed animation');
  assert.equal(mount.dataset.transitionPhase, 'idle');
  viewer.pause(false);
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
