'use client';

import { useState } from 'react';
import { Plus, Save, Search } from 'lucide-react';
import type { CatalogData, Display2D, Display3D, Entity, PackagingSlot, ProductVariant, RenderMode } from '@/lib/catalog/contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility } from '@/lib/catalog/compatibility';
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
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'displays' | 'assets'>('displays');
  const records = (mode === '3d' ? catalog.displays3d : catalog.displays2d).filter(item => active(item) && item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
  return <section className={styles.workspace}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>CẤU HÌNH HIỂN THỊ</p><h2>{mode === '3d' ? '3D Packaging display' : '2D Packaging display'}</h2><p>Ghép dòng sản phẩm, bao bì và hương vị thành một lựa chọn trên website.</p></div><button type="button" className={styles.button} onClick={() => { setTab('displays'); setSelectedId(''); setNewKey(value => value + 1); }}><Plus size={17} />Tạo hiển thị {mode.toUpperCase()}</button></div>
    {mode === '2d' && <div className={styles.tabs}><button type="button" className={`${styles.tab} ${tab === 'displays' ? styles.selectedTab : ''}`} aria-pressed={tab === 'displays'} onClick={() => setTab('displays')}>Cấu hình hiển thị</button><button type="button" className={`${styles.tab} ${tab === 'assets' ? styles.selectedTab : ''}`} aria-pressed={tab === 'assets'} onClick={() => setTab('assets')}>Kho hình / render 2D</button></div>}
    {tab === 'assets' ? <Asset2DWorkspace {...props} /> : <>
      <div className={styles.toolbar}><Search size={17} aria-hidden="true" /><input aria-label="Tìm cấu hình hiển thị" placeholder="Tìm cấu hình theo tên…" value={query} onChange={event => setQuery(event.target.value)} /><span className={styles.tag}>{records.length} cấu hình</span></div>
      {!!records.length && <div className={styles.list}>{records.map(record => {
        const variant = catalog.productVariants.find(item => item.id === record.productVariantId);
        const group = catalog.productGroups.find(item => item.id === variant?.groupId);
        const pack = catalog.packagingVariants.find(item => item.id === variant?.packagingVariantId);
        const flavor = catalog.flavors.find(item => item.id === variant?.flavorId);
        return <button type="button" className={`${styles.listRow} ${selectedId === record.id ? styles.selectedRow : ''}`} key={record.id} onClick={() => setSelectedId(record.id)}><span><strong>{record.name}</strong><small>{group?.name || 'Chưa có dòng'} · {pack?.name || 'Chưa có bao bì'} · {flavor?.shortName || 'Chưa có hương'}</small></span><span className={styles.tag}>{record.enabled ? 'Đã bật trong nháp' : 'Đã tắt'}</span></button>;
      })}</div>}
      <DisplayEditor key={selectedId || `new-${newKey}`} {...props} selectedId={selectedId} onSelect={setSelectedId} />
    </>}
  </section>;
}

