/** Stable category IDs shared by the catalog, navigation and future admin. */
export const beverageLines = [
  { id: 'juice', label: 'Juice' },
  { id: 'sparkling', label: 'Sparkling' },
  { id: 'nata-de-coco', label: 'Nata De Coco' },
  { id: 'coconut-milk', label: 'Coconut milk' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'energy-drink', label: 'Energy Drink' },
  { id: 'basil-seed', label: 'Basil seed' },
  { id: 'chia-seed', label: 'Chia seed' },
  { id: 'coconut-water', label: 'Coconut water' },
  { id: 'popping-boba-tea', label: 'Popping boba tea' },
] as const;
export type BeverageLineId = typeof beverageLines[number]['id'];
export type BeverageLineLabel = typeof beverageLines[number]['label'];
