'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Eye, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react';
import type { CatalogData, CatalogRecord, CollectionName, Flavor, Label, MediaAsset, MediaRole, Model3D, NutritionRow, ProductDetail } from '@/lib/catalog/contracts';
import { NutritionFields, ExtraDetailFields } from './DetailFields';
import ProductDetailPanel from '@/components/product-detail/ProductDetailPanel';
import { catalogProducts } from '@/lib/catalog/storefront';
import { collectionProducts } from '@/lib/catalog/collection';
import { heroProductMessages } from '@/lib/catalog/hero-marketing';
import MediaPicker from '@/components/admin/ui/MediaPicker';
import FlavorIconField from './FlavorIconField';
import ModelPreview from './ModelPreview';
import { definitions, slugify, type CatalogField } from './definitions';
import { validateRecord } from '@/lib/catalog/validation';
import { collectSalesCatalogRoots } from '@/lib/catalog/compatibility';
import { completeLabelLayouts, defaultLayoutProfile, packagingLayoutChoices } from '@/lib/catalog/layout-profiles';
import styles from '@/app/admin/admin.module.css';

export interface EntityEditorProps {
  collection: CollectionName;
  record: CatalogRecord;
  isNew: boolean;
  data: CatalogData;
  disabled: boolean;
  onClose: () => void;
  onSave: (collection: CollectionName, record: CatalogRecord, revision: number | null) => Promise<CatalogRecord>;
  onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>;
  initialIssue?: { field: string; message: string };
}

