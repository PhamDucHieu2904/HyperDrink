import * as THREE from 'three';
import { liquidColorUpdates } from './material-adjustments';
import type { ProductAsset } from '../viewer-config';
import { aloeTransmissionClearRadiance, correctAloeTransmissionClear, createAloeBottleMaterialContext } from './aloe-bottle-materials';

type BottleRole = 'body' | 'ring' | 'liquid' | 'liquid-back' | 'inclusions' | 'cap' | 'label';
const PROFILE = 'nata-pet-v1';
const bottleProfiles = new Set([PROFILE, 'aloe-pet-v1']);
const roles = new Set<BottleRole>(['body', 'liquid', 'inclusions', 'cap', 'label']);

/** Metres and linear-radiance controls, independent of the flavor/background color. */
export const NATA_PET_OPTICS = Object.freeze({
  brightness: 1.08,
  saturationBoost: 0.15,
  refractionRoughness: 0.14,
  jellyVisibility: 0.45,
  jellyExtinction: 120,
  jellyFadeStart: 0.01,
  jellyFadeEnd: 0.024,
});

/** Frosted molded PET rim: neutral haze builds along a longer grazing path. */
export const NATA_PET_RING = Object.freeze({
  tint: '#fff9ed',
  roughness: 0.19,
  opticalThicknessMetres: 0.0009,
  extinctionPerMetre: 240,
  minimumViewCosine: 0.2,
});

/** The thinner Aloe neck ring has less bulk haze and a polished refractive finish. */
export const ALOE_PET_RING = Object.freeze({
  tint: '#fffdf7',
  roughness: 0.085,
  transmission: 0.93,
  opticalThicknessMetres: 0.0008,
  extinctionPerMetre: 90,
  minimumViewCosine: 0.24,
});

export function aloeRingHaze(viewCosine: number, basemapAlpha = 0): number {
  const cosine = THREE.MathUtils.clamp(Math.abs(viewCosine), ALOE_PET_RING.minimumViewCosine, 1);
  const transmittance = Math.exp(-ALOE_PET_RING.extinctionPerMetre * ALOE_PET_RING.opticalThicknessMetres / cosine);
  return 1 - (1 - THREE.MathUtils.clamp(basemapAlpha, 0, 1)) * transmittance;
}

export function nataRingHaze(viewCosine: number, basemapAlpha = 0): number {
  const cosine = THREE.MathUtils.clamp(Math.abs(viewCosine), NATA_PET_RING.minimumViewCosine, 1);
  const transmittance = Math.exp(-NATA_PET_RING.extinctionPerMetre * NATA_PET_RING.opticalThicknessMetres / cosine);
  return 1 - (1 - THREE.MathUtils.clamp(basemapAlpha, 0, 1)) * transmittance;
}

/** Unity's artistic vivid scattering is exposure-independent; keep its hue without HDRP EV100 gain. */
export function nataScatteringColor(juice: THREE.Color): THREE.Color {
  const hsl = juice.getHSL({ h: 0, s: 0, l: 0 });
  const saturation = hsl.s < 0.01 ? hsl.s : hsl.s + (1 - hsl.s) * NATA_PET_OPTICS.saturationBoost;
  return new THREE.Color().setHSL(hsl.h, saturation, hsl.l).multiplyScalar(NATA_PET_OPTICS.brightness);
}

/** Mirrors the physical near-depth control used by the shader, useful for calibration. */
export function nataJellyReveal(depthMetres: number): number {
  const depth = Math.max(0, Number.isFinite(depthMetres) ? depthMetres : Infinity);
  const x = THREE.MathUtils.clamp((depth - NATA_PET_OPTICS.jellyFadeStart) / (NATA_PET_OPTICS.jellyFadeEnd - NATA_PET_OPTICS.jellyFadeStart), 0, 1);
  return Math.exp(-depth * NATA_PET_OPTICS.jellyExtinction) * (1 - x * x * (3 - 2 * x)) * NATA_PET_OPTICS.jellyVisibility;
}

