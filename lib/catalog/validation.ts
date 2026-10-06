import type { CatalogData, CatalogRecord, CollectionName, ValidationIssue } from './contracts';
import { catalogWithDefaults } from './contracts';
import { checkDisplay2DCompatibility, checkDisplay3DCompatibility, collectPublicCatalog } from './compatibility';
import { isImageMedia } from './media-roles';
import { resolveFlavorFruitImage } from './flavor-media';

export const CATALOG_COLLECTIONS = ['drinkTypes', 'packagingCategories', 'packagingVariants', 'flavors', 'flavorAssets', 'productGroups', 'productVariants', 'packagingSlots', 'media', 'labels', 'models3d', 'assets2d', 'displays3d', 'displays2d', 'productDetails'] as const satisfies readonly CollectionName[];
export interface ValidationOptions { mode?: 'draft' | 'publish' }
export const hasValidationErrors = (issues: ValidationIssue[]) => issues.some(issue => issue.severity === 'error');

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const tokenPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const commonFields = ['id', 'name', 'slug', 'lifecycle', 'revision', 'createdAt', 'updatedAt'];
const fields: Record<CollectionName, readonly string[]> = {
  drinkTypes: ['description', 'position'], packagingCategories: ['viewerKind', 'position'],
  packagingVariants: ['categoryId', 'volumeMl', 'shape', 'position'],
  flavors: ['shortName', 'description', 'accentColor', 'backgroundColor', 'textColor', 'icon', 'iconId', 'thumbnailId', 'icePoolConfigured', 'position'],
  flavorAssets: ['flavorId', 'mediaId', 'role', 'position', 'enabled'],
  productGroups: ['drinkTypeId', 'description', 'buttonLabel', 'heroVolumeCaption', 'heroFlavorText', 'heroOriginText', 'position', 'visible', 'collectionVisible', 'collectionTitle', 'collectionPosition'],
  productVariants: ['groupId', 'packagingVariantId', 'flavorId', 'code', 'description', 'enabled'],
  packagingSlots: ['groupId', 'packagingVariantId', 'regionKey', 'position', 'buttonLabel', 'mode', 'defaultVariantId', 'enabled'],
  media: ['role', 'status', 'url', 'storageKey', 'mime', 'bytes', 'sha256', 'width', 'height', 'imageBounds', 'error'],
  labels: ['drinkTypeId', 'flavorId', 'mediaId', 'compatibilities', 'mockupVisible', 'mockupPosition'],
  models3d: ['packagingVariantId', 'mediaId', 'posterId', 'layoutProfile', 'materialSlots', 'orientation', 'mockupVisible', 'mockupPosition', 'mockupFrontYaw'],
  assets2d: ['packagingVariantId', 'drinkTypeId', 'flavorId', 'mediaId', 'galleryIds', 'description'],
  displays3d: ['productVariantId', 'modelId', 'labelId', 'enabled'],
  displays2d: ['productVariantId', 'assetId', 'alt', 'enabled'],
  productDetails: ['labelId', 'posterId', 'eyebrow', 'headline', 'subtitle', 'introduction', 'ingredients', 'allergens', 'servingSize', 'nutrition', 'companyName', 'companyAddress', 'countryOfOrigin', 'netContent', 'storage', 'shelfLife', 'sections', 'enabled'],
};

