import { publicUrl } from '../public-url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ProductAppearance, ProductAsset, ViewerPresentation, assetUrl } from '../viewer-config';
import { AppearanceHandle, createAppearanceHandle, disposeProduct } from './appearance';
import { createPooledAppearanceHandle, type AppearanceWarmupPriority, type PooledAppearanceHandle } from './pooled-appearance';
import type { LiveMaterialOverrides } from './material-adjustments';
import { createResourcePrefetcher, type ViewerResourceWindow } from './resource-prefetch';
import { createProductFramingFrames, createRadialProductEnvelope, fitProductCamera, interpolatePackageAim } from './framing';
import { packageCapPose, packageEntryScale, packageExitProgress, packageMaximumScale, packageSpinProgress, smoothstep } from './package-motion';
import { createDaylightEnvironment, environmentCacheKey } from './environment';
import { createAccentLayer } from './accent-layer';
import type { AccentFlavor, ProductAccentSceneInput } from './accent-config';
import { createBackdropTexture, type ProductViewerBackdropInput } from './backdrop-texture';
import { createWaterBackdropPass } from './water-backdrop-pass';
import { createProductHitRegion, hitVisibleProduct, visibleProductGestureMeshes } from './product-hit-region';
import { renderBottleScene } from './bottle-materials';
import { setAloeBottleBackdrop } from './aloe-bottle-materials';
import { AdaptiveAloeQuality } from './adaptive-aloe';

export interface ViewerStatus {
  phase: 'loading' | 'ready' | 'error';
  assetId: string;
  message?: string;
  environmentReady?: boolean;
  hasProduct?: boolean;
}
export interface ProductViewerController {
  materials(overrides?: LiveMaterialOverrides): void;
  select(asset: ProductAsset, appearance?: ProductAppearance): void;
  resources(window?: ViewerResourceWindow): void;
  configure(presentation: ViewerPresentation): void;
  accents(scene: ProductAccentSceneInput | undefined, key: string, flavor: AccentFlavor): void;
  backdrop(source?: ProductViewerBackdropInput): void;
  pause(paused: boolean): void;
  reset(): void;
  dispose(): void;
}
type LoadedProduct = { root: THREE.Group; content: THREE.Group; appearance: AppearanceHandle; asset: ProductAsset; definitionKey: string; bounds: THREE.Box3; radius: number; framingPoints?: THREE.Vector3[] };
const definitionOf = (asset: ProductAsset) => JSON.stringify({ id: asset.id, src: asset.src, slots: asset.materialSlots, samplers: asset.textureSamplers, orientation: asset.orientation });
type Point = { x: number; y: number };
type Transition = { origin: THREE.Quaternion; angle: number; velocity: number; initialVelocity: number; elapsed: number; swapped: boolean };
type PackageTransition = {
  phase: 'aim' | 'anticipate' | 'out' | 'hold' | 'in' | 'bounce'; elapsed: number;
  origin: THREE.Quaternion; cap: THREE.Quaternion; inOrigin: THREE.Quaternion;
  fromScale: number; launchScale: number; inScale: number; fromY: number;
};

