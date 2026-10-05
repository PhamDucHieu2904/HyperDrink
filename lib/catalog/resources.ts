import type { CatalogData, CatalogRecord, MediaAsset, MediaRole } from './contracts';

export type ResourceCollection = 'labels' | 'models3d' | 'assets2d';
export type ResourceFilter = 'all' | MediaRole;
export interface ResourceConfiguration { collection: ResourceCollection; record: CatalogRecord }
export interface ResourceItem {
  key: string;
  name: string;
  role: MediaRole;
  media?: MediaAsset;
  configurations: ResourceConfiguration[];
}
export const RESOURCE_TYPES: { role: MediaRole; label: string; collection?: ResourceCollection }[] = [
  { role: 'model', label: '3D model', collection: 'models3d' },
  { role: 'label', label: 'Label', collection: 'labels' },
  { role: 'fruit', label: 'Fruit image' },
  { role: 'leaf', label: 'Leaf image' },
  { role: 'splash', label: 'Splash' },
  { role: 'icon', label: 'Icon' },
  { role: 'image-2d', label: '2D model', collection: 'assets2d' },
  { role: 'poster', label: 'Poster 3D' },
  { role: 'thumbnail', label: 'Ảnh đại diện' },
];

/** One file can have several reusable configurations. Drafts without files remain visible. */
export function catalogResources(data: CatalogData): ResourceItem[] {
  const rows: ResourceItem[] = data.media.map(media => ({ key: `media:${media.id}`, name: media.name, role: media.role, media, configurations: [] }));
  const byId = new Map(rows.map(row => [row.media!.id, row]));
  for (const type of RESOURCE_TYPES) {
    if (!type.collection) continue;
    for (const record of data[type.collection]) {
      const configuration = { collection: type.collection, record };
      const linked = record.mediaId ? byId.get(record.mediaId) : undefined;
      if (linked && linked.role === type.role) linked.configurations.push(configuration);
      else rows.push({ key: `${type.collection}:${record.id}`, name: record.name, role: type.role, configurations: [configuration] });
    }
  }
  return rows;
}

export function filterResources(rows: ResourceItem[], role: ResourceFilter, status: string, query: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const record = row.media ?? row.configurations[0]?.record;
    const text = normalize([row.name, row.media?.slug, ...row.configurations.flatMap(item => [item.record.name, item.record.slug])].join(' '));
    return (role === 'all' || row.role === role) && (status === 'all' || record?.lifecycle === status) && words.every(word => text.includes(word));
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function resourceLocation(module: string, type?: string | null): { module: string; filter: ResourceFilter } {
  const legacy: Record<string, MediaRole> = { labels: 'label', models3d: 'model', icons: 'icon' };
  if (Object.hasOwn(legacy, module)) return { module: 'media', filter: legacy[module] };
  return { module, filter: RESOURCE_TYPES.some(item => item.role === type) ? type as MediaRole : 'all' };
}

export function resourceConfigurationContext(data: CatalogData, collection: ResourceCollection, media: MediaAsset) {
  const baseName = media.name.replace(/\.[^.]+$/, '').slice(0, 170);
  const baseSlug = media.slug;
  let suffix = 1;
  while (data[collection].some(record => record.slug === (suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`))) suffix++;
  return { mediaId: media.id, name: suffix === 1 ? baseName : `${baseName} · ${suffix}`, slug: suffix === 1 ? baseSlug : `${baseSlug}-${suffix}` };
}
