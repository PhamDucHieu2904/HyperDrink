'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { NutritionRow, ProductDetail } from '@/lib/catalog/contracts';
import { getNutritionTemplate, nutritionTemplates, rowsForNutritionTemplate, type NutritionTemplateId } from '@/lib/catalog/nutrition-templates';
import styles from '@/app/admin/admin.module.css';
import detailStyles from './detail-fields.module.css';

export function NutritionFields({ rows, template, disabled, onChange, onTemplateChange }: { rows: NutritionRow[]; template?: NutritionTemplateId; disabled: boolean; onChange: (rows: NutritionRow[]) => void; onTemplateChange: (template: NutritionTemplateId) => void }) {
  const selected = getNutritionTemplate(template);
  const displayRows = rowsForNutritionTemplate(selected.id, rows);
  function chooseTemplate(next: NutritionTemplateId) {
    onTemplateChange(next);
    onChange(rowsForNutritionTemplate(next, rows));
  }
  return <div className={detailStyles.nutritionEditor}>
    <div className={detailStyles.nutritionTemplateBar}>
      <label>Mẫu bảng dinh dưỡng<select aria-label="Mẫu bảng dinh dưỡng" disabled={disabled} value={selected.id} onChange={event => chooseTemplate(event.target.value as NutritionTemplateId)}>{nutritionTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p>{selected.description}</p>
    </div>
    <div className={detailStyles.nutritionPreviewHead}><strong>{selected.name}</strong><span>{selected.servingPlaceholder}</span></div>
    <div className={detailStyles.list}>
      {displayRows.map((row, index) => <div className={selected.secondaryAmountHeading ? detailStyles.nutritionRowWide : selected.dailyHeading ? detailStyles.nutritionRowDaily : detailStyles.nutritionRow} key={`${selected.id}-${index}`}>
        <label>Chỉ tiêu<input aria-label={`Chỉ tiêu ${index + 1}`} disabled={disabled} maxLength={160} value={row.label} onChange={event => onChange(displayRows.map((item, at) => at === index ? { ...item, label: event.target.value } : item))} /></label>
        <label>{selected.amountHeading}<input aria-label={`${selected.amountHeading} ${index + 1}`} disabled={disabled} maxLength={160} value={row.amount} placeholder="Nhập số" onChange={event => onChange(displayRows.map((item, at) => at === index ? { ...item, amount: event.target.value } : item))} /></label>
        {selected.secondaryAmountHeading && <label>{selected.secondaryAmountHeading}<input aria-label={`${selected.secondaryAmountHeading} ${index + 1}`} disabled={disabled} maxLength={160} value={row.secondaryAmount ?? ''} placeholder="Nhập số" onChange={event => onChange(displayRows.map((item, at) => at === index ? { ...item, secondaryAmount: event.target.value } : item))} /></label>}
        {selected.dailyHeading && <label>{selected.dailyHeading}<input aria-label={`${selected.dailyHeading} ${index + 1}`} disabled={disabled} maxLength={160} value={row.dailyValue} placeholder="%" onChange={event => onChange(displayRows.map((item, at) => at === index ? { ...item, dailyValue: event.target.value } : item))} /></label>}
        {selected.secondaryAmountHeading && <label>{selected.dailyHeading ?? '% DV*'} · chai<input aria-label={`% DV chai ${index + 1}`} disabled={disabled} maxLength={160} value={row.secondaryDailyValue ?? ''} placeholder="%" onChange={event => onChange(displayRows.map((item, at) => at === index ? { ...item, secondaryDailyValue: event.target.value } : item))} /></label>}
      </div>)}
    </div>
  </div>;
}

export function ExtraDetailFields({ rows, disabled, onChange }: { rows: ProductDetail['sections']; disabled: boolean; onChange: (rows: ProductDetail['sections']) => void }) {
  return <div className={detailStyles.list}>
    {rows.map((row, index) => <div className={detailStyles.sectionRow} key={index}>
      <label>Tiêu đề<input aria-label={`Tiêu đề mục ${index + 1}`} disabled={disabled} maxLength={160} value={row.title} placeholder="Ví dụ: Quy cách đóng thùng" onChange={event => onChange(rows.map((item, at) => at === index ? { ...item, title: event.target.value } : item))} /></label>
      <button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa mục ${index + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}><Trash2 size={17} /></button>
      <label className={detailStyles.sectionBody}>Nội dung<textarea aria-label={`Nội dung mục ${index + 1}`} disabled={disabled} rows={3} value={row.body} onChange={event => onChange(rows.map((item, at) => at === index ? { ...item, body: event.target.value } : item))} /></label>
    </div>)}
    <button type="button" className={styles.textButton} disabled={disabled || rows.length >= 20} onClick={() => onChange([...rows, { title: '', body: '' }])}><Plus size={16} /> Thêm mục thông tin</button>
  </div>;
}
