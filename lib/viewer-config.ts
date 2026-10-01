/** Serializable contracts shared by the storefront viewer and a future admin. */
export type PackagingKind = 'can' | 'pet' | 'glass' | 'pouch' | 'other';
export type Vector3Tuple = [number, number, number];
export type ViewerToneMapping = 'neutral' | 'agx' | 'aces';

export interface ProductAsset {
  id: string;
  src: string;
  name: string;
  packaging: PackagingKind;
  volumeMl?: number;
  poster?: string;
  /** Explicit semantic slot -> exported material/mesh names. No fuzzy name guesses. */
  materialSlots?: Record<string, string[]>;
  /** Euler correction in radians for assets that do not use glTF's +Y-up convention. */
  orientation?: Vector3Tuple;
}

export interface MaterialOverride {
  color?: string;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  opacity?: number;
  normalScale?: number;
  baseColorMap?: string;
  normalMap?: string;
  roughnessMap?: string;
}

export interface ProductAppearance {
  id?: string;
  /** Only these explicitly declared slots change; imported PBR is otherwise retained. */
  slots?: Record<string, MaterialOverride>;
  /** Temporary print artwork. Replace with slots.label.baseColorMap for approved labels. */
  label?: {
    slot?: string;
    brand?: string;
    name: string;
    category?: string;
    volumeMl?: number;
    colors: [string, string, string];
  };
}

export interface ViewerLight {
  type: 'directional' | 'hemisphere';
  color: string;
  groundColor?: string;
  intensity: number;
  /** Positions are multiples of the loaded object's bounding radius. */
  position: Vector3Tuple;
}

export interface ViewerPresentation {
  schemaVersion: 1;
  environment: { src: string; intensity: number; rotation: Vector3Tuple };
  lights: ViewerLight[];
  toneMapping: ViewerToneMapping;
  exposure: number;
  camera: { fov: number; fill: number; mobileFill: number; productScale: number; mobileProductScale: number; target: Vector3Tuple };
  pose: Vector3Tuple;
  motion: {
    idleSpeed: number; transitionSeconds: number; settleSeconds: number; turns: number; rocking: number; returnDelay: number;
    packageAimSeconds: number; packageAnticipationSeconds: number; packageAnticipationScale: number;
    packageOutSeconds: number; packageHoldSeconds: number; packageInSeconds: number; packageTilt: number; packageSpringDamping: number;
    packageBounceSeconds: number; packageBounceAmount: number;
  };
  quality: { maxDpr: number; mobileDpr: number; antialias: boolean; maxFps: number };
  decoders: { dracoPath: string; basisPath: string };
}

export type ViewerPresentationInput = {
  [K in keyof ViewerPresentation]?: ViewerPresentation[K] extends unknown[]
    ? ViewerPresentation[K]
    : ViewerPresentation[K] extends object ? Partial<ViewerPresentation[K]> : ViewerPresentation[K];
};

export const DEFAULT_VIEWER_PRESENTATION: ViewerPresentation = {
  schemaVersion: 1,
  // Broad, neutral softboxes provide the reflections; direct lights only lift shadows.
  environment: { src: '/environments/studio-softbox.exr', intensity: 0.85, rotation: [0, 0.75, 0] },
  lights: [
    { type: 'directional', color: '#ffffff', intensity: 0.45, position: [4, 5, 5] },
    { type: 'directional', color: '#f0f6ff', intensity: 0.25, position: [-4, 3, 4] },
    { type: 'hemisphere', color: '#ffffff', groundColor: '#aeb5bd', intensity: 0.12, position: [0, 3, 0] },
  ],
  toneMapping: 'neutral',
  exposure: 0.95,
  camera: { fov: 30, fill: 0.94, mobileFill: 0.94, productScale: 1, mobileProductScale: 1.55, target: [0, 0, 0] },
  pose: [-0.12, 0.15, -0.16],
  motion: {
    idleSpeed: 0.21, transitionSeconds: 0.66, settleSeconds: 0.46, turns: 1, rocking: 0.075, returnDelay: 2,
    packageAimSeconds: 0.3, packageAnticipationSeconds: 0.12, packageAnticipationScale: 1.06,
    packageOutSeconds: 0.4, packageHoldSeconds: 0.2, packageInSeconds: 0.5, packageTilt: 1.3, packageSpringDamping: 0.66,
    packageBounceSeconds: 0.7, packageBounceAmount: 0.2,
  },
  quality: { maxDpr: 1.65, mobileDpr: 1.35, antialias: true, maxFps: 60 },
  decoders: { dracoPath: '/decoders/draco/', basisPath: '/decoders/basis/' },
};

const number = (input: unknown, fallback: number, min: number, max: number) =>
  typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback;
const color = (input: unknown, fallback: string) =>
  typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback;
const vector = (input: unknown, fallback: Vector3Tuple, limit = 100): Vector3Tuple =>
  Array.isArray(input) && input.length === 3
    ? [0, 1, 2].map((index) => number(input[index], fallback[index], -limit, limit)) as Vector3Tuple
    : [...fallback];
