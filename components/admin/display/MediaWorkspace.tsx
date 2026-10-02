'use client';
/* eslint-disable @next/next/no-img-element -- Private uploaded media uses the authenticated API directly; no image optimization server in static export. */

import { useRef, useState } from 'react';
import { Box, Search, Upload } from 'lucide-react';
import type { MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import { mediaUrl } from '@/lib/catalog/resolve';
import { message, type WorkspaceCallbacks } from './types';
import { imageUploadHelp, mediaSummary, uploadPendingText } from '@/components/admin/ui/upload-info';
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
    const completed: MediaAsset[] = [];
    try {
      for (const file of Array.from(files)) { const saved = await onUpload(file, role); if (saved.status !== 'ready') throw new Error('File đã gửi nhưng chưa sẵn sàng. Kiểm tra trạng thái trong kho.'); completed.push(saved); count++; }
      setSuccess(completed.length === 1 ? `Đã lưu ${mediaSummary(completed[0])}.` : `Đã kiểm tra và lưu ${count} tài nguyên vào kho. Kích thước và dung lượng sau tối ưu hiển thị trên từng file.`);
      try { await onRefresh(); } catch (cause) { setError(`Các file đã được lưu; chưa tải lại danh mục được. ${message(cause)}`); }
    } catch (cause) { setError(`${message(cause)}${count ? ` ${count} file trước đó đã được lưu thành công.` : ''}`); try { await onRefresh(); } catch { /* Preserve the original upload error if refresh is also unavailable. */ } }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>TÀI NGUYÊN DÙNG CHUNG</p><h2>Kho tài nguyên</h2><p>File được kiểm tra nội dung và lưu theo checksum. Chọn đúng vai trò trước khi tải lên.</p></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
    <div className={styles.surface} style={{ marginBottom: 24 }}><div className={styles.toolbar}><label className={styles.field} style={{ margin: 0 }}><span>Vai trò file tải lên</span><select value={role} disabled={busy} onChange={event => setRole(event.target.value as MediaRole)}>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className={styles.button} type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={17} />{busy ? uploadPendingText(role) : 'Tải tài nguyên'}</button><input ref={inputRef} hidden type="file" multiple accept={role === 'model' ? '.glb' : 'image/png,image/jpeg,image/webp'} onChange={event => void upload(event.target.files)} /></div><p className={styles.help}>{imageUploadHelp(role)} {role === 'model' ? 'Tối đa 30 MB / 250.000 tam giác. UV và hướng nhãn cần kiểm tra trong preview.' : 'File nguồn tối đa 20 MB / 32 triệu pixel. SVG và ảnh động chưa được hỗ trợ.'}</p>{busy && <p className={styles.help} role="status">{uploadPendingText(role)} Chỉ báo thành công sau khi kiểm tra và lưu xong.</p>}</div>
    <div className={styles.toolbar}><Search size={17} /><input aria-label="Tìm file" placeholder="Tìm theo tên tài nguyên…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Lọc theo vai trò" style={{ width: 180 }} value={filter} onChange={event => setFilter(event.target.value)}><option value="">Tất cả vai trò</option>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className={styles.tag}>{items.length} tài nguyên</span></div>
    <div className={styles.mediaGrid}>{items.map(item => <article className={styles.mediaCard} key={item.id}>{item.mime.startsWith('image/') ? <img src={mediaUrl(item)} alt="" loading="lazy" /> : <div className={styles.modelPlaceholder}><Box size={36} aria-label="Model 3D" /></div>}<strong>{item.name}</strong><small>{roles.find(role => role.value === item.role)?.label} · {item.status === 'ready' ? 'Sẵn sàng' : item.status === 'failed' ? 'Kiểm tra thất bại' : 'Chưa sẵn sàng'}</small><small>{mediaSummary(item)}</small>{item.error && <p className={styles.error}>{item.error}</p>}</article>)}</div>
    {!items.length && <div className={styles.empty}>Chưa có tài nguyên phù hợp. Chọn vai trò rồi tải file vào kho.</div>}
  </section>;
}
