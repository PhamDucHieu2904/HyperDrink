import type { CatalogData, CatalogRecord, CollectionName, MediaRole } from '@/lib/catalog/contracts';

export type FieldKind = 'text' | 'textarea' | 'number' | 'checkbox' | 'color' | 'select' | 'media' | 'compatibilities' | 'json' | 'orientation';
export interface CatalogField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  relation?: CollectionName;
  options?: { value: string; label: string }[];
  roles?: MediaRole[];
  nullable?: boolean;
  advanced?: boolean;
}
export interface CollectionDefinition { title: string; singular: string; description: string; fields: CatalogField[] }

const position: CatalogField = { key: 'position', label: 'Thứ tự hiển thị', kind: 'number', help: 'Số nhỏ đứng trước. Button xếp từ trái sang phải, sau đó trên xuống dưới.' };
const packaging: CatalogField = { key: 'packagingVariantId', label: 'Quy cách bao bì', kind: 'select', relation: 'packagingVariants', required: true };
const drink: CatalogField = { key: 'drinkTypeId', label: 'Loại nước uống', kind: 'select', relation: 'drinkTypes', required: true };
const flavor: CatalogField = { key: 'flavorId', label: 'Hương vị', kind: 'select', relation: 'flavors', nullable: true };
const description: CatalogField = { key: 'description', label: 'Mô tả', kind: 'textarea' };
export const definitions: Partial<Record<CollectionName, CollectionDefinition>> = {
  drinkTypes: { title: 'Type of Drink', singular: 'loại nước uống', description: 'Danh mục phân loại nước uống, dùng chung cho dòng sản phẩm và nhãn.', fields: [description, position] },
  packagingCategories: { title: 'Nhóm bao bì', singular: 'nhóm bao bì', description: 'Phân loại vật liệu và cách renderer nhận diện bao bì.', fields: [{ key: 'viewerKind', label: 'Loại hình học', kind: 'select', required: true, options: [{ value: 'can', label: 'Lon nhôm' }, { value: 'glass', label: 'Chai thủy tinh' }, { value: 'pp', label: 'Chai PP' }, { value: 'pet', label: 'Chai PET' }, { value: 'pouch', label: 'Túi' }, { value: 'other', label: 'Khác' }] }, position] },
  packagingVariants: { title: 'Quy cách bao bì', singular: 'quy cách bao bì', description: 'Dung tích và kiểu dáng riêng biệt. 250 ml short và sleek là hai quy cách khác nhau.', fields: [{ key: 'categoryId', label: 'Nhóm bao bì', kind: 'select', relation: 'packagingCategories', required: true }, { key: 'volumeMl', label: 'Dung tích (ml)', kind: 'number', nullable: true, help: 'Để trống nếu bao bì không áp dụng dung tích.' }, { key: 'shape', label: 'Kiểu dáng', kind: 'text', help: 'Ví dụ: short, sleek, standard.' }, position] },
  flavors: { title: 'Flavor Data', singular: 'hương vị', description: 'Màu sắc, hình ảnh và biểu tượng dùng nhất quán trên website.', fields: [{ key: 'shortName', label: 'Tên ngắn', kind: 'text', required: true }, description, { key: 'accentColor', label: 'Màu nhấn', kind: 'color' }, { key: 'backgroundColor', label: 'Màu nền', kind: 'color' }, { key: 'textColor', label: 'Màu chữ', kind: 'color' }, { key: 'icon', label: 'Mã biểu tượng', kind: 'select', options: [{ value: 'citrus', label: 'Cam / Citrus' }, { value: 'lime', label: 'Chanh xanh' }, { value: 'berry', label: 'Quả mọng' }, { value: 'peach', label: 'Đào' }, { value: 'leaf', label: 'Lá cây' }], help: 'Chọn biểu tượng từ bộ đã hỗ trợ; ảnh nền được quản lý riêng bên dưới.' }, { key: 'thumbnailId', label: 'Ảnh đại diện', kind: 'media', roles: ['thumbnail'], nullable: true }, position] },
  flavorAssets: { title: 'Ảnh trang trí hương vị', singular: 'ảnh trang trí', description: 'Mỗi pool tách trái cây, lá và splash. Nhiều ảnh được chọn ngẫu nhiên theo đúng vai trò.', fields: [{ ...flavor, required: true, nullable: false }, { key: 'role', label: 'Vai trò trong cảnh', kind: 'select', options: [{ value: 'fruit', label: 'Trái cây' }, { value: 'leaf', label: 'Lá cây' }, { value: 'splash', label: 'Splash' }], required: true }, { key: 'mediaId', label: 'Ảnh trang trí', kind: 'media', roles: ['fruit', 'leaf', 'splash'], required: true }, position, { key: 'enabled', label: 'Cho phép chọn trong pool', kind: 'checkbox' }] },
  productGroups: { title: 'Product Display', singular: 'dòng sản phẩm', description: 'Các dòng sản phẩm và tên button trên trang chính. Tên dòng tách biệt dung tích bao bì.', fields: [drink, { key: 'buttonLabel', label: 'Tên button', kind: 'text', required: true, help: 'Ví dụ Juice 30%. Dung tích 330 ml được khai báo trong bao bì.' }, description, position, { key: 'visible', label: 'Hiển thị dòng sản phẩm', kind: 'checkbox' }] },
  packagingSlots: { title: 'Slot bao bì', singular: 'slot bao bì', description: 'Thứ tự các button bao bì trong từng dòng sản phẩm.', fields: [{ key: 'groupId', label: 'Dòng sản phẩm', kind: 'select', relation: 'productGroups', required: true }, packaging, { key: 'buttonLabel', label: 'Tên button bao bì', kind: 'text', required: true, help: 'Ví dụ 330 ml hoặc 250 ml sleek.' }, { key: 'mode', label: 'Chế độ hiển thị', kind: 'select', options: [{ value: 'auto', label: 'Tự động · ưu tiên 3D' }, { value: '3d', label: '3D' }, { value: '2d', label: '2D' }] }, { key: 'defaultVariantId', label: 'Sản phẩm/hương mặc định', kind: 'select', relation: 'productVariants', nullable: true, help: 'Chỉ những tổ hợp thuộc đúng dòng và bao bì này được chọn.' }, position, { key: 'enabled', label: 'Bật slot', kind: 'checkbox' }] },
  labels: { title: 'Label Library', singular: 'nhãn', description: 'Artwork nhãn và các quy cách bao bì tương thích.', fields: [drink, { ...flavor, help: 'Để trống cho nhãn dùng chung; chọn hương để khóa đúng sản phẩm.' }, { key: 'mediaId', label: 'Artwork nhãn', kind: 'media', roles: ['label'], nullable: true }, { key: 'compatibilities', label: 'Bao bì tương thích', kind: 'compatibilities', help: 'Chọn bao bì, hệ thống tự khớp kiểu nhãn. Nếu có nhiều kiểu, chọn model dùng artwork này.' }] },
  models3d: { title: '3D Packaging', singular: 'model 3D', description: 'Geometry độc lập với nhãn và hương vị. Tái sử dụng model cho các tổ hợp tương thích.', fields: [packaging, { key: 'mediaId', label: 'File GLB', kind: 'media', roles: ['model'], nullable: true }, { key: 'posterId', label: 'Ảnh poster', kind: 'media', roles: ['poster'], nullable: true }, { key: 'layoutProfile', label: 'Mã kiểu trải nhãn (UV)', kind: 'text', advanced: true, help: 'Tự điền theo bao bì. Chỉ đổi khi người chuẩn bị GLB dùng một cách trải nhãn khác; nhãn phải có cùng mã.' }, { key: 'materialSlots', label: 'Ánh xạ material slots (JSON)', kind: 'json', advanced: true, help: 'Map slot ngữ nghĩa tới tên mesh/material thật. Ví dụ {"label":["Label"]}.' }, { key: 'orientation', label: 'Orientation X / Y / Z (radian)', kind: 'orientation', advanced: true }] },
  assets2d: { title: 'Kho hình 2D', singular: 'hình bao bì 2D', description: 'Ảnh/render hoàn thiện của sản phẩm, không phải file texture nhãn.', fields: [packaging, drink, flavor, { key: 'mediaId', label: 'Ảnh chính', kind: 'media', roles: ['image-2d'], nullable: true }, description] },
};

