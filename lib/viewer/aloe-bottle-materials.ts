import * as THREE from 'three';
import { liquidColorUpdates } from './material-adjustments';
import type { ProductAsset } from '../viewer-config';

export type AloeBottleRole = 'body' | 'ring' | 'liquid' | 'liquid-back' | 'inclusions' | 'cap' | 'label';
export const ALOE_PET_PROFILE = 'aloe-pet-v1';
interface AloeBackdropBinding {
  texture: { value: THREE.Texture | null };
  enabled: { value: number };
  texel: { value: THREE.Vector2 };
  mix: { value: number };
}
// Borrowed by the current appearance, never serialized or owned by its pool.
const backdropBindings = new WeakMap<THREE.Material, AloeBackdropBinding>();

export function setAloeBottleBackdrop(root: THREE.Object3D, texture: THREE.Texture | null, amount = 1): void {
  const image = texture?.image as { width?: number; height?: number } | undefined;
  const width = Math.max(1, image?.width ?? 1), height = Math.max(1, image?.height ?? 1);
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const binding = backdropBindings.get(material);
      if (!binding) continue;
      binding.texture.value = texture;
      binding.enabled.value = texture ? 1 : 0;
      binding.mix.value = THREE.MathUtils.clamp(amount, 0, 1);
      binding.texel.value.set(1 / width, 1 / height);
    }
  });
}
const PROFILE_LEVELS = 16;
const FLOOR_LEVELS = 16;
const FLOOR_DEPTH = 0.025;
const SQRT_HALF = Math.SQRT1_2;

/** Distances are metres, including when the glTF retains Blender object scales. */
export const ALOE_PET_OPTICS = Object.freeze({
  defaultLiquidColor: '#e84a3c',
  brightness: 1.15,
  saturationBoost: 0.12,
  refractionRoughness: 0.1,
  pulpVisibility: 0.7,
  pulpExtinction: 60,
  pulpFadeStart: 0.012,
  pulpFadeEnd: 0.036,
  shellRoughness: 0.075,
  gelExtinctionPerMetre: 65,
  gelCloudExtinctionPerMetre: 70,
  gelThicknessMetres: 0.0035,
  pulpMaximumContrast: 0.19,
  scatteringExtinctionPerMetre: 34,
  bulkAbsorption: 0.3,
  mediumAbsorption: 0.55,
  externalRayInsetMetres: 0.0005,
  externalRayMaximumChord: 1.6,
  externalBackdropNeutralFill: true,
  externalBackdropThinFill: 0.2,
  externalBackdropBodyFill: 0.75,
});

export function isAloeBottleMaterial(asset: ProductAsset, mesh: THREE.Mesh, material: THREE.Material): boolean {
  return asset.packaging === 'pet'
    && (material.userData.bottleProfile === ALOE_PET_PROFILE || mesh.userData.bottleProfile === ALOE_PET_PROFILE);
}

export function aloeScatteringColor(juice: THREE.Color): THREE.Color {
  const hsl = juice.getHSL({ h: 0, s: 0, l: 0 });
  const saturation = hsl.s < 0.01 ? hsl.s : hsl.s + (1 - hsl.s) * ALOE_PET_OPTICS.saturationBoost;
  return new THREE.Color().setHSL(hsl.h, saturation, hsl.l).multiplyScalar(ALOE_PET_OPTICS.brightness);
}

/** Contrast of lightly cloudy gel falls with the liquid path in front of it. */
export function aloePulpReveal(depthMetres: number): number {
  const depth = Math.max(0, Number.isFinite(depthMetres) ? depthMetres : Infinity);
  const x = THREE.MathUtils.clamp((depth - ALOE_PET_OPTICS.pulpFadeStart)
    / (ALOE_PET_OPTICS.pulpFadeEnd - ALOE_PET_OPTICS.pulpFadeStart), 0, 1);
  return Math.exp(-depth * ALOE_PET_OPTICS.pulpExtinction)
    * (1 - x * x * (3 - 2 * x)) * ALOE_PET_OPTICS.pulpVisibility;
}

/** Clear aloe carries the surrounding water hue; extinction is through the
 * piece, separately from turbidity over the front water path. No ivory pigment. */
export function aloeGelColor(juice: THREE.Color, depthMetres: number, cloud = 0.5, viewCosine = 1): THREE.Color {
  const piecePath = ALOE_PET_OPTICS.gelThicknessMetres / Math.max(Math.abs(viewCosine), 0.35);
  const opticalDensity = ALOE_PET_OPTICS.gelExtinctionPerMetre
    + ALOE_PET_OPTICS.gelCloudExtinctionPerMetre * THREE.MathUtils.clamp(cloud, 0, 1);
  const transmittance = Math.exp(-piecePath * opticalDensity);
  return aloeScatteringColor(juice).multiplyScalar(1 - Math.min(ALOE_PET_OPTICS.pulpMaximumContrast,
    (1 - transmittance) * aloePulpReveal(depthMetres)));
}

/** The internal capture contains water and clear gel. Dark gel contrast must
 * reduce the water's brightness uniformly, rather than receive a second RGB
 * absorption tint. Bound cumulative extinction where several pieces overlap. */
