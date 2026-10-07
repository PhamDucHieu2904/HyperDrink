import { publicUrl } from '../public-url';
import * as THREE from 'three';
import { ProductAppearance, ProductAsset, resolveMaterialOverride, type TextureSampler } from '../viewer-config';
import { bottleMaterialRole, configureBottleRenderOrder, createBottleMaterialContext, prepareBottleLayers } from './bottle-materials';

type MaterialBinding = { mesh: THREE.Mesh; original: THREE.Material; index: number };
export interface AppearanceHandle { apply(appearance?: ProductAppearance): Promise<void>; dispose(): void }
export interface AppearanceLoadOptions {
  /** A compressed-file cache lease lasts until Three finishes decoding the image. */
  acquireUrl?: (url: string) => { url: string; release(): void };
  /** A prepared appearance clone can configure ordering on its visible pooled root. */
  renderOrderRoot?: THREE.Object3D;
}

function applySampler(texture: THREE.Texture, sampler?: TextureSampler) {
  // Cylindrical seam triangles deliberately interpolate U past 1. Clamp would stretch
  // a single border pixel across a polygon, often forming a dark strip at the join.
  texture.wrapS = sampler?.wrapS === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = sampler?.wrapT === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

/** Demo artwork is printed color only. Highlights come from PBR + studio reflections. */
function createPrintTexture(label: NonNullable<ProductAppearance['label']>, volumeMl?: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const colors = label.colors.map((entry) => /^#[0-9a-f]{6}$/i.test(entry) ? entry : '#df8850');
  const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f8f5ee';
  context.fillRect(0, 750, canvas.width, 274);
  context.textAlign = 'center';
  context.fillStyle = '#fffaf1';
  // Repeated print panels keep branding visible throughout the full turn.
  for (const x of [0, 1024, 2048]) {
    context.font = '900 120px Arial, sans-serif';
    context.fillText(label.brand || 'VINUT', x, 335, 770);
    context.font = '500 29px Arial, sans-serif';
    context.letterSpacing = '7px';
    context.fillText(label.category || 'SPARKLING DRINK', x, 405, 770);
    context.letterSpacing = '0px';
    context.strokeStyle = 'rgba(255,250,241,.65)';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(x - 240, 460); context.lineTo(x + 240, 460); context.stroke();
    context.font = '600 40px Arial, sans-serif';
    context.fillText('FRESH TASTE. BOLD ENERGY.', x, 545, 780);
    context.fillStyle = '#29342c';
    context.font = '700 58px Arial, sans-serif';
    context.fillText(label.name.toUpperCase(), x, 850, 790);
    context.font = '500 29px Arial, sans-serif';
    const volume = label.volumeMl ?? volumeMl;
    context.fillText(volume ? `${volume} ml  ·  VINUT` : 'VINUT', x, 930, 770);
    context.fillStyle = '#fffaf1';
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // Imported glTF UVs already follow the image origin convention.
  texture.anisotropy = 4;
  return texture;
}

/** All changes are isolated to matching semantic slots and reversible to imported PBR. */
export function createAppearanceHandle(root: THREE.Object3D, asset: ProductAsset, options: AppearanceLoadOptions = {}): AppearanceHandle {
  prepareBottleLayers(root, asset);
  configureBottleRenderOrder(root, asset);
  if (options.renderOrderRoot) configureBottleRenderOrder(options.renderOrderRoot, asset);
  const bottle = createBottleMaterialContext(root, asset);
  const bindings: MaterialBinding[] = [];
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  let disposed = false;
  let revision = 0;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((original, index) => bindings.push({ mesh: child, original, index }));
  });
  const setMaterial = (binding: MaterialBinding, material: THREE.Material) => {
    if (Array.isArray(binding.mesh.material)) binding.mesh.material[binding.index] = material;
    else binding.mesh.material = material;
  };
  const restore = () => {
    bindings.forEach((binding) => setMaterial(binding, binding.original));
    ownedMaterials.forEach((material) => material.dispose()); ownedMaterials.clear();
    ownedTextures.forEach((texture) => texture.dispose()); ownedTextures.clear();
  };
  return {
    async apply(appearance) {
      const thisRevision = ++revision;
      if (disposed) return;
      const overrides = appearance?.slots ?? {};
      const labelSlot = appearance?.label?.slot ?? 'label';
      const printTexture = appearance?.label ? createPrintTexture(appearance.label, asset.volumeMl) : null;
      if (printTexture) applySampler(printTexture, asset.textureSamplers?.[labelSlot]);
      const nextTextures = new Set<THREE.Texture>();
      if (printTexture) nextTextures.add(printTexture);
      const textureLoader = new THREE.TextureLoader();
      const requested = new Map<string, Promise<THREE.Texture>>();
      const loadTexture = (url: string, srgb: boolean, sampler?: TextureSampler) => {
        const key = JSON.stringify([url, srgb, sampler?.wrapS ?? 'clamp', sampler?.wrapT ?? 'clamp']);
        if (!requested.has(key)) {
          const lease = options.acquireUrl?.(url);
          requested.set(key, textureLoader.loadAsync(lease?.url ?? publicUrl(url)).then((texture) => {
          texture.flipY = false;
          texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.anisotropy = 4;
          applySampler(texture, sampler);
          nextTextures.add(texture);
          return texture;
          }).finally(() => lease?.release()));
        }
        return requested.get(key)!;
      };
      const nextMaterials = new Map<MaterialBinding, THREE.Material>();
      const slotFor = (binding: MaterialBinding) => Object.entries(asset.materialSlots ?? {}).find(([, names]) =>
        names.includes(binding.original.name) || names.includes(binding.mesh.name))?.[0];
      const requiredSlots = new Set(appearance?.requiredSlots ?? []);
      const appliedSlots = new Set<string>();
      try {
        for (const slot of requiredSlots) {
          const matching = bindings.filter(binding => slotFor(binding) === slot);
          if (!matching.length || matching.some(binding => !(binding.original instanceof THREE.MeshStandardMaterial))) {
            throw new Error(`Required appearance slot has no compatible material binding: ${slot}`);
          }
          const override = resolveMaterialOverride(overrides[slot] ?? {});
          for (const map of ['baseColorMap', 'normalMap', 'roughnessMap'] as const) {
            if (overrides[slot]?.[map] !== undefined && !override[map]) throw new Error(`Required appearance slot has an invalid texture URL: ${slot}`);
          }
          if (!(printTexture && slot === labelSlot) && !Object.values(override).some(value => value !== undefined && value !== '')) {
            throw new Error(`Required appearance slot has no print or override: ${slot}`);
          }
          if ((printTexture && slot === labelSlot || override.baseColorMap || override.normalMap || override.roughnessMap) && matching.some(binding => !binding.mesh.geometry.getAttribute('uv')?.count)) {
            throw new Error(`Required appearance slot has no texture UV coordinates: ${slot}`);
          }
        }
        const results = await Promise.allSettled(bindings.map(async (binding) => {
          const slot = slotFor(binding);
          const bottleRole = bottle && bottleMaterialRole(asset, binding.mesh, binding.original);
          if (!slot || (!overrides[slot] && !(printTexture && slot === labelSlot) && !bottleRole)) return;
          const sampler = asset.textureSamplers?.[slot];
          // Upgrade only a slot asking for physical options; don't flatten all materials.
          const override = resolveMaterialOverride(overrides[slot] ?? {});
          let material: THREE.MeshStandardMaterial;
          if (binding.original instanceof THREE.MeshPhysicalMaterial) material = binding.original.clone();
          else if (binding.original instanceof THREE.MeshStandardMaterial) {
            if (bottleRole === 'liquid' || ['transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness'].some((key) => key in override)) {
              const physical = new THREE.MeshPhysicalMaterial();
              THREE.MeshStandardMaterial.prototype.copy.call(physical, binding.original);
              physical.defines = { STANDARD: '', PHYSICAL: '' };
              material = physical;
            } else material = binding.original.clone();
          } else return;
          nextMaterials.set(binding, material);
          if (override.color) material.color.set(override.color);
          for (const key of ['metalness', 'roughness', 'opacity'] as const) {
            if (override[key] !== undefined) material[key] = override[key];
          }
          if (material instanceof THREE.MeshPhysicalMaterial) {
            for (const key of ['clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior'] as const) {
              if (override[key] !== undefined) material[key] = override[key];
            }
          }
          if (override.opacity !== undefined) material.transparent = override.opacity < 1;
          if (override.normalScale !== undefined) material.normalScale.setScalar(override.normalScale);
          if (printTexture && slot === labelSlot) { material.map = printTexture; material.color.set('#ffffff'); }
          if (override.baseColorMap) material.map = await loadTexture(override.baseColorMap, true, sampler);
          if (override.normalMap) material.normalMap = await loadTexture(override.normalMap, false, sampler);
          if (override.roughnessMap) material.roughnessMap = await loadTexture(override.roughnessMap, false, sampler);
          if (bottleRole) bottle.configure(material, binding.mesh, bottleRole, resolveMaterialOverride(overrides.liquid ?? {}).color);
          material.needsUpdate = true;
          appliedSlots.add(slot);
        }));
        if (results.some((result) => result.status === 'rejected')) throw new Error('Appearance texture could not be loaded');
        for (const slot of requiredSlots) if (!appliedSlots.has(slot)) throw new Error(`Required appearance slot was not applied: ${slot}`);
      } catch (error) {
        nextMaterials.forEach((material) => material.dispose());
        nextTextures.forEach((texture) => texture.dispose());
        throw error;
      }
      if (disposed || thisRevision !== revision) {
        nextMaterials.forEach((material) => material.dispose());
        nextTextures.forEach((texture) => texture.dispose());
        return;
      }
      restore();
      nextMaterials.forEach((material, binding) => { setMaterial(binding, material); ownedMaterials.add(material); });
      nextTextures.forEach((texture) => ownedTextures.add(texture));
    },
    dispose() { disposed = true; revision += 1; restore(); },
  };
}

/** Deduplicated disposal includes glTF ImageBitmaps, which the browser does not GC itself. */
export function disposeProduct(root: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometry.add(child.geometry);
    (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
    });
  });
  geometry.forEach((entry) => entry.dispose());
  materials.forEach((entry) => entry.dispose());
  textures.forEach((entry) => {
    const image = entry.source.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    entry.dispose();
  });
}
