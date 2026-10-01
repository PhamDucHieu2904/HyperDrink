/* eslint-disable @typescript-eslint/no-require-imports -- Execute the real serializable resolver without a Next build. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFlavorScene, resolveDisplay3D, mediaUrl } = require('../../lib/catalog/resolve.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: '2026-10-01T04:00:00Z', updatedAt: '2026-10-01T04:00:00Z' });
const flavor = { ...entity('fifth-dragon-fruit'), shortName: 'Dragon fruit', description: '', accentColor: '#ff0088', backgroundColor: '#551144', textColor: '#ffffff', icon: 'leaf', thumbnailId: null, position: 4 };
function media(id, role) { return { ...entity(id), role, status: 'ready', url: `/assets/${id}.webp`, storageKey: `${id}.webp`, mime: 'image/webp', bytes: 1024, sha256: 'a'.repeat(64), width: 512, height: 512, imageBounds: [0.1, 0.2, 0.8, 0.9], error: '' }; }
function fixture() {
  const data = createSeedCatalog(); data.flavors.push({ ...flavor });
  for (const role of ['fruit', 'leaf', 'splash']) for (let i = 0; i < 8; i++) {
    const asset = media(`${role}-${i}`, role); data.media.push(asset);
    data.flavorAssets.push({ ...entity(`assignment-${role}-${i}`), flavorId: flavor.id, mediaId: asset.id, role, position: i, enabled: true });
  }
  return data;
}
const decoration = scene => scene.nodes.filter(node => ['fruit', 'leaf', 'splash'].includes(node.kind));
test('arbitrary fifth flavor works with deterministic seeded pools and no repeat while alternatives remain', () => {
  const data = fixture(), first = resolveFlavorScene(data, flavor, 'same-seed'), again = resolveFlavorScene(data, flavor, 'same-seed');
  assert.deepEqual(first, again);
  for (const role of ['fruit', 'leaf', 'splash']) {
    const nodes = first.nodes.filter(node => node.kind === role);
    assert.ok(nodes.length > 0); assert.equal(new Set(nodes.map(node => node.assetUrl)).size, nodes.length);
    for (const node of nodes) { assert.match(node.assetUrl, new RegExp(`${role}-\\d`)); assert.deepEqual(node.imageBounds, [0.1, 0.2, 0.8, 0.9]); assert.equal(node.variants, undefined); assert.equal(node.tint, undefined); }
  }
  const different = new Set(Array.from({ length: 10 }, (_, index) => JSON.stringify(decoration(resolveFlavorScene(data, flavor, `seed-${index}`)).map(node => node.assetUrl))));
  assert.ok(different.size > 1); assert.equal(data.flavorAssets.length, 24);
});
test('empty pools omit decorations and one-item pools repeat only the available item', () => {
  const data = fixture(); data.flavorAssets = [];
  assert.equal(decoration(resolveFlavorScene(data, flavor, 'empty')).length, 0);
  data.flavorAssets.push({ ...entity('single-fruit'), flavorId: flavor.id, mediaId: 'fruit-0', role: 'fruit', position: 0, enabled: true });
  const nodes = decoration(resolveFlavorScene(data, flavor, 'single'));
  assert.ok(nodes.length > 0); assert.equal(nodes.every(node => node.kind === 'fruit' && node.assetUrl.endsWith('fruit-0.webp')), true);
});
test('unready, archived, disabled, other-flavor and wrong-role assets never enter pools', () => {
  const data = fixture();
  data.media.find(item => item.id === 'fruit-0').status = 'processing';
  data.media.find(item => item.id === 'fruit-1').lifecycle = 'archived';
  data.flavorAssets.find(item => item.mediaId === 'fruit-2').enabled = false;
  data.flavorAssets.find(item => item.mediaId === 'fruit-3').flavorId = 'citrus';
  data.media.find(item => item.id === 'fruit-4').role = 'label';
  for (let i = 0; i < 25; i++) {
    const urls = decoration(resolveFlavorScene(data, flavor, `filter-${i}`)).map(node => node.assetUrl);
    assert.equal(urls.some(url => /fruit-[0-4]\.webp/.test(url)), false);
  }
});
test('duplicate assignments of one media file do not make a sufficient pool repeat prematurely', () => {
  const data = fixture(); data.flavorAssets = data.flavorAssets.filter(item => item.role !== 'leaf');
  for (let i = 0; i < 6; i++) for (let duplicate = 0; duplicate < 5; duplicate++) data.flavorAssets.push({ ...entity(`leaf-assignment-${i}-${duplicate}`), flavorId: flavor.id, mediaId: `leaf-${i}`, role: 'leaf', position: i, enabled: true });
  for (let i = 0; i < 12; i++) { const nodes = resolveFlavorScene(data, flavor, `dedup-${i}`).nodes.filter(node => node.kind === 'leaf'); assert.equal(new Set(nodes.map(node => node.assetUrl)).size, nodes.length); }
});
test('real label texture maps bypass the procedural demo palette and preserve PP domain mapping', () => {
  const data = fixture();
  data.packagingCategories.find(item => item.id === 'alu-can').viewerKind = 'pp';
  const model = data.models3d.find(item => item.packagingVariantId === 'can-330');
  const labelMedia = media('dragon-label', 'label'); data.media.push(labelMedia);
  data.labels.push({ ...entity('label-record'), drinkTypeId: 'juice', flavorId: flavor.id, mediaId: labelMedia.id, compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] });
  data.productVariants.push({ ...entity('product-variant'), groupId: 'juice-30', packagingVariantId: 'can-330', flavorId: flavor.id, code: '', description: '', enabled: true });
  const display = { ...entity('display'), productVariantId: 'product-variant', modelId: model.id, labelId: 'label-record', enabled: true };
  const result = resolveDisplay3D(data, display, 'release-a');
  assert.ok(result); assert.equal(result.asset.packaging, 'other'); assert.equal(data.packagingCategories.find(item => item.id === 'alu-can').viewerKind, 'pp');
  assert.equal(result.asset.src, '/models/cans/can-330.glb'); assert.deepEqual(result.asset.materialSlots, model.materialSlots);
  assert.equal(result.appearance.label, undefined); assert.equal(result.appearance.slots.label.baseColorMap, '/assets/dragon-label.webp'); assert.equal(result.flavor.id, flavor.id);
  assert.equal(resolveDisplay3D(data, { ...display, labelId: 'missing' }), null);
});
test('media URLs honor repository base path once, API origin, HTTPS CDN and absent values', () => {
  const oldBase = process.env.NEXT_PUBLIC_BASE_PATH, oldApi = process.env.NEXT_PUBLIC_ADMIN_API_URL;
  try {
    process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink'; delete process.env.NEXT_PUBLIC_ADMIN_API_URL;
    assert.equal(mediaUrl('/assets/test.webp'), '/HyperDrink/assets/test.webp');
    assert.equal(mediaUrl('/HyperDrink/assets/test.webp'), '/HyperDrink/assets/test.webp');
    assert.equal(mediaUrl('https://cdn.example.test/image.webp'), 'https://cdn.example.test/image.webp');
    assert.equal(mediaUrl('/api/public/v1/media/test'), '/HyperDrink/api/public/v1/media/test');
    process.env.NEXT_PUBLIC_ADMIN_API_URL = 'http://localhost:3010/'; assert.equal(mediaUrl('/api/public/v1/media/test'), 'http://localhost:3010/api/public/v1/media/test');
    assert.equal(mediaUrl(null), '');
  } finally { if (oldBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = oldBase; if (oldApi === undefined) delete process.env.NEXT_PUBLIC_ADMIN_API_URL; else process.env.NEXT_PUBLIC_ADMIN_API_URL = oldApi; }
});
