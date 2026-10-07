import canManifest from '@/public/models/cans/assets.manifest.json';
import { beverageLines } from '@/lib/beverage-lines';
import { showcaseFlavors } from '@/lib/showcase-flavors';
import type { CatalogData, Entity, MediaAsset, PackagingCategory, PackagingVariant } from './contracts';

export function newEntity(name: string, id = crypto.randomUUID()): Entity {
  const now = new Date().toISOString();
  return { id, name, slug: name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now };
}

/** Existing assets are draft seed content, never automatically published. */
export function createSeedCatalog(): CatalogData {
  const entity = (name: string, id: string) => ({ ...newEntity(name, id), revision: 1 });
  const categoryNames = [['alu-can', 'Alu can', 'can'], ['glass-bottle', 'Glass bottle', 'glass'], ['pp-bottle', 'PP bottle', 'pp'], ['pet-bottle', 'PET bottle', 'pet'], ['other', 'Other', 'other']] as const;
  const packagingCategories: PackagingCategory[] = categoryNames.map(([id, name, viewerKind], position) => ({ ...entity(name, id), viewerKind, position }));
  const packagingVariants: PackagingVariant[] = canManifest.assets.map((model, position) => ({ ...entity(model.id === 'can-250-short' ? '250 ml short' : model.id === 'can-250' ? '250 ml sleek' : model.label, model.id), categoryId: 'alu-can', volumeMl: model.volumeMl, shape: model.id === 'can-250-short' ? 'short' : model.id === 'can-250' ? 'sleek' : 'standard', position }));
  const media: MediaAsset[] = [
    ...showcaseFlavors.map(flavor => ({ ...entity(flavor.name, `thumbnail-${flavor.id}`), role: 'thumbnail' as const, status: 'ready' as const, url: `/assets/flavors/${flavor.image}`, storageKey: '', mime: 'image/jpeg', bytes: 0, sha256: '', width: null, height: null, imageBounds: null, error: '' })),
    ...canManifest.assets.map(model => ({ ...entity(model.label, `model-${model.id}`), role: 'model' as const, status: 'ready' as const, url: model.src, storageKey: '', mime: 'model/gltf-binary', bytes: model.bytes, sha256: model.sha256, width: null, height: null, imageBounds: null, error: '' })),
  ];
  return {
    schemaVersion: 1,
    drinkTypes: [...beverageLines, { id: 'aloe-vera', label: 'Aloe Vera' }].map((line, position) => ({ ...entity(line.label, line.id), description: '', position })),
    packagingCategories, packagingVariants,
    flavors: showcaseFlavors.map((flavor, position) => ({ ...entity(flavor.name, flavor.id), shortName: flavor.short, description: flavor.note, accentColor: flavor.color, backgroundColor: flavor.background, textColor: '#ffffff', icon: flavor.id, thumbnailId: `thumbnail-${flavor.id}`, position })),
    flavorAssets: [],
    productGroups: [{ ...entity('Juice 30%', 'juice-30'), drinkTypeId: 'juice', description: 'Dòng mẫu để cấu hình; chưa xuất bản.', buttonLabel: 'Juice 30%', position: 0, visible: false }],
    productVariants: [], packagingSlots: [], media, labels: [],
    models3d: canManifest.assets.map(model => ({ ...entity(`Alu can ${packagingVariants.find(item=>item.id===model.id)?.name||model.label}`, `registry-${model.id}`), packagingVariantId: model.id, mediaId: `model-${model.id}`, posterId: null, layoutProfile: 'can-wrap-v1', materialSlots: model.materialSlots, orientation: [0, 0, 0] })),
    assets2d: [], displays3d: [], displays2d: [], productDetails: [], catalogCollections: [], catalogItems: [],
  };
}
