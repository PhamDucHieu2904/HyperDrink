import type { MediaAsset, MediaRole } from '@/lib/catalog/contracts';

/** Human-facing upload guidance; the server remains responsible for enforcing limits. */
export function imageUploadHelp(role: MediaRole): string {
  if (role === 'model') return 'GLB được kiểm tra và lưu ở định dạng gốc. Ảnh poster được tải lên riêng.';
  const maxEdge = role === 'label' ? 2048 : role === 'thumbnail' ? 512 : role === 'icon' ? 256 : 1600;
  return `Nhận PNG, JPG và WebP. Tự chuyển sang WebP, giảm cạnh dài xuống tối đa ${maxEdge.toLocaleString('vi-VN')} px, giữ tỷ lệ và vùng trong suốt; không phóng lớn ảnh nhỏ hoặc cắt ảnh.`;
}

export function uploadPendingText(role: MediaRole): string {
  return role === 'model' ? 'Đang tải và kiểm tra GLB…' : 'Đang tải và tối ưu ảnh…';
}

export function mediaSummary(media: MediaAsset): string {
  const format = ({ 'image/webp': 'WebP', 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'model/gltf-binary': 'GLB' } as Record<string, string>)[media.mime] || media.mime;
  const dimensions = media.width && media.height ? `${media.width.toLocaleString('vi-VN')} × ${media.height.toLocaleString('vi-VN')} px` : '';
  const size = media.bytes > 0 ? media.bytes < 1024 ? `${media.bytes} B` : media.bytes >= 1024 * 1024 ? `${(media.bytes / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} MB` : `${(media.bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB` : 'Tài nguyên có sẵn';
  return [format, dimensions, size].filter(Boolean).join(' · ');
}
