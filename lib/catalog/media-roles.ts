import type { MediaAsset, MediaRole } from './contracts';

export const IMAGE_MEDIA_ROLES: Exclude<MediaRole, 'model'>[] = ['thumbnail', 'label', 'fruit', 'leaf', 'splash', 'icon', 'poster', 'image-2d'];
export const MEDIA_ROLE_LABELS: Record<MediaRole, string> = {
  thumbnail: 'Ảnh đại diện', label: 'Label · Nhãn', fruit: 'Fruit · Trái cây', leaf: 'Leaf · Lá cây',
  splash: 'Splash', icon: 'Icon · Biểu tượng', poster: 'Poster 3D', 'image-2d': '2D model · Bao bì', model: 'GLB · Model 3D',
};
export function isImageMedia(media: MediaAsset): boolean {
  return IMAGE_MEDIA_ROLES.includes(media.role as Exclude<MediaRole, 'model'>) && ['image/png', 'image/jpeg', 'image/webp'].includes(media.mime);
}
export function mediaUploadAccept(role: MediaRole): string {
  return role === 'model' ? '.glb' : `image/png,image/jpeg,image/webp${role === 'icon' ? ',image/svg+xml,.svg' : ''}`;
}