function DisplayEditor({ catalog, mode, selectedId, onSelect, onSave, onRefresh }: Props & { selectedId: string; onSelect: (id: string) => void }) {
  const selected = (mode === '3d' ? catalog.displays3d : catalog.displays2d).find(item => item.id === selectedId);
  const originalVariant = catalog.productVariants.find(item => item.id === selected?.productVariantId);
  const [name, setName] = useState(selected?.name ?? '');
  const [groupId, setGroupId] = useState(originalVariant?.groupId ?? '');
  const [packagingId, setPackagingId] = useState(originalVariant?.packagingVariantId ?? '');
  const [flavorId, setFlavorId] = useState(originalVariant?.flavorId ?? '');
  const [modelId, setModelId] = useState(mode === '3d' ? (selected as Display3D | undefined)?.modelId ?? '' : '');
  const [labelId, setLabelId] = useState(mode === '3d' ? (selected as Display3D | undefined)?.labelId ?? '' : '');
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
  const [success, setSuccess] = useState('');
  const group = catalog.productGroups.find(item => item.id === groupId);
  const pack = catalog.packagingVariants.find(item => item.id === packagingId);
  const flavor = catalog.flavors.find(item => item.id === flavorId);
  const model = catalog.models3d.find(item => item.id === modelId);
  const models = catalog.models3d.filter(item => active(item) && item.packagingVariantId === packagingId);
  const labels = catalog.labels.filter(item => active(item) && item.drinkTypeId === group?.drinkTypeId && (!item.flavorId || item.flavorId === flavorId) && item.compatibilities.some(entry => entry.packagingVariantId === packagingId && (!model || entry.layoutProfile === model.layoutProfile)));
  const assets = catalog.assets2d.filter(item => active(item) && item.packagingVariantId === packagingId && item.drinkTypeId === group?.drinkTypeId && (!item.flavorId || item.flavorId === flavorId));
  const previewVariant: ProductVariant = { ...previewEntity, id: 'preview-variant', groupId, packagingVariantId: packagingId, flavorId, code, description, enabled: true };
  const preview3d: Display3D = { ...previewEntity, id: selectedId || 'preview-display', productVariantId: previewVariant.id, modelId: modelId || null, labelId: labelId || null, enabled };
  const preview2d: Display2D = { ...previewEntity, id: selectedId || 'preview-display', productVariantId: previewVariant.id, assetId: assetId || null, alt, enabled };
  const previewCatalog: CatalogData = { ...catalog, productVariants: [...catalog.productVariants, previewVariant] };
  const issues = mode === '3d' ? checkDisplay3DCompatibility(previewCatalog, preview3d) : checkDisplay2DCompatibility(previewCatalog, preview2d);
  const defaultName = [group?.name, pack?.name, flavor?.shortName].filter(Boolean).join(' · ');
  function resetSelection(kind: 'group' | 'packaging' | 'flavor', value: string) {
    if (kind === 'group') { setGroupId(value); setLabelId(''); setAssetId(''); }
    if (kind === 'packaging') { setPackagingId(value); setModelId(''); setLabelId(''); setAssetId(''); }
    if (kind === 'flavor') { setFlavorId(value); setLabelId(''); setAssetId(''); }
    setSuccess('');
  }
  async function save() {
    setBusy(true); setError(''); setSuccess('');
    let savedVariant = false;
    try {
      if (!groupId || !packagingId || !flavorId) throw new Error('Chọn dòng sản phẩm, quy cách bao bì và hương vị trước khi lưu.');
      const matchingVariant = catalog.productVariants.find(item => active(item) && item.groupId === groupId && item.packagingVariantId === packagingId && item.flavorId === flavorId);
      const variant: ProductVariant = { ...entity((name || defaultName).slice(0, 160), matchingVariant), groupId, packagingVariantId: packagingId, flavorId, code, description, enabled: true };
      const duplicate = (mode === '3d' ? catalog.displays3d : catalog.displays2d).find(item => active(item) && item.productVariantId === variant.id && item.id !== selectedId);
      if (duplicate) throw new Error('Tổ hợp này đã có cấu hình hiển thị. Hãy chọn cấu hình đang có để chỉnh sửa.');
      await onSave('productVariants', variant, matchingVariant?.revision ?? null); savedVariant = true;
      const base = entity((name || defaultName).slice(0, 160), selected);
      const display: Display3D | Display2D = mode === '3d' ? { ...base, productVariantId: variant.id, modelId: modelId || null, labelId: labelId || null, enabled } : { ...base, productVariantId: variant.id, assetId: assetId || null, alt, enabled };
      await onSave(mode === '3d' ? 'displays3d' : 'displays2d', display, selected?.revision ?? null);
      if (createSlot) {
        const slot: PackagingSlot = { ...entity(`${group?.buttonLabel || group?.name} · ${pack?.name}`.slice(0, 160), existingSlot), groupId, packagingVariantId: packagingId, regionKey: 'packaging-picker',
          position: existingSlot?.position ?? Math.max(-1, ...catalog.packagingSlots.filter(item => active(item) && item.groupId === groupId).map(item => item.position)) + 1,
          buttonLabel: existingSlot?.buttonLabel || pack?.name || 'Bao bì', mode: slotMode, defaultVariantId: existingSlot?.defaultVariantId || variant.id, enabled: existingSlot?.enabled ?? true };
        await onSave('packagingSlots', slot, existingSlot?.revision ?? null);
      }
      await onRefresh();
      setSuccess('Đã lưu cấu hình nháp. Kiểm tra phần Xuất bản để đưa lên website.');
      onSelect(display.id);
    } catch (cause) {
      setError(`${message(cause)}${savedVariant ? ' Một phần dữ liệu nháp đã được lưu; hãy tải lại và kiểm tra trước khi thử tiếp.' : ''}`);
      if (savedVariant) await onRefresh();
    } finally { setBusy(false); }
  }
  return <div className={styles.grid}>
    <form className={styles.surface} onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3>{selected ? 'Chỉnh sửa cấu hình' : 'Tạo cấu hình mới'}</h3>
      {error && <p role="alert" className={styles.error}>{error}</p>}{success && <p role="status" className={styles.success}>{success}</p>}
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={styles.step}><h3><span className={styles.stepNumber}>1</span>Chọn sản phẩm</h3>
          <label className={styles.field}><span>Dòng sản phẩm *</span><select value={groupId} required onChange={event => resetSelection('group', event.target.value)}><option value="">Chọn Product Display group</option>{catalog.productGroups.filter(active).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Loại nước: {catalog.drinkTypes.find(item => item.id === group?.drinkTypeId)?.name || 'chọn dòng trước'}</small></label>
          <div className={styles.fields}><label className={styles.field}><span>Quy cách bao bì *</span><select value={packagingId} required onChange={event => resetSelection('packaging', event.target.value)}><option value="">Chọn bao bì</option>{catalog.packagingCategories.filter(active).sort((a, b) => a.position - b.position).map(category => <optgroup key={category.id} label={category.name}>{catalog.packagingVariants.filter(item => active(item) && item.categoryId === category.id).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label><label className={styles.field}><span>Flavor data *</span><select value={flavorId} required onChange={event => resetSelection('flavor', event.target.value)}><option value="">Chọn hương vị</option>{catalog.flavors.filter(active).sort((a, b) => a.position - b.position).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        </div>
        <div className={styles.step}><h3><span className={styles.stepNumber}>2</span>{mode === '3d' ? 'Ghép model và nhãn' : 'Chọn hình sản phẩm'}</h3>
          {mode === '3d' ? <><label className={styles.field}><span>3D Packaging</span><select value={modelId} disabled={!packagingId} onChange={event => { setModelId(event.target.value); setLabelId(''); }}><option value="">Chọn model đúng bao bì</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{model ? `Profile UV: ${model.layoutProfile || 'chưa khai báo'}` : 'Model và poster được quản lý trong kho 3D Packaging.'}</small></label><label className={styles.field}><span>Label tương thích</span><select value={labelId} disabled={!groupId || !packagingId} onChange={event => setLabelId(event.target.value)}><option value="">Chọn nhãn đã khai báo đúng loại nước và UV</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Chỉ hiện nhãn khớp bao bì, loại nước, hương vị và profile UV của model.</small></label></> : <><label className={styles.field}><span>Ảnh / render 2D</span><select value={assetId} disabled={!groupId || !packagingId} onChange={event => setAssetId(event.target.value)}><option value="">Chọn hình đúng sản phẩm</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Thêm ảnh mới ở tab “Kho hình / render 2D” phía trên.</small></label><label className={styles.field}><span>Mô tả ảnh (alt)</span><input maxLength={300} value={alt} onChange={event => setAlt(event.target.value)} placeholder="Ví dụ: Chai nước xoài Juice 30%, 330 ml" /></label></>}
          {groupId && packagingId && flavorId && issues.length > 0 && <div className={styles.notice}><strong>Cần bổ sung trước khi xuất bản:</strong><ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul><span>Bạn vẫn có thể lưu bản nháp.</span></div>}
        </div>
        <div className={styles.step}><h3><span className={styles.stepNumber}>3</span>Nội dung và nút bao bì</h3>
          <label className={styles.field}><span>Tên cấu hình</span><input maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder={defaultName || 'Tự lấy từ dòng, bao bì và hương'} /></label>
          <label className={styles.field}><span>Mã sản phẩm (tùy chọn)</span><input maxLength={128} value={code} onChange={event => setCode(event.target.value)} /></label>
          <label className={styles.field}><span>Mô tả sản phẩm</span><textarea maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label className={styles.check}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Bật cấu hình trong bản nháp</label>
          <label className={styles.check}><input type="checkbox" checked={createSlot} onChange={event => setCreateSlot(event.target.checked)} />{existingSlot ? 'Cập nhật chế độ nút bao bì đang có' : 'Tạo nút bao bì cho dòng sản phẩm này'}</label>
          {createSlot && <label className={styles.field}><span>Chế độ hiển thị của nút bao bì</span><select value={slotMode} onChange={event => setSlotMode(event.target.value as RenderMode)}><option value="3d">3D</option><option value="2d">2D</option><option value="auto">Tự động: 3D, dự phòng bằng 2D</option></select><small>Thứ tự, tên nút và hương mặc định có thể sửa trong Product Display.</small></label>}
          {group && !group.visible && <p className={styles.help}>Dòng sản phẩm đang ẩn. Bật hiển thị dòng trong Product Display trước khi xuất bản.</p>}
        </div>
        <div className={styles.actions}><button type="submit" className={styles.button} disabled={!groupId || !packagingId || !flavorId || busy}><Save size={17} />{busy ? 'Đang lưu…' : 'Lưu nháp'}</button><span className={styles.help}>Chưa xuất bản khi lưu.</span></div>
      </fieldset>
    </form>
    <DisplayPreview catalog={previewCatalog} display3d={mode === '3d' ? preview3d : undefined} display2d={mode === '2d' ? preview2d : undefined} />
  </div>;
}
