import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MediaAsset, MediaRole } from '../../catalog/contracts';
import { inspectMedia, MediaValidationError } from './inspect';

export function getMediaPath(storageKey: string, dataDir = path.resolve(process.cwd(), 'data/admin')): string {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp|glb)$/.test(storageKey)) throw new MediaValidationError('Tên lưu trữ không hợp lệ.');
  return path.resolve(dataDir, 'media', storageKey);
}

export async function processUpload(file: File, role: MediaRole, dataDir = path.resolve(process.cwd(), 'data/admin')): Promise<MediaAsset> {
  if (file.size > (role === 'model' ? 30 : 20) * 1024 * 1024) throw new MediaValidationError('File vượt giới hạn dung lượng cho phép.');
  const buffer = Buffer.from(await file.arrayBuffer());
  const inspection = inspectMedia(buffer, role);
  if (file.type && !['application/octet-stream', inspection.mime, ...(inspection.mime === 'model/gltf-binary' ? ['model/gltf-binary', 'application/gltf-buffer'] : [])].includes(file.type.toLowerCase())) throw new MediaValidationError('Loại file khai báo không khớp với nội dung thực tế.');
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
    width: inspection.width, height: inspection.height, imageBounds: null, error: '' };
}
