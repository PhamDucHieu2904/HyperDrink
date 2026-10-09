import * as THREE from 'three';
import { addBottleBackdropProjection, createBottleBackdropUniforms, updateBottleBackdropUniforms } from './bottle-backdrop';

/** The source High kernel measures world distances at ten times glTF metres.
 * These controls preserve its extinction and seed/gel response without tracing
 * the triangle BVHs or a second copy of the background. */
export const BASIL_WEB_OPTICS = Object.freeze({
  profileSegments: 8,
  glassIOR: 1.52,
  waterIOR: 1.333,
  glassRoughness: .042,
  densityPerMetre: 75,
  seedDepthPerMetre: 6.666,
  gelThicknessMetres: .000832,
  gelHaze: .28,
  gelTransmissionReduction: .15,
  seedColorSrgb: [.012, .018, .008] as const,
});

export interface BasilWebProfile {
  minimumY: number;
  maximumY: number;
  center: THREE.Vector2;
  /** One truncated circular cone: y0, y1, radius at y0, dr/dy. */
  sections: THREE.Vector4[];
  halfBounds: THREE.Vector2;
}

const profileCache = new WeakMap<THREE.BufferGeometry, Map<string, BasilWebProfile>>();

/** Sample the authored Water surface once. Metric coordinates have the bottle
 * axis along Y, irrespective of preserved Blender scales or viewer framing. */
export function fitBasilWebProfile(geometry: THREE.BufferGeometry, localToMetric: THREE.Matrix4): BasilWebProfile | undefined {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return;
  const key = localToMetric.elements.map(value => Number(value.toFixed(12))).join(',');
  const cached = profileCache.get(geometry)?.get(key);
  if (cached) return cached;
  const points: THREE.Vector3[] = [], bounds = new THREE.Box3();
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(localToMetric);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return;
    points.push(point); bounds.expandByPoint(point);
  }
  const size = bounds.getSize(new THREE.Vector3());
  if (size.y <= 1e-8 || size.x <= 1e-8 || size.z <= 1e-8) return;
  const center = new THREE.Vector2((bounds.min.x + bounds.max.x) * .5, (bounds.min.z + bounds.max.z) * .5);
  const count = BASIL_WEB_OPTICS.profileSegments, radii: number[] = [];
  const index = geometry.index, triangleCount = index?.count ?? points.length;
  for (let level = 0; level <= count; level++) {
    const y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, level / count);
    let radius = 0;
    const record = (point: THREE.Vector3) => { radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.y)); };
    // Include endpoints so the first/last profile cap follows the actual water.
    for (const point of points) if (Math.abs(point.y - y) < size.y * 1e-6) record(point);
    for (let triangle = 0; triangle + 2 < triangleCount; triangle += 3) {
      const ids = [0, 1, 2].map(offset => index ? index.getX(triangle + offset) : triangle + offset);
      for (let edge = 0; edge < 3; edge++) {
        const a = points[ids[edge]], b = points[ids[(edge + 1) % 3]];
        if ((a.y < y && b.y < y) || (a.y > y && b.y > y) || Math.abs(a.y - b.y) < 1e-12) continue;
        const t = (y - a.y) / (b.y - a.y);
        if (t >= 0 && t <= 1) record(a.clone().lerp(b, t));
      }
    }
    radii.push(Math.max(radius, 1e-7));
  }
  // Uniform cone chords can sit slightly inside a curved shoulder. Lift each
  // endpoint only by the adjacent authored surface's interpolation residual,
  // keeping near-water paths positive for the accepted source seed centers.
  // This affects optical depth, never the actual bottle/Water geometry.
  const residuals = new Float64Array(count);
  for (const point of points) {
    const height = (point.y - bounds.min.y) / size.y * count;
    const section = Math.min(count - 1, Math.max(0, Math.floor(height)));
    const linearRadius = THREE.MathUtils.lerp(radii[section], radii[section + 1], height - section);
    residuals[section] = Math.max(residuals[section], Math.hypot(point.x - center.x, point.z - center.y) - linearRadius);
  }
  for (let i = 0; i <= count; i++) radii[i] += Math.max(i > 0 ? residuals[i - 1] : 0, i < count ? residuals[i] : 0);
  const sections = radii.slice(0, count).map((radius, i) => {
    const y0 = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, i / count);
    const y1 = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, (i + 1) / count);
    return new THREE.Vector4(y0, y1, radius, (radii[i + 1] - radius) / (y1 - y0));
  });
  const profile = { minimumY: bounds.min.y, maximumY: bounds.max.y, center, sections,
    halfBounds: new THREE.Vector2(size.x * .5, size.z * .5) };
  let bucket = profileCache.get(geometry);
  if (!bucket) { bucket = new Map(); profileCache.set(geometry, bucket); }
  bucket.set(key, profile);
  return profile;
}