export function aloeFilterCapturedWater(volume: THREE.Color, captured: THREE.Color, transmission: THREE.Color): THREE.Color {
  // Color.sub clamps negative values; this signed deviation matches GLSL.
  const delta = new THREE.Color().setRGB(captured.r - volume.r, captured.g - volume.g, captured.b - volume.b);
  const luminance = (color: THREE.Color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const darkening = luminance(delta);
  if (darkening < 0) {
    const retainedBrightness = THREE.MathUtils.clamp(1 + darkening / Math.max(luminance(volume), 0.0001),
      1 - ALOE_PET_OPTICS.pulpMaximumContrast, 1);
    return volume.clone().multiplyScalar(retainedBrightness);
  }
  return volume.clone().add(delta.multiply(transmission));
}

/** Body remains turbid; a shorter neck chord retains more true transmission. */
export function aloeReservoirCoverage(pathMetres: number, normalizedHeight = 0): number {
  const neckRetention = 1 - 0.18 * THREE.MathUtils.smoothstep(normalizedHeight, 0.62, 0.94);
  const topRetention = 1 - 0.3 * THREE.MathUtils.smoothstep(normalizedHeight, 0.93, 1);
  return 1 - Math.exp(-Math.max(0, pathMetres) * ALOE_PET_OPTICS.scatteringExtinctionPerMetre * neckRetention * topRetention);
}

/** Three uses a white/alpha .5 sentinel in its transmission target. Recover
 * actual captured objects without turning uncovered CSS/PNG areas white. */
export function aloeClearCapture(color: THREE.Color, alpha: number, clearRadiance = 1): { color: THREE.Color; opacity: number } {
  const opacity = THREE.MathUtils.clamp(alpha * 2 - 1, 0, 1);
  return { opacity, color: new THREE.Color().setRGB(
    Math.max(0, color.r - clearRadiance * (1 - opacity)) / Math.max(opacity, 0.0001),
    Math.max(0, color.g - clearRadiance * (1 - opacity)) / Math.max(opacity, 0.0001),
    Math.max(0, color.b - clearRadiance * (1 - opacity)) / Math.max(opacity, 0.0001)) };
}

/** r180 premultiplies its white/.5 transmission clear according to the WebGL
 * context, even for offscreen targets. Hero clears RGB to .5; Studio to 1. */
export function aloeTransmissionClearRadiance(renderer: THREE.WebGLRenderer): number {
  return renderer.getContextAttributes?.().premultipliedAlpha === true ? 0.5 : 1;
}

/** Shared with the Aloe PET ring; leaves opaque capture pixels untouched. */
export function correctAloeTransmissionClear(source: string, includeBackdrop = false): string {
  const corrected = source.replace('transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );', /* glsl */`
    transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
    float aloeCapturedCoverage = clamp(transmittedLight.a * 2.0 - 1.0, 0.0, 1.0);
    transmittedLight.rgb = max(vec3(0.0), transmittedLight.rgb - vec3(aloeClearRadiance * (1.0 - aloeCapturedCoverage))) / max(aloeCapturedCoverage, 0.0001);
    transmittedLight.a = aloeCapturedCoverage;
  `);
  if (!includeBackdrop) return corrected;
  return corrected.replace('transmittedLight.a = aloeCapturedCoverage;', /* glsl */`
    transmittedLight.a = aloeCapturedCoverage;
    if (aloeBackdropEnabled > 0.5) {
      // Restore the previous external Snell ray through the full first-exit
      // chord. Internal water/pulp still use their calibrated thin capture ray.
      vec3 externalViewWorld = normalize(mix(v,
        (aloeMetricToWorld * vec4(aloeViewDirection, 0.0)).xyz, aloeOrthographic));
      vec3 externalRayWorld = normalize(refract(-externalViewWorld, normalize(n), 1.0 / ior));
      vec3 externalRayMetric = normalize((aloeWorldToMetric * vec4(externalRayWorld, 0.0)).xyz);
      vec3 externalFrontMetric = (aloeWorldToMetric * vec4(position, 1.0)).xyz;
      float externalInset = ${ALOE_PET_OPTICS.externalRayInsetMetres.toFixed(6)};
      float externalPath = clamp(aloeExitDistance(externalFrontMetric + externalRayMetric * externalInset, externalRayMetric)
        + externalInset, externalInset, aloeReferencePath * ${ALOE_PET_OPTICS.externalRayMaximumChord.toFixed(6)});
      vec3 externalExitWorld = (aloeMetricToWorld * vec4(externalFrontMetric + externalRayMetric * externalPath, 1.0)).xyz;
      vec4 externalNdc = projMatrix * viewMatrix * vec4(externalExitWorld, 1.0);
      vec2 externalCoords = externalNdc.xy / externalNdc.w * 0.5 + 0.5;
      vec2 backdropStep = aloeBackdropTexel * 1.25;
      vec3 externalColor = texture2D(aloeBackdropTexture, clamp(externalCoords, vec2(0.0), vec2(1.0))).rgb * 0.5;
      externalColor += texture2D(aloeBackdropTexture, clamp(externalCoords + vec2(backdropStep.x, 0.0), vec2(0.0), vec2(1.0))).rgb * 0.125;
      externalColor += texture2D(aloeBackdropTexture, clamp(externalCoords - vec2(backdropStep.x, 0.0), vec2(0.0), vec2(1.0))).rgb * 0.125;
      externalColor += texture2D(aloeBackdropTexture, clamp(externalCoords + vec2(0.0, backdropStep.y), vec2(0.0), vec2(1.0))).rgb * 0.125;
      externalColor += texture2D(aloeBackdropTexture, clamp(externalCoords - vec2(0.0, backdropStep.y), vec2(0.0), vec2(1.0))).rgb * 0.125;
      if (${ALOE_PET_OPTICS.externalBackdropNeutralFill ? 'true' : 'false'}) {
        float backdropFill = mix(${ALOE_PET_OPTICS.externalBackdropThinFill.toFixed(6)}, ${ALOE_PET_OPTICS.externalBackdropBodyFill.toFixed(6)},
          smoothstep(0.35, 0.9, externalPath / aloeReferencePath));
        externalColor = mix(externalColor, vec3(1.0), backdropFill);
      }
      aloeExternalBackdrop = externalColor;
      aloeExternalReady = 1.0;
    }
  `);
}

/** Small Beer correction around the reference bulk colour, rather than a second dye. */
export function aloeBulkTransmission(juice: THREE.Color, pathMetres: number, referencePathMetres: number): THREE.Color {
  const exponent = ALOE_PET_OPTICS.bulkAbsorption * (pathMetres / Math.max(referencePathMetres, 0.0001) - 1);
  return new THREE.Color().setRGB(
    Math.pow(THREE.MathUtils.clamp(juice.r, 0.025, 1), exponent),
    Math.pow(THREE.MathUtils.clamp(juice.g, 0.025, 1), exponent),
    Math.pow(THREE.MathUtils.clamp(juice.b, 0.025, 1), exponent));
}

export interface AloeLiquidProfile {
  minimumY: number;
  maximumY: number;
  center: THREE.Vector2;
  /** Support of x, z, (x+z)/sqrt(2), (x-z)/sqrt(2) at each height. */
  sections: THREE.Vector4[];
  halfBounds: THREE.Vector2;
  /** Lower inward PET push-up surface, sampled in x/z. No render target is needed. */
  floor: Float32Array;
  floorLevels: number;
}
const profileCache = new WeakMap<THREE.BufferGeometry, Map<string, AloeLiquidProfile>>();
const gelDetailCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferAttribute>>();

/** Stable cloud/fibre density is an authored-space property, independent of
 * camera, flavour and exposure. Bake the previous value noise once at the dense
 * pulp vertices instead of evaluating its 24 hashes at every covered pixel. */
export function aloeGelDetailAt(point: THREE.Vector3): THREE.Vector2 {
  const fract = (value: number) => value - Math.floor(value);
  const hash = (x: number, y: number, z: number) => {
    x = fract(x * 0.1031); y = fract(y * 0.1031); z = fract(z * 0.1031);
    const dot = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
    x += dot; y += dot; z += dot;
    return fract((x + y) * z);
  };
  const noise = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let u = fract(x), v = fract(y), w = fract(z);
    u *= u * (3 - 2 * u); v *= v * (3 - 2 * v); w *= w * (3 - 2 * w);
    const mix = THREE.MathUtils.lerp;
    return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w);
  };
  return new THREE.Vector2(noise(point.x * 420, point.y * 420, point.z * 420) * 0.72
    + noise(point.x * 1030, point.y * 1030, point.z * 1030) * 0.28,
  noise(point.x * 1900, point.y * 260, point.z * 1900));
}