/** Shared structural validation. Empty business fields are saveable in a draft; malformed values are not. */
export function validateRecord(collection: CollectionName, input: unknown, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entityId = plain(input) && typeof input.id === 'string' ? input.id : '';
  const add = (field: string, message: string, code = 'invalid_value') => issues.push({ code, message, collection, entityId, field, severity: 'error' });
  if (!plain(input)) { add('', 'Bản ghi phải là một đối tượng dữ liệu.', 'invalid_record'); return issues; }
  const record = input;
  const publishing = options.mode === 'publish';
  const str = (field: string, max = 160, required = false, pattern?: RegExp) => {
    const value = record[field];
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) add(field, `Trường ${field} phải là chuỗi hợp lệ, tối đa ${max} ký tự.`);
    else if (required && !value.trim()) add(field, `Cần bổ sung ${field} trước khi xuất bản.`, 'required');
    else if (value && pattern && !pattern.test(value)) add(field, `Định dạng ${field} không hợp lệ.`);
  };
  const ref = (field: string, nullable = false, required = false) => {
    if (nullable && record[field] === null) { if (required) add(field, `Cần chọn ${field} trước khi xuất bản.`, 'required'); return; }
    str(field, 128, required, idPattern);
  };
  const num = (field: string, min: number, max = Number.MAX_SAFE_INTEGER, integer = false, nullable = false) => {
    const value = record[field];
    if (nullable && value === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) add(field, `Giá trị ${field} phải ${integer ? 'là số nguyên' : 'là số'} trong khoảng ${min}–${max}.`);
  };
  const bool = (field: string) => { if (typeof record[field] !== 'boolean') add(field, `${field} phải là giá trị bật/tắt.`); };
  const oneOf = (field: string, allowed: readonly string[]) => { if (typeof record[field] !== 'string' || !allowed.includes(record[field])) add(field, `${field} không nằm trong danh mục được hỗ trợ.`); };
  const position = () => num('position', 0, 100000, true);
  const mockup = () => {
    if (record.mockupVisible !== undefined) bool('mockupVisible');
    if (record.mockupPosition !== undefined) num('mockupPosition', 0, 100000, true);
  };
  const color = (field: string) => { str(field, 7, publishing); if (record[field] && !/^#[0-9a-f]{6}$/i.test(String(record[field]))) add(field, 'Màu phải có định dạng #RRGGBB.'); };
  const refsArray = (field: string) => {
    const value = record[field];
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !idPattern.test(item))) add(field, `${field} phải là danh sách tối đa 100 ID hợp lệ.`);
    else if (new Set(value).size !== value.length) add(field, `${field} chứa tài nguyên trùng lặp.`, 'duplicate_reference');
  };
  for (const key of Object.keys(record)) if (![...commonFields, ...fields[collection]].includes(key)) add(key, `Trường ${key} không thuộc schema của module này.`, 'unknown_field');
  str('id', 128, true, idPattern); str('name', 160, publishing); str('slug', 160, publishing, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  oneOf('lifecycle', ['active', 'archived']); num('revision', 0, Number.MAX_SAFE_INTEGER, true);
  for (const field of ['createdAt', 'updatedAt']) {
    str(field, 40, true);
    if (typeof record[field] === 'string' && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record[field]) || !Number.isFinite(Date.parse(record[field])))) add(field, `${field} phải là ngày ISO có múi giờ.`);
  }
  switch (collection) {
    case 'drinkTypes': str('description', 5000); position(); break;
    case 'packagingCategories': oneOf('viewerKind', ['can', 'glass', 'pp', 'pet', 'pouch', 'other']); position(); break;
    case 'packagingVariants': ref('categoryId', false, publishing); num('volumeMl', Number.MIN_VALUE, 100000, false, true); str('shape', 160); position(); break;
    case 'flavors':
      str('shortName', 60, publishing); str('description', 5000); color('accentColor'); color('backgroundColor'); color('textColor'); str('icon', 128, publishing, tokenPattern); if (record.iconId !== undefined) ref('iconId', true); ref('thumbnailId', true); if (record.icePoolConfigured !== undefined) bool('icePoolConfigured'); position(); break;
    case 'flavorAssets': ref('flavorId', false, publishing); ref('mediaId', false, publishing); oneOf('role', ['fruit', 'leaf', 'splash', 'ice']); position(); bool('enabled'); break;
    case 'productGroups':
      ref('drinkTypeId', false, publishing); str('description', 5000); str('buttonLabel', 100, publishing); position(); bool('visible');
      for (const field of ['heroVolumeCaption', 'heroFlavorText', 'heroOriginText']) if (record[field] !== undefined) str(field, 100);
      if (record.collectionVisible !== undefined) bool('collectionVisible');
      if (record.collectionTitle !== undefined) str('collectionTitle', 100);
      if (record.collectionPosition !== undefined) num('collectionPosition', 0, 100000, true);
      break;
    case 'productVariants': ref('groupId', false, publishing); ref('packagingVariantId', false, publishing); ref('flavorId', false, publishing); str('code', 128); str('description', 5000); bool('enabled'); break;
    case 'packagingSlots': ref('groupId', false, publishing); ref('packagingVariantId', false, publishing); oneOf('regionKey', ['packaging-picker']); position(); str('buttonLabel', 100, publishing); oneOf('mode', ['3d', '2d', 'auto']); ref('defaultVariantId', true, publishing); bool('enabled'); break;
    case 'media': {
      oneOf('role', ['fruit', 'leaf', 'splash', 'ice', 'thumbnail', 'icon', 'label', 'model', 'poster', 'image-2d']); oneOf('status', ['uploaded', 'processing', 'ready', 'failed']);
      str('url', 2048, publishing); str('storageKey', 512); str('mime', 100, publishing); num('bytes', publishing ? 1 : 0, Number.MAX_SAFE_INTEGER, true);
      str('sha256', 64, publishing, /^[0-9a-f]{64}$/i); num('width', 1, 32768, true, true); num('height', 1, 32768, true, true); str('error', 2000);
      if (record.url && !isSafeAssetUrl(record.url)) add('url', 'URL phải là đường dẫn cùng website hoặc HTTPS không có thông tin đăng nhập.', 'unsafe_url');
      if (record.storageKey && (String(record.storageKey).startsWith('/') || /\\/.test(String(record.storageKey)) || String(record.storageKey).split('/').some(segment => segment === '..' || segment === '.'))) add('storageKey', 'Storage key không được là đường dẫn tuyệt đối hoặc chứa đoạn đi ngược thư mục.', 'unsafe_storage_key');
      const bounds = record.imageBounds;
      if (bounds !== null && (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3])) add('imageBounds', 'Alpha bounds phải là [left, top, right, bottom] trong 0–1, có diện tích dương.');
      if (publishing && record.status !== 'ready') add('status', 'Tài nguyên chưa được xử lý thành công.', 'media_not_ready');
      if (publishing && record.role === 'model' && record.mime !== 'model/gltf-binary') add('mime', 'Model runtime phải là GLB.', 'media_type_mismatch');
      if (publishing && record.role !== 'model' && !['image/png', 'image/webp', 'image/jpeg'].includes(String(record.mime))) add('mime', 'Ảnh runtime phải là PNG, WebP hoặc JPEG đã xử lý.', 'media_type_mismatch');
      if (publishing && record.role !== 'model' && (record.width === null || record.height === null)) add('width', 'Ảnh runtime cần metadata chiều rộng và chiều cao.', 'required');
      break;
    }
    case 'labels': {
      mockup();
      ref('drinkTypeId', false, publishing); ref('flavorId', true); ref('mediaId', true, publishing);
      if (!Array.isArray(record.compatibilities) || record.compatibilities.length > 500) add('compatibilities', 'Danh sách tương thích phải có tối đa 500 quy cách.');
      else {
        if (publishing && record.compatibilities.length === 0) add('compatibilities', 'Nhãn cần ít nhất một quy cách tương thích.', 'required');
        const seen = new Set<string>();
        record.compatibilities.forEach((entry, index) => {
          if (!plain(entry) || Object.keys(entry).some(key => !['packagingVariantId', 'layoutProfile'].includes(key)) || typeof entry.packagingVariantId !== 'string' || !idPattern.test(entry.packagingVariantId) || typeof entry.layoutProfile !== 'string' || (entry.layoutProfile && !tokenPattern.test(entry.layoutProfile)) || (publishing && !entry.layoutProfile)) add(`compatibilities.${index}`, 'Quy cách và profile UV phải hợp lệ.');
          else { const key = `${entry.packagingVariantId}:${entry.layoutProfile}`; if (seen.has(key)) add(`compatibilities.${index}`, 'Quy cách/profile tương thích bị trùng.', 'duplicate_reference'); seen.add(key); }
        });
      }
      break;
    }
    case 'models3d': {
      mockup();
      if (record.mockupFrontYaw !== undefined) num('mockupFrontYaw', -Math.PI * 8, Math.PI * 8);
      ref('packagingVariantId', false, publishing); ref('mediaId', true, publishing); ref('posterId', true, publishing); str('layoutProfile', 128, publishing, tokenPattern);
      if (!Array.isArray(record.orientation) || record.orientation.length !== 3 || record.orientation.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Math.PI * 8)) add('orientation', 'Orientation phải có ba góc hữu hạn trong ±8π radians.');
      if (!plain(record.materialSlots) || Object.keys(record.materialSlots).length > 32) add('materialSlots', 'Material slots phải là bảng tối đa 32 semantic slots.');
      else {
        const assigned = new Set<string>();
        for (const [key, values] of Object.entries(record.materialSlots)) {
          if (!/^[a-z][a-z0-9-]{0,63}$/.test(key) || !Array.isArray(values) || values.length > 32 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 160) || new Set(values).size !== values.length) add(`materialSlots.${key}`, 'Semantic slot và danh sách tên material phải hợp lệ.');
          else for (const value of values) {
            if (assigned.has(value)) add(`materialSlots.${key}`, 'Một tên material/mesh không được gán cho nhiều semantic slots.', 'ambiguous_material_slot');
            assigned.add(value);
          }
        }
      }
      if (publishing && (!plain(record.materialSlots) || !Array.isArray(record.materialSlots.label) || !record.materialSlots.label.length)) add('materialSlots.label', 'Model cần material slot label đã được kiểm tra.', 'required');
      break;
    }
    case 'assets2d': ref('packagingVariantId', false, publishing); ref('drinkTypeId', false, publishing); ref('flavorId', true); ref('mediaId', true, publishing); refsArray('galleryIds'); str('description', 5000); break;
    case 'displays3d': ref('productVariantId', false, publishing); ref('modelId', true, publishing); ref('labelId', true, publishing); bool('enabled'); break;
    case 'displays2d': ref('productVariantId', false, publishing); ref('assetId', true, publishing); str('alt', 300, publishing); bool('enabled'); break;
    case 'productDetails': {
      ref('labelId', false, publishing); ref('posterId', true); bool('enabled');
      for (const field of ['eyebrow', 'headline', 'subtitle', 'allergens', 'servingSize', 'companyName', 'companyAddress', 'countryOfOrigin', 'netContent', 'storage', 'shelfLife']) str(field, 1000);
      for (const field of ['introduction', 'ingredients']) str(field, 10000);
      if (!Array.isArray(record.nutrition) || record.nutrition.length > 40) add('nutrition', 'Tối đa 40 dòng dinh dưỡng.');
      else for (const [index, row] of record.nutrition.entries()) {
        if (!plain(row) || Object.keys(row).some(key => !['label', 'amount', 'dailyValue'].includes(key)) || ['label', 'amount', 'dailyValue'].some(key => typeof row[key] !== 'string' || (row[key] as string).length > 160 || /[\u0000-\u001f]/.test(row[key] as string))) add(`nutrition.${index}`, 'Mỗi dòng cần tên chỉ tiêu, hàm lượng và % giá trị hàng ngày dạng text.');
      }
      if (!Array.isArray(record.sections) || record.sections.length > 20) add('sections', 'Tối đa 20 mục thông tin bổ sung.');
      else for (const [index, section] of record.sections.entries()) {
        if (!plain(section) || Object.keys(section).some(key => !['title', 'body'].includes(key)) || typeof section.title !== 'string' || section.title.length > 160 || typeof section.body !== 'string' || section.body.length > 10000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(String(section.title) + String(section.body))) add(`sections.${index}`, 'Mỗi mục cần tiêu đề và nội dung dạng text.');
      }
      break;
    }
  }
  return issues;
}

