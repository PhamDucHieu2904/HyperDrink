import { showcaseFlavors } from './showcase-flavors';
/** JSON-serializable contract for a future admin/API. Units: CSS px, seconds;
 * product glow dimensions are multiples of the product container's size. */
export type FruitIcon = 'citrus' | 'berry' | 'peach' | 'lime';
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
  productGlowOpacity: .82, productGlowWidth: 1.45, productGlowHeight: 1.35,
};
export const backgroundThemes: { color: string; icon: FruitIcon }[] = showcaseFlavors.map(flavor => ({ color: flavor.background, icon: flavor.id }));
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
