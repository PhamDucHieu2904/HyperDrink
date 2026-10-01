'use client';

import { useRef, useState } from 'react';
import { ImageIcon, LoaderCircle, Search, Upload, X } from 'lucide-react';
import Image from 'next/image';
import type { CatalogData, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import { mediaUrl as resolveMediaUrl } from '@/lib/catalog/resolve';
import styles from '@/app/admin/admin.module.css';

export interface MediaPickerProps {
  data: CatalogData;
  value: string | null;
  onChange: (id: string | null) => void;
  roles?: MediaRole[];
  label: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>;
}

export function mediaUrl(url: string): string {
  return resolveMediaUrl(url);
}

export function MediaThumbnail({ media, className = '' }: { media?: MediaAsset; className?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const isImage = media?.mime.startsWith('image/') || /\.(png|jpe?g|webp|avif)(\?|$)/i.test(media?.url ?? '');
  return <span className={`${styles.thumbnail} ${className}`}>
    {media && isImage && failedUrl !== media.url ? <Image src={mediaUrl(media.url)} alt="" width={media.width || 160} height={media.height || 160} unoptimized loading="lazy" onError={() => setFailedUrl(media.url)} /> : <ImageIcon size={22} aria-hidden="true" />}
  </span>;
}

export default function MediaPicker({ data, value, onChange, roles, label, allowEmpty = true, disabled, onUpload }: MediaPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const selected = data.media.find(item => item.id === value);
  const selectedIssue = value && !selected ? 'Tài nguyên không còn trong danh mục.' : selected?.lifecycle === 'archived' ? 'Tài nguyên này đã được lưu trữ. Chọn file khác trước khi phát hành.' : selected && roles?.length && !roles.includes(selected.role) ? 'File đã chọn không đúng vai trò cần dùng.' : selected && selected.status !== 'ready' ? 'File đã chọn chưa sẵn sàng sử dụng.' : '';
  const available = data.media.filter(item => item.lifecycle === 'active' && item.status === 'ready' && (!roles?.length || roles.includes(item.role)) && item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  const role = roles?.[0] ?? 'thumbnail';
  async function upload(file?: File) {
    if (!file || !onUpload) return;
    setUploading(true); setError('');
    try {
      const media = await onUpload(file, role);
      if (media.status !== 'ready') { setError('File đã được gửi nhưng chưa sẵn sàng. Hãy kiểm tra trạng thái trong kho tài nguyên.'); return; }
      onChange(media.id); dialogRef.current?.close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải file lên. Thử lại.'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <div className={styles.mediaPicker}>
    <div className={styles.mediaSelection}>
      <MediaThumbnail media={selected} />
      <span><strong>{selected?.name ?? (value ? 'Tài nguyên không còn tồn tại' : 'Chưa chọn tài nguyên')}</strong><small>{selected ? `${selected.mime} · ${selected.lifecycle === 'archived' ? 'Đã lưu trữ' : selected.status === 'ready' ? 'Sẵn sàng' : 'Chưa sẵn sàng'}` : 'Chọn file đã được kiểm tra từ thư viện'}</small></span>
      <button className={styles.secondaryButton} type="button" disabled={disabled} onClick={() => { setError(''); dialogRef.current?.showModal(); }}>Chọn file</button>
      {value && allowEmpty && <button className={styles.iconButton} type="button" disabled={disabled} aria-label={`Bỏ ${label}`} onClick={() => onChange(null)}><X size={17} /></button>}
    </div>
    {selectedIssue && <p className={styles.fieldError} role="status">{selectedIssue}</p>}
    <dialog ref={dialogRef} className={styles.pickerDialog} aria-label={`Chọn ${label}`} onCancel={event => { if (uploading) event.preventDefault(); else setError(''); }}>
      <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>THƯ VIỆN TÀI NGUYÊN</p><h2>Chọn {label.toLocaleLowerCase('vi')}</h2></div><button type="button" className={styles.iconButton} aria-label="Đóng thư viện" disabled={uploading} onClick={() => dialogRef.current?.close()}><X size={20} /></button></div>
      <div className={styles.pickerTools}><label className={styles.search}><Search size={17} /><input aria-label="Tìm tài nguyên" placeholder="Tìm theo tên file…" value={query} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => setQuery(event.target.value)} /></label><button type="button" className={styles.primaryButton} disabled={!onUpload || uploading || disabled} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle size={17} className={styles.spin} /> : <Upload size={17} />} {uploading ? 'Đang tải…' : 'Tải file mới'}</button><input ref={inputRef} className={styles.visuallyHidden} type="file" accept={role === 'model' ? '.glb' : 'image/png,image/jpeg,image/webp'} onChange={event => void upload(event.target.files?.[0])} /></div>
      {error && <p role="alert" className={styles.errorBanner}>{error}</p>}
      {!onUpload && <p className={styles.help}>Upload sẽ khả dụng sau khi cấu hình kết nối lưu trữ.</p>}
      <div className={styles.pickerGrid}>{available.map(media => <button type="button" key={media.id} disabled={uploading || disabled} className={`${styles.assetOption} ${value === media.id ? styles.assetSelected : ''}`} onClick={() => { onChange(media.id); dialogRef.current?.close(); }}><MediaThumbnail media={media} /><strong>{media.name}</strong><small>{media.width && media.height ? `${media.width} × ${media.height}` : media.mime}</small></button>)}</div>
      {!available.length && <div className={styles.emptyState}><ImageIcon size={34} /><h3>Chưa có file phù hợp</h3><p>Tài nguyên phải đúng loại và có trạng thái sẵn sàng để được chọn.</p></div>}
    </dialog>
  </div>;
}
