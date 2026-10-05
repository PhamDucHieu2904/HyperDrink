import type { CatalogData, Display2D, Display3D, ProductGroup } from './contracts';

export type DisplayStatusFilter = 'all' | 'on' | 'off';
export interface DisplayListGroup { id: string; label: string; group?: ProductGroup; records: (Display3D | Display2D)[] }
const searchText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi').trim();

/** Group by the exact Product Display/Best Seller identity, not drink type:
 * separate Juice lines can have the same drink type and different buttons. */
export function displayListGroups(data: CatalogData, mode: '3d' | '2d', filters: { query: string; groupId: string; status: DisplayStatusFilter }): DisplayListGroup[] {
  const groups = new Map<string, DisplayListGroup>();
  const query = searchText(filters.query);
  for (const record of mode === '3d' ? data.displays3d : data.displays2d) {
    if (record.lifecycle !== 'active' || (filters.status !== 'all' && record.enabled !== (filters.status === 'on'))) continue;
    const variant = data.productVariants.find(item => item.id === record.productVariantId);
    const group = data.productGroups.find(item => item.id === variant?.groupId);
    const id = group?.id || 'unassigned';
    if (filters.groupId && filters.groupId !== id) continue;
    const flavor = data.flavors.find(item => item.id === variant?.flavorId);
    const packaging = data.packagingVariants.find(item => item.id === variant?.packagingVariantId);
    if (query && !searchText([record.name, group?.name, group?.buttonLabel, flavor?.name, flavor?.shortName, packaging?.name, variant?.code].filter(Boolean).join(' ')).includes(query)) continue;
    const entry = groups.get(id) || { id, label: group?.buttonLabel || group?.name || 'Chưa gắn Best Seller', group, records: [] };
    entry.records.push(record); groups.set(id, entry);
  }
  return [...groups.values()].sort((a, b) => (a.group?.position ?? Infinity) - (b.group?.position ?? Infinity) || a.id.localeCompare(b.id)).map(group => ({ ...group, records: group.records.sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id)) }));
}