/** Same-origin assets or HTTPS CDN URLs; no executable/custom URL protocols. */
export const assetUrl = (input: unknown, fallback = '') =>
  typeof input === 'string' && (/^\/(?!\/)/.test(input) || /^https:\/\//i.test(input)) ? input : fallback;

/** Clamp persisted/admin values before they reach WebGL. Returned value is plain JSON. */
export function resolveViewerPresentation(input: ViewerPresentationInput = {}): ViewerPresentation {
  const d = DEFAULT_VIEWER_PRESENTATION;
  return {
    schemaVersion: 1,
    environment: {
      src: assetUrl(input.environment?.src, d.environment.src),
      intensity: number(input.environment?.intensity, d.environment.intensity, 0, 5),
      rotation: vector(input.environment?.rotation, d.environment.rotation, Math.PI * 2),
    },
    lights: (Array.isArray(input.lights) ? input.lights : d.lights).slice(0, 6).map((light, index) => ({
      type: light.type === 'hemisphere' ? 'hemisphere' : 'directional',
      color: color(light.color, '#ffffff'),
      groundColor: color(light.groundColor, '#b9b5ae'),
      intensity: number(light.intensity, d.lights[index]?.intensity ?? 1, 0, 10),
      position: vector(light.position, [3, 3, 3]),
    })),
    toneMapping: ['neutral', 'agx', 'aces'].includes(input.toneMapping ?? '') ? input.toneMapping! : d.toneMapping,
    exposure: number(input.exposure, d.exposure, 0.1, 3),
    camera: {
      fov: number(input.camera?.fov, d.camera.fov, 18, 60),
      fill: number(input.camera?.fill, d.camera.fill, 0.4, 0.94),
      mobileFill: number(input.camera?.mobileFill, d.camera.mobileFill, 0.4, 0.94),
      productScale: number(input.camera?.productScale, d.camera.productScale, 1, 2),
      mobileProductScale: number(input.camera?.mobileProductScale, d.camera.mobileProductScale, 1, 2),
      target: vector(input.camera?.target, d.camera.target, 1),
    },
    pose: vector(input.pose, d.pose, Math.PI * 2),
    motion: {
      idleSpeed: number(input.motion?.idleSpeed, d.motion.idleSpeed, 0, 0.6),
      transitionSeconds: number(input.motion?.transitionSeconds, d.motion.transitionSeconds, 0.2, 3),
      settleSeconds: number(input.motion?.settleSeconds, d.motion.settleSeconds, 0.15, 3),
      turns: number(input.motion?.turns, d.motion.turns, 0.25, 2),
      rocking: number(input.motion?.rocking, d.motion.rocking, 0, 0.2),
      returnDelay: number(input.motion?.returnDelay, d.motion.returnDelay, 0.5, 10),
      packageAimSeconds: number(input.motion?.packageAimSeconds, d.motion.packageAimSeconds, 0.1, 2),
      packageAnticipationSeconds: number(input.motion?.packageAnticipationSeconds, d.motion.packageAnticipationSeconds, 0.06, 0.4),
      packageAnticipationScale: number(input.motion?.packageAnticipationScale, d.motion.packageAnticipationScale, 1, 1.12),
      packageOutSeconds: number(input.motion?.packageOutSeconds, d.motion.packageOutSeconds, 0.1, 2),
      packageHoldSeconds: number(input.motion?.packageHoldSeconds, d.motion.packageHoldSeconds, 0.05, 2),
      packageInSeconds: number(input.motion?.packageInSeconds, d.motion.packageInSeconds, 0.1, 2),
      packageTilt: number(input.motion?.packageTilt, d.motion.packageTilt, 0.2, Math.PI / 2),
      packageSpringDamping: number(input.motion?.packageSpringDamping, d.motion.packageSpringDamping, 0.6, 0.9),
      packageBounceSeconds: number(input.motion?.packageBounceSeconds, d.motion.packageBounceSeconds, 0.2, 1),
      packageBounceAmount: number(input.motion?.packageBounceAmount, d.motion.packageBounceAmount, 0, 0.2),
    },
    quality: {
      maxDpr: number(input.quality?.maxDpr, d.quality.maxDpr, 1, 2),
      mobileDpr: number(input.quality?.mobileDpr, d.quality.mobileDpr, 1, 1.65),
      antialias: typeof input.quality?.antialias === 'boolean' ? input.quality.antialias : d.quality.antialias,
      maxFps: number(input.quality?.maxFps, d.quality.maxFps, 24, 60),
    },
    decoders: {
      dracoPath: assetUrl(input.decoders?.dracoPath, d.decoders.dracoPath),
      basisPath: assetUrl(input.decoders?.basisPath, d.decoders.basisPath),
    },
  };
}

export function resolveMaterialOverride(input: MaterialOverride): MaterialOverride {
  const result: MaterialOverride = {};
  if (input.color !== undefined) result.color = color(input.color, '#ffffff');
  for (const key of ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'transmission', 'opacity'] as const) {
    if (input[key] !== undefined) result[key] = number(input[key], 0, 0, 1);
  }
  if (input.ior !== undefined) result.ior = number(input.ior, 1.5, 1, 2.5);
  if (input.thickness !== undefined) result.thickness = number(input.thickness, 0, 0, 1);
  if (input.normalScale !== undefined) result.normalScale = number(input.normalScale, 1, 0, 3);
  for (const key of ['baseColorMap', 'normalMap', 'roughnessMap'] as const) {
    if (input[key] !== undefined) result[key] = assetUrl(input[key]);
  }
  return result;
}