function prepareAloeGelDetail(geometry: THREE.BufferGeometry, localToMetric: THREE.Matrix4, profile: AloeLiquidProfile): void {
  const metricKey = [...localToMetric.toArray(), profile.minimumY, profile.maximumY,
    ...profile.sections.flatMap(section => section.toArray()), ...profile.floor].map(value => Number(value.toFixed(10))).join(',');
  let cached = gelDetailCache.get(geometry);
  let attribute = cached?.get(metricKey);
  if (!attribute) {
    const position = geometry.getAttribute('position');
    const detail = new Float32Array(position.count * 3), point = new THREE.Vector3();
    const metricY = new Float64Array(position.count), inside = new Uint8Array(position.count);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(localToMetric);
      const value = aloeGelDetailAt(point);
      detail[i * 3] = value.x; detail[i * 3 + 1] = value.y;
      metricY[i] = point.y; inside[i] = aloePointInside(profile, point) ? 1 : 0;
    }
    const index = geometry.index, count = index?.count ?? position.count;
    for (let triangle = 0; triangle < count; triangle += 3) {
      const a = index ? index.getX(triangle) : triangle;
      const b = index ? index.getX(triangle + 1) : triangle + 1;
      const c = index ? index.getX(triangle + 2) : triangle + 2;
      const boundary = inside[a] !== inside[b] || inside[a] !== inside[c];
      if (boundary || Math.min(metricY[a], metricY[b], metricY[c]) < profile.minimumY + FLOOR_DEPTH) {
        // The concave floor can change the first ray exit discontinuously even
        // on a tiny triangle. Preserve exact depth only there, including shared
        // edge vertices, rather than interpolate across its air-pocket boundary.
        detail[a * 3 + 2] = detail[b * 3 + 2] = detail[c * 3 + 2] = 1;
      }
    }
    attribute = new THREE.BufferAttribute(detail, 3);
    if (!cached) { cached = new Map(); gelDetailCache.set(geometry, cached); }
    cached.set(metricKey, attribute);
  }
  // Pool clones share this immutable vertex stream; colour/camera changes never
  // regenerate it, and disposing the geometry retains its normal ownership.
  geometry.setAttribute('aloeGelDetail', attribute);
}

/** Intersect the authored triangles at exact heights, rather than assuming a cylinder.
 * Four symmetric supports retain the square body, rounded corners and tapered shoulder.
 * Geometry coordinates are converted into the model's metre space first. */
export function fitAloeLiquidProfile(geometry: THREE.BufferGeometry, localToMetric: THREE.Matrix4): AloeLiquidProfile | undefined {
  const position = geometry.getAttribute('position');
  if (!position?.count) return;
  const vertices = new Float64Array(position.count * 3);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(localToMetric);
    vertices.set([point.x, point.y, point.z], i * 3);
    box.expandByPoint(point);
  }
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 0) return;
  const center = new THREE.Vector2((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
  const sections = Array.from({ length: PROFILE_LEVELS }, () => new THREE.Vector4(0, 0, 0, 0));
  const floor = new Float32Array(FLOOR_LEVELS * FLOOR_LEVELS).fill(Infinity);
  const floorStepX = (box.max.x - box.min.x) / (FLOOR_LEVELS - 1);
  const floorStepZ = (box.max.z - box.min.z) / (FLOOR_LEVELS - 1);
  const step = height / (PROFILE_LEVELS - 1);
  const record = (section: THREE.Vector4, x: number, z: number) => {
    x -= center.x; z -= center.y;
    section.x = Math.max(section.x, Math.abs(x));
    section.y = Math.max(section.y, Math.abs(z));
    section.z = Math.max(section.z, Math.abs((x + z) * SQRT_HALF));
    section.w = Math.max(section.w, Math.abs((x - z) * SQRT_HALF));
  };
  const index = geometry.index;
  const count = index?.count ?? position.count;
  for (let triangle = 0; triangle < count; triangle += 3) {
    const ids = [0, 1, 2].map(corner => (index ? index.getX(triangle + corner) : triangle + corner) * 3);
    const minY = Math.min(...ids.map(id => vertices[id + 1]));
    const maxY = Math.max(...ids.map(id => vertices[id + 1]));
    if (minY < box.min.y + FLOOR_DEPTH) {
      const [a, b, c] = ids;
      const ax = vertices[a], az = vertices[a + 2], bx = vertices[b], bz = vertices[b + 2], cx = vertices[c], cz = vertices[c + 2];
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) > 1e-16) {
        const firstX = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - box.min.x) / floorStepX - 1e-7));
        const lastX = Math.min(FLOOR_LEVELS - 1, Math.floor((Math.max(ax, bx, cx) - box.min.x) / floorStepX + 1e-7));
        const firstZ = Math.max(0, Math.ceil((Math.min(az, bz, cz) - box.min.z) / floorStepZ - 1e-7));
        const lastZ = Math.min(FLOOR_LEVELS - 1, Math.floor((Math.max(az, bz, cz) - box.min.z) / floorStepZ + 1e-7));
        for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
          const px = box.min.x + x * floorStepX, pz = box.min.z + z * floorStepZ;
          const u = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator;
          const v = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator;
          const w = 1 - u - v;
          if (Math.min(u, v, w) >= -1e-7) {
            const y = u * vertices[a + 1] + v * vertices[b + 1] + w * vertices[c + 1];
            if (y <= box.min.y + FLOOR_DEPTH) floor[z * FLOOR_LEVELS + x] = Math.min(floor[z * FLOOR_LEVELS + x], y);
          }
        }
      }
    }
    const first = Math.max(0, Math.ceil((minY - box.min.y) / step - 1e-7));
    const last = Math.min(PROFILE_LEVELS - 1, Math.floor((maxY - box.min.y) / step + 1e-7));
    for (let level = first; level <= last; level++) {
      const y = box.min.y + level * step;
      for (let edge = 0; edge < 3; edge++) {
        const a = ids[edge], b = ids[(edge + 1) % 3];
        const ay = vertices[a + 1], by = vertices[b + 1];
        if (Math.abs(ay - by) < 1e-12) {
          if (Math.abs(y - ay) < 1e-9) {
            record(sections[level], vertices[a], vertices[a + 2]);
            record(sections[level], vertices[b], vertices[b + 2]);
          }
        } else {
          const t = (y - ay) / (by - ay);
          if (t >= -1e-7 && t <= 1 + 1e-7) record(sections[level],
            THREE.MathUtils.lerp(vertices[a], vertices[b], t),
            THREE.MathUtils.lerp(vertices[a + 2], vertices[b + 2], t));
        }
      }
    }
  }
  // A missing end slice in an open mesh uses the closest available contour.
  for (let level = 0; level < PROFILE_LEVELS; level++) {
    if (!sections[level].lengthSq()) {
      const nearest = sections.map((section, i) => ({ section, distance: Math.abs(i - level) }))
        .filter(entry => entry.section.lengthSq()).sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) return;
      sections[level].copy(nearest.section);
    }
    for (const key of ['x', 'y', 'z', 'w'] as const) sections[level][key] = Math.max(sections[level][key], 0.0001);
  }
  for (let i = 0; i < floor.length; i++) if (!Number.isFinite(floor[i])) floor[i] = box.min.y;
  return { minimumY: box.min.y, maximumY: box.max.y, center, sections, floor, floorLevels: FLOOR_LEVELS,
    halfBounds: new THREE.Vector2((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2) };
}