export function isSafeAssetUrl(input: unknown): input is string {
  if (typeof input !== 'string' || /[\s\\\u0000-\u001f]/.test(input)) return false;
  if (/^\/(?!\/)/.test(input)) return true;
  try { const url = new URL(input); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}

interface Reference { collection: CollectionName; field: string; target: CollectionName; nullable?: boolean }
export const CATALOG_REFERENCES: readonly Reference[] = [
  { collection: 'packagingVariants', field: 'categoryId', target: 'packagingCategories' },
  { collection: 'flavors', field: 'thumbnailId', target: 'media', nullable: true },
  { collection: 'flavors', field: 'iconId', target: 'media', nullable: true },
  { collection: 'flavorAssets', field: 'flavorId', target: 'flavors' }, { collection: 'flavorAssets', field: 'mediaId', target: 'media' },
  { collection: 'productGroups', field: 'drinkTypeId', target: 'drinkTypes' },
  { collection: 'productVariants', field: 'groupId', target: 'productGroups' }, { collection: 'productVariants', field: 'packagingVariantId', target: 'packagingVariants' }, { collection: 'productVariants', field: 'flavorId', target: 'flavors' },
  { collection: 'packagingSlots', field: 'groupId', target: 'productGroups' }, { collection: 'packagingSlots', field: 'packagingVariantId', target: 'packagingVariants' }, { collection: 'packagingSlots', field: 'defaultVariantId', target: 'productVariants', nullable: true },
  { collection: 'labels', field: 'drinkTypeId', target: 'drinkTypes' }, { collection: 'labels', field: 'flavorId', target: 'flavors', nullable: true }, { collection: 'labels', field: 'mediaId', target: 'media', nullable: true },
  { collection: 'models3d', field: 'packagingVariantId', target: 'packagingVariants' }, { collection: 'models3d', field: 'mediaId', target: 'media', nullable: true }, { collection: 'models3d', field: 'posterId', target: 'media', nullable: true },
  { collection: 'assets2d', field: 'packagingVariantId', target: 'packagingVariants' }, { collection: 'assets2d', field: 'drinkTypeId', target: 'drinkTypes' }, { collection: 'assets2d', field: 'flavorId', target: 'flavors', nullable: true }, { collection: 'assets2d', field: 'mediaId', target: 'media', nullable: true },
  { collection: 'displays3d', field: 'productVariantId', target: 'productVariants' }, { collection: 'displays3d', field: 'modelId', target: 'models3d', nullable: true }, { collection: 'displays3d', field: 'labelId', target: 'labels', nullable: true },
  { collection: 'displays2d', field: 'productVariantId', target: 'productVariants' }, { collection: 'displays2d', field: 'assetId', target: 'assets2d', nullable: true },
  { collection: 'productDetails', field: 'labelId', target: 'labels' }, { collection: 'productDetails', field: 'posterId', target: 'media', nullable: true },
];

export function validateCatalog(input: unknown, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (collection: CollectionName, entityId: string, field: string, code: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ collection, entityId, field, code, message, severity });
  if (!plain(input) || input.schemaVersion !== 1) { add('productGroups', '', 'schemaVersion', 'invalid_schema', 'Catalog cần schemaVersion 1.'); return issues; }
  if (Object.keys(input).some(key => key !== 'schemaVersion' && !(CATALOG_COLLECTIONS as readonly string[]).includes(key))) add('productGroups', '', '', 'unknown_field', 'Catalog chứa collection không thuộc schema.');
  for (const collection of CATALOG_COLLECTIONS) {
    const records = input[collection];
    if (collection === 'productDetails' && records === undefined) continue;
    if (!Array.isArray(records) || records.length > 10000) { add(collection, '', '', 'invalid_collection', 'Collection phải là danh sách tối đa 10.000 bản ghi.'); continue; }
    for (const record of records) issues.push(...validateRecord(collection, record));
  }
  // Graph operations only run after shape validation so untrusted JSON cannot throw during preflight.
  if (hasValidationErrors(issues)) return issues;
  const data = catalogWithDefaults(input as unknown as CatalogData);
  for (const collection of CATALOG_COLLECTIONS) {
    const ids = new Set<string>(); const slugs = new Set<string>();
    for (const record of data[collection]) {
      if (ids.has(record.id)) add(collection, record.id, 'id', 'duplicate_id', 'ID bản ghi bị trùng.'); ids.add(record.id);
      if (record.lifecycle === 'active' && record.slug) { if (slugs.has(record.slug)) add(collection, record.id, 'slug', 'duplicate_slug', 'Slug đang được sử dụng trong module này.'); slugs.add(record.slug); }
    }
  }
  for (const reference of CATALOG_REFERENCES) {
    const targetIds = new Set(data[reference.target].map(record => record.id));
    for (const record of data[reference.collection]) {
      const id = (record as unknown as Record<string, unknown>)[reference.field];
      if (typeof id === 'string' && id && !targetIds.has(id)) add(reference.collection, record.id, reference.field, 'reference_missing', 'Bản ghi được chọn không tồn tại.');
    }
  }
  for (const label of data.labels) for (const [index, entry] of label.compatibilities.entries()) if (!data.packagingVariants.some(variant => variant.id === entry.packagingVariantId)) add('labels', label.id, `compatibilities.${index}`, 'reference_missing', 'Quy cách tương thích không tồn tại.');
  for (const asset of data.assets2d) for (const [index, id] of asset.galleryIds.entries()) if (!data.media.some(media => media.id === id)) add('assets2d', asset.id, `galleryIds.${index}`, 'reference_missing', 'Ảnh trong gallery không tồn tại.');
  const unique = <T extends CatalogRecord>(collection: CollectionName, records: T[], key: (record: T) => string, field: string, code: string) => {
    const seen = new Set<string>();
    for (const record of records.filter(item => item.lifecycle === 'active')) { const value = key(record); if (!value) continue; if (seen.has(value)) add(collection, record.id, field, code, 'Tổ hợp này đã có bản ghi active.'); seen.add(value); }
  };
  unique('productVariants', data.productVariants, record => record.groupId && record.packagingVariantId && record.flavorId ? JSON.stringify([record.groupId, record.packagingVariantId, record.flavorId]) : '', 'flavorId', 'duplicate_product_tuple');
  unique('productVariants', data.productVariants, record => record.code.trim(), 'code', 'duplicate_code');
  unique('packagingSlots', data.packagingSlots, record => record.groupId && record.packagingVariantId ? JSON.stringify([record.groupId, record.regionKey, record.packagingVariantId]) : '', 'packagingVariantId', 'duplicate_slot');
  unique('packagingSlots', data.packagingSlots, record => record.groupId ? JSON.stringify([record.groupId, record.regionKey, record.position]) : '', 'position', 'duplicate_position');
  unique('displays3d', data.displays3d, record => record.productVariantId, 'productVariantId', 'duplicate_display');
  unique('displays2d', data.displays2d, record => record.productVariantId, 'productVariantId', 'duplicate_display');
  unique('productDetails', data.productDetails, record => record.labelId, 'labelId', 'duplicate_product_detail');
  for (const slot of data.packagingSlots) {
    const variant = data.productVariants.find(item => item.id === slot.defaultVariantId);
    if (variant && (variant.groupId !== slot.groupId || variant.packagingVariantId !== slot.packagingVariantId)) add('packagingSlots', slot.id, 'defaultVariantId', 'default_variant_mismatch', 'Hương mặc định phải thuộc cùng dòng sản phẩm và bao bì của slot.');
  }
  if (options.mode !== 'publish' || hasValidationErrors(issues)) return issues;
  const publicData = collectPublicCatalog(data);
  for (const collection of CATALOG_COLLECTIONS) for (const record of publicData[collection]) {
    issues.push(...validateRecord(collection, record, { mode: 'publish' }));
    if (record.lifecycle !== 'active') add(collection, record.id, 'lifecycle', 'dependency_archived', 'Nội dung hiển thị đang dùng bản ghi đã lưu trữ.');
  }
  if (!publicData.productGroups.length) add('productGroups', '', 'visible', 'empty_public_catalog', 'Cần ít nhất một dòng sản phẩm hiển thị hợp lệ.');
  for (const group of publicData.productGroups) if (!publicData.packagingSlots.some(slot => slot.groupId === group.id)) add('productGroups', group.id, 'visible', 'group_without_slots', 'Dòng đang hiển thị cần ít nhất một slot bao bì được bật.');
  for (const slot of publicData.packagingSlots) {
    const variants = publicData.productVariants.filter(variant => variant.groupId === slot.groupId && variant.packagingVariantId === slot.packagingVariantId);
    if (!variants.length) add('packagingSlots', slot.id, 'packagingVariantId', 'slot_without_variants', 'Slot cần ít nhất một hương sản phẩm được bật.');
    if (!variants.some(variant => variant.id === slot.defaultVariantId)) add('packagingSlots', slot.id, 'defaultVariantId', 'default_variant_unavailable', 'Hương mặc định đang thiếu, bị tắt hoặc đã lưu trữ.');
    for (const variant of variants) {
      const display3d = publicData.displays3d.find(display => display.productVariantId === variant.id);
      const display2d = publicData.displays2d.find(display => display.productVariantId === variant.id);
      if ((slot.mode === '3d' && !display3d) || (slot.mode === '2d' && !display2d) || (slot.mode === 'auto' && !display3d && !display2d)) add('productVariants', variant.id, 'enabled', 'display_unavailable', 'Hương sản phẩm chưa có cấu hình render phù hợp với chế độ slot.');
    }
  }
  for (const display of publicData.displays3d) issues.push(...checkDisplay3DCompatibility(data, display));
  for (const display of publicData.displays2d) issues.push(...checkDisplay2DCompatibility(data, display));
  // Mockup roots may have no sales display to trigger the checks above.
  for (const model of publicData.models3d) {
    for (const [field, role] of [['mediaId', 'model'], ['posterId', 'poster']] as const) {
      const media = data.media.find(item => item.id === model[field]);
      if (media && media.role !== role) add('models3d', model.id, field, 'media_role_mismatch', field === 'posterId' ? 'Ảnh poster của model phải thuộc Poster Library.' : 'File model phải thuộc thư viện GLB.');
    }
  }
  for (const label of publicData.labels) {
    const media = data.media.find(item => item.id === label.mediaId);
    if (media && media.role !== 'label') add('labels', label.id, 'mediaId', 'media_role_mismatch', 'Artwork nhãn phải thuộc Label Library.');
  }
  for (const detail of publicData.productDetails) {
    if (detail.posterId) {
      const poster = data.media.find(item => item.id === detail.posterId);
      if (poster && (!isImageMedia(poster) || poster.status !== 'ready')) add('productDetails', detail.id, 'posterId', 'poster_unavailable', 'Poster cần là ảnh đã xử lý xong.');
    }
  }
  for (const asset of publicData.flavorAssets) {
    const media = data.media.find(item => item.id === asset.mediaId);
    if (media && media.role !== asset.role) add('flavorAssets', asset.id, 'mediaId', 'media_role_mismatch', 'Vai trò ảnh phải khớp trái cây, lá, splash hoặc đá viên của slot.');
  }
  for (const flavor of publicData.flavors) {
    const thumbnail = data.media.find(item => item.id === flavor.thumbnailId);
    if (thumbnail && !isImageMedia(thumbnail)) add('flavors', flavor.id, 'thumbnailId', 'media_role_mismatch', 'Ảnh đại diện phải là ảnh PNG, JPEG hoặc WebP; không chọn file model GLB.');
    const icon = data.media.find(item => item.id === flavor.iconId);
    if (icon && (icon.role !== 'icon' || !isImageMedia(icon))) add('flavors', flavor.id, 'iconId', 'media_role_mismatch', 'Chọn ảnh từ Icon Library cho biểu tượng nền.');
    if (!flavor.thumbnailId && !resolveFlavorFruitImage(data, flavor.id)) add('flavors', flavor.id, 'thumbnailId', 'thumbnail_missing', 'Hương chưa có ảnh đại diện hoặc ảnh trái cây dùng được trong pool; giao diện dùng icon thay thế.', 'warning');
  }
  return issues;
}

export const preflightCatalog = (data: unknown) => validateCatalog(data, { mode: 'publish' });
