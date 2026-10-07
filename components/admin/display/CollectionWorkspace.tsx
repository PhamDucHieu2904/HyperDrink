'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, FolderOpen, ImagePlus, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import type { CatalogCollection, CatalogData, CatalogItem, CatalogRecord, CollectionName, DeleteRecordHandler, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
import { collectionProducts } from '@/lib/catalog/collection';
import type { WorkspaceHelpers } from '../AdminApp';
import { newRecord, slugify } from '../catalog/definitions';
import MediaPicker, { MediaThumbnail } from '../ui/MediaPicker';
import DeleteRecordDialog, { type DeleteRecordTarget } from '../ui/DeleteRecordDialog';
import ProductDialog from '@/components/collection/ProductDialog';
import { LanguageProvider } from '@/components/LanguageProvider';
import base from '@/app/admin/admin.module.css';
import styles from './collections.module.css';

interface Props { catalog: CatalogData; onSave: WorkspaceHelpers['onSave']; onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>; onRefresh: () => Promise<void>; onDeleteRecord: DeleteRecordHandler; onNavigate: WorkspaceHelpers['onNavigate'] }

export default function CollectionWorkspace({ catalog, onSave, onUpload, onRefresh, onDeleteRecord, onNavigate }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [drinkId, setDrinkId] = useState('');
  const [editor, setEditor] = useState<{ kind: 'catalogCollections' | 'catalogItems'; record: CatalogCollection | CatalogItem; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletion, setDeletion] = useState<DeleteRecordTarget | null>(null);
  const [previewId, setPreviewId] = useState('');
  const selected = catalog.catalogCollections.find(item => item.id === selectedId && item.lifecycle === 'active');
  const collections = catalog.catalogCollections.filter(item => item.lifecycle === 'active' && (!drinkId || item.drinkTypeId === drinkId) && item.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const items = catalog.catalogItems.filter(item => item.lifecycle === 'active' && item.collectionId === selected?.id).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const previewProducts = collectionProducts(catalog);
  const preview = previewProducts.find(item => item.variant.id === previewId);
  const viewableIds = new Set(previewProducts.map(item => item.variant.id));
  async function change(kind: CollectionName, record: CatalogRecord) {
    setBusy(record.id); setError(''); setNotice('');
    try { await onSave(kind, record, record.revision); setNotice('Đã lưu bản nháp. Phát hành để cập nhật website.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu thay đổi.'); }
    finally { setBusy(''); }
  }
  function createCollection() { setEditor({ kind: 'catalogCollections', isNew: true, record: newRecord('catalogCollections', { drinkTypeId: drinkId, position: Math.max(-1, ...catalog.catalogCollections.map(item => item.position)) + 1 }) as CatalogCollection }); }
  function createItem() { if (selected) setEditor({ kind: 'catalogItems', isNew: true, record: newRecord('catalogItems', { collectionId: selected.id, position: Math.max(-1, ...items.map(item => item.position)) + 1 }) as CatalogItem }); }
  return <section className={styles.workspace}>
    <header className={styles.heading}><div>{selected ? <button type="button" className={styles.back} onClick={() => { setSelectedId(''); setNotice(''); }}><ArrowLeft size={16} />Bộ sưu tập</button> : <p className={base.eyebrow}>CATALOG SẢN PHẨM</p>}<h1>{selected?.name || '2D Packaging Display'}</h1><p>{selected ? 'Ảnh 2D và Product Detail cho từng sản phẩm trong bộ sưu tập.' : 'Tạo bộ sưu tập theo loại nước. Bật “Hiện ở trang chủ” để trình bày trong Find your vibe.'}</p></div><button type="button" className={base.primaryButton} onClick={selected ? createItem : createCollection}><Plus size={18} />{selected ? 'Thêm sản phẩm 2D' : 'Tạo bộ sưu tập'}</button></header>
    {error && <p role="alert" className={base.errorBanner}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!selected ? <><div className={styles.filters}><label className={base.search}><Search size={18} /><input type="search" placeholder="Tìm bộ sưu tập…" aria-label="Tìm bộ sưu tập" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Lọc loại nước" value={drinkId} onChange={event => setDrinkId(event.target.value)}><option value="">Tất cả Type of Drink</option>{catalog.drinkTypes.filter(item => item.lifecycle === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className={styles.collectionGrid}>{collections.map(collection => { const products = catalog.catalogItems.filter(item => item.collectionId === collection.id && item.lifecycle === 'active'); return <article className={styles.collectionCard} key={collection.id}>
        <button type="button" className={styles.cover} onClick={() => setSelectedId(collection.id)} aria-label={`Mở bộ sưu tập ${collection.name}`}>{products.length ? products.slice(0, 3).map(item => <MediaThumbnail key={item.id} media={catalog.media.find(media => media.id === item.mediaId)} />) : <FolderOpen size={44} strokeWidth={1.2} />}</button>
        <div className={styles.cardBody}><span className={styles.type}>{catalog.drinkTypes.find(type => type.id === collection.drinkTypeId)?.name}</span><h2>{collection.name}</h2><p>{products.length} sản phẩm · {collection.enabled ? 'Có trong catalog' : 'Đang tắt'}</p>
          <div className={styles.homeRow}><span>Hiện ở trang chủ<small>The collection · Find your vibe</small></span><button type="button" role="switch" aria-label={`Hiện ${collection.name} ở trang chủ`} aria-checked={collection.homeVisible} className={styles.switch} disabled={!!busy || !collection.enabled} onClick={() => void change('catalogCollections', { ...collection, homeVisible: !collection.homeVisible })}><span /></button></div>
          <div className={styles.actions}><button type="button" className={base.secondaryButton} onClick={() => setSelectedId(collection.id)}>Quản lý sản phẩm<ArrowRight size={16} /></button><button type="button" className={base.iconButton} aria-label={`Sửa ${collection.name}`} onClick={() => setEditor({ kind: 'catalogCollections', record: collection, isNew: false })}><Pencil size={16} /></button><button type="button" className={base.iconButton} aria-label={`Xóa ${collection.name}`} onClick={() => setDeletion({ collection: 'catalogCollections', id: collection.id })}><Trash2 size={16} /></button></div>
        </div></article>; })}</div>{!collections.length && <div className={styles.empty}><FolderOpen size={42} strokeWidth={1.2} /><h2>{query || drinkId ? 'Không tìm thấy bộ sưu tập' : 'Tạo bộ sưu tập đầu tiên'}</h2><p>Chọn loại nước, đặt tên, rồi thêm ảnh 2D và Product Detail.</p></div>}</> : <>
        <div className={styles.summary}><span>{items.length} sản phẩm · {catalog.drinkTypes.find(type => type.id === selected.drinkTypeId)?.name}</span><button type="button" className={base.secondaryButton} onClick={() => setEditor({ kind: 'catalogCollections', record: selected, isNew: false })}><Pencil size={16} />Sửa bộ sưu tập</button></div>
        <div className={styles.itemGrid}>{items.map(item => { const detail = catalog.productDetails.find(detail => detail.id === item.productDetailId); const packaging = catalog.packagingVariants.find(packaging => packaging.id === item.packagingVariantId); return <article key={item.id} className={styles.itemCard}><button type="button" className={styles.itemImage} aria-label={`Xem ${item.name}`} disabled={!viewableIds.has(item.id)} onClick={() => setPreviewId(item.id)}><MediaThumbnail media={catalog.media.find(media => media.id === item.mediaId)} /></button><div className={styles.cardBody}><h2>{item.name}</h2><p>{packaging?.name || 'Chưa chọn bao bì'}</p><span className={styles.detailLabel}>{detail?.name || 'Chưa chọn Product Detail'}</span><div className={styles.actions}><button type="button" className={base.secondaryButton} onClick={() => setEditor({ kind: 'catalogItems', record: item, isNew: false })}><Pencil size={15} />Chỉnh sửa</button><button type="button" role="switch" aria-label={`Hiển thị ${item.name}`} aria-checked={item.enabled} className={styles.switch} disabled={!!busy} onClick={() => void change('catalogItems', { ...item, enabled: !item.enabled })}><span /></button><button type="button" className={base.iconButton} aria-label={`Xóa ${item.name}`} onClick={() => setDeletion({ collection: 'catalogItems', id: item.id })}><Trash2 size={16} /></button></div></div></article>; })}<button type="button" className={styles.addCard} onClick={createItem}><ImagePlus size={30} strokeWidth={1.3} />Thêm sản phẩm 2D</button></div>
      </>}
    <p className={styles.footnote}>Lưu bản nháp → kiểm tra → phát hành. Bộ sưu tập không thay đổi các lon 3D trong Best Seller.</p>
    {editor && <CollectionEditor key={editor.record.id} {...editor} catalog={catalog} onUpload={onUpload} onSave={onSave} onClose={() => setEditor(null)} onSaved={record => { setEditor(null); if (editor.kind === 'catalogCollections') setSelectedId(record.id); setNotice('Đã lưu bản nháp. Phát hành để cập nhật website.'); }} onNavigate={onNavigate} />}
    {deletion && <DeleteRecordDialog catalog={catalog} target={deletion} onDelete={onDeleteRecord} onClose={() => setDeletion(null)} onDeleted={() => { setDeletion(null); void onRefresh(); }} />}
    {preview && <LanguageProvider><ProductDialog catalog={catalog} product={preview} onClose={() => setPreviewId('')} /></LanguageProvider>}
  </section>;
}

