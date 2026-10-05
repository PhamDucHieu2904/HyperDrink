import type { CatalogData, CatalogRecord, CollectionName, PackagingSlot, ValidationIssue } from './contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility } from './compatibility';
import { assertRevision, CatalogDomainError, getUsageReferences, type UsageReference } from './service';
import { CATALOG_REFERENCES, hasValidationErrors, preflightCatalog, validateCatalog } from './validation';

export interface DeletionImpact {
  records: { collection: CollectionName; id: string; name: string }[];
  defaults: { id: string; name: string; variantId: string | null; variantName: string }[];
  references: UsageReference[];
  publicationIssues: ValidationIssue[];
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
  const include = (collection: CollectionName, record: CatalogRecord) => {
    if (!records.some(item => item.collection === collection && item.id === record.id)) records.push({ collection, id: record.id, name: record.name });
  };
  // Only owned records cascade. Shared models, artwork and media remain in their libraries.
  if (collection === 'productGroups') {
    data.packagingSlots.filter(item => item.groupId === id).forEach(item => include('packagingSlots', item));
    data.productVariants.filter(item => item.groupId === id).forEach(item => include('productVariants', item));
  }
  if (collection === 'flavors' || collection === 'media') data.flavorAssets
    .filter(item => collection === 'flavors' ? item.flavorId === id : item.mediaId === id)
    .forEach(item => include('flavorAssets', item));
  for (const variant of records.filter(item => item.collection === 'productVariants')) for (const displayCollection of ['displays3d', 'displays2d'] as const) {
    data[displayCollection].filter(item => item.productVariantId === variant.id).forEach(item => include(displayCollection, item));
  }
  const after = structuredClone(data);
  const defaults: DeletionImpact['defaults'] = [];
  for (const record of records) {
    const list: CatalogRecord[] = after[record.collection];
    list.splice(list.findIndex(item => item.id === record.id), 1);
  }
  const changed = new Set<CatalogRecord>();
  const touch = (record: CatalogRecord) => { changed.add(record); };
  const references = records.flatMap(record => getUsageReferences(data, record.collection, record.id)).filter(reference =>
    !records.some(record => record.collection === reference.collection && record.id === reference.entityId));
  // Blank required selections are valid drafts. Never persist dangling IDs; preflight
  // reports missing selections for the configurations that will be published.
  for (const removed of records) for (const reference of CATALOG_REFERENCES.filter(item => item.target === removed.collection)) {
    for (const record of after[reference.collection] ?? []) {
      const fields = record as unknown as Record<string, unknown>;
      if (fields[reference.field] === removed.id) { fields[reference.field] = reference.nullable ? null : ''; touch(record); }
    }
  }
  if (collection === 'packagingVariants') for (const label of after.labels) {
    const compatibilities = label.compatibilities.filter(item => item.packagingVariantId !== id);
    if (compatibilities.length !== label.compatibilities.length) { label.compatibilities = compatibilities; touch(label); }
  }
  if (collection === 'media') for (const asset of after.assets2d) {
    if (asset.galleryIds.includes(id)) { asset.galleryIds = asset.galleryIds.filter(item => item !== id); touch(asset); }
  }
  for (const slot of after.packagingSlots) {
    const previous = data.packagingSlots.find(item => item.id === slot.id)!;
    const variant = after.productVariants.find(item => item.id === slot.defaultVariantId);
    if (previous.defaultVariantId && (!variant || variant.groupId !== slot.groupId || variant.packagingVariantId !== slot.packagingVariantId)) {
      const candidates = after.productVariants.filter(item => item.lifecycle === 'active' && item.enabled && item.groupId === slot.groupId && item.packagingVariantId === slot.packagingVariantId);
      const replacement = candidates.find(item => availableInSlot(after, slot, item.id)) || candidates[0];
      slot.defaultVariantId = replacement?.id || null; touch(slot);
      defaults.push({ id: slot.id, name: slot.name, variantId: slot.defaultVariantId, variantName: replacement?.name || '' });
    }
  }
  for (const record of changed) { record.revision++; record.updatedAt = now; }
  const issueKey = (issue: ValidationIssue) => JSON.stringify([issue.collection, issue.entityId, issue.field, issue.code, issue.severity]);
  const existing = new Set(preflightCatalog(data).map(issueKey));
  const structural = validateCatalog(after).filter(issue => issue.severity === 'error');
  if (structural.length) throw new CatalogDomainError('delete_invalid', 'Không thể lưu thay đổi xóa do bản nháp không hợp lệ. Tải lại dữ liệu.', structural);
  const publicationIssues = preflightCatalog(after).filter(issue => issue.severity === 'error' && !existing.has(issueKey(issue)));
  const detachedReferences = references.filter(reference => !(reference.collection === 'packagingSlots' && reference.field === 'defaultVariantId' && defaults.some(slot => slot.id === reference.entityId)));
  return { after, impact: { records, defaults, references: detachedReferences, publicationIssues } satisfies DeletionImpact };
}

/** Preview and commit derive the same plan. The repository additionally checks
 * the full draft hash inside its transaction, so the reviewed scope is stable. */
export function getDeletionImpact(data: CatalogData, collection: CollectionName, id: string): DeletionImpact {
  return deletionPlan(data, collection, id, new Date().toISOString()).impact;
}

export function deleteCatalogRecord(data: CatalogData, collection: CollectionName, id: string, expectedRevision: number, now = new Date().toISOString()): CatalogData {
  assertRevision(data[collection].find(item => item.id === id), expectedRevision);
  return deletionPlan(data, collection, id, now).after;
}
