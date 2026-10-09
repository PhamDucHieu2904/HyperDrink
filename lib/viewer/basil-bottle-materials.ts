import * as THREE from 'three';
import type { ProductAsset } from '../viewer-config';
import { liquidColorUpdates } from './material-adjustments';
import { acquireBasilHighData } from './basil-high-data';
import { BASIL_HIGH_OPTICS_GLSL, basilHighLiquidParameters } from './basil-high-optics';

type Role = 'body' | 'ring' | 'liquid' | 'liquid-back' | 'inclusions' | 'cap' | 'label';
const PROFILE = 'basil-high-v1';
export const BASIL_HIGH_PRESET = Object.freeze({
  liquidColor: '#be2838', // Reference calibration: capture's runtime color was not serialized.
  liquidSmoothness: 1, depthAwareness: .606, seedDepthFade: .6,
  roughness: .042, seedColorSrgb: [.012, .018, .008] as const,
  goldColorSrgb: [.9528302, .8926178, .3460751] as const,
  gelThicknessNative: .0000832, labelRoughness: .5,
});
function profiled(mesh: THREE.Mesh, material: THREE.Material) {
  return mesh.userData.basilProfile === PROFILE || material.userData.basilProfile === PROFILE ||
    mesh.userData.bottleProfile === 'basil-glass290-high-v1' || material.userData.bottleProfile === 'basil-glass290-high-v1';
}
export function basilMaterialRole(asset: ProductAsset, mesh: THREE.Mesh, material: THREE.Material): Role | undefined {
  if (asset.packaging !== 'glass' || !profiled(mesh, material)) return;
  return Object.entries(asset.materialSlots ?? {}).find(([, names]) => names.includes(material.name) || names.includes(mesh.name))?.[0] as Role | undefined;
}

/** High integrates the retained Water/Seeds/Gel/inner interfaces in one outer draw. */
export function prepareBasilHighLayers(root: THREE.Object3D, asset: ProductAsset) {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const role = materials.map(material => basilMaterialRole(asset, node, material)).find(Boolean);
    if (!role) return;
    if (role === 'body') {
      node.visible = materials.some(material => ['basil-high-outer', 'basil-high-neck'].includes(material.name));
      materials.forEach(material => { if (material.name === 'basil-high-inner') material.visible = false; });
      node.renderOrder = 10;
    } else if (role === 'liquid' || role === 'inclusions') {
      node.visible = false;
    } else node.renderOrder = 30;
  });
}

interface Backdrop { texture: THREE.Texture | null; color: THREE.Color | null; colorBottom: THREE.Color | null; transparentNeck: boolean }
const backgrounds = new WeakMap<THREE.Scene, Backdrop>();
/** A caller can reuse an existing product-free capture; this module owns no render pass. */
export function setBasilHighBackdrop(scene: THREE.Scene, texture: THREE.Texture | null, color: THREE.Color | null = null, colorBottom: THREE.Color | null = color, transparentNeck = false) {
  if (texture || color || transparentNeck) backgrounds.set(scene, { texture, color, colorBottom, transparentNeck }); else backgrounds.delete(scene);
}

const hostDeclarations = /* glsl */`
uniform mat4 basilHighMeshToNative;
uniform mat3 basilHighNormalToNative;
uniform mat4 basilHighNativeToScene;
uniform mat4 basilHighSceneToClip;
uniform float basilHighBackgroundDistance;
uniform vec3 basilHighCameraNative;
uniform sampler2D basilHighBackdrop;
uniform float basilHighHasBackdrop;
uniform float basilHighHasMatte;
uniform vec3 basilHighMatte;
uniform vec3 basilHighMatteBottom;
varying vec3 vBasilHighPosition;
varying vec3 vBasilHighNormal;
`;
const hostFunctions = /* glsl */`
vec3 basilHighEnvironment(vec3 direction, float roughness) {
  #ifdef USE_ENVMAP
    vec3 worldDirection = normalize(mat3(basilHighNativeToScene) * direction);
    vec3 viewDirection = normalize((viewMatrix * vec4(worldDirection, 0.0)).xyz);
    return getIBLRadiance(viewDirection, viewDirection, roughness);
  #else
    return vec3(0.0);
  #endif
}
vec3 basilHighBackground(vec3 origin, vec3 direction) {
  if (basilHighNativeAlpha > .5) return vec3(0.0);
  if (basilHighHasMatte > .5) {
    vec3 point = (basilHighNativeToScene * vec4(origin, 1.0)).xyz;
    point += normalize(mat3(basilHighNativeToScene) * direction) * basilHighBackgroundDistance;
    vec4 clip = basilHighSceneToClip * vec4(point, 1.0);
    float y = clamp(clip.y / max(clip.w, .000001) * .5 + .5, 0.0, 1.0);
    return mix(basilHighMatteBottom, basilHighMatte, y);
  }
  if (basilHighHasBackdrop > .5) {
    vec3 point = (basilHighNativeToScene * vec4(origin, 1.0)).xyz;
    point += normalize(mat3(basilHighNativeToScene) * direction) * basilHighBackgroundDistance;
    vec4 clip = basilHighSceneToClip * vec4(point, 1.0);
    vec2 uv = clip.xy / max(clip.w, .000001) * .5 + .5;
    if (clip.w > 0.0 && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))))
      return texture2D(basilHighBackdrop, uv).rgb;
  }
  return basilHighEnvironment(direction, 0.0);
}
`;