export function aloeFloorHeight(profile: AloeLiquidProfile, x: number, z: number): number {
  const gridX = THREE.MathUtils.clamp((x - profile.center.x + profile.halfBounds.x) / (profile.halfBounds.x * 2), 0, 1) * (profile.floorLevels - 1);
  const gridZ = THREE.MathUtils.clamp((z - profile.center.y + profile.halfBounds.y) / (profile.halfBounds.y * 2), 0, 1) * (profile.floorLevels - 1);
  const i = Math.min(Math.floor(gridX), profile.floorLevels - 2), j = Math.min(Math.floor(gridZ), profile.floorLevels - 2);
  const u = gridX - i, v = gridZ - j;
  const height = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(profile.floor[j * profile.floorLevels + i], profile.floor[j * profile.floorLevels + i + 1], u),
    THREE.MathUtils.lerp(profile.floor[(j + 1) * profile.floorLevels + i], profile.floor[(j + 1) * profile.floorLevels + i + 1], u), v);
  // Bilinear sampling slightly flattens the molded inward peak. A bounded
  // quarter-millimetre allowance prevents grazing rays missing that air pocket.
  return height + 0.00025 * THREE.MathUtils.smoothstep(height - profile.minimumY, 0.002, 0.01);
}

/** Reference calculation for depth calibration and square/shoulder regression checks. */
export function aloePointInside(profile: AloeLiquidProfile, point: THREE.Vector3): boolean {
  if (point.y < profile.minimumY || point.y > profile.maximumY) return false;
  if (point.y < profile.minimumY + FLOOR_DEPTH && point.y + 0.00001 < aloeFloorHeight(profile, point.x, point.z)) return false;
  const u = THREE.MathUtils.clamp((point.y - profile.minimumY) / (profile.maximumY - profile.minimumY)
    * (profile.sections.length - 1), 0, profile.sections.length - 1);
  const i = Math.min(Math.floor(u), profile.sections.length - 2);
  const support = profile.sections[i].clone().lerp(profile.sections[i + 1], u - i);
  const x = point.x - profile.center.x, z = point.z - profile.center.y;
  return Math.abs(x) <= support.x && Math.abs(z) <= support.y
    && Math.abs((x + z) * SQRT_HALF) <= support.z && Math.abs((x - z) * SQRT_HALF) <= support.w;
}

export function aloeExitDistance(profile: AloeLiquidProfile, point: THREE.Vector3, direction: THREE.Vector3): number {
  const ray = direction.clone().normalize();
  const inside = (p: THREE.Vector3) => aloePointInside(profile, p);
  if (!ray.lengthSq() || !inside(point)) return 0;
  let high = Infinity;
  const lower = [profile.center.x - profile.halfBounds.x, profile.minimumY, profile.center.y - profile.halfBounds.y];
  const upper = [profile.center.x + profile.halfBounds.x, profile.maximumY, profile.center.y + profile.halfBounds.y];
  for (let axis = 0; axis < 3; axis++) {
    const d = ray.getComponent(axis);
    if (Math.abs(d) > 1e-9) high = Math.min(high, ((d > 0 ? upper[axis] : lower[axis]) - point.getComponent(axis)) / d);
  }
  let low = 0;
  const limit = high;
  const scanSteps = point.y < profile.minimumY + FLOOR_DEPTH ? 64 : 16;
  for (let step = 1; step <= scanSteps; step++) {
    const distance = limit * step / scanSteps;
    if (!inside(point.clone().addScaledVector(ray, distance))) { high = distance; break; }
    low = distance;
  }
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) * 0.5;
    if (inside(point.clone().addScaledVector(ray, middle))) low = middle;
    else high = middle;
  }
  return Math.max(0, high);
}

