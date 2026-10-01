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
import { createProductFramingFrames, createRadialProductEnvelope, fitProductCamera, interpolatePackageAim } from './framing';
import { packageCapPose, packageEntryScale, packageExitProgress, packageMaximumScale, packageSpinProgress, smoothstep } from './package-motion';
import { createDaylightEnvironment, environmentCacheKey } from './environment';
import { createAccentLayer } from './accent-layer';
import type { AccentFlavor, ProductAccentSceneInput } from './accent-config';
import { createBackdropTexture, type ProductViewerBackdropInput } from './backdrop-texture';
import { createWaterBackdropPass } from './water-backdrop-pass';

export interface ViewerStatus {
  phase: 'loading' | 'ready' | 'error';
  assetId: string;
  message?: string;
  environmentReady?: boolean;
  hasProduct?: boolean;
}
export interface ProductViewerController {
  select(asset: ProductAsset, appearance?: ProductAppearance): void;
  configure(presentation: ViewerPresentation): void;
  accents(scene: ProductAccentSceneInput | undefined, key: string, flavor: AccentFlavor): void;
  backdrop(source?: ProductViewerBackdropInput): void;
  pause(paused: boolean): void;
  reset(): void;
  dispose(): void;
}
type LoadedProduct = { root: THREE.Group; content: THREE.Group; appearance: AppearanceHandle; asset: ProductAsset; definitionKey: string; bounds: THREE.Box3; radius: number; framingPoints?: THREE.Vector3[] };
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
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  mount.appendChild(renderer.domElement);
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
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  let disposed = false;
  let paused = false;
  let visible = true;
  let dragging = false;
  let dirty = true;
  let animationTime = 0;
  let lastTime = performance.now();
  let lastDrawTime = 0;
  let lastInputAt = -Infinity;
  let returnFrom: THREE.Quaternion | null = null;
  let returnElapsed = 0;
  let cinematic: Transition | null = null;
  let packageTransition: PackageTransition | null = null;
  let active: LoadedProduct | null = null;
  let pendingProduct: LoadedProduct | null = null;
  let desiredAsset: ProductAsset | null = null;
  let assetDefinitionKey = '';
  let desiredAppearance: ProductAppearance | undefined;
  let assetRevision = 0;
  const appearanceRevisions = new WeakMap<LoadedProduct, number>();
  const appearanceReadiness = new WeakMap<LoadedProduct, boolean>();
  let currentAppearanceKey = '';
  let appearanceReady = true;
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
  const accents = createAccentLayer(scene, loader, () => { dirty = true; });
  const drawingBufferSize = new THREE.Vector2(1, 1);
  let backdrop: ReturnType<typeof createBackdropTexture> | undefined;
  let waterBackdrop: ReturnType<typeof createWaterBackdropPass> | undefined;
  let backdropSource: ProductViewerBackdropInput | undefined;
  let backdropSignature = '';
  const setBackdrop = (source?: ProductViewerBackdropInput) => {
    if (disposed) return;
    const signature = JSON.stringify(source?.config ?? null);
    if (source?.state === backdropSource?.state && signature === backdropSignature) return;
    accents.setBackdrop(null);
    backdrop?.dispose();
    waterBackdrop?.dispose(); waterBackdrop = undefined;
    backdrop = undefined; backdropSource = source; backdropSignature = signature;
    if (source) {
      try {
        backdrop = createBackdropTexture(source.state, source.config, mount);
        waterBackdrop = createWaterBackdropPass(renderer, scene, product);
        accents.setBackdrop(waterBackdrop.texture);
      } catch {
        // Optional decorative refraction must not prevent the product loading.
        backdrop?.dispose(); backdrop = undefined;
        waterBackdrop?.dispose(); waterBackdrop = undefined;
      }
    }
    dirty = true;
  };

  const emitStatus = (phase: ViewerStatus['phase'], message?: string) => {
    statusPhase = phase; statusMessage = message;
    if (!disposed && desiredAsset) status({ phase, assetId: desiredAsset.id, message, environmentReady, hasProduct: Boolean(active) });
  };
  const discard = (loaded: LoadedProduct | null) => {
    if (!loaded) return;
    loaded.root.removeFromParent();
    loaded.appearance.dispose();
    disposeProduct(loaded.root);
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
    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? presentation.quality.mobileDpr : presentation.quality.maxDpr));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(drawingBufferSize);
    camera.aspect = width / height;
    fitCamera();
    camera.updateProjectionMatrix();
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
    if (reducedMotion || dragging || paused || packageTransition) { dirty = true; return; }
    const velocity = cinematic?.velocity ?? presentation.motion.idleSpeed;
    cinematic = { origin: pose.clone(), angle: 0, velocity, initialVelocity: velocity, elapsed: 0, swapped: false };
    returnFrom = null;
    mount.dataset.transitionPhase = 'flavor';
    dirty = true;
  };
  const clearPackageMotion = () => {
    packageTransition = null;
    product.scale.setScalar(1); product.visible = true; product.position.y = 0;
    mount.dataset.transitionPhase = 'idle';
    dirty = true;
  };
  const setPackagePhase = (phase: PackageTransition['phase']) => {
    if (packageTransition) packageTransition.phase = phase;
    mount.dataset.transitionPhase = `package-${phase}`;
  };
  const beginPackageMotion = () => {
    if (!active || paused || reducedMotion || dragging) return;
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
    discard(active);
    active = pendingProduct;
    pendingProduct = null;
    product.add(active.root);
    appearanceReady = appearanceReadiness.get(active) ?? true;
    mount.dataset.productId = active.asset.id;
    fitCamera();
    emitStatus('ready');
  };
  const applyAppearance = async (loaded: LoadedProduct, appearance: ProductAppearance | undefined) => {
    const thisRevision = (appearanceRevisions.get(loaded) ?? 0) + 1;
    appearanceRevisions.set(loaded, thisRevision);
    appearanceReadiness.set(loaded, false);
    if (loaded === active) appearanceReady = false;
    try {
      await loaded.appearance.apply(appearance);
      if (disposed || thisRevision !== appearanceRevisions.get(loaded)) return;
      appearanceReadiness.set(loaded, true);
      if (loaded === active) appearanceReady = true;
      dirty = true;
    } catch {
      if (!disposed && thisRevision === appearanceRevisions.get(loaded)) {
        appearanceReadiness.set(loaded, true);
        if (loaded === active) appearanceReady = true;
        emitStatus(statusPhase, 'Không tải được texture; giữ vật liệu gốc.');
      }
    }
  };
  const select = (asset: ProductAsset, appearance?: ProductAppearance) => {
    if (disposed) return;
    const nextAssetDefinitionKey = JSON.stringify({ id: asset.id, src: asset.src, slots: asset.materialSlots, orientation: asset.orientation });
    const sameAssetDefinition = nextAssetDefinitionKey === assetDefinitionKey;
    assetDefinitionKey = nextAssetDefinitionKey;
    desiredAsset = asset;
    desiredAppearance = appearance;
    const appearanceKey = JSON.stringify(appearance ?? null);
    if (sameAssetDefinition) {
      if (currentAppearanceKey === appearanceKey) return;
      currentAppearanceKey = appearanceKey;
      if (active?.asset.id === asset.id && active.asset.src === asset.src) {
        appearanceReady = false;
        beginCinematic();
        // Resolve appearance immediately while motion turns the print away.
        // It is scoped to this viewer, so multiple viewers never change one another.
        void applyAppearance(active, appearance);
      } else if (pendingProduct?.asset.id === asset.id) void applyAppearance(pendingProduct, appearance);
      return;
    }
    currentAppearanceKey = appearanceKey;
    const thisRevision = ++assetRevision;
    discard(pendingProduct); pendingProduct = null;
    beginPackageMotion();
    emitStatus('loading');
    const src = assetUrl(asset.src);
    if (!src) { recoverPackageMotion(); emitStatus('error', 'Đường dẫn model không hợp lệ.'); return; }
    loader.loadAsync(publicUrl(src)).then(async (gltf) => {
      if (disposed || thisRevision !== assetRevision) { disposeProduct(gltf.scene); return; }
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
      const loaded: LoadedProduct = { root, content, bounds, framingPoints, radius: bounds.getBoundingSphere(new THREE.Sphere()).radius, appearance: createAppearanceHandle(content, asset), asset, definitionKey: nextAssetDefinitionKey };
      // A selection can change while an external label texture is downloading.
      // Keep applying the newest desired appearance until a stable revision is
      // ready; do not activate a result from an older flavor/admin edit.
      let appliedAppearanceKey: string;
      do {
        const appearance = desiredAppearance;
        appliedAppearanceKey = JSON.stringify(appearance ?? null);
        try { await loaded.appearance.apply(appearance); }
        catch { /* Keep imported PBR if this optional texture cannot be loaded. */ }
        if (disposed || thisRevision !== assetRevision) { discard(loaded); return; }
      } while (appliedAppearanceKey !== JSON.stringify(desiredAppearance ?? null));
      appearanceReadiness.set(loaded, true);
      pendingProduct = loaded;
      if (!active || reducedMotion || dragging || paused) {
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
      emitStatus('error', `Không tải được mô hình ${asset.name}.`);
    });
  };
  const reset = () => {
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
    // Begin from the visible quaternion, including any rocking/settling.
    cinematic = null; returnFrom = null; target.copy(pose);
    activatePendingProduct();
  };
  const pointerDown = (event: PointerEvent) => {
    if (!active || packageTransition || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.intersectObject(product, true).length) return;
    interrupt();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.domElement.setPointerCapture(event.pointerId);
    dragging = true;
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
    if (!dragging) { mount.classList.remove('is-dragging'); lastInputAt = animationTime; }
    dirty = true;
  };
  const lostCapture = () => {
    if (!pointers.size) return;
    pointers.clear(); dragging = false;
    mount.classList.remove('is-dragging'); lastInputAt = animationTime;
    dirty = true;
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
    if (packageTransition && !paused && !reducedMotion) {
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
        // The minimum 0.2s gap can extend only when the latest network/decode is unfinished.
        if (move.elapsed >= motion.packageHoldSeconds && pendingProduct) {
          activatePendingProduct();
          // Refit while invisible; size changes cannot perturb the outgoing or incoming frames.
          currentDistance = fitDistance;
          move.elapsed = 0; move.inOrigin.copy(move.cap); move.inScale = 0.01;
          setPackagePhase('in'); product.visible = true;
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
    } else if (cinematic && !dragging && !reducedMotion) {
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
      pose.slerp(target, reducedMotion ? 1 : 1 - Math.exp(-dt * 14));
      dirty = true;
    } else if (returnFrom && !reducedMotion) {
      // Explicit reset/admin pose edits still work while automatic spin is paused.
      advanceReturn(dt);
    } else if (!paused && !reducedMotion) {
      if (Number.isFinite(lastInputAt) && animationTime - lastInputAt >= presentation.motion.returnDelay) {
        if (!returnFrom) { returnFrom = pose.clone(); returnElapsed = 0; }
        advanceReturn(dt);
      } else if (!Number.isFinite(lastInputAt)) {
        pose.multiply(spin.setFromAxisAngle(yawAxis, dt * presentation.motion.idleSpeed));
      } else pose.slerp(target, 1 - Math.exp(-dt * 10));
      dirty = true;
    } else if (reducedMotion && dirty) {
      pose.slerp(target, 1);
      activatePendingProduct();
    }
    if (!cinematic && !packageTransition && product.position.y !== 0) {
      product.position.y *= Math.exp(-dt * 9);
      if (Math.abs(product.position.y) < 0.000001) product.position.y = 0;
      dirty = true;
    }
    product.quaternion.copy(pose);
    const previousDistance = currentDistance;
    currentDistance = reducedMotion ? fitDistance : THREE.MathUtils.damp(currentDistance, fitDistance, 8, dt);
    if (Math.abs(currentDistance - previousDistance) > 0.000001) dirty = true;
    camera.position.z = currentDistance;
    const model = active ?? pendingProduct;
    if (model) camera.lookAt(new THREE.Vector3(...presentation.camera.target).multiplyScalar(model.radius));
    if (backdrop) {
      const version = backdrop.texture.version;
      backdrop.update();
      if (backdrop.texture.version !== version) dirty = true;
    }
    const accentFrame = accents.update({ deltaSeconds: dt, reducedMotion, paused,
      ready: Boolean(active && active.definitionKey === assetDefinitionKey && appearanceReady),
      viewerIdle: !cinematic && !packageTransition,
      height: active ? active.bounds.max.y - active.bounds.min.y : 0.1,
      width: active ? Math.max(active.bounds.max.x - active.bounds.min.x, active.bounds.max.z - active.bounds.min.z) : 0.05,
      productRadius: active?.radius ?? 0.1,
      maximumProductScale: packageMaximumScale(presentation.motion.packageAnticipationScale, presentation.motion.packageBounceAmount),
      camera, resolution: [drawingBufferSize.x, drawingBufferSize.y] });
    mount.dataset.accentPhase = accentFrame.phase;
    mount.dataset.accentCount = String(accentFrame.count);
    if (accentFrame.count > 0 && !paused && !reducedMotion) dirty = true;
    if (dirty && now - lastDrawTime >= 1000 / presentation.quality.maxFps) {
      if (backdrop && waterBackdrop) waterBackdrop.render(backdrop.texture, camera);
      renderer.render(scene, camera);
      mount.dataset.viewerReady = active ? 'true' : 'false';
      lastDrawTime = now; dirty = false;
    }
  };
  const syncVisibility = () => {
    renderer.setAnimationLoop(!document.hidden && visible ? render : null);
    lastTime = performance.now();
    dirty = true;
  };
  const motionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    if (reducedMotion) { cinematic = null; clearPackageMotion(); activatePendingProduct(); currentDistance = fitDistance; target.copy(rest); }
    dirty = true;
  };
  const contextLost = (event: Event) => {
    event.preventDefault(); renderer.setAnimationLoop(null);
    emitStatus('error', 'Phiên 3D bị gián đoạn. Tải lại trang để khôi phục.');
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('lostpointercapture', lostCapture);
  renderer.domElement.addEventListener('keydown', keyDown);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', syncVisibility);
  motionQuery.addEventListener('change', motionChange);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncVisibility(); });
  intersection.observe(mount);
  configure(presentation);
  pose.copy(rest); target.copy(rest); product.quaternion.copy(rest);
  syncVisibility();

  return {
    select,
    configure,
    backdrop: setBackdrop,
    accents: (value, key, flavor) => accents.configure(value, key, flavor),
    pause(value) {
      paused = value;
      if (paused) {
        const changingPackage = Boolean(packageTransition);
        cinematic = null; clearPackageMotion(); activatePendingProduct(); currentDistance = fitDistance;
        if (changingPackage) pose.copy(rest);
        target.copy(pose);
      }
      dirty = true;
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true; assetRevision += 1; environmentRevision += 1;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      motionQuery.removeEventListener('change', motionChange);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('lostpointercapture', lostCapture);
      renderer.domElement.removeEventListener('keydown', keyDown);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      discard(active); discard(pendingProduct);
      accents.dispose();
      backdrop?.dispose(); backdrop = undefined;
      waterBackdrop?.dispose(); waterBackdrop = undefined;
      ownedEnvironmentTargets.forEach((target) => target.dispose());
      environmentTargets.clear();
      pmrem.dispose(); draco.dispose(); basis.dispose();
      renderer.dispose(); renderer.domElement.remove();
      mount.classList.remove('is-dragging');
    },
  };
}
