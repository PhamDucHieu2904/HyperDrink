import * as THREE from 'three';

export interface BasilNeckExportLayers {
  /** Linear, resolved native neck radiance and optical alpha. */
  radiance: THREE.Texture;
  /** Resolved visible neck silhouette; white RGB carries geometric coverage. */
  coverage: THREE.Texture;
}

function nativeNeckMaterial(mesh: THREE.Mesh, material: THREE.Material) {
  return material.visible && material.name === 'basil-high-neck' &&
    (mesh.userData.basilHighNeck === true || mesh.userData.basilProfile === 'basil-high-v1' ||
      mesh.userData.bottleProfile === 'basil-glass290-high-v1' || material.userData.basilProfile === 'basil-high-v1' ||
      material.userData.bottleProfile === 'basil-glass290-high-v1');
}

/**
 * Mirrors GlassNeckExportScope's independent native image and visibility mask.
 * The caller uses these only for transparent Basil preview/PNG output, after the
 * ordinary body beauty pass. No extra optical pass is used on the main page.
 */
export function createBasilNeckExport(renderer: THREE.WebGLRenderer) {
  let radiance: THREE.WebGLRenderTarget | undefined;
  let coverage: THREE.WebGLRenderTarget | undefined;
  let depthMaterial: THREE.MeshBasicMaterial | undefined;
  let maskMaterial: THREE.MeshBasicMaterial | undefined;
  let disposed = false;
  const release = () => {
    radiance?.dispose(); coverage?.dispose(); radiance = undefined; coverage = undefined;
  };
  return {
    render(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): BasilNeckExportLayers | null {
      if (disposed) return null;
      const meshes: THREE.Mesh[] = [], necks = new Set<THREE.Mesh>();
      scene.traverseVisible(node => {
        if (!(node instanceof THREE.Mesh)) return;
        meshes.push(node);
        if ((Array.isArray(node.material) ? node.material : [node.material]).some(material => nativeNeckMaterial(node, material))) necks.add(node);
      });
      if (!necks.size) { release(); return null; }
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new RangeError('Basil neck target dimensions must be positive');
      width = Math.floor(width); height = Math.floor(height);
      if (!radiance || !coverage) {
        const samples = Math.min(4, renderer.capabilities.maxSamples);
        const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
        radiance = new THREE.WebGLRenderTarget(width, height, { type, format: THREE.RGBAFormat, depthBuffer: true, samples });
        coverage = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, samples });
        radiance.texture.name = 'Basil native neck radiance'; coverage.texture.name = 'Basil native neck coverage';
      } else { radiance.setSize(width, height); coverage.setSize(width, height); }
      depthMaterial ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide, toneMapped: false });
      maskMaterial ??= new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: true, depthTest: true, side: THREE.FrontSide,
        transparent: true, opacity: 1, blending: THREE.NoBlending, toneMapped: false });
      const originalMeshes = meshes.map(mesh => ({ mesh, material: mesh.material, visible: mesh.visible }));
      const target = renderer.getRenderTarget(), cubeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
      const background = scene.background, override = scene.overrideMaterial;
      try {
        scene.background = null; scene.overrideMaterial = null; renderer.autoClear = false;
        renderer.setClearColor('#000000', 0);
        // Native optics already contains its accepted cap collider. Other raster
        // geometry must not become transmitted background in this source image.
        for (const mesh of meshes) if (!necks.has(mesh)) mesh.visible = false;
        renderer.setRenderTarget(radiance); renderer.clear(true, true, true); renderer.render(scene, camera);

        // Source visibility is independent of native radiance. Cheap opaque
        // depth blockers draw before the transparent-queue white neck mask.
        for (const item of originalMeshes) {
          item.mesh.visible = item.visible;
          const replacement = (material: THREE.Material) => !material.visible ? material : nativeNeckMaterial(item.mesh, material) ? maskMaterial! : depthMaterial!;
          item.mesh.material = Array.isArray(item.material) ? item.material.map(replacement) : replacement(item.material);
        }
        renderer.setRenderTarget(coverage); renderer.clear(true, true, true); renderer.render(scene, camera);
        return { radiance: radiance.texture, coverage: coverage.texture };
      } finally {
        for (const item of originalMeshes) { item.mesh.material = item.material; item.mesh.visible = item.visible; }
        scene.background = background; scene.overrideMaterial = override;
        renderer.autoClear = autoClear; renderer.setClearColor(clearColor, clearAlpha);
        renderer.setRenderTarget(target, cubeFace, mip);
      }
    },
    /** Release offscreen targets on a solid-background/product switch; reuse the capture later. */
    release,
    dispose() {
      if (disposed) return; disposed = true; release();
      depthMaterial?.dispose(); maskMaterial?.dispose(); depthMaterial = undefined; maskMaterial = undefined;
    },
  };
}