const declarations = /* glsl */`
uniform mat4 aloeLocalToMetric;
uniform vec3 aloeCamera;
uniform vec3 aloeViewDirection;
uniform float aloeOrthographic;
uniform vec2 aloeHeightRange;
uniform vec2 aloeCenter;
uniform vec2 aloeHalfBounds;
uniform vec4 aloeSections[${PROFILE_LEVELS}];
uniform vec4 aloeFloor[${FLOOR_LEVELS * FLOOR_LEVELS / 4}];
uniform vec3 aloeScatteringColor;
uniform vec3 aloeJuiceColor;
uniform float aloeClearRadiance;
uniform float aloeReferencePath;
uniform float aloeWorldThickness;
uniform float aloeWhiteDisplayFill;
uniform float aloePulpVisibility;
uniform float aloePulpExtinction;
uniform vec2 aloePulpFadeRange;
varying vec3 vAloePosition;

vec4 aloeSupportAt(float y) {
  float height = clamp((y - aloeHeightRange.x) / (aloeHeightRange.y - aloeHeightRange.x), 0.0, 1.0) * ${PROFILE_LEVELS - 1}.0;
  int section = min(int(floor(height)), ${PROFILE_LEVELS - 2});
  return mix(aloeSections[section], aloeSections[section + 1], height - float(section));
}
float aloePlaneExit(float position, float direction, float extent) {
  if (abs(direction) < 0.000001) return 10000.0;
  return max(0.0, (extent - sign(direction) * position) / abs(direction));
}
// An octagonal chord is a cheap bulk-colour path at the visible liquid surface.
// Full sampled-floor depth is reserved for the gel where exact near/far matters.
float aloeBulkPath(vec3 point, vec3 direction) {
  vec2 p = point.xz - aloeCenter;
  vec4 extent = aloeSupportAt(point.y);
  float path = min(aloePlaneExit(p.x, direction.x, extent.x), aloePlaneExit(p.y, direction.z, extent.y));
  path = min(path, aloePlaneExit((p.x + p.y) * 0.70710678118, (direction.x + direction.z) * 0.70710678118, extent.z));
  path = min(path, aloePlaneExit((p.x - p.y) * 0.70710678118, (direction.x - direction.z) * 0.70710678118, extent.w));
  if (abs(direction.y) > 0.000001) path = min(path,
    max(0.0, ((direction.y > 0.0 ? aloeHeightRange.y : aloeHeightRange.x) - point.y) / direction.y));
  return max(0.0, path);
}
vec3 aloeVolumeColor(float path) {
  float relativePath = clamp(path / aloeReferencePath, 0.12, 1.8);
  vec3 absorption = -log(clamp(aloeJuiceColor, vec3(0.025), vec3(1.0))) * ${ALOE_PET_OPTICS.bulkAbsorption.toFixed(6)};
  return aloeScatteringColor * exp(absorption * (1.0 - relativePath));
}
float aloeReservoirCoverage(float path, float height) {
  float neckRetention = 1.0 - 0.18 * smoothstep(0.62, 0.94, height);
  float topRetention = 1.0 - 0.3 * smoothstep(0.93, 1.0, height);
  return 1.0 - exp(-max(0.0, path) * ${ALOE_PET_OPTICS.scatteringExtinctionPerMetre.toFixed(6)} * neckRetention * topRetention);
}
`;

// The same fitted-volume solver now runs per vertex, retaining its concave base
// first-exit rule. Perspective-correct interpolation on the dense pulp mesh
// replaces repeated depth marching at every overlapping fragment.
const vertexDepthDeclarations = /* glsl */`
float aloeFloorValue(int index) {
  int row = index / 4;
  int column = index - row * 4;
  vec4 values = aloeFloor[row];
  // Explicit components avoid emulated dynamic vector indexing on mobile GPUs.
  return column == 0 ? values.x : column == 1 ? values.y : column == 2 ? values.z : values.w;
}
float aloeFloorHeight(vec2 point) {
  vec2 grid = clamp((point - aloeCenter + aloeHalfBounds) / (2.0 * aloeHalfBounds), vec2(0.0), vec2(1.0)) * ${FLOOR_LEVELS - 1}.0;
  ivec2 cell = min(ivec2(floor(grid)), ivec2(${FLOOR_LEVELS - 2}));
  vec2 f = grid - vec2(cell);
  int index = cell.y * ${FLOOR_LEVELS} + cell.x;
  float height = mix(mix(aloeFloorValue(index), aloeFloorValue(index + 1), f.x),
                     mix(aloeFloorValue(index + ${FLOOR_LEVELS}), aloeFloorValue(index + ${FLOOR_LEVELS + 1}), f.x), f.y);
  return height + 0.00025 * smoothstep(0.002, 0.01, height - aloeHeightRange.x);
}
bool aloeInside(vec3 p) {
  if (p.y < aloeHeightRange.x || p.y > aloeHeightRange.y) return false;
  if (p.y < aloeHeightRange.x + ${FLOOR_DEPTH} && p.y + 0.00001 < aloeFloorHeight(p.xz)) return false;
  vec2 q = p.xz - aloeCenter;
  vec4 extent = aloeSupportAt(p.y);
  return abs(q.x) <= extent.x && abs(q.y) <= extent.y
    && abs((q.x + q.y) * 0.70710678118) <= extent.z
    && abs((q.x - q.y) * 0.70710678118) <= extent.w;
}
float aloeExitDistance(vec3 point, vec3 direction) {
  if (!aloeInside(point)) return 0.0;
  vec3 lower = vec3(aloeCenter.x - aloeHalfBounds.x, aloeHeightRange.x, aloeCenter.y - aloeHalfBounds.y);
  vec3 upper = vec3(aloeCenter.x + aloeHalfBounds.x, aloeHeightRange.y, aloeCenter.y + aloeHalfBounds.y);
  float high = 10000.0;
  if (abs(direction.x) > 0.000001) high = min(high, ((direction.x > 0.0 ? upper.x : lower.x) - point.x) / direction.x);
  if (abs(direction.y) > 0.000001) high = min(high, ((direction.y > 0.0 ? upper.y : lower.y) - point.y) / direction.y);
  if (abs(direction.z) > 0.000001) high = min(high, ((direction.z > 0.0 ? upper.z : lower.z) - point.z) / direction.z);
  float low = 0.0;
  float limit = high;
  int scanSteps = point.y < aloeHeightRange.x + ${FLOOR_DEPTH} ? 64 : 16;
  // The molded base is concave: stop at the first liquid exit rather than
  // accidentally jumping across its air pocket to the opposite bottle wall.
  for (int step = 1; step <= 64; step++) {
    if (step > scanSteps) break;
    float distance = limit * float(step) / float(scanSteps);
    if (!aloeInside(point + direction * distance)) { high = distance; break; }
    low = distance;
  }
  for (int i = 0; i < 12; i++) {
    float middle = (low + high) * 0.5;
    if (aloeInside(point + direction * middle)) low = middle;
    else high = middle;
  }
  return max(0.0, high);
}
`;

