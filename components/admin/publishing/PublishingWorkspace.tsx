'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, ExternalLink, History, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import type { CatalogData, CatalogRelease, DeleteRecordHandler, ValidationIssue } from '@/lib/catalog/contracts';
import { MAX_CATALOG_RELEASES } from '@/lib/catalog/contracts';
import DeleteRecordDialog, { type DeleteRecordTarget } from '../ui/DeleteRecordDialog';
import { issueRemedy } from '@/lib/catalog/issue-remedies';
import { message } from '../display/types';
import { publicUrl } from '@/lib/public-url';
import styles from '../display/workspace.module.css';

export interface PublishingWorkspaceProps {
  catalog: CatalogData;
  releases: Omit<CatalogRelease, 'data'>[];
  activeReleaseId: string | null;
  onPreflight: () => Promise<ValidationIssue[]>;
  onPublish: (note: string) => Promise<string | void>;
  onRollback: (releaseId: string) => Promise<string | void>;
  onDeleteRelease: (releaseId: string, expectedReleaseId: string | null) => Promise<void>;
  onRefresh: () => Promise<void> | void;
  canPublish?: boolean;
  onOpenIssue?: (issue: ValidationIssue) => void;
  onDeleteRecord?: DeleteRecordHandler;
}

function localDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)); }

