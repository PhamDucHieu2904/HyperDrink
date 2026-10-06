import type { ProductGroup } from './contracts';

export const HERO_PRODUCT_DEFAULTS = {
  heroVolumeCaption: 'Net content',
  heroFlavorText: 'Many flavor choices',
  heroOriginText: 'Real fruit from Vietnam',
} as const;

/** Legacy releases and cleared fields use the same defaults as the admin form. */
export function heroProductMessages(group: ProductGroup) {
  return Object.fromEntries(Object.entries(HERO_PRODUCT_DEFAULTS).map(([key, fallback]) => [
    key, group[key as keyof typeof HERO_PRODUCT_DEFAULTS]?.trim() || fallback,
  ])) as Record<keyof typeof HERO_PRODUCT_DEFAULTS, string>;
}
