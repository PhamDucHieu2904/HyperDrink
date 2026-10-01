'use client';
/* eslint-disable @next/next/no-img-element -- Private uploaded media uses the authenticated API directly; no image optimization server in static export. */

import { useRef, useState } from 'react';
import { Box, Search, Upload } from 'lucide-react';
import type { MediaRole } from '@/lib/catalog/contracts';
import { mediaUrl } from '@/lib/catalog/resolve';
import { message, type WorkspaceCallbacks } from './types';
import styles from './workspace.module.css';

const roles: { value: MediaRole; label: string }[] = [{ value: 'fruit', label: 'Trái cây' }, { value: 'leaf', label: 'Lá cây' }, { value: 'splash', label: 'Splash' }, { value: 'thumbnail', label: 'Ảnh đại diện' }, { value: 'icon', label: 'Icon' }, { value: 'label', label: 'Artwork nhãn' }, { value: 'model', label: 'Model GLB' }, { value: 'poster', label: 'Poster model' }, { value: 'image-2d', label: 'Ảnh / render 2D' }];
export default function MediaWorkspace({ catalog, onUpload, onRefresh }: WorkspaceCallbacks) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<MediaRole>('thumbnail');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const items = catalog.media.filter(item => item.lifecycle === 'active' && (!filter || item.role === filter) && item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(''); setSuccess(''); let count = 0;
    try {
      for (const file of Array.from(files)) { await onUpload(file, role); count++; }
      await onRefresh(); setSuccess(`Đã kiểm tra và lưu ${count} tài nguyên vào kho.`);
    } catch (cause) { setError(`${message(cause)}${count ? ` ${count} file trước đó đã được lưu thành công.` : ''}`); await onRefresh(); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>TÀI NGUYÊN DÙNG CHUNG</p><h2>Kho tài nguyên</h2><p>File được kiểm tra nội dung và lưu theo checksum. Chọn đúng vai trò trước khi tải lên.</p></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
    <div className={styles.surface} style={{ marginBottom: 24 }}><div className={styles.toolbar}><label className={styles.field} style={{ margin: 0 }}><span>Vai trò file tải lên</span><select value={role} disabled={busy} onChange={event => setRole(event.target.value as MediaRole)}>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className={styles.button} type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={17} />{busy ? 'Đang kiểm tra file…' : 'Tải tài nguyên'}</button><input ref={inputRef} hidden type="file" multiple accept={role === 'model' ? '.glb' : 'image/png,image/jpeg,image/webp'} onChange={event => void upload(event.target.files)} /></div><p className={styles.help}>{role === 'model' ? 'GLB 2.0 tự chứa dữ liệu, tối đa 30 MB / 250.000 tam giác. UV và hướng nhãn cần kiểm tra trong preview.' : 'Ảnh PNG, JPEG, WebP tĩnh, tối đa 20 MB / 32 triệu pixel. SVG và ảnh động chưa được hỗ trợ.'}</p></div>
    <div className={styles.toolbar}><Search size={17} /><input aria-label="Tìm file" placeholder="Tìm theo tên tài nguyên…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Lọc theo vai trò" style={{ width: 180 }} value={filter} onChange={event => setFilter(event.target.value)}><option value="">Tất cả vai trò</option>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className={styles.tag}>{items.length} tài nguyên</span></div>
    <div className={styles.mediaGrid}>{items.map(item => <article className={styles.mediaCard} key={item.id}>{item.mime.startsWith('image/') ? <img src={mediaUrl(item)} alt="" loading="lazy" /> : <div className={styles.modelPlaceholder}><Box size={36} aria-label="Model 3D" /></div>}<strong>{item.name}</strong><small>{roles.find(role => role.value === item.role)?.label} · {item.status === 'ready' ? 'Sẵn sàng' : item.status === 'failed' ? 'Kiểm tra thất bại' : 'Chưa sẵn sàng'}</small><small>{item.width && item.height ? `${item.width} × ${item.height} px · ` : ''}{item.bytes ? `${(item.bytes / 1024).toFixed(0)} KB` : 'Tài nguyên có sẵn'}</small>{item.error && <p className={styles.error}>{item.error}</p>}</article>)}</div>
    {!items.length && <div className={styles.empty}>Chưa có tài nguyên phù hợp. Chọn vai trò rồi tải file vào kho.</div>}
  </section>;
}
