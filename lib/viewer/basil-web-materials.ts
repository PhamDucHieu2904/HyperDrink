import * as THREE from 'three';
import { addBottleBackdropProjection, createBottleBackdropUniforms, updateBottleBackdropUniforms } from './bottle-backdrop';
import type { ProductAsset } from '../viewer-config';
import { liquidColorUpdates } from './material-adjustments';
import { aloeTransmissionClearRadiance, correctAloeTransmissionClear } from './aloe-bottle-materials';
import { BASIL_WEB_OPTICS, BASIL_WEB_VOLUME_GLSL, basilWebAbsorption, configureBasilWebInclusions, createBasilWebUniforms, fitBasilWebProfile } from './basil-web-optics';

type Role = 'body' | 'ring' | 'liquid' | 'liquid-back' | 'inclusions' | 'cap' | 'label';
const PROFILE = 'basil-web-v1';
const GOLD = [.9528302, .8926178, .3460751] as const;
interface SeedMetadata {
  formatVersion: number; count: number; nativeToGlbMatrix: number[]; gelThicknessNative: number;
  seeds: Array<{ center: number[]; inverseX: number[]; inverseY: number[]; inverseZ: number[] }>;
}

export function basilWebMaterialRole(asset: ProductAsset, mesh: THREE.Mesh, material: THREE.Material): Role | undefined {
  if (asset.packaging !== 'glass' || (mesh.userData.basilProfile !== PROFILE && material.userData.basilProfile !== PROFILE)) return;
  return Object.entries(asset.materialSlots ?? {}).find(([, names]) => names.includes(material.name) || names.includes(mesh.name))?.[0] as Role | undefined;
}

/** Hydrated ellipsoids retain the High core fits and fixed gel offset. One
 * instance draw replaces 330 separate meshes; source geometry stays untouched. */
export function prepareBasilWebLayers(root: THREE.Object3D, asset: ProductAsset): void {
  if (asset.packaging !== 'glass') return;
  // The appearance pool commits materials from a prepared clone, not its mesh
  // callbacks. Attach capture hooks to the actual root before cloning as well.
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const role = (Array.isArray(node.material) ? node.material : [node.material]).map(material => basilWebMaterialRole(asset, node, material)).find(Boolean);
    if (role === 'liquid' || role === 'inclusions') configureCaptureOnly(node);
    else if (role === 'cap' || role === 'label') configureBeautyOnly(node);
  });
  let owner: THREE.Object3D | undefined;
  root.traverse(node => { if (node.userData.basilWebSeeds) owner = node; });
  if (!owner || owner.children.some(child => child.userData.basilWebGenerated)) return;
  const metadata = owner.userData.basilWebSeeds as SeedMetadata;
  if (metadata.formatVersion !== 1 || metadata.count !== 330 || metadata.seeds.length !== metadata.count ||
      metadata.nativeToGlbMatrix.length !== 16 || !metadata.nativeToGlbMatrix.every(Number.isFinite) || !(metadata.gelThicknessNative > 0))
    throw new Error('Basil web gel metadata is invalid');
  const geometry = new THREE.SphereGeometry(1, 10, 6);
  const ratios = new Float32Array(metadata.count * 3);
  const material = new THREE.MeshStandardMaterial({ color: 'white' });
  material.name = 'basil-web-seed-gel'; material.userData.basilProfile = PROFILE;
  const mesh = new THREE.InstancedMesh(geometry, material, metadata.count);
  mesh.name = 'Basil hydrated seeds'; mesh.userData = { basilProfile: PROFILE, basilWebGenerated: true };
  const nativeToGlb = new THREE.Matrix4().set(...metadata.nativeToGlbMatrix as Parameters<THREE.Matrix4['set']>);
  const basis = new THREE.Matrix4(), axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  metadata.seeds.forEach((seed, i) => {
    const inverseAxes = [seed.inverseX, seed.inverseY, seed.inverseZ];
    inverseAxes.forEach((values, j) => {
      if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error('Basil seed axis is invalid');
      axis[j].fromArray(values);
      const length = axis[j].length(), radius = 1 / length;
      if (!(length > 0)) throw new Error('Basil seed radius is invalid');
      ratios[i * 3 + j] = radius / (radius + metadata.gelThicknessNative);
      axis[j].multiplyScalar((radius + metadata.gelThicknessNative) / length);
    });
    basis.makeBasis(...axis as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
    basis.setPosition(new THREE.Vector3().fromArray(seed.center));
    basis.premultiply(nativeToGlb);
    // Ellipsoids are invariant under an axis reflection. Keep positive instance
    // determinants because Three does not support mirrored InstancedMesh draws.
    if (basis.determinant() < 0) for (let j = 0; j < 3; j++) basis.elements[j] *= -1;
    mesh.setMatrixAt(i, basis);
  });
  geometry.setAttribute('basilCoreRatio', new THREE.InstancedBufferAttribute(ratios, 3));
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  owner.add(mesh);
  configureCaptureOnly(mesh);
}