export function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function newRecord(collection: CollectionName, context: Record<string, unknown> = {}): CatalogRecord {
  const now = new Date().toISOString();
  const base = { id: crypto.randomUUID(), name: '', slug: '', lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now };
  const defaults: Partial<Record<CollectionName, Record<string, unknown>>> = {
    drinkTypes: { description: '', position: 0 },
    packagingCategories: { viewerKind: 'other', position: 0 },
    packagingVariants: { categoryId: '', volumeMl: null, shape: '', position: 0 },
    flavors: { shortName: '', description: '', accentColor: '#58a66a', backgroundColor: '#e8f3eb', textColor: '#18392a', icon: 'leaf', thumbnailId: null, position: 0 },
    flavorAssets: { flavorId: '', mediaId: '', role: 'fruit', position: 0, enabled: true },
    productGroups: { drinkTypeId: '', description: '', buttonLabel: '', position: 0, visible: true },
    packagingSlots: { groupId: '', packagingVariantId: '', regionKey: 'packaging-picker', position: 0, buttonLabel: '', mode: 'auto', defaultVariantId: null, enabled: true },
    labels: { drinkTypeId: '', flavorId: null, mediaId: null, compatibilities: [] },
    models3d: { packagingVariantId: '', mediaId: null, posterId: null, layoutProfile: '', materialSlots: { label: [] }, orientation: [0, 0, 0] },
    assets2d: { packagingVariantId: '', drinkTypeId: '', flavorId: null, mediaId: null, galleryIds: [], description: '' },
  };
  return { ...base, ...defaults[collection], ...context } as CatalogRecord;
}

