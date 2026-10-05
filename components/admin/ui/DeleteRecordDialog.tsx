'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Trash2, X } from 'lucide-react';
import type { CatalogData, CollectionName, DeleteRecordHandler, DeleteRecordResult } from '@/lib/catalog/contracts';
import { getDeletionImpact } from '@/lib/catalog/deletion';
import { definitions } from '../catalog/definitions';
import styles from '../display/workspace.module.css';

export interface DeleteRecordTarget { collection: CollectionName; id: string }

export default function DeleteRecordDialog({ catalog, target, onDelete, onDeleted, onClose }: {
  catalog: CatalogData;
  target: DeleteRecordTarget;
  onDelete: DeleteRecordHandler;
  onDeleted: (result: DeleteRecordResult, name: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [review] = useState(() => {
    const record = catalog[target.collection].find(item => item.id === target.id)!;
    return { name: record.name, revision: record.revision, signature: JSON.stringify(catalog), impact: getDeletionImpact(catalog, target.collection, target.id) };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stale = review.signature !== JSON.stringify(catalog);
  const linked = [...new Map(review.impact.references.map(item => [`${item.collection}:${item.entityId}`, item])).values()];
  useEffect(() => { dialogRef.current?.showModal(); cancelRef.current?.focus(); }, []);
  async function commit() {
    if (busy || stale) return;
    setBusy(true); setError('');
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(review.signature));
      const hash = Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
      const result = await onDelete(target.collection, target.id, review.revision, hash);
      onDeleted(result, review.name);
      dialogRef.current?.close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xóa dữ liệu. Tải lại và thử lại.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialogRef} className={`${styles.workspace} ${styles.dialog} ${styles.deleteDialog}`} aria-labelledby={titleId} aria-describedby={descriptionId} onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className={styles.deleteHeading}><h3 id={titleId}>Xóa dữ liệu khỏi bản nháp?</h3><button type="button" className={styles.closeButton} disabled={busy} aria-label="Đóng xác nhận xóa" onClick={() => dialogRef.current?.close()}><X size={18} aria-hidden="true" /></button></div>
    <p id={descriptionId}>Gỡ các mục sau khỏi bản nháp hiện tại. Các bản đã phát hành được giữ trong lịch sử để dùng lại; dữ liệu chưa từng phát hành chưa có bản sao trong lịch sử.</p>
    <ul className={styles.deleteRecords}>{review.impact.records.map(record => <li key={`${record.collection}:${record.id}`}><strong>{record.name}</strong><span>{definitions[record.collection]?.title || (record.collection === 'displays3d' ? 'Hiển thị 3D' : record.collection === 'displays2d' ? 'Hiển thị 2D' : 'Kho hình 2D')}</span></li>)}</ul>
    {!!linked.length && <details className={styles.deleteLinks}><summary>Gỡ liên kết ở {linked.length} mục còn lại</summary><p>Giữ các mục này trong bản nháp để bạn chọn lại dữ liệu phù hợp.</p><ul>{linked.map(item => <li key={`${item.collection}:${item.entityId}`}>{item.name} · {definitions[item.collection]?.title || (item.collection === 'displays3d' ? 'Hiển thị 3D' : item.collection === 'displays2d' ? 'Hiển thị 2D' : 'Kho hình 2D')}</li>)}</ul></details>}
    {review.impact.defaults.map(slot => <p className={styles.notice} key={slot.id}>Hương mặc định của “{slot.name}” sẽ {slot.variantName ? <>chuyển sang <strong>{slot.variantName}</strong>.</> : 'được bỏ chọn.'}</p>)}
    {!!review.impact.publicationIssues.length && <p className={styles.notice}>Thao tác này tạo thêm {review.impact.publicationIssues.length} lỗi cần bổ sung. Bạn có thể xóa; cần xử lý các lỗi ở bước Kiểm tra trước khi xuất bản để phát hành tiếp.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {stale && <p className={styles.error} role="alert">Bản nháp đã thay đổi. Đóng hộp xác nhận và chọn xóa lại để kiểm tra phạm vi mới.</p>}
    <div className={styles.actions}><button type="button" ref={cancelRef} className={styles.secondary} disabled={busy} onClick={() => dialogRef.current?.close()}>Hủy</button><button type="button" className={`${styles.button} ${styles.deleteConfirm}`} disabled={busy || stale} onClick={() => void commit()}>{busy ? <LoaderCircle size={16} className={styles.spin} /> : <Trash2 size={16} aria-hidden="true" />}{busy ? 'Đang xóa…' : 'Xóa khỏi bản nháp'}</button></div>
  </dialog>;
}
