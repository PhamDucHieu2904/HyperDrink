import type { CatalogData, Lifecycle } from './contracts';

export const UNCLASSIFIED_FLAVORS = '__unclassified__';

/** Use catalog relationships, never flavor names, to identify beverage families. */
export function flavorDrinkTypeGroups(data: CatalogData, lifecycle: Lifecycle | 'all') {
  const typeIds = new Set(data.drinkTypes.map(type => type.id));
  const memberships = new Map(data.flavors.map(flavor => [flavor.id, new Set<string>()]));
  const groupTypes = new Map(data.productGroups.map(group => [group.id, group.drinkTypeId]));
  const link = (flavorId: string | null, drinkTypeId: string | undefined) => {
    if (flavorId && drinkTypeId && typeIds.has(drinkTypeId)) memberships.get(flavorId)?.add(drinkTypeId);
  };
  // Retain classification for archived records and disabled draft products, too.
  for (const label of data.labels) link(label.flavorId, label.drinkTypeId);
  for (const variant of data.productVariants) link(variant.flavorId, groupTypes.get(variant.groupId));
  for (const asset of data.assets2d) link(asset.flavorId, asset.drinkTypeId);

  const flavors = data.flavors.filter(flavor => lifecycle === 'all' || flavor.lifecycle === lifecycle);
  const groups = [...data.drinkTypes].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'vi'))
    .map(type => ({ id: type.id, name: type.name, count: flavors.filter(flavor => memberships.get(flavor.id)?.has(type.id)).length }));
  groups.push({ id: UNCLASSIFIED_FLAVORS, name: 'Chưa phân loại', count: flavors.filter(flavor => !memberships.get(flavor.id)?.size).length });

  return { groups, memberships, total: flavors.length };
}

export function flavorMatchesDrinkType(memberships: Map<string, Set<string>>, flavorId: string, category: string) {
  if (!category) return true;
  const types = memberships.get(flavorId);
  return category === UNCLASSIFIED_FLAVORS ? !types?.size : !!types?.has(category);
}
