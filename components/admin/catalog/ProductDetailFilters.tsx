import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import type { ProductDetailFilters as Filters, productDetailFilterOptions } from '@/lib/catalog/product-detail-filters';
import styles from '@/app/admin/admin.module.css';

interface Props {
  value: Filters;
  options: ReturnType<typeof productDetailFilterOptions>;
  active: boolean;
  onChange: (value: Filters) => void;
  onClear: () => void;
}
export default function ProductDetailFilters({ value, options, active, onChange, onClear }: Props) {
  return <section className={styles.detailFilters} aria-label="Bộ lọc Product Detail">
    <div className={styles.detailFilterHeading}><span><SlidersHorizontal size={16} aria-hidden="true" />Lọc chi tiết sản phẩm</span><button type="button" disabled={!active} onClick={onClear}><RotateCcw size={14} aria-hidden="true" />Xóa bộ lọc</button></div>
    <div className={styles.detailFilterFields}>
      <label>Loại nước<select value={value.drinkTypeId} onChange={event => onChange({ drinkTypeId: event.target.value, flavorId: '', packagingVariantId: '' })}><option value="">Tất cả loại nước</option>{options.drinkTypes.map(option => <option key={option.id} value={option.id}>{option.name} ({option.count})</option>)}</select></label>
      <label>Hương vị<select value={value.flavorId} onChange={event => onChange({ ...value, flavorId: event.target.value })}><option value="">Tất cả hương vị</option>{options.flavors.map(option => <option key={option.id} value={option.id}>{option.name} ({option.count})</option>)}</select></label>
      <label>Quy cách bao bì<select value={value.packagingVariantId} onChange={event => onChange({ ...value, packagingVariantId: event.target.value })}><option value="">Tất cả quy cách</option>{options.packaging.map(option => <option key={option.id} value={option.id}>{option.name} ({option.count})</option>)}</select></label>
    </div>
  </section>;
}
