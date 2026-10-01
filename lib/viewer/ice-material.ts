import * as THREE from 'three';

export interface IceMaterialFrame {
  /** Actual WebGL drawing-buffer size, including DPR. */
  resolution: [number, number];
  opacity: number;
  blur: number;
  /** Omit to keep the sampler; null selects a genuinely transparent fallback. */
  background?: THREE.Texture | null;
}

const vertexShader = /* glsl */`
  varying vec2 vIceUv;
  void main() {
    vIceUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D iceMap;
  uniform mat3 iceMapTransform;
  uniform vec2 iceTexel;
  uniform sampler2D backdrop;
  uniform vec2 resolution;
  uniform float opacity;
  uniform float blur;
  uniform float hasBackdrop;
  varying vec2 vIceUv;

  vec4 photographicStructure(vec2 localUv) {
    return texture2D(iceMap, (iceMapTransform * vec3(clamp(localUv, 0.002, 0.998), 1.0)).xy);
  }

  float iceLuma(vec3 rgb) { return dot(rgb, vec3(0.2126, 0.7152, 0.0722)); }

  float segmentDistance(vec2 point, vec2 a, vec2 b) {
    vec2 line = b - a;
    return length(point - a - line * clamp(dot(point - a, line) / dot(line, line), 0.0, 1.0));
  }

  vec3 backgroundAt(vec2 coordinate) {
    vec2 pixel = 1.0 / resolution;
    vec2 uv = clamp(coordinate, pixel * 0.5, vec2(1.0) - pixel * 0.5);
    vec3 color = texture2D(backdrop, uv).rgb;
    if (blur > 0.05) {
      vec2 radius = pixel * blur * 0.45;
      color = color * 0.6
        + texture2D(backdrop, clamp(uv + vec2(radius.x, 0.0), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.1
        + texture2D(backdrop, clamp(uv - vec2(radius.x, 0.0), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.1
        + texture2D(backdrop, clamp(uv + vec2(0.0, radius.y), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.1
        + texture2D(backdrop, clamp(uv - vec2(0.0, radius.y), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.1;
    }
    return color;
  }

  void main() {
    vec2 uv = vIceUv;
    vec4 structure = photographicStructure(uv);
    float mask = structure.a;
    vec2 derivativeX = dFdx(uv), derivativeY = dFdy(uv);
    if (mask < 0.015 || opacity < 0.002) discard;
    float focus = 1.0 / (1.0 + blur * 0.18);

    // Three deliberately planar faces follow the photographed 3/4 cube. Unlike
    // a spherical droplet, each pane refracts in its own direction and meets at
    // a sharp structural crease. Bevels soften only the immediate junction.
    vec2 front = vec2(0.49, 0.55);
    vec2 left = vec2(0.20, 0.70);
    vec2 right = vec2(0.90, 0.69);
    float topBoundary = uv.x < front.x
      ? front.y + (left.y - front.y) * (front.x - uv.x) / (front.x - left.x)
      : front.y + (right.y - front.y) * (uv.x - front.x) / (right.x - front.x);
    float topFace = smoothstep(-0.009, 0.009, uv.y - topBoundary);
    float frontSeam = 0.48 + (uv.y - 0.11) * (0.01 / 0.44);
    float rightFace = smoothstep(-0.009, 0.009, uv.x - frontSeam);
    vec3 normal = mix(vec3(-0.68, -0.06, 0.73), vec3(0.52, -0.10, 0.85), rightFace);
    normal = mix(normal, vec3(0.02, 0.75, 0.66), topFace);

    // Photo RGB is never used as ice color. Only local luminance derivatives
    // preserve the fine melt lines and air fractures within the clear planes.
    // At an 80px rendered cube one screen pixel spans many source texels. Sample
    // at that footprint so fine melt seams remain visible after downsampling.
    vec2 screenTexel = sqrt(derivativeX * derivativeX + derivativeY * derivativeY);
    vec2 tap = max(iceTexel * 1.4, screenTexel * 1.1);
    float centerLuma = iceLuma(structure.rgb);
    vec4 sampleLeft = photographicStructure(uv - vec2(tap.x, 0.0));
    vec4 sampleRight = photographicStructure(uv + vec2(tap.x, 0.0));
    vec4 sampleDown = photographicStructure(uv - vec2(0.0, tap.y));
    vec4 sampleUp = photographicStructure(uv + vec2(0.0, tap.y));
    vec2 detail = vec2(iceLuma(sampleRight.rgb) - iceLuma(sampleLeft.rgb),
      iceLuma(sampleUp.rgb) - iceLuma(sampleDown.rgb));
    float localMean = (iceLuma(sampleLeft.rgb) + iceLuma(sampleRight.rgb)
      + iceLuma(sampleDown.rgb) + iceLuma(sampleUp.rgb)) * 0.25;
    float fracture = smoothstep(0.012, 0.085, abs(centerLuma - localMean))
      * smoothstep(0.15, 0.65, mask) * focus;
    normal.xy += detail * 0.32 * focus;
    normal = normalize(normal);

    // Neutral air -> ice transmission. Convert the local plane ray through its
    // screen Jacobian so refraction follows the cube rotation and camera aspect.
    vec3 ray = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / 1.31);
    float determinant = derivativeX.x * derivativeY.y - derivativeY.x * derivativeX.y;
    vec2 refractedPixels = vec2(0.0);
    if (abs(determinant) > 0.00000001) {
      refractedPixels = vec2(derivativeY.y * ray.x - derivativeY.x * ray.y,
        -derivativeX.y * ray.x + derivativeX.x * ray.y) / determinant;
    }
    vec2 screenUv = gl_FragCoord.xy / resolution;
    vec2 bend = refractedPixels * 0.14 * focus / resolution;
    vec3 transmitted = vec3(1.0);
    if (hasBackdrop > 0.5) transmitted = backgroundAt(screenUv + bend);

    float topCrease = min(segmentDistance(uv, left, front), segmentDistance(uv, front, right));
    float verticalCrease = segmentDistance(uv, front, vec2(0.48, 0.11));
    float creaseDistance = min(topCrease, verticalCrease);
    float creaseWidth = max(length(derivativeX) + length(derivativeY), 0.0045);
    float bevel = exp(-pow(creaseDistance / (creaseWidth * 0.85), 2.0));
    float photoSilhouetteEdge = clamp(length(vec2(sampleRight.a - sampleLeft.a,
      sampleUp.a - sampleDown.a)) * 2.2, 0.0, 1.0);
    float fresnel = 0.018 + 0.982 * pow(1.0 - normal.z, 5.0);
    // Reflections are sparse and neutral: edges/creases communicate thickness,
    // while the broad faces retain the actual green/orange/pink environment.
    float lightSide = mix(0.45, 1.0, smoothstep(0.2, 0.85, uv.y));
    float photoHighlight = smoothstep(0.45, 0.85, centerLuma);
    float photoShadow = 1.0 - smoothstep(0.04, 0.36, centerLuma);
    float broadBevel = exp(-pow(creaseDistance / 0.047, 2.0));
    float contour = clamp(photoSilhouetteEdge + broadBevel * 0.72, 0.0, 1.0);
    // Contrast follows the real cube's photographed melt ridges, facets and
    // fractures. Bright photo structure reflects neutral light; its dark areas
    // reflect a darker version of the live flavor, never stock-photo blue/grey.
    // The broad clear faces keep most of their transmitted backdrop color.
    float whiteReflection = (photoSilhouetteEdge * 0.63 * lightSide
      + bevel * 0.30 * lightSide + fracture * 0.29 * photoHighlight + fresnel * 0.32
      + photoHighlight * 0.70 * (0.23 + contour * 0.77)
      + topFace * 0.115) * focus;
    float darkReflection = (photoShadow * 0.70
      + fracture * 0.14 + broadBevel * photoShadow * 0.14
      + photoSilhouetteEdge * 0.11 * (1.0 - lightSide)
      + (1.0 - topFace) * mix(0.16, 0.055, rightFace)) * focus * hasBackdrop;
    float transmissionAlpha = mix(0.0, 0.88, hasBackdrop);
    // Keep reflected and transmitted energy bounded even when silhouette,
    // crease and crack highlights overlap on the same pixel.
    float reflectedEnergy = whiteReflection + darkReflection;
    float reflectionAlpha = min(reflectedEnergy, 0.84);
    float reflectionScale = reflectionAlpha / max(reflectedEnergy, 0.0001);
    whiteReflection *= reflectionScale;
    darkReflection *= reflectionScale;
    float opticalAlpha = transmissionAlpha + reflectionAlpha * (1.0 - transmissionAlpha);
    vec3 color = (transmitted * transmissionAlpha * (1.0 - reflectionAlpha)
      + vec3(1.0) * whiteReflection + transmitted * 0.20 * darkReflection) / max(opticalAlpha, 0.001);
    gl_FragColor = vec4(color, opticalAlpha * mask * opacity);
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;

const bounded = (value: number, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** The caller owns the atlas/crop and live linear backdrop. Disposing this
 * material releases only its shader program, never either shared texture. */
export function createIceMaterial(map: THREE.Texture, background?: THREE.Texture | null): THREE.ShaderMaterial {
  map.updateMatrix();
  const image = map.image as { width?: number; height?: number } | undefined;
  const material = new THREE.ShaderMaterial({
    name: 'colorless-refractive-ice', vertexShader, fragmentShader,
    uniforms: {
      iceMap: { value: map }, iceMapTransform: { value: map.matrix },
      iceTexel: { value: new THREE.Vector2(1 / Math.max(1, (image?.width ?? 1024) * map.repeat.x), 1 / Math.max(1, (image?.height ?? 1024) * map.repeat.y)) },
      backdrop: { value: background ?? null }, resolution: { value: new THREE.Vector2(1, 1) },
      opacity: { value: 1 }, blur: { value: 0 }, hasBackdrop: { value: background ? 1 : 0 },
    },
    transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, toneMapped: false,
  });
  material.userData.accentOpacity = 1;
  return material;
}

export function updateIceMaterial(material: THREE.ShaderMaterial, frame: IceMaterialFrame): void {
  const opacity = bounded(frame.opacity, 0, 0, 1);
  material.opacity = opacity;
  material.uniforms.opacity.value = opacity;
  material.uniforms.blur.value = bounded(frame.blur, 0, 0, 12);
  (material.uniforms.resolution.value as THREE.Vector2).set(
    bounded(frame.resolution[0], 1, 1, 16384), bounded(frame.resolution[1], 1, 1, 16384),
  );
  const map = material.uniforms.iceMap.value as THREE.Texture;
  if (map.matrixAutoUpdate) map.updateMatrix();
  if (frame.background !== undefined) {
    material.uniforms.backdrop.value = frame.background;
    material.uniforms.hasBackdrop.value = frame.background ? 1 : 0;
  }
}
