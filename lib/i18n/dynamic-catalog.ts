import type { CatalogData, CollectionName } from '@/lib/catalog/contracts';

/** Translate public editorial copy only. IDs, references, artwork and admin metadata stay intact. */
const fields: Partial<Record<CollectionName, string[]>> = {
  drinkTypes: ['name', 'description'], packagingCategories: ['name'], packagingVariants: ['name'],
  flavors: ['name', 'shortName', 'description'], productGroups: ['name', 'buttonLabel', 'description', 'collectionTitle'],
  productVariants: ['name', 'description'], packagingSlots: ['name', 'buttonLabel'],
  assets2d: ['description'], displays2d: ['alt'],
  productDetails: ['eyebrow', 'headline', 'subtitle', 'introduction', 'ingredients', 'allergens', 'servingSize', 'companyName', 'companyAddress', 'countryOfOrigin', 'netContent', 'storage', 'shelfLife'],
};

export function catalogTextParts(text: string): string[] {
  // Keep brand names, quantities and the delimiters used in composed product names.
  return text.split(/(\bVINUT\b|\d+(?:[.,]\d+)?\s*(?:ml\b|l\b|%|°)|\s*[·|\n]\s*)/giu).filter(Boolean);
}
export function needsTranslation(text: string): boolean {
  return /\p{L}/u.test(text) && !/^(?:VINUT|\d+(?:[.,]\d+)?\s*(?:ml|l|%|°))$/iu.test(text.trim());
}
export function catalogTexts(data: CatalogData): string[] {
  const unique = new Set<string>();
  const add = (value: string) => { for (const part of catalogTextParts(value)) if (needsTranslation(part)) unique.add(part.trim()); };
  for (const [collection, keys] of Object.entries(fields)) {
    for (const record of data[collection as CollectionName] ?? []) {
      for (const key of keys) {
        const value = (record as unknown as Record<string, unknown>)[key];
        if (typeof value === 'string') add(value);
      }
    }
  }
  for (const detail of data.productDetails ?? []) { for (const row of detail.nutrition) add(row.label); for (const section of detail.sections) { add(section.title); add(section.body); } }
  return [...unique];
}
export function localizeCatalog(data: CatalogData, translations: ReadonlyMap<string, string>): CatalogData {
  if (!translations.size) return data;
  const result = { ...data };
  const translate = (value: string) => catalogTextParts(value).map(part => {
    const translated = translations.get(part.trim());
    return translated ? `${part.match(/^\s*/)?.[0] ?? ''}${translated}${part.match(/\s*$/)?.[0] ?? ''}` : part;
  }).join('');
  for (const [collection, keys] of Object.entries(fields)) {
    if (!data[collection as CollectionName]) continue;
    (result[collection as CollectionName] as unknown[]) = data[collection as CollectionName].map(record => {
      const copy = { ...record } as unknown as Record<string, unknown>;
      for (const key of keys) {
        if (typeof copy[key] !== 'string') continue;
        copy[key] = translate(copy[key] as string);
      }
      if (collection === 'productDetails' && 'nutrition' in record && 'sections' in record) {
        copy.nutrition = record.nutrition.map(row => ({ ...row, label: translate(row.label) }));
        copy.sections = record.sections.map(section => ({ title: translate(section.title), body: translate(section.body) }));
      }
      return copy;
    });
  }
  return result;
}
