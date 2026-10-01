import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { publicUrl } from '../public-url';
import { disposeProduct } from './appearance';
import { normalizeAccentScene, resolveAccentNodes, type AccentFlavor, type ProductAccentNode, type ProductAccentScene, type ProductAccentSceneInput } from './accent-config';
import { advanceAccentMotion, createAccentMotion, sampleAccentNode } from './accent-motion';

type AccentObject = { node: ProductAccentNode; group: THREE.Group; materials: THREE.Material[]; resources: Array<{ dispose(): void }>; ready: boolean };
type AccentFrame = { deltaSeconds: number; ready: boolean; viewerIdle: boolean; reducedMotion: boolean; paused: boolean; height: number; camera: THREE.PerspectiveCamera };
const ATLAS = '/assets/scene/fruit-leaf-atlas.webp';
const GLASS_ATLAS = '/assets/scene/ice-droplet-atlas.webp';
const CELLS: Record<string, [number, number]> = { orange: [0, 1], lime: [1, 1], berry: [2, 1], peach: [0, 0], mint: [1, 0], 'citrus-leaf': [2, 0] };

/** Scene-local resources; never parented to the spinning product. Approved GLBs
 * can replace each demo sprite/mesh without changing choreography or layout. */
export function createAccentLayer(scene: THREE.Scene, loader: GLTFLoader, invalidate: () => void) {
  const root = new THREE.Group();
  root.name = 'product-accent-scene';
  scene.add(root);
  let config: ProductAccentScene | undefined;
  let desiredKey = '', desiredFlavor: AccentFlavor = 'citrus', renderedSignature = '';
  let state = createAccentMotion('');
  let objects: AccentObject[] = [];
  let disposed = false, revision = 0;
  const atlases = new Set<THREE.Texture>();
  const atlasRequests = new Map<string, Promise<THREE.Texture>>();
  const colorMaps = new THREE.TextureLoader();
  const getAtlas = (src: string) => {
    if (!atlasRequests.has(src)) atlasRequests.set(src, colorMaps.loadAsync(publicUrl(src)).then(texture => {
      if (disposed) { texture.dispose(); throw new Error('Accent layer disposed'); }
      texture.colorSpace = THREE.SRGBColorSpace;
      atlases.add(texture);
      return texture;
    }));
    return atlasRequests.get(src)!;
  };
  const clear = () => {
    revision += 1;
    objects.forEach(item => {
      item.group.removeFromParent();
      item.resources.forEach(resource => resource.dispose());
    });
    objects = [];
  };
  const trackMaterial = (item: AccentObject, material: THREE.Material, baseOpacity = 1) => {
    material.userData.accentOpacity = baseOpacity;
    item.materials.push(material); item.resources.push(material);
    return material;
  };
  const sprite = (item: AccentObject, texture: THREE.Texture, cell?: [number, number], columns = 3, rows = 2) => {
    const map = texture.clone();
    if (cell) { map.repeat.set(1 / columns, 1 / rows); map.offset.set(cell[0] / columns, cell[1] / rows); }
    map.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map, color:item.node.tint ?? '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    // Focus blur only affects this cutout; the product and UI remain sharp.
    if (item.node.blur > 0) {
      const radius = item.node.blur / 512;
      material.onBeforeCompile = shader => {
        shader.uniforms.accentBlur = { value: radius };
        shader.fragmentShader = 'uniform float accentBlur;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec2 d = vec2(accentBlur);
            vec4 c = texture2D(map, vMapUv) * 0.2;
            c += texture2D(map,vMapUv+vec2(d.x,0.0))*0.12;
            c += texture2D(map,vMapUv-vec2(d.x,0.0))*0.12;
            c += texture2D(map,vMapUv+vec2(0.0,d.y))*0.12;
            c += texture2D(map,vMapUv-vec2(0.0,d.y))*0.12;
            c += texture2D(map,vMapUv+d)*0.08;
            c += texture2D(map,vMapUv-d)*0.08;
            c += texture2D(map,vMapUv+vec2(d.x,-d.y))*0.08;
            c += texture2D(map,vMapUv+vec2(-d.x,d.y))*0.08;
            diffuseColor *= c;
          #endif`);
      };
      material.customProgramCacheKey = () => `accent-focus-${radius}`;
    }
    trackMaterial(item, material);
    const size = item.node.kind === 'droplet' ? 1.7 : 1;
    const geometry = new THREE.PlaneGeometry(size, size);
    item.resources.push(map, geometry);
    item.group.add(new THREE.Mesh(geometry, material));
  };
  const build = (flavor: AccentFlavor) => {
    clear();
    if (!config) return;
    const thisRevision = revision;
    objects = resolveAccentNodes(config, flavor).filter(node => node.enabled).map(node => {
      const item: AccentObject = { node, group: new THREE.Group(), resources: [], materials: [], ready: false };
      item.group.name = node.id; item.group.visible = false; root.add(item.group);
      if (node.assetUrl && /\.glb(?:\?|$)/i.test(node.assetUrl)) {
        loader.loadAsync(publicUrl(node.assetUrl)).then(gltf => {
          if (disposed || thisRevision !== revision) { disposeProduct(gltf.scene); return; }
          const unwanted: THREE.Object3D[] = [];
          gltf.scene.traverse(child => { if (child instanceof THREE.Light || child instanceof THREE.Camera) unwanted.push(child); });
          unwanted.forEach(child => child.removeFromParent());
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3());
          const extent = Math.max(size.x, size.y, size.z);
          if (!(extent > 0) || !Number.isFinite(extent)) { disposeProduct(gltf.scene); item.ready = true; return; }
          const normalized = new THREE.Group();
          gltf.scene.position.sub(box.getCenter(new THREE.Vector3())); normalized.add(gltf.scene); normalized.scale.setScalar(1 / extent);
          gltf.scene.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => {
              material.transparent = true; material.userData.accentOpacity = material.opacity;
              if (node.tint && 'color' in material && material.color instanceof THREE.Color) material.color.multiply(new THREE.Color(node.tint));
              item.materials.push(material);
            });
          });
          item.resources.push({ dispose: () => disposeProduct(gltf.scene) });
          item.group.add(normalized); item.ready = true; invalidate();
        }).catch(() => { item.ready = true; invalidate(); });
      } else {
        const glass = node.kind === 'ice' || node.kind === 'droplet';
        const cellName = node.sprite ?? (node.kind === 'leaf' ? 'mint' : flavor === 'citrus' ? 'orange' : flavor);
        const request = node.assetUrl ? colorMaps.loadAsync(publicUrl(node.assetUrl)) : getAtlas(glass ? GLASS_ATLAS : ATLAS);
        request.then(texture => {
          if (disposed || thisRevision !== revision) { if (node.assetUrl) texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace;
          sprite(item, texture, node.assetUrl ? undefined : glass ? [node.kind === 'ice' ? 0 : 1, 0] : CELLS[cellName], glass ? 2 : 3, glass ? 1 : 2);
          if (node.assetUrl) item.resources.push(texture);
          item.ready = true; invalidate();
        }).catch(() => { item.ready = true; invalidate(); });
      }
      return item;
    });
  };
  return {
    configure(value: ProductAccentSceneInput | undefined, key: string, flavor: AccentFlavor) {
      const selectionKey = `${key}/${flavor}`;
      const next = value ? normalizeAccentScene(value) : undefined;
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      config = next; desiredFlavor = flavor; desiredKey = selectionKey;
      if (changed) { renderedSignature = ''; state = createAccentMotion(selectionKey); clear(); }
      root.visible = Boolean(config?.enabled); invalidate();
    },
    update(frame: AccentFrame) {
      if (!config?.enabled || disposed) return { phase: 'waiting', count: 0 };
      if (!renderedSignature || (state.renderedKey === desiredKey && renderedSignature !== desiredKey)) {
        build(desiredFlavor); renderedSignature = desiredKey;
      }
      state = advanceAccentMotion(state, { key: desiredKey, ready: frame.ready && objects.every(item => item.ready), viewerIdle: frame.viewerIdle,
        reducedMotion: frame.reducedMotion || frame.paused, deltaSeconds: frame.deltaSeconds, nodeCount: objects.length }, config.motion);
      // A flavor is rebound only while invisible; old cutouts finish their fade first.
      if (state.renderedKey === desiredKey && renderedSignature !== desiredKey) {
        build(desiredFlavor); renderedSignature = desiredKey;
        state = createAccentMotion(desiredKey);
      }
      objects.forEach((item, index) => {
        const sample = sampleAccentNode(item.node, state, index, config!.motion);
        const height = frame.height;
        item.group.position.set(...sample.position).multiplyScalar(height);
        // Keep edge objects inside the local viewer on narrow mobile stages.
        const halfWidth = Math.tan(THREE.MathUtils.degToRad(frame.camera.fov / 2)) * (frame.camera.position.z - item.group.position.z) * frame.camera.aspect;
        const limit = Math.max(height * 0.2, halfWidth - sample.scale * height * 0.35);
        item.group.position.x = THREE.MathUtils.clamp(item.group.position.x, -limit, limit);
        item.group.rotation.set(...sample.rotation);
        item.group.scale.setScalar(sample.scale * height);
        item.group.visible = item.ready && sample.visible;
        item.materials.forEach(material => { material.opacity = sample.opacity * (config!.opacity ?? 1) * material.userData.accentOpacity; });
      });
      return { phase: state.phase, count: objects.length };
    },
    dispose() {
      if (disposed) return;
      disposed = true; clear(); atlases.forEach(texture => texture.dispose()); atlases.clear(); atlasRequests.clear(); root.removeFromParent();
    },
  };
}
