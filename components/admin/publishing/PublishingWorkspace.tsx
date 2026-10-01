'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ExternalLink, History, RotateCcw, Upload } from 'lucide-react';
import type { CatalogData, CatalogRelease, ValidationIssue } from '@/lib/catalog/contracts';
import { message } from '../display/types';
import { publicUrl } from '@/lib/public-url';
import styles from '../display/workspace.module.css';

export interface PublishingWorkspaceProps {
  catalog: CatalogData;
  releases: Omit<CatalogRelease, 'data'>[];
  activeReleaseId: string | null;
  onPreflight: () => Promise<ValidationIssue[]>;
  onPublish: (note: string) => Promise<void>;
  onRollback: (releaseId: string) => Promise<void>;
  onRefresh: () => Promise<void> | void;
  canPublish?: boolean;
}

function localDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)); }

export default function PublishingWorkspace({ catalog, releases, activeReleaseId, onPreflight, onPublish, onRollback, onRefresh, canPublish = true }: PublishingWorkspaceProps) {
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [checkedSignature, setCheckedSignature] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState<'publish' | string>('publish');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const signature = JSON.stringify(catalog);
  const currentIssues = checkedSignature === signature ? issues : null;
  const blockers = currentIssues?.filter(issue => issue.severity === 'error') ?? [];
  const warnings = currentIssues?.filter(issue => issue.severity === 'warning') ?? [];
  const ready = !!currentIssues && blockers.length === 0;
  async function preflight() {
    setBusy(true); setError(''); setSuccess('');
    try { const result = await onPreflight(); setIssues(result); setCheckedSignature(signature); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  function confirm(operation: string) { setConfirmation(operation); dialogRef.current?.showModal(); }
  async function commit() {
    dialogRef.current?.close(); setBusy(true); setError(''); setSuccess('');
    try {
      if (confirmation === 'publish') {
        const result = await onPreflight(); setIssues(result); setCheckedSignature(signature);
        if (result.some(issue => issue.severity === 'error')) throw new Error('Dữ liệu còn lỗi chặn xuất bản. Kiểm tra danh sách lỗi rồi sửa bản nháp.');
        await onPublish(note.trim()); setSuccess('Đã xuất bản một bản dữ liệu hoàn chỉnh.'); setNote('');
      } else { await onRollback(confirmation); setSuccess('Trang kiểm tra đã chuyển về bản dữ liệu đã chọn. Bản nháp vẫn được giữ để chỉnh sửa.'); }
      await onRefresh();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>XUẤT BẢN & LỊCH SỬ</p><h2>Phát hành dữ liệu</h2><p>Trang kiểm tra bản phát hành sử dụng bản mới; tích hợp trang chính qua contract riêng.</p></div><a className={styles.secondary} href={publicUrl('/admin/live')} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Mở bản phát hành demo</a></div>
    <p className={styles.help} style={{ marginBottom: 20 }}>{activeReleaseId ? 'Có bản đang phát hành.' : 'Chưa có bản phát hành.'} Trang kiểm tra riêng tại /admin/live.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
    <div className={styles.stats}><div className={styles.stat}><strong>{catalog.productGroups.filter(item => item.lifecycle === 'active' && item.visible).length}</strong><span>Dòng sản phẩm đang bật</span></div><div className={styles.stat}><strong>{catalog.packagingSlots.filter(item => item.lifecycle === 'active' && item.enabled).length}</strong><span>Nút bao bì đang bật</span></div><div className={styles.stat}><strong>{releases.length}</strong><span>Bản phát hành đã lưu</span></div></div>
    <div className={styles.grid}>
      <div className={styles.surface}>
        <h3><ClipboardCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Kiểm tra trước khi xuất bản</h3>
        <p className={styles.help}>Bản nháp có thể thiếu tài nguyên. Chỉ dữ liệu được dùng bởi dòng, slot và cấu hình đang bật sẽ được đưa vào bản phát hành.</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => void preflight()}><ClipboardCheck size={17} />{busy ? 'Đang xử lý…' : 'Kiểm tra dữ liệu'}</button>{currentIssues && <span className={styles.tag}>{blockers.length} lỗi · {warnings.length} cảnh báo</span>}</div>
        {currentIssues && (currentIssues.length ? <ul className={styles.issues}>{currentIssues.map((issue, index) => <li className={`${styles.issue} ${issue.severity === 'warning' ? styles.warning : ''}`} key={`${issue.code}-${issue.entityId}-${index}`}><strong>{issue.severity === 'error' ? 'Lỗi cần sửa' : 'Cảnh báo'} · {catalog[issue.collection].find(record => record.id === issue.entityId)?.name || issue.collection}</strong>{issue.message}{issue.field && <span className={styles.help}> · Trường: {issue.field}</span>}</li>)}</ul> : <p className={styles.success} style={{ marginTop: 20 }} role="status"><CheckCircle2 size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Dữ liệu đã qua kiểm tra kỹ thuật. Kiểm tra artwork và nội dung sản phẩm trước khi phát hành.</p>)}
        {!currentIssues && <p className={styles.notice} style={{ marginTop: 20 }}>{issues ? 'Bản nháp đã thay đổi. Kiểm tra lại dữ liệu trước khi xuất bản.' : 'Chạy kiểm tra để biết cấu hình nào cần bổ sung.'}</p>}
        <label className={styles.field}><span>Ghi chú bản phát hành</span><textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Ví dụ: Thêm dòng Juice 30% và ảnh bao bì 330 ml." /></label>
        {!canPublish && <p className={styles.notice}>Chỉ tài khoản chủ quản trị được xuất bản hoặc khôi phục phiên bản.</p>}
        <div className={styles.actions}><button type="button" className={styles.button} disabled={busy || !ready || !canPublish} onClick={() => confirm('publish')}><Upload size={17} />Xuất bản bản nháp</button></div>
      </div>
      <div className={styles.surface}>
        <h3><History size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Lịch sử phát hành</h3>
        <div className={styles.history}>{releases.map(release => <article className={styles.release} key={release.id}><div className={styles.releaseHeader}><strong>{localDate(release.createdAt)}</strong>{release.id === activeReleaseId && <span className={styles.tag}>Đang sử dụng</span>}</div><p>{release.note || 'Không có ghi chú'}</p><p>Người phát hành: {release.createdBy}</p><p>Mã: {release.id}</p>{release.id !== activeReleaseId && <button type="button" className={styles.secondary} disabled={busy || !canPublish} onClick={() => confirm(release.id)}><RotateCcw size={15} />Dùng lại phiên bản này</button>}</article>)}</div>
        {!releases.length && <div className={styles.empty}>Chưa có bản phát hành. Bản đầu tiên sẽ xuất hiện sau khi dữ liệu được kiểm tra và xuất bản.</div>}
      </div>
    </div>
    <dialog className={styles.dialog} ref={dialogRef} aria-labelledby="publication-confirm-title"><h3 id="publication-confirm-title">{confirmation === 'publish' ? 'Xuất bản dữ liệu hiện tại?' : 'Dùng lại bản phát hành này?'}</h3><p>{confirmation === 'publish' ? 'Trang kiểm tra /admin/live sẽ đọc bản dữ liệu mới sau khi kiểm tra hoàn tất. Các tài nguyên không được dùng vẫn giữ trong kho nháp.' : 'Trang kiểm tra /admin/live sẽ đọc lại bản phát hành đã chọn. Dữ liệu bản nháp hiện tại được giữ để tiếp tục chỉnh sửa.'}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => dialogRef.current?.close()}>Hủy</button><button type="button" className={styles.button} onClick={() => void commit()}>{confirmation === 'publish' ? 'Xuất bản' : 'Khôi phục phiên bản'}</button></div></dialog>
  </section>;
}