export function basilWebRadiusAt(profile: BasilWebProfile, y: number): number {
  const section = profile.sections.find(value => y <= value.y) ?? profile.sections[profile.sections.length - 1];
  return Math.max(0, section.z + section.w * (THREE.MathUtils.clamp(y, section.x, section.y) - section.x));
}

/** Nearest outward crossing of an eight-cone bottle. This is also the CPU
 * parity implementation of the vertex shader; no marching occurs per pixel. */
export function basilWebExitDistance(profile: BasilWebProfile, point: THREE.Vector3, direction: THREE.Vector3): number {
  const d = direction.clone().normalize();
  if (direction.lengthSq() < 1e-18) return 0;
  const x = point.x - profile.center.x, z = point.z - profile.center.y;
  let nearest = Infinity;
  const accept = (distance: number, section: THREE.Vector4) => {
    if (!Number.isFinite(distance) || distance <= 1e-7) return;
    const y = point.y + d.y * distance;
    if (y < section.x - 1e-7 || y > section.y + 1e-7) return;
    const radius = section.z + section.w * (y - section.x);
    // Outward roots, rather than entries when a surface vertex is slightly out.
    const gradientDot = (x + d.x * distance) * d.x + (z + d.z * distance) * d.z - radius * section.w * d.y;
    if (gradientDot > -1e-10) nearest = Math.min(nearest, distance);
  };
  for (const section of profile.sections) {
    const radius = section.z + section.w * (point.y - section.x);
    const slopeDirection = section.w * d.y;
    const a = d.x * d.x + d.z * d.z - slopeDirection * slopeDirection;
    const b = x * d.x + z * d.z - radius * slopeDirection;
    const c = x * x + z * z - radius * radius;
    if (Math.abs(a) < 1e-10) { if (Math.abs(b) > 1e-10) accept(-c / (2 * b), section); continue; }
    const determinant = b * b - a * c;
    if (determinant < 0) continue;
    const root = Math.sqrt(determinant);
    accept((-b - root) / a, section); accept((-b + root) / a, section);
  }
  if (Math.abs(d.y) > 1e-10) {
    const y = d.y > 0 ? profile.maximumY : profile.minimumY;
    const distance = (y - point.y) / d.y;
    if (distance > 1e-7 && Math.hypot(x + d.x * distance, z + d.z * distance) <= basilWebRadiusAt(profile, y) + 1e-7)
      nearest = Math.min(nearest, distance);
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

/** Pass the UI color as sRGB channels. Absorption in the actual High shader is
 * authored in sRGB; haze and the source seed pigment use linear-light colors. */
export function basilWebAbsorption(colorSrgb: THREE.Color, densityRatio = 1): THREE.Vector3 {
  const density = BASIL_WEB_OPTICS.densityPerMetre * THREE.MathUtils.clamp(densityRatio, 0, 3);
  return new THREE.Vector3(1 - THREE.MathUtils.clamp(colorSrgb.r, 0, 1),
    1 - THREE.MathUtils.clamp(colorSrgb.g, 0, 1), 1 - THREE.MathUtils.clamp(colorSrgb.b, 0, 1)).multiplyScalar(density);
}

export function basilWebTransmission(absorption: THREE.Vector3, distanceMetres: number): THREE.Color {
  const d = Math.max(0, distanceMetres);
  return new THREE.Color().setRGB(Math.exp(-absorption.x * d), Math.exp(-absorption.y * d), Math.exp(-absorption.z * d));
}

/** A precomposed neutral reservoir. The front physical glass samples this
 * already dyed image, and must not multiply another copy of the liquid dye. */
export function basilWebBulkColor(colorSrgb: THREE.Color, distanceMetres: number, irradiance = new THREE.Color(1, 1, 1)): THREE.Color {
  return basilWebTransmission(basilWebAbsorption(colorSrgb), distanceMetres).multiply(irradiance);
}

export interface BasilWebSeedResponse {
  background: THREE.Color;
  liquidColor: THREE.Color;
  absorption: THREE.Vector3;
  frontDepthMetres: number;
  coreHit: boolean;
  lighting?: THREE.Color;
  hazeLighting?: THREE.Color;
  seedColor?: THREE.Color;
  seedDepth?: number;
}
/** Source High's black core plus water-distance veil, or its weak tinted gel
 * haze. The gel-only branch continues the reservoir instead of turning white. */
export function basilWebSeedColor(input: BasilWebSeedResponse): THREE.Color {
  const distance = Math.max(0, input.frontDepthMetres);
  const visibility = Math.exp(-(input.seedDepth ?? BASIL_WEB_OPTICS.seedDepthPerMetre) * distance);
  const transmission = basilWebTransmission(input.absorption, distance);
  if (input.coreHit) {
    const sourceColor = input.seedColor ?? new THREE.Color().setRGB(...BASIL_WEB_OPTICS.seedColorSrgb, THREE.SRGBColorSpace);
    const core = sourceColor.clone().multiply(input.lighting ?? new THREE.Color(1, 1, 1)).multiply(transmission);
    return input.liquidColor.clone().multiplyScalar(.4).lerp(core, visibility);
  }
  const haze = new THREE.Color(1, 1, 1).lerp(input.liquidColor, .5)
    .multiply(input.hazeLighting ?? new THREE.Color(1, 1, 1)).multiply(transmission).multiplyScalar(BASIL_WEB_OPTICS.gelHaze * visibility);
  return input.background.clone().multiplyScalar(1 - BASIL_WEB_OPTICS.gelTransmissionReduction * visibility).add(haze);
}

/** Returns whether the camera-to-gel ray intersects the fitted source core.
 * CoreRatio is each core radius divided by coreRadius + fixed gel thickness. */
export function basilWebCoreIntersection(origin: THREE.Vector3, direction: THREE.Vector3, coreRatio: THREE.Vector3): number | undefined {
  if ([coreRatio.x, coreRatio.y, coreRatio.z].some(value => !Number.isFinite(value) || value <= 0 || value > 1)) return;
  const p = origin.clone().divide(coreRatio), d = direction.clone().normalize().divide(coreRatio);
  const a = d.lengthSq(), b = p.dot(d), c = p.lengthSq() - 1, determinant = b * b - a * c;
  if (a < 1e-12 || determinant < 0) return;
  const root = Math.sqrt(determinant), near = (-b - root) / a, far = (-b + root) / a;
  return near >= 0 ? near : far >= 0 ? far : undefined;
}

export type BasilWebUniforms = Record<string, THREE.IUniform>;

export function createBasilWebUniforms(profile: BasilWebProfile, meshToMetric: THREE.Matrix4, shared: BasilWebUniforms = {}): BasilWebUniforms {
  return {
    basilWebMeshToMetric: { value: meshToMetric.clone() },
    basilWebCameraLocal: { value: new THREE.Vector3() },
    basilWebCameraMetric: { value: new THREE.Vector3() },
    basilWebViewLocal: { value: new THREE.Vector3(0, 0, -1) },
    basilWebViewMetric: { value: new THREE.Vector3(0, 0, -1) },
    basilWebOrthographic: { value: 0 },
    basilWebCenter: { value: profile.center.clone() },
    basilWebYBounds: { value: new THREE.Vector2(profile.minimumY, profile.maximumY) },
    basilWebSections: { value: profile.sections.map(section => section.clone()) },
    basilWebAbsorption: { value: new THREE.Vector3() },
    basilWebLiquidColor: { value: new THREE.Color('#be2838') },
    basilWebSeedColor: { value: new THREE.Color().setRGB(...BASIL_WEB_OPTICS.seedColorSrgb, THREE.SRGBColorSpace) },
    basilWebSeedDepth: { value: BASIL_WEB_OPTICS.seedDepthPerMetre },
    basilWebGelHaze: { value: BASIL_WEB_OPTICS.gelHaze },
    basilWebGelTransmissionReduction: { value: BASIL_WEB_OPTICS.gelTransmissionReduction },
    ...shared,
  };
}

/** Include in a vertex shader only. Eight analytic cones replace thousands of
 * ray/BVH tests; depth/chord then interpolate smoothly across each tiny gel. */
export const BASIL_WEB_VOLUME_GLSL = /* glsl */`
uniform mat4 basilWebMeshToMetric;
uniform vec3 basilWebCameraLocal;
uniform vec3 basilWebCameraMetric;
uniform vec3 basilWebViewLocal;
uniform vec3 basilWebViewMetric;
uniform float basilWebOrthographic;
uniform vec2 basilWebCenter;
uniform vec2 basilWebYBounds;
uniform vec4 basilWebSections[8];
float basilWebRadius(float y) {
  float radius = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 s = basilWebSections[i];
    if (y >= s.x - 0.0000001 && y <= s.y + 0.0000001) radius = max(radius, s.z + s.w * (clamp(y,s.x,s.y)-s.x));
  }
  return radius;
}
void basilWebAcceptRoot(float t, vec4 s, vec3 p, vec3 d, inout float nearest) {
  float y = p.y + d.y * t;
  float r = s.z + s.w * (y-s.x);
  float gradient = dot(p.xz + d.xz*t,d.xz)-r*s.w*d.y;
  if (t > 0.0000001 && y >= s.x-0.0000001 && y <= s.y+0.0000001 && gradient >= -0.0000000001) nearest=min(nearest,t);
}
float basilWebExit(vec3 point, vec3 direction) {
  vec3 p=point-vec3(basilWebCenter.x,0.0,basilWebCenter.y), d=normalize(direction);
  float nearest=1000.0;
  for (int i=0;i<8;i++) {
    vec4 s=basilWebSections[i];
    float r=s.z+s.w*(p.y-s.x), k=s.w*d.y;
    float a=dot(d.xz,d.xz)-k*k, b=dot(p.xz,d.xz)-r*k, c=dot(p.xz,p.xz)-r*r;
    if (abs(a)<0.0000000001) {
      if(abs(b)>0.0000000001) basilWebAcceptRoot(-c/(2.0*b),s,p,d,nearest);
    } else {
      float determinant=b*b-a*c;
      if(determinant>=0.0) {
        float root=sqrt(determinant);
        basilWebAcceptRoot((-b-root)/a,s,p,d,nearest);
        basilWebAcceptRoot((-b+root)/a,s,p,d,nearest);
      }
    }
  }
  if(abs(d.y)>0.0000000001) {
    float y=d.y>0.0?basilWebYBounds.y:basilWebYBounds.x;
    float t=(y-p.y)/d.y;
    if(t>0.0000001 && length(p.xz+d.xz*t)<=basilWebRadius(y)+0.0000001) nearest=min(nearest,t);
  }
  return nearest<999.0?nearest:0.0;
}
`;

export const BASIL_WEB_SEED_GLSL = /* glsl */`
uniform vec3 basilWebLiquidColor;
uniform vec3 basilWebAbsorption;
uniform vec3 basilWebSeedColor;
uniform float basilWebSeedDepth;
uniform float basilWebGelHaze;
uniform float basilWebGelTransmissionReduction;
varying vec3 vBasilSeedLocal;
varying vec3 vBasilSeedCamera;
varying vec3 vBasilSeedView;
varying vec3 vBasilSeedCoreRatio;
varying vec2 vBasilSeedPath;
float basilWebCoreHit(vec3 origin, vec3 direction, vec3 ratio) {
  vec3 p=origin/ratio, d=direction/ratio;
  float a=dot(d,d), b=dot(p,d), c=dot(p,p)-1.0;
  float determinant=b*b-a*c;
  if(determinant<0.0) return 0.0;
  float t=(-b+sqrt(determinant))/max(a,0.00000001);
  return t>=0.0?1.0:0.0;
}
vec3 basilWebSeedResponse(vec3 lighting,vec3 hazeLighting) {
  vec3 ray=normalize(vBasilSeedView);
  vec3 surface=vBasilSeedLocal;
  float coreHit=basilWebCoreHit(surface+ray*0.00001,ray,max(vBasilSeedCoreRatio,vec3(0.0001)));
  float depth=max(0.0,vBasilSeedPath.x);
  float visibility=exp(-basilWebSeedDepth*depth);
  vec3 transmission=exp(-basilWebAbsorption*depth);
  vec3 reservoir=bottleBackdropAt(bottleBackdropUv())*exp(-basilWebAbsorption*max(0.0,vBasilSeedPath.y));
  vec3 core=mix(basilWebLiquidColor*.4,basilWebSeedColor*max(lighting,vec3(0.0))*transmission,visibility);
  vec3 haze=mix(vec3(1.0),basilWebLiquidColor,.5)*max(hazeLighting,vec3(0.0))*transmission*basilWebGelHaze*visibility;
  vec3 gel=reservoir*(1.0-basilWebGelTransmissionReduction*visibility)+haze;
  return mix(gel,core,coreHit);
}
`;

/** One opaque inclusion draw is visible inside Three's native transmission
 * capture. It stores the source black core and translucent gel precomposed over
 * the water reservoir, so no extra per-gel refraction targets are allocated.
 * Root owns capture-only visibility and the lifetime of mesh/geometry/material. */
export function configureBasilWebInclusions(material: THREE.MeshStandardMaterial, mesh: THREE.InstancedMesh,
  profile: BasilWebProfile, meshToMetric: THREE.Matrix4, sharedUniforms: BasilWebUniforms = {}): BasilWebUniforms {
  const attribute = mesh.geometry.getAttribute('basilCoreRatio');
  if (!attribute || attribute.itemSize !== 3 || attribute.count < mesh.count)
    throw new Error('Basil gel instances require their source core/gel radius ratios');
  const uniforms = createBasilWebUniforms(profile, meshToMetric, sharedUniforms);
  if (!uniforms.bottleBackdrop) Object.assign(uniforms, createBottleBackdropUniforms());
  material.color.setRGB(1, 1, 1);
  material.metalness = 0; material.roughness = 1;
  material.transparent = false; material.opacity = 1;
  material.depthWrite = true; material.side = THREE.FrontSide;
  material.toneMapped = false;
  if (material instanceof THREE.MeshPhysicalMaterial) material.transmission = 0;
  material.userData.basilWebInclusions = true;
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${BASIL_WEB_VOLUME_GLSL}\n${/* glsl */`
attribute vec3 basilCoreRatio;
varying vec3 vBasilSeedLocal;
varying vec3 vBasilSeedCamera;
varying vec3 vBasilSeedView;
varying vec3 vBasilSeedCoreRatio;
varying vec2 vBasilSeedPath;
`}`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vec3 basilCenter=instanceMatrix[3].xyz;
      vec3 basilX=instanceMatrix[0].xyz,basilY=instanceMatrix[1].xyz,basilZ=instanceMatrix[2].xyz;
      vec3 basilCameraOffset=basilWebCameraLocal-basilCenter;
      vBasilSeedCamera=vec3(dot(basilCameraOffset,basilX)/dot(basilX,basilX),dot(basilCameraOffset,basilY)/dot(basilY,basilY),dot(basilCameraOffset,basilZ)/dot(basilZ,basilZ));
      vec3 basilView=vec3(dot(basilWebViewLocal,basilX)/dot(basilX,basilX),dot(basilWebViewLocal,basilY)/dot(basilY,basilY),dot(basilWebViewLocal,basilZ)/dot(basilZ,basilZ));
      vBasilSeedLocal=transformed;
      vBasilSeedCoreRatio=basilCoreRatio;
      vBasilSeedView=basilWebOrthographic>.5?basilView:transformed-vBasilSeedCamera;
      vec3 basilPoint=(basilWebMeshToMetric*instanceMatrix*vec4(transformed,1.0)).xyz;
      vec3 basilRay=basilWebOrthographic>.5?-basilWebViewMetric:normalize(basilWebCameraMetric-basilPoint);
      float basilNear=basilWebExit(basilPoint,basilRay);
      float basilFar=basilWebExit(basilPoint,-basilRay);
      vBasilSeedPath=vec2(basilNear,basilNear+basilFar);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${BASIL_WEB_SEED_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
      #include <opaque_fragment>
      vec3 basilLighting=reflectedLight.directDiffuse+reflectedLight.indirectDiffuse;
      vec3 basilHazeLighting=vec3(1.0);
      #ifdef USE_ENVMAP
        basilHazeLighting=getIBLRadiance(normalize(vViewPosition),normalize(vViewPosition),.85);
      #endif
      gl_FragColor=vec4(basilWebSeedResponse(basilLighting,basilHazeLighting),1.0);
    `);
    addBottleBackdropProjection(shader);
  };
  const previousRender = material.onBeforeRender;
  const worldToLocal = new THREE.Matrix4(), cameraPosition = new THREE.Vector3(), viewDirection = new THREE.Vector3();
  material.onBeforeRender = function(renderer, scene, camera, geometry, object, group) {
    previousRender.call(this, renderer, scene, camera, geometry, object, group);
    updateBottleBackdropUniforms(uniforms as ReturnType<typeof createBottleBackdropUniforms>, scene);
    worldToLocal.copy(object.matrixWorld).invert();
    camera.getWorldPosition(cameraPosition).applyMatrix4(worldToLocal);
    uniforms.basilWebCameraLocal.value.copy(cameraPosition);
    uniforms.basilWebCameraMetric.value.copy(cameraPosition).applyMatrix4(meshToMetric);
    camera.getWorldDirection(viewDirection).transformDirection(worldToLocal);
    uniforms.basilWebViewLocal.value.copy(viewDirection);
    uniforms.basilWebViewMetric.value.copy(viewDirection).transformDirection(meshToMetric);
    uniforms.basilWebOrthographic.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
  };
  material.customProgramCacheKey = () => 'basil-web-source-core-gel-v2';
  material.needsUpdate = true;
  return uniforms;
}