export default function PublishingWorkspace({ catalog, releases, activeReleaseId, onPreflight, onPublish, onRollback, onDeleteRelease, onRefresh, canPublish = true, onOpenIssue, onDeleteRecord }: PublishingWorkspaceProps) {
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [checkedSignature, setCheckedSignature] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkRequest = useRef(0);
  const checkCallback = useRef(onPreflight);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [publicationWarning, setPublicationWarning] = useState('');
  const [confirmation, setConfirmation] = useState<'publish' | string>('publish');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const summaryRef = useRef<HTMLSpanElement>(null);
  const [deletion, setDeletion] = useState<DeleteRecordTarget | null>(null);
  const releaseDeleteDialogRef = useRef<HTMLDialogElement>(null);
  const cancelReleaseDeleteRef = useRef<HTMLButtonElement>(null);
  const [releaseDeletion, setReleaseDeletion] = useState<{ release: Omit<CatalogRelease, 'data'>; expectedReleaseId: string | null } | null>(null);
  const staleReleaseDeletion = !!releaseDeletion && (releaseDeletion.expectedReleaseId !== activeReleaseId || !releases.some(release => release.id === releaseDeletion.release.id));
  const signature = JSON.stringify(catalog);
  const currentIssues = checkedSignature === signature ? issues : null;
  const blockers = currentIssues?.filter(issue => issue.severity === 'error') ?? [];
  const warnings = currentIssues?.filter(issue => issue.severity === 'warning') ?? [];
  const ready = !!currentIssues && blockers.length === 0;
  const historyFull = releases.length >= MAX_CATALOG_RELEASES;
  const hasChecked = issues !== null;
  useEffect(() => { checkCallback.current = onPreflight; }, [onPreflight]);
  useEffect(() => {
    if (!hasChecked || checkedSignature === signature || busy) return;
    const request = ++checkRequest.current;
    let cancelled = false;
    // Coalesce catalog updates from a single save. Ignore checks for a draft
    // superseded while the server was checking files or another panel saved.
    const timer = window.setTimeout(async () => {
      if (cancelled || request !== checkRequest.current) return;
      setChecking(true); setError(''); setSuccess('');
      try {
        const result = await checkCallback.current();
        if (!cancelled && request === checkRequest.current) { setIssues(result); setCheckedSignature(signature); }
      } catch (cause) { if (!cancelled && request === checkRequest.current) setError(message(cause)); }
      finally { if (!cancelled && request === checkRequest.current) setChecking(false); }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
    };
  }, [hasChecked, checkedSignature, signature, busy]);
  async function preflight() {
    const request = ++checkRequest.current;
    setChecking(true); setError(''); setSuccess('');
    try {
      const result = await onPreflight();
      if (request === checkRequest.current) { setIssues(result); setCheckedSignature(signature); requestAnimationFrame(() => summaryRef.current?.focus()); }
    } catch (cause) { if (request === checkRequest.current) setError(message(cause)); }
    finally { if (request === checkRequest.current) setChecking(false); }
  }
  function confirm(operation: string) { if (operation === 'publish' && historyFull) return; setConfirmation(operation); dialogRef.current?.showModal(); }
  function confirmReleaseDeletion(release: Omit<CatalogRelease, 'data'>) {
    setReleaseDeletion({ release, expectedReleaseId: activeReleaseId });
    releaseDeleteDialogRef.current?.showModal();
    requestAnimationFrame(() => cancelReleaseDeleteRef.current?.focus());
  }
  async function commitReleaseDeletion() {
    const selected = releaseDeletion;
    if (!selected || busy || !canPublish || staleReleaseDeletion || selected.release.id === activeReleaseId) return;
    checkRequest.current++; setChecking(false);
    releaseDeleteDialogRef.current?.close(); setBusy(true); setError(''); setSuccess('');
    try {
      await onDeleteRelease(selected.release.id, selected.expectedReleaseId);
      setSuccess(`Đã xóa bản phát hành ${localDate(selected.release.createdAt)} khỏi lịch sử.`);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  function confirmDeletion(issue: ValidationIssue) {
    if (catalog[issue.collection].some(item => item.id === issue.entityId)) setDeletion({ collection: issue.collection, id: issue.entityId });
  }
  async function commit() {
    checkRequest.current++; setChecking(false);
    dialogRef.current?.close(); setBusy(true); setError(''); setSuccess(''); setPublicationWarning('');
    try {
      if (confirmation === 'publish') {
        if (historyFull) throw new Error('Lịch sử đã đầy. Xóa một bản cũ không cần thiết trước khi phát hành tiếp.');
        const result = await onPreflight(); setIssues(result); setCheckedSignature(signature);
        if (result.some(issue => issue.severity === 'error')) throw new Error('Dữ liệu còn lỗi chặn xuất bản. Kiểm tra danh sách lỗi rồi sửa bản nháp.');
        setPublicationWarning(await onPublish(note.trim()) || ''); setSuccess('Đã xuất bản một bản dữ liệu hoàn chỉnh.'); setNote('');
      } else { setPublicationWarning(await onRollback(confirmation) || ''); setSuccess('Trang kiểm tra đã chuyển về bản dữ liệu đã chọn. Bản nháp vẫn được giữ để chỉnh sửa.'); }
      await onRefresh();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>XUẤT BẢN & LỊCH SỬ</p><h2>Phát hành dữ liệu</h2><p>Trang kiểm tra bản phát hành sử dụng bản mới; tích hợp trang chính qua contract riêng.</p></div><a className={styles.secondary} href={publicUrl('/admin/live')} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Mở bản phát hành demo</a></div>
    <p className={styles.help} style={{ marginBottom: 20 }}>{activeReleaseId ? 'Có bản đang phát hành.' : 'Chưa có bản phát hành.'} Trang kiểm tra riêng tại /admin/live.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
    {publicationWarning && <p className={styles.notice} role="status">{publicationWarning}</p>}
    <div className={styles.stats}><div className={styles.stat}><strong>{catalog.productGroups.filter(item => item.lifecycle === 'active' && item.visible).length}</strong><span>Dòng sản phẩm đang bật</span></div><div className={styles.stat}><strong>{catalog.packagingSlots.filter(item => item.lifecycle === 'active' && item.enabled).length}</strong><span>Nút bao bì đang bật</span></div><div className={styles.stat}><strong>{releases.length}/{MAX_CATALOG_RELEASES}</strong><span>Bản phát hành đã lưu</span></div></div>
    <div className={styles.grid}>
      <div className={styles.surface}>
        <h3><ClipboardCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Kiểm tra trước khi xuất bản</h3>
        <p className={styles.help}>Bản nháp có thể thiếu tài nguyên. Chỉ dữ liệu được dùng bởi dòng, slot và cấu hình đang bật sẽ được đưa vào bản phát hành.</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || checking} onClick={() => void preflight()}><ClipboardCheck size={17} />{checking ? 'Đang kiểm tra…' : busy ? 'Đang xử lý…' : 'Kiểm tra dữ liệu'}</button>{currentIssues && <span className={styles.tag} ref={summaryRef} tabIndex={-1} role="status">{blockers.length} lỗi · {warnings.length} cảnh báo</span>}</div>
        {currentIssues && (currentIssues.length ? <ul className={styles.issues} aria-label="Các lỗi và cảnh báo trước khi xuất bản">{currentIssues.map((issue, index) => {
          const remedy = issueRemedy(catalog, issue);
          const name = catalog[issue.collection].find(record => record.id === issue.entityId)?.name || issue.collection;
          return <li className={`${styles.issue} ${issue.severity === 'warning' ? styles.warning : ''}`} key={`${issue.code}-${issue.entityId}-${index}`}>
            <div><strong>{issue.severity === 'error' ? 'Lỗi cần sửa' : 'Cảnh báo'} · {name}</strong><p>{remedy?.message || issue.message}</p></div>
            <div className={styles.issueActions}>
              {remedy && onOpenIssue && <button type="button" className={styles.secondary} disabled={busy} aria-label={`${remedy.label} · ${name}`} onClick={() => onOpenIssue(issue)}>{remedy.label}<ArrowRight size={15} aria-hidden="true" /></button>}
              {onDeleteRecord && catalog[issue.collection].some(record => record.id === issue.entityId) && <button type="button" className={`${styles.secondary} ${styles.deleteAction}`} disabled={busy} aria-label={`Xóa dữ liệu · ${name}`} onClick={() => confirmDeletion(issue)}><Trash2 size={15} aria-hidden="true" />Xóa dữ liệu</button>}
            </div>
          </li>;
        })}</ul> : <p className={styles.success} style={{ marginTop: 20 }} role="status"><CheckCircle2 size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Dữ liệu đã qua kiểm tra kỹ thuật. Kiểm tra artwork và nội dung sản phẩm trước khi phát hành.</p>)}
        {!currentIssues && <p className={styles.notice} style={{ marginTop: 20 }} role="status">{issues ? error ? 'Bản nháp đã thay đổi. Bấm kiểm tra lại trước khi xuất bản.' : 'Bản nháp đã thay đổi. Đang tự kiểm tra lại dữ liệu…' : 'Chạy kiểm tra để biết cấu hình nào cần bổ sung.'}</p>}
        <label className={styles.field}><span>Ghi chú bản phát hành</span><textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Ví dụ: Thêm dòng Juice 30% và ảnh bao bì 330 ml." /></label>
        {!canPublish && <p className={styles.notice}>Chỉ tài khoản chủ quản trị được xuất bản, khôi phục hoặc xóa phiên bản.</p>}
        <p className={styles.help}>Xóa dữ liệu chỉ thay đổi bản nháp. Các phiên bản trong lịch sử giữ dữ liệu đã phát hành để dùng lại.</p>
        {historyFull && <div className={styles.historyLimit} role="status">Đã lưu {releases.length}/{MAX_CATALOG_RELEASES} bản, gồm bản đang sử dụng. Xóa bản cũ không cần thiết để còn dưới {MAX_CATALOG_RELEASES} bản trước khi phát hành tiếp.<br /><a href="#release-history">Quản lý lịch sử phát hành<ArrowRight size={15} aria-hidden="true" /></a></div>}
        <div className={styles.actions}><button type="button" className={styles.button} disabled={busy || checking || !ready || !canPublish || historyFull} onClick={() => confirm('publish')}><Upload size={17} />Xuất bản bản nháp</button></div>
      </div>
      <div className={styles.surface}>
        <div className={styles.historyCapacity}><h3 id="release-history" tabIndex={-1}><History size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Lịch sử phát hành</h3><span className={styles.tag}>{releases.length}/{MAX_CATALOG_RELEASES} bản</span></div>
        <p className={`${styles.help} ${styles.historyHelp}`}>Tối đa 10 bản, gồm bản đang sử dụng. Khi đầy, bạn cần chủ động xóa bản cũ trước khi phát hành thêm. Xóa lịch sử sẽ gỡ bản backup đó; bản đang sử dụng luôn được giữ lại.</p>
        <div className={styles.history}>{releases.map(release => <article className={styles.release} key={release.id}><div className={styles.releaseHeader}><strong>{localDate(release.createdAt)}</strong>{release.id === activeReleaseId && <span className={styles.tag}>Đang sử dụng</span>}</div><p>{release.note || 'Không có ghi chú'}</p><p>Người phát hành: {release.createdBy}</p><p>Mã: {release.id}</p>{release.id !== activeReleaseId && <div className={styles.releaseActions}><button type="button" className={styles.secondary} disabled={busy || !canPublish} onClick={() => confirm(release.id)}><RotateCcw size={15} />Dùng lại phiên bản này</button><button type="button" className={`${styles.secondary} ${styles.deleteAction}`} disabled={busy || !canPublish} aria-label={`Xóa bản phát hành ${localDate(release.createdAt)} · ${release.id}`} onClick={() => confirmReleaseDeletion(release)}><Trash2 size={15} aria-hidden="true" />Xóa bản này</button></div>}</article>)}</div>
        {!releases.length && <div className={styles.empty}>Chưa có bản phát hành. Bản đầu tiên sẽ xuất hiện sau khi dữ liệu được kiểm tra và xuất bản.</div>}
      </div>
    </div>
    <dialog className={styles.dialog} ref={dialogRef} aria-labelledby="publication-confirm-title"><h3 id="publication-confirm-title">{confirmation === 'publish' ? 'Xuất bản dữ liệu hiện tại?' : 'Dùng lại bản phát hành này?'}</h3><p>{confirmation === 'publish' ? 'Trang kiểm tra /admin/live sẽ đọc bản dữ liệu mới sau khi kiểm tra hoàn tất. Các tài nguyên không được dùng vẫn giữ trong kho nháp.' : 'Trang kiểm tra /admin/live sẽ đọc lại bản phát hành đã chọn. Dữ liệu bản nháp hiện tại được giữ để tiếp tục chỉnh sửa.'}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => dialogRef.current?.close()}>Hủy</button><button type="button" className={styles.button} onClick={() => void commit()}>{confirmation === 'publish' ? 'Xuất bản' : 'Khôi phục phiên bản'}</button></div></dialog>
    {deletion && onDeleteRecord && <DeleteRecordDialog key={deletion.collection + ':' + deletion.id} catalog={catalog} target={deletion} onDelete={onDeleteRecord} onClose={() => setDeletion(null)} onDeleted={(result, name) => { checkRequest.current++; setChecking(false); setIssues(result.issues); setCheckedSignature(JSON.stringify(result.catalog)); setSuccess('Đã gỡ “' + name + '” khỏi bản nháp và kiểm tra lại dữ liệu.'); requestAnimationFrame(() => summaryRef.current?.focus()); }} />}
    <dialog className={`${styles.dialog} ${styles.deleteDialog}`} ref={releaseDeleteDialogRef} aria-labelledby="delete-release-title" aria-describedby="delete-release-description" onClose={() => setReleaseDeletion(null)}>
      <div className={styles.deleteHeading}><h3 id="delete-release-title">Xóa bản phát hành này?</h3><button type="button" className={styles.closeButton} aria-label="Đóng xác nhận xóa bản phát hành" onClick={() => releaseDeleteDialogRef.current?.close()}><X size={18} aria-hidden="true" /></button></div>
      {releaseDeletion && <>
        <ul className={styles.deleteRecords}><li><strong>{localDate(releaseDeletion.release.createdAt)}</strong><span>{releaseDeletion.release.note || 'Không có ghi chú'}</span><span>Người phát hành: {releaseDeletion.release.createdBy}</span><span>Mã: {releaseDeletion.release.id}</span></li></ul>
        <p id="delete-release-description">Bản này sẽ bị xóa vĩnh viễn khỏi lịch sử. Bạn sẽ không thể dùng lại phiên bản này.</p>
        <p>Bản đang sử dụng, dữ liệu nháp và các file tài nguyên vẫn được giữ.</p>
        {staleReleaseDeletion && <p className={styles.error} role="alert">Lịch sử đã thay đổi. Đóng hộp xác nhận và kiểm tra lại trước khi xóa.</p>}
        <div className={styles.actions}><button type="button" ref={cancelReleaseDeleteRef} className={styles.secondary} onClick={() => releaseDeleteDialogRef.current?.close()}>Hủy</button><button type="button" className={`${styles.button} ${styles.deleteConfirm}`} disabled={busy || !canPublish || staleReleaseDeletion || releaseDeletion.release.id === activeReleaseId} onClick={() => void commitReleaseDeletion()}><Trash2 size={16} aria-hidden="true" />Xóa bản phát hành</button></div>
      </>}
    </dialog>
  </section>;
}
