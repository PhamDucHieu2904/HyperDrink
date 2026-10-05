import { normalizeBackgroundConfig, normalizeBackgroundIcon, normalizeBackgroundThemes, type BackgroundConfig, type BackgroundTheme, type FruitIcon } from './background-config';

// Controlled SVG artwork for the decorative background tiles.
const icons: Record<FruitIcon, string> = {
  citrus: '<circle cx="24" cy="25" r="17"/><circle cx="24" cy="25" r="12"/><path d="M24 13v24M12 25h24M15.5 16.5l17 17M15.5 33.5l17-17M24 8c2-5 7-6 11-4-1 5-5 7-11 4Z"/>',
  lime: '<path d="M6 20a19 19 0 0 0 36 0ZM11 23a14 14 0 0 0 26 0M24 21v15M24 21l-10 9M24 21l10 9M24 17c0-8 5-12 13-11-1 8-6 11-13 11Z"/>',
  berry: '<path d="M24 15c-8-8-20-2-17 9 2 10 12 18 17 19 5-1 15-9 17-19 3-11-9-17-17-9ZM24 15l-8-9 9 3 7-5-2 9 7 3-13 2ZM15 23l1 2M25 24l1 2M33 23l-1 2M20 32l1 2M28 33l-1 2"/>',
  peach: '<path d="M24 15C12 8 4 17 7 29c2 10 11 15 17 11 6 4 15-1 17-11 3-12-5-21-17-14ZM24 15c-6 8-4 18 0 25M24 14c-1-7 5-12 14-10-2 8-7 11-14 10ZM24 14l-4-7"/>',
  leaf: '<path d="M10 39C2 20 15 6 40 7c1 23-9 35-25 30M9 41 34 14M17 32l-2-10M24 25l11 1"/>',
  mango: '<path d="M33 11C13 3 3 20 10 34c5 13 21 10 28-2 6-11 4-17-5-21ZM16 33c-5-8-2-16 7-18M30 10c1-5 5-8 11-7"/>',
  pineapple: '<path d="m24 14-7-9 2 11-11-5 6 10M24 14l7-9-2 11 11-5-6 10M15 18c-10 14-6 26 9 26s19-12 9-26ZM12 25l20 14M16 20l22 15M10 34l22-15M14 41l22-15"/>',
  apple: '<path d="M24 14c-12-8-22 0-19 13 3 14 11 18 19 14 8 4 16 0 19-14 3-13-7-21-19-13ZM24 14c-1-7 1-10 5-12M25 9c5-6 10-5 14-2-4 5-9 6-14 2Z"/>',
  grape: '<circle cx="16" cy="19" r="6"/><circle cx="29" cy="19" r="6"/><circle cx="10" cy="30" r="6"/><circle cx="23" cy="30" r="6"/><circle cx="36" cy="30" r="6"/><circle cx="23" cy="41" r="6"/><path d="M23 13V4m0 5c4-8 12-6 16-4-4 6-10 7-16 4Z"/>',
  coconut: '<circle cx="24" cy="25" r="18"/><path d="M9 17c8 5 22 5 30 0M11 34c7-5 19-5 26 0M17 9l-3 32M31 9l3 32"/><circle cx="21" cy="23" r="1"/><circle cx="27" cy="23" r="1"/><circle cx="24" cy="28" r="1"/>',
};

export function backgroundIconUrl(icon: string, color = '#ffffff') {
  const stroke = /^#[\da-f]{6}$/i.test(color) ? color : '#ffffff';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[normalizeBackgroundIcon(icon)]}</svg>`)}`;
}

