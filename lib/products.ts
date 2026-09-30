export type Packaging = 'Can' | 'PET bottle' | 'Glass bottle' | 'PP bottle' | 'Pouch';
import type { BeverageLineLabel } from './beverage-lines';
export type BeverageLine = BeverageLineLabel;

export type Product = {
  id: string;
  name: string;
  line: BeverageLine;
  packaging: Packaging;
  flavor: string;
  volume: string;
  accent: string;
};

export const packagingFilters = ['Tất cả', 'Lon', 'Chai PET', 'Chai thủy tinh', 'Chai PP', 'Túi'] as const;
export type PackagingFilter = (typeof packagingFilters)[number];

export const products: Product[] = [
  { id: 'citrus-bliss', name: 'Citrus Bliss', line: 'Sparkling', packaging: 'Can', flavor: 'Cam · Chanh xanh', volume: '330 ml', accent: '#ff9b68' },
  { id: 'tropical-mango', name: 'Tropical Mango', line: 'Juice', packaging: 'PET bottle', flavor: 'Xoài chín · Mật ong', volume: '350 ml', accent: '#ffc66a' },
  { id: 'coconut-cloud', name: 'Coconut Cloud', line: 'Coconut milk', packaging: 'Glass bottle', flavor: 'Dừa non · Sữa', volume: '280 ml', accent: '#9adbd7' },
  { id: 'nata-berry', name: 'Nata Berry', line: 'Nata De Coco', packaging: 'PP bottle', flavor: 'Dâu rừng · Nata', volume: '300 ml', accent: '#f28c9c' },
  { id: 'guava-splash', name: 'Guava Splash', line: 'Juice', packaging: 'Pouch', flavor: 'Ổi hồng · Chanh', volume: '250 ml', accent: '#a9d6f4' },
  { id: 'lime-burst', name: 'Lime Burst', line: 'Sparkling', packaging: 'Can', flavor: 'Chanh xanh · Bạc hà', volume: '330 ml', accent: '#b8dd6d' },
  { id: 'coconut-jelly', name: 'Coconut Jelly', line: 'Nata De Coco', packaging: 'PET bottle', flavor: 'Dừa · Thạch nata', volume: '450 ml', accent: '#8ad7c4' },
  { id: 'peach-glow', name: 'Peach Glow', line: 'Juice', packaging: 'Glass bottle', flavor: 'Đào vàng · Hoa nhài', volume: '280 ml', accent: '#f7b29a' }
];

export const packagingClass: Record<Packaging, string> = {
  Can: 'mini-can',
  'PET bottle': 'mini-pet',
  'Glass bottle': 'mini-glass',
  'PP bottle': 'mini-pp',
  Pouch: 'mini-pouch'
};

export function filterProducts(filter: PackagingFilter) {
  if (filter === 'Tất cả') return products;
  const lookup: Record<Exclude<PackagingFilter, 'Tất cả'>, Packaging> = {
    Lon: 'Can',
    'Chai PET': 'PET bottle',
    'Chai thủy tinh': 'Glass bottle',
    'Chai PP': 'PP bottle',
    Túi: 'Pouch'
  };
  return products.filter((product) => product.packaging === lookup[filter]);
}
