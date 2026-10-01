import type { MediaRole } from '../../catalog/contracts';

export class MediaValidationError extends Error {
  readonly code = 'INVALID_MEDIA';
}

export interface GLBInspection {
  materialNames: string[];
  meshNames: string[];
  materialSlots: Record<string, string[]>;
  hasUv: boolean;
  triangleCount: number;
  layoutProfile: string;
}

export interface MediaInspection {
  mime: string;
  extension: 'png' | 'jpg' | 'webp' | 'glb';
  width: number | null;
  height: number | null;
  model?: GLBInspection;
}

const fail = (message: string): never => { throw new MediaValidationError(message); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const uint = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const roles: MediaRole[] = ['fruit', 'leaf', 'splash', 'thumbnail', 'icon', 'label', 'model', 'poster', 'image-2d'];
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data: Buffer) { let value = 0xffffffff; for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 32_000_000) {
    fail('Ảnh phải có kích thước hợp lệ, tối đa 8192 px mỗi chiều và 32 triệu pixel.');
  }
  return { width, height };
}

function inspectPng(buffer: Buffer): MediaInspection {
  let offset = 8;
  let width = 0, height = 0, imageData = false, finished = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (length > buffer.length - offset - 12) fail('PNG bị thiếu dữ liệu hoặc sai cấu trúc.');
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) fail('PNG có checksum không hợp lệ.');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) fail('PNG thiếu thông tin kích thước.');
    if (type === 'IHDR') {
      if (offset !== 8) fail('PNG có header trùng.');
      width = buffer.readUInt32BE(offset + 8); height = buffer.readUInt32BE(offset + 12);
      if (![0, 2, 3, 4, 6].includes(buffer[offset + 17]) || ![1, 2, 4, 8, 16].includes(buffer[offset + 16]) || buffer[offset + 18] !== 0 || buffer[offset + 19] !== 0 || buffer[offset + 20] > 1) fail('PNG dùng định dạng không hợp lệ.');
    }
    if (type === 'acTL') fail('Ảnh động chưa được hỗ trợ. Hãy dùng ảnh PNG tĩnh.');
    if (type === 'IDAT' && length > 0) imageData = true;
    offset += length + 12;
    if (type === 'IEND') { if (length !== 0 || offset !== buffer.length) fail('PNG có phần kết thúc không hợp lệ.'); finished = true; break; }
  }
  if (!imageData || !finished) fail('PNG chưa hoàn chỉnh.');
  return { mime: 'image/png', extension: 'png', ...dimensions(width, height) };
}

function inspectJpeg(buffer: Buffer): MediaInspection {
  if (buffer.length < 12 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) fail('JPEG chưa hoàn chỉnh.');
  let offset = 2, width = 0, height = 0, scan = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset++] !== 0xff) fail('JPEG sai cấu trúc.');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) fail('JPEG bị thiếu dữ liệu.');
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) fail('JPEG có segment không hợp lệ.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) fail('JPEG thiếu thông tin kích thước.');
      height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5);
    }
    if (marker === 0xda) { scan = true; break; }
    offset += length;
  }
  if (!scan) fail('JPEG thiếu dữ liệu ảnh.');
  return { mime: 'image/jpeg', extension: 'jpg', ...dimensions(width, height) };
}

function inspectWebp(buffer: Buffer): MediaInspection {
  if (buffer.length < 30 || buffer.readUInt32LE(4) + 8 !== buffer.length) fail('WebP chưa hoàn chỉnh.');
  let offset = 12, width = 0, height = 0, hasImage = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (size > buffer.length - start) fail('WebP có chunk không hợp lệ.');
    if (type === 'ANIM' || type === 'ANMF') fail('WebP động chưa được hỗ trợ.');
    if (type === 'VP8X') {
      if (size !== 10 || buffer[start] & 2) fail('WebP mở rộng không hợp lệ hoặc là ảnh động.');
      width = 1 + buffer.readUIntLE(start + 4, 3); height = 1 + buffer.readUIntLE(start + 7, 3);
    } else if (type === 'VP8 ') {
      if (size < 10 || buffer.toString('hex', start + 3, start + 6) !== '9d012a') fail('WebP thiếu frame hợp lệ.');
      if (!width) { width = buffer.readUInt16LE(start + 6) & 0x3fff; height = buffer.readUInt16LE(start + 8) & 0x3fff; }
      hasImage = true;
    } else if (type === 'VP8L') {
      if (size < 5 || buffer[start] !== 0x2f) fail('WebP lossless không hợp lệ.');
      if (!width) { const bits = buffer.readUInt32LE(start + 1); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
      hasImage = true;
    }
    offset = start + size + (size & 1);
  }
  if (offset !== buffer.length || !hasImage) fail('WebP thiếu dữ liệu ảnh.');
  return { mime: 'image/webp', extension: 'webp', ...dimensions(width, height) };
}

