import * as THREE from 'three';
import type { BackgroundConfig } from '../background-config';
import { backgroundTileUrl, type BackgroundRenderState } from '../background-render-state';
import { loadBackgroundTile } from '../background-image-tile';

export interface ProductBackdropTexture {
  /** Viewer-sized crop; bottom-left shader UVs correspond to the WebGL canvas. */
  texture: THREE.CanvasTexture;
  update(): void;
  dispose(): void;
}

export interface ProductViewerBackdropInput {
  state: BackgroundRenderState;
  config: BackgroundConfig;
}

interface Area { x: number; y: number; width: number; height: number }
interface Layout { hero: Area; crop: Area; glow?: Area }

/** Paint a radial CSS ellipse in hero coordinates. The default farthest-corner
 * sizing expands its farthest-side ellipse by √2. Stops use premultiplied white. */
function whiteEllipse(
  context: CanvasRenderingContext2D, area: Area, centerX: number, centerY: number,
  stops: readonly (readonly [number, number])[],
) {
  const rx = Math.max(centerX - area.x, area.x + area.width - centerX) * Math.SQRT2;
  const ry = Math.max(centerY - area.y, area.y + area.height - centerY) * Math.SQRT2;
  if (rx <= 0 || ry <= 0) return;
  context.save();
  context.translate(centerX, centerY);
  context.scale(rx, ry);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [position, alpha] of stops) gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
  context.fillStyle = gradient;
  context.fillRect((area.x - centerX) / rx, (area.y - centerY) / ry, area.width / rx, area.height / ry);
  context.restore();
}

/** Reconstruct only the authored decorative hero backdrop, never screen-capture
 * page content. No RAF or per-frame layout reads; the owning viewer calls update. */
export function createBackdropTexture(
  state: BackgroundRenderState, config: BackgroundConfig, mount: HTMLDivElement,
): ProductBackdropTexture {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Backdrop canvas is unavailable.');
  const makeTexture = () => {
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    value.generateMipmaps = false;
    value.minFilter = THREE.LinearFilter;
    value.magFilter = THREE.LinearFilter;
    return value;
  };
  let texture = makeTexture();

  // Crop the live hero background into the water decorations' surface.
  const hero = mount.closest<HTMLElement>('.showcase-hero');
  const light = hero?.querySelector<HTMLElement>('.product-backlight');
  const tileSize = config.cellSize * config.iconSpacing;
  let layout: Layout = { hero: { x: 0, y: 0, width: 1, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 } };
  let disposed = false, dirty = true, resized = true, lastPaint = -Infinity, signature = '';
  let themeRevision = -1;
  let tileImages: HTMLImageElement[] = [];
  let tilePatterns: (CanvasPattern | null)[] = [];
  const syncThemes = () => {
    if (themeRevision === state.themeRevision) return;
    tileImages.forEach(image => { image.onload = null; image.src = ''; });
    const revision = state.themeRevision;
    tileImages = state.themes.map((theme, index) => {
      const image = new Image();
      image.onload = () => { if (!disposed) { tilePatterns[index] = null; dirty = true; } };
      image.src = backgroundTileUrl(theme.icon, config);
      if (theme.iconUrl) void loadBackgroundTile(theme, config).then(url => {
        if (disposed || state.themeRevision !== revision || tileImages[index] !== image) return;
        tilePatterns[index] = null;
        image.src = url;
      });
      return image;
    });
    tilePatterns = tileImages.map(() => null);
    themeRevision = state.themeRevision;
    dirty = true;
  };
  syncThemes();

  const measure = () => {
    if (disposed) return;
    const bounds = mount.getBoundingClientRect();
    const backdrop = hero?.getBoundingClientRect() ?? bounds;
    const glow = light?.getBoundingClientRect();
    layout = {
      hero: { x: 0, y: 0, width: Math.max(1, backdrop.width), height: Math.max(1, backdrop.height) },
      crop: { x: bounds.left - backdrop.left, y: bounds.top - backdrop.top, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
      glow: glow && { x: glow.left - backdrop.left, y: glow.top - backdrop.top, width: glow.width, height: glow.height },
    };
    const maximum = matchMedia('(max-width: 760px)').matches ? 512 : 768;
    const factor = maximum / Math.max(layout.crop.width, layout.crop.height);
    const width = Math.max(1, Math.round(layout.crop.width * Math.min(1, factor)));
    const height = Math.max(1, Math.round(layout.crop.height * Math.min(1, factor)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      // GPU texture storage has immutable dimensions after its first upload.
      // A fresh texture prevents a stale crop/color payload after orientation changes.
      texture.dispose(); texture = makeTexture();
    }
    dirty = true; resized = true;
  };
  const observer = new ResizeObserver(measure);
  observer.observe(mount);
  if (hero) observer.observe(hero);
  if (light) observer.observe(light);
  measure();

  const update = () => {
    if (disposed) return;
    syncThemes();
    const now = performance.now();
    // Resizing clears the canvas immediately. Repaint before the next water pass,
    // even if that one resize frame falls inside the normal upload interval.
    if (!resized && now - lastPaint < 1000 / 30) return;
    const { x, y } = state.patternOffset;
    const nextSignature = `${themeRevision}:${state.weights.join(',')}:${hero ? `${x},${y}` : ''}`;
    if (!dirty && nextSignature === signature) return;
    const { crop, hero: area, glow } = layout;
    const scaleX = canvas.width / crop.width, scaleY = canvas.height / crop.height;
    context.setTransform(scaleX, 0, 0, scaleY, -crop.x * scaleX, -crop.y * scaleY);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.fillStyle = state.themes[0].color;
    context.fillRect(crop.x, crop.y, crop.width, crop.height);
    // The DOM stacks layers in this exact order; reproduce their alpha compositing.
    state.themes.forEach((theme, index) => {
      context.globalAlpha = state.weights[index] ?? 0;
      context.fillStyle = theme.color;
      context.fillRect(crop.x, crop.y, crop.width, crop.height);
    });
    if (hero) {
      tileImages.forEach((image, index) => {
        if (!image.complete || !image.naturalWidth || state.weights[index] <= 0) return;
        const pattern = tilePatterns[index] ??= context.createPattern(image, 'repeat');
        if (!pattern) return;
        // .flavor-background-track begins at -tileSize; one period is equivalent
        // to zero, so its live translation is the tile's exact CSS origin.
        const patternTransform = new DOMMatrix().translate(x, y).scale(tileSize / image.naturalWidth, tileSize / image.naturalHeight);
        pattern.setTransform(patternTransform);
        context.fillStyle = pattern;
        context.globalAlpha = state.weights[index];
        context.fillRect(crop.x, crop.y, crop.width, crop.height);
      });
      context.globalAlpha = 1;
      whiteEllipse(context, area, area.width * .58, area.height * .35, [[0, 13 / 255], [.64, 0], [1, 0]]);
      if (glow && config.productGlowOpacity > 0) {
        context.globalCompositeOperation = 'overlay';
        context.globalAlpha = config.productGlowOpacity;
        whiteEllipse(context, glow, glow.x + glow.width / 2, glow.y + glow.height / 2, [[0, 1], [.29, .88], [.55, .36], [.75, 0], [1, 0]]);
      }
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    texture.needsUpdate = true;
    dirty = false; resized = false; signature = nextSignature; lastPaint = now;
  };
  update();

  return {
    get texture() { return texture; }, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      tileImages.forEach(image => { image.onload = null; image.src = ''; });
      texture.dispose();
    },
  };
}
