import type { CatalogData, CatalogRecord, CollectionName, ProductVariant, ValidationIssue } from './contracts';
import { collectPublicCatalog } from './compatibility';
import { CATALOG_COLLECTIONS, CATALOG_REFERENCES, hasValidationErrors, preflightCatalog, validateCatalog, validateRecord } from './validation';

export class CatalogDomainError extends Error {
  readonly code: string;
  readonly issues: ValidationIssue[];
  constructor(code: string, message: string, issues: ValidationIssue[] = []) { super(message); this.name = 'CatalogDomainError'; this.code = code; this.issues = issues; }
}
export class RevisionConflictError extends CatalogDomainError {
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;
  constructor(expectedRevision: number | null, actualRevision: number | null) {
    super('revision_conflict', 'Dữ liệu đã thay đổi. Tải bản mới trước khi lưu lại.');
    this.name = 'RevisionConflictError'; this.expectedRevision = expectedRevision; this.actualRevision = actualRevision;
  }
}
export function assertRevision(current: Pick<CatalogRecord, 'revision'> | undefined, expectedRevision: number | null): void {
  const actual = current?.revision ?? null;
  if (actual !== expectedRevision) throw new RevisionConflictError(expectedRevision, actual);
}
export function assertActiveReleaseRevision(actualId: string | null, expectedId: string | null): void {
  if (actualId !== expectedId) throw new CatalogDomainError('release_conflict', 'Bản xuất bản đang hoạt động đã thay đổi. Tải lại lịch sử xuất bản.');
}

/** Database adapters must execute this read/compare/write inside their transaction. Inputs are never mutated. */
export function updateCatalogRecord(data: CatalogData, collection: CollectionName, record: CatalogRecord, expectedRevision: number | null, now = new Date().toISOString()): CatalogData {
  const recordIssues = validateRecord(collection, record);
  if (hasValidationErrors(recordIssues)) throw new CatalogDomainError('draft_invalid', 'Bản nháp có giá trị không hợp lệ.', recordIssues);
  const current = (data[collection] ?? []).find(item => item.id === record.id);
  assertRevision(current, expectedRevision);
  const updated = { ...structuredClone(record), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now } as CatalogRecord;
  const result = structuredClone(data);
  const records: CatalogRecord[] = result[collection] ??= [];
  const index = records.findIndex(item => item.id === record.id);
  if (index < 0) records.push(updated); else records[index] = updated;
  const issues = validateCatalog(result);
  if (hasValidationErrors(issues)) throw new CatalogDomainError('draft_integrity', 'Bản nháp có quan hệ hoặc tổ hợp trùng không hợp lệ.', issues);
  return result;
}

export interface UsageReference { collection: CollectionName; entityId: string; name: string; field: string }
export function getUsageReferences(data: CatalogData, collection: CollectionName, id: string): UsageReference[] {
  const references: UsageReference[] = [];
  const add = (sourceCollection: CollectionName, record: CatalogRecord, field: string) => references.push({ collection: sourceCollection, entityId: record.id, name: record.name, field });
  for (const reference of CATALOG_REFERENCES.filter(item => item.target === collection)) for (const record of data[reference.collection] ?? []) {
    if ((record as unknown as Record<string, unknown>)[reference.field] === id) add(reference.collection, record, reference.field);
  }
  if (collection === 'packagingVariants') for (const label of data.labels) for (const [index, compatibility] of label.compatibilities.entries()) if (compatibility.packagingVariantId === id) add('labels', label, `compatibilities.${index}.packagingVariantId`);
  if (collection === 'media') for (const asset of data.assets2d) for (const [index, mediaId] of asset.galleryIds.entries()) if (mediaId === id) add('assets2d', asset, `galleryIds.${index}`);
  return references;
}
export interface ArchiveImpact {
  references: UsageReference[];
  publicReferences: UsageReference[];
  affectsPublic: boolean;
  blockingIssues: ValidationIssue[];
}
const issueKey = (issue: ValidationIssue) => JSON.stringify([issue.collection, issue.entityId, issue.field, issue.code, issue.severity]);
export function getArchiveImpact(data: CatalogData, collection: CollectionName, id: string): ArchiveImpact {
  const target = data[collection].find(item => item.id === id);
  if (!target) throw new CatalogDomainError('record_not_found', 'Bản ghi không tồn tại.');
  const references = getUsageReferences(data, collection, id);
  const publicData = collectPublicCatalog(data);
  const publicReferences = references.filter(reference => publicData[reference.collection].some(record => record.id === reference.entityId));
  const after = structuredClone(data);
  const archived = after[collection].find(item => item.id === id)!;
  archived.lifecycle = 'archived';
  const existing = new Set(preflightCatalog(data).map(issueKey));
  const blockingIssues = preflightCatalog(after).filter(issue => issue.severity === 'error' && !existing.has(issueKey(issue)));
  return { references, publicReferences, affectsPublic: publicData[collection].some(record => record.id === id), blockingIssues };
}
export function archiveCatalogRecord(data: CatalogData, collection: CollectionName, id: string, expectedRevision: number, options: { allowPublicImpact?: boolean; now?: string } = {}): CatalogData {
  const current = data[collection].find(item => item.id === id);
  assertRevision(current, expectedRevision);
  if (!current) throw new CatalogDomainError('record_not_found', 'Bản ghi không tồn tại.');
  const impact = getArchiveImpact(data, collection, id);
  if (!options.allowPublicImpact && impact.blockingIssues.length) throw new CatalogDomainError('archive_in_use', 'Lưu trữ bản ghi này sẽ làm cấu hình đang hiển thị không hợp lệ. Gỡ hoặc thay các liên kết trước.', impact.blockingIssues);
  return updateCatalogRecord(data, collection, { ...current, lifecycle: 'archived' }, expectedRevision, options.now);
}

