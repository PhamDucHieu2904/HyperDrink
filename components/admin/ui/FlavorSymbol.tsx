'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { CatalogData, Flavor } from '@/lib/catalog/contracts';
import { mediaUrl, resolveFlavorIcon } from '@/lib/catalog/resolve';
import { backgroundIconUrl } from '@/lib/background-render-state';

export default function FlavorSymbol({ data, flavor, color }: { data: CatalogData; flavor: Pick<Flavor, 'icon' | 'iconId'>; color?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const media = resolveFlavorIcon(data, flavor);
  const customUrl = media ? mediaUrl(media) : '';
  return <Image src={customUrl && customUrl !== failedUrl ? customUrl : backgroundIconUrl(flavor.icon, color)} alt="" width={36} height={36} unoptimized style={{ width: 36, height: 36, objectFit: 'contain' }} onError={() => setFailedUrl(customUrl)} />;
}
