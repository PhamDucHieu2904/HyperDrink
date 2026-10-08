'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { CatalogData, Display2D, Display3D, Entity, PackagingSlot, ProductVariant, RenderMode } from '@/lib/catalog/contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility } from '@/lib/catalog/compatibility';
import { displayListGroups, type DisplayStatusFilter } from '@/lib/catalog/display-list';
import DisplayPreview from '../preview/DisplayPreview';
import Asset2DWorkspace from './Asset2DWorkspace';
import { entity, message, type WorkspaceCallbacks } from './types';
import styles from './workspace.module.css';

interface Props extends WorkspaceCallbacks { mode: '3d' | '2d' }
const previewEntity: Entity = { id: 'preview', name: 'Xem trước', slug: 'preview', lifecycle: 'active', revision: 0, createdAt: '', updatedAt: '' };
const active = (record: Entity) => record.lifecycle === 'active';

export default function DisplayWorkspace(props: Props) {
  return <DisplayModule key={props.mode} {...props} />;
}

function DisplayModule(props: Props) {
  const { catalog, mode } = props;
  const [selectedId, setSelectedId] = useState('');
  const [newKey, setNewKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<DisplayStatusFilter>('all');
  const [deletion, setDeletion] = useState<{ record: Display3D | Display2D; signature: string } | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'displays' | 'assets'>('displays');
  const allGroups = displayListGroups(catalog, mode, { query: '', groupId: '', status: 'all' });
  const groups = displayListGroups(catalog, mode, { query, groupId: groupFilter, status: statusFilter });
  const total = allGroups.reduce((count, group) => count + group.records.length, 0);
  const count = groups.reduce((sum, group) => sum + group.records.length, 0);
  const filtered = !!query || !!groupFilter || statusFilter !== 'all';
  const staleDeletion = !!deletion && deletion.signature !== JSON.stringify(catalog);
  useEffect(() => {
    if (!deletion) return;
    const dialog = deleteDialogRef.current;
    dialog?.showModal(); cancelDeleteRef.current?.focus();
    return () => dialog?.close();
  }, [deletion]);
  function edit(record: Display3D | Display2D) { setSelectedId(record.id); setEditorOpen(true); setNotice(''); setActionError(''); }
  async function manage(record: Display3D | Display2D, action: 'set-enabled' | 'delete', signature = JSON.stringify(catalog)) {
    if (busyId || !props.onDisplayAction) return;
    setBusyId(record.id); setNotice(''); setActionError('');
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
      const expectedDraftHash = Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
      const updated = await props.onDisplayAction({ mode, id: record.id, expectedRevision: record.revision, expectedDraftHash, action, ...(action === 'set-enabled' ? { enabled: !record.enabled } : {}) });
      if (action === 'delete') {
        setDeletion(null); if (selectedId === record.id) setSelectedId('');
        if (groupFilter && !displayListGroups(updated, mode, { query: '', groupId: '', status: 'all' }).some(group => group.id === groupFilter)) setGroupFilter('');
      }
      setNotice(action === 'delete' ? `Đã xóa cấu hình “${record.name}” khỏi bản nháp. Tài nguyên dùng chung được giữ lại.` : `Đã chuyển “${record.name}” sang ${record.enabled ? 'Off' : 'On'} trong bản nháp.`);
    } catch (cause) { setActionError(message(cause)); if (action === 'delete') setDeletion(null); }
    finally { setBusyId(''); }
  }
  function closeDeletion() { if (!busyId) setDeletion(null); }
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>CẤU HÌNH HIỂN THỊ</p><h2>{mode === '3d' ? '3D Packaging display' : '2D Packaging display'}</h2><p>Quản lý cấu hình theo nút Best Seller. Phát hành bản nháp để cập nhật hiển thị trên website.</p></div><button type="button" className={styles.button} disabled={!!busyId} onClick={() => { setTab('displays'); setSelectedId(''); setNewKey(value => value + 1); setEditorOpen(true); setNotice(''); setActionError(''); }}><Plus size={17} />Tạo hiển thị {mode.toUpperCase()}</button></div>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {actionError && <p className={styles.error} role="alert">{actionError}</p>}
    {mode === '2d' && <div className={styles.tabs}><button type="button" className={`${styles.tab} ${tab === 'displays' ? styles.selectedTab : ''}`} aria-pressed={tab === 'displays'} onClick={() => setTab('displays')}>Cấu hình hiển thị</button><button type="button" className={`${styles.tab} ${tab === 'assets' ? styles.selectedTab : ''}`} aria-pressed={tab === 'assets'} onClick={() => setTab('assets')}>Kho hình / render 2D</button></div>}
    {tab === 'assets' ? <Asset2DWorkspace {...props} /> : <>
      <div className={styles.displayFilters}>
        <label className={styles.filterSearch}><span>Tìm cấu hình</span><div><Search size={17} aria-hidden="true" /><input placeholder="Tên, hương vị, bao bì hoặc mã sản phẩm…" value={query} onChange={event => setQuery(event.target.value)} /></div></label>
        <label><span>Best Seller</span><select value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="">Tất cả Best Seller</option>{allGroups.map(group => <option key={group.id} value={group.id}>{group.label}{group.group?.name && group.group.name !== group.label ? ` · ${group.group.name}` : ''}</option>)}</select></label>
        <label><span>Active</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as DisplayStatusFilter)}><option value="all">Tất cả trạng thái</option><option value="on">On — đang bật</option><option value="off">Off — đang tắt</option></select></label>
      </div>
      <div className={styles.filterSummary}><span role="status">{count} / {total} cấu hình{filtered ? ' khớp bộ lọc' : ''}</span>{filtered && <button type="button" className={styles.secondary} onClick={() => { setQuery(''); setGroupFilter(''); setStatusFilter('all'); }}><X size={15} aria-hidden="true" />Xóa bộ lọc</button>}</div>
      {groups.map(listGroup => <section key={listGroup.id} className={styles.displayGroup} aria-labelledby={`display-group-${listGroup.id}`}>
        <div className={styles.groupHeading}><div><h3 id={`display-group-${listGroup.id}`}>{listGroup.label}</h3>{listGroup.group && listGroup.group.name !== listGroup.label && <p>{listGroup.group.name}</p>}</div><span className={styles.tag}>{listGroup.records.length} cấu hình · {listGroup.records.filter(item => item.enabled).length} On</span></div>
        <div className={styles.list}>{listGroup.records.map(record => {
        const variant = catalog.productVariants.find(item => item.id === record.productVariantId);
        const pack = catalog.packagingVariants.find(item => item.id === variant?.packagingVariantId);
        const flavor = catalog.flavors.find(item => item.id === variant?.flavorId);
        return <article className={`${styles.displayCard} ${selectedId === record.id ? styles.selectedRow : ''} ${!record.enabled ? styles.disabledCard : ''}`} key={record.id} aria-busy={busyId === record.id}>
          <button type="button" className={styles.cardDetails} disabled={!!busyId} onClick={() => edit(record)}><strong>{record.name}</strong><small>{pack?.name || 'Chưa có bao bì'} · {flavor?.shortName || 'Chưa có hương'}{variant?.code ? ` · ${variant.code}` : ''}</small></button>
          <div className={styles.cardActions}><div className={styles.activeControl}><span>Active</span><button type="button" role="switch" aria-checked={record.enabled} aria-label={`Active · ${record.name}`} className={styles.activeSwitch} disabled={!!busyId || !props.onDisplayAction} onClick={() => void manage(record, 'set-enabled')}><span className={styles.switchTrack} aria-hidden="true"><span /></span>{busyId === record.id ? <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" /> : <span>{record.enabled ? 'On' : 'Off'}</span>}</button></div>
            <button type="button" className={styles.secondary} aria-label={`Sửa · ${record.name}`} disabled={!!busyId} onClick={() => edit(record)}><Pencil size={15} aria-hidden="true" />Sửa</button>
            <button type="button" className={`${styles.secondary} ${styles.deleteAction}`} aria-label={`Xóa · ${record.name}`} disabled={!!busyId || !props.onDisplayAction} onClick={() => { setActionError(''); setDeletion({ record, signature: JSON.stringify(catalog) }); }}><Trash2 size={15} aria-hidden="true" />Xóa</button>
          </div>
        </article>;
      })}</div></section>)}
      {!count && <p className={styles.empty}>{filtered ? 'Không có cấu hình khớp bộ lọc. Thử đổi Best Seller, trạng thái hoặc từ khóa.' : 'Chưa có cấu hình. Bấm “Tạo hiển thị” để thêm lựa chọn sản phẩm.'}</p>}
      {editorOpen && <DisplayEditor key={selectedId || `new-${newKey}`} {...props} selectedId={selectedId} onClose={() => setEditorOpen(false)} onSaved={(id, name) => { setSelectedId(id); setEditorOpen(false); setQuery(''); setGroupFilter(''); setStatusFilter('all'); setNotice(`Đã lưu “${name}” vào danh sách nháp. Xem trước và phát hành khi sẵn sàng.`); }} />}
      <dialog ref={deleteDialogRef} className={`${styles.workspace} ${styles.dialog} ${styles.deleteDialog}`} aria-labelledby="delete-display-title" aria-describedby="delete-display-description" onCancel={event => { event.preventDefault(); closeDeletion(); }} onClose={() => { if (!busyId) setDeletion(null); }}>
        <div className={styles.deleteHeading}><h3 id="delete-display-title">Xóa cấu hình hiển thị {mode.toUpperCase()}?</h3><button type="button" className={styles.closeButton} aria-label="Đóng xác nhận xóa" disabled={!!busyId} onClick={closeDeletion}><X size={18} aria-hidden="true" /></button></div>
        {deletion && <><ul className={styles.deleteRecords}><li><strong>{deletion.record.name}</strong><span>Cấu hình này sẽ bị xóa khỏi danh sách bản nháp.</span></li></ul><p id="delete-display-description">Model, nhãn và ảnh hương vị được giữ lại. Nếu không còn cấu hình phù hợp, sản phẩm sẽ được ẩn; hương mặc định sẽ tự chuyển sang lựa chọn còn lại.</p><p className={styles.help}>Website đang phát hành chỉ thay đổi khi bạn phát hành bản nháp mới.</p>{staleDeletion && <p className={styles.error} role="alert">Dữ liệu đã thay đổi. Đóng xác nhận và kiểm tra lại thẻ trước khi xóa.</p>}<div className={styles.actions}><button ref={cancelDeleteRef} type="button" className={styles.secondary} disabled={!!busyId} onClick={closeDeletion}>Hủy</button><button type="button" className={`${styles.button} ${styles.deleteConfirm}`} disabled={!!busyId || staleDeletion} onClick={() => void manage(deletion.record, 'delete', deletion.signature)}>{busyId ? <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}Xóa cấu hình</button></div></>}
      </dialog>
    </>}
  </section>;
}

