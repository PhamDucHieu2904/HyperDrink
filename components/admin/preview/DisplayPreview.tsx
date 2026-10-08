'use client';
/* eslint-disable @next/next/no-img-element -- Preview must request private draft image URLs with the browser session. */

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Monitor, RotateCcw, Shuffle, Smartphone } from 'lucide-react';
import type { CatalogData, Display2D, Display3D } from '@/lib/catalog/contracts';
import { mediaUrl, nextFlavorPreviewSeed, resolveDisplay3D } from '@/lib/catalog/resolve';
import styles from '../display/workspace.module.css';

const ProductViewer = dynamic(() => import('@/components/ProductViewer'), { ssr: false });

export default function DisplayPreview({ catalog, display3d, display2d }: { catalog: CatalogData; display3d?: Display3D; display2d?: Display2D }) {
  const [mobile, setMobile] = useState(false);
  const [seed, setSeed] = useState(0);
  const [reset, setReset] = useState(0);
  // The live offset changes UVs only; it must not reload artwork while dragging.
  const resolved = useMemo(() => display3d ? resolveDisplay3D(catalog, { ...display3d, labelOffset: 0 }, `preview-${seed}`) : null, [catalog, display3d, seed]);
  const variant = catalog.productVariants.find(item => item.id === (display3d ?? display2d)?.productVariantId);
  const flavor = resolved?.flavor ?? catalog.flavors.find(item => item.id === variant?.flavorId);
  const asset2d = catalog.assets2d.find(item => item.id === display2d?.assetId);
  const image = catalog.media.find(item => item.id === asset2d?.mediaId);
  return <aside className={styles.preview}>
    <div className={styles.surface}>
      <h3>Xem trước {display3d ? '3D' : '2D'}</h3>
      <div className={`${styles.stage} ${mobile ? styles.mobileStage : ''}`} style={flavor ? { backgroundColor: flavor.backgroundColor } : undefined}>
        {resolved ? <ProductViewer asset={resolved.asset} appearance={resolved.appearance} materialOverrides={{ label: { textureOffsetX: (display3d?.labelOffset ?? 0) / 100 } }} accentScene={resolved.accentScene} resetKey={reset} />
          : image && image.status === 'ready' ? <img src={mediaUrl(image)} alt={display2d?.alt || asset2d?.name || 'Ảnh sản phẩm'} />
          : <div className={styles.empty}>Chọn {display3d ? 'model, nhãn và hương vị' : 'ảnh sản phẩm'} để xem trước. Tài nguyên phải sẵn sàng.</div>}
      </div>
      <div className={styles.previewControls}>
        <div className={styles.tabs}><button type="button" className={`${styles.tab} ${!mobile ? styles.selectedTab : ''}`} aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={15} />Desktop</button><button type="button" className={`${styles.tab} ${mobile ? styles.selectedTab : ''}`} aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={15} />Mobile</button></div>
        {display3d && <div className={styles.tabs}><button type="button" className={styles.secondary} onClick={() => { if (resolved && display3d) setSeed(value => nextFlavorPreviewSeed(catalog, resolved.flavor, value, display3d.id)); }} disabled={!resolved}><Shuffle size={15} />Đổi bộ ảnh</button><button type="button" className={styles.secondary} aria-label="Đặt lại góc model" onClick={() => setReset(value => value + 1)} disabled={!resolved}><RotateCcw size={15} /></button></div>}
      </div>
      <p className={styles.previewNote}>{display3d ? 'Xoay model để kiểm tra mặt trước, đường nối nhãn và tỉ lệ. Ảnh trái cây, lá và splash lấy từ Flavor data; mỗi bộ ảnh giữ ổn định đến khi đổi lựa chọn.' : 'Ảnh 2D là artwork đã hoàn thiện. Chọn đúng sản phẩm và nhập mô tả ảnh để hỗ trợ khả năng truy cập.'} Đây là bản nháp; lưu chưa thay đổi trang đang xuất bản.</p>
    </div>
  </aside>;
}
