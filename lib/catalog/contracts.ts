/** Admin domain v1. Stable IDs identify records; human-facing labels stay editable. */
export type EntityId = string;
export type Lifecycle = 'active' | 'archived';
export type MediaStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
export type MediaRole = 'fruit' | 'leaf' | 'splash' | 'ice' | 'thumbnail' | 'icon' | 'label' | 'model' | 'poster' | 'image-2d';
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
  /** Optional reusable uploaded icon; the built-in icon remains the fallback. */
  iconId?: EntityId | null;
  thumbnailId: EntityId | null;
  /** Legacy releases keep the shared ice preset until this flavor adopts an editable pool. */
  icePoolConfigured?: boolean;
  position: number;
}
export interface FlavorAsset extends Entity {
  flavorId: EntityId;
  mediaId: EntityId;
  role: 'fruit' | 'leaf' | 'splash' | 'ice';
  position: number;
  enabled: boolean;
}
/** The pool supplies its flavor; names, ordering and enabled state are assigned on save. */
export interface FlavorPoolAssetInput {
  id: EntityId;
  flavorId: EntityId;
  mediaId: EntityId;
  role: FlavorAsset['role'];
}
export interface ProductGroup extends Entity {
  drinkTypeId: EntityId;
  description: string;
  buttonLabel: string;
  /** Editable product messages on the hero card; the volume itself comes from packaging. */
  heroVolumeCaption?: string;
  heroFlavorText?: string;
  heroOriginText?: string;
  position: number;
  visible: boolean;
  /** Collection settings are independent of the Best seller buttons; old releases inherit visible/position. */
  collectionVisible?: boolean;
  collectionTitle?: string;
  collectionPosition?: number;
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
  /** Explicit Mockup publication root; absent fields inherit only public sales displays. */
  mockupVisible?: boolean;
  mockupPosition?: number;
  drinkTypeId: EntityId;
  flavorId: EntityId | null;
  mediaId: EntityId | null;
  compatibilities: { packagingVariantId: EntityId; layoutProfile: string }[];
}
export interface Model3D extends Entity {
  /** Independent from sales displays; false hides this model only in Mockup. */
  mockupVisible?: boolean;
  mockupPosition?: number;
  /** Front-view correction in radians, applied only by the Mockup controller. */
  mockupFrontYaw?: number;
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
  /** Null/absent follows the flavor accent; an explicit hex affects only the liquid slot. */
  liquidColor?: string | null;
  /** Null/absent keeps the bottle's default cap; an explicit hex affects only the cap. */
  capColor?: string | null;
  /** Horizontal label alignment, percent of one UV wrap (-50…50). */
  labelOffset?: number;
  enabled: boolean;
}
export interface Display2D extends Entity {
  productVariantId: EntityId;
  assetId: EntityId | null;
  alt: string;
  enabled: boolean;
}
export interface NutritionRow { label: string; amount: string; dailyValue: string }
export interface ProductDetail extends Entity {
  labelId: EntityId;
  posterId: EntityId | null;
  eyebrow: string;
  headline: string;
  subtitle: string;
  introduction: string;
  ingredients: string;
  allergens: string;
  servingSize: string;
  nutrition: NutritionRow[];
  companyName: string;
  companyAddress: string;
  countryOfOrigin: string;
  netContent: string;
  storage: string;
  shelfLife: string;
  sections: { title: string; body: string }[];
  enabled: boolean;
}
/** Editorial catalog collections are independent of the rotating hero. */
export interface CatalogCollection extends Entity {
  drinkTypeId: string;
  homeVisible: boolean;
  enabled: boolean;
  position: number;
}
export interface CatalogItem extends Entity {
  collectionId: string;
  mediaId: string | null;
  productDetailId: string | null;
  packagingVariantId: string;
  position: number;
  enabled: boolean;
}
export interface CatalogData {
  schemaVersion: 1;
  homepageLayout?: import('./homepage-layout').HomepageLayout;
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
  productDetails: ProductDetail[];
  catalogCollections: CatalogCollection[];
  catalogItems: CatalogItem[];
}
/** New editorial data does not invalidate immutable releases created before this collection existed. */
export function catalogWithDefaults(data: CatalogData): CatalogData {
  return { ...data, productDetails: data.productDetails ?? [], catalogCollections: data.catalogCollections ?? [], catalogItems: data.catalogItems ?? [] };
}
export type CollectionName = Exclude<keyof CatalogData, 'schemaVersion' | 'homepageLayout'>;
export type CatalogRecord = CatalogData[CollectionName][number];
export interface DisplayDraftSave {
  mode: '3d' | '2d';
  variant: ProductVariant;
  expectedVariantRevision: number | null;
  display: Display3D | Display2D;
  expectedDisplayRevision: number | null;
  slot: PackagingSlot | null;
  expectedSlotRevision: number | null;
}
export interface DisplayDraftResult { catalog: CatalogData; display: Display3D | Display2D }
export interface DisplayAction {
  mode: '3d' | '2d';
  id: EntityId;
  expectedRevision: number;
  expectedDraftHash: string;
  action: 'set-enabled' | 'delete';
  enabled?: boolean;
}
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
/** Includes the active release. Older releases are removed only by an admin. */
export const MAX_CATALOG_RELEASES = 10;
export interface DeleteRecordResult { catalog: CatalogData; issues: ValidationIssue[] }
export type DeleteRecordHandler = (collection: CollectionName, id: string, expectedRevision: number, expectedDraftHash: string) => Promise<DeleteRecordResult>;
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
  deleteRelease(releaseId: string, actor: string, expectedReleaseId: string | null): Promise<void>;
}