export function backgroundTileUrl(icon: string, config: BackgroundConfig, includeIcon = true) {
  const size = config.cellSize * config.iconSpacing;
  const lines = Array.from({ length: config.iconSpacing }, (_, i) => {
    const p = i * config.cellSize;
    return `<path d="M${p} 0V${size}M0 ${p}H${size}"/>`;
  }).join('');
  const offset = (config.cellSize - config.iconSize) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="none" stroke="white" stroke-width="1" opacity="${config.lineOpacity}">${lines}</g><g transform="translate(${offset} ${offset}) scale(${config.iconSize / 48})" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${config.iconOpacity}">${includeIcon ? icons[normalizeBackgroundIcon(icon)] : ''}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Background theme transitions without React frame updates. */
export class BackgroundRenderState {
  readonly config: BackgroundConfig;
  readonly weights: number[];
  readonly fromWeights: number[];
  private currentThemes: BackgroundTheme[];
  /** Invalidation signal for cached decorative/refraction textures. */
  themeRevision = 0;
  /** Same CSS-pixel translation consumed by decorative DOM and water refraction. */
  readonly patternOffset = { x: 0, y: 0 };
  flavorIndex = 0;
  transitionAt = -Infinity;
  wake: (() => void) | undefined;

  constructor(config: Partial<BackgroundConfig> = {}, themes?: readonly BackgroundTheme[]) {
    this.config = normalizeBackgroundConfig(config);
    this.currentThemes = normalizeBackgroundThemes(themes);
    this.weights = this.currentThemes.map((_, index) => index === 0 ? 1 : 0);
    this.fromWeights = [...this.weights];
  }

  get themes(): readonly BackgroundTheme[] { return this.currentThemes; }

  setThemes(themes?: readonly BackgroundTheme[], now = 0, reducedMotion = false) {
    const next = normalizeBackgroundThemes(themes);
    if (next.length === this.currentThemes.length && next.every((theme, index) => {
      const previous = this.currentThemes[index];
      return theme.id === previous.id && theme.color === previous.color && theme.icon === previous.icon && theme.iconUrl === previous.iconUrl;
    })) return;
    this.advance(now, reducedMotion);
    const selectedId = this.currentThemes[this.flavorIndex]?.id;
    const priorWeights = new Map(this.currentThemes.map((theme, index) => [theme.id, this.weights[index]]));
    const selectedIndex = next.findIndex(theme => theme.id === selectedId);
    this.flavorIndex = selectedIndex < 0 ? Math.min(this.flavorIndex, next.length - 1) : selectedIndex;
    const weights = next.map(theme => priorWeights.get(theme.id) ?? 0), total = weights.reduce((sum, weight) => sum + weight, 0);
    const normalized = weights.map((weight, index) => total > 0 ? weight / total : index === this.flavorIndex ? 1 : 0);
    this.currentThemes = next;
    this.weights.splice(0, this.weights.length, ...normalized);
    this.fromWeights.splice(0, this.fromWeights.length, ...normalized);
    this.transitionAt = now;
    this.themeRevision += 1;
    this.advance(now, reducedMotion);
    this.wake?.();
  }

  setWake(callback: (() => void) | undefined) { this.wake = callback; }

  setPatternOffset(x: number, y: number) {
    this.patternOffset.x = x;
    this.patternOffset.y = y;
  }

  setFlavor(index: number, now: number, reducedMotion: boolean) {
    const nextIndex = Number.isFinite(index) ? Math.max(0, Math.min(this.currentThemes.length - 1, Math.trunc(index))) : 0;
    this.advance(now, reducedMotion);
    if (nextIndex === this.flavorIndex) return;
    this.fromWeights.splice(0, this.fromWeights.length, ...this.weights);
    this.flavorIndex = nextIndex;
    this.transitionAt = now;
    this.advance(now, reducedMotion);
    this.wake?.();
  }

  advance(now: number, reducedMotion: boolean) {
    const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - this.transitionAt) / 900));
    const eased = progress * progress * (3 - 2 * progress);
    for (let i = 0; i < this.currentThemes.length; i++) this.weights[i] = this.fromWeights[i] + ((i === this.flavorIndex ? 1 : 0) - this.fromWeights[i]) * eased;
    if (progress === 1 && this.transitionAt !== -Infinity) {
      // A snapped startup/reduced-motion transition must stay settled on later animation frames.
      this.fromWeights.splice(0, this.fromWeights.length, ...this.weights);
      this.transitionAt = -Infinity;
    }
  }
}