export function recordDetails(collection: CollectionName, record: CatalogRecord, data: CatalogData): string {
  const value = record as unknown as Record<string, unknown>;
  const ref = (kind: CollectionName, id: unknown) => data[kind].find(item => item.id === id)?.name ?? 'Chưa chọn';
  if (collection === 'productGroups') return `${ref('drinkTypes', value.drinkTypeId)} · Button: ${value.buttonLabel}`;
  if (collection === 'packagingCategories') return `${data.packagingVariants.filter(item => item.categoryId === record.id).length} quy cách`;
  if (collection === 'packagingVariants') return `${ref('packagingCategories', value.categoryId)} · ${value.volumeMl ? `${value.volumeMl} ml` : 'Không có dung tích'}${value.shape ? ` · ${value.shape}` : ''}`;
  if (collection === 'flavors') return `${data.flavorAssets.filter(item => item.flavorId === record.id && item.enabled).length} ảnh trong pool · ${value.shortName}`;
  if (collection === 'flavorAssets') return `${ref('flavors', value.flavorId)} · ${value.role === 'fruit' ? 'Trái cây' : value.role === 'leaf' ? 'Lá cây' : 'Splash'}`;
  if (collection === 'labels') return `${ref('drinkTypes', value.drinkTypeId)} · ${(value.compatibilities as unknown[]).length} quy cách tương thích`;
  if (collection === 'models3d') return `${ref('packagingVariants', value.packagingVariantId)} · ${value.layoutProfile ? 'Tự khớp nhãn theo model' : 'Chưa có kiểu trải nhãn'}`;
  if (collection === 'packagingSlots') return `${ref('productGroups', value.groupId)} · ${ref('packagingVariants', value.packagingVariantId)} · ${String(value.mode).toUpperCase()}`;
  return typeof value.description === 'string' && value.description ? value.description : record.slug;
}
