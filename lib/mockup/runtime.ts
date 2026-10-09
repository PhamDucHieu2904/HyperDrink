import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { publicUrl } from '../public-url';
import { assetUrl, DEFAULT_VIEWER_PRESENTATION, type ProductAppearance, type ProductAsset } from '../viewer-config';
import { disposeProduct } from '../viewer/appearance';
import type { LiveMaterialOverrides } from '../viewer/material-adjustments';
import { createPooledAppearanceHandle, type PooledAppearanceHandle } from '../viewer/pooled-appearance';
import { createResourcePrefetcher } from '../viewer/resource-prefetch';
import { createDaylightEnvironment } from '../viewer/environment';
import { createProductHitRegion, hitVisibleProduct, visibleProductGestureMeshes } from '../viewer/product-hit-region';
import { renderBottleScene } from '../viewer/bottle-materials';
import { createBackdropTexture, type ProductViewerBackdropInput } from '../viewer/backdrop-texture';
import { setAloeBottleBackdrop } from '../viewer/aloe-bottle-materials';
import { fitMockupCamera, mockupCameraDirection, mockupOrbitBounds, mockupShowcaseBounds, normalizeMockupAspect } from './camera';
import { MOCKUP_FOCAL_FOV } from './focal-length';
import { createMockupCaptureGate, encodeMockupPng, mockupAbortError, mockupCaptureSize } from './capture';
import { disposeMockupDetachedTextures, neutralizeMockupLabelArtwork } from './appearance';
import { mockupModelKey, mockupSelectionKey } from './selection';
import type { MockupAnimation, MockupBackground, MockupCameraPreset, MockupFocalPreset, MockupRuntime, MockupRuntimeOptions, MockupStatus } from './contracts';

type LoadedModel = {
  root: THREE.Group; content: THREE.Group; asset: ProductAsset; key: string;
  bounds: THREE.Box3; radius: number; pool: PooledAppearanceHandle;
  recent: (ProductAppearance | undefined)[];
  committedAppearance?: ProductAppearance;
  detachedTextures: Set<THREE.Texture>;
};
const modelKey = mockupModelKey;
const safeColor = (color: string | undefined, fallback: string) => color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
const abortable = <T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
  const abort = () => finish(undefined, mockupAbortError());
  const timer = setTimeout(() => finish(undefined, new Error('3D operation timed out')), timeoutMs);
  let done = false;
  function finish(value?: T, error?: unknown) {
    if (done) return;
    done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
    if (error) reject(error); else resolve(value as T);
  }
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  promise.then(value => finish(value), error => finish(undefined, error));
});

/**
 * Studio owns its camera and motion. Shared appearance/environment modules own
 * their resources. Showcase shares the homepage pose/input without its decorations.
 */
