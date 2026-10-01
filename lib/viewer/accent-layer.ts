import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { publicUrl } from '../public-url';
import { disposeProduct } from './appearance';
import { normalizeAccentScene, resolveAccentNodes, type AccentFlavor, type ProductAccentNode, type ProductAccentScene, type ProductAccentSceneInput } from './accent-config';
import { advanceAccentMotion, createAccentMotion, sampleAccentNode } from './accent-motion';
import { accentImageExtent, adaptAccentFrame } from './accent-layout';
import { createDropletMaterial, updateDropletMaterial } from './droplet-material';
import { createIceMaterial, updateIceMaterial } from './ice-material';

type AccentObject = { node: ProductAccentNode; group: THREE.Group; materials: THREE.Material[]; resources: Array<{ dispose(): void }>; ready: boolean };
type AccentFrame = { deltaSeconds: number; ready: boolean; viewerIdle: boolean; reducedMotion: boolean; paused: boolean; height: number; width: number; productRadius: number; maximumProductScale: number; camera: THREE.PerspectiveCamera; resolution?: [number, number] };
const ATLAS = '/assets/scene/fruit-leaf-atlas.webp';
const GLASS_ATLAS = '/assets/scene/ice-droplet-atlas.webp';
// Analytic water retains its legacy footprint; supplied square image canvases
// have already been framed and preserve their distinct natural silhouettes.
const planeSize = (node: ProductAccentNode) => node.kind === 'droplet' && !node.assetUrl ? 1.7 : 1;
const CELLS: Record<string, [number, number]> = { orange: [0, 1], lime: [1, 1], berry: [2, 1], peach: [0, 0], mint: [1, 0], 'citrus-leaf': [2, 0] };
// Subject bounds in local cell UVs. Generated fruit crosses a nominal cell edge;
// leaf crops must exclude those neighbouring peel fragments, including blur taps.
const SUBJECT_UVS: Record<string, [number, number, number, number]> = {
  orange: [0.10, 0.04, 1.08, 0.96], lime: [0.10, 0.04, 0.98, 0.96],
  berry: [0.02, 0.04, 0.98, 0.98], peach: [0.10, 0.04, 1.08, 0.96],
  mint: [0.13, 0.04, 0.98, 0.98], 'citrus-leaf': [0.12, 0.04, 0.98, 0.98],
};

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
  let backdrop: THREE.Texture | null = null;
  const textures = new Set<THREE.Texture>();
  const textureRequests = new Map<string, Promise<THREE.Texture>>();
  const colorMaps = new THREE.TextureLoader();
  const getTexture = (src: string) => {
    if (!textureRequests.has(src)) textureRequests.set(src, colorMaps.loadAsync(publicUrl(src)).then(texture => {
      if (disposed) { texture.dispose(); throw new Error('Accent layer disposed'); }
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.add(texture);
      return texture;
    }).catch(error => { textureRequests.delete(src); throw error; }));
    return textureRequests.get(src)!;
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
    material.userData.accentOpacity = baseOpacity * (item.node.opacity ?? 1);
    item.materials.push(material); item.resources.push(material);
    return material;
  };
  const sprite = (item: AccentObject, texture: THREE.Texture, cell?: [number, number], columns = 3, rows = 2) => {
    const map = texture.clone();
    if (cell) { map.repeat.set(1 / columns, 1 / rows); map.offset.set(cell[0] / columns, cell[1] / rows); }
    map.needsUpdate = true;
    const crop = cell && !['ice', 'droplet'].includes(item.node.kind)
      ? SUBJECT_UVS[item.node.sprite ?? (item.node.kind === 'leaf' ? 'mint' : desiredFlavor === 'citrus' ? 'orange' : desiredFlavor)] : undefined;
    const nativeIce = item.node.kind === 'ice' && !item.node.assetUrl;
    const material = nativeIce ? createIceMaterial(map, backdrop)
      : new THREE.MeshBasicMaterial({ map, color: item.node.tint ?? '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    // Focus blur only affects this cutout; the product and UI remain sharp.
    if (!nativeIce && item.node.blur > 0) {
      // Blur is measured in subject UVs, independently of atlas dimensions.
      // Premultiplied convolution keeps transparent edges clean; crop limits
      // prevent the neighbouring orange slice leaking into the blurred leaf.
      const radius = item.node.blur / 128;
      const bounds = crop ?? [0, 0, 1, 1];
      const cropMinimum = new THREE.Vector2(map.offset.x + bounds[0] * map.repeat.x, map.offset.y + bounds[1] * map.repeat.y);
      const cropMaximum = new THREE.Vector2(map.offset.x + bounds[2] * map.repeat.x, map.offset.y + bounds[3] * map.repeat.y);
      material.onBeforeCompile = shader => {
        shader.uniforms.accentBlur = { value: new THREE.Vector2(radius * map.repeat.x, radius * map.repeat.y) };
        shader.uniforms.accentCropMin = { value: cropMinimum };
        shader.uniforms.accentCropMax = { value: cropMaximum };
        shader.fragmentShader = 'uniform vec2 accentBlur;\nuniform vec2 accentCropMin;\nuniform vec2 accentCropMax;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 c = vec4(0.0);
            for (int y = -2; y <= 2; y++) {
              for (int x = -2; x <= 2; x++) {
                float wx = x == 0 ? 6.0 : (abs(x) == 1 ? 4.0 : 1.0);
                float wy = y == 0 ? 6.0 : (abs(y) == 1 ? 4.0 : 1.0);
                vec4 tap = texture2D(map, clamp(vMapUv + vec2(float(x), float(y)) * accentBlur, accentCropMin, accentCropMax));
                c += vec4(tap.rgb * tap.a, tap.a) * (wx * wy / 256.0);
              }
            }
            c.rgb /= max(c.a, 0.00001);
            diffuseColor *= c;
          #endif`);
      };
      material.customProgramCacheKey = () => 'accent-gaussian-focus-v2';
    }
    trackMaterial(item, material);
    const size = planeSize(item.node);
    const geometry = new THREE.PlaneGeometry(size, size);
    if (crop) {
      const uv = geometry.getAttribute('uv');
      for (let index = 0; index < uv.count; index += 1) {
        uv.setXY(index, crop[0] + uv.getX(index) * (crop[2] - crop[0]), crop[1] + uv.getY(index) * (crop[3] - crop[1]));
      }
      uv.needsUpdate = true;
    }
    item.resources.push(map, geometry);
    const mesh = new THREE.Mesh(geometry, material);
    // Water is a rear photographic layer; blend it before the smaller cutouts.
    // Its actual depth is also solved behind those objects in update().
    if (item.node.kind === 'splash') mesh.renderOrder = -10;
    item.group.add(mesh);
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
            if (node.kind === 'splash') child.renderOrder = -10;
            (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => {
              material.transparent = true; material.userData.accentOpacity = material.opacity * (node.opacity ?? 1);
              if (node.tint && 'color' in material && material.color instanceof THREE.Color) material.color.multiply(new THREE.Color(node.tint));
              item.materials.push(material);
            });
          });
          item.resources.push({ dispose: () => disposeProduct(gltf.scene) });
          item.group.add(normalized); item.ready = true; invalidate();
        }).catch(() => { item.ready = true; invalidate(); });
      } else if (node.kind === 'droplet' && !node.assetUrl) {
        // Default water is a neutral lens over the live background, rather than
        // an opaque photo carrying the lighting/color of a different scene.
        const geometry = new THREE.PlaneGeometry(1.7, 1.7);
        const material = createDropletMaterial(backdrop);
        trackMaterial(item, material);
        item.resources.push(geometry);
        item.group.add(new THREE.Mesh(geometry, material));
        item.ready = true;
      } else if (node.kind === 'splash' && !node.assetUrl) {
        // An empty future admin splash slot stays empty, never becomes fruit.
        item.ready = true;
      } else {
        const glass = node.kind === 'ice';
        const cellName = node.sprite ?? (node.kind === 'leaf' ? 'mint' : flavor === 'citrus' ? 'orange' : flavor);
        const request = getTexture(node.assetUrl ?? (glass ? GLASS_ATLAS : ATLAS));
        request.then(texture => {
          // The cache owns shared source textures, including late or temporarily
          // unused images. Each sprite owns only its transform clone/material.
          if (disposed || thisRevision !== revision) return;
          texture.colorSpace = THREE.SRGBColorSpace;
          sprite(item, texture, node.assetUrl ? undefined : glass ? [node.kind === 'ice' ? 0 : 1, 0] : CELLS[cellName], glass ? 2 : 3, glass ? 1 : 2);
          item.ready = true; invalidate();
        }).catch(() => { item.ready = true; invalidate(); });
      }
      return item;
    });
  };
  return {
    setBackdrop(texture: THREE.Texture | null) {
      backdrop = texture;
      invalidate();
    },
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
      const envelope = { height: frame.height, width: frame.width, productRadius: frame.productRadius, maximumProductScale: frame.maximumProductScale };
      const viewport = { distance: frame.camera.position.z, fov: frame.camera.fov, aspect: frame.camera.aspect,
        center: [frame.camera.position.x, frame.camera.position.y, 0] as [number, number, number] };
      const samples = objects.map((item, index) => {
        const geometryRadius = item.node.assetUrl && /\.glb(?:\?|$)/i.test(item.node.assetUrl)
          ? Math.sqrt(3) / 2 : Math.SQRT1_2 * planeSize(item.node);
        const geometrySize = planeSize(item.node);
        const geometryExtent: [number, number, number] = item.node.assetUrl && /\.glb(?:\?|$)/i.test(item.node.assetUrl)
          ? [0.5, 0.5, 0.5] : accentImageExtent(item.node, geometrySize);
        const raw = sampleAccentNode(item.node, state, index, config!.motion);
        const sample = adaptAccentFrame(raw, item.node, envelope, viewport, geometryRadius, geometryExtent);
        return { raw, sample, geometryRadius, geometryExtent };
      });
      // Two passes keep the full splash sphere behind the deepest other accent,
      // independently of array order, burst progress, rotation or admin depth.
      const rearDepth = samples.reduce((depth, entry, index) => objects[index].node.kind === 'splash' ? depth
        : Math.max(depth, -entry.sample.position[2] + entry.geometryRadius * entry.sample.scale), 0)
        + Math.max(frame.height * 0.03, 0.0001);
      objects.forEach((item, index) => {
        const entry = samples[index];
        const sample = item.node.kind === 'splash'
          ? adaptAccentFrame(entry.raw, item.node, envelope, viewport, entry.geometryRadius, entry.geometryExtent, rearDepth)
          : entry.sample;
        item.group.position.set(...sample.position);
        item.group.rotation.set(...sample.rotation);
        item.group.scale.setScalar(sample.scale);
        item.group.visible = item.ready && sample.visible;
        item.materials.forEach(material => {
          const opacity = sample.opacity * (config!.opacity ?? 1) * material.userData.accentOpacity;
          material.opacity = opacity;
          if (material instanceof THREE.ShaderMaterial && material.name === 'colorless-water-droplet') {
            updateDropletMaterial(material, { opacity, blur: item.node.blur,
              resolution: frame.resolution ?? [1, 1], background: backdrop });
          } else if (material instanceof THREE.ShaderMaterial && material.name === 'colorless-refractive-ice') {
            updateIceMaterial(material, { opacity, blur: item.node.blur,
              resolution: frame.resolution ?? [1, 1], background: backdrop });
          }
        });
      });
      return { phase: state.phase, count: objects.length };
    },
    dispose() {
      if (disposed) return;
      disposed = true; clear(); textures.forEach(texture => texture.dispose()); textures.clear(); textureRequests.clear(); root.removeFromParent();
    },
  };
}
