import type { CatalogData, CatalogRecord, CollectionName, Entity, MediaAsset, MediaRole } from '@/lib/catalog/contracts';
export interface WorkspaceCallbacks {
  catalog: CatalogData;
  onSave: (collection: CollectionName, record: CatalogRecord, expectedRevision: number | null) => Promise<CatalogRecord | void>;
  onUpload: (file: File, role: MediaRole) => Promise<MediaAsset>;
  onRefresh: () => Promise<void> | void;
}
export function entity(name: string, original?: Entity): Entity {
  if (original) return { ...original, name };
  const id = crypto.randomUUID(), now = new Date().toISOString();
  return { id, name, slug: name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now };
}
export const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Không thể hoàn tất thao tác. Hãy thử lại.';
