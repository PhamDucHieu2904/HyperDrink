import type { CatalogData, Display2D, Display3D, Flavor, Label, MediaAsset, Model3D, PackagingCategory, PackagingSlot, PackagingVariant, ProductGroup, ProductVariant } from './contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility, groupHasOnlyDisabledProducts, slotHasOnlyDisabledProducts } from './compatibility';
import { hasValidationErrors, validateCatalog } from './validation';
import { isImageMedia } from './media-roles';
import { catalogWithDefaults } from './contracts';

export interface StorefrontSelectionRequest { groupId?: string; slotId?: string; variantId?: string }
export interface StorefrontSelection {
  groups: ProductGroup[];
  group?: ProductGroup;
  slots: PackagingSlot[];
  slot?: PackagingSlot;
  variants: ProductVariant[];
  variant?: ProductVariant;
  flavor?: Flavor;
  packaging?: PackagingVariant;
  category?: PackagingCategory;
}
export interface StorefrontProduct {
  variant: ProductVariant;
  group: ProductGroup;
  slot: PackagingSlot;
  flavor: Flavor;
  packaging: PackagingVariant;
  category: PackagingCategory;
  thumbnail?: MediaAsset;
  image2d?: MediaAsset;
  display3d?: Display3D;
  display2d?: Display2D;
  model?: Model3D;
  label?: Label;
  catalogItem?: import('./contracts').CatalogItem;
  productDetail?: import('./contracts').ProductDetail;
}
export interface PublishedCatalog {
  catalog: CatalogData;
  releaseId: string;
  publishedAt: string;
  schemaVersion: 1;
  source: 'api' | 'static';
}

const active = <T extends { lifecycle: string }>(items: T[]) => items.filter(item => item.lifecycle === 'active');
const positioned = <T extends { position: number; id: string }>(a: T, b: T) => a.position - b.position || a.id.localeCompare(b.id);

function storefrontGroups(data: CatalogData, surface: 'hero' | 'catalog' = 'hero'): ProductGroup[] {
  const drinkIds = new Set(active(data.drinkTypes).map(item => item.id));
  return active(data.productGroups).filter(item => (surface === 'hero' ? item.visible : item.visible || item.collectionVisible === true) && drinkIds.has(item.drinkTypeId) && !groupHasOnlyDisabledProducts(data, item.id)).sort(positioned);
}

function storefrontSlots(data: CatalogData, groupId: string): PackagingSlot[] {
  const categories = new Set(active(data.packagingCategories).map(item => item.id));
  const packaging = new Set(active(data.packagingVariants).filter(item => categories.has(item.categoryId)).map(item => item.id));
  return active(data.packagingSlots).filter(item => item.enabled && item.groupId === groupId && packaging.has(item.packagingVariantId) && !slotHasOnlyDisabledProducts(data, item)).sort(positioned);
}

function storefrontVariants(data: CatalogData, slot: PackagingSlot): ProductVariant[] {
  const flavors = new Map(active(data.flavors).map(item => [item.id, item]));
  return active(data.productVariants)
    .filter(item => item.enabled && item.groupId === slot.groupId && item.packagingVariantId === slot.packagingVariantId && flavors.has(item.flavorId))
    .sort((a, b) => positioned(flavors.get(a.flavorId)!, flavors.get(b.flavorId)!) || a.id.localeCompare(b.id));
}