const beautyTargets = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget | null>();
const restorations = new WeakMap<THREE.WebGLRenderer, Set<() => void>>();
const captureOnly = new WeakSet<THREE.Mesh>();
const beautyOnly = new WeakSet<THREE.Mesh>();
export function beginBasilWebRender(renderer: THREE.WebGLRenderer) { beautyTargets.set(renderer, renderer.getRenderTarget()); }
export function endBasilWebRender(renderer: THREE.WebGLRenderer) {
  restorations.get(renderer)?.forEach(restore => restore());
  beautyTargets.delete(renderer);
}
function configureCaptureOnly(mesh: THREE.Mesh) {
  if (captureOnly.has(mesh)) return;
  captureOnly.add(mesh);
  configureRenderLayer(mesh, false);
}

/** Solid cap/print write depth before transmitting glass in the beauty opaque
 * queue. Excluding their capture draw keeps them out of the refracted reservoir,
 * without letting the glass's depth erase their interior faces. */
function configureBeautyOnly(mesh: THREE.Mesh) {
  if (beautyOnly.has(mesh)) return;
  beautyOnly.add(mesh);
  configureRenderLayer(mesh, true);
}

function configureRenderLayer(mesh: THREE.Mesh, onlyBeauty: boolean) {
  const before = mesh.onBeforeRender, after = mesh.onAfterRender;
  let restore: (() => void) | undefined;
  mesh.onBeforeRender = function(renderer, scene, camera, geometry, material, group) {
    before.call(this, renderer, scene, camera, geometry, material, group);
    if (!beautyTargets.has(renderer)) return;
    const isBeauty = renderer.getRenderTarget() === beautyTargets.get(renderer);
    if (isBeauty === onlyBeauty) return;
    const { start, count } = geometry.drawRange;
    let pending = restorations.get(renderer);
    if (!pending) { pending = new Set(); restorations.set(renderer, pending); }
    const restoreDraw = () => { geometry.setDrawRange(start, count); pending.delete(restoreDraw); restore = undefined; };
    restore = restoreDraw; pending.add(restoreDraw); geometry.setDrawRange(0, 0);
  };
  mesh.onAfterRender = function(renderer, scene, camera, geometry, material, group) {
    restore?.(); after.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/** Geometry supplies molded base refraction. A single native opaque capture
 * contains the back water and seed/gel response, with no BVH/data textures,
 * per-seed transmission, DOM backdrop capture, or alternate environment. */
export function createBasilWebBottleMaterialContext(root: THREE.Object3D, asset: ProductAsset) {
  let water: THREE.Mesh | undefined;
  root.traverse(node => {
    if (node instanceof THREE.Mesh && (Array.isArray(node.material) ? node.material : [node.material]).some(material => basilWebMaterialRole(asset, node, material) === 'liquid')) water = node;
  });
  if (!water) return;
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const toMetric = (mesh: THREE.Mesh) => new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
  const profile = fitBasilWebProfile(water.geometry, toMetric(water));
  if (!profile) throw new Error('Basil web water profile is empty');
  const color = new THREE.Color('#be2838');
  const shared: Record<string, THREE.IUniform> = {
    ...createBottleBackdropUniforms(),
    basilWebLiquidColor: { value: color }, basilWebAbsorption: { value: new THREE.Vector3() },
    basilWebSeedColor: { value: new THREE.Color().setRGB(...BASIL_WEB_OPTICS.seedColorSrgb, THREE.SRGBColorSpace) },
    basilWebSeedDepth: { value: BASIL_WEB_OPTICS.seedDepthPerMetre },
    // The shared softbox is brighter than the reference room. Keep the hydrated
    // rim visible without turning its transmitted haze into a white ring.
    basilWebGelHaze: { value: .18 },
  };
  const srgb = new THREE.Color();
  const applyColor = (value: string) => {
    color.set(value); srgb.copy(color).convertLinearToSRGB();
    shared.basilWebAbsorption.value.copy(basilWebAbsorption(srgb));
  };
  applyColor('#be2838');
  return {
    ready: undefined as Promise<void> | undefined,
    dispose: undefined as (() => void) | undefined,
    defaultColor: color.clone(),
    configure(material: THREE.MeshStandardMaterial, mesh: THREE.Mesh, role: Role, juiceColor?: string, capColor?: string) {
      material.visible = true;
      if (role === 'cap' || role === 'label') {
        configureBeautyOnly(mesh);
        material.transparent = false; material.opacity = 1; material.depthWrite = true; material.depthTest = true;
        material.side = THREE.DoubleSide; material.forceSinglePass = true;
        if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
        if (role === 'cap') { material.metalness = 1; material.roughness = .388; material.color.setRGB(...GOLD, THREE.SRGBColorSpace); if (capColor) material.color.set(capColor); }
        else { material.side = THREE.DoubleSide; material.metalness = 0; material.roughness = .5; }
        return;
      }
      const meshToMetric = toMetric(mesh);
      if (role === 'liquid' || role === 'inclusions') {
        applyColor(juiceColor ?? '#be2838');
        liquidColorUpdates.set(material, applyColor);
        configureCaptureOnly(mesh);
        if (role === 'inclusions') {
          if (!(mesh instanceof THREE.InstancedMesh)) throw new Error('Basil web inclusions must be instanced');
          configureBasilWebInclusions(material, mesh, profile, meshToMetric, shared);
          return;
        }
        const uniforms = createBasilWebUniforms(profile, meshToMetric, shared);
        material.color.setRGB(1, 1, 1); material.metalness = 0; material.roughness = 1;
        material.transparent = false; material.opacity = 1; material.side = THREE.BackSide; material.depthWrite = true;
        if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, uniforms);
          addBottleBackdropProjection(shader);
          shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${BASIL_WEB_VOLUME_GLSL}\nvarying float vBasilWebChord;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\nvec3 basilPoint=(basilWebMeshToMetric*vec4(transformed,1.0)).xyz;\nvec3 basilRay=basilWebOrthographic>.5?-basilWebViewMetric:normalize(basilWebCameraMetric-basilPoint);\nvBasilWebChord=basilWebExit(basilPoint,basilRay);`);
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 basilWebAbsorption;\nvarying float vBasilWebChord;')
            .replace('#include <opaque_fragment>', 'gl_FragColor=vec4(bottleBackdropAt(bottleBackdropUv())*exp(-basilWebAbsorption*max(0.0,vBasilWebChord)),1.0);');
        };
        const inverseWorld = new THREE.Matrix4();
        material.onBeforeRender = (_renderer, scene, camera, _geometry, object) => {
          updateBottleBackdropUniforms(shared as ReturnType<typeof createBottleBackdropUniforms>, scene);
          inverseWorld.copy(object.matrixWorld).invert();
          camera.getWorldPosition(uniforms.basilWebCameraMetric.value).applyMatrix4(inverseWorld).applyMatrix4(meshToMetric);
          camera.getWorldDirection(uniforms.basilWebViewMetric.value).transformDirection(inverseWorld).transformDirection(meshToMetric);
          uniforms.basilWebOrthographic.value = camera instanceof THREE.OrthographicCamera ? 1 : 0;
        };
        material.customProgramCacheKey = () => 'basil-web-back-water-v2';
        return;
      }
      if (role !== 'body' || !(material instanceof THREE.MeshPhysicalMaterial)) return;
      const neck = material.name === 'basil-web-neck';
      material.color.setRGB(1, 1, 1); material.metalness = 0; material.roughness = neck ? .15 : BASIL_WEB_OPTICS.glassRoughness;
      material.normalMap = null; material.roughnessMap = null; material.map = null;
      material.transparent = true; material.opacity = 1; material.depthWrite = true; material.side = THREE.FrontSide;
      material.transmission = 1; material.ior = BASIL_WEB_OPTICS.glassIOR;
      material.attenuationColor.setRGB(1, 1, 1); material.attenuationDistance = Infinity;
      const physicalThickness = neck ? .0013 : Math.min(profile.halfBounds.x, profile.halfBounds.y) * .42;
      material.thickness = physicalThickness;
      const uniforms = { aloeClearRadiance: { value: 1 }, basilWebWorldThickness: { value: physicalThickness } };
      const metricToLocal = meshToMetric.clone().invert(), metricToWorld = new THREE.Matrix4();
      material.onBeforeRender = (renderer, _scene, _camera, _geometry, object) => {
        uniforms.aloeClearRadiance.value = aloeTransmissionClearRadiance(renderer);
        metricToWorld.copy(object.matrixWorld).multiply(metricToLocal);
        uniforms.basilWebWorldThickness.value = physicalThickness * metricToWorld.getMaxScaleOnAxis();
      };
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float aloeClearRadiance;\nuniform float basilWebWorldThickness;')
          .replace('#include <transmission_pars_fragment>', correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment)
            .replace('return normalize( refractionVector ) * thickness * modelScale;', 'return normalize( refractionVector ) * basilWebWorldThickness;'))
          .replace('#include <opaque_fragment>', `
            float capturedCoverage=clamp(material.transmissionAlpha,0.0,1.0);
            float highlight=clamp(max(max(totalSpecular.r,totalSpecular.g),totalSpecular.b),0.0,1.0);
            float fresnel=pow(1.0-saturate(dot(normal,geometryViewDir)),5.0);
            float coverage=capturedCoverage+(1.0-capturedCoverage)*clamp(highlight*.35+fresnel*.15,0.0,1.0);
            gl_FragColor=vec4((totalDiffuse*capturedCoverage+totalSpecular)/max(coverage,.0001),coverage);
          `);
      };
      material.customProgramCacheKey = () => 'basil-web-polished-shell-v1';
    },
  };
}
