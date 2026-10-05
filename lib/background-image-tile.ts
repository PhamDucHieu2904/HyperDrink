import type { BackgroundConfig, BackgroundTheme } from './background-config';
import { backgroundTileUrl } from './background-render-state';

/** Contain the complete image in the centered symbol slot without stretching or cropping. */
export function backgroundIconRect(width: number, height: number, cellSize: number, iconSize: number) {
  const scale = iconSize / Math.max(width, height);
  const w = width * scale, h = height * scale;
  return { x: (cellSize - w) / 2, y: (cellSize - h) / 2, width: w, height: h };
}

const tiles = new Map<string, Promise<string>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(url) && new URL(url).origin !== window.location.origin) {
      const api = process.env.NEXT_PUBLIC_ADMIN_API_URL;
      image.crossOrigin = api && new URL(api).origin === new URL(url).origin ? 'use-credentials' : 'anonymous';
    }
    const clear = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
    const timer = setTimeout(() => { clear(); image.src = ''; reject(new Error('Background icon timed out.')); }, 15000);
    image.onload = () => { clear(); resolve(image); };
    image.onerror = () => { clear(); reject(new Error('Cannot load background icon.')); };
    image.src = url;
  });
}

/** DOM decoration and water refraction consume the same self-contained raster tile. */
export function loadBackgroundTile(theme: BackgroundTheme, config: BackgroundConfig): Promise<string> {
  if (!theme.iconUrl) return Promise.resolve(backgroundTileUrl(theme.icon, config));
  const key = JSON.stringify([theme.iconUrl, theme.icon, config.cellSize, config.iconSpacing, config.iconSize, config.lineOpacity, config.iconOpacity]);
  const existing = tiles.get(key);
  if (existing) return existing;
  const pending = Promise.all([loadImage(backgroundTileUrl(theme.icon, config, false)), loadImage(theme.iconUrl)]).then(([grid, icon]) => {
    const period = config.cellSize * config.iconSpacing;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(2048, Math.ceil(period * 2));
    const context = canvas.getContext('2d');
    if (!context || !icon.naturalWidth || !icon.naturalHeight) throw new Error('Cannot draw background icon.');
    context.scale(canvas.width / period, canvas.height / period);
    context.drawImage(grid, 0, 0, period, period);
    const rect = backgroundIconRect(icon.naturalWidth, icon.naturalHeight, config.cellSize, config.iconSize);
    context.globalAlpha = config.iconOpacity;
    context.drawImage(icon, rect.x, rect.y, rect.width, rect.height);
    return canvas.toDataURL('image/png');
  }).catch(() => { tiles.delete(key); return backgroundTileUrl(theme.icon, config); });
  if (tiles.size >= 64) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, pending);
  return pending;
}
