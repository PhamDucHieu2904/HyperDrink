'use client';

import dynamic from 'next/dynamic';
import { Box } from 'lucide-react';
import type { CatalogData, Model3D } from '@/lib/catalog/contracts';
import { mediaUrl } from '@/lib/catalog/resolve';
import type { ProductAsset } from '@/lib/viewer-config';
import styles from '@/app/admin/admin.module.css';

const ProductViewer = dynamic(() => import('@/components/ProductViewer'), { ssr: false });

export default function ModelPreview({ model, data }: { model: Model3D; data: CatalogData }) {
  const file = data.media.find(item => item.id === model.mediaId);
  const packaging = data.packagingVariants.find(item => item.id === model.packagingVariantId);
  const category = data.packagingCategories.find(item => item.id === packaging?.categoryId);
  const poster = data.media.find(item => item.id === model.posterId);
  const kind = category?.viewerKind ?? 'other';
  const asset: ProductAsset | null = file?.status === 'ready' ? {
    id: model.id,
    name: model.name || 'Model mới',
    src: mediaUrl(file),
    packaging: kind === 'pp' ? 'other' : kind,
    volumeMl: packaging?.volumeMl ?? undefined,
    poster: poster ? mediaUrl(poster) : undefined,
    materialSlots: model.materialSlots,
    orientation: model.orientation,
  } : null;
  return <section className={styles.modelPreviewSection} aria-label="Xem trước mô hình bao bì"><div className={styles.modelPreviewHeading}><strong><Box size={17} /> Xem trước geometry</strong><span>Kéo để xoay · Material gốc</span></div><div className={styles.modelPreview}>{asset ? <ProductViewer asset={asset} /> : <div className={styles.emptyState}><Box size={32} /><p>Chọn GLB sẵn sàng để kiểm tra hình dáng và orientation.</p></div>}</div></section>;
}