/** The authored/exported profile is explicit; ordinary cans and other PETs retain their PBR. */
export function bottleMaterialRole(asset: ProductAsset, mesh: THREE.Mesh, material: THREE.Material): BottleRole | undefined {
  if (asset.packaging !== 'pet' || (!bottleProfiles.has(material.userData.bottleProfile) && !bottleProfiles.has(mesh.userData.bottleProfile))) return;
  const entry = Object.entries(asset.materialSlots ?? {}).find(([, names]) => names.includes(material.name))
    ?? Object.entries(asset.materialSlots ?? {}).find(([, names]) => names.includes(mesh.name));
  if (entry?.[0] === 'body' && (material.userData.nataRing === true || material.userData.aloeRing === true)) return 'ring';
  if (entry?.[0] === 'liquid' && (mesh.userData.nataLiquidBack === true || mesh.userData.aloeLiquidBack === true)) return 'liquid-back';
  return entry && roles.has(entry[0] as BottleRole) ? entry[0] as BottleRole : undefined;
}

/** One opaque back surface provides the scattering reservoir for rough refraction.
 * Geometry is shared with the authored liquid; no topology or Blender asset is changed. */
export function prepareBottleLayers(root: THREE.Object3D, asset: ProductAsset): void {
  if (asset.packaging !== 'pet') return;
  const liquids: { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }[] = [];
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || node.children.some(child => child.userData.nataLiquidBack === true || child.userData.aloeLiquidBack === true)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial && bottleMaterialRole(asset, node, material) === 'liquid') {
        liquids.push({ mesh: node, material }); break;
      }
    }
  });
  for (const { mesh, material } of liquids) {
    const backMaterial = new THREE.MeshStandardMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(backMaterial, material);
    backMaterial.transparent = false; backMaterial.opacity = 1; backMaterial.side = THREE.BackSide;
    backMaterial.depthWrite = true; backMaterial.name = material.name;
    const back = new THREE.Mesh(mesh.geometry, backMaterial);
    const profile = material.userData.bottleProfile ?? mesh.userData.bottleProfile;
    back.name = profile === 'aloe-pet-v1' ? 'aloe-liquid-scattering-back' : 'nata-liquid-scattering-back';
    back.userData = { ...mesh.userData, bottleProfile: profile,
      ...(profile === 'aloe-pet-v1' ? { aloeLiquidBack: true } : { nataLiquidBack: true }) };
    mesh.add(back);
  }
}

const captureOnlyLayers = new WeakSet<THREE.Mesh>();
const suppressedDraws = new WeakMap<THREE.WebGLRenderer, Set<() => void>>();

/** Three skips onAfterRender if a material/GPU draw throws. Always restore the
 * shared Water range, including failed frames and aborted offscreen captures. */
export function renderBottleScene(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): void {
  try { renderer.render(scene, camera); }
  finally {
    const pending = suppressedDraws.get(renderer);
    pending?.forEach(restore => restore());
    pending?.clear();
  }
}

/** The white-filled Aloe preview already composites these layers through native
 * transmission. Skip their duplicate beauty draw, preserving capture and PNG.
 * The back layer shares Water geometry: restore its range before Water is drawn. */
function configureAloeCaptureOnlyLayer(mesh: THREE.Mesh): void {
  if (captureOnlyLayers.has(mesh)) return;
  captureOnlyLayers.add(mesh);
  const before = mesh.onBeforeRender, after = mesh.onAfterRender;
  let restoreRange: (() => void) | undefined;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    before.call(this, renderer, scene, camera, geometry, material, group);
    if (renderer.getRenderTarget() !== null) return;
    const { start, count } = geometry.drawRange;
    let pending = suppressedDraws.get(renderer);
    if (!pending) { pending = new Set(); suppressedDraws.set(renderer, pending); }
    const restore = () => {
      geometry.setDrawRange(start, count);
      pending.delete(restore);
      restoreRange = undefined;
    };
    restoreRange = restore;
    pending.add(restore);
    geometry.setDrawRange(0, 0);
  };
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    restoreRange?.();
    after.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/** Transparent surfaces must retain their order during spins and pooled flavor swaps. */
