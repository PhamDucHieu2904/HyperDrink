import * as THREE from 'three';
import type { ProductAsset } from '../viewer-config';

/**
 * A free Mockup label surface starts unprinted, even if the GLB author embedded
 * artwork. Its metal/roughness/normal PBR and all other semantic slots survive.
 * Removed textures retain an explicit owner until the complete model is disposed.
 */
export function neutralizeMockupLabelArtwork(root: THREE.Object3D, asset: ProductAsset): Set<THREE.Texture> {
  const names = asset.materialSlots?.label ?? [];
  const removed = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || (!names.includes(material.name) && !names.includes(node.name))) continue;
      if (material.map) { removed.add(material.map); material.map = null; material.needsUpdate = true; }
    }
  });
  // A texture still referenced by another slot belongs to disposeProduct already.
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) removed.delete(value); });
    }
  });
  return removed;
}

export function disposeMockupDetachedTextures(textures: Set<THREE.Texture>): void {
  for (const texture of textures) {
    const image = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    texture.dispose();
  }
  textures.clear();
}
