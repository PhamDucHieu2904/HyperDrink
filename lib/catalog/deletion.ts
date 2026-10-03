import type { CatalogData, CatalogRecord, CollectionName, PackagingSlot, ValidationIssue } from './contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility } from './compatibility';
import { assertRevision, CatalogDomainError, getUsageReferences, type UsageReference } from './service';
import { hasValidationErrors, preflightCatalog, validateCatalog } from './validation';

export interface DeletionImpact {
  records: { collection: CollectionName; id: string; name: string }[];
  defaults: { id: string; name: string; variantId: string | null; variantName: string }[];
  references: UsageReference[];
  blockingIssues: ValidationIssue[];
}

function availableInSlot(data: CatalogData, slot: PackagingSlot, variantId: string): boolean {
  const display3d = data.displays3d.find(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  const display2d = data.displays2d.find(item => item.lifecycle === 'active' && item.enabled && item.productVariantId === variantId);
  const ready3d = !!display3d && !hasValidationErrors(checkDisplay3DCompatibility(data, display3d));
  const ready2d = !!display2d && !hasValidationErrors(checkDisplay2DCompatibility(data, display2d));
  return slot.mode === '3d' ? ready3d : slot.mode === '2d' ? ready2d : ready3d || ready2d;
}

function deletionPlan(data: CatalogData, collection: CollectionName, id: string, now: string) {
  const target = data[collection].find(item => item.id === id);
  if (!target) throw new CatalogDomainError('record_not_found', 'Bản ghi không còn tồn tại. Tải lại dữ liệu.');
  const records: DeletionImpact['records'] = [{ collection, id, name: target.name }];
  // Displays belong to one product combination. Library assets are shared and
  // must never be cascaded from a product deletion, including archived displays.
  if (collection === 'productVariants') for (const displayCollection of ['displays3d', 'displays2d'] as const) {
    for (const display of data[displayCollection].filter(item => item.productVariantId === id)) records.push({ collection: displayCollection, id: display.id, name: display.name });
  }
  const after = structuredClone(data);
  const defaults: DeletionImpact['defaults'] = [];
  if (collection === 'productVariants') for (const slot of after.packagingSlots.filter(item => item.defaultVariantId === id)) {
    const candidates = data.productVariants.filter(item => item.id !== id && item.lifecycle === 'active' && item.enabled && item.groupId === slot.groupId && item.packagingVariantId === slot.packagingVariantId);
    const replacement = candidates.find(item => availableInSlot(data, slot, item.id)) || candidates[0];
    slot.defaultVariantId = replacement?.id || null; slot.revision++; slot.updatedAt = now;
    defaults.push({ id: slot.id, name: slot.name, variantId: slot.defaultVariantId, variantName: replacement?.name || '' });
  }
  for (const record of records) {
    const list: CatalogRecord[] = after[record.collection];
    list.splice(list.findIndex(item => item.id === record.id), 1);
  }
  const references = getUsageReferences(data, collection, id).filter(reference =>
    !records.some(record => record.collection === reference.collection && record.id === reference.entityId) &&
    !(reference.collection === 'packagingSlots' && reference.field === 'defaultVariantId' && defaults.some(slot => slot.id === reference.entityId)));
  const issueKey = (issue: ValidationIssue) => JSON.stringify([issue.collection, issue.entityId, issue.field, issue.code, issue.severity]);
  const existing = new Set(preflightCatalog(data).map(issueKey));
  const structural = validateCatalog(after).filter(issue => issue.severity === 'error');
  const blockingIssues = structural.length ? structural : preflightCatalog(after).filter(issue => issue.severity === 'error' && !existing.has(issueKey(issue)));
  return { after, impact: { records, defaults, references, blockingIssues } satisfies DeletionImpact };
}

/** Preview and commit derive the same plan. The repository additionally checks
 * the full draft hash inside its transaction, so the reviewed scope is stable. */
export function getDeletionImpact(data: CatalogData, collection: CollectionName, id: string): DeletionImpact {
  return deletionPlan(data, collection, id, new Date().toISOString()).impact;
}

export function deleteCatalogRecord(data: CatalogData, collection: CollectionName, id: string, expectedRevision: number, now = new Date().toISOString()): CatalogData {
  assertRevision(data[collection].find(item => item.id === id), expectedRevision);
  const { after, impact } = deletionPlan(data, collection, id, now);
  if (impact.references.length || impact.blockingIssues.length) throw new CatalogDomainError('delete_in_use', 'Chưa thể xóa: dữ liệu đang được dùng hoặc thao tác sẽ làm cấu hình khác thiếu dữ liệu. Thay các liên kết trước.', impact.blockingIssues);
  return after;
}
