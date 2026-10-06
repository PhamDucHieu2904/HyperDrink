import type { CatalogData, Display2D, Display3D, Label, MediaAsset, Model3D, PackagingCategory, PackagingSlot, ValidationIssue } from './contracts';

/** PP remains its own business category; the existing generic GLB renderer accepts it as other. */
export function viewerKindForCategory(category: Pick<PackagingCategory, 'viewerKind'>): 'can' | 'glass' | 'pet' | 'pouch' | 'other' {
  return category.viewerKind === 'pp' ? 'other' : category.viewerKind;
}

function mediaIssues(data: CatalogData, id: string | null, roles: MediaAsset['role'][], collection: 'displays3d' | 'displays2d', entityId: string, field: string): ValidationIssue[] {
  const media = data.media.find(item => item.id === id);
  const issue = (code: string, message: string): ValidationIssue => ({ code, message, collection, entityId, field, severity: 'error' });
  if (!media) return [issue('media_missing', 'Chưa chọn tài nguyên tồn tại.')];
  if (media.lifecycle !== 'active') return [issue('dependency_archived', 'Tài nguyên đã được lưu trữ.')];
  if (media.status !== 'ready') return [issue('media_not_ready', 'Tài nguyên chưa xử lý xong hoặc xử lý thất bại.')];
  if (!roles.includes(media.role)) return [issue('media_role_mismatch', 'Loại tài nguyên không phù hợp với vị trí sử dụng.')];
  return [];
}

/** Packaging identity and UV layout are the shared boundary for sales and Studio.
 * Drink/flavor checks belong to a sales display, never to free Mockup pairings. */
export function checkModelLabelCompatibility(data: CatalogData, model: Model3D, label: Label): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (collection: 'models3d' | 'labels', entityId: string, field: string, code: string, message: string) => issues.push({ collection, entityId, field, code, message, severity: 'error' as const });
  if (model.lifecycle !== 'active') add('models3d', model.id, 'lifecycle', 'dependency_archived', 'Model đã được lưu trữ.');
  if (label.lifecycle !== 'active') add('labels', label.id, 'lifecycle', 'dependency_archived', 'Nhãn đã được lưu trữ.');
  if (!model.materialSlots.label?.length || model.materialSlots.label.some(name => !name.trim())) add('models3d', model.id, 'materialSlots.label', 'label_slot_missing', 'Model chưa khai báo material slot cho nhãn.');
  if (!model.layoutProfile.trim() || !label.compatibilities.some(entry => entry.packagingVariantId === model.packagingVariantId && entry.layoutProfile === model.layoutProfile && !!entry.layoutProfile.trim())) add('labels', label.id, 'compatibilities', 'layout_mismatch', 'Nhãn chưa tương thích với quy cách và profile UV của model.');
  for (const [collection, entity, role] of [['models3d', model, 'model'], ['labels', label, 'label']] as const) {
    const media = data.media.find(item => item.id === entity.mediaId);
    if (!media) add(collection, entity.id, 'mediaId', 'media_missing', 'Chưa chọn tài nguyên tồn tại.');
    else if (media.lifecycle !== 'active') add(collection, entity.id, 'mediaId', 'dependency_archived', 'Tài nguyên đã được lưu trữ.');
    else if (media.status !== 'ready') add(collection, entity.id, 'mediaId', 'media_not_ready', 'Tài nguyên chưa xử lý xong hoặc xử lý thất bại.');
    else if (media.role !== role) add(collection, entity.id, 'mediaId', 'media_role_mismatch', 'Loại tài nguyên không phù hợp với vị trí sử dụng.');
    else if (!media.url || (role === 'model' ? media.mime !== 'model/gltf-binary' : !['image/png', 'image/webp', 'image/jpeg'].includes(media.mime))) add(collection, entity.id, 'mediaId', 'media_type_mismatch', 'File model phải là GLB, artwork nhãn phải là ảnh đã xử lý.');
  }
  return issues;
}

