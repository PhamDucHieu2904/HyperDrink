import type { CatalogData, CollectionName, DisplayDraftResult, DisplayDraftSave, Entity } from './contracts';
import { CatalogDomainError, updateCatalogRecord } from './service';

/** Display forms do not expose slugs. Reuse stable slugs on edits, and allocate
 * an available slug for new records against the current transaction snapshot. */
function automaticSlug<T extends Entity>(data: CatalogData, collection: CollectionName, record: T, revision: number | null): T {
  if (revision !== null) return record;
  const used = new Set(data[collection].filter(item => item.lifecycle === 'active' && item.id !== record.id).map(item => item.slug));
  let slug = record.slug;
  for (let suffix = 2; used.has(slug); suffix++) slug = `${record.slug.slice(0, 160 - String(suffix).length - 1).replace(/-+$/, '')}-${suffix}`;
  return { ...record, slug };
}

/** Build and validate the entire operation without writing intermediate data.
 * The repository commits this graph and its audit entries in one transaction. */
export function saveDisplayDraft(data: CatalogData, input: DisplayDraftSave, now = new Date().toISOString()): DisplayDraftResult {
  const { mode, variant, display, slot } = input;
  if ((mode !== '3d' && mode !== '2d') || !variant || !display || display.productVariantId !== variant.id || (slot && (slot.groupId !== variant.groupId || slot.packagingVariantId !== variant.packagingVariantId))) throw new CatalogDomainError('display_draft_invalid', 'Dòng sản phẩm, bao bì và hương vị của cấu hình không khớp.');
  for (const revision of [input.expectedVariantRevision, input.expectedDisplayRevision, input.expectedSlotRevision]) {
    if (revision !== null && (!Number.isInteger(revision) || revision < 1)) throw new CatalogDomainError('display_draft_invalid', 'Thông tin phiên bản không hợp lệ. Tải lại dữ liệu trước khi lưu.');
  }
  const collection = mode === '3d' ? 'displays3d' : 'displays2d';
  if (data[collection].some(item => item.lifecycle === 'active' && item.productVariantId === variant.id && item.id !== display.id)) throw new CatalogDomainError('display_exists', 'Tổ hợp này đã có cấu hình hiển thị. Mở cấu hình đang có để chỉnh sửa.');
  // Prevent creating a second product for an existing tuple, including retries
  // from another tab that was opened before the first configuration was saved.
  if (data.productVariants.some(item => item.lifecycle === 'active' && item.id !== variant.id && item.groupId === variant.groupId && item.packagingVariantId === variant.packagingVariantId && item.flavorId === variant.flavorId)) throw new CatalogDomainError('revision_conflict', 'Tổ hợp sản phẩm đã được tạo trong phiên khác. Tải lại dữ liệu rồi mở cấu hình đang có.');
  let catalog = updateCatalogRecord(data, 'productVariants', automaticSlug(data, 'productVariants', variant, input.expectedVariantRevision), input.expectedVariantRevision, now);
  catalog = updateCatalogRecord(catalog, collection, automaticSlug(catalog, collection, display, input.expectedDisplayRevision), input.expectedDisplayRevision, now);
  if (slot) catalog = updateCatalogRecord(catalog, 'packagingSlots', automaticSlug(catalog, 'packagingSlots', slot, input.expectedSlotRevision), input.expectedSlotRevision, now);
  return { catalog, display: catalog[collection].find(item => item.id === display.id)! };
}