export function configureBottleRenderOrder(root: THREE.Object3D, asset: ProductAsset): void {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const role = (Array.isArray(node.material) ? node.material : [node.material])
      .map(material => bottleMaterialRole(asset, node, material)).find(value => value === 'body' || value === 'ring' || value === 'liquid' || value === 'label' || value === 'cap' || value === 'inclusions' || value === 'liquid-back');
    if (role) {
      const aloe = node.userData.bottleProfile === 'aloe-pet-v1' ||
        (Array.isArray(node.material) ? node.material : [node.material]).some(material => material.userData.bottleProfile === 'aloe-pet-v1');
      node.renderOrder = role === 'body' || role === 'ring' ? 20 : role === 'liquid' ? 10 : role === 'inclusions' ? (aloe ? 1 : 0) : role === 'liquid-back' ? 0 : 30;
      if (aloe && (role === 'inclusions' || role === 'liquid-back')) configureAloeCaptureOnlyLayer(node);
    }
  });
}

const opticalDeclarations = /* glsl */`
uniform mat4 nataLocalToLiquid;
uniform vec3 nataCamera;
uniform vec3 nataViewDirection;
uniform float nataOrthographic;
uniform vec3 nataBounds; // radius, minimum Y, maximum Y in the authored liquid space
uniform vec3 nataCenter;
uniform vec3 nataJuiceColor;
uniform vec3 nataScatteringColor;
uniform float nataJellyVisibility;
uniform float nataJellyExtinction;
uniform vec2 nataJellyFadeRange;
varying vec3 vNataPosition;

// Distance from an interior point to the cylindrical wall/cap along a view ray.
// A finite cylinder approximates bulk turbidity without any extra render target.
float nataExitDistance(vec3 point, vec3 direction) {
  vec3 p = point - nataCenter;
  float a = max(dot(direction.xz, direction.xz), 0.000001);
  float b = dot(p.xz, direction.xz);
  float c = dot(p.xz, p.xz) - nataBounds.x * nataBounds.x;
  float radial = max(0.0, (-b + sqrt(max(0.0, b * b - a * c))) / a);
  float cap = 100000.0;
  if (direction.y > 0.00001) cap = (nataBounds.z - point.y) / direction.y;
  if (direction.y < -0.00001) cap = (nataBounds.y - point.y) / direction.y;
  return max(0.0, min(radial, cap));
}
vec3 nataTowardCamera() {
  return normalize(mix(nataCamera - vNataPosition, nataViewDirection, nataOrthographic));
}
`;