export function DisplayEditor({ catalog, mode, selectedId, initialVariantId, focusField, issueMessage, onClose, onSaved, onSaveDisplay }: Props & { selectedId: string; initialVariantId?: string; focusField?: string; issueMessage?: string; onClose: () => void; onSaved: (id: string, name: string) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saveErrorRef = useRef<HTMLParagraphElement>(null);
  const [dirty, setDirty] = useState(false);
  const selected = (mode === '3d' ? catalog.displays3d : catalog.displays2d).find(item => item.id === selectedId);
  const originalVariant = catalog.productVariants.find(item => item.id === (selected?.productVariantId || initialVariantId));
  const [name, setName] = useState(selected?.name ?? (initialVariantId ? originalVariant?.name : '') ?? '');
  const [groupId, setGroupId] = useState(originalVariant?.groupId ?? '');
  const [packagingId, setPackagingId] = useState(originalVariant?.packagingVariantId ?? '');
  const [flavorId, setFlavorId] = useState(originalVariant?.flavorId ?? '');
  const [modelId, setModelId] = useState(mode === '3d' ? (selected as Display3D | undefined)?.modelId ?? '' : '');
  const [labelId, setLabelId] = useState(mode === '3d' ? (selected as Display3D | undefined)?.labelId ?? '' : '');
  const [liquidColor, setLiquidColor] = useState<string | null>(mode === '3d' ? (selected as Display3D | undefined)?.liquidColor ?? null : null);
  const [labelOffset, setLabelOffset] = useState(mode === '3d' ? (selected as Display3D | undefined)?.labelOffset ?? 0 : 0);
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);
  const [capColor, setCapColor] = useState<string | null>(mode === '3d' ? (selected as Display3D | undefined)?.capColor ?? null : null);
  const [assetId, setAssetId] = useState(mode === '2d' ? (selected as Display2D | undefined)?.assetId ?? '' : '');
  const [alt, setAlt] = useState(mode === '2d' ? (selected as Display2D | undefined)?.alt ?? '' : '');
  const [code, setCode] = useState(originalVariant?.code ?? '');
  const [description, setDescription] = useState(originalVariant?.description ?? '');
  const [enabled, setEnabled] = useState(selected?.enabled ?? true);
  const existingSlot = catalog.packagingSlots.find(item => active(item) && item.groupId === groupId && item.packagingVariantId === packagingId);
  const [createSlot, setCreateSlot] = useState(true);
  const [slotMode, setSlotMode] = useState<RenderMode>(existingSlot?.mode ?? mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const field = focusField ? dialog?.querySelector<HTMLElement>(`[id="display-${focusField}"]`) : null;
    (field || dialog?.querySelector<HTMLSelectElement>('select'))?.focus();
    field?.scrollIntoView({ block: 'center' });
    return () => dialog?.close();
  }, [focusField]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function close() {
    if (busy) return;
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Đóng panel và bỏ các thay đổi này?')) return;
    onClose();
  }
  const group = catalog.productGroups.find(item => item.id === groupId);
  const pack = catalog.packagingVariants.find(item => item.id === packagingId);
  const flavor = catalog.flavors.find(item => item.id === flavorId);
  const model = catalog.models3d.find(item => item.id === modelId);
  const hasLiquid = mode === '3d' && !!model?.materialSlots.liquid?.length;
  const hasCap = mode === '3d' && !!model?.materialSlots.cap?.length;
  const validCapColor = capColor === null || /^#[0-9a-f]{6}$/i.test(capColor);
  const flavorLiquidColor = /^#[0-9a-f]{6}$/i.test(flavor?.accentColor ?? '') ? flavor!.accentColor : '#ffc440';
  const effectiveLiquidColor = liquidColor ?? flavorLiquidColor;
  const validLiquidColor = /^#[0-9a-f]{6}$/i.test(effectiveLiquidColor);
  const models = catalog.models3d.filter(item => active(item) && item.packagingVariantId === packagingId);
  const labels = catalog.labels.filter(item => active(item) && item.drinkTypeId === group?.drinkTypeId && (!item.flavorId || item.flavorId === flavorId) && item.compatibilities.some(entry => entry.packagingVariantId === packagingId && (!model || entry.layoutProfile === model.layoutProfile)));
  const assets = catalog.assets2d.filter(item => active(item) && item.packagingVariantId === packagingId && item.drinkTypeId === group?.drinkTypeId && (!item.flavorId || item.flavorId === flavorId));
  const previewVariant: ProductVariant = { ...previewEntity, id: 'preview-variant', groupId, packagingVariantId: packagingId, flavorId, code, description, enabled: true };
  const preview3d: Display3D = { ...previewEntity, id: selectedId || 'preview-display', productVariantId: previewVariant.id, modelId: modelId || null, labelId: labelId || null, liquidColor: hasLiquid && validLiquidColor ? liquidColor : null, capColor: hasCap && validCapColor ? capColor : null, labelOffset, enabled };
  const preview2d: Display2D = { ...previewEntity, id: selectedId || 'preview-display', productVariantId: previewVariant.id, assetId: assetId || null, alt, enabled };
  const previewCatalog: CatalogData = { ...catalog, productVariants: [...catalog.productVariants, previewVariant] };
  const issues = mode === '3d' ? checkDisplay3DCompatibility(previewCatalog, preview3d) : checkDisplay2DCompatibility(previewCatalog, preview2d);
  const defaultName = [group?.name, pack?.name, flavor?.shortName].filter(Boolean).join(' · ');
  function resetSelection(kind: 'group' | 'packaging' | 'flavor', value: string) {
    if (kind === 'group') { setGroupId(value); setLabelId(''); setAssetId(''); }
    if (kind === 'packaging') { setPackagingId(value); setModelId(''); setLabelId(''); setAssetId(''); }
    if (kind === 'flavor') { setFlavorId(value); setLabelId(''); setAssetId(''); }
    setError('');
  }
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!onSaveDisplay) throw new Error('Backend chưa hỗ trợ lưu cấu hình. Tải lại admin rồi thử lại.');
      if (!groupId || !packagingId || !flavorId) throw new Error('Chọn dòng sản phẩm, quy cách bao bì và hương vị trước khi lưu.');
      const matchingVariant = catalog.productVariants.find(item => active(item) && item.groupId === groupId && item.packagingVariantId === packagingId && item.flavorId === flavorId);
      const variant: ProductVariant = { ...entity((name || defaultName).slice(0, 160), matchingVariant), groupId, packagingVariantId: packagingId, flavorId, code, description, enabled: true };
      const duplicate = (mode === '3d' ? catalog.displays3d : catalog.displays2d).find(item => active(item) && item.productVariantId === variant.id && item.id !== selectedId);
      if (duplicate) throw new Error('Tổ hợp này đã có cấu hình hiển thị. Hãy chọn cấu hình đang có để chỉnh sửa.');
      const base = entity((name || defaultName).slice(0, 160), selected);
      if (hasLiquid && !validLiquidColor) throw new Error('Màu nước phải có định dạng #RRGGBB.');
      if (hasCap && !validCapColor) throw new Error('Màu nắp phải có định dạng #RRGGBB.');
      const display: Display3D | Display2D = mode === '3d' ? { ...base, productVariantId: variant.id, modelId: modelId || null, labelId: labelId || null, liquidColor: hasLiquid ? liquidColor : null, capColor: hasCap ? capColor : null, labelOffset, enabled } : { ...base, productVariantId: variant.id, assetId: assetId || null, alt, enabled };
      let slot: PackagingSlot | null = null;
      if (createSlot) {
        slot = { ...entity(`${group?.buttonLabel || group?.name} · ${pack?.name}`.slice(0, 160), existingSlot), groupId, packagingVariantId: packagingId, regionKey: 'packaging-picker',
          position: existingSlot?.position ?? Math.max(-1, ...catalog.packagingSlots.filter(item => active(item) && item.groupId === groupId).map(item => item.position)) + 1,
          buttonLabel: existingSlot?.buttonLabel || pack?.name || 'Bao bì', mode: slotMode, defaultVariantId: existingSlot?.defaultVariantId || variant.id, enabled: existingSlot?.enabled ?? true };
      }
      const result = await onSaveDisplay({ mode, variant, expectedVariantRevision: matchingVariant?.revision ?? null, display, expectedDisplayRevision: selected?.revision ?? null, slot, expectedSlotRevision: slot ? existingSlot?.revision ?? null : null });
      setDirty(false);
      onSaved(result.display.id, result.display.name);
    } catch (cause) {
      setError(`${message(cause)} Chưa lưu thay đổi; dữ liệu bạn vừa nhập vẫn được giữ trong panel.`);
      requestAnimationFrame(() => { saveErrorRef.current?.focus(); saveErrorRef.current?.scrollIntoView({ block: 'center' }); });
    } finally { setBusy(false); }
  }
  return <dialog ref={dialogRef} className={`${styles.workspace} ${styles.displayDialog}`} aria-labelledby="display-editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.editorHeader}><div><p className={styles.eyebrow}>{selected ? 'CHỈNH SỬA BẢN NHÁP' : 'TẠO CẤU HÌNH MỚI'}</p><h2 id="display-editor-title">{selected ? 'Chỉnh sửa' : 'Tạo'} hiển thị {mode.toUpperCase()}</h2>{issueMessage && <p className={styles.help}>{originalVariant?.name}</p>}</div><button type="button" className={styles.closeButton} aria-label="Đóng panel hiển thị" disabled={busy} onClick={close}><X size={22} /></button></header>
    <div className={styles.editorBody}>{issueMessage && <p className={styles.notice} role="status"><strong>{originalVariant?.name}</strong><br />{issueMessage}</p>}<div className={styles.grid}>
    <form className={styles.surface} onChangeCapture={() => setDirty(true)} onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <p role="alert" ref={saveErrorRef} tabIndex={-1} className={styles.error}>{error}</p>}
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={styles.step}><h3><span className={styles.stepNumber}>1</span>Chọn sản phẩm</h3>
          <label className={styles.field}><span>Dòng sản phẩm *</span><select autoFocus value={groupId} required onChange={event => resetSelection('group', event.target.value)}><option value="">Chọn dòng sản phẩm</option>{catalog.productGroups.filter(active).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Loại nước: {catalog.drinkTypes.find(item => item.id === group?.drinkTypeId)?.name || 'chọn dòng trước'}</small></label>
          <div className={styles.fields}><label className={styles.field}><span>Quy cách bao bì *</span><select value={packagingId} required onChange={event => resetSelection('packaging', event.target.value)}><option value="">Chọn bao bì</option>{catalog.packagingCategories.filter(active).sort((a, b) => a.position - b.position).map(category => <optgroup key={category.id} label={category.name}>{catalog.packagingVariants.filter(item => active(item) && item.categoryId === category.id).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label><label className={styles.field}><span>Flavor data *</span><select value={flavorId} required onChange={event => resetSelection('flavor', event.target.value)}><option value="">Chọn hương vị</option>{catalog.flavors.filter(active).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        </div>
        <div className={styles.step}><h3><span className={styles.stepNumber}>2</span>{mode === '3d' ? 'Ghép model và nhãn' : 'Chọn hình sản phẩm'}</h3>
          {mode === '3d' ? <><label className={styles.field}><span>3D Packaging</span><select id="display-modelId" value={modelId} disabled={!packagingId} onChange={event => { setModelId(event.target.value); setLabelId(''); }}><option value="">Chọn model đúng bao bì</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{model ? 'Đã chọn model. Kiểu trải nhãn được kiểm tra tự động.' : 'Model và poster được quản lý trong Danh mục → 3D Model.'}</small></label><div className={styles.labelPair}><label className={styles.field}><span>Label tương thích</span><select id="display-labelId" value={labelId} disabled={!groupId || !packagingId} onChange={event => setLabelId(event.target.value)}><option value="">Chọn nhãn phù hợp với sản phẩm</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Chỉ hiện nhãn khớp bao bì, loại nước, hương vị và kiểu trải nhãn của model.</small></label><fieldset className={styles.offsetField} disabled={!labelId}><legend>Label offset</legend><div className={styles.offsetControls}>
            <input id="display-labelOffset" type="range" aria-label="Canh nhãn theo chiều ngang" aria-describedby="display-labelOffset-help" min={-50} max={50} step={0.1} value={labelOffset} onChange={event => { setOffsetDraft(null); setLabelOffset(Number(event.target.value)); }} />
            <input type="number" aria-label="Offset nhãn (%)" aria-describedby="display-labelOffset-help" min={-50} max={50} step={0.1} value={offsetDraft ?? labelOffset} onBlur={() => { if (offsetDraft?.trim() && Number.isFinite(Number(offsetDraft))) setLabelOffset(Math.max(-50, Math.min(50, Number(offsetDraft)))); setOffsetDraft(null); }} onChange={event => { setOffsetDraft(event.target.value); const next = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(next) && next >= -50 && next <= 50) setLabelOffset(next); }} /><span>%</span>
          </div><small id="display-labelOffset-help">Dịch nhãn quanh chai · 0% là vị trí gốc.</small></fieldset></div></> : <><label className={styles.field}><span>Ảnh / render 2D</span><select id="display-assetId" value={assetId} disabled={!groupId || !packagingId} onChange={event => setAssetId(event.target.value)}><option value="">Chọn hình đúng sản phẩm</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Thêm ảnh mới ở tab “Kho hình / render 2D” phía trên.</small></label><label className={styles.field}><span>Mô tả ảnh (alt)</span><input id="display-alt" maxLength={300} value={alt} onChange={event => setAlt(event.target.value)} placeholder="Ví dụ: Chai nước xoài Juice 30%, 330 ml" /></label></>}
          {hasLiquid && <div className={styles.liquidSettings}>
            <label className={styles.field}><span>Màu nước</span><select id="display-liquidColor" value={liquidColor === null ? 'flavor' : 'custom'} aria-describedby="display-liquidColor-help" onChange={event => setLiquidColor(event.target.value === 'flavor' ? null : flavorLiquidColor)}><option value="flavor">Theo màu hương vị</option><option value="custom">Màu riêng cho nước</option></select><small id="display-liquidColor-help">Mặc định lấy màu hương vị. Màu riêng chỉ đổi nước bên trong chai; màu nền giữ theo Flavor data.</small></label>
            <div className={styles.liquidColorControls}>
              <label className={styles.field}><span>Chọn màu nước</span><input type="color" value={validLiquidColor ? effectiveLiquidColor : flavorLiquidColor} disabled={liquidColor === null} onChange={event => setLiquidColor(event.target.value)} /></label>
              <label className={styles.field}><span>Mã màu nước</span><input value={effectiveLiquidColor} disabled={liquidColor === null} maxLength={7} pattern="#[0-9a-fA-F]{6}" aria-invalid={!validLiquidColor} aria-describedby={!validLiquidColor ? 'display-liquidColor-error' : undefined} onChange={event => setLiquidColor(event.target.value)} /></label>
            </div>
            {!validLiquidColor && <p id="display-liquidColor-error" className={styles.error} role="alert">Nhập mã màu gồm dấu # và 6 ký tự, ví dụ #FFC440.</p>}
            {liquidColor !== null && <button type="button" className={styles.secondary} onClick={() => { setLiquidColor(null); setDirty(true); }}>Đặt lại theo hương vị</button>}
          </div>}
          {hasCap && <div className={styles.liquidSettings}>
            <label className={styles.field}><span>Màu nắp</span><select id="display-capColor" value={capColor === null ? 'model' : 'custom'} onChange={event => setCapColor(event.target.value === 'model' ? null : '#008b28')}><option value="model">Mặc định của model</option><option value="custom">Màu riêng cho nắp</option></select><small>Màu nắp được lưu riêng cho từng profile 3D.</small></label>
            {capColor !== null && <div className={styles.liquidColorControls}>
              <label className={styles.field}><span>Chọn màu nắp</span><input type="color" value={validCapColor ? capColor : '#008b28'} onChange={event => setCapColor(event.target.value)} /></label>
              <label className={styles.field}><span>Mã màu nắp</span><input value={capColor} maxLength={7} pattern="#[0-9a-fA-F]{6}" aria-invalid={!validCapColor} onChange={event => setCapColor(event.target.value)} /></label>
            </div>}
            {!validCapColor && <p className={styles.error} role="alert">Nhập mã màu gồm dấu # và 6 ký tự.</p>}
          </div>}
          {groupId && packagingId && flavorId && issues.length > 0 && <div className={styles.notice}><strong>Cần bổ sung trước khi xuất bản:</strong><ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul><span>Bạn vẫn có thể lưu bản nháp.</span></div>}
        </div>
        <div className={styles.step}><h3><span className={styles.stepNumber}>3</span>Nội dung và nút bao bì</h3>
          <label className={styles.field}><span>Tên cấu hình</span><input maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder={defaultName || 'Tự lấy từ dòng, bao bì và hương'} /></label>
          <label className={styles.field}><span>Mã sản phẩm (tùy chọn)</span><input maxLength={128} value={code} onChange={event => setCode(event.target.value)} /></label>
          <label className={styles.field}><span>Mô tả sản phẩm</span><textarea maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label className={styles.check}><input id="display-enabled" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Bật cấu hình trong bản nháp</label>
          <label className={styles.check}><input type="checkbox" checked={createSlot} onChange={event => setCreateSlot(event.target.checked)} />{existingSlot ? 'Cập nhật chế độ nút bao bì đang có' : 'Tạo nút bao bì cho dòng sản phẩm này'}</label>
          {createSlot && <label className={styles.field}><span>Chế độ hiển thị của nút bao bì</span><select value={slotMode} onChange={event => setSlotMode(event.target.value as RenderMode)}><option value="3d">3D</option><option value="2d">2D</option><option value="auto">Tự động: 3D, dự phòng bằng 2D</option></select><small>Thứ tự, tên nút và hương mặc định có thể sửa trong Product Display.</small></label>}
          {group && !group.visible && <p className={styles.help}>Dòng sản phẩm đang ẩn. Bật hiển thị dòng trong Product Display trước khi xuất bản.</p>}
        </div>
        <div className={styles.editorActions}><span className={styles.help}>Lưu vào danh sách nháp, chưa phát hành.</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={close}>Hủy</button><button type="submit" className={styles.button} disabled={!groupId || !packagingId || !flavorId || busy}><Save size={17} />{busy ? 'Đang lưu…' : selected ? 'Lưu thay đổi' : 'Thêm vào danh sách'}</button></div></div>
      </fieldset>
    </form>
    <DisplayPreview catalog={previewCatalog} display3d={mode === '3d' ? preview3d : undefined} display2d={mode === '2d' ? preview2d : undefined} />
  </div></div></dialog>;
}
