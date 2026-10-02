/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness loads the real TS service. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const ts = require('typescript');
const project = path.resolve(__dirname, '../..');
function load(relative, importer = require) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(project, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', outputText)(importer, loaded, loaded.exports); return loaded.exports;
}
const inspect = load('lib/server/media/inspect.ts');
const upload = load('lib/server/media/upload.ts', name => name === './inspect' ? inspect : require(name));
const asset = name => fs.readFileSync(path.join(project, name));
async function withMediaFolder(run) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vinut-admin-media-'));
  try { return await run(folder); }
  finally {
    const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('vinut-admin-media-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
function stored(record, folder) { return fs.readFileSync(upload.getMediaPath(record.storageKey, folder)); }
function imageFile(bytes, name = 'source.png', type = 'image/png') { return new File([bytes], name, { type }); }
function splitPixels(width, height, channels = 3) {
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * channels;
    pixels[offset + (x < width / 2 ? 0 : 2)] = 255;
    if (channels === 4) pixels[offset + 3] = 255;
  }
  return pixels;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, content) {
  const chunk = Buffer.alloc(content.length + 12); chunk.writeUInt32BE(content.length); chunk.write(type, 4, 'ascii'); content.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, content.length + 8)), content.length + 8); return chunk;
}
function mutateGlb(change) {
  const original = asset('public/models/cans/can-330.glb');
  const jsonLength = original.readUInt32LE(12);
  const value = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
  change(value);
  const text = Buffer.from(JSON.stringify(value)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const bin = original.subarray(20 + jsonLength), result = Buffer.alloc(20 + padded.length + bin.length);
  original.subarray(0, 20).copy(result); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12);
  padded.copy(result, 20); bin.copy(result, 20 + padded.length); return result;
}
test('actual shipped image assets are recognized by signature and dimensions', () => {
  for (const [file, mime] of [['public/assets/flavors/berry-preview.jpg', 'image/jpeg'], ['public/assets/scene/ice-clear.webp', 'image/webp'], ['public/assets/backgrounds/hero-atmosphere.png', 'image/png']]) {
    const result = inspect.inspectMedia(asset(file), 'thumbnail'); assert.equal(result.mime, mime); assert.ok(result.width > 0 && result.height > 0);
  }
});
test('unsafe, truncated, corrupt and wrong-role inputs cannot become ready media', () => {
  assert.throws(() => inspect.inspectMedia(Buffer.from('<svg onload="alert(1)"></svg>'), 'icon'), /Chỉ hỗ trợ/);
  const png = asset('public/assets/backgrounds/hero-atmosphere.png');
  assert.throws(() => inspect.inspectMedia(png.subarray(0, 40), 'fruit'), /thiếu|hoàn chỉnh/i);
  const corrupt = Buffer.from(png); corrupt[40] ^= 0xff; assert.throws(() => inspect.inspectMedia(corrupt, 'fruit'), /checksum/);
  assert.throws(() => inspect.inspectMedia(asset('public/models/cans/can-330.glb'), 'poster'), /Chỉ hỗ trợ/);
  assert.throws(() => inspect.inspectMedia(Buffer.alloc(20 * 1024 * 1024 + 1), 'label'), /dung lượng/);
});
test('all six real models retain explicit material slots and UV metadata', () => {
  for (const entry of JSON.parse(asset('public/models/cans/assets.manifest.json')).assets) {
    const result = inspect.inspectMedia(asset(`public${entry.src}`), 'model');
    assert.equal(result.model.hasUv, true); assert.deepEqual(result.model.materialSlots.label, ['printed-label']); assert.ok(result.model.triangleCount > 0);
  }
});
test('GLB inspection rejects remote assets, unsupported textures, bad references and cycles', () => {
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { json.buffers[0].uri = 'https://example.test/file.bin'; })), /tự chứa/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { json.images = [{ uri: 'https://example.test/file.svg', mimeType: 'image/svg+xml' }]; })), /Ảnh trong GLB/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { json.extensionsRequired.push('KHR_texture_basisu'); })), /extension/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { json.bufferViews[0].byteLength = 0xffffffff; })), /bufferView/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { const primitive = json.meshes[0].primitives[0]; json.accessors[primitive.attributes.POSITION].count = 100000001; })), /accessor/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { const primitive = json.meshes[0].primitives[0]; primitive.extensions.KHR_draco_mesh_compression.bufferView = 99999; })), /Draco/);
  assert.throws(() => inspect.inspectGlb(mutateGlb(json => { const id = json.scenes[0].nodes[0]; json.nodes[id].children = [id]; })), /tham chiếu vòng/);
});
test('upload persists immutable hash-addressed files and rejects spoofed MIME/path traversal', async () => {
  await withMediaFolder(async folder => {
    const bytes = asset('public/assets/scene/ice-clear.webp');
    const first = await upload.processUpload(new File([bytes], 'ice.webp', { type: 'image/webp' }), 'fruit', folder);
    const second = await upload.processUpload(new File([bytes], 'again.webp', { type: 'image/webp' }), 'leaf', folder);
    assert.equal(first.status, 'ready'); assert.equal(first.storageKey, second.storageKey); assert.notEqual(first.id, second.id);
    const output = stored(first, folder);
    assert.equal(first.mime, 'image/webp'); assert.match(first.storageKey, /^[a-f0-9]{64}\.webp$/);
    assert.equal(first.bytes, output.length); assert.equal(first.sha256, createHash('sha256').update(output).digest('hex'));
    assert.equal((await sharp(output).metadata()).format, 'webp');
    assert.throws(() => upload.getMediaPath('../secrets.txt', folder), /không hợp lệ/);
    await assert.rejects(() => upload.processUpload(new File([bytes], 'spoof.jpg', { type: 'image/jpeg' }), 'label', folder), /không khớp/);
  });
});

