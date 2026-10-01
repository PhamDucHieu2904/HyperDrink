/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness loads the real TS service. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const project = path.resolve(__dirname, '../..');
function load(relative, importer = require) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(project, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', outputText)(importer, loaded, loaded.exports); return loaded.exports;
}
const inspect = load('lib/server/media/inspect.ts');
const upload = load('lib/server/media/upload.ts', name => name === './inspect' ? inspect : require(name));
const asset = name => fs.readFileSync(path.join(project, name));
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
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vinut-admin-media-'));
  try {
    const bytes = asset('public/assets/scene/ice-clear.webp');
    const first = await upload.processUpload(new File([bytes], 'ice.webp', { type: 'image/webp' }), 'fruit', folder);
    const second = await upload.processUpload(new File([bytes], 'again.webp', { type: 'image/webp' }), 'leaf', folder);
    assert.equal(first.status, 'ready'); assert.equal(first.storageKey, second.storageKey); assert.notEqual(first.id, second.id);
    assert.deepEqual(fs.readFileSync(upload.getMediaPath(first.storageKey, folder)), bytes);
    assert.throws(() => upload.getMediaPath('../secrets.txt', folder), /không hợp lệ/);
    await assert.rejects(() => upload.processUpload(new File([bytes], 'spoof.jpg', { type: 'image/jpeg' }), 'label', folder), /không khớp/);
  } finally {
    const resolved = path.resolve(folder); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('vinut-admin-media-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
