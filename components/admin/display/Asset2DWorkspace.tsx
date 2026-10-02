'use client';
/* eslint-disable @next/next/no-img-element -- Draft uploads require the session cookie and remain compatible with static-export admin. */

import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import type { Asset2D, CatalogData, CatalogRecord } from '@/lib/catalog/contracts';
import { mediaUrl } from '@/lib/catalog/resolve';
import MediaPicker from '../ui/MediaPicker';
import { mediaSummary } from '../ui/upload-info';
import { entity, message, type WorkspaceCallbacks } from './types';
import styles from './workspace.module.css';

export default function Asset2DWorkspace(props: WorkspaceCallbacks) {
  const [selectedId, setSelectedId] = useState('');
  const [newKey, setNewKey] = useState(0);
  const items = props.catalog.assets2d.filter(item => item.lifecycle === 'active');
  return <>
    <div className={styles.heading}><div><h2>Kho hình / render 2D</h2><p>Lưu ảnh bao bì đã hoàn thiện, đúng loại nước và hương. Sau đó ghép vào cấu hình hiển thị.</p></div><button type="button" className={styles.secondary} onClick={() => { setSelectedId(''); setNewKey(value => value + 1); }}><Plus size={17} />Thêm hình 2D</button></div>
    {!!items.length && <div className={styles.list}>{items.map(item => <button className={`${styles.listRow} ${selectedId === item.id ? styles.selectedRow : ''}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{props.catalog.packagingVariants.find(pack => pack.id === item.packagingVariantId)?.name} · {props.catalog.drinkTypes.find(drink => drink.id === item.drinkTypeId)?.name}</small></span><span className={styles.tag}>{item.galleryIds.length + (item.mediaId ? 1 : 0)} hình</span></button>)}</div>}
    <AssetEditor key={selectedId || `new-${newKey}`} {...props} selectedId={selectedId} onSelect={setSelectedId} />
  </>;
}

function AssetEditor({ catalog, selectedId, onSelect, onSave, onUpload, onRefresh }: WorkspaceCallbacks & { selectedId: string; onSelect: (id: string) => void }) {
  const original = catalog.assets2d.find(item => item.id === selectedId);
  const [record, setRecord] = useState<Asset2D>(() => original ?? { ...entity(''), packagingVariantId: '', drinkTypeId: '', flavorId: null, mediaId: null, galleryIds: [], description: '' });
  const [mediaCatalog, setMediaCatalog] = useState<CatalogData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const available: CatalogData = mediaCatalog ? { ...catalog, media: [...catalog.media, ...mediaCatalog.media.filter(item => !catalog.media.some(existing => existing.id === item.id))] } : catalog;
  const image = available.media.find(item => item.id === record.mediaId);
  const change = <K extends keyof Asset2D>(key: K, value: Asset2D[K]) => { setRecord(current => ({ ...current, [key]: value })); setSuccess(''); };
  async function upload(file: File, role: Parameters<typeof onUpload>[1]) {
    const uploaded = await onUpload(file, role);
    setMediaCatalog(current => ({ ...available, media: [...(current?.media ?? []), uploaded] }));
    return uploaded;
  }
  async function save() {
    setBusy(true); setError(''); setSuccess('');
    try {
      if (!record.name.trim() || !record.packagingVariantId || !record.drinkTypeId) throw new Error('Nhập tên, chọn bao bì và loại nước trước khi lưu.');
      const saveRecord: Asset2D = { ...record, ...entity(record.name, original), packagingVariantId: record.packagingVariantId, drinkTypeId: record.drinkTypeId, flavorId: record.flavorId, mediaId: record.mediaId, galleryIds: record.galleryIds, description: record.description };
      const result = await onSave('assets2d', saveRecord, original?.revision ?? null);
      if (result) setRecord(result as CatalogRecord as Asset2D);
      await onRefresh(); setSuccess('Đã lưu vào kho hình 2D. Chọn hình này trong tab cấu hình hiển thị.'); onSelect(saveRecord.id);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <div className={styles.grid}>
    <form className={styles.surface} onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3>{original ? 'Chỉnh sửa hình 2D' : 'Thêm hình 2D'}</h3>
      {error && <p className={styles.error} role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
      <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
        <label className={styles.field}><span>Tên hình / render *</span><input required maxLength={160} value={record.name} onChange={event => change('name', event.target.value)} /></label>
        <label className={styles.field}><span>Quy cách bao bì *</span><select required value={record.packagingVariantId} onChange={event => change('packagingVariantId', event.target.value)}><option value="">Chọn bao bì</option>{catalog.packagingCategories.filter(item => item.lifecycle === 'active').map(category => <optgroup key={category.id} label={category.name}>{catalog.packagingVariants.filter(item => item.lifecycle === 'active' && item.categoryId === category.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>
        <div className={styles.fields}><label className={styles.field}><span>Type of Drink *</span><select required value={record.drinkTypeId} onChange={event => change('drinkTypeId', event.target.value)}><option value="">Chọn loại nước</option>{catalog.drinkTypes.filter(item => item.lifecycle === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className={styles.field}><span>Hương vị (tùy chọn)</span><select value={record.flavorId ?? ''} onChange={event => change('flavorId', event.target.value || null)}><option value="">Không khóa vào một hương</option>{catalog.flavors.filter(item => item.lifecycle === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <div className={styles.field}><span>Ảnh chính</span><MediaPicker data={available} value={record.mediaId} onChange={id => change('mediaId', id)} roles={['image-2d']} label="Ảnh chính 2D" onUpload={upload} disabled={busy} /></div>
        <details className={styles.step}><summary>Ảnh bổ sung ({record.galleryIds.length})</summary><div style={{ marginTop: 16 }}><MediaPicker data={available} value={galleryId} onChange={setGalleryId} roles={['image-2d']} label="Ảnh gallery" onUpload={upload} disabled={busy} /><button type="button" className={styles.secondary} style={{ marginTop: 12 }} disabled={!galleryId || record.galleryIds.includes(galleryId)} onClick={() => { if (galleryId) { change('galleryIds', [...record.galleryIds, galleryId]); setGalleryId(null); } }}>Thêm vào gallery</button><div className={styles.inlineList}>{record.galleryIds.map(id => <button type="button" className={styles.secondary} key={id} onClick={() => change('galleryIds', record.galleryIds.filter(item => item !== id))} aria-label={`Bỏ ảnh ${available.media.find(item => item.id === id)?.name}`}>{available.media.find(item => item.id === id)?.name || 'Ảnh'} ×</button>)}</div></div></details>
        <label className={styles.field}><span>Mô tả / ghi chú</span><textarea maxLength={5000} value={record.description} onChange={event => change('description', event.target.value)} /></label>
        <div className={styles.actions}><button className={styles.button} type="submit" disabled={busy}><Save size={17} />{busy ? 'Đang lưu…' : 'Lưu hình 2D'}</button><span className={styles.help}>Kho tài nguyên chưa xuất hiện tự động trên trang chính.</span></div>
      </fieldset>
    </form>
    <aside className={styles.preview}><div className={styles.surface}><h3>Ảnh sản phẩm</h3><div className={styles.stage}>{image ? <img src={mediaUrl(image)} alt={record.name || 'Ảnh bao bì 2D'} /> : <div className={styles.empty}>Chọn hoặc tải ảnh chính để xem trước.</div>}</div><p className={styles.previewNote}>{image ? `File dùng để hiển thị: ${mediaSummary(image)}. ` : ''}Ảnh tải lên tự chuyển sang WebP, giảm cạnh dài tối đa 1.600 px và giữ tỷ lệ, vùng trong suốt. Artwork đã hoàn thiện; hệ thống không tự dán nhãn 3D vào ảnh 2D.</p></div></aside>
  </div>;
}
