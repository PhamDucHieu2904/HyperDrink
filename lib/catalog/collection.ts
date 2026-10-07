import type { CatalogData, DrinkType, ProductGroup } from './contracts';
import { catalogProducts, type StorefrontProduct } from './storefront';
import { normalizeSearch } from '../i18n/catalog';

export interface CollectionSection { group: ProductGroup; title: string; products: StorefrontProduct[] }
const usesLegacyCollections = (data: CatalogData) => data.catalogCollections === undefined || (!data.catalogCollections.length && data.productGroups.some(group => group.collectionVisible === true));

/** Resolve only editorial 2D items; no geometry or hero slots are needed. */
export function collectionProducts(data: CatalogData): StorefrontProduct[] {
  if (usesLegacyCollections(data)) return catalogProducts(data, 'catalog');
  const products: StorefrontProduct[] = [];
  for (const collection of data.catalogCollections.filter(item => item.lifecycle === 'active' && item.enabled).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const drink = data.drinkTypes.find(item => item.id === collection.drinkTypeId && item.lifecycle === 'active');
    if (!drink) continue;
    const group: ProductGroup = { ...collection, buttonLabel: collection.name, description: '', visible: false, collectionVisible: collection.homeVisible, collectionTitle: collection.name, collectionPosition: collection.position };
    for (const item of (data.catalogItems ?? []).filter(item => item.collectionId === collection.id && item.lifecycle === 'active' && item.enabled).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
      const detail = data.productDetails.find(record => record.id === item.productDetailId && record.lifecycle === 'active' && record.enabled);
      const label = data.labels.find(record => record.id === detail?.labelId && record.lifecycle === 'active' && record.drinkTypeId === collection.drinkTypeId);
      const packaging = data.packagingVariants.find(record => record.id === item.packagingVariantId && record.lifecycle === 'active');
      const category = data.packagingCategories.find(record => record.id === packaging?.categoryId && record.lifecycle === 'active');
      const image2d = data.media.find(record => record.id === item.mediaId && record.lifecycle === 'active' && record.status === 'ready' && record.role === 'image-2d');
      if (!detail || !label || !packaging || !category || !image2d || !label.compatibilities.some(entry => entry.packagingVariantId === packaging.id)) continue;
      const flavor = data.flavors.find(record => record.id === label.flavorId) ?? { ...item, shortName: item.name, description: '', accentColor: '#bfd9c8', backgroundColor: '#eaf2e3', textColor: '#153e32', icon: 'leaf', iconId: null, thumbnailId: null, position: item.position };
      products.push({ group, packaging, category, flavor, label, image2d, productDetail: detail, catalogItem: item,
        variant: { ...item, groupId: collection.id, packagingVariantId: packaging.id, flavorId: flavor.id, code: '', description: detail.subtitle },
        slot: { ...collection, groupId: collection.id, packagingVariantId: packaging.id, regionKey: 'packaging-picker', buttonLabel: packaging.name, mode: '2d', defaultVariantId: item.id } });
    }
  }
  return products;
}

export function collectionSections(data: CatalogData, products = collectionProducts(data)): CollectionSection[] {
  if (!usesLegacyCollections(data)) return data.catalogCollections.filter(item => item.lifecycle === 'active' && item.enabled && item.homeVisible)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .flatMap(collection => { const items = products.filter(product => product.group.id === collection.id); return items.length ? [{ group: items[0].group, title: collection.name, products: items }] : []; });
  return data.productGroups.filter(group => group.lifecycle === 'active' && (group.collectionVisible ?? group.visible))
    .sort((a, b) => (a.collectionPosition ?? a.position) - (b.collectionPosition ?? b.position) || a.id.localeCompare(b.id))
    .map(group => ({ group, title: group.collectionTitle?.trim() || data.drinkTypes.find(type => type.id === group.drinkTypeId)?.name || group.name, products: products.filter(product => product.group.id === group.id) }))
    .filter(section => section.products.length > 0);
}

export function collectionDrinkTypes(data: CatalogData, products: StorefrontProduct[]): DrinkType[] {
  const ids = new Set(products.map(product => product.group.drinkTypeId));
  return data.drinkTypes.filter(type => type.lifecycle === 'active' && ids.has(type.id)).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function filterCollectionProducts(products: StorefrontProduct[], query: string, source?: CatalogData): StorefrontProduct[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return products;
  return products.filter(product => {
    const originalFlavor = source?.flavors.find(item => item.id === product.flavor.id);
    const originalGroup = source?.productGroups.find(item => item.id === product.group.id);
    const originalVariant = source?.productVariants.find(item => item.id === product.variant.id);
    const originalCollection = source?.catalogCollections?.find(item => item.id === product.group.id);
    const originalItem = source?.catalogItems?.find(item => item.id === product.variant.id);
    const text = normalizeSearch([product.variant.name, product.variant.code, product.variant.description, product.group.name,
      product.group.collectionTitle, product.flavor.name, product.flavor.shortName, product.packaging.name, product.packaging.volumeMl,
      product.category.name, originalFlavor?.name, originalFlavor?.shortName, originalGroup?.name, originalGroup?.collectionTitle,
      originalVariant?.name, originalCollection?.name, originalItem?.name].join(' '));
    return terms.every(term => text.includes(term));
  });
}

export function productPage<T>(items: T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  return { page, totalPages, items: items.slice(page * size, (page + 1) * size) };
}