/** One scene per component, with explicit commands instead of global storefront events. */
export function createProductViewer(
  mount: HTMLDivElement,
  initialPresentation: ViewerPresentation,
  status: (value: ViewerStatus) => void,
): ProductViewerController {
  let presentation = initialPresentation;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: presentation.quality.antialias, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#000000', 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.tabIndex = 0;
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'pan-y pinch-zoom' });
  mount.appendChild(renderer.domElement);
  const hitRegion = createProductHitRegion(mount);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(presentation.camera.fov, 1, 0.001, 10);
  const product = new THREE.Group();
  scene.add(product);
  const rest = new THREE.Quaternion();
  const pose = new THREE.Quaternion();
  const target = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const rock = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0);
  const dragAxis = new THREE.Vector3();
  const dragStep = new THREE.Quaternion();
  const candidate = new THREE.Quaternion();
  const up = new THREE.Vector3();
  const pointers = new Map<number, Point>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let disposed = false;
  let paused = false;
  let visible = true;
  let dragging = false;
  let dirty = true;
  const aloeQuality = new AdaptiveAloeQuality();
  let aloePrewarmFrames = 0;
  let hiddenCanvasOpacity: string | undefined;
  let liveMaterialOverrides: LiveMaterialOverrides = {};
  let animationTime = 0;
  let lastTime = performance.now();
  let lastDrawTime = 0;
  let frameSampleAt = performance.now();
  let sampleDraws = 0;
  let previousDrawAt = 0;
  let sampleLongestGap = 0;
  let lastInputAt = -Infinity;
  let returnFrom: THREE.Quaternion | null = null;
  let returnElapsed = 0;
  let cinematic: Transition | null = null;
  let packageTransition: PackageTransition | null = null;
  let waitingAloeEntry = false;
  let active: LoadedProduct | null = null;
  let pendingProduct: LoadedProduct | null = null;
  let desiredAsset: ProductAsset | null = null;
  let assetDefinitionKey = '';
  let desiredAppearance: ProductAppearance | undefined;
  let assetRevision = 0;
  const appearanceRevisions = new WeakMap<LoadedProduct, number>();
  const appearanceReadiness = new WeakMap<LoadedProduct, boolean>();
  const appliedAppearanceIds = new WeakMap<LoadedProduct, string>();
  let currentAppearanceKey = '';
  let failedAppearanceKey: string | null = null;
  let appearanceReady = true;
  let resourceWindow: ViewerResourceWindow | undefined;
  const geometryCache = new Map<string, LoadedProduct>();
  let warmRevision = 0;
  let modelLoads = 0;
  const warmedTextures = new WeakSet<THREE.Texture>();
  const prefetch = createResourcePrefetcher({ onDiagnostics: value => {
    mount.dataset.prefetchFiles = String(value.entries);
    mount.dataset.prefetchBytes = String(value.bytes);
    mount.dataset.prefetchPending = String(value.queued + value.inFlight);
  } });
  prefetch.setEnabled(false);
  const idle = () => new Promise<void>(resolve => {
    // A timer gap also works on mobile Safari, which lacks requestIdleCallback.
    setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 800 });
      else resolve();
    }, 40);
  });
  const canWarmNeighbors = () => !document.hidden && visible && !paused && !dragging && !cinematic && !packageTransition && !aloeQuality.probing && !aloePrewarmFrames;
  const yieldWarmup = (priority: AppearanceWarmupPriority) => {
    if (priority.isForeground()) return Promise.resolve();
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let idleCallback: number | undefined;
      let unsubscribe = () => {};
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
        unsubscribe();
        resolve();
      };
      unsubscribe = priority.onPromote(finish);
      // A click promotes an already-decoded neighbor instead of inheriting its
      // background timer. Foreground work never waits for requestIdleCallback.
      if (priority.isForeground()) { finish(); return; }
      timer = setTimeout(() => {
        timer = undefined;
        if ('requestIdleCallback' in window) idleCallback = window.requestIdleCallback(finish, { timeout: 800 });
        else finish();
      }, 40);
    });
  };
  const poolOf = (loaded: LoadedProduct | null) => loaded?.appearance && 'setWindow' in loaded.appearance ? loaded.appearance as PooledAppearanceHandle : null;
  const updatePrefetch = () => prefetch.setEnabled(Boolean(resourceWindow && active && appearanceReady && !document.hidden && visible && !paused));
  const rememberLoaded = (asset: ProductAsset, appearance?: ProductAppearance) => {
    if (!resourceWindow) return;
    prefetch.markLoaded(asset.src);
    for (const slot of Object.values(appearance?.slots ?? {})) {
      for (const url of [slot.baseColorMap, slot.normalMap, slot.roughnessMap]) if (url) prefetch.markLoaded(url);
    }
  };
  const createHandle = (content: THREE.Group, asset: ProductAsset): AppearanceHandle => resourceWindow ? createPooledAppearanceHandle(content, asset, {
    capacity: window.innerWidth <= 760 ? 3 : 5,
    maxTextureBytes: (window.innerWidth <= 760 ? 20 : 32) * 1024 * 1024,
    acquireUrl: prefetch.acquireUrl,
    onChange: (ready, pending, textureBytes) => {
      if (definitionOf(asset) !== assetDefinitionKey) return;
      mount.dataset.labelPoolReady = String(ready);
      mount.dataset.labelPoolPending = String(pending);
      mount.dataset.labelTextureBytes = String(textureBytes);
    },
    async warmup(root, isCurrent, priority) {
      const textures = new Set<THREE.Texture>();
      root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
        }
      });
      for (const texture of textures) {
        if (warmedTextures.has(texture)) continue;
        if (!priority.isForeground()) await yieldWarmup(priority);
        while (!priority.isForeground() && !canWarmNeighbors() && !disposed && isCurrent()) await yieldWarmup(priority);
        if (disposed || !isCurrent()) return;
        renderer.initTexture(texture);
        warmedTextures.add(texture);
      }
      while (!priority.isForeground() && !canWarmNeighbors() && !disposed && isCurrent()) await yieldWarmup(priority);
      if (disposed || !isCurrent()) return;
      // Three reuses its program cache for identical shader variants. Async
      // polling of every temporary material clone delayed demand commits and
      // could outlive disposal of the imported materials shared by those clones.
      renderer.compile(root, camera, scene);
      mount.dataset.shaderPrograms = String(renderer.info.programs?.length ?? 0);
    },
  }) : createAppearanceHandle(content, asset);
  const warmNeighbors = () => {
    const thisRevision = ++warmRevision;
    const loaded = active;
    const pool = poolOf(loaded);
    if (!loaded || !pool) return;
    const neighbors = resourceWindow?.ready.filter(candidate => definitionOf(candidate.asset) === loaded.definitionKey).slice(0, 5) ?? [];
    pool.setWindow(neighbors.map(candidate => candidate.appearance));
    if (!appearanceReady || loaded.definitionKey !== assetDefinitionKey || document.hidden || !visible || paused || !prefetch.allowsBackground()) return;
    void (async () => {
      for (const candidate of neighbors) {
        await idle();
        while (!canWarmNeighbors() && !disposed && thisRevision === warmRevision && active === loaded && appearanceReady) await idle();
        if (disposed || thisRevision !== warmRevision || active !== loaded || !appearanceReady || document.hidden || !visible || paused || !prefetch.allowsBackground()) return;
        try { await pool.prepare(candidate.appearance); } catch { /* A neighbor may be missing; selected-product validation still reports it. */ }
      }
    })();
  };
  let lights: THREE.Light[] = [];
  let fitDistance = 0.4;
  let currentDistance = 0.4;
  let environmentReady = false;
  let environmentSrc = '';
  let environmentRevision = 0;
  let statusPhase: ViewerStatus['phase'] = 'loading';
  let statusMessage: string | undefined;
  const environmentTargets = new Map<string, Promise<THREE.WebGLRenderTarget>>();
  const ownedEnvironmentTargets = new Set<THREE.WebGLRenderTarget>();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const loader = new GLTFLoader();
  const draco = new DRACOLoader().setDecoderPath(publicUrl(presentation.decoders.dracoPath)).setWorkerLimit(2);
  const basis = new KTX2Loader().setTranscoderPath(publicUrl(presentation.decoders.basisPath)).setWorkerLimit(2).detectSupport(renderer);
  loader.setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco).setKTX2Loader(basis);
  const accents = createAccentLayer(scene, loader, () => { dirty = true; }, mount);
  const drawingBufferSize = new THREE.Vector2(1, 1);
  let backdrop: ReturnType<typeof createBackdropTexture> | undefined;
  let waterBackdrop: ReturnType<typeof createWaterBackdropPass> | undefined;
  let backdropSource: ProductViewerBackdropInput | undefined;
  let backdropSignature = '';
  let residentBackdropSource: ProductViewerBackdropInput | undefined;
  let residentBackdropSignature = '';
  let lastAloeBackdropSource: ProductViewerBackdropInput | undefined;
  const isAloe = (model: LoadedProduct | null) => model?.asset.packaging === 'pet' && model.asset.materialSlots?.liquid?.includes('Aloe Vera Water') === true;
  const releaseBackdrop = () => {
    accents.setBackdrop(null); setAloeBottleBackdrop(product, null);
    backdrop?.dispose(); backdrop = undefined;
    waterBackdrop?.dispose(); waterBackdrop = undefined; residentBackdropSource = undefined; residentBackdropSignature = '';
  };
  const prepareBackdrop = (source: ProductViewerBackdropInput) => {
    if (backdrop && waterBackdrop && residentBackdropSource?.state === source.state
      && residentBackdropSignature === JSON.stringify(source.config)) return true;
    releaseBackdrop();
    try {
      backdrop = createBackdropTexture(source.state, source.config, mount);
      waterBackdrop = createWaterBackdropPass(renderer, scene, product);
      residentBackdropSource = source; residentBackdropSignature = JSON.stringify(source.config); accents.setBackdrop(waterBackdrop.texture);
      return true;
    } catch { releaseBackdrop(); return false; }
  };
  const hideTrialCanvas = () => {
    if (hiddenCanvasOpacity !== undefined) return;
    hiddenCanvasOpacity = renderer.domElement.style.opacity || '';
    renderer.domElement.style.opacity = '0'; hitRegion.clear();
    mount.dataset.aloeProbe = 'true';
  };
  const revealTrialCanvas = () => {
    if (hiddenCanvasOpacity === undefined) return;
    renderer.domElement.style.opacity = hiddenCanvasOpacity; hiddenCanvasOpacity = undefined;
    mount.dataset.aloeProbe = 'false'; dirty = true;
  };
  const cancelAloeTrial = () => {
    const wasTrial = aloeQuality.probing || aloePrewarmFrames > 0;
    if (aloePrewarmFrames) aloeQuality.deferFullEntry();
    aloeQuality.cancelProbe(); aloePrewarmFrames = 0; revealTrialCanvas(); aloeQuality.resetCadence();
    if (wasTrial) {
      if (!backdropSource || (backdropSource.adaptiveAloe && !aloeQuality.needsBackdrop)) releaseBackdrop();
      else if (!backdropSource.adaptiveAloe) prepareBackdrop(backdropSource);
    }
  };
  const reportAloeQuality = () => {
    mount.dataset.aloeQuality = aloeQuality.quality;
    mount.dataset.aloeQualityReason = aloeQuality.reason;
    mount.dataset.aloeRefractionMix = aloeQuality.mix.toFixed(3);
  };
  const setBackdrop = (source?: ProductViewerBackdropInput) => {
    if (disposed) return;
    const signature = JSON.stringify([source?.config ?? null, source?.adaptiveAloe ?? false]);
    if (source?.state === backdropSource?.state && signature === backdropSignature) return;
    if (aloeQuality.probing) cancelAloeTrial();
    backdropSource = source; backdropSignature = signature;
    if (source?.adaptiveAloe) lastAloeBackdropSource = source;
    if (source && (!source.adaptiveAloe || (aloeQuality.needsBackdrop && !dragging))) prepareBackdrop(source);
    else releaseBackdrop();
    dirty = true;
  };

  const emitStatus = (phase: ViewerStatus['phase'], message?: string) => {
    statusPhase = phase; statusMessage = message;
    if (phase === 'error') hitRegion.clear();
    if (!disposed && desiredAsset) status({ phase, assetId: desiredAsset.id, message, environmentReady, hasProduct: Boolean(active) });
  };
  const discard = (loaded: LoadedProduct | null) => {
    if (!loaded) return;
    loaded.root.removeFromParent();
    loaded.appearance.dispose();
    disposeProduct(loaded.root);
  };
  const reportGeometry = () => { mount.dataset.modelPoolSize = String(geometryCache.size + Number(Boolean(active)) + Number(Boolean(pendingProduct))); };
  const recycle = (loaded: LoadedProduct | null) => {
    if (!loaded) return;
    if (!resourceWindow || disposed) { discard(loaded); return; }
    loaded.root.removeFromParent();
    // Inactive geometry retains only imported PBR, never another five-label pool.
    loaded.appearance.dispose();
    const previous = geometryCache.get(loaded.definitionKey);
    if (previous && previous !== loaded) discard(previous);
    geometryCache.delete(loaded.definitionKey);
    geometryCache.set(loaded.definitionKey, loaded);
    while (geometryCache.size > 1) {
      const key = geometryCache.keys().next().value!;
      const oldest = geometryCache.get(key)!;
      geometryCache.delete(key); discard(oldest);
    }
  };
  const fitCamera = () => {
    // Keep the outgoing camera unchanged until the package is hidden for its swap.
    const model = active ?? pendingProduct;
    if (!model) return;
    const fill = window.innerWidth <= 760 ? presentation.camera.mobileFill : presentation.camera.fill;
    const targetOffset = new THREE.Vector3(...presentation.camera.target).multiplyScalar(model.radius);
    const motion = presentation.motion;
    const maximumScale = packageMaximumScale(motion.packageAnticipationScale, motion.packageBounceAmount);
    fitDistance = fitProductCamera(model.bounds, rest, camera.aspect, camera.fov, fill, motion.rocking, targetOffset, model.radius,
      motion.packageTilt, maximumScale, {
        points: model.framingPoints,
        frames: createProductFramingFrames(rest, {
          rocking: motion.rocking, tilt: motion.packageTilt, maximumScale,
          anticipationScale: motion.packageAnticipationScale, entranceSeconds: motion.packageInSeconds,
          entryScale: (elapsed) => packageEntryScale(elapsed, 0.01, motion),
        }, model.radius),
        sizeMultiplier: window.innerWidth <= 760 ? presentation.camera.mobileProductScale : presentation.camera.productScale,
        referenceMaximumScale: 1.15,
      });
    camera.near = Math.max(0.0001, model.radius * 0.01);
    camera.far = Math.max(10, fitDistance * 20);
    camera.position.set(targetOffset.x, targetOffset.y, currentDistance);
    camera.lookAt(targetOffset);
    camera.updateProjectionMatrix();
    lights.forEach((light, index) => light.position.set(...presentation.lights[index].position).multiplyScalar(model.radius));
    dirty = true;
  };
  const resize = () => {
    if (aloeQuality.probing || aloePrewarmFrames) cancelAloeTrial();
    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? presentation.quality.mobileDpr : presentation.quality.maxDpr));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(drawingBufferSize);
    aloeQuality.configure(drawingBufferSize.x, drawingBufferSize.y, presentation.quality.maxFps);
    reportAloeQuality();
    camera.aspect = width / height;
    fitCamera();
    camera.updateProjectionMatrix();
    hitRegion.update(active && !packageTransition ? active.root : null, camera, width, height, performance.now(), true);
    dirty = true;
  };
  const loadEnvironment = (settings: ViewerPresentation['environment']) => {
    const thisRevision = ++environmentRevision;
    const key = environmentCacheKey(settings);
    environmentSrc = key;
    if (!environmentTargets.has(key)) {
      const source = settings.mode === 'procedural'
        ? Promise.resolve(createDaylightEnvironment(settings.procedural))
        : (/\.exr(?:\?|$)/i.test(settings.src) ? new EXRLoader() : new HDRLoader()).loadAsync(publicUrl(settings.src));
      const pending = source.then((texture) => {
        if (disposed) { texture.dispose(); throw new Error('Viewer disposed'); }
        try {
          const target = pmrem.fromEquirectangular(texture);
          ownedEnvironmentTargets.add(target);
          return target;
        } finally { texture.dispose(); }
      });
      environmentTargets.set(key, pending);
    }
    environmentTargets.get(key)!.then((target) => {
      if (disposed || thisRevision !== environmentRevision) return;
      scene.environment = target.texture;
      scene.environmentIntensity = presentation.environment.intensity;
      scene.environmentRotation.set(...presentation.environment.rotation);
      environmentReady = true;
      mount.dataset.environment = 'ready';
      dirty = true;
      emitStatus(statusPhase, statusMessage);
    }).catch(() => {
      if (disposed || thisRevision !== environmentRevision) return;
      environmentTargets.delete(key);
      mount.dataset.environment = 'error';
      // Retain an earlier valid environment. Lighting failure does not hide the product.
      emitStatus(statusPhase, statusMessage ?? 'Không tải được HDRI studio; đang dùng ánh sáng dự phòng.');
    });
  };
  const configure = (value: ViewerPresentation) => {
    const poseChanged = value.pose.some((entry, index) => entry !== presentation.pose[index]);
    presentation = value;
    renderer.toneMapping = {
      neutral: THREE.NeutralToneMapping,
      agx: THREE.AgXToneMapping,
      aces: THREE.ACESFilmicToneMapping,
    }[value.toneMapping];
    renderer.toneMappingExposure = value.exposure;
    camera.fov = value.camera.fov;
    rest.setFromEuler(new THREE.Euler(...value.pose, 'YXZ'));
    lights.forEach((light) => scene.remove(light));
    lights = value.lights.map((light) => {
      const result = light.type === 'hemisphere'
        ? new THREE.HemisphereLight(light.color, light.groundColor, light.intensity)
        : new THREE.DirectionalLight(light.color, light.intensity);
      scene.add(result);
      return result;
    });
    scene.environmentIntensity = value.environment.intensity;
    scene.environmentRotation.set(...value.environment.rotation);
    if (environmentCacheKey(value.environment) !== environmentSrc) loadEnvironment(value.environment);
    draco.setDecoderPath(publicUrl(value.decoders.dracoPath));
    basis.setTranscoderPath(publicUrl(value.decoders.basisPath));
    if (poseChanged) {
      cinematic = null; clearPackageMotion(); target.copy(rest); returnFrom = pose.clone(); returnElapsed = 0;
      lastInputAt = animationTime - value.motion.returnDelay;
    }
    resize();
  };
  const beginCinematic = () => {
    if (dragging || paused || packageTransition) { dirty = true; return; }
    const velocity = cinematic?.velocity ?? presentation.motion.idleSpeed;
    cinematic = { origin: pose.clone(), angle: 0, velocity, initialVelocity: velocity, elapsed: 0, swapped: false };
    returnFrom = null;
    mount.dataset.transitionPhase = 'flavor';
    dirty = true;
  };
  const clearPackageMotion = () => {
    packageTransition = null;
    waitingAloeEntry = false;
    product.scale.setScalar(1); product.visible = true; product.position.y = 0;
    mount.dataset.transitionPhase = 'idle';
    dirty = true;
  };
  const setPackagePhase = (phase: PackageTransition['phase']) => {
    if (packageTransition) packageTransition.phase = phase;
    hitRegion.clear();
    mount.dataset.transitionPhase = `package-${phase}`;
  };
  const beginPackageMotion = () => {
    if (!active || paused || dragging) return;
    // Rapid choices during exit keep the visible trajectory and load only the latest asset.
    if (packageTransition && packageTransition.phase !== 'in' && packageTransition.phase !== 'bounce') return;
    const cap = packageCapPose(presentation.motion.packageTilt);
    packageTransition = {
      phase: 'aim', elapsed: 0, origin: pose.clone(), cap, inOrigin: cap.clone(),
      fromScale: product.scale.x, launchScale: Math.max(product.scale.x, presentation.motion.packageAnticipationScale),
      inScale: 0.01, fromY: product.position.y,
    };
    cinematic = null; returnFrom = null; product.visible = true;
    setPackagePhase('aim'); dirty = true;
  };
  const recoverPackageMotion = () => {
    if (!packageTransition) return;
    packageTransition.inOrigin.copy(pose); packageTransition.inScale = product.scale.x;
    packageTransition.elapsed = 0; setPackagePhase('in'); product.visible = true;
  };
  const activatePendingProduct = () => {
    if (!pendingProduct) return;
    recycle(active);
    active = pendingProduct;
    active.appearance.setLiveOverrides?.(liveMaterialOverrides);
    pendingProduct = null;
    product.add(active.root);
    appearanceReady = appearanceReadiness.get(active) ?? true;
    mount.dataset.productId = active.asset.id;
    mount.dataset.appearanceId = appliedAppearanceIds.get(active) ?? '';
    fitCamera();
    if (isAloe(active)) {
      aloeQuality.enter();
      if (aloeQuality.quality === 'full' && (dragging || paused || !lastAloeBackdropSource)) aloeQuality.deferFullEntry();
      if (aloeQuality.quality === 'full' && lastAloeBackdropSource && !dragging && !paused) {
        // A previously measured full mode still prepares its real framebuffer
        // resources behind the loader/hidden package gap, never under a finger.
        hideTrialCanvas(); aloePrewarmFrames = 2;
        if (!prepareBackdrop(lastAloeBackdropSource)) { aloeQuality.rejectFull(); cancelAloeTrial(); }
      }
    }
    if (!aloePrewarmFrames) emitStatus('ready');
    reportGeometry(); updatePrefetch(); warmNeighbors();
  };
  const applyAppearance = async (loaded: LoadedProduct, appearance: ProductAppearance | undefined) => {
    const appearanceKey = JSON.stringify(appearance ?? null);
    const thisRevision = (appearanceRevisions.get(loaded) ?? 0) + 1;
    appearanceRevisions.set(loaded, thisRevision);
    appearanceReadiness.set(loaded, false);
    if (loaded === active) appearanceReady = false;
    const startedAt = performance.now();
    mount.dataset.labelCacheHit = poolOf(loaded)?.has(appearance) ? 'true' : 'false';
    updatePrefetch();
    try {
      await loaded.appearance.apply(appearance);
      loaded.appearance.setLiveOverrides?.(liveMaterialOverrides);
      if (disposed || thisRevision !== appearanceRevisions.get(loaded)) return;
      rememberLoaded(loaded.asset, appearance);
      appearanceReadiness.set(loaded, true);
      appliedAppearanceIds.set(loaded, appearance?.id ?? '');
      loaded.root.visible = true;
      if (loaded === active) {
        appearanceReady = true;
        mount.dataset.appearanceId = appliedAppearanceIds.get(loaded) ?? '';
        if (loaded.definitionKey === assetDefinitionKey && appearanceKey === currentAppearanceKey && statusPhase !== 'ready') emitStatus('ready');
      }
      dirty = true;
      if (loaded === active) {
        mount.dataset.labelSwitchMs = String(Math.round(performance.now() - startedAt));
        updatePrefetch(); warmNeighbors();
      }
    } catch {
      if (!disposed && thisRevision === appearanceRevisions.get(loaded)) {
        if (appearance?.requiredSlots?.length) {
          // An outgoing model/older flavor must never fail the newer selection.
          if (loaded.definitionKey !== assetDefinitionKey || appearanceKey !== currentAppearanceKey) return;
          appearanceReadiness.set(loaded, false);
          if (loaded === active) appearanceReady = false;
          loaded.root.visible = false;
          if (loaded === pendingProduct) {
            pendingProduct = null; discard(loaded);
            assetDefinitionKey = '';
            appearanceReady = false;
            if (active) active.root.visible = false;
          }
          failedAppearanceKey = appearanceKey;
          recoverPackageMotion();
          dirty = true;
          emitStatus('error', 'Không áp được nhãn hoặc vật liệu bắt buộc của sản phẩm.');
          return;
        }
        appearanceReadiness.set(loaded, true);
        if (loaded === active) appearanceReady = true;
        emitStatus(statusPhase, 'Không tải được texture; giữ vật liệu gốc.');
      }
    }
  };
  const select = (asset: ProductAsset, appearance?: ProductAppearance) => {
    if (disposed) return;
    if (aloeQuality.probing || aloePrewarmFrames) cancelAloeTrial();
    const nextAssetDefinitionKey = definitionOf(asset);
    const sameAssetDefinition = nextAssetDefinitionKey === assetDefinitionKey;
    assetDefinitionKey = nextAssetDefinitionKey;
    desiredAsset = asset;
    desiredAppearance = appearance;
    const appearanceKey = JSON.stringify(appearance ?? null);
    const retryAppearance = failedAppearanceKey === appearanceKey;
    if (sameAssetDefinition) {
      if (currentAppearanceKey === appearanceKey && !retryAppearance) return;
      currentAppearanceKey = appearanceKey;
      failedAppearanceKey = null;
      if (statusPhase === 'error') emitStatus('loading');
      if (active?.asset.id === asset.id && active.asset.src === asset.src) {
        appearanceReady = false;
        beginCinematic();
        // Resolve appearance immediately while motion turns the print away.
        // It is scoped to this viewer, so multiple viewers never change one another.
        void applyAppearance(active, appearance);
        return;
      } else if (pendingProduct?.asset.id === asset.id) {
        void applyAppearance(pendingProduct, appearance);
        return;
      }
      // A failed pending product was discarded. Retry its geometry as well as
      // the required material; normal in-flight model loads remain deduplicated.
      if (!retryAppearance) return;
    }
    currentAppearanceKey = appearanceKey;
    failedAppearanceKey = null;
    const thisRevision = ++assetRevision;
    warmRevision++; prefetch.setEnabled(false);
    let requiredAppearanceFailure = false;
    discard(pendingProduct); pendingProduct = null;
    poolOf(active)?.setWindow([]);
    beginPackageMotion();
    emitStatus('loading');
    if (active?.definitionKey === nextAssetDefinitionKey) {
      recoverPackageMotion();
      active.asset = asset;
      void applyAppearance(active, appearance);
      return;
    }
    const src = assetUrl(asset.src);
    if (!src) { recoverPackageMotion(); emitStatus('error', 'Đường dẫn model không hợp lệ.'); return; }
    const cached = geometryCache.get(nextAssetDefinitionKey);
    if (cached) geometryCache.delete(nextAssetDefinitionKey);
    // A new geometry replaces the unused cached one, keeping at most two models
    // including the outgoing/current product, rather than caching every flavor.
    if (!cached) {
      geometryCache.forEach(discard); geometryCache.clear();
      mount.dataset.modelLoads = String(++modelLoads);
    }
    const lease = !cached && resourceWindow ? prefetch.acquireUrl(src) : undefined;
    loader.setResourcePath(THREE.LoaderUtils.extractUrlBase(publicUrl(src)));
    const modelRequest = cached ? Promise.resolve(null) : loader.loadAsync(lease?.url ?? publicUrl(src));
    loader.setResourcePath('');
    modelRequest.finally(() => lease?.release()).then(async (gltf) => {
      if (disposed || thisRevision !== assetRevision) {
        if (cached) discard(cached); else if (gltf) disposeProduct(gltf.scene);
        return;
      }
      let loaded: LoadedProduct;
      if (cached) {
        loaded = cached;
        loaded.asset = asset; loaded.root.visible = true;
        loaded.appearance = createHandle(loaded.content, asset);
      } else {
        if (!gltf) return;
        // Lights/cameras from authoring files are not allowed to override presentation.
        const unwanted: THREE.Object3D[] = [];
        gltf.scene.traverse((node) => {
          if (node instanceof THREE.Light || node instanceof THREE.Camera) unwanted.push(node);
        });
        unwanted.forEach((node) => node.removeFromParent());
        const content = new THREE.Group();
        content.add(gltf.scene);
        if (asset.orientation) content.rotation.set(...asset.orientation);
        content.updateMatrixWorld(true);
        const originalBounds = new THREE.Box3().setFromObject(content);
        const dimensions = originalBounds.getSize(new THREE.Vector3());
        if (!Number.isFinite(dimensions.length()) || dimensions.length() <= 0) {
          disposeProduct(content); throw new Error('Model has empty bounds');
        }
        const center = originalBounds.getCenter(new THREE.Vector3());
        content.position.sub(center);
        content.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(content);
        const root = new THREE.Group(); root.add(content);
        const framingPoints = asset.packaging === 'can' ? createRadialProductEnvelope(content, bounds) : undefined;
        loaded = { root, content, bounds, framingPoints, radius: bounds.getBoundingSphere(new THREE.Sphere()).radius, appearance: createHandle(content, asset), asset, definitionKey: nextAssetDefinitionKey };
      }
      poolOf(loaded)?.setWindow((resourceWindow?.ready ?? []).filter(candidate => definitionOf(candidate.asset) === nextAssetDefinitionKey).map(candidate => candidate.appearance));
      // A selection can change while an external label texture is downloading.
      // Keep applying the newest desired appearance until a stable revision is
      // ready; do not activate a result from an older flavor/admin edit.
      let appliedAppearanceKey: string;
      do {
        const appearance = desiredAppearance;
        appliedAppearanceKey = JSON.stringify(appearance ?? null);
        try { await loaded.appearance.apply(appearance); }
        catch (error) {
          if (disposed || thisRevision !== assetRevision) { discard(loaded); return; }
          if (appliedAppearanceKey !== JSON.stringify(desiredAppearance ?? null)) continue;
          if (appearance?.requiredSlots?.length) {
            requiredAppearanceFailure = true;
            appearanceReady = false;
            if (active) active.root.visible = false;
            discard(loaded);
            // Identical selections may retry after failure; a new selection also
            // starts a fresh revision before this rejection reaches outer catch.
            assetDefinitionKey = '';
            failedAppearanceKey = appliedAppearanceKey;
            throw error;
          }
          // Generic optional appearance failures keep the imported PBR.
        }
        if (disposed || thisRevision !== assetRevision) { discard(loaded); return; }
      } while (appliedAppearanceKey !== JSON.stringify(desiredAppearance ?? null));
      loaded.appearance.setLiveOverrides?.(liveMaterialOverrides);
      appearanceReadiness.set(loaded, true);
      appliedAppearanceIds.set(loaded, desiredAppearance?.id ?? '');
      rememberLoaded(asset, desiredAppearance);
      pendingProduct = loaded;
      reportGeometry();
      if (!active || dragging || paused) {
        clearPackageMotion();
        activatePendingProduct();
        if (!active) return;
        currentDistance = fitDistance;
        dirty = true;
      } else {
        beginPackageMotion();
      }
    }).catch(() => {
      if (disposed || thisRevision !== assetRevision) return;
      recoverPackageMotion();
      emitStatus('error', requiredAppearanceFailure ? 'Không áp được nhãn hoặc vật liệu bắt buộc của sản phẩm.' : `Không tải được mô hình ${asset.name}.`);
    });
  };
  const reset = () => {
    cancelAloeTrial();
    activatePendingProduct();
    clearPackageMotion(); currentDistance = fitDistance;
    cinematic = null;
    target.copy(rest);
    lastInputAt = animationTime;
    returnFrom = pose.clone();
    returnElapsed = 0;
    dirty = true;
  };
  const advanceReturn = (dt: number) => {
    if (!returnFrom) return;
    returnElapsed += dt;
    const t = Math.min(1, returnElapsed / presentation.motion.settleSeconds);
    const eased = t * t * t * (10 + t * (-15 + 6 * t));
    pose.copy(returnFrom).slerp(rest, eased);
    if (t === 1) { returnFrom = null; lastInputAt = -Infinity; target.copy(pose); }
    dirty = true;
  };
  const applyRotation = (axis: THREE.Vector3, angle: number) => {
    dragStep.setFromAxisAngle(axis, angle);
    candidate.copy(target).premultiply(dragStep).normalize();
    up.set(0, 1, 0).applyQuaternion(candidate);
    if (up.y >= -0.25) target.copy(candidate);
    dirty = true;
  };
  const interrupt = () => {
    if (aloeQuality.probing || aloePrewarmFrames) cancelAloeTrial();
    // Begin from the visible quaternion, including any rocking/settling.
    cinematic = null; returnFrom = null; target.copy(pose);
    activatePendingProduct();
  };
  const pointerDown = (event: PointerEvent) => {
    if (!active || packageTransition || aloePrewarmFrames || aloeQuality.probing || event.button !== 0 || pointers.has(event.pointerId)) return;
    if ((event.pointerType === 'touch' || event.pointerType === 'pen') && event.target !== hitRegion.element) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    product.updateWorldMatrix(true, true); camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    if (!hitVisibleProduct(raycaster, visibleProductGestureMeshes(active.root))) return;
    interrupt();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { renderer.domElement.setPointerCapture(event.pointerId); }
    catch { pointers.delete(event.pointerId); return; }
    dragging = true;
    hitRegion.beginDrag();
    mount.classList.add('is-dragging');
    lastInputAt = animationTime;
    dirty = true;
  };
  const pointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) return;
    const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1) return;
    dragAxis.set(dy, dx, 0).normalize();
    applyRotation(dragAxis, Math.min(distance * 0.008, 0.24));
    lastInputAt = animationTime;
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    dragging = pointers.size > 0;
    if (!dragging) { hitRegion.endDrag(); mount.classList.remove('is-dragging'); lastInputAt = animationTime; }
    dirty = true;
  };
  const lostCapture = (event: PointerEvent) => {
    // Touch's implicit capture can transfer from the clipped surface to the canvas.
    if (event.target === renderer.domElement) pointerUp(event);
  };
  const cancelPointers = () => {
    const ids = [...pointers.keys()]; pointers.clear(); dragging = false;
    hitRegion.endDrag();
    for (const id of ids) if (renderer.domElement.hasPointerCapture(id)) {
      try { renderer.domElement.releasePointerCapture(id); } catch { /* Pointer cancellation may already release capture. */ }
    }
    mount.classList.remove('is-dragging'); lastInputAt = animationTime; dirty = true;
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); return; }
    if (packageTransition) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); interrupt();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') applyRotation(yawAxis, event.key === 'ArrowLeft' ? -0.16 : 0.16);
    else applyRotation(new THREE.Vector3(1, 0, 0), event.key === 'ArrowUp' ? -0.12 : 0.12);
    lastInputAt = animationTime;
  };
  const render = (now: number) => {
    if (disposed) return;
    const dt = THREE.MathUtils.clamp((now - lastTime) / 1000, 0, 0.035);
    lastTime = now;
    animationTime += dt;
    if (packageTransition && !paused) {
      const move = packageTransition;
      const motion = presentation.motion;
      move.elapsed += dt;
      if (move.phase === 'aim') {
        const t = Math.min(1, move.elapsed / motion.packageAimSeconds);
        const eased = smoothstep(t);
        interpolatePackageAim(move.origin, move.cap, eased, pose);
        product.scale.setScalar(move.fromScale);
        product.position.y = move.fromY * (1 - eased);
        if (t === 1) { move.elapsed -= motion.packageAimSeconds; setPackagePhase('anticipate'); }
      } else if (move.phase === 'anticipate') {
        const t = Math.min(1, move.elapsed / motion.packageAnticipationSeconds);
        const eased = smoothstep(t);
        // A small reverse twist and breath establish momentum before launch.
        pose.copy(move.cap).multiply(spin.setFromAxisAngle(yawAxis, -0.1 * eased));
        product.scale.setScalar(THREE.MathUtils.lerp(move.fromScale, move.launchScale, eased));
        if (t === 1) { move.elapsed -= motion.packageAnticipationSeconds; setPackagePhase('out'); }
      } else if (move.phase === 'out') {
        const t = Math.min(1, move.elapsed / motion.packageOutSeconds);
        const eased = packageExitProgress(t);
        pose.copy(move.cap).multiply(spin.setFromAxisAngle(yawAxis, -0.1 + Math.PI * 2 * eased));
        product.scale.setScalar(THREE.MathUtils.lerp(move.launchScale, 0.01, eased));
        if (t === 1) {
          move.elapsed -= motion.packageOutSeconds; setPackagePhase('hold'); product.visible = false;
        }
      } else if (move.phase === 'hold') {
        // First encounter stays white. Only an already stable white Aloe is
        // qualified, once it leaves the screen during a packaging change.
        if (!aloeQuality.probing && isAloe(active) && lastAloeBackdropSource && !paused && !dragging
          && aloeQuality.beginProbe(now, !product.visible, pointers.size > 0)) {
          hideTrialCanvas();
          if (!prepareBackdrop(lastAloeBackdropSource)) cancelAloeTrial();
        }
        aloeQuality.checkDeadline(now);
        // The minimum 0.2s gap can extend only when the latest network/decode is unfinished.
        if (!aloeQuality.probing && !aloePrewarmFrames && move.elapsed >= motion.packageHoldSeconds && (pendingProduct || waitingAloeEntry)) {
          if (pendingProduct) activatePendingProduct();
          // Refit while invisible; size changes cannot perturb the outgoing or incoming frames.
          currentDistance = fitDistance;
          waitingAloeEntry = Boolean(aloePrewarmFrames);
          if (!waitingAloeEntry) {
            move.elapsed = 0; move.inOrigin.copy(move.cap); move.inScale = 0.01;
            setPackagePhase('in'); product.visible = true;
          }
        }
      } else {
        const t = Math.min(1, move.elapsed / motion.packageInSeconds);
        // A single scale timeline carries momentum through full size into the crest.
        // The pose completes its spin first, keeping the rebound clearly visible.
        pose.copy(move.inOrigin).slerp(rest, smoothstep(t))
          .multiply(spin.setFromAxisAngle(yawAxis, Math.PI * 2 * packageSpinProgress(t)));
        product.scale.setScalar(packageEntryScale(move.elapsed, move.inScale, motion));
        if (t === 1 && move.phase === 'in' && motion.packageBounceAmount > 0) setPackagePhase('bounce');
        const duration = motion.packageInSeconds + (motion.packageBounceAmount > 0 ? motion.packageBounceSeconds : 0);
        if (move.elapsed >= duration) {
          clearPackageMotion(); pose.copy(rest); target.copy(rest); lastInputAt = -Infinity;
        }
      }
      dirty = true;
    } else if (cinematic && !dragging) {
      const move = cinematic;
      move.elapsed += dt;
      const duration = presentation.motion.transitionSeconds;
      const t = Math.min(1, move.elapsed / duration);
      // Minimum-jerk quintic path with inherited angular velocity. Unlike an
      // eased Euler reset it continues from the exact pose on rapid selections.
      const end = presentation.motion.turns * Math.PI * 2;
      const inherited = Math.min(6, Math.max(-2, move.initialVelocity)) * duration;
      const smooth = t * t * t * (10 + t * (-15 + 6 * t));
      const tangent = t * Math.pow(1 - t, 3);
      const angle = end * smooth + inherited * tangent;
      const angularSpeed = (angle - move.angle) / Math.max(dt, 0.001);
      move.angle = angle;
      move.velocity = angularSpeed;
      spin.setFromAxisAngle(yawAxis, angle);
      // Weight shift peaks during acceleration, then relaxes as rotation settles.
      const envelope = Math.sin(Math.PI * t) ** 2;
      rock.setFromEuler(new THREE.Euler(
        Math.sin(t * Math.PI * 2) * presentation.motion.rocking * envelope,
        0,
        Math.sin(t * Math.PI) * presentation.motion.rocking * envelope,
      ));
      pose.copy(move.origin).multiply(spin).premultiply(rock);
      product.position.y = (active?.radius ?? 0.06) * 0.055 * envelope;
      if (!move.swapped && t > 0.43) {
        activatePendingProduct(); move.swapped = true;
      }
      if (t >= 1) {
        activatePendingProduct(); cinematic = null;
        mount.dataset.transitionPhase = 'idle';
        target.copy(pose); lastInputAt = animationTime - presentation.motion.returnDelay;
      }
      dirty = true;
    } else if (dragging) {
      pose.slerp(target, 1 - Math.exp(-dt * 14));
      dirty = true;
    } else if (returnFrom) {
      // Explicit reset/admin pose edits still work while automatic spin is paused.
      advanceReturn(dt);
    } else if (!paused) {
      if (Number.isFinite(lastInputAt) && animationTime - lastInputAt >= presentation.motion.returnDelay) {
        if (!returnFrom) { returnFrom = pose.clone(); returnElapsed = 0; }
        advanceReturn(dt);
      } else if (!Number.isFinite(lastInputAt)) {
        pose.multiply(spin.setFromAxisAngle(yawAxis, dt * presentation.motion.idleSpeed));
      } else pose.slerp(target, 1 - Math.exp(-dt * 10));
      dirty = true;
    }
    if (!cinematic && !packageTransition && product.position.y !== 0) {
      product.position.y *= Math.exp(-dt * 9);
      if (Math.abs(product.position.y) < 0.000001) product.position.y = 0;
      dirty = true;
    }
    product.quaternion.copy(pose);
    const previousDistance = currentDistance;
    currentDistance = THREE.MathUtils.damp(currentDistance, fitDistance, 8, dt);
    if (Math.abs(currentDistance - previousDistance) > 0.000001) dirty = true;
    camera.position.z = currentDistance;
    const model = active ?? pendingProduct;
    if (model) camera.lookAt(new THREE.Vector3(...presentation.camera.target).multiplyScalar(model.radius));
    const quiet = !dragging && !cinematic && !packageTransition && !paused;
    if (aloeQuality.probing || aloePrewarmFrames || (isAloe(active) && aloeQuality.fading && quiet)) dirty = true;
    if (backdrop) {
      try {
        const version = backdrop.texture.version;
        backdrop.update();
        if (backdrop.texture.version !== version) dirty = true;
      } catch (error) {
        if (!aloeQuality.probing && !aloePrewarmFrames && !backdropSource?.adaptiveAloe) throw error;
        aloeQuality.rejectFull('backdrop-update-failed'); cancelAloeTrial(); releaseBackdrop();
      }
    }
    const accentFrame = accents.update({ deltaSeconds: dt, reducedMotion: false, paused,
      ready: Boolean(active && active.definitionKey === assetDefinitionKey && appearanceReady),
      viewerIdle: !cinematic && !packageTransition,
      height: active ? active.bounds.max.y - active.bounds.min.y : 0.1,
      width: active ? Math.max(active.bounds.max.x - active.bounds.min.x, active.bounds.max.z - active.bounds.min.z) : 0.05,
      productRadius: active?.radius ?? 0.1,
      maximumProductScale: packageMaximumScale(presentation.motion.packageAnticipationScale, presentation.motion.packageBounceAmount),
      camera, resolution: [drawingBufferSize.x, drawingBufferSize.y] });
    mount.dataset.accentPhase = accentFrame.phase;
    mount.dataset.accentCount = String(accentFrame.count);
    if (accentFrame.count > 0 && !paused) dirty = true;
    const frameInterval = 1000 / presentation.quality.maxFps;
    const sinceDraw = now - lastDrawTime;
    if (dirty && sinceDraw >= frameInterval) {
      const started = performance.now();
      const hiddenTrial = aloeQuality.probing || aloePrewarmFrames > 0;
      if (isAloe(active) && !hiddenTrial) aloeQuality.advance(Math.min(.035, sinceDraw / 1000), quiet);
      if (backdropSource?.adaptiveAloe && !hiddenTrial) {
        if (aloeQuality.needsBackdrop) {
          if (aloeQuality.mix > 0 && !backdrop && quiet && !prepareBackdrop(backdropSource)) aloeQuality.rejectFull();
        } else if (backdrop) releaseBackdrop();
      }
      hitRegion.update(active && !packageTransition && !hiddenTrial ? active.root : null, camera, mount.clientWidth, mount.clientHeight, now, dragging);
      const beforeTrial = hiddenTrial ? { visible: product.visible, scale: product.scale.clone(), pose: product.quaternion.clone(), position: product.position.clone() } : undefined;
      if (hiddenTrial) {
        // Same default framebuffer/shader and viewport as real viewing. No
        // second model, GPU readback, extra RAF or offscreen shader variant.
        product.visible = true; product.scale.setScalar(1); product.quaternion.copy(rest); product.position.set(0, 0, 0);
      }
      try {
        if (backdrop && waterBackdrop) waterBackdrop.render(backdrop.texture, camera);
        setAloeBottleBackdrop(product, waterBackdrop?.texture ?? null,
          isAloe(active) ? (hiddenTrial ? 1 : aloeQuality.mix) : 1);
        renderBottleScene(renderer, scene, camera);
      } catch (error) {
        if (!hiddenTrial) throw error;
        aloeQuality.rejectFull('trial-render-failed'); cancelAloeTrial(); releaseBackdrop();
      } finally {
        if (beforeTrial) { product.visible = beforeTrial.visible; product.scale.copy(beforeTrial.scale); product.quaternion.copy(beforeTrial.pose); product.position.copy(beforeTrial.position); }
      }
      aloeQuality.frame(now, performance.now() - started,
        hiddenTrial || (isAloe(active) && appearanceReady && environmentReady && !paused && !cinematic && !packageTransition && document.hidden === false && visible));
      if (hiddenCanvasOpacity !== undefined && !aloeQuality.probing) {
        if (aloePrewarmFrames > 0) aloePrewarmFrames--;
        if (!aloePrewarmFrames) {
          revealTrialCanvas();
          if (!backdropSource) releaseBackdrop();
          else if (!backdropSource.adaptiveAloe) prepareBackdrop(backdropSource);
          else if (!aloeQuality.needsBackdrop) releaseBackdrop();
          if (active?.definitionKey === assetDefinitionKey && appearanceReady) emitStatus('ready');
        }
      }
      reportAloeQuality();
      mount.dataset.viewerReady = active ? 'true' : 'false';
      sampleDraws++;
      if (previousDrawAt) sampleLongestGap = Math.max(sampleLongestGap, now - previousDrawAt);
      previousDrawAt = now;
      if (now - frameSampleAt >= 1000) {
        mount.dataset.viewerFps = String(Math.round(sampleDraws * 1000 / (now - frameSampleAt)));
        mount.dataset.viewerFrameGapMs = String(Math.round(sampleLongestGap));
        sampleDraws = 0; sampleLongestGap = 0; frameSampleAt = now;
      }
      // Preserve the cap's clock phase. Resetting it to every jittered RAF
      // timestamp can skip alternate 60 Hz frames and look like a 30 FPS cap.
      lastDrawTime = now - (sinceDraw % frameInterval); dirty = false;
    }
  };
  const syncVisibility = () => {
    if (document.hidden || !visible) { cancelAloeTrial(); cancelPointers(); hitRegion.clear(); }
    aloeQuality.resetCadence();
    renderer.setAnimationLoop(!document.hidden && visible ? render : null);
    lastTime = performance.now();
    frameSampleAt = lastTime; sampleDraws = 0; previousDrawAt = 0; sampleLongestGap = 0;
    dirty = true;
    updatePrefetch(); warmNeighbors();
  };
  const contextLost = (event: Event) => {
    event.preventDefault(); renderer.setAnimationLoop(null);
    cancelAloeTrial();
    cancelPointers();
    emitStatus('error', 'Phiên 3D bị gián đoạn. Tải lại trang để khôi phục.');
  };
  mount.addEventListener('pointerdown', pointerDown);
  mount.addEventListener('pointermove', pointerMove);
  mount.addEventListener('pointerup', pointerUp);
  mount.addEventListener('pointercancel', pointerUp);
  mount.addEventListener('lostpointercapture', lostCapture);
  renderer.domElement.addEventListener('keydown', keyDown);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', syncVisibility);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncVisibility(); });
  intersection.observe(mount);
  configure(presentation);
  pose.copy(rest); target.copy(rest); product.quaternion.copy(rest);
  syncVisibility();

  return {
    select,
    materials(overrides = {}) {
      liveMaterialOverrides = overrides;
      active?.appearance.setLiveOverrides?.(overrides);
      dirty = true;
    },
    resources(value) {
      resourceWindow = value;
      prefetch.configure(value?.files ?? []);
      updatePrefetch(); warmNeighbors();
      if (!value) { geometryCache.forEach(discard); geometryCache.clear(); }
    },
    configure,
    backdrop: setBackdrop,
    accents: (value, key, flavor) => accents.configure(value, key, flavor),
    pause(value) {
      paused = value;
      if (paused) {
        cancelAloeTrial();
        const changingPackage = Boolean(packageTransition);
        cinematic = null; clearPackageMotion(); activatePendingProduct(); currentDistance = fitDistance;
        if (changingPackage) pose.copy(rest);
        target.copy(pose);
      }
      dirty = true;
      updatePrefetch(); warmNeighbors();
    },
    reset,
    dispose() {
      if (disposed) return;
      cancelAloeTrial();
      disposed = true; assetRevision += 1; environmentRevision += 1;
      warmRevision++; prefetch.dispose();
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      cancelPointers();
      mount.removeEventListener('pointerdown', pointerDown);
      mount.removeEventListener('pointermove', pointerMove);
      mount.removeEventListener('pointerup', pointerUp);
      mount.removeEventListener('pointercancel', pointerUp);
      mount.removeEventListener('lostpointercapture', lostCapture);
      renderer.domElement.removeEventListener('keydown', keyDown);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      discard(active); discard(pendingProduct);
      geometryCache.forEach(discard); geometryCache.clear();
      accents.dispose();
      setAloeBottleBackdrop(product, null);
      backdrop?.dispose(); backdrop = undefined;
      waterBackdrop?.dispose(); waterBackdrop = undefined;
      ownedEnvironmentTargets.forEach((target) => target.dispose());
      environmentTargets.clear();
      pmrem.dispose(); draco.dispose(); basis.dispose();
      hitRegion.dispose(); renderer.dispose(); renderer.domElement.remove();
      mount.classList.remove('is-dragging');
    },
  };
}