/** Colored scattering plus Three's opaque color pyramid gives actual rough refraction. */
export function createBottleMaterialContext(root: THREE.Object3D, asset: ProductAsset) {
  const aloe = createAloeBottleMaterialContext(root, asset);
  let liquid: THREE.Mesh | undefined;
  let originalLiquid: THREE.MeshStandardMaterial | undefined;
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || liquid) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial && bottleMaterialRole(asset, node, material) === 'liquid') {
        liquid = node; originalLiquid = material; break;
      }
    }
  });
  if (!liquid || !originalLiquid) return;
  root.updateMatrixWorld(true);
  liquid.geometry.computeBoundingBox();
  const bounds = liquid.geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.5;
  if (!Number.isFinite(radius) || radius <= 0) return;
  const liquidInverse = liquid.matrixWorld.clone().invert();
  const defaultColor = originalLiquid.color.clone();
  return {
    defaultColor,
    configure(material: THREE.MeshStandardMaterial, mesh: THREE.Mesh, role: BottleRole, juiceColor?: string, capColor?: string) {
      // Aloe uses a tapered square volume and gel optics of its own. The molded
      // cap/print capture exclusion remains shared with the 320 ml.
      if (aloe && role !== 'ring' && role !== 'cap' && role !== 'label') {
        aloe.configure(material, mesh, role, juiceColor);
        return;
      }
      if (role === 'label') {
        // Three captures only the opaque queue for physical transmission.
        // Print still covers the bottle at alpha 1 in the final queue, but can
        // no longer be sampled into the exposed liquid at the neck/label edge.
        material.transparent = true; material.opacity = 1;
        material.depthWrite = true; material.depthTest = true;
        if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
        return;
      }
      material.metalness = 0;
      material.side = THREE.FrontSide;
      if (material instanceof THREE.MeshPhysicalMaterial) {
        // PET stays a reflection overlay; only the liquid front will opt into
        // native transmission after its opaque jelly/scattering layers are set.
        material.transmission = 0;
        material.clearcoat = 0;
      }
      if (role === 'cap') {
        material.color.set(capColor || '#f6f5ed'); material.roughness = 0.29;
        // Like the print, a solid cap belongs to the final queue so its white
        // plastic cannot enter the liquid's opaque transmission capture.
        material.opacity = 1; material.transparent = true;
        material.depthWrite = true; material.depthTest = true;
        return;
      }
      if (role === 'ring') {
        if (aloe) {
          material.color.set(ALOE_PET_RING.tint); material.roughness = ALOE_PET_RING.roughness;
          material.opacity = 1; material.transparent = true; material.depthWrite = false;
          const metricToLocal = mesh.matrixWorld.clone().invert();
          const metricToWorld = new THREE.Matrix4();
          const uniforms = {
            aloeRingOpticalDepth: { value: ALOE_PET_RING.extinctionPerMetre * ALOE_PET_RING.opticalThicknessMetres },
            aloeRingMinimumViewCosine: { value: ALOE_PET_RING.minimumViewCosine },
            aloeRingWorldThickness: { value: Number(ALOE_PET_RING.opticalThicknessMetres) },
            aloeClearRadiance: { value: 1 },
          };
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.ior = 1.47; material.transmission = ALOE_PET_RING.transmission;
            material.thickness = ALOE_PET_RING.opticalThicknessMetres;
            material.attenuationColor.set('#ffffff'); material.attenuationDistance = Infinity;
          }
          material.onBeforeRender = (renderer, _scene, _camera, _geometry, renderedObject) => {
            uniforms.aloeClearRadiance.value = aloeTransmissionClearRadiance(renderer);
            // Use the actual pooled draw's scale, without stretching the ray by
            // the source Body mesh's retained nonuniform Blender transform.
            metricToWorld.copy(renderedObject.matrixWorld).multiply(metricToLocal);
            uniforms.aloeRingWorldThickness.value = ALOE_PET_RING.opticalThicknessMetres * metricToWorld.getMaxScaleOnAxis();
          };
          material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, uniforms);
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */`#include <common>
              uniform float aloeRingOpticalDepth;
              uniform float aloeRingMinimumViewCosine;
              uniform float aloeRingWorldThickness;
              uniform float aloeClearRadiance;
            `).replace('#include <transmission_pars_fragment>',
              correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment).replace(
                'return normalize( refractionVector ) * thickness * modelScale;',
                'return normalize( refractionVector ) * aloeRingWorldThickness;'))
              .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace(
                'material.transmission = transmission;',
                'material.transmission = transmission * (1.0 - diffuseColor.a);'))
              .replace('#include <opaque_fragment>', /* glsl */`
                float ringCosine = clamp(abs(dot(normal, geometryViewDir)), aloeRingMinimumViewCosine, 1.0);
                float ringHazeAlpha = 1.0 - (1.0 - diffuseColor.a) * exp(-aloeRingOpticalDepth / ringCosine);
                float ringFresnel = pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
                float ringHighlight = clamp(max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b), 0.0, 1.0);
                float ringAlpha = clamp(ringHazeAlpha + ringFresnel * 0.15 + ringHighlight * 0.55, 0.0, 1.0);
                #ifdef USE_TRANSMISSION
                  // The refracted scene already contains its own radiance.
                  // Only clear pixels need alpha haze; opaque basemap marks
                  // retain their diffuse plastic instead of becoming clear.
                  ringAlpha = mix(ringAlpha, 1.0, material.transmissionAlpha);
                  gl_FragColor = vec4((totalSpecular + totalDiffuse) / max(ringAlpha, 0.001), ringAlpha);
                #else
                  gl_FragColor = vec4((totalSpecular + totalDiffuse * ringHazeAlpha) / max(ringAlpha, 0.001), ringAlpha);
                #endif
              `);
          };
          material.customProgramCacheKey = () => 'aloe-pet-v1:ring:4';
          return;
        }
        material.color.set(NATA_PET_RING.tint); material.roughness = NATA_PET_RING.roughness;
        if (material instanceof THREE.MeshPhysicalMaterial) material.ior = 1.47;
        material.opacity = 1; material.transparent = true; material.depthWrite = false;
        material.onBeforeCompile = shader => {
          shader.uniforms.nataRingOpticalDepth = { value: NATA_PET_RING.extinctionPerMetre * NATA_PET_RING.opticalThicknessMetres };
          shader.uniforms.nataRingMinimumViewCosine = { value: NATA_PET_RING.minimumViewCosine };
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float nataRingOpticalDepth;\nuniform float nataRingMinimumViewCosine;')
            .replace('#include <opaque_fragment>', /* glsl */`
              float ringCosine = clamp(abs(dot(normal, geometryViewDir)), nataRingMinimumViewCosine, 1.0);
              // Keep the supplied basemap alpha, then add the missing bulk haze
              // of molded PET. A grazing view crosses more plastic than a front view.
              float ringHazeAlpha = 1.0 - (1.0 - diffuseColor.a) * exp(-nataRingOpticalDepth / ringCosine);
              float ringFresnel = pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
              float ringHighlight = clamp(max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b), 0.0, 1.0);
              float ringAlpha = clamp(ringHazeAlpha + ringFresnel * 0.18 + ringHighlight * 0.5, 0.0, 1.0);
              gl_FragColor = vec4((totalSpecular + totalDiffuse * ringHazeAlpha) / max(ringAlpha, 0.001), ringAlpha);
            `);
        };
        material.customProgramCacheKey = () => `${PROFILE}:ring:2`;
        return;
      }
      if (role === 'body') {
        material.color.set('#ffffff'); material.roughness = 0.075;
        if (material instanceof THREE.MeshPhysicalMaterial) material.ior = 1.47;
        material.opacity = 1; material.transparent = true; material.depthWrite = false;
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
            // Keep HDRI specular energy while the thin shell stays clear between
            // reflections. Diffuse alpha would otherwise turn PET into milky glass.
            float petFresnel = pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
            float petHighlight = clamp(max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b), 0.0, 1.0);
            float petAlpha = clamp(0.025 + petFresnel * 0.25 + petHighlight * 0.6, 0.025, 0.62);
            gl_FragColor = vec4((totalSpecular + totalDiffuse * 0.006) / petAlpha, petAlpha);
          `);
        };
        material.customProgramCacheKey = () => `${PROFILE}:shell:1`;
        return;
      }
      const juice = juiceColor ? new THREE.Color(juiceColor) : defaultColor.clone();
      const scattering = nataScatteringColor(juice);
      if (role === 'liquid-back') {
        material.side = THREE.BackSide;
        material.transparent = false; material.depthWrite = true; material.opacity = 1;
        material.color.copy(scattering); material.roughness = 1;
        material.emissive.set('#000000'); material.emissiveIntensity = 0;
        // The same radiance is used for deep jelly. Surface PBR normals here
        // would make submerged opaque silhouettes visible even at zero reveal.
        material.onBeforeCompile = shader => {
          shader.uniforms.nataScatteringColor = { value: scattering };
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 nataScatteringColor;')
            .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(nataScatteringColor, 1.0);');
        };
        material.customProgramCacheKey = () => `${PROFILE}:scattering:3`;
        liquidColorUpdates.set(material, color => { juice.set(color); scattering.copy(nataScatteringColor(juice)); material.color.copy(scattering); });
        return;
      }
      const localToLiquid = new THREE.Matrix4().multiplyMatrices(liquidInverse, mesh.matrixWorld);
      const inverseWorld = new THREE.Matrix4();
      const uniforms = {
        nataLocalToLiquid: { value: localToLiquid },
        nataCamera: { value: new THREE.Vector3() },
        nataViewDirection: { value: new THREE.Vector3(0, 0, 1) },
        nataOrthographic: { value: 0 },
        nataBounds: { value: new THREE.Vector3(radius, bounds.min.y, bounds.max.y) },
        nataCenter: { value: new THREE.Vector3(center.x, 0, center.z) },
        nataJuiceColor: { value: juice },
        nataScatteringColor: { value: scattering },
        nataJellyVisibility: { value: NATA_PET_OPTICS.jellyVisibility },
        nataJellyExtinction: { value: NATA_PET_OPTICS.jellyExtinction },
        nataJellyFadeRange: { value: new THREE.Vector2(NATA_PET_OPTICS.jellyFadeStart, NATA_PET_OPTICS.jellyFadeEnd) },
      };
      liquidColorUpdates.set(material, color => { juice.set(color); scattering.copy(nataScatteringColor(juice)); });
      material.onBeforeRender = (_renderer, _scene, camera, _geometry, renderedObject) => {
        // The visible pooled mesh is different from the preparation clone. Use
        // the object supplied by Three each draw so camera/pose/scale stay correct.
        inverseWorld.copy(renderedObject.matrixWorld).invert();
        camera.getWorldPosition(uniforms.nataCamera.value).applyMatrix4(inverseWorld).applyMatrix4(localToLiquid);
        camera.getWorldDirection(uniforms.nataViewDirection.value).negate().transformDirection(inverseWorld).transformDirection(localToLiquid);
        uniforms.nataOrthographic.value = camera instanceof THREE.OrthographicCamera ? 1 : 0;
      };
      material.roughness = role === 'liquid' ? NATA_PET_OPTICS.refractionRoughness : 0.68;
      material.opacity = 1;
      material.transparent = false; material.depthWrite = true;
      if (role === 'inclusions') material.color.set('#fffbe6');
      if (role === 'liquid' && material instanceof THREE.MeshPhysicalMaterial) {
        // Unlike transparent alpha, this samples the opaque jelly/back-liquid
        // pyramid, refracts it, blurs it, and attenuates it spectrally.
        material.transmission = 1; material.ior = 1.335;
        material.thickness = radius * 0.42;
        // Colored bulk scattering already lives in the captured volume. A
        // second color filter would dye ivory jelly and square the drink hue.
        material.attenuationColor.set('#ffffff');
        material.attenuationDistance = radius * 2.4;
        material.color.set('#ffffff');
        material.emissive.set('#000000'); material.emissiveIntensity = 0;
      }
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 nataLocalToLiquid;\nvarying vec3 vNataPosition;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNataPosition = (nataLocalToLiquid * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${opticalDeclarations}`);
        if (role === 'liquid') shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'gl_FragColor = vec4(totalDiffuse + totalSpecular * 0.25, 1.0);');
        if (role === 'inclusions') shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
            float nataDepth = nataExitDistance(vNataPosition, nataTowardCamera());
            // Deep fragments vanish from the opaque transmission capture so
            // the real back-liquid radiance/depth replaces them completely.
            if (nataDepth >= nataJellyFadeRange.y) discard;
            float nataVisibility = exp(-nataDepth * nataJellyExtinction)
              * (1.0 - smoothstep(nataJellyFadeRange.x, nataJellyFadeRange.y, nataDepth))
              * nataJellyVisibility;
            // Nearby soft ivory jelly remains visible; farther pieces lose
            // contrast in the opaque transmission capture. The front liquid
            // then blurs their real silhouette rather than dimming sharp cubes.
            vec3 nataScattering = nataScatteringColor;
            // Coconut gel stays ivory. Only the surrounding colored haze
            // blends over it; the front transmission never dyes it red/mango.
            vec3 nataPaleJelly = vec3(0.98, 0.97, 0.92);
            outgoingLight = mix(nataScattering, nataPaleJelly, nataVisibility);
            gl_FragColor = vec4(outgoingLight, 1.0);
          `);
      };
      material.customProgramCacheKey = () => `${PROFILE}:${role}:3`;
    },
  };
}
