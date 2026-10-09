import type { ProductAccentScene } from '@/lib/viewer/accent-config';

export const HOMEPAGE_ACCENT_KINDS = ['splash', 'droplet', 'leaf', 'fruit', 'ice'] as const;
export type HomepageLayout = Record<typeof HOMEPAGE_ACCENT_KINDS[number], boolean>;
export const DEFAULT_HOMEPAGE_LAYOUT: Readonly<HomepageLayout> = { splash: true, droplet: true, leaf: true, fruit: true, ice: true };

export function isHomepageLayout(value: unknown): value is HomepageLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === HOMEPAGE_ACCENT_KINDS.length && HOMEPAGE_ACCENT_KINDS.every(key => typeof record[key] === 'boolean');
}
export function resolveHomepageLayout(value?: HomepageLayout): HomepageLayout {
  return { ...DEFAULT_HOMEPAGE_LAYOUT, ...value };
}
/** URL-only previews work across admin/storefront origins without changing publication. */
export function encodeHomepageLayout(value: HomepageLayout): string {
  return HOMEPAGE_ACCENT_KINDS.map(key => value[key] ? '1' : '0').join('');
}
export function decodeHomepageLayout(value: string | null): HomepageLayout | undefined {
  if (!value || !/^[01]{5}$/.test(value)) return undefined;
  return Object.fromEntries(HOMEPAGE_ACCENT_KINDS.map((key, index) => [key, value[index] === '1'])) as HomepageLayout;
}
/** Remove nodes before creating textures, meshes, motion or optical passes. */
export function filterHomepageAccents(scene: ProductAccentScene, layout: HomepageLayout): ProductAccentScene {
  const nodes = scene.nodes.filter(node => node.enabled && layout[node.kind]);
  return { ...scene, enabled: scene.enabled && nodes.length > 0, nodes };
}
