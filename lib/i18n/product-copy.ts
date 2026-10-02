import { beverageLines } from '../beverage-lines';
import type { Packaging, PackagingFilter, Product } from '../products';
import type { Translator } from './catalog';
import { english, type MessageKey } from './messages';

export const packagingFilterMessages: Record<PackagingFilter, MessageKey> = {
  'Tất cả': 'packaging.all', Lon: 'packaging.can', 'Chai PET': 'packaging.pet',
  'Chai thủy tinh': 'packaging.glass', 'Chai PP': 'packaging.pp', Túi: 'packaging.pouch',
};
export const productPackagingMessages: Record<Packaging, MessageKey> = {
  Can: 'packaging.can', 'PET bottle': 'packaging.pet', 'Glass bottle': 'packaging.glass',
  'PP bottle': 'packaging.pp', Pouch: 'packaging.pouch',
};

/** New catalog entries can display their source copy before a translation is added. */
export function productIngredients(product: Pick<Product, 'id' | 'flavor'>, t: Translator): string {
  const key = `product.${product.id}.ingredients`;
  return Object.prototype.hasOwnProperty.call(english, key) ? t(key as MessageKey) : product.flavor;
}
export function productCategory(product: Pick<Product, 'line'>, t: Translator): string {
  const category = beverageLines.find(item => item.label === product.line);
  return category ? t(`category.${category.id}`) : product.line;
}
