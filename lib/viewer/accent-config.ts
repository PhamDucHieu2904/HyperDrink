import { assetUrl, type Vector3Tuple } from '../viewer-config';

/** Serializable scene dressing. All dimensions are relative to product height,
 * independent of whether the primary product is a can, bottle or pouch. */
export type ProductAccentKind = 'fruit' | 'leaf' | 'ice' | 'droplet';
export type AccentFlavor = 'citrus' | 'berry' | 'peach' | 'lime';
export type AccentSprite = 'orange' | 'lime' | 'berry' | 'peach' | 'mint' | 'citrus-leaf';

export interface ProductAccentVariant {
  /** Optional approved GLB or image asset; an empty slot uses the demo cutout. */
  assetUrl?: string;
  sprite?: AccentSprite;
  color: string;
  secondaryColor?: string;
  /** Optional multiplier for approved assets; demo photographic colors are retained. */
  tint?: string;
}

export interface ProductAccentNode extends ProductAccentVariant {
  id: string;
  kind: ProductAccentKind;
  enabled: boolean;
  /** +Y is up, +Z faces the camera. Most accents remain behind the product. */
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: number;
  /** Depth cues are explicit so a later admin can tune composition and focus. */
  depth: 'near' | 'mid' | 'far';
  blur: number;
  idle: { phase: number; floatAmplitude: number; rockAmplitude: number; periodSeconds: number };
  variants?: Partial<Record<AccentFlavor, Partial<ProductAccentVariant>>>;
}

export interface ProductAccentMotion {
  fadeSeconds: number;
  burstSeconds: number;
  staggerSeconds: number;
  origin: Vector3Tuple;
  startScale: number;
}

export interface ProductAccentScene {
  schemaVersion: 1;
  enabled: boolean;
  opacity: number;
  nodes: ProductAccentNode[];
  motion: ProductAccentMotion;
}

const fruitVariants: ProductAccentNode['variants'] = {
  citrus: { sprite: 'orange', color: '#ffc15b', secondaryColor: '#ee8627' },
  berry: { sprite: 'berry', color: '#d83964', secondaryColor: '#702b65' },
  peach: { sprite: 'peach', color: '#ffb98c', secondaryColor: '#e86864' },
  lime: { sprite: 'lime', color: '#d8ee72', secondaryColor: '#5a981f' },
};

function accent(
  id: string, kind: ProductAccentKind, position: Vector3Tuple, scale: number,
  rotation: Vector3Tuple, phase: number, depth: ProductAccentNode['depth'] = 'mid', blur = 0,
): ProductAccentNode {
  return {
    id, kind, enabled: true, position, rotation, scale, depth, blur,
    color: kind === 'fruit' ? '#ffc15b' : kind === 'leaf' ? '#5e9e29' : '#ffffff',
    ...(kind === 'fruit' ? { sprite: 'orange' as const, secondaryColor: '#ee8627', variants: fruitVariants }
      : kind === 'leaf' ? {
        sprite: 'mint' as const, secondaryColor: '#a1c75b',
        variants: {
          citrus: { sprite: 'citrus-leaf' as const }, berry: { sprite: 'mint' as const },
          peach: { sprite: 'citrus-leaf' as const }, lime: { sprite: 'mint' as const },
        },
      } : {}),
    idle: {
      phase, floatAmplitude: kind === 'droplet' ? 0.006 : 0.008,
      rockAmplitude: kind === 'droplet' ? 0.018 : 0.06,
      periodSeconds: kind === 'droplet' ? 9 + (phase % 6) * 0.5 : 5.4 + phase * 0.45,
    },
  };
}

