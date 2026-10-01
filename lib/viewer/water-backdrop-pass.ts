import * as THREE from 'three';

export interface WaterBackdropPass {
  /** Stable linear-color sampler, owned by this pass. */
  readonly texture: THREE.Texture;
  render(background: THREE.Texture, camera: THREE.Camera): void;
  dispose(): void;
}

const imageDimension = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

/**
 * Capture the CSS backdrop and actual accent objects beneath water in the same
 * camera projection. Hide native water/ice to avoid sampling the target while writing it;
 * hide the primary product because these droplets sit behind it in the scene.
 * No camera, animation loop or background texture is owned by this pass.
 */
export function createWaterBackdropPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  productGroup: THREE.Group,
): WaterBackdropPass {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  target.texture.name = 'water-accent-backdrop';
  let disposed = false;
  return {
    texture: target.texture,
    render(background, camera) {
      if (disposed) return;
      const image = background.image as { width?: number; height?: number } | undefined;
      const width = imageDimension(image?.width);
      const height = imageDimension(image?.height);
      if (target.width !== width || target.height !== height) target.setSize(width, height);

      const previousTarget = renderer.getRenderTarget();
      const previousCubeFace = renderer.getActiveCubeFace();
      const previousMipmapLevel = renderer.getActiveMipmapLevel();
      const previousBackground = scene.background;
      const previousProductVisibility = productGroup.visible;
      const hiddenGlass: Array<{ mesh: THREE.Mesh; visible: boolean }> = [];
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => material instanceof THREE.ShaderMaterial
          && ['colorless-water-droplet', 'colorless-refractive-ice'].includes(material.name))) {
          hiddenGlass.push({ mesh: object, visible: object.visible });
        }
      });
      try {
        scene.background = background;
        productGroup.visible = false;
        hiddenGlass.forEach(({ mesh }) => { mesh.visible = false; });
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        scene.background = previousBackground;
        productGroup.visible = previousProductVisibility;
        hiddenGlass.forEach(({ mesh, visible }) => { mesh.visible = visible; });
        renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
    },
  };
}
