'use client';

import { useState } from 'react';
import { Droplets, Leaf, Cherry, Snowflake, Waves, ExternalLink, LoaderCircle, Save, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_HOMEPAGE_LAYOUT, encodeHomepageLayout, resolveHomepageLayout, type HomepageLayout } from '@/lib/catalog/homepage-layout';
import { publicUrl } from '@/lib/public-url';
import styles from '@/app/admin/admin.module.css';

const controls = [
  { key: 'splash', title: 'Nước / splash', description: 'Lớp nước phía sau sản phẩm', icon: Waves },
  { key: 'droplet', title: 'Giọt nước', description: 'Các giọt nước 3D quanh sản phẩm', icon: Droplets },
  { key: 'leaf', title: 'Lá cây', description: 'Lá trang trí quanh sản phẩm', icon: Leaf },
  { key: 'fruit', title: 'Trái cây', description: 'Trái cây trang trí quanh sản phẩm', icon: Cherry },
  { key: 'ice', title: 'Đá', description: 'Các viên đá quanh sản phẩm', icon: Snowflake },
] as const;

export default function HomepageLayoutConfig({ value, onSave }: { value?: HomepageLayout; onSave?: (layout: HomepageLayout) => Promise<void> }) {
  const [source, setSource] = useState(value);
  const [layout, setLayout] = useState(() => resolveHomepageLayout(value));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (source !== value) { setSource(value); setLayout(resolveHomepageLayout(value)); }
  const dirty = encodeHomepageLayout(layout) !== encodeHomepageLayout(resolveHomepageLayout(value));
  const enabledCount = Object.values(layout).filter(Boolean).length;
  function change(next: HomepageLayout) { setLayout(next); setMessage(''); setError(''); }
  async function save() {
    if (!onSave) return;
    setBusy(true); setMessage(''); setError('');
    try { await onSave(layout); setMessage('Đã lưu bản nháp. Phát hành để áp dụng cho khách truy cập.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu cấu hình.'); }
    finally { setBusy(false); }
  }
  return <section className={styles.layoutConfig} aria-labelledby="homepage-layout-title" aria-busy={busy}>
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>HIỂN THỊ TRANG CHÍNH</p><h2 id="homepage-layout-title"><SlidersHorizontal size={19} /> Web layout config</h2><p className={styles.layoutDescription}>Bật / tắt từng lớp trang trí để so sánh hiệu năng. Lớp tắt sẽ không được tải hoặc render trong cảnh 3D.</p></div><span className={styles.softBadge}>{enabledCount} / 5 lớp bật</span></div>
    <div className={styles.layoutSwitchGrid}>{controls.map(({ key, title, description, icon: Icon }) => <div className={styles.layoutSwitchRow} key={key}><Icon size={21} /><div><strong id={`layout-${key}`}>{title}</strong><small id={`layout-${key}-help`}>{description}</small></div><button type="button" role="switch" aria-checked={layout[key]} aria-labelledby={`layout-${key}`} aria-describedby={`layout-${key}-help`} className={styles.layoutSwitch} disabled={busy} onClick={() => change({ ...layout, [key]: !layout[key] })}><span className={styles.layoutSwitchTrack}><span /></span><span>{layout[key] ? 'Bật' : 'Tắt'}</span></button></div>)}</div>
    <div className={styles.layoutConfigFooter}><div className={styles.headingActions}><button type="button" className={styles.secondaryButton} disabled={busy || enabledCount === 5} onClick={() => change({ ...DEFAULT_HOMEPAGE_LAYOUT })}>Bật tất cả</button><button type="button" className={styles.secondaryButton} disabled={busy || enabledCount === 0} onClick={() => change({ splash: false, droplet: false, leaf: false, fruit: false, ice: false })}>Tắt tất cả</button></div><div className={styles.headingActions}><a className={styles.secondaryButton} href={`${publicUrl('/')}?layoutTest=${encodeHomepageLayout(layout)}`} target="_blank" rel="noopener noreferrer">Test trên trang chính <ExternalLink size={15} /></a><button type="button" className={styles.primaryButton} disabled={busy || !dirty || !onSave} onClick={() => void save()}>{busy ? <LoaderCircle size={16} className={styles.spin} /> : <Save size={16} />} Lưu bản nháp</button></div></div>
    <p className={styles.layoutHint}>Test mở trang chính với cấu hình đang chọn, chưa cần phát hành. Sản phẩm và màu nước trong chai vẫn được giữ nguyên.</p>
    {message && <p className={styles.successBanner} role="status">{message}</p>}{error && <p className={styles.errorBanner} role="alert">{error}</p>}
  </section>;
}
