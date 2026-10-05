import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaAsset, MediaRole } from '../../catalog/contracts';
import { inspectMedia, MediaValidationError } from './inspect';

const imageLimits: Record<Exclude<MediaRole, 'model'>, number> = {
  label: 2048,
  thumbnail: 512,
  icon: 256,
  fruit: 1600,
  leaf: 1600,
  splash: 1600,
  poster: 1600,
  'image-2d': 1600,
};
const decoderOptions = { failOn: 'warning' as const, limitInputPixels: 32_000_000 };

/** Bounds describe visible content for scene framing; they never crop the stored image. */
async function alphaBounds(buffer: Buffer, role: MediaRole, hasAlpha: boolean): Promise<MediaAsset['imageBounds']> {
  if (!hasAlpha || !['fruit', 'leaf', 'splash', 'icon'].includes(role)) return null;
  const { data, info } = await sharp(buffer, decoderOptions).ensureAlpha().extractChannel('alpha').raw()
    .timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  // A wholly transparent image has no usable visible bounds.
  return right < left ? null : [left / info.width, top / info.height, (right + 1) / info.width, (bottom + 1) / info.height];
}

/** Shared deterministic transform for uploads and import deduplication. Source bytes are never stored. */
export async function optimizeImage(buffer: Buffer, role: Exclude<MediaRole, 'model'>) {
  const source = inspectMedia(buffer, role);
  try {
    const limit = imageLimits[role];
    const { data, info } = await sharp(buffer, decoderOptions)
      .autoOrient()
      // Fit without padding, cropping or distortion. Vector input can rasterize at icon resolution.
      .resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: source.extension !== 'svg' })
      .toColourspace('srgb')
      .webp({ quality: role === 'label' ? 90 : 82, alphaQuality: 100, effort: 4 })
      .timeout({ seconds: 15 })
      .toBuffer({ resolveWithObject: true });
    const inspection = inspectMedia(data, role);
    if (inspection.mime !== 'image/webp' || info.width > limit || info.height > limit) throw new Error('Unexpected optimized image.');
    return { buffer: data, inspection, imageBounds: await alphaBounds(data, role, info.channels === 4) };
  } catch {
    throw new MediaValidationError('Không thể giải mã hoặc tối ưu ảnh. File có thể bị hỏng hoặc vượt giới hạn xử lý.');
  }
}

export function getMediaPath(storageKey: string, dataDir = path.resolve(process.cwd(), 'data/admin')): string {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp|glb)$/.test(storageKey)) throw new MediaValidationError('Tên lưu trữ không hợp lệ.');
  return path.resolve(dataDir, 'media', storageKey);
}

export async function processUpload(file: File, role: MediaRole, dataDir = path.resolve(process.cwd(), 'data/admin')): Promise<MediaAsset> {
  if (file.size > (role === 'model' ? 30 : 20) * 1024 * 1024) throw new MediaValidationError('File vượt giới hạn dung lượng cho phép.');
  const input = Buffer.from(await file.arrayBuffer());
  const inputInspection = inspectMedia(input, role);
  if (file.type && !['application/octet-stream', inputInspection.mime, ...(inputInspection.mime === 'model/gltf-binary' ? ['model/gltf-binary', 'application/gltf-buffer'] : [])].includes(file.type.toLowerCase())) throw new MediaValidationError('Loại file khai báo không khớp với nội dung thực tế.');
  // Keep GLB bytes intact. Image metadata/checksums refer to the served WebP, not its source.
  const { buffer, inspection, imageBounds } = role === 'model'
    ? { buffer: input, inspection: inputInspection, imageBounds: null }
    : await optimizeImage(input, role);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const storageKey = `${sha256}.${inspection.extension}`, target = getMediaPath(storageKey, dataDir);
  await mkdir(path.dirname(target), { recursive: true });
  try { await writeFile(target, buffer, { flag: 'wx' }); }
  catch (cause) {
    if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw cause;
    const existing = await readFile(target);
    if (createHash('sha256').update(existing).digest('hex') !== sha256) throw new MediaValidationError('File lưu trữ hiện có không khớp checksum.');
  }
  const id = randomUUID(), now = new Date().toISOString();
  const originalName = file.name.replace(/[\u0000-\u001f<>]/g, '').split(/[\\/]/).pop() || `Tài nguyên ${inspection.extension}`;
  return { id, name: originalName.slice(0, 160), slug: `media-${id}`, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now,
    role, status: 'ready', url: `/api/public/v1/media/${id}`, storageKey, mime: inspection.mime, bytes: buffer.length, sha256,
    width: inspection.width, height: inspection.height, imageBounds, error: '' };
}
