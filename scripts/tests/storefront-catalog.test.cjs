/* eslint-disable @typescript-eslint/no-require-imports -- Run the public catalog helpers against serialized release fixtures. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStorefrontSelection, catalogProducts, parsePublishedCatalog } = require('../../lib/catalog/storefront.ts');
const { fetchPublishedCatalog } = require('../../components/usePublishedCatalog.ts');
const { validateCatalog } = require('../../lib/catalog/validation.ts');

const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: '2026-10-01T04:00:00Z', updatedAt: '2026-10-01T04:00:00Z' });
const media = (id, role) => ({ ...entity(id), role, status: 'ready', url: `/catalog/media/${id}.webp`, storageKey: '', mime: role === 'model' ? 'model/gltf-binary' : 'image/webp', bytes: 1234, sha256: 'a'.repeat(64), width: role === 'model' ? null : 512, height: role === 'model' ? null : 512, imageBounds: null, error: '' });

function fixture() {
  const data = { schemaVersion: 1, drinkTypes: [{ ...entity('juice'), description: '', position: 0 }], packagingCategories: [{ ...entity('alu-can'), viewerKind: 'can', position: 0 }], packagingVariants: [], flavors: [], flavorAssets: [], productGroups: [], productVariants: [], packagingSlots: [], media: [], labels: [], models3d: [], assets2d: [], displays3d: [], displays2d: [] };
  for (const [id, volumeMl, position] of [['can-330', 330, 0], ['can-500', 500, 1]]) data.packagingVariants.push({ ...entity(id), categoryId: 'alu-can', volumeMl, shape: 'standard', position });
  for (const [id, position] of [['mango', 2], ['orange', 1], ['banana', 0]]) {
    data.flavors.push({ ...entity(id), shortName: id, description: '', accentColor: '#ff5500', backgroundColor: '#005599', textColor: '#ffffff', icon: 'leaf', thumbnailId: `thumb-${id}`, position });
    data.media.push(media(`thumb-${id}`, 'thumbnail'));
  }
  for (const [id, position] of [['group-a', 20], ['group-b', 10]]) data.productGroups.push({ ...entity(id), drinkTypeId: 'juice', description: '', buttonLabel: id, position, visible: true });
  for (const [id, groupId, packagingVariantId, position, defaultVariantId] of [['a330-slot', 'group-a', 'can-330', 1, 'a330-mango'], ['a500-slot', 'group-a', 'can-500', 0, 'a500-banana'], ['b330-slot', 'group-b', 'can-330', 0, 'b330-orange']]) data.packagingSlots.push({ ...entity(id), groupId, packagingVariantId, regionKey: 'packaging-picker', position, buttonLabel: packagingVariantId, mode: 'auto', defaultVariantId, enabled: true });
  for (const [id, groupId, packagingVariantId, flavorId] of [['a330-mango', 'group-a', 'can-330', 'mango'], ['a330-orange', 'group-a', 'can-330', 'orange'], ['a500-banana', 'group-a', 'can-500', 'banana'], ['b330-orange', 'group-b', 'can-330', 'orange']]) {
    data.productVariants.push({ ...entity(id), groupId, packagingVariantId, flavorId, code: '', description: '', enabled: true });
    data.media.push(media(`image-${id}`, 'image-2d'));
    data.assets2d.push({ ...entity(`asset-${id}`), packagingVariantId, drinkTypeId: 'juice', flavorId, mediaId: `image-${id}`, galleryIds: [], description: '' });
    data.displays2d.push({ ...entity(`display-${id}`), productVariantId: id, assetId: `asset-${id}`, alt: `Picture ${id}`, enabled: true });
  }
  data.media.push(media('model-media', 'model'), media('poster-media', 'poster'), media('orange-label-media', 'label'));
  data.models3d.push({ ...entity('model-can-330'), packagingVariantId: 'can-330', mediaId: 'model-media', posterId: 'poster-media', layoutProfile: 'can-wrap-v1', materialSlots: { label: ['label-material'] }, orientation: [0, 0, 0] });
  data.labels.push({ ...entity('orange-label'), drinkTypeId: 'juice', flavorId: 'orange', mediaId: 'orange-label-media', compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] });
  data.displays3d.push({ ...entity('orange-3d'), productVariantId: 'a330-orange', modelId: 'model-can-330', labelId: 'orange-label', enabled: true });
  return data;
}

const envelope = (catalog = fixture(), releaseId = 'release-one') => ({ data: { catalog, releaseId, publishedAt: '2026-10-01T06:00:00Z', schemaVersion: 1 } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('selection orders groups, packaging slots and flavors independently and honors the slot default', () => {
  const data = fixture();
  assert.deepEqual(validateCatalog(data, { mode: 'publish' }), []);
  const selected = resolveStorefrontSelection(data, { groupId: 'group-a', slotId: 'a330-slot' });
  assert.deepEqual(selected.groups.map(item => item.id), ['group-b', 'group-a']);
  assert.deepEqual(selected.slots.map(item => item.id), ['a500-slot', 'a330-slot']);
  assert.deepEqual(selected.variants.map(item => item.id), ['a330-orange', 'a330-mango']);
  assert.equal(selected.variant.id, 'a330-mango');
  assert.equal(selected.flavor.id, 'mango');
  assert.equal(selected.packaging.id, 'can-330');
  assert.equal(selected.category.id, 'alu-can');
  assert.equal(resolveStorefrontSelection(data).group.id, 'group-b');
});

test('stale and foreign selection IDs never cross a group or packaging boundary', () => {
  const data = fixture();
  const groupScoped = resolveStorefrontSelection(data, { groupId: 'group-a', slotId: 'b330-slot', variantId: 'b330-orange' });
  assert.equal(groupScoped.slot.id, 'a500-slot'); assert.equal(groupScoped.variant.id, 'a500-banana');
  const packagingScoped = resolveStorefrontSelection(data, { groupId: 'group-a', slotId: 'a330-slot', variantId: 'a500-banana' });
  assert.equal(packagingScoped.variant.id, 'a330-mango');
  data.packagingSlots.find(item => item.id === 'a330-slot').defaultVariantId = 'b330-orange';
  assert.equal(resolveStorefrontSelection(data, { groupId: 'group-a', slotId: 'a330-slot' }).variant.id, 'a330-orange');
});

test('release refresh keeps valid choices and falls back after the selected flavor or package is disabled', () => {
  const data = fixture();
  const request = { groupId: 'group-a', slotId: 'a330-slot', variantId: 'a330-orange' };
  data.productGroups.reverse(); data.productVariants.reverse();
  data.productGroups.find(item => item.id === 'group-a').name = 'Updated editorial label';
  assert.equal(resolveStorefrontSelection(data, request).variant.id, 'a330-orange');
  data.productVariants.find(item => item.id === 'a330-orange').enabled = false;
  assert.equal(resolveStorefrontSelection(data, request).variant.id, 'a330-mango');
  data.packagingSlots.find(item => item.id === 'a330-slot').enabled = false;
  assert.equal(resolveStorefrontSelection(data, request).variant.id, 'a500-banana');
});

test('archived or hidden dependencies cannot appear in selection or collection products', () => {
  const data = fixture();
  data.productGroups.find(item => item.id === 'group-b').visible = false;
  data.flavors.find(item => item.id === 'mango').lifecycle = 'archived';
  data.productVariants.find(item => item.id === 'a500-banana').enabled = false;
  assert.deepEqual(catalogProducts(data).map(item => item.variant.id), ['a330-orange']);
  data.packagingCategories[0].lifecycle = 'archived';
  assert.equal(resolveStorefrontSelection(data, { groupId: 'group-a' }).slot, undefined);
  assert.deepEqual(catalogProducts(data), []);
  data.drinkTypes[0].lifecycle = 'archived';
  assert.deepEqual(resolveStorefrontSelection(data).groups, []);
});

test('cards use only their own compatible display assets, including 2D-only modes and PP taxonomy', () => {
  const data = fixture();
  let product = catalogProducts(data).find(item => item.variant.id === 'a330-orange');
  assert.equal(product.thumbnail.id, 'thumb-orange'); assert.equal(product.image2d.id, 'image-a330-orange');
  assert.equal(product.display3d.id, 'orange-3d'); assert.equal(product.model.id, 'model-can-330'); assert.equal(product.label.id, 'orange-label');
  data.assets2d.find(item => item.id === 'asset-a330-orange').flavorId = 'mango';
  product = catalogProducts(data).find(item => item.variant.id === 'a330-orange');
  assert.equal(product.display2d, undefined); assert.equal(product.image2d, undefined);
  data.labels[0].compatibilities[0].layoutProfile = 'other-wrap';
  product = catalogProducts(data).find(item => item.variant.id === 'a330-orange');
  assert.equal(product.display3d, undefined); assert.equal(product.model, undefined);
  data.labels[0].compatibilities[0].layoutProfile = 'can-wrap-v1';
  data.packagingSlots.find(item => item.id === 'a330-slot').mode = '2d';
  assert.equal(catalogProducts(data).find(item => item.variant.id === 'a330-orange').display3d, undefined);
  data.packagingCategories[0].viewerKind = 'pp';
  assert.equal(catalogProducts(data)[0].category.viewerKind, 'pp');
});

test('unready or wrong-role thumbnails are never returned as card images', () => {
  const data = fixture();
  data.media.find(item => item.id === 'thumb-orange').status = 'processing';
  assert.equal(catalogProducts(data).find(item => item.variant.id === 'b330-orange').thumbnail, undefined);
  data.media.find(item => item.id === 'thumb-mango').role = 'fruit';
  assert.equal(catalogProducts(data).find(item => item.variant.id === 'a330-mango').thumbnail, undefined);
});

test('public JSON accepts committed envelopes and rejects drafts, unsupported versions, unsafe URLs and broken graphs', () => {
  const good = parsePublishedCatalog(envelope(), 'static');
  assert.equal(good.releaseId, 'release-one'); assert.equal(good.source, 'static');
  assert.throws(() => parsePublishedCatalog({ data: { catalog: fixture() } }, 'api'));
  assert.throws(() => parsePublishedCatalog({ data: { ...envelope().data, schemaVersion: 2 } }, 'api'));
  assert.throws(() => parsePublishedCatalog({ data: { ...envelope().data, publishedAt: 'yesterday' } }, 'api'));
  const unsafe = fixture(); unsafe.media[0].url = 'javascript:alert(1)';
  assert.throws(() => parsePublishedCatalog(envelope(unsafe), 'api'), /không hợp lệ/);
  const incompatible = fixture(); incompatible.assets2d[0].flavorId = 'orange';
  assert.throws(() => parsePublishedCatalog(envelope(incompatible), 'api'), /không hợp lệ/);
  assert.throws(() => parsePublishedCatalog(fixture(), 'api'));
});

test('public API fetching respects configured origin, omits auth and disables fetch caching', async () => {
  const calls = [];
  const result = await fetchPublishedCatalog({ apiBase: 'https://catalog.example.test/', mode: 'static', fetcher: async (url, options) => { calls.push({ url, options }); return response(envelope()); } });
  assert.equal(result.source, 'api');
  assert.equal(calls[0].url, 'https://catalog.example.test/api/public/v1/catalog');
  assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls.length, 1);
});

test('static mode skips API and repository base paths are applied only once', async () => {
  const old = process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink';
  try {
    const calls = [];
    assert.equal((await fetchPublishedCatalog({ apiBase: '', mode: 'static', fetcher: async url => { calls.push(url); return response(envelope()); } })).source, 'static');
    assert.deepEqual(calls, ['/HyperDrink/catalog/current.json']);
    calls.length = 0;
    await fetchPublishedCatalog({ apiBase: '', mode: 'api', fetcher: async url => { calls.push(url); return response(envelope()); } });
    assert.deepEqual(calls, ['/HyperDrink/api/public/v1/catalog']);
  } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = old; }
});

test('authoritative API 404 or invalid release never exposes a stale static snapshot', async () => {
  for (const bad of [response({ error: { message: 'No published release' } }, 404), response({ data: { ...envelope().data, schemaVersion: 2 } })]) {
    const calls = [];
    await assert.rejects(fetchPublishedCatalog({ apiBase: '', mode: 'api', fetcher: async url => { calls.push(url); return bad; } }));
    assert.deepEqual(calls, ['/api/public/v1/catalog']);
  }
});

test('initial API outages may read exported static release while refresh failure cannot replace a good release', async () => {
  for (const first of ['network', 'server']) {
    const calls = [];
    const result = await fetchPublishedCatalog({ apiBase: '', mode: 'api', fetcher: async url => { calls.push(url); if (calls.length === 1) { if (first === 'network') throw new TypeError('offline'); return response({ error: { message: 'Unavailable' } }, 503); } return response(envelope(fixture(), 'retained-release')); } });
    assert.equal(result.source, 'static'); assert.equal(result.releaseId, 'retained-release');
    assert.deepEqual(calls, ['/api/public/v1/catalog', '/catalog/current.json']);
  }
  const calls = [];
  await assert.rejects(fetchPublishedCatalog({ apiBase: '', mode: 'api', allowStaticFallback: false, fetcher: async url => { calls.push(url); throw new TypeError('offline'); } }));
  assert.deepEqual(calls, ['/api/public/v1/catalog']);
});

test('an aborted refresh does not fetch fallback or accept cancellation as a new catalog', async () => {
  const controller = new AbortController(), calls = [];
  await assert.rejects(fetchPublishedCatalog({ apiBase: '', mode: 'api', signal: controller.signal, fetcher: async (url, options) => { calls.push(url); controller.abort(); assert.equal(options.signal.aborted, true); throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' });
  assert.deepEqual(calls, ['/api/public/v1/catalog']);
});

test('hung requests time out and release loading work without waiting for the refresh interval', async () => {
  const calls = [];
  const fetcher = (url, options) => {
    calls.push(url);
    if (url === '/catalog/current.json') return Promise.resolve(response(envelope()));
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  const result = await fetchPublishedCatalog({ apiBase: '', mode: 'api', timeoutMs: 10, fetcher });
  assert.equal(result.source, 'static');
  assert.deepEqual(calls, ['/api/public/v1/catalog', '/catalog/current.json']);
  calls.length = 0;
  await assert.rejects(fetchPublishedCatalog({ apiBase: '', mode: 'api', timeoutMs: 10, allowStaticFallback: false, fetcher }), /phản hồi kịp thời/);
  assert.deepEqual(calls, ['/api/public/v1/catalog']);
});