test('every image role resizes inside its limit, preserves the whole composition and stores actual WebP metadata', async () => {
  await withMediaFolder(async folder => {
    const width = 2400, height = 1200;
    const input = await sharp(splitPixels(width, height), { raw: { width, height, channels: 3 } }).png().toBuffer();
    for (const [role, limit] of [['label', 2048], ['thumbnail', 512], ['icon', 256], ['fruit', 1600], ['leaf', 1600], ['splash', 1600], ['poster', 1600], ['image-2d', 1600]]) {
      const record = await upload.processUpload(imageFile(input), role, folder), output = stored(record, folder);
      const metadata = await sharp(output).metadata();
      assert.equal(record.mime, 'image/webp'); assert.equal(metadata.format, 'webp');
      assert.equal(record.width, limit, role); assert.equal(record.height, limit / 2, role);
      assert.equal(metadata.width, record.width); assert.equal(metadata.height, record.height);
      assert.equal(record.bytes, output.length); assert.equal(record.sha256, createHash('sha256').update(output).digest('hex'));
      const left = await sharp(output).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      const right = await sharp(output).extract({ left: limit - 1, top: 0, width: 1, height: 1 }).raw().toBuffer();
      assert.ok(left[0] > 240 && left[2] < 15, `${role} keeps the left edge`);
      assert.ok(right[2] > 240 && right[0] < 15, `${role} keeps the right edge`);
    }
  });
});

test('small images are not enlarged and transparent alpha stays intact without cropping', async () => {
  await withMediaFolder(async folder => {
    const width = 8, height = 6, pixels = Buffer.alloc(width * height * 4);
    for (let y = 1; y < 5; y++) for (let x = 2; x < 6; x++) {
      const offset = (y * width + x) * 4; pixels[offset] = 220; pixels[offset + 1] = 80; pixels[offset + 3] = 128;
    }
    pixels[(2 * width + 3) * 4 + 3] = 255;
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    for (const role of ['fruit', 'leaf', 'splash', 'label']) {
      const record = await upload.processUpload(imageFile(input), role, folder), output = stored(record, folder);
      assert.equal(record.width, width); assert.equal(record.height, height);
      const metadata = await sharp(output).metadata(); assert.equal(metadata.hasAlpha, true);
      const alpha = await sharp(output).extractChannel('alpha').raw().toBuffer();
      assert.equal(alpha[0], 0); assert.equal(alpha[width + 2], 128); assert.equal(alpha[2 * width + 3], 255);
      assert.deepEqual(record.imageBounds, role === 'label' ? null : [2 / width, 1 / height, 6 / width, 5 / height]);
    }
  });
});

test('EXIF orientation is applied to pixels and output dimensions before metadata is removed', async () => {
  await withMediaFolder(async folder => {
    const width = 40, height = 20;
    const input = await sharp(splitPixels(width, height), { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).withMetadata({ orientation: 6 }).toBuffer();
    assert.equal((await sharp(input).metadata()).orientation, 6);
    const record = await upload.processUpload(imageFile(input, 'oriented.jpg', 'image/jpeg'), 'poster', folder), output = stored(record, folder);
    assert.equal(record.width, 20); assert.equal(record.height, 40);
    const metadata = await sharp(output).metadata(); assert.equal(metadata.orientation, undefined); assert.equal(metadata.exif, undefined);
    const top = await sharp(output).extract({ left: 10, top: 5, width: 1, height: 1 }).raw().toBuffer();
    const bottom = await sharp(output).extract({ left: 10, top: 35, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(top[0] > 240 && top[2] < 15); assert.ok(bottom[2] > 240 && bottom[0] < 15);
  });
});

test('a structurally valid PNG with undecodable pixels is rejected before any file is persisted', async () => {
  await withMediaFolder(async folder => {
    const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(6, 4); header[8] = 8; header[9] = 6;
    const input = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', Buffer.from('not a zlib image')), pngChunk('IEND', Buffer.alloc(0))]);
    assert.equal(inspect.inspectMedia(input, 'label').mime, 'image/png');
    await assert.rejects(() => upload.processUpload(imageFile(input), 'label', folder), /giải mã|tối ưu/);
    assert.deepEqual(fs.readdirSync(folder), []);
  });
});

test('GLB uploads preserve their exact bytes, MIME, extension and checksum', async () => {
  await withMediaFolder(async folder => {
    const input = asset('public/models/cans/can-330.glb');
    const record = await upload.processUpload(imageFile(input, 'can.glb', 'model/gltf-binary'), 'model', folder);
    assert.deepEqual(stored(record, folder), input); assert.equal(record.mime, 'model/gltf-binary'); assert.match(record.storageKey, /\.glb$/);
    assert.equal(record.bytes, input.length); assert.equal(record.sha256, createHash('sha256').update(input).digest('hex'));
    assert.equal(record.width, null); assert.equal(record.height, null); assert.equal(record.imageBounds, null);
  });
});
