'use client';

import { useEffect, useState } from 'react';
import type { BackgroundConfig, BackgroundTheme } from '@/lib/background-config';
import { backgroundTileUrl } from '@/lib/background-render-state';
import { loadBackgroundTile } from '@/lib/background-image-tile';

export default function BackgroundPattern({ theme, config, opacity = 1, className = '', style }: {
  theme: BackgroundTheme; config: BackgroundConfig; opacity?: number; className?: string; style?: React.CSSProperties;
}) {
  const key = JSON.stringify([theme.iconUrl, theme.icon, config]);
  const [tile, setTile] = useState<{ key: string; url: string }>();
  useEffect(() => {
    if (!theme.iconUrl) return;
    let current = true;
    void loadBackgroundTile(theme, config).then(url => { if (current) setTile({ key, url }); });
    return () => { current = false; };
  }, [key, theme, config]);
  const period = config.cellSize * config.iconSpacing;
  const url = tile?.key === key ? tile.url : backgroundTileUrl(theme.icon, config);
  return <div className={className} style={{ ...style, backgroundImage: `url("${url}")`, backgroundSize: `${period}px ${period}px`, opacity }} />;
}