function CollectionEditor({ catalog, kind, record, isNew, onUpload, onSave, onClose, onSaved, onNavigate }: { catalog: CatalogData; kind: 'catalogCollections' | 'catalogItems'; record: CatalogCollection | CatalogItem; isNew: boolean; onUpload: Props['onUpload']; onSave: Props['onSave']; onClose: () => void; onSaved: (record: CatalogRecord) => void; onNavigate: Props['onNavigate'] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(record);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const update = (patch: Partial<CatalogCollection & CatalogItem>) => setDraft(current => ({ ...current, ...patch }));
  const collection = 'collectionId' in draft ? catalog.catalogCollections.find(item => item.id === draft.collectionId) : undefined;
  const details = catalog.productDetails.filter(item => item.lifecycle === 'active' && item.enabled && catalog.labels.some(label => label.id === item.labelId && label.lifecycle === 'active' && label.drinkTypeId === collection?.drinkTypeId));
  const detail = 'productDetailId' in draft ? catalog.productDetails.find(item => item.id === draft.productDetailId) : undefined;
  const label = catalog.labels.find(item => item.id === detail?.labelId);
  const packaging = catalog.packagingVariants.filter(item => item.lifecycle === 'active' && label?.compatibilities.some(entry => entry.packagingVariantId === item.id));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const saved = await onSave(kind, { ...draft, name: draft.name.trim(), slug: draft.slug || `${slugify(draft.name).slice(0, 95)}-${draft.id.slice(0, 8)}` }, isNew ? null : record.revision); onSaved(saved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.editor} aria-labelledby="collection-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={submit}>
    <header className={styles.editorHeading}><div><p className={base.eyebrow}>{'collectionId' in draft ? collection?.name : 'CATALOG 2D'}</p><h2 id="collection-editor-title">{isNew ? 'Thêm' : 'Chỉnh sửa'} {kind === 'catalogCollections' ? 'bộ sưu tập' : 'sản phẩm 2D'}</h2></div><button type="button" className={base.iconButton} aria-label="Đóng" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <fieldset disabled={busy} className={styles.formBody}>
      {'drinkTypeId' in draft ? <><label>Type of Drink *<select required value={draft.drinkTypeId} onChange={event => update({ drinkTypeId: event.target.value })}><option value="">Chọn loại nước</option>{catalog.drinkTypes.filter(item => item.lifecycle === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Tên bộ sưu tập *<input required maxLength={160} autoFocus placeholder="Ví dụ: Juice 30%" value={draft.name} onChange={event => update({ name: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={draft.homeVisible} onChange={event => update({ homeVisible: event.target.checked })} />Hiển thị trong Find your vibe ở trang chủ</label><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />Bật bộ sưu tập trong catalog</label></> : <>
        <div className={styles.field}><span>Ảnh sản phẩm 2D *</span><MediaPicker data={catalog} value={draft.mediaId} onChange={mediaId => update({ mediaId })} roles={['image-2d']} label="ảnh sản phẩm 2D" onUpload={onUpload} disabled={busy} /></div>
        <label>Product Detail *<select required value={draft.productDetailId || ''} onChange={event => { const selected = details.find(item => item.id === event.target.value); const selectedLabel = catalog.labels.find(item => item.id === selected?.labelId); const ids = selectedLabel?.compatibilities.map(item => item.packagingVariantId) || []; update({ productDetailId: selected?.id || null, packagingVariantId: ids.includes(draft.packagingVariantId) ? draft.packagingVariantId : ids[0] || '', name: !draft.name || draft.name === detail?.headline ? selected?.headline || catalog.flavors.find(item => item.id === selectedLabel?.flavorId)?.name || selected?.name || '' : draft.name }); }}><option value="">Chọn nội dung chi tiết</option>{details.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p className={styles.help}>Chỉ hiện Product Detail thuộc loại nước của bộ sưu tập. <button type="button" onClick={() => { onClose(); onNavigate('productDetails'); }}>Quản lý Product Detail <ArrowRight size={12} /></button></p>
        <label>Tên hiển thị *<input required maxLength={160} value={draft.name} onChange={event => update({ name: event.target.value })} /></label><label>Quy cách bao bì *<select required value={draft.packagingVariantId} onChange={event => update({ packagingVariantId: event.target.value })}><option value="">Chọn bao bì tương thích</option>{packaging.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked })} />Hiển thị sản phẩm trong bộ sưu tập</label>
      </>}
      <label>Thứ tự hiển thị<input type="number" min={0} max={100000} required value={draft.position} onChange={event => update({ position: Number(event.target.value) })} /></label>{error && <p className={base.errorBanner} role="alert">{error}</p>}
    </fieldset><footer className={styles.editorFooter}><small>Lưu nháp, chưa phát hành.</small><button type="button" className={base.secondaryButton} disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className={base.primaryButton} disabled={busy || ('mediaId' in draft && !draft.mediaId)}><Save size={16} />{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></footer>
  </form></dialog>;
}
