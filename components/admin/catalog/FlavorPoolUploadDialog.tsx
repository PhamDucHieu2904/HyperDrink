'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { Flavor, FlavorAsset, FlavorPoolAssetInput, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import admin from '@/app/admin/admin.module.css';
import styles from './flavor-pool-upload.module.css';

type UploadItem = { id: string; file: File; preview: string; status: 'queued' | 'uploading' | 'saving' | 'success' | 'error'; media?: MediaAsset; error?: string };
export type AddFlavorPoolAsset = (input: FlavorPoolAssetInput) => Promise<FlavorAsset>;
const statusText = { queued: 'Sẵn sàng thêm', uploading: 'Đang tải và tối ưu ảnh…', saving: 'Đang thêm vào pool…', success: 'Đã thêm vào pool', error: 'Chưa thêm được' };

export default function FlavorPoolUploadDialog({ flavor, onUpload, onAdd, onClose }: { flavor: Flavor; onUpload: (file: File, role: MediaRole) => Promise<MediaAsset>; onAdd: AddFlavorPoolAsset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const running = useRef(false);
  const [role, setRole] = useState<FlavorAsset['role']>('fruit');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempted, setAttempted] = useState(false);
  const done = items.filter(item => item.status === 'success').length;
  const failed = items.filter(item => item.status === 'error').length;
  const pending = items.filter(item => item.status !== 'success');

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const previews = urls.current;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); previews.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  function choose(files: FileList | null) {
    if (!files || running.current) return;
    const selected = Array.from(files);
    if (items.length + selected.length > 50) { setNotice('Chọn tối đa 50 ảnh mỗi lần. Bạn có thể thêm tiếp ở lần sau.'); return; }
    setItems(current => [...current, ...selected.map(file => {
      const preview = URL.createObjectURL(file); urls.current.push(preview);
      return { id: crypto.randomUUID(), file, preview, status: 'queued' as const };
    })]);
    setNotice('');
  }
  function update(id: string, changes: Partial<UploadItem>) { setItems(current => current.map(item => item.id === id ? { ...item, ...changes } : item)); }
  async function save() {
    if (running.current || !pending.length) return;
    running.current = true; setBusy(true); setAttempted(true); setNotice('');
    let successes = done, errors = 0;
    try {
      // Process separately so one invalid file never discards other successful imports.
      for (const item of pending) {
        try {
          if (item.file.size > 20 * 1024 * 1024) throw new Error('Ảnh vượt 20 MB. Chọn một file nhỏ hơn.');
          update(item.id, { status: item.media ? 'saving' : 'uploading', error: undefined });
          const media = item.media ?? await onUpload(item.file, role);
          update(item.id, { media, status: 'saving' });
          await onAdd({ id: item.id, flavorId: flavor.id, mediaId: media.id, role });
          update(item.id, { status: 'success' }); successes++;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Không thể thêm ảnh. Thử lại.';
          update(item.id, { status: 'error', error: message.startsWith('Chỉ hỗ trợ ảnh PNG') ? 'File không phải ảnh PNG, JPG hoặc WebP hợp lệ. Chọn một ảnh khác.' : message }); errors++;
        }
      }
      setNotice(`Đã thêm ${successes}/${items.length} ảnh${errors ? `. ${errors} ảnh cần kiểm tra hoặc thử lại.` : '.'}`);
    } finally { running.current = false; setBusy(false); }
  }
  function close() { if (!running.current) onClose(); }
  return <dialog ref={dialog} className={`${admin.editorDialog} ${styles.dialog}`} aria-labelledby="pool-upload-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className={admin.dialogHeader}><div><p className={admin.eyebrow}>POOL ẢNH · {flavor.shortName || flavor.name}</p><h2 id="pool-upload-title">Thêm ảnh trang trí</h2></div><button type="button" className={admin.iconButton} aria-label="Đóng thêm ảnh" disabled={busy} onClick={close}><X size={21} /></button></header>
      <div className={styles.body}>
        <div className={styles.field}><label htmlFor="pool-role">Vai trò trong cảnh</label><select id="pool-role" value={role} disabled={busy || attempted} onChange={event => setRole(event.target.value as FlavorAsset['role'])}><option value="fruit">Trái cây</option><option value="leaf">Lá cây</option><option value="splash">Splash nước</option></select></div>
        <button type="button" className={styles.choose} disabled={busy} onClick={() => input.current?.click()}><span className={styles.uploadIcon}><ImagePlus size={27} aria-hidden="true" /></span><strong>{items.length ? 'Chọn thêm ảnh từ máy' : 'Chọn ảnh từ máy'}</strong><span>Chọn một hoặc nhiều ảnh · PNG, JPG, WebP · tối đa 20 MB/ảnh</span></button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Chọn ảnh trang trí từ máy" onChange={event => { choose(event.target.files); event.target.value = ''; }} />
        <p className={styles.help}>Ảnh được thêm vào pool <strong>{flavor.name}</strong>. Hệ thống tự đặt tên, mã và thứ tự; ảnh mới được bật trong pool.</p>
        {items.length > 0 && <section className={styles.queue} aria-label="Ảnh đã chọn" aria-busy={busy}><div className={styles.queueHeading}><strong>{items.length} ảnh đã chọn</strong><span>{done} đã thêm{failed > 0 ? ` · ${failed} cần thử lại` : ''}</span></div><ul>{items.map(item => <li key={item.id} className={item.status === 'error' ? styles.errorItem : ''}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Temporary local File previews, never a remote unoptimized image. */}
          <img src={item.preview} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
          <div className={styles.fileInfo}><strong title={item.file.name}>{item.file.name}</strong><span className={item.status === 'error' ? styles.errorText : ''}>{item.error || statusText[item.status]}</span></div>
          {item.status === 'success' ? <CheckCircle2 className={styles.success} size={20} aria-label="Đã thêm thành công" /> : ['uploading', 'saving'].includes(item.status) ? <LoaderCircle size={20} className={admin.spin} aria-hidden="true" /> : <button type="button" className={admin.iconButton} disabled={busy} aria-label={`Bỏ chọn ${item.file.name}`} onClick={() => setItems(current => current.filter(row => row.id !== item.id))}><Trash2 size={17} /></button>}
        </li>)}</ul></section>}
        <p className={styles.notice} role="status" aria-live="polite">{busy ? `Đang xử lý ${items.find(item => ['uploading', 'saving'].includes(item.status))?.file.name || 'ảnh đã chọn'}…` : notice}</p>
      </div>
      <footer className={`${admin.saveBar} ${styles.footer}`}><span className={styles.help}>{done > 0 ? `${done} ảnh đã lưu vào bản nháp.` : 'Lưu vào bản nháp, chưa phát hành.'}</span><div><button type="button" className={admin.secondaryButton} disabled={busy} onClick={close}>{done > 0 ? 'Xong' : 'Hủy'}</button>{pending.length > 0 ? <button type="submit" className={admin.primaryButton} disabled={busy}>{busy ? <LoaderCircle className={admin.spin} size={17} /> : failed > 0 ? <RotateCcw size={17} /> : <ImagePlus size={17} />}{busy ? 'Đang thêm ảnh…' : failed > 0 && !items.some(item => item.status === 'queued') ? `Thử lại ${pending.length} ảnh` : `Thêm ${pending.length} ảnh vào pool`}</button> : done === 0 && <button type="submit" className={admin.primaryButton} disabled>Thêm ảnh vào pool</button>}</div></footer>
    </form>
  </dialog>;
}