/** Checks a bounded, self-contained glTF container. Visual/UV alignment still requires preview. */
export function inspectGlb(buffer: Buffer): GLBInspection {
  if (buffer.length < 28 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) fail('Model phải là GLB 2.0 hoàn chỉnh.');
  let offset = 12, json: Record<string, unknown> | undefined, binBytes = 0, chunks = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4);
    if (length % 4 || length > buffer.length - offset - 8) fail('GLB có chunk không hợp lệ.');
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (chunks === 0 && type !== 0x4e4f534a) fail('GLB thiếu JSON header.');
    if (type === 0x4e4f534a) {
      if (json || length > 4 * 1024 * 1024) fail('GLB có JSON quá lớn hoặc trùng.');
      try { json = object(JSON.parse(chunk.toString('utf8').trimEnd())); } catch { fail('GLB chứa JSON không hợp lệ.'); }
    } else if (type === 0x004e4942) { if (binBytes) fail('GLB có nhiều binary chunk.'); binBytes = length; }
    else fail('GLB dùng chunk chưa hỗ trợ.');
    offset += 8 + length; chunks++;
  }
  if (!json) return fail('GLB thiếu JSON header.');
  if (offset !== buffer.length || !binBytes || object(json.asset).version !== '2.0') fail('GLB thiếu tài nguyên hoặc dùng phiên bản chưa hỗ trợ.');
  const buffers = list(json.buffers), views = list(json.bufferViews), accessors = list(json.accessors), materials = list(json.materials), meshes = list(json.meshes), nodes = list(json.nodes), scenes = list(json.scenes);
  if (buffers.length !== 1 || object(buffers[0]).uri !== undefined || !uint(object(buffers[0]).byteLength) || Number(object(buffers[0]).byteLength) > binBytes || binBytes - Number(object(buffers[0]).byteLength) > 3) fail('Model phải tự chứa toàn bộ buffers, không tải URL bên ngoài.');
  for (const viewValue of views) {
    const view = object(viewValue), start = view.byteOffset ?? 0;
    if (view.buffer !== 0 || !uint(start) || !uint(view.byteLength) || Number(start) + Number(view.byteLength) > Number(object(buffers[0]).byteLength)) fail('GLB có bufferView vượt giới hạn dữ liệu.');
  }
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  for (const accessorValue of accessors) {
    const accessor = object(accessorValue), offset = accessor.byteOffset ?? 0;
    const componentSize = componentBytes[Number(accessor.componentType)], count = Number(accessor.count), elementSize = componentSize * components[String(accessor.type)];
    if (!uint(accessor.count) || count > 1_000_000 || !uint(offset) || !elementSize || accessor.sparse !== undefined) fail('GLB có accessor không hợp lệ, quá lớn hoặc dùng sparse chưa hỗ trợ.');
    if (accessor.bufferView !== undefined) {
      if (!uint(accessor.bufferView) || Number(accessor.bufferView) >= views.length) fail('GLB accessor trỏ tới bufferView không tồn tại.');
      const view = object(views[Number(accessor.bufferView)]), stride = view.byteStride ?? elementSize;
      if (!uint(stride) || Number(stride) < elementSize || Number(stride) > 252 || Number(offset) + Math.max(0, count - 1) * Number(stride) + (count ? elementSize : 0) > Number(view.byteLength)) fail('GLB accessor vượt giới hạn bufferView.');
    }
  }
  for (const imageValue of list(json.images)) {
    const image = object(imageValue);
    if (image.uri !== undefined || !uint(image.bufferView) || Number(image.bufferView) >= views.length || !['image/png', 'image/jpeg', 'image/webp'].includes(String(image.mimeType))) fail('Ảnh trong GLB phải được nhúng PNG, JPEG hoặc WebP; URL ngoài và KTX2 chưa hỗ trợ.');
  }
  if (!scenes.length || !uint(json.scene ?? 0) || Number(json.scene ?? 0) >= scenes.length) fail('GLB thiếu scene mặc định.');
  const visiting = new Set<number>(), visited = new Set<number>();
  const visit = (nodeIndex: unknown, depth: number) => {
    if (!uint(nodeIndex) || Number(nodeIndex) >= nodes.length || depth > 128) fail('GLB có cây node không hợp lệ.');
    const index = Number(nodeIndex);
    if (visiting.has(index)) fail('GLB có node tham chiếu vòng.');
    if (visited.has(index)) return;
    visiting.add(index);
    const node = object(nodes[index]);
    if (node.mesh !== undefined && (!uint(node.mesh) || Number(node.mesh) >= meshes.length)) fail('GLB có mesh reference không tồn tại.');
    for (const child of list(node.children)) visit(child, depth + 1);
    visiting.delete(index); visited.add(index);
  };
  for (const scene of scenes) for (const node of list(object(scene).nodes)) visit(node, 0);
  if (!visited.size || ![...visited].some(index => object(nodes[index]).mesh !== undefined)) fail('GLB không có mesh trong scene.');
  const required = list(json.extensionsRequired);
  const supported = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_volume', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_anisotropy', 'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_mesh_quantization'];
  if (required.some(extension => !supported.includes(String(extension)))) fail('GLB yêu cầu extension chưa được hỗ trợ.');
  if (!meshes.length || meshes.length > 256 || nodes.length > 2048 || materials.length > 128 || list(json.animations).length) fail('Model cần 1–256 meshes tĩnh, tối đa 128 materials; animation chưa hỗ trợ.');
  let triangles = 0, hasUv = false;
  for (const meshValue of meshes) {
    for (const primitiveValue of list(object(meshValue).primitives)) {
      const primitive = object(primitiveValue), attributes = object(primitive.attributes);
      if (primitive.mode !== undefined && primitive.mode !== 4) fail('Model chỉ hỗ trợ triangle mesh.');
      if (!uint(attributes.POSITION) || Number(attributes.POSITION) >= accessors.length) fail('Model thiếu POSITION accessor hợp lệ.');
      const draco = object(object(primitive.extensions).KHR_draco_mesh_compression);
      if (Object.keys(draco).length && (!uint(draco.bufferView) || Number(draco.bufferView) >= views.length)) fail('GLB Draco trỏ tới bufferView không tồn tại.');
      for (const reference of Object.values(attributes)) if (!uint(reference) || Number(reference) >= accessors.length) fail('Model có attribute accessor không tồn tại.');
      if (object(accessors[Number(attributes.POSITION)]).type !== 'VEC3') fail('Model POSITION phải có dạng VEC3.');
      if (primitive.material !== undefined && (!uint(primitive.material) || Number(primitive.material) >= materials.length)) fail('Model dùng material không tồn tại.');
      hasUv ||= uint(attributes.TEXCOORD_0) && Number(attributes.TEXCOORD_0) < accessors.length;
      const accessorIndex = primitive.indices ?? attributes.POSITION;
      if (!uint(accessorIndex) || Number(accessorIndex) >= accessors.length) fail('Model có indices không hợp lệ.');
      const count = object(accessors[Number(accessorIndex)]).count;
      if (!uint(count) || Number(count) < 3) fail('Model có mesh rỗng.');
      triangles += Math.ceil(Number(count) / 3);
    }
  }
  if (!triangles || triangles > 250_000) fail('Model phải có tối đa 250.000 tam giác. Hãy tối ưu trước khi tải lên.');
  const materialNames = materials.map((value, index) => String(object(value).name ?? `material-${index}`));
  const materialSlots: Record<string, string[]> = {};
  for (const materialValue of materials) {
    const material = object(materialValue), explicit = object(material.extras).materialSlot;
    const name = typeof material.name === 'string' ? material.name : '';
    const slot = typeof explicit === 'string' && /^(body|label|cap|tab|liquid|shell)$/.test(explicit) ? explicit : /label/i.test(name) ? 'label' : '';
    if (slot && name) (materialSlots[slot] ??= []).push(name);
  }
  return { materialNames, meshNames: meshes.map((value, index) => String(object(value).name ?? `mesh-${index}`)), materialSlots, hasUv, triangleCount: triangles, layoutProfile: '' };
}

export function inspectMedia(buffer: Buffer, role: MediaRole): MediaInspection {
  if (!roles.includes(role)) fail('Vai trò tài nguyên không hợp lệ.');
  const limit = role === 'model' ? 30 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!buffer.length || buffer.length > limit) fail(`File phải có dung lượng dưới ${role === 'model' ? 30 : 20} MB.`);
  if (role === 'model') return { mime: 'model/gltf-binary', extension: 'glb', width: null, height: null, model: inspectGlb(buffer) };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return inspectPng(buffer);
  if (buffer.length >= 2 && buffer.readUInt16BE(0) === 0xffd8) return inspectJpeg(buffer);
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return inspectWebp(buffer);
  return fail('Chỉ hỗ trợ ảnh PNG, JPEG, WebP tĩnh. Model 3D phải dùng vai trò model và định dạng GLB.');
}
