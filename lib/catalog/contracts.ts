/** Admin domain v1. Stable IDs identify records; human-facing labels stay editable. */
export type EntityId = string;
export type Lifecycle = 'active' | 'archived';
export type MediaStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type MediaRole = 'fruit' | 'leaf' | 'splash' | 'thumbnail' | 'icon' | 'label' | 'model' | 'poster' | 'image-2d';
export type RenderMode = '3d' | '2d' | 'auto';
export type AdminRole = 'owner' | 'editor';

export interface Entity {
  id: EntityId;
  name: string;
  slug: string;
  lifecycle: Lifecycle;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrinkType extends Entity { description: string; position: number }
export interface PackagingCategory extends Entity {
  viewerKind: 'can' | 'glass' | 'pp' | 'pet' | 'pouch' | 'other';
  position: number;
}
export interface PackagingVariant extends Entity {
  categoryId: EntityId;
  volumeMl: number | null;
  shape: string;
  position: number;
}
export interface Flavor extends Entity {
  shortName: string;
  description: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  icon: string;
  thumbnailId: EntityId | null;
  position: number;
}
export interface FlavorAsset extends Entity {
  flavorId: EntityId;
  mediaId: EntityId;
  role: 'fruit' | 'leaf' | 'splash';
  position: number;
  enabled: boolean;
}
export interface ProductGroup extends Entity {
  drinkTypeId: EntityId;
  description: string;
  buttonLabel: string;
  position: number;
  visible: boolean;
}
export interface ProductVariant extends Entity {
  groupId: EntityId;
  packagingVariantId: EntityId;
  flavorId: EntityId;
  code: string;
  description: string;
  enabled: boolean;
}
export interface PackagingSlot extends Entity {
  groupId: EntityId;
  packagingVariantId: EntityId;
  regionKey: 'packaging-picker';
  position: number;
  buttonLabel: string;
  mode: RenderMode;
  defaultVariantId: EntityId | null;
  enabled: boolean;
}
export interface MediaAsset extends Entity {
  role: MediaRole;
  status: MediaStatus;
  url: string;
  storageKey: string;
  mime: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  imageBounds: [number, number, number, number] | null;
  error: string;
}
export interface Label extends Entity {
  drinkTypeId: EntityId;
  flavorId: EntityId | null;
  mediaId: EntityId | null;
  compatibilities: { packagingVariantId: EntityId; layoutProfile: string }[];
}
export interface Model3D extends Entity {
  packagingVariantId: EntityId;
  mediaId: EntityId | null;
  posterId: EntityId | null;
  layoutProfile: string;
  materialSlots: Record<string, string[]>;
  orientation: [number, number, number];
}
export interface Asset2D extends Entity {
  packagingVariantId: EntityId;
  drinkTypeId: EntityId;
  flavorId: EntityId | null;
  mediaId: EntityId | null;
  galleryIds: EntityId[];
  description: string;
}
export interface Display3D extends Entity {
  productVariantId: EntityId;
  modelId: EntityId | null;
  labelId: EntityId | null;
  enabled: boolean;
}
export interface Display2D extends Entity {
  productVariantId: EntityId;
  assetId: EntityId | null;
  alt: string;
  enabled: boolean;
}
export interface CatalogData {
  schemaVersion: 1;
  drinkTypes: DrinkType[];
  packagingCategories: PackagingCategory[];
  packagingVariants: PackagingVariant[];
  flavors: Flavor[];
  flavorAssets: FlavorAsset[];
  productGroups: ProductGroup[];
  productVariants: ProductVariant[];
  packagingSlots: PackagingSlot[];
  media: MediaAsset[];
  labels: Label[];
  models3d: Model3D[];
  assets2d: Asset2D[];
  displays3d: Display3D[];
  displays2d: Display2D[];
}
export type CollectionName = Exclude<keyof CatalogData, 'schemaVersion'>;
export type CatalogRecord = CatalogData[CollectionName][number];
export interface ValidationIssue {
  code: string;
  message: string;
  collection: CollectionName;
  entityId: EntityId;
  field?: string;
  severity: 'error' | 'warning';
}
export interface CatalogRelease {
  id: EntityId;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  note: string;
  data: CatalogData;
}
export interface ApiError { code: string; message: string; fieldErrors?: Record<string, string> }
export interface AdminSession { userId: string; email: string; role: AdminRole }
export interface CatalogRepository {
  readDraft(): Promise<CatalogData>;
  saveRecord(collection: CollectionName, record: CatalogRecord, expectedRevision: number | null): Promise<CatalogRecord>;
  archiveRecord(collection: CollectionName, id: string, expectedRevision: number): Promise<void>;
  listReleases(): Promise<Omit<CatalogRelease, 'data'>[]>;
  readActiveRelease(): Promise<CatalogRelease | null>;
  publish(data: CatalogData, actor: string, note: string, expectedReleaseId: string | null): Promise<CatalogRelease>;
  rollback(releaseId: string, actor: string, expectedReleaseId: string | null): Promise<void>;
}
