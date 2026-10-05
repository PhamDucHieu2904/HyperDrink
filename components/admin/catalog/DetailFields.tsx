'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { NutritionRow, ProductDetail } from '@/lib/catalog/contracts';
import styles from '@/app/admin/admin.module.css';
import detailStyles from './detail-fields.module.css';

export function NutritionFields({ rows, disabled, onChange }: { rows: NutritionRow[]; disabled: boolean; onChange: (rows: NutritionRow[]) => void }) {
  return <div className={detailStyles.list}>
    {rows.map((row, index) => <div className={detailStyles.nutritionRow} key={index}>
      {([{ key: 'label', title: 'Chỉ tiêu', placeholder: 'Total carbohydrate' }, { key: 'amount', title: 'Hàm lượng', placeholder: '9.5 g' }, { key: 'dailyValue', title: '% hàng ngày', placeholder: '3%' }] as const).map(field => <label key={field.key}>{field.title}<input aria-label={`${field.title} ${index + 1}`} disabled={disabled} maxLength={160} value={row[field.key]} placeholder={field.placeholder} onChange={event => onChange(rows.map((item, at) => at === index ? { ...item, [field.key]: event.target.value } : item))} /></label>)}
      <button type="button" className={styles.iconButton} disabled={disabled} aria-label={`Xóa chỉ tiêu ${index + 1}`} onClick={() => onChange(rows.filter((_, at) => at !== index))}><Trash2 size={17} /></button>
    </div>)}
    <button type="button" className={styles.textButton} disabled={disabled || rows.length >= 40} onClick={() => onChange([...rows, { label: '', amount: '', dailyValue: '' }])}><Plus size={16} /> Thêm chỉ tiêu dinh dưỡng</button>
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
