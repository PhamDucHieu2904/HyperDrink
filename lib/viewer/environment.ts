import * as THREE from 'three';
import type { ProceduralEnvironmentConfig, ViewerEnvironment } from '../viewer-config';

type Direction = [number, number, number];
type CanopyPatch = { direction: Direction; width: number; strength: number };
const WIDTH = 512;
const HEIGHT = 256;

const normalize = (x: number, y: number, z: number): Direction => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
};
const smoothstep = (min: number, max: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
};
const lobe = (direction: Direction, axis: Direction, width: number) =>
  Math.exp(width * (direction[0] * axis[0] + direction[1] * axis[1] + direction[2] * axis[2] - 1));

/** A cache entry represents radiance; rotation and overall intensity do not regenerate it. */
export function environmentCacheKey(environment: ViewerEnvironment): string {
  if (environment.mode === 'hdri') return `hdri:${environment.src}`;
  const { preset, seed, skyIntensity, groundIntensity, canopyStrength } = environment.procedural;
  return `procedural:${preset}:${seed}:${skyIntensity}:${groundIntensity}:${canopyStrength}`;
}

/**
 * Synthetic linear-HDR daylight for product reflections, rather than a visible panorama.
 * A broad bright sky, neutral ground bounce and defocused canopy patches retain shape
 * without black side walls, a clipped sun disc or the white stripe of a studio softbox.
 * The caller owns this texture and disposes it after creating its PMREM target.
 */
export function createDaylightEnvironment(config: ProceduralEnvironmentConfig): THREE.DataTexture {
  let seed = config.seed >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const canopy: CanopyPatch[] = Array.from({ length: 9 }, () => {
    const azimuth = random() * Math.PI * 2;
    const elevation = -0.08 + random() * 0.75;
    const horizontal = Math.sqrt(1 - elevation * elevation);
    return {
      direction: [Math.cos(azimuth) * horizontal, elevation, Math.sin(azimuth) * horizontal],
      width: 3 + random() * 3,
      strength: 0.35 + random() * 0.65,
    };
  });
  const openSky = normalize(-0.5, 0.7, 0.65);
  const reflectedSky = normalize(0.65, 0.28, 0.8);
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    // Equirectangular UVs: the bottom array row is the -Y pole (DataTexture.flipY=false).
    const elevation = (y + 0.5) / HEIGHT * Math.PI;
    const up = -Math.cos(elevation);
    const horizontal = Math.sin(elevation);
    const skyMix = smoothstep(-0.32, 0.58, up);
    for (let x = 0; x < WIDTH; x += 1) {
      const azimuth = (x + 0.5) / WIDTH * Math.PI * 2 - Math.PI;
      const direction: Direction = [Math.cos(azimuth) * horizontal, up, Math.sin(azimuth) * horizontal];
      let coverage = 0;
      for (const patch of canopy) coverage += lobe(direction, patch.direction, patch.width) * patch.strength;
      // Bounded coverage keeps every horizon direction softly illuminated.
      const canopyOcclusion = config.canopyStrength * (1 - Math.exp(-coverage * 0.65));
      const diffuse = (config.groundIntensity * (1 - skyMix) + config.skyIntensity * skyMix) * (1 - canopyOcclusion);
      // Sky openings occupy broad angles but have enough HDR contrast to reveal metal.
      // Unlike a studio panel, spherical lobes feather in every direction without edges.
      const skyOpening = config.skyIntensity * (2 * lobe(direction, openSky, 6.2) + 0.62 * lobe(direction, reflectedSky, 5));
      const radiance = diffuse + skyOpening;
      const index = (y * WIDTH + x) * 4;
      // Slightly cooler sky and warmer ground; no flavor-color tint in illumination.
      data[index] = THREE.DataUtils.toHalfFloat(radiance * (1 - skyMix * 0.018));
      data[index + 1] = THREE.DataUtils.toHalfFloat(radiance * (0.978 + skyMix * 0.017));
      data[index + 2] = THREE.DataUtils.toHalfFloat(radiance * (0.955 + skyMix * 0.045));
      data[index + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = `Product daylight (${config.seed})`;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