/** Requested IDs are scoped to their parent before applying defaults, including after a new release. */
export function resolveStorefrontSelection(data: CatalogData, request: StorefrontSelectionRequest = {}): StorefrontSelection {
  const groups = storefrontGroups(data);
  const group = groups.find(item => item.id === request.groupId) || groups[0];
  const slots = group ? storefrontSlots(data, group.id) : [];
  const slot = slots.find(item => item.id === request.slotId) || slots[0];
  const variants = slot ? storefrontVariants(data, slot) : [];
  const variant = variants.find(item => item.id === request.variantId) || variants.find(item => item.id === slot?.defaultVariantId) || variants[0];
  const flavor = data.flavors.find(item => item.id === variant?.flavorId && item.lifecycle === 'active');
  const packaging = data.packagingVariants.find(item => item.id === slot?.packagingVariantId && item.lifecycle === 'active');
  const category = data.packagingCategories.find(item => item.id === packaging?.categoryId && item.lifecycle === 'active');
  return { groups, group, slots, slot, variants, variant, flavor, packaging, category };
}

/** Pick an entry flavor once; persist these IDs so refreshes and translations keep the same choice. */
export function randomStorefrontEntry(data: CatalogData, request: StorefrontSelectionRequest, sample: number): StorefrontSelectionRequest {
  if (request.variantId) return request;
  const { group, slot, variants } = resolveStorefrontSelection(data, request);
  if (!group || !slot || !variants.length) return request;
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 1 - Number.EPSILON)) : 0;
  return { groupId: group.id, slotId: slot.id, variantId: variants[Math.floor(fraction * variants.length)].id };
}

/** Collection cards and the hero share one reachable graph and the same compatibility rules. */
export function catalogProducts(data: CatalogData, surface: 'hero' | 'catalog' = 'hero'): StorefrontProduct[] {
  const products: StorefrontProduct[] = [];
  const readyMedia = (id: string | null | undefined, role: MediaAsset['role']) => data.media.find(item => item.id === id && item.lifecycle === 'active' && item.status === 'ready' && item.role === role);
  for (const group of storefrontGroups(data, surface)) for (const slot of storefrontSlots(data, group.id)) {
    const packaging = data.packagingVariants.find(item => item.id === slot.packagingVariantId)!;
    const category = data.packagingCategories.find(item => item.id === packaging.categoryId)!;
    for (const variant of storefrontVariants(data, slot)) {
      const flavor = data.flavors.find(item => item.id === variant.flavorId)!;
      const display3d = slot.mode === '2d' ? undefined : active(data.displays3d).find(item => item.enabled && item.productVariantId === variant.id && !hasValidationErrors(checkDisplay3DCompatibility(data, item)));
      const display2d = active(data.displays2d).find(item => item.enabled && item.productVariantId === variant.id && !hasValidationErrors(checkDisplay2DCompatibility(data, item)));
      const asset2d = data.assets2d.find(item => item.id === display2d?.assetId);
      const thumbnail = data.media.find(item => item.id === flavor.thumbnailId && item.lifecycle === 'active' && item.status === 'ready' && isImageMedia(item));
      products.push({ variant, group, slot, flavor, packaging, category, thumbnail, image2d: readyMedia(asset2d?.mediaId, 'image-2d'), display3d, display2d, model: data.models3d.find(item => item.id === display3d?.modelId), label: data.labels.find(item => item.id === display3d?.labelId) });
    }
  }
  return products;
}

/** Validate untrusted API/static JSON before any UI follows its references or asset URLs. */
export function parsePublishedCatalog(input: unknown, source: PublishedCatalog['source']): PublishedCatalog {
  const envelope = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const value = envelope?.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data as Record<string, unknown> : null;
  if (!value || value.schemaVersion !== 1 || typeof value.releaseId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.releaseId) || typeof value.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.publishedAt) || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('Bản phát hành có định dạng hoặc phiên bản dữ liệu không được hỗ trợ.');
  const issues = validateCatalog(value.catalog, { mode: 'publish' });
  if (hasValidationErrors(issues)) throw new Error(`Dữ liệu bản phát hành không hợp lệ: ${issues.find(issue => issue.severity === 'error')?.message || 'Catalog không tương thích.'}`);
  return { catalog: catalogWithDefaults(value.catalog as CatalogData), releaseId: value.releaseId, publishedAt: value.publishedAt, schemaVersion: 1, source };
}