// Liquid only: preserve the approved pulp shader and its vertex/detail work.
const externalBackdropDeclarations = /* glsl */`
uniform mat4 aloeWorldToMetric;
uniform mat4 aloeMetricToWorld;
uniform sampler2D aloeBackdropTexture;
uniform float aloeBackdropEnabled;
uniform vec2 aloeBackdropTexel;
uniform float aloeBackdropMix;
vec3 aloeExternalBackdrop = vec3(0.0);
float aloeExternalReady = 0.0;
`;

/** A path-dependent scattering reservoir is refracted once by the liquid front.
 * Gel contributes subtle cloud structure to this capture, with contrast determined
 * by the real square/tapered liquid depth. It has no second refraction surface. */
export function createAloeBottleMaterialContext(root: THREE.Object3D, asset: ProductAsset) {
  let liquid: THREE.Mesh | undefined;
  let originalLiquid: THREE.MeshStandardMaterial | undefined;
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || liquid || node.userData.aloeLiquidBack || node.userData.bottleLiquidBack) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial && isAloeBottleMaterial(asset, node, material)
        && (asset.materialSlots?.liquid?.includes(material.name) || asset.materialSlots?.liquid?.includes(node.name))) {
        liquid = node; originalLiquid = material; break;
      }
    }
  });
  if (!liquid || !originalLiquid) return;
  root.updateMatrixWorld(true);
  const modelInverse = root.matrixWorld.clone().invert();
  const liquidToMetric = new THREE.Matrix4().multiplyMatrices(modelInverse, liquid.matrixWorld);
  // Pool clones share immutable imported geometry. Fit it once per authored
  // metric transform rather than scanning 95,000 triangles on every flavour.
  const metricKey = liquidToMetric.toArray().map(value => Number(value.toFixed(10))).join(',');
  let cachedProfiles = profileCache.get(liquid.geometry);
  const profile = cachedProfiles?.get(metricKey) ?? fitAloeLiquidProfile(liquid.geometry, liquidToMetric);
  if (!profile) return;
  if (!cachedProfiles) { cachedProfiles = new Map(); profileCache.set(liquid.geometry, cachedProfiles); }
  cachedProfiles.set(metricKey, profile);
  const originalHsl = originalLiquid.color.getHSL({ h: 0, s: 0, l: 0 });
  const defaultColor = originalHsl.s < 0.01
    ? new THREE.Color(ALOE_PET_OPTICS.defaultLiquidColor) : originalLiquid.color.clone();
  return {
    defaultColor,
    configure(material: THREE.MeshStandardMaterial, mesh: THREE.Mesh, role: AloeBottleRole, juiceColor?: string) {
      material.metalness = 0; material.side = THREE.FrontSide;
      if (material instanceof THREE.MeshPhysicalMaterial) { material.transmission = 0; material.clearcoat = 0; }
      if (role === 'body') {
        material.color.set('#ffffff');
        material.roughness = ALOE_PET_OPTICS.shellRoughness;
        // Use the same clean, glossy PET finish on both authored regions. The
        // source texture stays owned by the asset pool; this runtime material
        // simply stops sampling its coarse frost normal.
        material.normalMap = null;
        if (material instanceof THREE.MeshPhysicalMaterial) material.ior = 1.47;
        material.opacity = 1; material.transparent = true; material.depthWrite = false;
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
              float petFresnel = pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
              float petHighlight = clamp(max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b), 0.0, 1.0);
              float petAlpha = clamp(0.025 + petFresnel * 0.25 + petHighlight * 0.6, 0.025, 0.62);
              gl_FragColor = vec4((totalSpecular + totalDiffuse * 0.006) / petAlpha, petAlpha);
            `);
        };
        material.customProgramCacheKey = () => `${ALOE_PET_PROFILE}:shell:glossy:2`;
        return;
      }
      const juice = juiceColor ? new THREE.Color(juiceColor) : defaultColor.clone();
      const scattering = aloeScatteringColor(juice);
      material.emissive.set('#000000'); material.emissiveIntensity = 0;
      material.opacity = 1; material.transparent = false; material.depthWrite = true;
      if (role === 'liquid-back') {
        material.side = THREE.BackSide; material.color.copy(scattering); material.roughness = 1;
        // Custom blending remains in Three's opaque transmission capture but
        // lays continuous scattering over the real scene; no stochastic holes.
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.SrcAlphaFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor;
        material.blendEquationAlpha = THREE.AddEquation;
        material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        material.depthWrite = false;
      }
      const localToMetric = new THREE.Matrix4().multiplyMatrices(modelInverse, mesh.matrixWorld);
      const inverseWorld = new THREE.Matrix4();
      const metricToLocal = localToMetric.clone().invert();
      const metricToWorld = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, metricToLocal);
      const worldToMetric = role === 'liquid' ? metricToWorld.clone().invert() : undefined;
      const backdrop: AloeBackdropBinding | undefined = role === 'liquid' ? {
        texture: { value: null }, enabled: { value: 0 }, texel: { value: new THREE.Vector2(1, 1) }, mix: { value: 1 },
      } : undefined;
      if (backdrop) backdropBindings.set(material, backdrop);
      const physicalThickness = Math.min(profile.halfBounds.x, profile.halfBounds.y) * 0.44;
      const uniforms = {
        aloeLocalToMetric: { value: localToMetric },
        aloeCamera: { value: new THREE.Vector3() },
        aloeViewDirection: { value: new THREE.Vector3(0, 0, 1) },
        aloeOrthographic: { value: 0 },
        aloeHeightRange: { value: new THREE.Vector2(profile.minimumY, profile.maximumY) },
        aloeCenter: { value: profile.center },
        aloeHalfBounds: { value: profile.halfBounds },
        aloeSections: { value: profile.sections },
        aloeFloor: { value: Array.from({ length: profile.floor.length / 4 }, (_, i) => new THREE.Vector4().fromArray(profile.floor, i * 4)) },
        aloeScatteringColor: { value: scattering },
        aloeJuiceColor: { value: juice },
        aloeClearRadiance: { value: 1 },
        aloeReferencePath: { value: 2 * Math.min(profile.halfBounds.x, profile.halfBounds.y) },
        aloeWorldThickness: { value: physicalThickness },
        aloeWhiteDisplayFill: { value: 0 },
        aloePulpVisibility: { value: ALOE_PET_OPTICS.pulpVisibility },
        aloePulpExtinction: { value: ALOE_PET_OPTICS.pulpExtinction },
        aloePulpFadeRange: { value: new THREE.Vector2(ALOE_PET_OPTICS.pulpFadeStart, ALOE_PET_OPTICS.pulpFadeEnd) },
      };
      if (backdrop) Object.assign(uniforms, {
        aloeWorldToMetric: { value: worldToMetric }, aloeMetricToWorld: { value: metricToWorld },
        aloeBackdropTexture: backdrop.texture, aloeBackdropEnabled: backdrop.enabled, aloeBackdropTexel: backdrop.texel, aloeBackdropMix: backdrop.mix,
      });
      liquidColorUpdates.set(material, color => {
        juice.set(color); scattering.copy(aloeScatteringColor(juice));
        if (role === 'liquid-back' || role === 'inclusions') material.color.copy(scattering);
      });
      material.onBeforeRender = (renderer, _scene, camera, _geometry, renderedObject) => {
        uniforms.aloeClearRadiance.value = aloeTransmissionClearRadiance(renderer);
        // Default-framebuffer previews use the approved white Studio beauty.
        // Linear/offscreen capture keeps native RGBA for the PNG output stage.
        uniforms.aloeWhiteDisplayFill.value = renderer.getRenderTarget?.() === null ? 1 : 0;
        // The pool draws a different clone. Recover its camera in the initial
        // metric model space, retaining the original Blender hierarchy scales.
        inverseWorld.copy(renderedObject.matrixWorld).invert();
        camera.getWorldPosition(uniforms.aloeCamera.value).applyMatrix4(inverseWorld).applyMatrix4(localToMetric);
        camera.getWorldDirection(uniforms.aloeViewDirection.value).negate().transformDirection(inverseWorld).transformDirection(localToMetric);
        uniforms.aloeOrthographic.value = camera instanceof THREE.OrthographicCamera ? 1 : 0;
        // Blender's retained scale is .029/.105/.029. Three's default volume
        // ray multiplies its world-direction components by those three values,
        // stretching vertical refraction. Recover only the viewer's model scale
        // and refract through an isotropic physical liquid thickness instead.
        metricToWorld.copy(renderedObject.matrixWorld).multiply(metricToLocal);
        if (backdrop?.enabled.value) worldToMetric!.copy(metricToWorld).invert();
        uniforms.aloeWorldThickness.value = physicalThickness * metricToWorld.getMaxScaleOnAxis();
      };
      if (role === 'liquid' && material instanceof THREE.MeshPhysicalMaterial) {
        material.roughness = ALOE_PET_OPTICS.refractionRoughness;
        material.transmission = 1; material.ior = 1.335;
        // Three scales physical thickness using the mesh's model matrix.
        // Divide out that authored scale because profile widths are metres.
        const authoredScale = new THREE.Vector3().setFromMatrixScale(liquidToMetric);
        const metricScale = Math.sqrt(authoredScale.x * authoredScale.z);
        material.thickness = Math.min(profile.halfBounds.x, profile.halfBounds.y) * 0.44 / Math.max(metricScale, 1e-6);
        material.attenuationColor.set('#ffffff'); material.attenuationDistance = Infinity;
        material.color.set('#ffffff');
        // Opaque queue writes the filtered RGBA result directly; the final
        // premultiply supports the transparent canvas and native PNG compositor.
        material.premultipliedAlpha = true;
      } else if (role === 'inclusions') {
        material.color.copy(scattering); material.roughness = 0.24;
        prepareAloeGelDetail(mesh.geometry, localToMetric, profile);
        // Gel is an extinction filter over the captured liquid/scene. A unit
        // filter at zero reveal preserves both RGB and alpha exactly, unlike
        // an opaque white/coloured cube or another overlapping transmission pass.
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        // Native capture clear is white alpha .5. Use the real destination
        // coverage in the blend equation to filter actual colour while leaving
        // that sentinel untouched, even at a nearly clear inward bottom surface.
        material.blendSrc = THREE.OneMinusDstAlphaFactor; material.blendDst = THREE.SrcAlphaFactor;
        material.blendEquationAlpha = THREE.AddEquation;
        material.blendSrcAlpha = THREE.ZeroFactor; material.blendDstAlpha = THREE.OneFactor;
        material.depthWrite = false;
        material.toneMapped = false;
      } else if (role !== 'liquid-back') return;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        const gelVaryings = 'varying float vAloeDepth;\nvarying vec3 vAloeGelDetail;';
        const vertexDeclarations = role === 'inclusions'
          ? `${declarations}\n${vertexDepthDeclarations}\nattribute vec3 aloeGelDetail;\n${gelVaryings}`
          : 'uniform mat4 aloeLocalToMetric;\nvarying vec3 vAloePosition;';
        const vertexDepth = role === 'inclusions' ? /* glsl */`
          vec3 aloeTowardCamera = normalize(mix(aloeCamera - vAloePosition, aloeViewDirection, aloeOrthographic));
          vAloeDepth = aloeGelDetail.z > 0.5 ? 0.0 : aloeExitDistance(vAloePosition, aloeTowardCamera);
          vAloeGelDetail = aloeGelDetail;
        ` : '';
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${vertexDeclarations}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAloePosition = (aloeLocalToMetric * vec4(transformed, 1.0)).xyz;\n${vertexDepth}`);
        // Assemble this block once: replacing <common> a second time would
        // prepend helpers before the uniforms/functions they reference.
        const fragmentDeclarations = role === 'inclusions'
          ? `${declarations}\n${gelVaryings}\n${vertexDepthDeclarations}`
          : role === 'liquid' ? `${declarations}\n${vertexDepthDeclarations}\n${externalBackdropDeclarations}` : declarations;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${fragmentDeclarations}`);
        if (role === 'liquid') shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_pars_fragment>',
          correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment, true).replace(
            'return normalize( refractionVector ) * thickness * modelScale;',
            'return normalize( refractionVector ) * aloeWorldThickness;'));
        if (role === 'liquid-back') shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
          vec3 viewRay = normalize(mix(aloeCamera - vAloePosition, aloeViewDirection, aloeOrthographic));
          float path = aloeBulkPath(vAloePosition, viewRay);
          float height = clamp((vAloePosition.y - aloeHeightRange.x) / (aloeHeightRange.y - aloeHeightRange.x), 0.0, 1.0);
          float coverage = aloeReservoirCoverage(path, height);
          gl_FragColor = vec4(aloeVolumeColor(path), coverage);
        `);
        if (role === 'liquid') shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
          vec3 viewRay = normalize(mix(aloeCamera - vAloePosition, aloeViewDirection, aloeOrthographic));
          float opticalPath = aloeBulkPath(vAloePosition, -viewRay);
          float relativePath = clamp(opticalPath / aloeReferencePath, 0.12, 1.8);
          vec3 volumeColor = aloeVolumeColor(opticalPath);
          vec3 mediumExtinction = -log(clamp(aloeJuiceColor, vec3(0.025), vec3(1.0))) * ${ALOE_PET_OPTICS.mediumAbsorption.toFixed(6)};
          // Only water/gel enter this internal capture. Spectrally filtering
          // a negative gel delta
          // again darkens red more than green/blue and gives grey-green pulp.
          // Preserve the water hue and cap cumulative overlapping extinction.
          vec3 captureDelta = totalDiffuse - volumeColor;
          vec3 luminanceWeights = vec3(0.2126, 0.7152, 0.0722);
          float captureDarkening = dot(captureDelta, luminanceWeights);
          float retainedBrightness = clamp(1.0 + captureDarkening / max(dot(volumeColor, luminanceWeights), 0.0001),
            ${(1 - ALOE_PET_OPTICS.pulpMaximumContrast).toFixed(6)}, 1.0);
          vec3 filteredCapture = captureDarkening < 0.0
            ? volumeColor * retainedBrightness
            : volumeColor + captureDelta * exp(-mediumExtinction * relativePath);
          float capturedOpacity = clamp(material.transmissionAlpha, 0.0, 1.0);
          float forwardHaze = 0.07 + 0.07 * (1.0 - exp(-15.0 * opticalPath));
          float mediumOpacity = capturedOpacity + (1.0 - capturedOpacity) * forwardHaze;
          vec3 mediumRadiance = filteredCapture * capturedOpacity + volumeColor * forwardHaze * (1.0 - capturedOpacity);
          float reflectionCoverage = clamp(max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b) * 0.12, 0.0, 0.08);
          float finalOpacity = mediumOpacity + (1.0 - mediumOpacity) * reflectionCoverage;
          vec3 straightRadiance = (mediumRadiance + totalSpecular * 0.12) / max(finalOpacity, 0.0001);
          gl_FragColor = vec4(straightRadiance, finalOpacity);
        `);
        if (role === 'liquid') shader.fragmentShader = shader.fragmentShader.replace('#include <premultiplied_alpha_fragment>', /* glsl */`
          #include <premultiplied_alpha_fragment>
          if (aloeBackdropEnabled > 0.5 && aloeExternalReady > 0.5) {
            vec3 backdropDisplay = linearToOutputTexel(vec4(aloeExternalBackdrop, 1.0)).rgb;
            backdropDisplay = mix(vec3(1.0), backdropDisplay, aloeBackdropMix);
            gl_FragColor.rgb += backdropDisplay * (1.0 - gl_FragColor.a);
            gl_FragColor.a = 1.0;
          } else if (aloeWhiteDisplayFill > 0.5) {
            // Retain the approved white fallback when no backdrop is borrowed.
            gl_FragColor.rgb += vec3(1.0 - gl_FragColor.a);
            gl_FragColor.a = 1.0;
          }
        `);
        if (role === 'inclusions') shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
          float aloeDepth = max(vAloeDepth, 0.0);
          // Base/boundary triangles are marked once when preparing the immutable
          // optical attribute. Their first exit can cross the inward air pocket
          // discontinuously. Keep the exact solver there; body/neck skip it.
          if (vAloeGelDetail.z > 0.00001) {
            vec3 aloeTowardCamera = normalize(mix(aloeCamera - vAloePosition, aloeViewDirection, aloeOrthographic));
            aloeDepth = aloeExitDistance(vAloePosition, aloeTowardCamera);
          }
          // Deep pieces stop contributing extinction to the capture. Nearby
          // gel filters the existing volume radiance without changing its alpha.
          if (aloeDepth >= aloePulpFadeRange.y) discard;
          float visibility = exp(-aloeDepth * aloePulpExtinction)
            * (1.0 - smoothstep(aloePulpFadeRange.x, aloePulpFadeRange.y, aloeDepth)) * aloePulpVisibility;
          float cloud = vAloeGelDetail.x;
          float fibre = vAloeGelDetail.y;
          float faceCosine = max(abs(dot(normal, geometryViewDir)), 0.35);
          float piecePath = ${ALOE_PET_OPTICS.gelThicknessMetres.toFixed(6)} / faceCosine;
          float gelDensity = ${ALOE_PET_OPTICS.gelExtinctionPerMetre.toFixed(6)} + cloud * ${ALOE_PET_OPTICS.gelCloudExtinctionPerMetre.toFixed(6)} + fibre * 8.0;
          float pieceTransmittance = exp(-piecePath * gelDensity);
          // Clear aloe has the water hue. Cloud/fibre inside the gel adds weak
          // extinction THROUGH the piece, making near cợn subtly darker rather
          // than painting it with coconut-white diffuse pigment.
          float gelFilter = 1.0 - min(${ALOE_PET_OPTICS.pulpMaximumContrast.toFixed(6)}, (1.0 - pieceTransmittance) * visibility);
          // Compensate the renderer's actual clear radiance: RGB .5 on the
          // premultiplied hero context, 1 on Studio. Keep the sentinel and
          // destination alpha intact while filtering only real water radiance.
          gl_FragColor = vec4(vec3(2.0 * aloeClearRadiance * (1.0 - gelFilter)), gelFilter);
        `);
      };
      material.customProgramCacheKey = () => `${ALOE_PET_PROFILE}:${role}:${role === 'liquid' ? 18 : 16}`;
    },
  };
}