export interface ProductVariantInput { groupId: string; packagingVariantId: string; flavorId: string; name?: string; code?: string; description?: string }
export function ensureProductVariant(data: CatalogData, input: ProductVariantInput, id: string, now = new Date().toISOString()): { data: CatalogData; variant: ProductVariant; created: boolean } {
  const existing = data.productVariants.find(variant => variant.lifecycle === 'active' && variant.groupId === input.groupId && variant.packagingVariantId === input.packagingVariantId && variant.flavorId === input.flavorId);
  if (existing) return { data: structuredClone(data), variant: structuredClone(existing), created: false };
  const group = data.productGroups.find(item => item.id === input.groupId && item.lifecycle === 'active');
  const packaging = data.packagingVariants.find(item => item.id === input.packagingVariantId && item.lifecycle === 'active');
  const flavor = data.flavors.find(item => item.id === input.flavorId && item.lifecycle === 'active');
  if (!group || !packaging || !flavor) throw new CatalogDomainError('variant_reference_invalid', 'Chọn dòng sản phẩm, quy cách và hương đang active trước khi tạo tổ hợp.');
  const name = input.name?.trim() || `${group.name} · ${flavor.name} · ${packaging.name}`;
  const variant: ProductVariant = { id, name, slug: `variant-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now, groupId: group.id, packagingVariantId: packaging.id, flavorId: flavor.id, code: input.code ?? '', description: input.description ?? '', enabled: true };
  const result = updateCatalogRecord(data, 'productVariants', variant, null, now);
  return { data: result, variant: structuredClone(result.productVariants.find(item => item.id === id)!), created: true };
}

/** Reordering is one domain operation, preventing transient duplicate positions during a button swap. */
export function reorderPackagingSlots(data: CatalogData, groupId: string, ids: readonly string[], expectedRevisions: Readonly<Record<string, number>>, now = new Date().toISOString()): CatalogData {
  const slots = data.packagingSlots.filter(slot => slot.groupId === groupId && slot.lifecycle === 'active');
  if (new Set(ids).size !== ids.length || slots.length !== ids.length || slots.some(slot => !ids.includes(slot.id))) throw new CatalogDomainError('invalid_reorder', 'Danh sách thứ tự phải chứa đầy đủ mỗi slot active đúng một lần.');
  const result = structuredClone(data);
  for (const [position, id] of ids.entries()) {
    const slot = result.packagingSlots.find(item => item.id === id)!;
    assertRevision(slot, expectedRevisions[id] ?? null);
    slot.position = position; slot.revision += 1; slot.updatedAt = now;
  }
  const issues = validateCatalog(result);
  if (hasValidationErrors(issues)) throw new CatalogDomainError('draft_integrity', 'Không thể áp dụng thứ tự slot.', issues);
  return result;
}

/** Root owns release IDs, actors and atomic pointer updates; this returns only the validated immutable payload. */
export function prepareCatalogRelease(data: CatalogData): CatalogData {
  const issues = preflightCatalog(data);
  if (hasValidationErrors(issues)) throw new CatalogDomainError('publish_invalid', 'Chưa thể xuất bản; giải quyết các lỗi trong danh sách kiểm tra.', issues);
  const result = structuredClone(collectPublicCatalog(data));
  // Stable order makes releases reproducible and reads buttons left-to-right, then top-to-bottom.
  for (const collection of CATALOG_COLLECTIONS) result[collection].sort((a, b) => {
    const aPosition = 'position' in a ? a.position : 0; const bPosition = 'position' in b ? b.position : 0;
    return aPosition - bPosition || a.id.localeCompare(b.id);
  });
  return result;
}