export default function EntityEditor({ collection, record, isNew, data, disabled, onClose, onSave, onUpload, initialIssue }: EntityEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...record, ...(collection === 'productGroups' && 'visible' in record ? { ...heroProductMessages(record), collectionVisible: record.collectionVisible ?? record.visible, collectionTitle: record.collectionTitle ?? '', collectionPosition: record.collectionPosition ?? record.position } : {}) }));
  const [materialJson, setMaterialJson] = useState(() => JSON.stringify('materialSlots' in record ? record.materialSlots : {}, null, 2));
  const [errors, setErrors] = useState<Record<string, string>>(() => initialIssue?.field ? { [initialIssue.field]: initialIssue.message } : {});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const [detailPreview, setDetailPreview] = useState(false);
  const definition = definitions[collection];
  const previewProduct = collection === 'productDetails' ? [...collectionProducts(data), ...catalogProducts(data, 'catalog')].find(product => product.label?.id === draft.labelId) : undefined;
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    if (initialIssue?.field) {
      const field = dialog?.querySelector<HTMLElement>(`[id="field-${initialIssue.field}"]`);
      const section = field?.closest('details');
      if (section) section.open = true;
      field?.focus();
      field?.scrollIntoView({ block: 'center' });
    }
    return () => dialog?.close();
  }, [initialIssue]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function close() {
    if (saving) return;
    if (dirty && !window.confirm('Bạn có thay đổi chưa lưu. Đóng form và bỏ các thay đổi này?')) return;
    onClose();
  }

  function change(key: string, value: unknown) {
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (key === 'name' && !slugEdited) next.slug = slugify(String(value));
      if (collection === 'packagingSlots' && (key === 'groupId' || key === 'packagingVariantId')) next.defaultVariantId = null;
      if (collection === 'flavorAssets' && key === 'role') next.mediaId = '';
      if (collection === 'models3d' && key === 'packagingVariantId' && (isNew || !current.layoutProfile)) next.layoutProfile = defaultLayoutProfile(data, String(value));
      return next;
    });
    if (key === 'slug') setSlugEdited(true);
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setDirty(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || saving || !definition) return;
    const issues: Record<string, string> = {};
    const candidate = { ...draft };
    if (!String(candidate.name ?? '').trim()) issues.name = 'Nhập tên để dễ nhận diện record.';
    if (!String(candidate.slug ?? '').trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(candidate.slug))) issues.slug = 'Mã chỉ gồm chữ thường, số và dấu gạch ngang.';
    for (const field of definition.fields) {
      const value = candidate[field.key];
      if (field.kind === 'color' && value && !/^#[0-9a-f]{6}$/i.test(String(value))) issues[field.key] = 'Nhập màu HEX đủ 6 ký tự, ví dụ #58a66a.';
      if (field.kind === 'number' && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) issues[field.key] = 'Nhập một số hợp lệ.';
      if (field.key === 'volumeMl' && typeof value === 'number' && value <= 0) issues[field.key] = 'Dung tích phải lớn hơn 0.';
      if (field.key === 'position' && typeof value === 'number' && (!Number.isInteger(value) || value < 0)) issues[field.key] = 'Thứ tự phải là số nguyên từ 0 trở lên.';
    }
    if (collection === 'models3d') {
      candidate.layoutProfile ||= defaultLayoutProfile(data, String(candidate.packagingVariantId));
      try {
        const parsed = JSON.parse(materialJson) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => !Array.isArray(value) || value.some(item => typeof item !== 'string'))) issues.materialSlots = 'JSON phải là object có mỗi slot chứa một mảng tên material/mesh.';
        else candidate.materialSlots = parsed;
      } catch { issues.materialSlots = 'JSON chưa hợp lệ. Kiểm tra dấu ngoặc và dấu phẩy.'; }
    }
    if (collection === 'labels') {
      const compatible = completeLabelLayouts(data, candidate.compatibilities as Label['compatibilities']);
      candidate.compatibilities = compatible;
      if (compatible.some(item => !item.packagingVariantId || !item.layoutProfile.trim())) issues.compatibilities = 'Chọn bao bì và kiểu nhãn tương thích. Nếu có nhiều kiểu, chọn model dùng nhãn này.';
      if (new Set(compatible.map(item => `${item.packagingVariantId}:${item.layoutProfile}`)).size !== compatible.length) issues.compatibilities = 'Có quy cách/profile tương thích bị lặp.';
    }
    for (const issue of validateRecord(collection, candidate)) {
      const field = issue.field?.split('.')[0] || '_form';
      if (!issues[field]) issues[field] = issue.message;
    }
    if (Object.keys(issues).length) { setErrors(issues); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    setSaving(true); setErrors({});
    try {
      await onSave(collection, candidate as unknown as CatalogRecord, isNew ? null : record.revision);
      setDirty(false); onClose();
    } catch (cause) {
      const detail = cause as { message?: string; fieldErrors?: Record<string, string> };
      setErrors({ ...detail.fieldErrors, _form: detail.message ?? 'Không thể lưu dữ liệu. Thay đổi của bạn vẫn được giữ trong form.' });
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setSaving(false); }
  }

  if (!definition) return null;
  const advanced = definition.fields.filter(field => field.advanced);
  const normal = definition.fields.filter(field => !field.advanced && (collection !== 'flavorAssets' || ['role', 'mediaId'].includes(field.key)));
  const errorText = (key: string) => errors[key] ? <p className={styles.fieldError} id={`error-${key}`}>{errors[key]}</p> : null;
  function optionsFor(field: CatalogField) {
    if (!field.relation) return field.options ?? [];
    let records = data[field.relation].filter(item => item.lifecycle === 'active' || item.id === draft[field.key]);
    if (field.key === 'defaultVariantId') records = data.productVariants.filter(item => item.groupId === draft.groupId && item.packagingVariantId === draft.packagingVariantId && item.lifecycle === 'active' && item.enabled);
    return records.map(item => ({ value: item.id, label: item.name + (item.lifecycle === 'archived' ? ' · Đã lưu trữ' : '') }));
  }
  function renderField(field: CatalogField) {
    const value = draft[field.key];
    const id = `field-${field.key}`;
    const common = { id, disabled: disabled || saving, 'aria-invalid': Boolean(errors[field.key]), 'aria-describedby': errors[field.key] ? `error-${field.key}` : field.help ? `help-${field.key}` : undefined };
    if (field.kind === 'checkbox') {
      const mockup = field.key === 'mockupVisible';
      const inherited = mockup && value === undefined && collectSalesCatalogRoots(data).displays3d.some(display => collection === 'models3d' ? display.modelId === draft.id : display.labelId === draft.id);
      return <div className={styles.checkboxField} key={field.key}><label htmlFor={id}><input {...common} type="checkbox" checked={value === undefined ? inherited : Boolean(value)} onChange={event => change(field.key, event.target.checked)} /><span>{field.label}</span></label>{field.help && <p className={styles.help} id={`help-${field.key}`}>{field.help}</p>}{mockup && <p className={styles.help}>{value === undefined ? 'Đang dùng quy tắc mặc định: chỉ tài nguyên của Display bán hàng được phát hành mới xuất hiện.' : <button type="button" className={styles.textButton} disabled={disabled || saving} onClick={() => change(field.key, undefined)}>Dùng quy tắc mặc định của Display bán hàng</button>}</p>}{errorText(field.key)}</div>;
    }
    let control: React.ReactNode;
    if (field.kind === 'flavor-icon') control = <FlavorIconField data={data} flavor={draft as unknown as Flavor} disabled={disabled || saving} onChange={change} onUpload={onUpload} />;
    else if (field.kind === 'nutrition') control = <NutritionFields rows={(value ?? []) as NutritionRow[]} disabled={disabled || saving} onChange={rows => change(field.key, rows)} />;
    else if (field.kind === 'detail-sections') control = <ExtraDetailFields rows={(value ?? []) as ProductDetail['sections']} disabled={disabled || saving} onChange={rows => change(field.key, rows)} />;
    else if (field.kind === 'media') control = <MediaPicker data={data} value={typeof value === 'string' ? value : null} onChange={next => change(field.key, next)} roles={collection === 'flavorAssets' ? [draft.role as MediaRole] : field.roles} label={field.label} disabled={disabled || saving} onUpload={onUpload} />;
    else if (field.kind === 'textarea') control = <textarea {...common} rows={3} value={String(value ?? '')} onChange={event => change(field.key, event.target.value)} />;
    else if (field.kind === 'select') {
      const options = optionsFor(field);
      const invalidSelection = Boolean(value) && !options.some(option => option.value === value);
      const selectedRecord = field.relation ? data[field.relation].find(item => item.id === value) : null;
      control = <><div className={styles.selectWrap}><select {...common} value={String(value ?? '')} onChange={event => change(field.key, event.target.value || (field.nullable ? null : ''))}><option value="">{field.nullable ? 'Không chọn / dùng chung' : `Chọn ${field.label.toLocaleLowerCase('vi')}`}</option>{invalidSelection && <option value={String(value)} disabled>{selectedRecord?.name ?? String(value)} · Không còn phù hợp</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></div>{invalidSelection ? <p className={styles.fieldError}>Lựa chọn hiện tại không tồn tại hoặc không còn phù hợp. Chọn lại trước khi phát hành.</p> : selectedRecord?.lifecycle === 'archived' ? <p className={styles.fieldError}>Record này đã được lưu trữ. Thay liên kết trước khi phát hành.</p> : null}</>;
    }
    else if (field.kind === 'color') control = <div className={styles.colorField}><input aria-label={`Chọn ${field.label.toLocaleLowerCase('vi')}`} disabled={disabled || saving} type="color" value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000'} onChange={event => change(field.key, event.target.value)} /><input {...common} value={String(value ?? '')} maxLength={7} onChange={event => change(field.key, event.target.value)} /></div>;
    else if (field.kind === 'json') control = <textarea {...common} className={styles.codeInput} rows={7} spellCheck={false} value={materialJson} onChange={event => { setMaterialJson(event.target.value); setErrors(current => { const next = { ...current }; delete next.materialSlots; return next; }); setDirty(true); }} />;
    else if (field.kind === 'orientation') control = <div className={styles.vectorField}>{['X', 'Y', 'Z'].map((axis, index) => <label key={axis}>{axis}<input type="number" step="0.01" disabled={disabled || saving} value={(value as number[])[index]} onChange={event => { const next = [...value as number[]]; next[index] = Number(event.target.value); change(field.key, next); }} /></label>)}</div>;
    else if (field.kind === 'compatibilities') {
      const rows = completeLabelLayouts(data, value as Label['compatibilities']);
      control = <div className={styles.compatibilityList}>{rows.map((row, index) => {
        const choices = packagingLayoutChoices(data, row.packagingVariantId);
        if (row.layoutProfile && !choices.some(choice => choice.value === row.layoutProfile)) choices.push({ value: row.layoutProfile, label: 'Kiểu nhãn đã lưu' });
        return <div className={styles.compatibilityRow} key={index}><select aria-label={`Bao bì tương thích ${index + 1}`} disabled={disabled || saving} value={row.packagingVariantId} onChange={event => change(field.key, rows.map((item, at) => at === index ? { packagingVariantId: event.target.value, layoutProfile: defaultLayoutProfile(data, event.target.value) } : item))}><option value="">Chọn bao bì</option>{data.packagingVariants.filter(item => item.lifecycle === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{choices.length > 1 ? <select aria-label={`Kiểu nhãn theo model ${index + 1}`} disabled={disabled || saving} value={row.layoutProfile} onChange={event => change(field.key, rows.map((item, at) => at === index ? { ...item, layoutProfile: event.target.value } : item))}><option value="">Chọn model dùng nhãn</option>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : <span className={styles.help}>{row.packagingVariantId ? 'Tự khớp kiểu nhãn của bao bì' : 'Chọn bao bì để tự khớp'}</span>}<button type="button" className={styles.iconButton} disabled={disabled || saving} aria-label={`Bỏ tương thích ${index + 1}`} onClick={() => change(field.key, rows.filter((_, at) => at !== index))}><Trash2 size={17} /></button></div>;
      })}<button type="button" className={styles.textButton} disabled={disabled || saving} onClick={() => change(field.key, [...rows, { packagingVariantId: '', layoutProfile: '' }])}><Plus size={16} /> Thêm bao bì tương thích</button></div>;
    } else control = <input {...common} type={field.kind === 'number' ? 'number' : 'text'} value={value === null ? '' : String(value ?? '')} min={field.key === 'mockupFrontYaw' ? -Math.PI * 8 : field.key === 'volumeMl' ? 1 : field.kind === 'number' ? 0 : undefined} step={['position', 'mockupPosition'].includes(field.key) ? 1 : 'any'} onChange={event => change(field.key, field.kind === 'number' ? event.target.value === '' && field.key.startsWith('mockup') ? undefined : event.target.value === '' && field.nullable ? null : Number(event.target.value) : event.target.value)} />;
    const groupedField = ['media', 'compatibilities', 'orientation', 'flavor-icon', 'nutrition', 'detail-sections'].includes(field.kind);
    return <div id={groupedField ? id : undefined} tabIndex={groupedField ? -1 : undefined} role={groupedField ? 'group' : undefined} aria-label={groupedField ? field.label : undefined} aria-describedby={groupedField && errors[field.key] ? `error-${field.key}` : undefined} className={`${styles.field} ${['textarea', 'media', 'compatibilities', 'json', 'flavor-icon', 'nutrition', 'detail-sections'].includes(field.kind) ? styles.fieldWide : ''}`} key={field.key}><label htmlFor={groupedField ? undefined : id}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>{control}{field.help && <p className={styles.help} id={`help-${field.key}`}>{field.help}</p>}{errorText(field.key)}</div>;
  }
  return <dialog ref={dialogRef} className={styles.editorDialog} aria-labelledby="editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form noValidate onSubmit={event => void save(event)}>
      <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>{isNew ? 'TẠO DỮ LIỆU MỚI' : `BẢN NHÁP · REVISION ${record.revision}`}</p><h2 id="editor-title">{isNew ? 'Thêm' : 'Chỉnh sửa'} {definition.singular}</h2>{initialIssue && <p className={styles.help}>{record.name}</p>}</div><button type="button" className={styles.iconButton} aria-label="Đóng form" disabled={saving} onClick={close}><X size={21} /></button></div>
      <div className={styles.editorBody}>
        <p className={styles.formIntro}>{collection === 'flavorAssets' ? `Pool ảnh · ${data.flavors.find(flavor => flavor.id === draft.flavorId)?.name || 'Hương vị đã chọn'}. Tên, mã và thứ tự được quản lý tự động.` : `${definition.description} Trường có dấu * cần hoàn thiện trước khi phát hành; bạn có thể lưu nháp để bổ sung sau.`}</p>
        {collection === 'productDetails' && <div className={styles.formIntro}><button type="button" className={styles.secondaryButton} disabled={!previewProduct} onClick={() => setDetailPreview(true)}><Eye size={17} /> Xem trước panel</button>{!previewProduct && <p className={styles.help}>Chọn nhãn đang được dùng trong một cấu hình hiển thị hợp lệ để xem trước cùng sản phẩm.</p>}</div>}
        {disabled && <p className={styles.notice}>Kết nối backend chưa sẵn sàng. Form chỉ để xem cấu trúc; chưa thể lưu dữ liệu.</p>}
        {Object.keys(errors).length > 0 && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.errorBanner}><strong><AlertCircle size={17} /> Cần kiểm tra trước khi lưu</strong>{errors._form && <p>{errors._form}</p>}<ul>{Object.entries(errors).filter(([key]) => key !== '_form').map(([key, message]) => <li key={key}><a href={`#field-${key}`} onClick={event => { event.preventDefault(); const field = document.getElementById(`field-${key}`); const section = field?.closest('details'); if (section) section.open = true; field?.focus(); field?.scrollIntoView({ block: 'nearest' }); }}>{message}</a></li>)}</ul></div>}
        <div className={styles.formGrid}>
          {collection !== 'flavorAssets' && <><div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="field-name">Tên {definition.singular} *</label><input id="field-name" autoFocus disabled={disabled || saving} value={String(draft.name)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'error-name' : undefined} onChange={event => change('name', event.target.value)} placeholder={collection === 'productGroups' ? 'Ví dụ: Juice 30%' : `Nhập tên ${definition.singular}`} />{errorText('name')}</div>
          <div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="field-slug">Mã nhận diện</label><input id="field-slug" disabled={disabled || saving} value={String(draft.slug)} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? 'error-slug' : undefined} onChange={event => change('slug', event.target.value)} /><p className={styles.help}>Tự tạo từ tên. ID liên kết được giữ ổn định khi đổi tên.</p>{errorText('slug')}</div></>}
          {normal.map(renderField)}
        </div>
        {advanced.length > 0 && <details className={styles.advanced}><summary>Thiết lập kỹ thuật <ChevronDown size={16} /></summary><p className={styles.help}>Dành cho người chuẩn bị model; các giá trị được backend kiểm tra lại.</p><div className={styles.formGrid}>{advanced.map(renderField)}</div></details>}
        {collection === 'models3d' && <ModelPreview model={draft as unknown as Model3D} data={data} />}
        {collection === 'flavors' && <div className={styles.flavorPreview} style={{ background: String(draft.backgroundColor), color: String(draft.textColor), borderColor: String(draft.accentColor) }}><span style={{ background: String(draft.accentColor) }} /><div><small>XEM TRƯỚC PALETTE</small><strong>{String(draft.shortName || draft.name || 'Hương vị mới')}</strong><p>{String(draft.description || 'Màu sắc được dùng trong cấu hình trưng bày.')}</p></div></div>}
      </div>
      <div className={styles.saveBar}><span>{dirty ? 'Có thay đổi chưa lưu' : <><Check size={15} /> {isNew ? 'Dữ liệu mới' : 'Đang xem bản nháp'}</>}</span><div><button type="button" className={styles.secondaryButton} disabled={saving} onClick={close}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={disabled || saving}>{saving ? <LoaderCircle size={17} className={styles.spin} /> : <Save size={17} />}{saving ? 'Đang lưu…' : 'Lưu bản nháp'}</button></div></div>
    </form>
    {detailPreview && previewProduct && <ProductDetailPanel catalog={data} product={previewProduct} preview={draft as unknown as ProductDetail} catalogImage={!!previewProduct.catalogItem} onClose={() => setDetailPreview(false)} />}
  </dialog>;
}
