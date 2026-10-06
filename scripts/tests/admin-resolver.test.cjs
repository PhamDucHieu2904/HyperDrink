/* eslint-disable @typescript-eslint/no-require-imports -- Execute the real serializable resolver without a Next build. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { resolveFlavorScene, resolveDisplay3D, mediaUrl, nextFlavorPreviewSeed } = require('../../lib/catalog/resolve.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { DEFAULT_PRODUCT_ACCENT_SCENE } = require('../../lib/viewer/accent-config.ts');
const { canAssets } = require('../../lib/product-assets.ts');
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

test('ice pools replace both preset cubes without moving slots and respect deletion, disabling and flavor isolation', () => {
  const data = fixture(), target = data.flavors.find(item => item.id === flavor.id);
  const template = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.filter(node => node.kind === 'ice');
  assert.deepEqual(resolveFlavorScene(data, target, 'legacy').nodes.filter(node => node.kind === 'ice'), template.map(node => ({ ...node, variants: undefined })));
  target.icePoolConfigured = true;
  assert.equal(resolveFlavorScene(data, target, 'empty').nodes.filter(node => node.kind === 'ice').length, 0);
  for (let i = 0; i < 2; i++) {
    data.media.push(media(`custom-ice-${i}`, 'ice'));
    data.flavorAssets.push({ ...entity(`ice-assignment-${i}`), flavorId: target.id, mediaId: `custom-ice-${i}`, role: 'ice', enabled: true, position: i });
  }
  const cubes = resolveFlavorScene(data, target, 'pool').nodes.filter(node => node.kind === 'ice');
  assert.equal(cubes.length, 2); assert.equal(new Set(cubes.map(node => node.assetUrl)).size, 2);
  cubes.forEach((cube, i) => { assert.deepEqual(cube.position, template[i].position); assert.equal(cube.scale, template[i].scale); assert.deepEqual(cube.rotation, template[i].rotation); });
  for (const asset of data.flavorAssets.filter(item => item.role === 'ice')) asset.enabled = false;
  assert.equal(resolveFlavorScene(data, target, 'off').nodes.filter(node => node.kind === 'ice').length, 0);
  data.flavorAssets = data.flavorAssets.filter(item => item.role !== 'ice');
  assert.equal(resolveFlavorScene(data, target, 'deleted').nodes.filter(node => node.kind === 'ice').length, 0);
  assert.equal(resolveFlavorScene(data, { ...target, id: 'foreign' }, 'foreign').nodes.filter(node => node.kind === 'ice').length, 0);
});

test('the preview change button always finds a different arrangement when two images are available', () => {
  const data = fixture();
  data.flavorAssets = data.flavorAssets.filter(item => item.role === 'fruit').slice(0, 2);
  const model = data.models3d.find(item => item.packagingVariantId === 'can-330');
  data.media.push(media('preview-label-image', 'label'));
  data.labels.push({ ...entity('preview-label'), drinkTypeId: data.drinkTypes[0].id, flavorId: flavor.id, mediaId: 'preview-label-image', compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: model.layoutProfile }] });
  data.productVariants.push({ ...entity('preview-variant'), groupId: data.productGroups[0].id, packagingVariantId: 'can-330', flavorId: flavor.id, code: '', description: '', enabled: true });
  const display = { ...entity('preview-display'), productVariantId: 'preview-variant', modelId: model.id, labelId: 'preview-label', enabled: true };
  let seed = 0;
  for (let index = 0; index < 12; index++) {
    const next = nextFlavorPreviewSeed(data, flavor, seed, display.id);
    assert.ok(next > seed);
    assert.notDeepEqual(decoration(resolveDisplay3D(data, display, `preview-${seed}`).accentScene), decoration(resolveDisplay3D(data, display, `preview-${next}`).accentScene));
    seed = next;
  }
  data.flavorAssets = [];
  assert.equal(nextFlavorPreviewSeed(data, flavor, seed, display.id), seed + 1, 'An empty pool has a bounded fallback');
});
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
test('empty flavor pools retain only the shared water splash; one-item fruit pools repeat only that fruit', () => {
  const data = fixture(); data.flavorAssets = [];
  const empty = decoration(resolveFlavorScene(data, flavor, 'empty'));
  assert.equal(empty.length, 1); assert.equal(empty[0].id, 'water-splash-back');
  assert.equal(empty[0].assetUrl, '/assets/scene/water-splash-user.webp');
  data.flavorAssets.push({ ...entity('single-fruit'), flavorId: flavor.id, mediaId: 'fruit-0', role: 'fruit', position: 0, enabled: true });
  const nodes = decoration(resolveFlavorScene(data, flavor, 'single'));
  const fruit = nodes.filter(node => node.kind === 'fruit');
  assert.ok(fruit.length > 0); assert.equal(fruit.every(node => node.assetUrl.endsWith('fruit-0.webp')), true);
  assert.equal(nodes.filter(node => node.kind === 'leaf').length, 0);
  assert.equal(nodes.filter(node => node.kind === 'splash').length, 1);
});

test('the restored splash uses the exact supplied image, rear/foot transform and original Hard Light composition', () => {
  const manifest = require('../../public/assets/scene/water-splash.manifest.json');
  const bytes = fs.readFileSync(path.join(__dirname, '../../public/assets/scene/water-splash-user.webp'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '534122ba3049599686b39f6badb0f87bb609b1c705bb34743fbd34777f993c37');
  assert.equal(bytes.length, manifest.asset.bytes);
  const data = fixture(); data.flavorAssets = [];
  const template = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(node => node.id === 'water-splash-back');
  const before = structuredClone(template);
  const splash = resolveFlavorScene(data, flavor, 'water-preset').nodes.find(node => node.id === 'water-splash-back');
  assert.deepEqual(splash, { ...template, variants: undefined });
  assert.equal(splash.assetUrl, manifest.asset.src);
  assert.deepEqual(splash.position, [0, 0.015, -0.8]); assert.deepEqual(splash.rotation, [0, 0, -0.12]); assert.equal(splash.scale, 1.5);
  assert.deepEqual(splash.imageBounds, [53 / 768, 86 / 768, 714 / 768, 680 / 768]);
  assert.equal(splash.blendMode, 'hard-light'); assert.equal(splash.opacity, 1); assert.equal(splash.imageZoom, 1.2);
  assert.deepEqual(template, before);
});

test('all 24 Juice flavors without pools keep the same water preset without unrelated fruit or leaves', () => {
  const data = fixture(); data.flavorAssets = [];
  data.flavors = Array.from({ length: 24 }, (_, position) => ({ ...flavor, ...entity(`juice-flavor-${position}`), position }));
  for (const entry of data.flavors) {
    const scene = resolveFlavorScene(data, entry, `juice-release:${entry.id}`);
    const artwork = decoration(scene);
    assert.deepEqual(artwork.map(node => [node.kind, node.assetUrl]), [['splash', '/assets/scene/water-splash-user.webp']]);
    assert.equal(artwork[0].sprite, undefined); assert.equal(artwork[0].variants, undefined);
  }
});

test('an assigned flavor splash replaces the fixed water; invalid, disabled and foreign assignments never replace it', () => {
  const data = fixture(); data.flavorAssets = [];
  const assignment = { ...entity('current-splash'), flavorId: flavor.id, mediaId: 'splash-0', role: 'splash', position: 0, enabled: true };
  data.flavorAssets.push(assignment);
  let splash = resolveFlavorScene(data, flavor, 'assigned').nodes.find(node => node.kind === 'splash');
  assert.equal(splash.assetUrl, '/assets/splash-0.webp'); assert.deepEqual(splash.imageBounds, [0.1, 0.2, 0.8, 0.9]);
  const supplied = data.media.find(item => item.id === 'splash-0');
  for (const patch of [{ enabled: false }, { flavorId: 'citrus' }, { lifecycle: 'archived' }]) {
    Object.assign(assignment, { enabled: true, flavorId: flavor.id, lifecycle: 'active' }, patch);
    splash = resolveFlavorScene(data, flavor, 'filtered').nodes.find(node => node.kind === 'splash');
    assert.equal(splash.assetUrl, '/assets/scene/water-splash-user.webp');
  }
  Object.assign(assignment, { enabled: true, flavorId: flavor.id, lifecycle: 'active' });
  for (const patch of [{ status: 'processing' }, { lifecycle: 'archived' }, { role: 'label' }]) {
    Object.assign(supplied, { status: 'ready', lifecycle: 'active', role: 'splash' }, patch);
    splash = resolveFlavorScene(data, flavor, 'filtered-media').nodes.find(node => node.kind === 'splash');
    assert.equal(splash.assetUrl, '/assets/scene/water-splash-user.webp');
  }
});

test('fallback respects explicit template/scene disabling and repository base paths', () => {
  const data = fixture(); data.flavorAssets = [];
  const template = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.find(node => node.id === 'water-splash-back');
  const oldEnabled = template.enabled, oldScene = DEFAULT_PRODUCT_ACCENT_SCENE.enabled, oldOpacity = DEFAULT_PRODUCT_ACCENT_SCENE.opacity, oldBase = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink';
    template.enabled = false;
    let scene = resolveFlavorScene(data, flavor, 'disabled');
    const splash = scene.nodes.find(node => node.id === 'water-splash-back');
    assert.equal(splash.enabled, false); assert.equal(splash.assetUrl, '/HyperDrink/assets/scene/water-splash-user.webp');
    DEFAULT_PRODUCT_ACCENT_SCENE.enabled = false; DEFAULT_PRODUCT_ACCENT_SCENE.opacity = 0;
    scene = resolveFlavorScene(data, flavor, 'disabled-scene');
    assert.equal(scene.enabled, false); assert.equal(scene.opacity, 0);
  } finally {
    template.enabled = oldEnabled; DEFAULT_PRODUCT_ACCENT_SCENE.enabled = oldScene; DEFAULT_PRODUCT_ACCENT_SCENE.opacity = oldOpacity;
    if (oldBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = oldBase;
  }
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
  assert.deepEqual(result.asset.textureSamplers, { label: { wrapS: 'repeat', wrapT: 'clamp' } }, 'Cylindrical labels preserve seam UVs greater than one');
  assert.equal(result.appearance.label, undefined); assert.equal(result.appearance.slots.label.baseColorMap, '/assets/dragon-label.webp'); assert.equal(result.flavor.id, flavor.id);
  assert.deepEqual(result.appearance.requiredSlots, ['label'], 'Published labels must not silently fall back to imported artwork');
  assert.equal(resolveDisplay3D(data, { ...display, labelId: 'missing' }), null);
  model.layoutProfile = 'generic-v1';
  data.labels.find(item => item.id === 'label-record').compatibilities[0].layoutProfile = 'generic-v1';
  const generic = resolveDisplay3D(data, display, 'release-generic');
  assert.ok(generic); assert.equal(generic.asset.textureSamplers, undefined, 'Packaging alone does not opt generic UV layouts into cylindrical repeat');
  assert.deepEqual(generic.asset.materialSlots, model.materialSlots); assert.equal(generic.appearance.slots.label.baseColorMap, '/assets/dragon-label.webp');
});
test('every shipped can model derives label addressing from its manifest without changing model or material bindings', () => {
  const manifest = require('../../public/models/cans/assets.manifest.json');
  assert.equal(canAssets.length, manifest.assets.length); assert.ok(canAssets.length > 0);
  for (const declared of manifest.assets) {
    const asset = canAssets.find(item => item.id === declared.id); assert.ok(asset, declared.id);
    assert.deepEqual(asset.textureSamplers, { label: { wrapS: declared.labelUv.wrapS === 'repeat' ? 'repeat' : 'clamp', wrapT: 'clamp' } });
    assert.equal(declared.labelUv.wrapS, 'repeat', `${declared.id} has cylindrical seam UVs`);
    assert.deepEqual(asset.materialSlots, declared.materialSlots); assert.equal(asset.packaging, 'can');
    assert.equal(asset.src, `${declared.src}?v=${declared.sha256.slice(0, 12)}`); assert.equal(asset.volumeMl, declared.volumeMl);
  }
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
