'use client';

import { useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, Box, ImageIcon, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload } from 'lucide-react';
import type { CatalogData, CatalogRecord, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import { catalogResources, filterResources, RESOURCE_TYPES, type ResourceCollection, type ResourceFilter } from '@/lib/catalog/resources';
import { mediaUploadAccept } from '@/lib/catalog/media-roles';
import { MediaThumbnail } from '../ui/MediaPicker';
import { imageUploadHelp, mediaSummary, uploadPendingText } from '../ui/upload-info';
import type { DeleteRecordTarget } from '../ui/DeleteRecordDialog';
import styles from './resources.module.css';
import shared from '@/app/admin/admin.module.css';

interface Props {
  catalog: CatalogData;
  filter: ResourceFilter;
  onFilter: (filter: ResourceFilter) => void;
  disabled: boolean;
  busy: string | null;
  onEdit: (collection: ResourceCollection, record: CatalogRecord) => void;
  onCreate: (collection: ResourceCollection, media?: MediaAsset) => void;
  onDelete?: (target: DeleteRecordTarget) => void;
  onArchive?: (collection: 'media' | ResourceCollection, record: CatalogRecord) => Promise<void>;
  onRestore: (collection: 'media' | ResourceCollection, record: CatalogRecord) => Promise<void>;
  onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>;
  onRefresh?: () => Promise<void>;
}

const configName = { labels: 'nhãn', models3d: 'model 3D', assets2d: 'model 2D' };
export default function ResourceWorkspace({ catalog, filter, onFilter, disabled, busy, onEdit, onCreate, onDelete, onArchive, onRestore, onUpload, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [uploadRole, setUploadRole] = useState<MediaRole>('thumbnail');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = catalogResources(catalog);
  const available = filterResources(rows, 'all', status, query);
  const filtered = filterResources(rows, filter, status, query);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  const selectedType = RESOURCE_TYPES.find(item => item.role === filter);
  const role = filter === 'all' ? uploadRole : filter;
  async function upload(file: File) {
    if (!onUpload) return;
    setUploading(true); setNotice(null);
    try { const media = await onUpload(file, role); setNotice({ message: `Đã lưu “${media.name}”: ${mediaSummary(media)}.`, error: false }); }
    catch (cause) { setNotice({ message: cause instanceof Error ? cause.message : 'Không thể tải file.', error: true }); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <>
    <div className={shared.pageHeading}><div><p className={shared.eyebrow}>TÀI NGUYÊN DÙNG CHUNG</p><h1>Kho tài nguyên</h1><p>Quản lý file và cấu hình nhãn / model tại cùng một nơi. Chọn loại để lọc danh sách.</p></div><div className={shared.headingActions}>
      {onRefresh && <button className={shared.iconButton} aria-label="Tải lại danh mục" disabled={busy === 'refresh'} onClick={() => void onRefresh()}><RefreshCw size={18} /></button>}
      {selectedType?.collection && <button className={shared.secondaryButton} disabled={disabled} onClick={() => onCreate(selectedType.collection!)}><Plus size={17} /> Thêm {configName[selectedType.collection]}</button>}
      <button className={shared.primaryButton} disabled={!onUpload || uploading} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle size={17} className={shared.spin} /> : <Upload size={17} />} Tải file mới</button>
    </div></div>
    <div className={styles.typeFilters} role="group" aria-label="Lọc loại tài nguyên">
      {[{ role: 'all' as const, label: 'Tất cả' }, ...RESOURCE_TYPES].map(type => <button type="button" key={type.role} aria-pressed={filter === type.role} onClick={() => { onFilter(type.role); setPage(1); }}>
        {type.label}<span>{type.role === 'all' ? available.length : available.filter(row => row.role === type.role).length}</span>
      </button>)}
    </div>
    <section className={shared.dataPanel}>
      <div className={shared.tableToolbar}><label className={shared.search}><Search size={18} /><input aria-label="Tìm tài nguyên" placeholder="Tìm tên file hoặc cấu hình…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><div className={shared.filterControls}>
        <select aria-label="Lọc trạng thái tài nguyên" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">Đang sử dụng</option><option value="archived">Đã lưu trữ</option><option value="all">Tất cả trạng thái</option></select>
        {filter === 'all' && <label className={styles.uploadType}>Loại file tải lên<select aria-label="Loại file tải lên" disabled={uploading} value={uploadRole} onChange={event => setUploadRole(event.target.value as MediaRole)}>{RESOURCE_TYPES.map(type => <option key={type.role} value={type.role}>{type.label}</option>)}</select></label>}
        <span className={shared.resultCount}>{filtered.length} tài nguyên</span>
      </div></div>
      <div className={shared.uploadPolicy}><p>{imageUploadHelp(role)}{selectedType?.collection && ' Mở cấu hình bên dưới để thiết lập cách dùng file cho sản phẩm.'}</p>{uploading && <p role="status">{uploadPendingText(role)}</p>}</div>
      {notice && <div className={notice.error ? shared.errorBanner : shared.successBanner} role={notice.error ? 'alert' : 'status'}>{notice.message}</div>}
      <div className={styles.list}>
        {filtered.slice((currentPage - 1) * 20, currentPage * 20).map(row => <article className={styles.resource} key={row.key}>
          <div className={styles.fileSummary}><MediaThumbnail media={row.role === 'model' ? catalog.media.find(item => item.id === (row.configurations[0]?.record as { posterId?: string })?.posterId) : row.media} /><div>
            <strong>{row.name}</strong><div className={styles.metadata}><span className={shared.softBadge}>{RESOURCE_TYPES.find(type => type.role === row.role)?.label}</span><span>{row.media ? mediaSummary(row.media) : 'Cấu hình chưa có file'}</span></div>
            {row.media && <small>{row.media.status === 'ready' ? 'File sẵn sàng' : row.media.status === 'failed' ? row.media.error || 'File bị lỗi' : 'Đang xử lý'} · {row.media.lifecycle === 'active' ? 'Đang sử dụng' : 'Đã lưu trữ'}</small>}
          </div></div>
          {row.media && <div className={styles.fileActions}>
            {row.media.lifecycle === 'archived' ? <button className={shared.iconButton} aria-label={`Khôi phục file ${row.name}`} disabled={disabled || busy === row.media.id} onClick={() => void onRestore('media', row.media!)}><RotateCcw size={17} /></button> : onArchive && <button className={shared.iconButton} aria-label={`Lưu trữ file ${row.name}`} disabled={disabled || busy === row.media.id} onClick={() => void onArchive('media', row.media!)}><Archive size={17} /></button>}
            {onDelete && <button className={`${shared.iconButton} ${styles.delete}`} aria-label={`Xóa file ${row.name}`} disabled={disabled || Boolean(busy)} onClick={() => onDelete({ collection: 'media', id: row.media!.id })}><Trash2 size={17} /></button>}
          </div>}
          {row.configurations.length > 0 && <div className={styles.configurations}><p><Box size={14} /> Cấu hình sử dụng file</p>{row.configurations.map(({ collection, record }) => <div className={styles.configuration} key={`${collection}:${record.id}`}>
            <button className={styles.editConfig} disabled={disabled} onClick={() => onEdit(collection, record)}><Pencil size={15} /><span>{record.name}</span><small>{record.lifecycle === 'archived' ? 'Đã lưu trữ' : `r${record.revision}`}</small></button>
            {record.lifecycle === 'archived' ? <button className={shared.iconButton} aria-label={`Khôi phục cấu hình ${record.name}`} disabled={disabled || busy === record.id} onClick={() => void onRestore(collection, record)}><RotateCcw size={16} /></button> : onArchive && <button className={shared.iconButton} aria-label={`Lưu trữ cấu hình ${record.name}`} disabled={disabled || busy === record.id} onClick={() => void onArchive(collection, record)}><Archive size={16} /></button>}
            {onDelete && <button className={`${shared.iconButton} ${styles.delete}`} aria-label={`Xóa cấu hình ${record.name}`} disabled={disabled || Boolean(busy)} onClick={() => onDelete({ collection, id: record.id })}><Trash2 size={16} /></button>}
          </div>)}</div>}
          {row.media && RESOURCE_TYPES.find(type => type.role === row.role)?.collection && <button className={styles.addConfig} disabled={disabled || row.media.lifecycle !== 'active' || row.media.status !== 'ready'} onClick={() => onCreate(RESOURCE_TYPES.find(type => type.role === row.role)!.collection!, row.media)}><Plus size={15} /> {row.configurations.length ? 'Thêm cấu hình khác' : 'Thiết lập cấu hình'}</button>}
        </article>)}
        {!filtered.length && <div className={shared.emptyState}><ImageIcon size={32} /><h2>Chưa có tài nguyên phù hợp</h2><p>Thử đổi loại, trạng thái hoặc từ khóa tìm kiếm.</p></div>}
      </div>
      <div className={shared.tableFooter}><span>File dùng chung · Chỉnh cấu hình ngay trong kho</span><div className={shared.pagination}><span>{filtered.length ? `${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, filtered.length)} / ${filtered.length}` : '0 mục'}</span><button className={shared.iconButton} aria-label="Trang trước" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={16} /></button><span>Trang {currentPage}/{pages}</span><button className={shared.iconButton} aria-label="Trang sau" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ArrowRight size={16} /></button></div></div>
    </section>
    <input ref={inputRef} className={shared.visuallyHidden} type="file" accept={mediaUploadAccept(role)} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
  </>;
}
