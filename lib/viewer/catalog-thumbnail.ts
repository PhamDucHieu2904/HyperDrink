import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createAppearanceHandle, disposeProduct } from './appearance';
import type { ProductAppearance, ProductAsset } from '../viewer-config';
import { publicUrl } from '../public-url';

/** One shared renderer, serial still renders and a bounded image cache; cards do not run WebGL loops. */
const cache = new Map<string, Promise<string>>();
let tail: Promise<unknown> = Promise.resolve();
let studio: ReturnType<typeof createStudio> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

function createStudio() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(512, 512); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room);
  room.dispose(); pmrem.dispose();
  scene.environment = environment.texture;
  const key = new THREE.DirectionalLight('#ffffff', 2); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.HemisphereLight('#ffffff', '#bfc9c5', 0.7); scene.add(fill);
  const draco = new DRACOLoader().setDecoderPath(publicUrl('/decoders/draco/')).setWorkerLimit(1);
  const basis = new KTX2Loader().setTranscoderPath(publicUrl('/decoders/basis/')).setWorkerLimit(1).detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder);
  const camera = new THREE.OrthographicCamera(-0.64, 0.64, 0.64, -0.64, 0.01, 30);
  camera.position.set(0, 0.35, 4); camera.lookAt(0, 0, 0);
  return { renderer, scene, camera, loader, dispose() { draco.dispose(); basis.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); } };
}

async function renderThumbnail(asset: ProductAsset, appearance: ProductAppearance): Promise<string> {
  if (idle) clearTimeout(idle);
  const current = studio ??= createStudio();
  let root: THREE.Group | undefined;
  let handle: ReturnType<typeof createAppearanceHandle> | undefined;
  try {
    const response = await fetch(publicUrl(asset.src), { signal: AbortSignal.timeout(15000), credentials: 'omit' });
    if (!response.ok) throw new Error('Product model unavailable');
    const gltf = await current.loader.parseAsync(await response.arrayBuffer(), new URL('.', new URL(publicUrl(asset.src), window.location.href)).href);
    root = new THREE.Group();
    const content = new THREE.Group(); content.add(gltf.scene); root.add(content);
    const unwanted: THREE.Object3D[] = [];
    content.traverse(object => { if (object instanceof THREE.Camera || object instanceof THREE.Light) unwanted.push(object); });
    unwanted.forEach(object => object.removeFromParent());
    if (asset.orientation) content.rotation.set(...asset.orientation);
    content.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(content);
    const size = bounds.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Empty product model');
    content.position.sub(bounds.getCenter(new THREE.Vector3())); root.scale.setScalar(1 / extent);
    root.rotation.set(-0.04, 0.15, -0.06);
    handle = createAppearanceHandle(content, asset);
    await handle.apply(appearance);
    current.scene.add(root);
    current.renderer.render(current.scene, current.camera);
    return current.renderer.domElement.toDataURL('image/webp', 0.9);
  } finally {
    root?.removeFromParent(); handle?.dispose(); if (root) disposeProduct(root);
    idle = setTimeout(() => { studio?.dispose(); studio = undefined; }, 15000);
  }
}

export function catalogThumbnail(asset: ProductAsset, appearance: ProductAppearance): Promise<string> {
  const key = JSON.stringify([asset.src, asset.orientation, asset.materialSlots, asset.textureSamplers, appearance]);
  const found = cache.get(key);
  if (found) return found;
  const pending = tail.catch(() => {}).then(() => renderThumbnail(asset, appearance));
  tail = pending;
  cache.set(key, pending);
  if (cache.size > 96) cache.delete(cache.keys().next().value!);
  void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  return pending;
}
