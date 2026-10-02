'use client';

import Image from 'next/image';
import { Leaf } from 'lucide-react';
import { useState } from 'react';
import type { MediaAsset } from '@/lib/catalog/contracts';
import { mediaUrl } from '@/lib/catalog/resolve';

export default function CatalogImage({ media, alt = '', className, size = 88, priority = false }: { media?: MediaAsset; alt?: string; className?: string; size?: number; priority?: boolean }) {
  const [failedUrl, setFailedUrl] = useState('');
  const url = media ? mediaUrl(media) : '';
  return media?.status === 'ready' && media.lifecycle === 'active' && url && url !== failedUrl ? <Image className={className} src={url} width={size} height={size} alt={alt} unoptimized priority={priority} sizes={`${size}px`} onError={() => setFailedUrl(url)} /> : <span className={`catalog-image-placeholder ${className ?? ''}`} role={alt ? 'img' : undefined} aria-hidden={!alt || undefined} aria-label={alt || undefined}><Leaf size={Math.min(size / 2, 58)} strokeWidth={1.3} /></span>;
}