function highInterface(mesh: THREE.Mesh): THREE.Object3D | undefined {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (node.userData.basilHighInterface || node.userData.basilHighNeck) return node;
}

export function createBasilBottleMaterialContext(root: THREE.Object3D, asset: ProductAsset) {
  let outer: THREE.Mesh | undefined;
  root.traverse(node => {
    if (node instanceof THREE.Mesh && (Array.isArray(node.material) ? node.material : [node.material]).some(material =>
      material.name === 'basil-high-outer' && basilMaterialRole(asset, node, material) === 'body')) outer = node;
  });
  if (!outer) return;
  const sourceInterface = highInterface(outer);
  const nativeArray = sourceInterface?.userData.nativeToGlbMatrix;
  if (!Array.isArray(nativeArray) || nativeArray.length !== 16 || !nativeArray.every(Number.isFinite)) throw new Error('Basil High native frame is missing');
  // Export metadata explicitly stores row-major, unlike Matrix4.fromArray().
  const nativeToMesh = new THREE.Matrix4().set(...nativeArray as Parameters<THREE.Matrix4['set']>);
  const meshToNative = nativeToMesh.clone().invert();
  const alignment = Number(sourceInterface?.userData.unityAlignment);
  if (!Number.isFinite(alignment) || alignment <= 0) throw new Error('Basil High alignment is invalid');
  const opticalScale = 100 * alignment;
  const lease = acquireBasilHighData();
  const neckLease = acquireBasilHighData(true);
  const uniforms: Record<string, THREE.IUniform> = {
    basilHighMeshToNative: { value: meshToNative },
    basilHighNormalToNative: { value: new THREE.Matrix3().getNormalMatrix(meshToNative) },
    basilHighLocalToWorld: { value: new THREE.Matrix4() },
    basilHighNativeToScene: { value: new THREE.Matrix4() },
    basilHighSceneToClip: { value: new THREE.Matrix4() },
    basilHighBackgroundDistance: { value: .025 },
    basilHighCameraNative: { value: new THREE.Vector3() },
    basilHighAbsorption: { value: new THREE.Vector3() },
    basilHighLiquidColor: { value: new THREE.Color(BASIL_HIGH_PRESET.liquidColor) },
    basilHighSeedColor: { value: new THREE.Color().setRGB(...BASIL_HIGH_PRESET.seedColorSrgb, THREE.SRGBColorSpace) },
    basilHighLightDirection: { value: new THREE.Vector3(0, 1, 0) }, basilHighLightColor: { value: new THREE.Color(0, 0, 0) },
    basilHighGelThickness: { value: BASIL_HIGH_PRESET.gelThicknessNative / alignment },
    basilHighSeedDepth: { value: 0 }, basilHighSpread: { value: 0 }, basilHighRoughness: { value: BASIL_HIGH_PRESET.roughness },
    basilHighNativeAlpha: { value: 0 }, basilHighBackdrop: { value: null },
    basilHighNeck: { value: 0 },
    basilHighOpaqueColor: { value: new THREE.Color().setRGB(...BASIL_HIGH_PRESET.goldColorSrgb, THREE.SRGBColorSpace) },
    basilHighHasBackdrop: { value: 0 }, basilHighHasMatte: { value: 0 }, basilHighMatte: { value: new THREE.Color('#ffffff') }, basilHighMatteBottom: { value: new THREE.Color('#ffffff') },
  };
  const neckUniforms = THREE.UniformsUtils.clone(uniforms);
  neckUniforms.basilHighNeck.value = 1;
  neckUniforms.basilHighGelThickness.value = 0;
  const bindData = (data: Awaited<typeof lease.ready>, target: Record<string, THREE.IUniform>) => {
    Object.assign(target, {
      basilHighResidualTriangles: { value: data.textures.residualTriangles }, basilHighResidualNodes: { value: data.textures.residualNodes },
      basilHighProfiles: { value: data.textures.profiles }, basilHighProfileNodes: { value: data.textures.profileNodes },
      basilHighSeeds: { value: data.textures.seedEllipsoids }, basilHighSeedNodes: { value: data.textures.seedNodes },
      basilHighDataWidth: { value: data.width }, basilHighResidualNodeStride: { value: data.header.residualNodeStride },
      basilHighRayEpsilon: { value: Math.max(1e-9, Math.hypot(...data.header.bounds.extent.map(value => value * 2)) * 1e-6) },
    });
  };
  const ready = Promise.all([lease.ready.then(data => bindData(data, uniforms)), neckLease.ready.then(data => bindData(data, neckUniforms))]).then(() => {});
  // An appearance may be superseded before its async binding is awaited.
  // Keep its rejection observable to awaiters without an unhandled late rejection.
  void ready.catch(() => {});
  const color = new THREE.Color(), srgb = new THREE.Color();
  let waterMaterial: THREE.MeshStandardMaterial | undefined;
  const applyColor = (value: string, roughness = 0) => {
    color.set(value); srgb.copy(color).convertLinearToSRGB();
    const params = basilHighLiquidParameters([srgb.r, srgb.g, srgb.b], 1 - roughness, 1, 1, BASIL_HIGH_PRESET.seedDepthFade, BASIL_HIGH_PRESET.depthAwareness);
    uniforms.basilHighLiquidColor.value.copy(color);
    uniforms.basilHighAbsorption.value.fromArray(params.absorption);
    uniforms.basilHighSeedDepth.value = params.seedDepth; uniforms.basilHighSpread.value = params.spread;
  };
  applyColor(BASIL_HIGH_PRESET.liquidColor);
  const worldToNative = new THREE.Matrix4(), worldCamera = new THREE.Vector3();
  const lightPosition = new THREE.Vector3(), lightTarget = new THREE.Vector3();
  return {
    defaultColor: color.clone(), ready,
    dispose: () => { lease.release(); neckLease.release(); },
    configure(material: THREE.MeshStandardMaterial, mesh: THREE.Mesh, role: Role, juiceColor?: string, capColor?: string) {
      if (role === 'cap') {
        material.metalness = 1; material.roughness = .388;
        material.color.setRGB(...BASIL_HIGH_PRESET.goldColorSrgb, THREE.SRGBColorSpace);
        if (capColor) material.color.set(capColor);
        neckUniforms.basilHighOpaqueColor.value.copy(material.color);
        material.transparent = false; material.opacity = 1; return;
      }
      if (role === 'label') {
        material.side = THREE.DoubleSide;
        material.metalness = 0; material.roughness = BASIL_HIGH_PRESET.labelRoughness;
        material.transparent = true; material.opacity = 1; material.depthWrite = true;
        if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
        return;
      }
      if (role === 'liquid' || role === 'inclusions') {
        material.visible = false;
        // Hidden Water retains the UI smoothness property used by High's ray kernel.
        if (role === 'liquid') {
          waterMaterial = material;
          material.roughness = 1 - BASIL_HIGH_PRESET.liquidSmoothness;
        }
        applyColor(juiceColor ?? BASIL_HIGH_PRESET.liquidColor, waterMaterial?.roughness ?? 0);
        liquidColorUpdates.set(material, value => applyColor(value, waterMaterial?.roughness ?? 0));
        return;
      }
      const neck = material.name === 'basil-high-neck';
      if (role !== 'body' || (!neck && material.name !== 'basil-high-outer')) { material.visible = false; return; }
      const frame = neck ? highInterface(mesh)?.userData.nativeToGlbMatrix : nativeArray;
      if (!Array.isArray(frame) || frame.length !== 16) throw new Error('Basil neck native frame is missing');
      const nativeFrame = neck ? new THREE.Matrix4().set(...frame as Parameters<THREE.Matrix4['set']>) : nativeToMesh;
      const opticalDistanceScale = neck ? 1 : opticalScale;
      const drawUniforms = neck ? neckUniforms : uniforms;
      if (neck) {
        drawUniforms.basilHighMeshToNative.value.copy(nativeFrame).invert();
        drawUniforms.basilHighNormalToNative.value.getNormalMatrix(drawUniforms.basilHighMeshToNative.value);
      }
      material.color.set('#ffffff'); material.metalness = 0; material.roughness = neck ? .15 : BASIL_HIGH_PRESET.roughness;
      material.transparent = true; material.opacity = 1; material.depthWrite = true; material.side = THREE.FrontSide;
      material.normalMap = null; material.roughnessMap = null; material.map = null;
      if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
      applyColor(juiceColor ?? BASIL_HIGH_PRESET.liquidColor, waterMaterial?.roughness ?? 0);
      material.customProgramCacheKey = () => 'basil-label-lab-high-v1';
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, drawUniforms);
        shader.vertexShader = hostDeclarations + shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vBasilHighPosition = (basilHighMeshToNative * vec4(transformed, 1.0)).xyz;
          vBasilHighNormal = normalize(basilHighNormalToNative * objectNormal);
        `);
        const main = shader.fragmentShader.indexOf('void main() {');
        if (main < 0) throw new Error('Basil High requires the Three standard shader');
        shader.fragmentShader = hostDeclarations + shader.fragmentShader.slice(0, main) + BASIL_HIGH_OPTICS_GLSL + hostFunctions + /* glsl */`
          void main() {
            #include <clipping_planes_fragment>
            #include <logdepthbuf_fragment>
            vec4 basilColor = basilHighShade(vBasilHighPosition, vBasilHighNormal, basilHighCameraNative);
            // High beauty exports use product silhouette alpha, including colored water.
            // Native neck radiance/alpha is captured separately and its light
            // carrier is reserved after tone mapping, like GlassNeckExportScope.
            gl_FragColor = vec4(basilColor.rgb / max(basilColor.a, .000001), basilColor.a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <premultiplied_alpha_fragment>
          }
        `;
      };
      material.onBeforeRender = (_renderer, scene, camera, _geometry, object) => {
        drawUniforms.basilHighNativeToScene.value.multiplyMatrices(object.matrixWorld, nativeFrame);
        worldToNative.copy(drawUniforms.basilHighNativeToScene.value).invert();
        camera.getWorldPosition(worldCamera); drawUniforms.basilHighCameraNative.value.copy(worldCamera).applyMatrix4(worldToNative);
        drawUniforms.basilHighSceneToClip.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        // Unity projects a point .25 world units beyond the ray exit. Convert that
        // distance with the same optical frame, including viewer normalization.
        const frameElements = drawUniforms.basilHighNativeToScene.value.elements;
        drawUniforms.basilHighBackgroundDistance.value = .25 * Math.hypot(frameElements[0], frameElements[1], frameElements[2]) / opticalDistanceScale;
        // Visual meters/thumbnail normalization must not alter Label Lab's optical depth.
        const optics = drawUniforms.basilHighLocalToWorld.value as THREE.Matrix4;
        optics.copy(drawUniforms.basilHighNativeToScene.value);
        for (const offset of [0, 4, 8]) {
          const e = optics.elements, scale = opticalDistanceScale / Math.hypot(e[offset], e[offset + 1], e[offset + 2]);
          e[offset] *= scale; e[offset + 1] *= scale; e[offset + 2] *= scale;
        }
        drawUniforms.basilHighRoughness.value = material.roughness;
        drawUniforms.basilHighLightColor.value.setRGB(0, 0, 0);
        let key: THREE.DirectionalLight | undefined;
        scene.traverse(node => { if (node instanceof THREE.DirectionalLight && node.visible && (!key || node.intensity > key.intensity)) key = node; });
        if (key) {
          key.getWorldPosition(lightPosition); key.target.getWorldPosition(lightTarget);
          drawUniforms.basilHighLightDirection.value.copy(lightPosition).sub(lightTarget).normalize();
          drawUniforms.basilHighLightColor.value.copy(key.color).multiplyScalar(key.intensity);
        }
        const backdrop = backgrounds.get(scene);
        const matte = backdrop?.color ?? (scene.background instanceof THREE.Color ? scene.background : null);
        drawUniforms.basilHighHasBackdrop.value = backdrop?.texture ? 1 : 0; drawUniforms.basilHighBackdrop.value = backdrop?.texture ?? null;
        drawUniforms.basilHighHasMatte.value = matte ? 1 : 0; if (matte) drawUniforms.basilHighMatte.value.copy(matte);
        if (matte) drawUniforms.basilHighMatteBottom.value.copy(backdrop?.colorBottom ?? matte);
        drawUniforms.basilHighNativeAlpha.value = neck && backdrop?.transparentNeck ? 1 : 0;
      };
    },
  };
}
