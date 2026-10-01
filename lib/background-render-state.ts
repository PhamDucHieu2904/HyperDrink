import type { BackgroundConfig, FruitIcon } from './background-config';

// Controlled SVG artwork for the decorative background tiles.
const icons: Record<FruitIcon, string> = {
  citrus: '<circle cx="24" cy="25" r="17"/><circle cx="24" cy="25" r="12"/><path d="M24 13v24M12 25h24M15.5 16.5l17 17M15.5 33.5l17-17M24 8c2-5 7-6 11-4-1 5-5 7-11 4Z"/>',
  lime: '<path d="M6 20a19 19 0 0 0 36 0ZM11 23a14 14 0 0 0 26 0M24 21v15M24 21l-10 9M24 21l10 9M24 17c0-8 5-12 13-11-1 8-6 11-13 11Z"/>',
  berry: '<path d="M24 15c-8-8-20-2-17 9 2 10 12 18 17 19 5-1 15-9 17-19 3-11-9-17-17-9ZM24 15l-8-9 9 3 7-5-2 9 7 3-13 2ZM15 23l1 2M25 24l1 2M33 23l-1 2M20 32l1 2M28 33l-1 2"/>',
  peach: '<path d="M24 15C12 8 4 17 7 29c2 10 11 15 17 11 6 4 15-1 17-11 3-12-5-21-17-14ZM24 15c-6 8-4 18 0 25M24 14c-1-7 5-12 14-10-2 8-7 11-14 10ZM24 14l-4-7"/>',
};

export function backgroundTileUrl(icon: FruitIcon, config: BackgroundConfig) {
  const size = config.cellSize * config.iconSpacing;
  const lines = Array.from({ length: config.iconSpacing }, (_, i) => {
    const p = i * config.cellSize;
    return `<path d="M${p} 0V${size}M0 ${p}H${size}"/>`;
  }).join('');
  const offset = (config.cellSize - config.iconSize) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="white" stroke-width="1" opacity="${config.lineOpacity}">${lines}</g><g transform="translate(${offset} ${offset}) scale(${config.iconSize / 48})" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${config.iconOpacity}">${icons[icon]}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Background theme transitions without React frame updates. */
export class BackgroundRenderState {
  readonly weights = [1, 0, 0, 0];
  readonly fromWeights = [1, 0, 0, 0];
  /** Same CSS-pixel translation consumed by decorative DOM and water refraction. */
  readonly patternOffset = { x: 0, y: 0 };
  flavorIndex = 0;
  transitionAt = -Infinity;
  wake: (() => void) | undefined;

  setWake(callback: (() => void) | undefined) { this.wake = callback; }

  setPatternOffset(x: number, y: number) {
    this.patternOffset.x = x;
    this.patternOffset.y = y;
  }

  setFlavor(index: number, now: number, reducedMotion: boolean) {
    if (index === this.flavorIndex) return;
    this.advance(now, reducedMotion);
    this.fromWeights.splice(0, 4, ...this.weights);
    this.flavorIndex = index;
    this.transitionAt = now;
    this.advance(now, reducedMotion);
    this.wake?.();
  }

  advance(now: number, reducedMotion: boolean) {
    const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - this.transitionAt) / 900));
    const eased = progress * progress * (3 - 2 * progress);
    for (let i = 0; i < 4; i++) this.weights[i] = this.fromWeights[i] + ((i === this.flavorIndex ? 1 : 0) - this.fromWeights[i]) * eased;
  }
}