export function checkDisplay3DCompatibility(data: CatalogData, display: Display3D): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, code: string, message: string) => issues.push({ collection: 'displays3d' as const, entityId: display.id, field, code, message, severity: 'error' as const });
  const variant = data.productVariants.find(item => item.id === display.productVariantId);
  const group = data.productGroups.find(item => item.id === variant?.groupId);
  const model = data.models3d.find(item => item.id === display.modelId);
  const label = data.labels.find(item => item.id === display.labelId);
  if (!variant || !group) add('productVariantId', 'product_missing', 'Chưa chọn tổ hợp dòng sản phẩm, bao bì và hương hợp lệ.');
  if (!model) add('modelId', 'model_missing', 'Chưa chọn model 3D.');
  if (!label) add('labelId', 'label_missing', 'Chưa chọn nhãn.');
  if (model) {
    if (!label && model.lifecycle !== 'active') add('modelId', 'dependency_archived', 'Model đã được lưu trữ.');
    if (variant && model.packagingVariantId !== variant.packagingVariantId) add('modelId', 'packaging_mismatch', 'Model không đúng quy cách bao bì của sản phẩm.');
    if (!label) {
      if (!model.materialSlots.label?.length) add('modelId', 'label_slot_missing', 'Model chưa khai báo material slot cho nhãn.');
      issues.push(...mediaIssues(data, model.mediaId, ['model'], 'displays3d', display.id, 'modelId'));
    }
    issues.push(...mediaIssues(data, model.posterId, ['poster'], 'displays3d', display.id, 'modelId.posterId').map(issue => ({ ...issue, message: model.posterId ? `Ảnh poster của model “${model.name}”: ${issue.message}` : `Model “${model.name}” chưa có ảnh poster. Chọn hoặc tải ảnh trong 3D Packaging.` })));
  }
  if (label) {
    if (!model && label.lifecycle !== 'active') add('labelId', 'dependency_archived', 'Nhãn đã được lưu trữ.');
    if (group && label.drinkTypeId !== group.drinkTypeId) add('labelId', 'drink_type_mismatch', 'Nhãn không đúng loại nước của dòng sản phẩm.');
    if (variant && label.flavorId && label.flavorId !== variant.flavorId) add('labelId', 'flavor_mismatch', 'Nhãn thuộc hương khác.');
    if (!model) issues.push(...mediaIssues(data, label.mediaId, ['label'], 'displays3d', display.id, 'labelId'));
  }
  if (model && label) issues.push(...checkModelLabelCompatibility(data, model, label).map(issue => ({ ...issue, collection: 'displays3d' as const, entityId: display.id, field: issue.collection === 'models3d' ? 'modelId' : 'labelId' })));
  return issues;
}

export function checkDisplay2DCompatibility(data: CatalogData, display: Display2D): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, code: string, message: string) => issues.push({ collection: 'displays2d' as const, entityId: display.id, field, code, message, severity: 'error' as const });
  const variant = data.productVariants.find(item => item.id === display.productVariantId);
  const group = data.productGroups.find(item => item.id === variant?.groupId);
  const asset = data.assets2d.find(item => item.id === display.assetId);
  if (!variant || !group) add('productVariantId', 'product_missing', 'Chưa chọn tổ hợp sản phẩm hợp lệ.');
  if (!asset) { add('assetId', 'asset_2d_missing', 'Chưa chọn ảnh/render 2D.'); return issues; }
  if (asset.lifecycle !== 'active') add('assetId', 'dependency_archived', 'Ảnh/render 2D đã được lưu trữ.');
  if (variant && asset.packagingVariantId !== variant.packagingVariantId) add('assetId', 'packaging_mismatch', 'Ảnh 2D không đúng quy cách bao bì.');
  if (group && asset.drinkTypeId !== group.drinkTypeId) add('assetId', 'drink_type_mismatch', 'Ảnh 2D không đúng loại nước.');
  if (variant && asset.flavorId && asset.flavorId !== variant.flavorId) add('assetId', 'flavor_mismatch', 'Ảnh 2D thuộc hương khác.');
  issues.push(...mediaIssues(data, asset.mediaId, ['image-2d'], 'displays2d', display.id, 'assetId'));
  for (const id of asset.galleryIds) issues.push(...mediaIssues(data, id, ['image-2d'], 'displays2d', display.id, 'assetId'));
  return issues;
}

/** All products explicitly switched off is different from an unfinished slot
 * with no products. Omit the former while keeping validation for the latter. */
export function slotHasOnlyDisabledProducts(data: CatalogData, slot: PackagingSlot): boolean {
  const products = data.productVariants.filter(item => item.lifecycle === 'active' && item.groupId === slot.groupId && item.packagingVariantId === slot.packagingVariantId);
  return slot.defaultVariantId === null && products.length > 0 && products.every(item => !item.enabled);
}

export function groupHasOnlyDisabledProducts(data: CatalogData, groupId: string): boolean {
  const slots = data.packagingSlots.filter(item => item.lifecycle === 'active' && item.enabled && item.groupId === groupId);
  return slots.length > 0 && slots.every(slot => slotHasOnlyDisabledProducts(data, slot));
}

