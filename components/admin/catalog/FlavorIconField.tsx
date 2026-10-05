'use client';

import { useState } from 'react';
import type { CatalogData, Flavor, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import { mediaUrl, resolveFlavorIcon } from '@/lib/catalog/resolve';
import { backgroundConfig, normalizeBackgroundIcon } from '@/lib/background-config';
import BackgroundPattern from '@/components/BackgroundPattern';
import MediaPicker from '../ui/MediaPicker';
import FlavorSymbol from '../ui/FlavorSymbol';
import styles from '@/app/admin/admin.module.css';

const options = [
  ['citrus', 'Cam / Citrus'], ['lime', 'Chanh xanh'], ['berry', 'Quả mọng'], ['peach', 'Đào'], ['leaf', 'Lá cây'],
  ['mango', 'Xoài'], ['pineapple', 'Dứa'], ['apple', 'Táo'], ['grape', 'Nho'], ['coconut', 'Dừa'],
];
const iconRoles: MediaRole[] = ['icon'];
export default function FlavorIconField({ data, flavor, disabled, onChange, onUpload }: {
  data: CatalogData; flavor: Pick<Flavor, 'icon' | 'iconId' | 'backgroundColor'>; disabled: boolean;
  onChange: (key: 'icon' | 'iconId', value: string | null) => void;
  onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>;
}) {
  const [custom, setCustom] = useState(!!flavor.iconId);
  const icon = resolveFlavorIcon(data, flavor);
  const config = { ...backgroundConfig, cellSize: 72, iconSize: 36 };
  return <div className={styles.flavorIconField}>
    <div className={styles.iconSourceTabs} aria-label="Nguồn biểu tượng">
      <button type="button" aria-pressed={!custom} disabled={disabled} onClick={() => { setCustom(false); onChange('iconId', null); }}>Biểu tượng có sẵn</button>
      <button type="button" aria-pressed={custom} disabled={disabled} onClick={() => setCustom(true)}>Ảnh / SVG từ thư viện</button>
    </div>
    {custom ? <MediaPicker data={data} value={flavor.iconId || null} onChange={id => onChange('iconId', id)} roles={iconRoles} label="biểu tượng" disabled={disabled} onUpload={onUpload} /> : <select aria-label="Biểu tượng có sẵn" value={normalizeBackgroundIcon(flavor.icon)} disabled={disabled} onChange={event => onChange('icon', event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
    <div className={styles.iconPreviewRow}>
      <BackgroundPattern className={styles.iconGridPreview} theme={{ color: flavor.backgroundColor, icon: flavor.icon, ...(icon ? { iconUrl: mediaUrl(icon) } : {}) }} config={config} style={{ backgroundColor: flavor.backgroundColor }} />
      <span className={styles.flavorSwatch} style={{ background: flavor.backgroundColor }}><FlavorSymbol data={data} flavor={flavor} /></span>
      <p className={styles.help}>Xem trước ô nền và biểu tượng trong danh sách. Giữ đúng tỷ lệ, không cắt ảnh. File tải lên được dùng lại trong Kho tài nguyên → Icon.</p>
    </div>
  </div>;
}
