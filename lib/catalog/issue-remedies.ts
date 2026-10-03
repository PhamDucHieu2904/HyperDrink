import type { CatalogData, CollectionName, ValidationIssue } from './contracts';

export type RecordIssueRemedy = {
  kind: 'record'; collection: CollectionName; recordId: string; field: string; label: string; message: string;
};
export type DisplayIssueRemedy = {
  kind: 'display'; mode: '3d' | '2d'; displayId: string; variantId: string; field: string; label: string; message: string;
};
export type IssueRemedy = RecordIssueRemedy | DisplayIssueRemedy;

/** Route a validation finding to the editable data it actually depends on.
 * Missing displays have no list row, so start a form for the existing variant. */
export function issueRemedy(data: CatalogData, issue: ValidationIssue): IssueRemedy | null {
  const record = data[issue.collection].find(item => item.id === issue.entityId);
  if (!record) return null;
  const poster = (recordId: string): RecordIssueRemedy | null => data.models3d.some(model => model.id === recordId) ? {
    kind: 'record', collection: 'models3d', recordId, field: 'posterId', label: 'Sửa ảnh poster',
    message: 'Ảnh poster của model chưa có hoặc chưa hợp lệ. Mở model để chọn hoặc tải ảnh poster.',
  } : null;
  if (issue.collection === 'models3d' && issue.field === 'posterId') return poster(record.id);
  if (issue.collection === 'displays3d') {
    const display = data.displays3d.find(item => item.id === record.id)!;
    const model = data.models3d.find(item => item.id === display.modelId);
    // Older running API versions attached a missing poster to modelId. Resolve
    // that finding by inspecting the dependency, without changing saved data.
    const legacyPoster = issue.field === 'modelId' && issue.code === 'media_missing' && model && !model.posterId && data.media.some(media => media.id === model.mediaId);
    if ((issue.field === 'modelId.posterId' || legacyPoster) && display.modelId) return poster(display.modelId);
    return { kind: 'display', mode: '3d', displayId: display.id, variantId: display.productVariantId, field: issue.field?.split('.')[0] || '', label: 'Sửa hiển thị 3D', message: issue.message };
  }
  if (issue.collection === 'displays2d') {
    const display = data.displays2d.find(item => item.id === record.id)!;
    return { kind: 'display', mode: '2d', displayId: display.id, variantId: display.productVariantId, field: issue.field?.split('.')[0] || '', label: 'Sửa hiển thị 2D', message: issue.message };
  }
  if (issue.collection === 'productVariants' && issue.code === 'display_unavailable') {
    const variant = data.productVariants.find(item => item.id === record.id)!;
    const slot = data.packagingSlots.find(item => item.lifecycle === 'active' && item.enabled && item.groupId === variant.groupId && item.packagingVariantId === variant.packagingVariantId);
    if (!slot) return null;
    const existing3d = data.displays3d.find(item => item.lifecycle === 'active' && item.productVariantId === variant.id);
    const existing2d = data.displays2d.find(item => item.lifecycle === 'active' && item.productVariantId === variant.id);
    const mode = slot.mode === '2d' || (slot.mode === 'auto' && !existing3d && existing2d) ? '2d' : '3d';
    const display = mode === '3d' ? existing3d : existing2d;
    return {
      kind: 'display', mode, displayId: display?.id || '', variantId: variant.id,
      field: display ? 'enabled' : mode === '3d' ? 'modelId' : 'assetId',
      label: `${display ? 'Sửa' : 'Tạo'} hiển thị ${mode.toUpperCase()}`,
      message: display ? `Cấu hình ${mode.toUpperCase()} đang tắt. Mở cấu hình để bật hoặc bổ sung dữ liệu.` : `Sản phẩm đã bật nhưng chưa có cấu hình ${mode.toUpperCase()}. Mở panel để ghép tài nguyên; dòng sản phẩm, bao bì và hương sẽ được chọn sẵn.`,
    };
  }
  return { kind: 'record', collection: issue.collection, recordId: record.id, field: issue.field?.split('.')[0] || '', label: 'Đi đến chỗ sửa', message: issue.message };
}
