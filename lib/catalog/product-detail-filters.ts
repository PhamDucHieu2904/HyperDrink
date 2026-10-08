import type { CatalogData, Lifecycle } from './contracts';

export interface ProductDetailFilters { drinkTypeId: string; flavorId: string; packagingVariantId: string }
export const EMPTY_PRODUCT_DETAIL_FILTERS: ProductDetailFilters = { drinkTypeId: '', flavorId: '', packagingVariantId: '' };
interface DetailRelations { drinkTypeId: string; flavorId: string; packagingIds: Set<string> }
export type ProductDetailFilterIndex = Map<string, DetailRelations>;

/** A detail belongs to its label, including every compatible packaging format. */
export function buildProductDetailFilterIndex(data: CatalogData): ProductDetailFilterIndex {
  const labels = new Map(data.labels.map(label => [label.id, label]));
  const packagingIds = new Set(data.packagingVariants.map(packaging => packaging.id));
  return new Map(data.productDetails.map(detail => {
    const label = labels.get(detail.labelId);
    return [detail.id, {
      drinkTypeId: label?.drinkTypeId ?? '',
      flavorId: label?.flavorId ?? '',
      packagingIds: new Set(label?.compatibilities.map(item => item.packagingVariantId).filter(id => packagingIds.has(id)) ?? []),
    }];
  }));
}

export function productDetailMatchesFilters(index: ProductDetailFilterIndex, id: string, filters: ProductDetailFilters) {
  const relation = index.get(id);
  return (!filters.drinkTypeId || relation?.drinkTypeId === filters.drinkTypeId)
    && (!filters.flavorId || relation?.flavorId === filters.flavorId)
    && (!filters.packagingVariantId || !!relation?.packagingIds.has(filters.packagingVariantId));
}

export function productDetailFilterOptions(data: CatalogData, index: ProductDetailFilterIndex, filters: ProductDetailFilters, lifecycle: Lifecycle | 'all') {
  const details = data.productDetails.filter(detail => lifecycle === 'all' || detail.lifecycle === lifecycle);
  const packagingNames = new Map(data.packagingCategories.map(category => [category.id, category.name]));
  // Beverage selection resets the other fields, so keep every beverage reachable.
  const count = (field: keyof ProductDetailFilters, id: string) => details.filter(detail => productDetailMatchesFilters(index, detail.id, { ...(field === 'drinkTypeId' ? EMPTY_PRODUCT_DETAIL_FILTERS : filters), [field]: id })).length;
  const choices = (field: keyof ProductDetailFilters, records: { id: string; name: string }[]) => records.map(record => ({ id: record.id, name: record.name, count: count(field, record.id) }))
    .filter(option => option.count > 0 || option.id === filters[field]);
  return {
    drinkTypes: choices('drinkTypeId', [...data.drinkTypes].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'vi'))),
    flavors: choices('flavorId', [...data.flavors].sort((a, b) => a.name.localeCompare(b.name, 'vi'))),
    packaging: choices('packagingVariantId', [...data.packagingVariants].map(packaging => {
      const category = packagingNames.get(packaging.categoryId);
      return { id: packaging.id, name: category && !packaging.name.toLocaleLowerCase('vi').includes(category.toLocaleLowerCase('vi')) ? `${category} · ${packaging.name}` : packaging.name };
    }).sort((a, b) => a.name.localeCompare(b.name, 'vi'))),
  };
}
