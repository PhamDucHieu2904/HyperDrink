import type { CatalogData, DrinkType, ProductGroup } from './contracts';
import { catalogProducts, type StorefrontProduct } from './storefront';
import { normalizeSearch } from '../i18n/catalog';

export interface CollectionSection { group: ProductGroup; title: string; products: StorefrontProduct[] }

export function collectionSections(data: CatalogData, products = catalogProducts(data, 'catalog')): CollectionSection[] {
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
    const text = normalizeSearch([product.variant.name, product.variant.code, product.variant.description, product.group.name,
      product.group.collectionTitle, product.flavor.name, product.flavor.shortName, product.packaging.name, product.packaging.volumeMl,
      product.category.name, originalFlavor?.name, originalFlavor?.shortName, originalGroup?.name, originalGroup?.collectionTitle,
      originalVariant?.name].join(' '));
    return terms.every(term => text.includes(term));
  });
}

export function productPage<T>(items: T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  return { page, totalPages, items: items.slice(page * size, (page + 1) * size) };
}