// Deliberate asymmetry, clear silhouette, varied focus and scale. The central
// product occupies roughly x ±0.19; opaque fruit/leaf/ice slots sit outside it.
const composition: ProductAccentNode[] = [
  accent('fruit-upper-left', 'fruit', [-0.40, 0.25, -0.10], 0.31, [0.18, -0.24, -0.55], 0.3),
  accent('fruit-lower-right', 'fruit', [0.39, -0.27, -0.09], 0.32 * 1.1, [-0.1, 0.22, 0.65], 2.6),
  accent('leaf-left-middle', 'leaf', [-0.32, 0.09, -0.13], 0.17, [0.15, 0.2, 0.45], 1.3),
  accent('leaf-upper-right', 'leaf', [0.34, 0.37, -0.21], 0.14, [0.3, -0.4, -0.65], 3.7),
  accent('leaf-right-middle', 'leaf', [0.33, -0.05, -0.13], 0.19, [0.1, 0.2, -0.3], 4.4),
  accent('leaf-lower-right', 'leaf', [0.27, -0.46, -0.16], 0.11, [-0.3, -0.3, 0.8], 0.8),
  // A small, mostly occluded leaf gives density directly behind the can edge,
  // distinct from the larger left leaf and the blurred outer depth cue.
  accent('leaf-left-peek', 'leaf', [-0.225, -0.02, -0.24], 0.11, [0.12, -0.2, -0.65], 2.9, 'far', 0.4),
  // The legacy ID is stable for saved layouts; even this blurred depth cue now
  // sits behind the product rather than floating in its rotation path.
  accent('leaf-left-near', 'leaf', [-0.46, -0.07, -0.26], 0.12, [0.5, 0.8, -0.55], 5.1, 'near', 5.5),
  { ...accent('ice-lower-left', 'ice', [-0.41, -0.27, -0.11], 0.20, [0.14, 0.16, 0.3], 2.1), assetUrl: '/assets/scene/ice-clear.webp' },
  { ...accent('ice-middle-right', 'ice', [0.44, 0.015, -0.23], 0.11, [0.12, 0.16, 0.7], 4.8, 'far', 0.7), assetUrl: '/assets/scene/ice-clear.webp' },
];

// Fewer, readable water shapes replace the old scatter of tiny points. Retained
// IDs preserve admin bindings and deterministic phases while empty spaces let
// each larger drop read clearly against both warm and green backgrounds.
// Last value selects one of the user's four transparent water photographs.
// Each shape appears three times, with neighboring entries using a different
// shape and size. No flavor tint or substitute water shader is assigned here.
const droplets: Array<[number, number, number, number, number, number]> = [
  [1, -0.34, 0.47, -0.05, 0.088, 1], [2, -0.23, 0.32, -0.28, 0.120 * 1.25, 3],
  [3, -0.41, 0.05, -0.16, 0.062, 2], [5, -0.27, -0.11, -0.14, 0.104, 4],
  [7, -0.34, -0.46, -0.10, 0.080, 2], [9, 0.43, 0.30, -0.10, 0.092, 1],
  [11, 0.29, 0.23, -0.18, 0.075, 4], [13, 0.47, 0.10, -0.35, 0.066 * 1.25, 3],
  [14, 0.30, 0.02, -0.25, 0.064, 1], [16, 0.24, -0.32, -0.15, 0.086, 2],
  [17, 0.42, -0.38, -0.13, 0.100 * 1.25, 3], [20, 0.24, 0.43, -0.32, 0.069, 4],
];

export const DEFAULT_PRODUCT_ACCENT_SCENE: ProductAccentScene = {
  schemaVersion: 1, enabled: true, opacity: 1,
  nodes: [
    ...composition,
    ...droplets.map(([id, x, y, z, size, image]) => ({
      ...accent(`droplet-${String(id).padStart(2, '0')}`, 'droplet', [x, y, z], size,
        [0, 0, (id - 1) * 0.26], (id - 1) * 0.83, z < -0.28 ? 'far' : 'mid', z < -0.28 ? 0.8 : 0),
      assetUrl: `/assets/scene/droplet-clear-${String(image).padStart(2, '0')}.webp`,
    })),
  ],
  motion: { fadeSeconds: 0.18, burstSeconds: 0.95, staggerSeconds: 0.008, origin: [0, 0, -0.2], startScale: 0.35 },
};