export function createMockupRuntime(host: HTMLDivElement, options: MockupRuntimeOptions): MockupRuntime {
  const settings = DEFAULT_VIEWER_PRESENTATION;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const capacity = mobile ? 3 : 5;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  const linearType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  host.dataset.mockupQuality = linearType === THREE.HalfFloatType ? 'standard' : 'compatible';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = settings.exposure;
  renderer.setClearColor('#000000', 0);
  renderer.autoClear = true;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.0001, 100);
  camera.position.set(0, 0.01, 0.4);
  // Three caches transmission buffers per camera ID; reuse one export camera
  // so repeated PNG captures do not retain another full-size buffer each time.
  const captureCamera = camera.clone();
  const product = new THREE.Group(); scene.add(product);
  const hitRegion = createProductHitRegion(host);
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...settings.pose, 'YXZ'));
  const pose = new THREE.Quaternion(), targetPose = new THREE.Quaternion();
  const spin = new THREE.Quaternion(), dragStep = new THREE.Quaternion(), candidatePose = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0), dragAxis = new THREE.Vector3(), up = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false, motionTime = 0, lastInputAt = -Infinity, returnElapsed = 0;
  let returnFrom: THREE.Quaternion | null = null;
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minPolarAngle = 0.04; controls.maxPolarAngle = Math.PI - 0.04;
  controls.rotateSpeed = 0.65; controls.zoomSpeed = 0.8;
  // Page scrolling and browser pinch zoom remain available over the preview.
  canvas.style.touchAction = 'pan-y pinch-zoom';
  const lights = settings.lights.map(light => {
    const result = light.type === 'hemisphere' ? new THREE.HemisphereLight(light.color, light.groundColor, light.intensity)
      : new THREE.DirectionalLight(light.color, light.intensity);
    scene.add(result); return result;
  });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const draco = new DRACOLoader().setDecoderPath(publicUrl(settings.decoders.dracoPath)).setWorkerLimit(2);
  const basis = new KTX2Loader().setTranscoderPath(publicUrl(settings.decoders.basisPath)).setWorkerLimit(2).detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder);
  const captureGate = createMockupCaptureGate();
  const prefetch = createResourcePrefetcher({ maxCandidates: capacity, onDiagnostics(value) {
    host.dataset.prefetchFiles = String(value.entries); host.dataset.prefetchBytes = String(value.bytes);
  } });
  prefetch.setEnabled(false);
  let disposed = false;
  let contextLost = false;
  let visible = true;
  let revision = 0;
  let readyRevision = -1;
  let active: LoadedModel | null = null;
  let cached: LoadedModel | null = null;
  const candidates = new Set<LoadedModel>();
  const discarded = new WeakSet<LoadedModel>();
  let desired: { asset: ProductAsset; appearance?: ProductAppearance; frontYaw: number } | null = null;
  let queuedSelection: { asset: ProductAsset; appearance?: ProductAppearance; frontYaw: number } | null = null;
  let desiredKey = '';
  let materialOverrides: LiveMaterialOverrides = {};
  let request: AbortController | null = null;
  let exportAbort: AbortController | null = null;
  let aspect = 1;
  let fitDistance = 0.4;
  let animation: MockupAnimation = { mode: 'off', speed: 1, playing: false };
  let focal: MockupFocalPreset = 'standard';
  let raf = 0;
  let dirty = true;
  let lastTime = performance.now();
  let lastDraw = 0;
  let environmentTarget: THREE.WebGLRenderTarget | null = null;
  let environmentRevision = 0;
  let previewTarget: THREE.WebGLRenderTarget | null = null;
  let statusPhase: MockupStatus['phase'] = 'loading-model';
  let renderFrames = 0;
  let lastFrameMs = 0;
  let diagnosticsAt = 0;
  const warmedTextures = new WeakSet<THREE.Texture>();
  const usesWhiteLiquidPreview = () => active?.asset.packaging === 'pet'
    && active.asset.materialSlots?.liquid?.includes('Aloe Vera Water') === true;
  let backdropSource: ProductViewerBackdropInput | undefined;
  let backdropSignature = '';
  let backdrop: ReturnType<typeof createBackdropTexture> | undefined;
  const clearBackdrop = () => {
    setAloeBottleBackdrop(product, null);
    backdrop?.dispose(); backdrop = undefined;
  };

  // Preview and PNG share one output stage. Scene radiance is linear half float;
  // this final stage applies the runtime's exact tone map and sRGB transfer once.
  // MSAA resolves transparent edges as premultiplied radiance, so unpremultiply
  // before nonlinear tone/color transforms, then compose the chosen background.
  const outputUniforms = {
    ...THREE.UniformsUtils.clone(OutputShader.uniforms),
    backgroundTop: { value: new THREE.Color('#ffffff') },
    backgroundBottom: { value: new THREE.Color('#ffffff') },
    backgroundAlpha: { value: 1 },
  };
  const outputMaterial = new THREE.RawShaderMaterial({
    name: 'Mockup PNG output', uniforms: outputUniforms,
    vertexShader: OutputShader.vertexShader,
    fragmentShader: OutputShader.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform vec3 backgroundTop;\nuniform vec3 backgroundBottom;\nuniform float backgroundAlpha;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\nif (gl_FragColor.a > 0.00001) gl_FragColor.rgb /= gl_FragColor.a; else gl_FragColor.rgb = vec3(0.0);')
      .replace(/\}\s*$/, '\nvec3 backdrop = mix(backgroundBottom, backgroundTop, vUv.y);\n#ifdef SRGB_TRANSFER\nbackdrop = sRGBTransferOETF(vec4(backdrop, 1.0)).rgb;\n#endif\nif (backgroundAlpha > 0.5) { gl_FragColor.rgb = mix(backdrop, gl_FragColor.rgb, gl_FragColor.a); gl_FragColor.a = 1.0; }\n}'),
    defines: { NEUTRAL_TONE_MAPPING: '', SRGB_TRANSFER: '' },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const outputQuad = new FullScreenQuad(outputMaterial);
  const sampleDiagnostics = () => {
    host.dataset.renderFrames = String(renderFrames); host.dataset.frameMs = lastFrameMs.toFixed(2);
    host.dataset.geometryCount = String(renderer.info.memory.geometries); host.dataset.textureCount = String(renderer.info.memory.textures);
    diagnosticsAt = performance.now();
  };
  const emit = (phase: MockupStatus['phase'], error?: MockupStatus['error'], message?: string) => {
    statusPhase = phase; host.dataset.mockupPhase = phase; host.dataset.viewerReady = phase === 'ready' ? 'true' : 'false';
    host.dataset.modelPoolSize = String(Number(Boolean(active)) + Number(Boolean(cached)) + candidates.size);
    sampleDiagnostics();
    if (!disposed) options.onStatus({ phase, assetId: desired?.asset.id ?? '', appearanceId: desired?.appearance?.id ?? '', selectionKey: desiredKey, revision, hasProduct: Boolean(active), materials: phase === 'ready' ? active?.pool.materialValues?.() : undefined, error, message });
  };
  const isVisible = () => !disposed && !contextLost && visible && !document.hidden;
  const moving = () => Boolean(active) && !captureGate.busy && (animation.playing && animation.mode !== 'off'
    || animation.mode === 'showcase' && (dragging || Boolean(returnFrom) || pose.angleTo(targetPose) > 0.00001 && Number.isFinite(lastInputAt)));
  const requestRender = () => {
    dirty = true;
    if (!raf && isVisible() && !captureGate.busy) raf = requestAnimationFrame(frame);
  };
  const pauseFromInteraction = (manual = true) => {
    const wasPlaying = animation.playing;
    if (animation.mode !== 'showcase') {
      if (wasPlaying) animation = { ...animation, playing: false };
      if (manual || wasPlaying) options.onInteraction?.();
    }
    lastTime = performance.now(); requestRender();
  };
  const createLinearTarget = (width: number, height: number) => new THREE.WebGLRenderTarget(width, height, {
    type: linearType, format: THREE.RGBAFormat, depthBuffer: true,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const renderTo = (linear: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null, view: THREE.PerspectiveCamera) => {
    // Borrow the decorative background only for the transparent preview.
    // Native PNG and solid backgrounds retain the linear/MSAA pipeline.
    if (output === null && usesWhiteLiquidPreview() && outputUniforms.backgroundAlpha.value === 0) {
      if (backdropSource) {
        backdrop ??= createBackdropTexture(backdropSource.state, backdropSource.config, host);
        backdrop.update(); setAloeBottleBackdrop(product, backdrop.texture);
      } else setAloeBottleBackdrop(product, null);
      renderer.setRenderTarget(null); renderer.setClearColor('#000000', 0); renderer.clear();
      renderBottleScene(renderer, scene, view); return;
    }
    setAloeBottleBackdrop(product, null);
    renderer.setRenderTarget(linear); renderer.setClearColor('#000000', 0); renderer.clear();
    renderBottleScene(renderer, scene, view);
    outputUniforms.tDiffuse.value = linear.texture;
    outputUniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(output); renderer.clear(); outputQuad.render(renderer);
  };
  function frame(now: number) {
    raf = 0;
    if (!isVisible() || captureGate.busy) return;
    const dt = Math.min(0.06, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    if (moving()) {
      if (animation.mode === 'showcase') {
        motionTime += dt;
        if (dragging) pose.slerp(targetPose, 1 - Math.exp(-dt * 14));
        else if (returnFrom) {
          returnElapsed += dt;
          const t = Math.min(1, returnElapsed / settings.motion.settleSeconds);
          pose.copy(returnFrom).slerp(rest, t * t * t * (10 + t * (-15 + 6 * t)));
          if (t === 1) { returnFrom = null; lastInputAt = -Infinity; targetPose.copy(pose); }
        } else if (animation.playing && Number.isFinite(lastInputAt) && motionTime - lastInputAt >= settings.motion.returnDelay) {
          returnFrom = pose.clone(); returnElapsed = 0;
        } else if (animation.playing && !Number.isFinite(lastInputAt)) {
          pose.multiply(spin.setFromAxisAngle(yawAxis, dt * animation.speed * settings.motion.idleSpeed));
        } else pose.slerp(targetPose, 1 - Math.exp(-dt * 10));
        product.quaternion.copy(pose);
      } else product.rotation.y = (product.rotation.y + dt * animation.speed * 0.65) % (Math.PI * 2);
      dirty = true;
    }
    if (dirty && previewTarget && now - lastDraw >= 1000 / (mobile ? 30 : 60)) {
      const started = performance.now();
      hitRegion.update(animation.mode === 'showcase' ? active?.root ?? null : null, camera, host.clientWidth, host.clientHeight, now, dragging);
      renderTo(previewTarget, null, camera);
      lastFrameMs = performance.now() - started; renderFrames++;
      if (now - diagnosticsAt >= 1000) sampleDiagnostics();
      lastDraw = now; dirty = false;
    }
    // OrbitControls may request a frame from its synchronous change event.
    // Reuse that request instead of starting a second animation chain.
    if ((moving() || dirty) && !raf) raf = requestAnimationFrame(frame);
  }
  const fit = (preset?: MockupCameraPreset) => {
    if (!active) return;
    const direction = preset === 'front' && animation.mode === 'showcase' ? new THREE.Vector3(0, 0, 1)
      : preset ? mockupCameraDirection(preset).applyAxisAngle(yawAxis, product.rotation.y)
      : camera.position.clone().sub(controls.target).normalize();
    const tilted = animation.mode === 'showcase' || Math.abs(product.rotation.x) + Math.abs(product.rotation.z) > 0.00001;
    const bounds = tilted ? mockupShowcaseBounds(active.bounds, animation.mode === 'showcase' ? rest : product.quaternion) : mockupOrbitBounds(active.bounds);
    const nextDistance = fitMockupCamera(bounds, direction, aspect, camera.fov);
    const ratio = preset ? 1 : camera.position.distanceTo(controls.target) / Math.max(fitDistance, 0.0001);
    fitDistance = nextDistance;
    controls.target.copy(active.bounds.getCenter(new THREE.Vector3()));
    camera.position.copy(controls.target).addScaledVector(direction, nextDistance * Math.min(6, Math.max(0.45, ratio)));
    controls.minDistance = Math.max(active.radius * 1.1, nextDistance * 0.35);
    controls.maxDistance = nextDistance * 6;
    camera.near = Math.max(0.00001, active.radius * 0.005); camera.far = Math.max(10, nextDistance * 30);
    camera.updateProjectionMatrix(); camera.lookAt(controls.target); controls.update();
    requestRender();
  };
  const resize = () => {
    if (disposed || captureGate.busy) return;
    const width = Math.max(1, Math.round(host.clientWidth));
    const height = Math.max(1, Math.round(width / aspect));
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!previewTarget) previewTarget = createLinearTarget(size.x, size.y); else previewTarget.setSize(size.x, size.y);
    camera.aspect = aspect; camera.updateProjectionMatrix(); fit(); requestRender();
  };
  const discard = (model: LoadedModel | null) => {
    if (!model || discarded.has(model)) return;
    setAloeBottleBackdrop(model.root, null);
    discarded.add(model);
    candidates.delete(model); model.root.removeFromParent(); model.pool.dispose(); disposeProduct(model.root); disposeMockupDetachedTextures(model.detachedTextures);
  };
  const recycle = (model: LoadedModel | null) => {
    if (!model) return;
    setAloeBottleBackdrop(model.root, null);
    model.root.removeFromParent(); model.pool.dispose(); model.recent = [];
    if (mobile || disposed) { discarded.add(model); disposeProduct(model.root); disposeMockupDetachedTextures(model.detachedTextures); return; }
    discard(cached); cached = model;
  };
  const warmup = async (root: THREE.Object3D, isCurrent: () => boolean) => {
    const textures = new Set<THREE.Texture>();
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
      }
    });
    for (const texture of textures) {
      if (disposed || !isCurrent()) return;
      if (!warmedTextures.has(texture)) { renderer.initTexture(texture); warmedTextures.add(texture); }
    }
    if (!disposed && isCurrent()) {
      const previous = renderer.getRenderTarget();
      // Prepare the linear offscreen variant used by both preview and capture.
      // Compiling against the default framebuffer would warm a different shader.
      // r180 compileAsync keeps uninterruptible timers that can dereference
      // disposed material/renderer properties after navigation or context loss.
      // Owned synchronous preparation plus the first draw before ready avoids
      // those orphaned polls while keeping texture/shader work out of animation.
      try { renderer.setRenderTarget(previewTarget); renderer.compile(root, camera, scene); }
      finally { renderer.setRenderTarget(previous); }
    }
  };
  const createPool = (content: THREE.Group, asset: ProductAsset) => createPooledAppearanceHandle(content, asset, {
    editable: true,
    capacity, acquireUrl: prefetch.acquireUrl, warmup,
    onChange(ready, pending) { host.dataset.labelPoolReady = String(ready); host.dataset.labelPoolPending = String(pending); },
  });
  const loadEnvironment = async () => {
    const thisRevision = ++environmentRevision;
    let texture: THREE.Texture;
    try {
      const source = settings.environment.src;
      texture = await (/\.exr(?:\?|$)/i.test(source) ? new EXRLoader() : new HDRLoader()).loadAsync(publicUrl(source));
    } catch { texture = createDaylightEnvironment(settings.environment.procedural); }
    if (disposed || thisRevision !== environmentRevision) { texture.dispose(); return; }
    try {
      const target = pmrem.fromEquirectangular(texture);
      environmentTarget?.dispose(); environmentTarget = target;
      scene.environment = target.texture; scene.environmentIntensity = settings.environment.intensity;
      scene.environmentRotation.set(...settings.environment.rotation);
      host.dataset.environment = 'ready'; requestRender();
    } finally { texture.dispose(); }
  };
  let environmentReady = loadEnvironment();
  const select = (asset: ProductAsset, appearance?: ProductAppearance, frontYaw = 0) => {
    if (disposed) return;
    if (contextLost || captureGate.busy) { queuedSelection = { asset, appearance, frontYaw }; return; }
    const nextKey = mockupSelectionKey(asset, appearance, frontYaw);
    if (nextKey === desiredKey && readyRevision === revision && statusPhase === 'ready') { emit('ready'); return; }
    desired = { asset, appearance, frontYaw: Number.isFinite(frontYaw) ? frontYaw : 0 }; desiredKey = nextKey;
    if (pointers.size) cancelPointers();
    const thisRevision = ++revision;
    request?.abort(); request = new AbortController(); const signal = request.signal;
    // Invalidate an older label request on the outgoing model. Its stable cached
    // appearance remains visible while a different model or label is preparing.
    if (active) void active.pool.apply(active.committedAppearance).catch(() => {});
    const current = () => !disposed && !signal.aborted && revision === thisRevision;
    readyRevision = -1; prefetch.setEnabled(false); pauseFromInteraction(false);
    const started = performance.now();
    emit(active?.key === modelKey(asset) ? 'loading-label' : 'loading-model');
    void (async () => {
      let candidate: LoadedModel | null = null;
      let failure: MockupStatus['error'] = 'model';
      try {
        const key = modelKey(asset);
        if (active?.key === key) candidate = active;
        else if (cached?.key === key) {
          candidate = cached; cached = null; candidate.pool = createPool(candidate.content, asset); candidates.add(candidate);
        } else {
          // Keep one outgoing model and one replacement, never a third idle GLB.
          discard(cached); cached = null;
          const src = assetUrl(asset.src);
          if (!src) throw new Error('Invalid model URL');
          const lease = prefetch.acquireUrl(src);
          let gltf;
          try {
            const download = new AbortController();
            const cancelDownload = () => download.abort();
            signal.addEventListener('abort', cancelDownload, { once: true });
            let buffer: ArrayBuffer;
            try {
              const response = await abortable(fetch(lease.url, { signal: download.signal, credentials: 'same-origin' }), signal, 30000);
              if (!response.ok) throw new Error('Model download failed');
              buffer = await abortable(response.arrayBuffer(), signal, 30000);
            } finally {
              signal.removeEventListener('abort', cancelDownload); download.abort();
            }
            const parsing = loader.parseAsync(buffer, THREE.LoaderUtils.extractUrlBase(publicUrl(src)));
            // parse/decode cannot be aborted by GLTFLoader; late results retain an
            // explicit owner and are disposed even after timeout/navigation.
            let abandonParsing = false;
            parsing.then(result => { if (!current() || abandonParsing) disposeProduct(result.scene); }, () => {});
            try { gltf = await abortable(parsing, signal, 45000); } catch (error) { abandonParsing = true; throw error; }
          } finally { lease.release(); }
          if (!current()) return;
          const unwanted: THREE.Object3D[] = [];
          gltf.scene.traverse(node => { if (node instanceof THREE.Light || node instanceof THREE.Camera) unwanted.push(node); });
          unwanted.forEach(node => node.removeFromParent());
          const content = new THREE.Group(); content.add(gltf.scene);
          if (asset.orientation) content.rotation.set(...asset.orientation);
          content.updateMatrixWorld(true);
          const original = new THREE.Box3().setFromObject(content);
          const size = original.getSize(new THREE.Vector3());
          if (!Number.isFinite(size.length()) || size.length() <= 0) { disposeProduct(content); throw new Error('Model has empty bounds'); }
          content.position.sub(original.getCenter(new THREE.Vector3())); content.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(content);
          const root = new THREE.Group(); root.add(content);
          const detachedTextures = neutralizeMockupLabelArtwork(content, asset);
          candidate = { root, content, bounds, radius: bounds.getBoundingSphere(new THREE.Sphere()).radius,
            asset, key, pool: createPool(content, asset), recent: [], detachedTextures };
          candidates.add(candidate);
        }
        if (!current()) { if (candidate !== active) discard(candidate); return; }
        emit('preparing');
        await abortable(environmentReady, signal, 45000);
        if (!current()) { if (candidate !== active) discard(candidate); return; }
        failure = 'label'; emit(appearance ? 'loading-label' : 'preparing');
        const appearanceKey = JSON.stringify(appearance ?? null);
        candidate.recent = [appearance, ...candidate.recent.filter(value => JSON.stringify(value ?? null) !== appearanceKey)].slice(0, capacity);
        candidate.pool.setWindow(candidate.recent);
        host.dataset.labelCacheHit = candidate.pool.has(appearance) ? 'true' : 'false';
        await abortable(candidate.pool.apply(appearance), signal, 45000);
        if (!current()) { if (candidate !== active) discard(candidate); return; }
        emit('preparing');
        const changingModel = candidate !== active;
        if (changingModel) {
          recycle(active); active = candidate; candidates.delete(candidate); product.add(candidate.root);
          product.quaternion.copy(animation.mode === 'showcase' ? rest : new THREE.Quaternion());
          pose.copy(product.quaternion); targetPose.copy(pose); lastInputAt = -Infinity; returnFrom = null;
        }
        candidate.asset = asset; candidate.root.rotation.y = desired!.frontYaw; candidate.committedAppearance = appearance;
        candidate.pool.setLiveOverrides?.(materialOverrides);
        // Bounds belong to the upright model, not its currently animated parent.
        // Otherwise a label switch would bake today's tilt/yaw into future lens fits.
        candidate.root.removeFromParent(); candidate.root.updateMatrixWorld(true);
        candidate.bounds = new THREE.Box3().setFromObject(candidate.root);
        product.add(candidate.root); product.updateMatrixWorld(true);
        lights.forEach((light, index) => light.position.set(...settings.lights[index].position).multiplyScalar(candidate!.radius));
        if (changingModel) fit('front'); else requestRender();
        // The shared pool prepared textures and shaders against the ready studio
        // environment before commit. Render that revision before capture becomes ready.
        if (previewTarget && isVisible()) { renderTo(previewTarget, null, camera); renderFrames++; }
        readyRevision = thisRevision; host.dataset.labelSwitchMs = String(Math.round(performance.now() - started));
        host.dataset.productId = asset.id; emit('ready'); requestRender();
        prefetch.configure(candidate.recent.map(value => ({ asset, appearance: value })));
        prefetch.setEnabled(isVisible());
      } catch (error) {
        if (candidate && candidate !== active) discard(candidate);
        if (candidate && candidate === active && current()) void candidate.pool.apply(candidate.committedAppearance).catch(() => {});
        if (current()) emit('error', failure, error instanceof Error ? error.message : '3D selection failed');
      }
    })();
  };
  const setBackground = (value: MockupBackground) => {
    if (disposed || captureGate.busy) return;
    const base = { white: '#ffffff', gray: '#e7e9e8', dark: '#162a24', color: safeColor(value.color, '#dcece4'), gradient: safeColor(value.color, '#f0f8f3'), transparent: '#000000' }[value.type];
    outputUniforms.backgroundTop.value.set(base);
    outputUniforms.backgroundBottom.value.set(value.type === 'gradient' ? safeColor(value.colorEnd, '#bfd9ca') : base);
    outputUniforms.backgroundAlpha.value = value.type === 'transparent' ? 0 : 1;
    host.dataset.background = value.type; requestRender();
  };
  const manualCamera = (preset: MockupCameraPreset) => {
    if (disposed || captureGate.busy) return;
    pauseFromInteraction(); fit(preset);
  };
  const rotateProduct = (axis: THREE.Vector3, angle: number) => {
    candidatePose.copy(targetPose).premultiply(dragStep.setFromAxisAngle(axis, angle)).normalize();
    up.set(0, 1, 0).applyQuaternion(candidatePose);
    if (up.y >= -0.25) targetPose.copy(candidatePose);
    lastInputAt = motionTime; returnFrom = null; requestRender();
  };
  const pointerDown = (event: PointerEvent) => {
    if (animation.mode !== 'showcase' || !active || captureGate.busy || contextLost || event.button !== 0 || pointers.has(event.pointerId)) return;
    if ((event.pointerType === 'touch' || event.pointerType === 'pen') && event.target !== hitRegion.element) return;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    product.updateWorldMatrix(true, true); camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
    if (!hitVisibleProduct(raycaster, visibleProductGestureMeshes(active.root))) return;
    targetPose.copy(pose); returnFrom = null;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch { pointers.delete(event.pointerId); return; }
    dragging = true; hitRegion.beginDrag(); hitRegion.element.style.cursor = canvas.style.cursor = 'grabbing';
    lastInputAt = motionTime; requestRender();
  };
  const pointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y, distance = Math.hypot(dx, dy);
    if (distance < 0.1) return;
    rotateProduct(dragAxis.set(dy, dx, 0).normalize(), Math.min(distance * 0.008, 0.24));
  };
  const pointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    dragging = pointers.size > 0;
    if (!dragging) { hitRegion.endDrag(); hitRegion.element.style.cursor = canvas.style.cursor = 'grab'; lastInputAt = motionTime; }
    requestRender();
  };
  const cancelPointers = () => {
    const ids = [...pointers.keys()]; pointers.clear(); dragging = false;
    hitRegion.endDrag();
    for (const id of ids) if (canvas.hasPointerCapture(id)) {
      try { canvas.releasePointerCapture(id); } catch { /* The browser may have cancelled capture already. */ }
    }
    hitRegion.element.style.cursor = canvas.style.cursor = 'grab'; lastInputAt = motionTime;
  };
  const zoomCamera = (factor: number) => {
    if (disposed || captureGate.busy || !Number.isFinite(factor) || factor <= 0) return;
    pauseFromInteraction();
    const direction = camera.position.clone().sub(controls.target);
    direction.setLength(THREE.MathUtils.clamp(direction.length() / factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(direction); controls.update(); requestRender();
  };
  const wheel = (event: WheelEvent) => {
    if (animation.mode !== 'showcase' || !active || !isVisible() || captureGate.busy || event.ctrlKey) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    zoomCamera(Math.exp(THREE.MathUtils.clamp(-pixels * 0.001 * controls.zoomSpeed, -0.5, 0.5)));
  };
  host.addEventListener('pointerdown', pointerDown); host.addEventListener('pointermove', pointerMove);
  host.addEventListener('pointerup', pointerUp); host.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', pointerUp);
  host.addEventListener('wheel', wheel, { passive: false });
  const onControlsStart = () => { if (!captureGate.busy) pauseFromInteraction(); };
  const onControlsChange = () => requestRender();
  controls.addEventListener('start', onControlsStart); controls.addEventListener('change', onControlsChange);
  const syncVisibility = () => {
    if (!isVisible()) { cancelPointers(); hitRegion.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; prefetch.setEnabled(false); }
    else { lastTime = performance.now(); prefetch.setEnabled(readyRevision === revision); requestRender(); }
  };
  const lostContext = (event: Event) => {
    event.preventDefault(); contextLost = true; readyRevision = -1; request?.abort(); exportAbort?.abort();
    controls.enabled = false; syncVisibility(); emit('error', 'webgl', 'WebGL context lost');
  };
  const restoredContext = () => {
    if (disposed) return;
    contextLost = false; controls.enabled = true;
    environmentReady = loadEnvironment();
    const next = queuedSelection ?? desired; queuedSelection = null;
    if (next) select(next.asset, next.appearance, next.frontYaw);
    syncVisibility();
  };
  canvas.addEventListener('webglcontextlost', lostContext); canvas.addEventListener('webglcontextrestored', restoredContext);
  document.addEventListener('visibilitychange', syncVisibility);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncVisibility(); }); intersection.observe(host);
  resize();

  return {
    select,
    setMaterialOverrides(overrides = {}) {
      if (disposed || captureGate.busy) return;
      materialOverrides = overrides;
      if (readyRevision === revision) active?.pool.setLiveOverrides?.(overrides);
      requestRender();
    },
    setCamera: manualCamera,
    setFocalLength(preset) {
      if (disposed || captureGate.busy || !(preset in MOCKUP_FOCAL_FOV)) return;
      focal = preset; camera.fov = MOCKUP_FOCAL_FOV[focal]; camera.updateProjectionMatrix();
      host.dataset.focalLength = focal; host.dataset.cameraFov = String(camera.fov);
      fit(); requestRender();
    },
    setBackground,
    setBackdrop(source) {
      if (disposed) return;
      const signature = JSON.stringify(source?.config ?? null);
      if (source?.state === backdropSource?.state && signature === backdropSignature) return;
      clearBackdrop(); backdropSource = source; backdropSignature = signature; requestRender();
    },
    setAnimation(value) {
      if (disposed || captureGate.busy) return;
      const previousMode = animation.mode;
      const changed = value.mode !== animation.mode;
      animation = { mode: value.mode, playing: value.mode !== 'off' && value.playing,
        speed: Number.isFinite(value.speed) ? Math.min(3, Math.max(0.2, value.speed)) : 1 };
      if (changed) {
        cancelPointers(); hitRegion.clear();
        controls.enableRotate = animation.mode !== 'showcase';
        controls.enableZoom = animation.mode !== 'showcase';
        if (animation.mode === 'showcase') product.quaternion.copy(rest);
        else if (previousMode === 'showcase' && animation.mode === 'turntable') product.quaternion.identity();
        pose.copy(product.quaternion); targetPose.copy(pose); lastInputAt = -Infinity; returnFrom = null;
        if (animation.mode === 'showcase' || previousMode === 'showcase' && animation.mode === 'turntable') fit('front');
      }
      host.dataset.motionMode = animation.mode;
      lastTime = performance.now(); requestRender();
    },
    setAspect(value) {
      if (disposed || captureGate.busy) return;
      aspect = normalizeMockupAspect(value); resize();
    },
    orbitView(yawRadians, pitchRadians) {
      if (disposed || captureGate.busy || !Number.isFinite(yawRadians) || !Number.isFinite(pitchRadians)) return;
      if (animation.mode === 'showcase') {
        targetPose.copy(pose); rotateProduct(yawAxis, yawRadians);
        rotateProduct(new THREE.Vector3(1, 0, 0), pitchRadians); return;
      }
      pauseFromInteraction();
      const relative = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(relative);
      spherical.theta += yawRadians;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitchRadians, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      camera.lookAt(controls.target); controls.update(); requestRender();
    },
    zoom: zoomCamera,
    resetView() {
      if (disposed || captureGate.busy) return;
      cancelPointers(); pauseFromInteraction();
      product.quaternion.copy(animation.mode === 'showcase' ? rest : new THREE.Quaternion());
      pose.copy(product.quaternion); targetPose.copy(pose); lastInputAt = -Infinity; returnFrom = null;
      focal = 'standard'; camera.fov = MOCKUP_FOCAL_FOV[focal]; camera.updateProjectionMatrix();
      host.dataset.focalLength = focal; host.dataset.cameraFov = String(camera.fov); fit('front');
    },
    async capture(captureOptions) {
      if (disposed || contextLost || !active || readyRevision !== revision || statusPhase !== 'ready') throw new Error('The selected scene is not ready for export');
      const exportAspect = normalizeMockupAspect(captureOptions.aspect ?? aspect);
      if (Math.abs(exportAspect - aspect) > 0.00001) throw new Error('Export frame must match the preview frame');
      const snapshotRevision = revision;
      const previousTarget = renderer.getRenderTarget();
      const previousViewport = renderer.getViewport(new THREE.Vector4());
      const previousScissor = renderer.getScissor(new THREE.Vector4());
      const previousScissorTest = renderer.getScissorTest();
      const previousClearColor = renderer.getClearColor(new THREE.Color()); const previousClearAlpha = renderer.getClearAlpha();
      const previousControls = controls.enabled;
      let linear: THREE.WebGLRenderTarget | null = null;
      let output: THREE.WebGLRenderTarget | null = null;
      const abortExport = () => exportAbort?.abort();
      return captureGate.run(async () => {
        exportAbort = new AbortController(); const signal = exportAbort.signal;
        captureOptions.signal?.addEventListener('abort', abortExport, { once: true });
        if (captureOptions.signal?.aborted) exportAbort.abort();
        if (pointers.size) cancelPointers();
        if (raf) cancelAnimationFrame(raf); raf = 0; controls.enabled = false; emit('exporting');
        const gl = renderer.getContext();
        const maxSize = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const size = mockupCaptureSize(captureOptions.longEdge, exportAspect, maxSize);
        host.dataset.captureSize = `${size.width}x${size.height}`;
        if (signal.aborted) throw mockupAbortError();
        linear = createLinearTarget(size.width, size.height);
        output = new THREE.WebGLRenderTarget(size.width, size.height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
        captureCamera.copy(camera, false); captureCamera.aspect = exportAspect; captureCamera.updateProjectionMatrix();
        renderTo(linear, output, captureCamera);
        const pixels = new Uint8Array(size.width * size.height * 4);
        // r180 supplies an asynchronous PBO readback. No permanent drawing buffer
        // or preview resize is needed; PNG encoding only touches a temporary 2D canvas.
        await abortable(renderer.readRenderTargetPixelsAsync(output, 0, 0, size.width, size.height, pixels), signal, 30000);
        if (disposed || signal.aborted || snapshotRevision !== revision) throw mockupAbortError();
        return await encodeMockupPng(pixels, size.width, size.height, signal);
      }, () => {
        captureOptions.signal?.removeEventListener('abort', abortExport); exportAbort = null;
        linear?.dispose(); output?.dispose();
        if (!disposed) {
          renderer.setRenderTarget(previousTarget); renderer.setViewport(previousViewport); renderer.setScissor(previousScissor);
          renderer.setScissorTest(previousScissorTest); renderer.setClearColor(previousClearColor, previousClearAlpha);
          controls.enabled = previousControls && !contextLost;
          lastTime = performance.now();
          if (!contextLost) { emit('ready'); resize(); }
        }
      }).catch(error => {
        if (!disposed && !contextLost && !(error instanceof DOMException && error.name === 'AbortError')) {
          // Export failure is recoverable and does not invalidate committed geometry.
          options.onStatus({ phase: 'ready', assetId: desired?.asset.id ?? '', appearanceId: desired?.appearance?.id ?? '', selectionKey: desiredKey, revision, hasProduct: Boolean(active), error: 'export',
            message: error instanceof Error ? error.message : 'PNG export failed' });
        }
        throw error;
      }).finally(() => {
        if (!disposed && !contextLost) {
          const next = queuedSelection; queuedSelection = null;
          if (next) select(next.asset, next.appearance, next.frontYaw);
          resize(); requestRender();
        }
      });
    },
    dispose() {
      if (disposed) return;
      cancelPointers(); hitRegion.dispose();
      disposed = true; revision++; environmentRevision++; queuedSelection = null; request?.abort(); exportAbort?.abort();
      if (raf) cancelAnimationFrame(raf); raf = 0;
      resizeObserver.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      canvas.removeEventListener('webglcontextlost', lostContext); canvas.removeEventListener('webglcontextrestored', restoredContext);
      host.removeEventListener('pointerdown', pointerDown); host.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('pointerup', pointerUp); host.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', pointerUp);
      host.removeEventListener('wheel', wheel);
      controls.removeEventListener('start', onControlsStart); controls.removeEventListener('change', onControlsChange); controls.dispose();
      clearBackdrop();
      discard(active); active = null; discard(cached); cached = null; [...candidates].forEach(discard);
      prefetch.dispose(); previewTarget?.dispose(); environmentTarget?.dispose();
      outputQuad.dispose(); outputMaterial.dispose(); pmrem.dispose(); draco.dispose(); basis.dispose();
      renderer.dispose(); canvas.remove();
    },
  };
}
