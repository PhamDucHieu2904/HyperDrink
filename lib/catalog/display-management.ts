import type { CatalogData, DisplayAction, PackagingSlot } from './contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility } from './compatibility';
import { assertRevision, CatalogDomainError } from './service';
import { hasValidationErrors, validateCatalog } from './validation';

function hasDisplay(data: CatalogData, variantId: string, mode: PackagingSlot['mode']): boolean {
  const enabled3d = data.displays3d.some(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  const enabled2d = data.displays2d.some(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  return mode === '3d' ? enabled3d : mode === '2d' ? enabled2d : enabled3d || enabled2d;
}

function readyInSlot(data: CatalogData, variantId: string, slot: PackagingSlot): boolean {
  const display3d = data.displays3d.find(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  const display2d = data.displays2d.find(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  const ready3d = !!display3d && !hasValidationErrors(checkDisplay3DCompatibility(data, display3d));
  const ready2d = !!display2d && !hasValidationErrors(checkDisplay2DCompatibility(data, display2d));
  return slot.mode === '3d' ? ready3d : slot.mode === '2d' ? ready2d : ready3d || ready2d;
}

/** The card and editor share the same visibility operation. Keep a disabled
 * product tuple for recreation, and never remove shared artwork or models. */
export function synchronizeDisplayAvailability(data: CatalogData, variantId: string, now: string): void {
  const variant = data.productVariants.find(item => item.id === variantId);
  if (!variant) throw new CatalogDomainError('record_not_found', 'Tổ hợp sản phẩm không còn tồn tại. Tải lại dữ liệu.');
  const slots = data.packagingSlots.filter(item => item.lifecycle === 'active' && item.groupId === variant.groupId && item.packagingVariantId === variant.packagingVariantId);
  const enabled = hasDisplay(data, variantId, slots[0]?.mode || 'auto');
  if (variant.enabled !== enabled) { variant.enabled = enabled; variant.revision++; variant.updatedAt = now; }
  for (const slot of slots) {
    const candidates = data.productVariants.filter(item => item.lifecycle === 'active' && item.enabled && item.groupId === slot.groupId && item.packagingVariantId === slot.packagingVariantId)
      .sort((a, b) => {
        const aPosition = data.flavors.find(item => item.id === a.flavorId)?.position ?? 0;
        const bPosition = data.flavors.find(item => item.id === b.flavorId)?.position ?? 0;
        return aPosition - bPosition || a.id.localeCompare(b.id);
      });
    if (candidates.some(item => item.id === slot.defaultVariantId)) continue;
    const replacement = candidates.find(item => readyInSlot(data, item.id, slot)) || candidates[0];
    const defaultId = replacement?.id || null;
    if (slot.defaultVariantId !== defaultId) { slot.defaultVariantId = defaultId; slot.revision++; slot.updatedAt = now; }
  }
}

export function applyDisplayAction(data: CatalogData, input: DisplayAction, now = new Date().toISOString()): CatalogData {
  if ((input.mode !== '3d' && input.mode !== '2d') || !['set-enabled', 'delete'].includes(input.action) || (input.action === 'set-enabled' && typeof input.enabled !== 'boolean')) throw new CatalogDomainError('display_action_invalid', 'Thao tác hiển thị không hợp lệ.');
  const collection = input.mode === '3d' ? 'displays3d' : 'displays2d';
  const original = data[collection].find(item => item.id === input.id && item.lifecycle === 'active');
  if (!original) throw new CatalogDomainError('record_not_found', 'Cấu hình không còn tồn tại. Tải lại danh sách.');
  assertRevision(original, input.expectedRevision);
  const catalog = structuredClone(data);
  if (input.action === 'delete') catalog[collection].splice(catalog[collection].findIndex(item => item.id === input.id), 1);
  else {
    const display = catalog[collection].find(item => item.id === input.id)!;
    display.enabled = input.enabled!; display.revision++; display.updatedAt = now;
  }
  synchronizeDisplayAvailability(catalog, original.productVariantId, now);
  const issues = validateCatalog(catalog);
  if (hasValidationErrors(issues)) throw new CatalogDomainError('draft_integrity', 'Chưa thể cập nhật cấu hình hiển thị.', issues);
  return catalog;
}