/** Resolve flavor data without mutating the saved scene or model assignments. */
export function resolveAccentNodes(scene: ProductAccentScene, flavor: AccentFlavor): ProductAccentNode[] {
  return scene.nodes.map(node => resolveAccentNodeForFlavor(node, flavor));
}

export function resolveAccentNodeForFlavor(node: ProductAccentNode, flavor: AccentFlavor): ProductAccentNode {
  return { ...node, ...node.variants?.[flavor] };
}

const bound = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
const vector = (value: Vector3Tuple | undefined, fallback: Vector3Tuple, min: number, max: number): Vector3Tuple =>
  [0, 1, 2].map(index => bound(value?.[index], fallback[index], min, max)) as Vector3Tuple;
const phase = (value: number | undefined) => {
  const radians = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (radians % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
};
const validColor = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
const sanitizeVariant = (value: Partial<ProductAccentVariant>): Partial<ProductAccentVariant> => {
  const result = { ...value };
  if (value.assetUrl !== undefined) result.assetUrl = assetUrl(value.assetUrl);
  if (value.sprite !== undefined && !['orange','lime','berry','peach','mint','citrus-leaf'].includes(value.sprite)) result.sprite = undefined;
  if (value.color !== undefined) result.color = validColor(value.color) ?? '#ffffff';
  if (value.secondaryColor !== undefined) result.secondaryColor = validColor(value.secondaryColor);
  if (value.tint !== undefined) result.tint = validColor(value.tint);
  return result;
};

/** Sanitize numeric admin controls at the boundary. Asset URLs stay data; loading
 * and ownership/licensing are separate responsibilities of the asset pipeline. */
export type ProductAccentSceneInput = Omit<Partial<ProductAccentScene>, 'motion'> & { motion?: Partial<ProductAccentMotion> };

export function normalizeAccentScene(input: ProductAccentSceneInput = {}): ProductAccentScene {
  const defaults = DEFAULT_PRODUCT_ACCENT_SCENE;
  const motion = input.motion;
  const seen = new Set<string>();
  const nodes = (input.nodes ?? defaults.nodes).slice(0, 48).filter(node => {
    if (!node.id || seen.has(node.id)) return false;
    seen.add(node.id);
    return ['fruit', 'leaf', 'ice', 'droplet'].includes(node.kind);
  }).map(node => ({
    ...node,
    ...sanitizeVariant(node),
    variants: node.variants ? Object.fromEntries(Object.entries(node.variants).filter(([key]) => ['citrus','berry','peach','lime'].includes(key)).map(([key, value]) => [key, sanitizeVariant(value)])) : undefined,
    enabled: node.enabled !== false,
    position: vector(node.position, [0, 0, -0.15], -1.5, 1.5),
    rotation: vector(node.rotation, [0, 0, 0], -Math.PI * 4, Math.PI * 4),
    scale: bound(node.scale, 0.1, 0.002, 0.5),
    blur: bound(node.blur, 0, 0, 12),
    idle: {
      phase: phase(node.idle?.phase),
      floatAmplitude: bound(node.idle?.floatAmplitude, 0.008, 0, 0.05),
      rockAmplitude: bound(node.idle?.rockAmplitude, 0.06, 0, 0.3),
      periodSeconds: bound(node.idle?.periodSeconds, 6, 2, 20),
    },
  }));
  return {
    schemaVersion: 1, enabled: input.enabled !== false, opacity: bound(input.opacity, defaults.opacity, 0, 1), nodes,
    motion: {
      fadeSeconds: bound(motion?.fadeSeconds, defaults.motion.fadeSeconds, 0.05, 1),
      burstSeconds: bound(motion?.burstSeconds, defaults.motion.burstSeconds, 0.2, 3),
      staggerSeconds: bound(motion?.staggerSeconds, defaults.motion.staggerSeconds, 0, 0.03),
      origin: vector(motion?.origin, defaults.motion.origin, -0.3, 0.3),
      startScale: bound(motion?.startScale, defaults.motion.startScale, 0.01, 1),
    },
  };
}
