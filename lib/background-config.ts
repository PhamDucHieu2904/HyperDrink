import { showcaseFlavors } from './showcase-flavors';
/** JSON-serializable contract for a future admin/API. Units: CSS px, seconds;
 * product glow dimensions are multiples of the product container's size. */
export const backgroundIconNames = ['citrus', 'berry', 'peach', 'lime', 'leaf', 'mango', 'pineapple', 'apple', 'grape', 'coconut'] as const;
export type FruitIcon = typeof backgroundIconNames[number];
/** A stable item ID keeps transitions aligned when catalog items are reordered. */
export interface BackgroundTheme { id?: string; color: string; icon: string; iconUrl?: string }
export interface BackgroundConfig {
  version: 1;
  cellSize: number;
  iconSize: number;
  iconSpacing: number;
  lineOpacity: number;
  iconOpacity: number;
  /** Constant travel speed in px/s; legacy field name retained for saved configurations. */
  maxSpeed: number;
  dampingSeconds: number;
  /** Random steering whenever no mouse pointer is controlling the hero. */
  autoDriftEnabled: boolean;
  autoDirectionMinSeconds: number;
  autoDirectionMaxSeconds: number;
  /** Legacy field retained for compatibility; distance no longer gates pointer movement. */
  deadZone: number;
  enabled: boolean;
  productGlowOpacity: number;
  productGlowWidth: number;
  productGlowHeight: number;
}
export const backgroundConfig: BackgroundConfig = {
  version: 1, cellSize: 88, iconSize: 38, iconSpacing: 3,
  lineOpacity: .24, iconOpacity: .65,
  maxSpeed: 26.4, dampingSeconds: 1.3, deadZone: .08, enabled: true,
  autoDriftEnabled: true, autoDirectionMinSeconds: 2, autoDirectionMaxSeconds: 6,
  productGlowOpacity: .96, productGlowWidth: 1.45, productGlowHeight: 1.35,
};
export const backgroundThemes: BackgroundTheme[] = showcaseFlavors.map(flavor => ({ id: flavor.id, color: flavor.background, icon: flavor.id }));
export function normalizeBackgroundIcon(input: string): FruitIcon {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return backgroundIconNames.includes(value as FruitIcon) ? value as FruitIcon : 'leaf';
}
export function normalizeBackgroundThemes(input: readonly BackgroundTheme[] = backgroundThemes): BackgroundTheme[] {
  const source = input.length ? input : [{ id: 'empty', color: '#54684f', icon: 'leaf' }];
  const ids = new Set<string>();
  return source.map((theme, index) => {
    const originalId = typeof theme.id === 'string' && theme.id ? theme.id : `theme-${index}`;
    let id = originalId, suffix = 1;
    while (ids.has(id)) id = `${originalId}-${suffix++}`;
    ids.add(id);
    let iconUrl: string | undefined;
    if (typeof theme.iconUrl === 'string' && /^(?:\/[^/]|https?:\/\/)/i.test(theme.iconUrl) && !/[\\\u0000-\u0020]/.test(theme.iconUrl)) {
      try {
        const url = new URL(theme.iconUrl, 'https://background.invalid');
        if (!url.username && !url.password) iconUrl = theme.iconUrl;
      } catch { /* Malformed URLs fall back to the built-in symbol. */ }
    }
    return { id, color: /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(theme.color) ? theme.color : '#54684f', icon: normalizeBackgroundIcon(theme.icon), ...(iconUrl ? { iconUrl } : {}) };
  });
}
export function normalizeBackgroundConfig(input: Partial<BackgroundConfig>): BackgroundConfig {
  const bounded = (key: keyof BackgroundConfig, min: number, max: number) => {
    const value = input[key];
    return Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : backgroundConfig[key] as number));
  };
  const cellSize = bounded('cellSize', 48, 180);
  const autoDirectionMinSeconds = bounded('autoDirectionMinSeconds', .5, 30);
  return {
    version: 1, cellSize, iconSize: Math.min(cellSize * .7, bounded('iconSize', 16, 100)),
    iconSpacing: Math.round(bounded('iconSpacing', 3, 8)),
    lineOpacity: bounded('lineOpacity', 0, 1), iconOpacity: bounded('iconOpacity', 0, 1),
    maxSpeed: bounded('maxSpeed', 0, 80), dampingSeconds: bounded('dampingSeconds', .1, 5),
    autoDriftEnabled: typeof input.autoDriftEnabled === 'boolean' ? input.autoDriftEnabled : backgroundConfig.autoDriftEnabled,
    autoDirectionMinSeconds,
    autoDirectionMaxSeconds: Math.max(autoDirectionMinSeconds, bounded('autoDirectionMaxSeconds', .5, 30)),
    deadZone: bounded('deadZone', 0, .4), enabled: typeof input.enabled === 'boolean' ? input.enabled : backgroundConfig.enabled,
    productGlowOpacity: bounded('productGlowOpacity', 0, 1),
    productGlowWidth: bounded('productGlowWidth', .5, 2),
    productGlowHeight: bounded('productGlowHeight', .5, 2),
  };
}
