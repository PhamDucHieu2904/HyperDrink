import * as THREE from 'three';

export interface DropletMaterialFrame {
  /** WebGL drawing-buffer dimensions, including DPR, not CSS viewport dimensions. */
  resolution: [number, number];
  opacity: number;
  blur: number;
  /** Omit to retain the live sampler; null deliberately enables a clear fallback. */
  background?: THREE.Texture | null;
}

const vertexShader = /* glsl */`
  varying vec2 vDropletUv;
  void main() {
    vDropletUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D backdrop;
  uniform vec2 resolution;
  uniform float opacity;
  uniform float blur;
  uniform float hasBackdrop;
  varying vec2 vDropletUv;

  vec3 backgroundAt(vec2 coordinate, float radius) {
    vec2 pixel = 1.0 / resolution;
    vec2 uv = clamp(coordinate, pixel * 0.5, vec2(1.0) - pixel * 0.5);
    vec3 color = texture2D(backdrop, uv).rgb;
    if (radius > 0.05) {
      vec2 offset = pixel * radius;
      color *= 0.4;
      color += texture2D(backdrop, clamp(uv + vec2(offset.x, 0.0), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.15;
      color += texture2D(backdrop, clamp(uv - vec2(offset.x, 0.0), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.15;
      color += texture2D(backdrop, clamp(uv + vec2(0.0, offset.y), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.15;
      color += texture2D(backdrop, clamp(uv - vec2(0.0, offset.y), pixel * 0.5, vec2(1.0) - pixel * 0.5)).rgb * 0.15;
    }
    return color;
  }

  void main() {
    // Retain the footprint of the previous atlas droplet on its 1.7-unit plane.
    // The slight taper prevents a collection of identical perfect circles.
    vec2 point = (vDropletUv - 0.5) / vec2(0.23, 0.27);
    point.x *= 1.0 + 0.035 * point.y;
    float radius = length(point);
    float derivative = max(fwidth(radius), 0.001);
    vec2 gradientX = dFdx(point);
    vec2 gradientY = dFdy(point);
    float edgeSoftness = max(derivative * 1.2, 0.025 + blur * 0.012);
    float coverage = 1.0 - smoothstep(1.0 - edgeSoftness, 1.0 + edgeSoftness, radius);
    if (coverage < 0.002 || opacity < 0.002) discard;

    float domeHeight = sqrt(max(0.001, 1.0 - min(dot(point, point), 0.999)));
    vec3 normal = normalize(vec3(point, domeHeight));
    // Air -> water, using water's neutral IOR rather than a colored glass texture.
    vec3 transmittedRay = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / 1.333);
    // Map the refracted local ray back through the projected ellipse Jacobian.
    // Its direction/strength must follow the rotated plane at any camera aspect.
    float determinant = gradientX.x * gradientY.y - gradientY.x * gradientX.y;
    vec2 refractedPixels = vec2(0.0);
    if (abs(determinant) > 0.00000001) {
      refractedPixels = vec2(
        gradientY.y * transmittedRay.x - gradientY.x * transmittedRay.y,
        -gradientX.y * transmittedRay.x + gradientX.x * transmittedRay.y
      ) / determinant;
    }
    float focus = 1.0 / (1.0 + blur * 0.18);
    vec2 screenUv = gl_FragCoord.xy / resolution;
    vec2 bend = refractedPixels * 0.7 * focus / resolution;

    // The opposing localized reflections reveal a rounded water lens on bright
    // backgrounds. They never paint a continuous grey/blue ring around its edge.
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - normal.z, 5.0);
    vec2 radial = point / max(radius, 0.0001);
    float upperDirection = pow(max(dot(radial, normalize(vec2(-0.55, 0.83))), 0.0), 9.0);
    float upperArc = exp(-pow((radius - 0.76) / 0.082, 2.0)) * upperDirection;
    float lowerDirection = pow(max(dot(radial, normalize(vec2(-0.22, -0.97))), 0.0), 11.0);
    float lowerArc = exp(-pow((radius - 0.84) / 0.075, 2.0)) * lowerDirection;
    float shadowDirection = pow(max(dot(radial, normalize(vec2(0.88, -0.47))), 0.0), 5.0);
    float shadowArc = exp(-pow((radius - 0.85) / 0.095, 2.0)) * shadowDirection;
    float whiteReflection = (fresnel * 0.065 + upperArc * 0.66 + lowerArc * 0.15) * focus;
    float shadowReflection = shadowArc * 0.34 * focus * hasBackdrop;
    float reflectionAlpha = whiteReflection + shadowReflection;
    float transmissionAlpha = mix(0.012, 0.78, hasBackdrop);
    float opticalAlpha = transmissionAlpha + reflectionAlpha * (1.0 - transmissionAlpha);
    vec3 transmittedColor = vec3(1.0);
    if (hasBackdrop > 0.5) transmittedColor = backgroundAt(screenUv + bend, blur * 0.6);
    // Dark reflection keeps the underlying flavor hue; no opaque grey stock-photo
    // crescent is introduced. A missing backdrop has white reflections only.
    vec3 shadowColor = transmittedColor * 0.28;
    vec3 color = (transmittedColor * (opticalAlpha - reflectionAlpha)
      + vec3(1.0) * whiteReflection + shadowColor * shadowReflection) / max(opticalAlpha, 0.001);

    gl_FragColor = vec4(color, opticalAlpha * coverage * opacity);
    // The sampler supplies linear RGB: canvas sRGB is decoded in the capture,
    // while its render target stores linear values. Output conversion and alpha
    // premultiplication each happen once, keeping the payload aligned with CSS.
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;

const bounded = (value: number, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/**
 * A colorless water lens over the live hero backdrop. The caller owns that sampler;
 * material disposal never disposes the shared background texture. An unavailable
 * sampler yields a barely visible clear center and a soft white curved reflection.
 */
export function createDropletMaterial(background?: THREE.Texture | null): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'colorless-water-droplet',
    vertexShader,
    fragmentShader,
    uniforms: {
      backdrop: { value: background ?? null },
      resolution: { value: new THREE.Vector2(1, 1) },
      opacity: { value: 1 },
      blur: { value: 0 },
      hasBackdrop: { value: background ? 1 : 0 },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.userData.accentOpacity = 1;
  return material;
}

/** Update shared sampler/focus and the existing accent fade without reallocating GPU resources. */
export function updateDropletMaterial(material: THREE.ShaderMaterial, frame: DropletMaterialFrame): void {
  const opacity = bounded(frame.opacity, 0, 0, 1);
  material.opacity = opacity;
  material.uniforms.opacity.value = opacity;
  material.uniforms.blur.value = bounded(frame.blur, 0, 0, 12);
  (material.uniforms.resolution.value as THREE.Vector2).set(
    bounded(frame.resolution[0], 1, 1, 16384),
    bounded(frame.resolution[1], 1, 1, 16384),
  );
  if (frame.background !== undefined) {
    material.uniforms.backdrop.value = frame.background;
    material.uniforms.hasBackdrop.value = frame.background ? 1 : 0;
  }
}
