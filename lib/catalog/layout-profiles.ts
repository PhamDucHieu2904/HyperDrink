import type { CatalogData, Label } from './contracts';

/** A declaration of matching artwork layouts, not automatic UV detection from a GLB. */
export function packagingLayoutChoices(data: CatalogData, packagingId: string) {
  const models = data.models3d.filter(item => item.lifecycle === 'active' && item.packagingVariantId === packagingId && item.layoutProfile);
  const profiles = [...new Set(models.map(item => item.layoutProfile))];
  return profiles.map(value => ({ value, label: models.filter(item => item.layoutProfile === value).map(item => item.name).join(' / ') }));
}

export function defaultLayoutProfile(data: CatalogData, packagingId: string): string {
  if (!packagingId) return '';
  const choices = packagingLayoutChoices(data, packagingId);
  if (choices.length === 1) return choices[0].value;
  if (choices.length > 1) return '';
  const packaging = data.packagingVariants.find(item => item.id === packagingId);
  if (!packaging) return '';
  const category = data.packagingCategories.find(item => item.id === packaging.categoryId);
  return category?.viewerKind === 'can' ? 'can-wrap-v1' : `${packaging.slug}-wrap-v1`;
}

export function completeLabelLayouts(data: CatalogData, rows: Label['compatibilities']): Label['compatibilities'] {
  return rows.map(row => ({ ...row, layoutProfile: row.layoutProfile || defaultLayoutProfile(data, row.packagingVariantId) }));
}