/** Sales roots alone define legacy Mockup permissions, even in expanded releases. */
export function collectSalesCatalogRoots(data: CatalogData) {
  const groups = data.productGroups.filter(item => item.lifecycle === 'active' && (item.visible || item.collectionVisible === true) && !groupHasOnlyDisabledProducts(data, item.id));
  const groupIds = new Set(groups.map(item => item.id));
  const slots = data.packagingSlots.filter(item => item.lifecycle === 'active' && item.enabled && groupIds.has(item.groupId) && !slotHasOnlyDisabledProducts(data, item));
  const variants = data.productVariants.filter(item => item.lifecycle === 'active' && item.enabled && slots.some(slot => slot.groupId === item.groupId && slot.packagingVariantId === item.packagingVariantId));
  const variantIds = new Set(variants.map(item => item.id));
  const displays3d = data.displays3d.filter(item => item.lifecycle === 'active' && item.enabled && variantIds.has(item.productVariantId) && slots.some(slot => slot.mode !== '2d' && variants.some(variant => variant.id === item.productVariantId && variant.groupId === slot.groupId && variant.packagingVariantId === slot.packagingVariantId)));
  const displays2d = data.displays2d.filter(item => item.lifecycle === 'active' && item.enabled && variantIds.has(item.productVariantId));
  return { groups, slots, variants, displays3d, displays2d };
}

/** Only sales reachability and explicitly enabled Mockup roots enter the release. */
export function collectPublicCatalog(data: CatalogData): CatalogData {
  const { groups, slots, variants, displays3d, displays2d } = collectSalesCatalogRoots(data);
  const modelIds = new Set(displays3d.map(item => item.modelId)); const labelIds = new Set(displays3d.map(item => item.labelId)); const assetIds = new Set(displays2d.map(item => item.assetId));
  const salesLabelIds = new Set(labelIds);
  for (const model of data.models3d) if (model.lifecycle === 'active' && model.mockupVisible === true) modelIds.add(model.id);
  for (const label of data.labels) if (label.lifecycle === 'active' && label.mockupVisible === true) labelIds.add(label.id);
  const models = data.models3d.filter(item => modelIds.has(item.id)); const labels = data.labels.filter(item => labelIds.has(item.id)); const assets = data.assets2d.filter(item => assetIds.has(item.id));
  const salesFlavorIds = new Set(variants.map(item => item.flavorId));
  const flavorIds = new Set([...salesFlavorIds, ...labels.map(item => item.flavorId)]);
  const flavors = data.flavors.filter(item => flavorIds.has(item.id));
  const productDetails = (data.productDetails ?? []).filter(item => item.lifecycle === 'active' && item.enabled && salesLabelIds.has(item.labelId));
  const flavorAssets = data.flavorAssets.filter(item => item.lifecycle === 'active' && item.enabled && salesFlavorIds.has(item.flavorId));
  const packageIds = new Set([...slots.map(item => item.packagingVariantId), ...variants.map(item => item.packagingVariantId), ...models.map(item => item.packagingVariantId), ...assets.map(item => item.packagingVariantId), ...labels.flatMap(item => item.compatibilities.map(entry => entry.packagingVariantId))]);
  const packaging = data.packagingVariants.filter(item => packageIds.has(item.id)); const categoryIds = new Set(packaging.map(item => item.categoryId));
  const drinkIds = new Set([...groups.map(item => item.drinkTypeId), ...labels.map(item => item.drinkTypeId), ...assets.map(item => item.drinkTypeId)]);
  const mediaIds = new Set([...flavors.flatMap(item => [item.thumbnailId, item.iconId]), ...flavorAssets.map(item => item.mediaId), ...models.flatMap(item => [item.mediaId, item.posterId]), ...labels.map(item => item.mediaId), ...assets.flatMap(item => [item.mediaId, ...item.galleryIds]), ...productDetails.map(item => item.posterId)]);
  return { schemaVersion: 1, drinkTypes: data.drinkTypes.filter(item => drinkIds.has(item.id)), packagingCategories: data.packagingCategories.filter(item => categoryIds.has(item.id)), packagingVariants: packaging, flavors, flavorAssets, productGroups: groups, productVariants: variants, packagingSlots: slots, media: data.media.filter(item => mediaIds.has(item.id)), labels, models3d: models, assets2d: assets, displays3d, displays2d, productDetails };
}
