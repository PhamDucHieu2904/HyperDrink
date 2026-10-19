import { backgroundConfig } from './background-config';
import { backgroundTileUrl } from './background-render-state';
import { loadBackgroundTile } from './background-image-tile';

export const contactBackgroundConfig = {
  ...backgroundConfig,
  cellSize: 88,
  iconSize: 38,
  lineOpacity: .17,
  iconOpacity: .52,
};
export const contactPatternPeriod = contactBackgroundConfig.cellSize * contactBackgroundConfig.iconSpacing;

/** Share the hero's artwork, with a green stroke that remains visible on pale flavors. */
export function contactPatternUrl(icon: string) {
  const source = backgroundTileUrl(icon, contactBackgroundConfig);
  const svg = decodeURIComponent(source.slice(source.indexOf(',') + 1)).replaceAll('stroke="white"', 'stroke="#2b6353"');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Reuse uploaded flavor artwork too; tint its alpha instead of replacing it with a generic leaf. */
export async function loadContactPattern(icon: string, iconUrl: string) {
  try {
    const source = await loadBackgroundTile({ icon, iconUrl, color: '#ffffff' }, contactBackgroundConfig);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = reject; image.src = source;
    });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 528;
    const context = canvas.getContext('2d');
    if (!context) return contactPatternUrl(icon);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = '#2b6353'; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return contactPatternUrl(icon);
  }
}
