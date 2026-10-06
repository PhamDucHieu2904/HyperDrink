/* eslint-disable @typescript-eslint/no-require-imports -- Run the public catalog helpers against serialized release fixtures. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { resolveStorefrontSelection, randomStorefrontEntry, catalogProducts, parsePublishedCatalog } = require('../../lib/catalog/storefront.ts');
const { fetchPublishedCatalog } = require('../../components/usePublishedCatalog.ts');
const { validateCatalog } = require('../../lib/catalog/validation.ts');
const { collectPublicCatalog } = require('../../lib/catalog/compatibility.ts');
const { collectionSections, collectionDrinkTypes, filterCollectionProducts, productPage } = require('../../lib/catalog/collection.ts');
const { collectionCopy } = require('../../lib/i18n/collection-copy.ts');

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

function renderRootLayout() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/layout.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name.endsWith('.css') ? {} : require(name), loaded, loaded.exports);
  return renderToStaticMarkup(React.createElement(loaded.exports.default, null, 'Storefront'));
}

test('collection title and ordering are independent of the hero buttons and older releases keep their rows', () => {
  const data = fixture();
  assert.deepEqual(collectionSections(data).map(section => section.group.id), ['group-b', 'group-a']);
  Object.assign(data.productGroups[0], { collectionTitle: '  Tropical Juice  ', collectionPosition: 0, collectionVisible: true });
  Object.assign(data.productGroups[1], { collectionVisible: false });
  const sections = collectionSections(data);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Tropical Juice');
  assert.equal(sections[0].products.length, 3);
  assert.equal(catalogProducts(data).length, 4, 'Hiding a homepage row does not hide its Best seller products');
  assert.equal(catalogProducts(data, 'catalog').length, 4, 'All products still includes a line visible in the hero');
});

test('a collection-only product line survives publication but does not become a Best seller button', () => {
  const data = fixture();
  Object.assign(data.productGroups[0], { visible: false, collectionVisible: true, collectionTitle: 'Summer selection', collectionPosition: 0 });
  Object.assign(data.productGroups[1], { visible: false, collectionVisible: false });
  const published = collectPublicCatalog(data);
  assert.deepEqual(published.productGroups.map(group => group.id), ['group-a']);
  assert.equal(catalogProducts(published).length, 0);
  assert.equal(catalogProducts(published, 'catalog').length, 3);
  assert.equal(collectionSections(published)[0].title, 'Summer selection');
  assert.deepEqual(validateCatalog(data, { mode: 'publish' }), []);
  assert.deepEqual(collectionDrinkTypes(published, catalogProducts(published, 'catalog')).map(type => type.id), ['juice']);
});

test('collection excludes empty, disabled and archived lines without losing other rows', () => {
  const data = fixture();
  data.productGroups[0].lifecycle = 'archived';
  assert.deepEqual(collectionSections(data).map(section => section.group.id), ['group-b']);
  data.productVariants.find(item => item.id === 'b330-orange').enabled = false;
  assert.deepEqual(collectionSections(data), []);
});

test('responsive row pagination reaches every product exactly once and clamps after a filter change', () => {
  const products = Array.from({ length: 15 }, (_, index) => `product-${index}`);
  for (const size of [1, 2, 3, 4, 12]) {
    const totalPages = productPage(products, 0, size).totalPages;
    const seen = Array.from({ length: totalPages }, (_, page) => productPage(products, page, size).items).flat();
    assert.deepEqual(seen, products);
  }
  assert.deepEqual(productPage([], 20, 4), { page: 0, totalPages: 1, items: [] });
  assert.deepEqual(productPage(products.slice(0, 2), 8, 4), { page: 0, totalPages: 1, items: ['product-0', 'product-1'] });
  assert.equal(productPage(products, -1, 4).page, 0);
});

test('all-products search accepts translated names and original catalog names with every query term required', () => {
  const source = fixture();
  const translated = structuredClone(source);
  translated.flavors.find(item => item.id === 'mango').name = 'Mangue';
  translated.flavors.find(item => item.id === 'mango').shortName = 'Mangue';
  translated.productVariants.find(item => item.id === 'a330-mango').name = 'Jus de mangue';
  const products = catalogProducts(translated, 'catalog');
  assert.deepEqual(filterCollectionProducts(products, 'MANGUE 330', source).map(product => product.variant.id), ['a330-mango']);
  assert.deepEqual(filterCollectionProducts(products, 'mango 330', source).map(product => product.variant.id), ['a330-mango']);
  assert.equal(filterCollectionProducts(products, 'mango 500', source).length, 0);
});

test('collection settings reject malformed values while remaining optional for existing releases', () => {
  assert.deepEqual(validateCatalog(fixture()), []);
  for (const [field, value] of [['collectionVisible', 'yes'], ['collectionTitle', 'x'.repeat(101)], ['collectionPosition', -1], ['collectionPosition', 1.5]]) {
    const data = fixture(); data.productGroups[0][field] = value;
    assert.ok(validateCatalog(data).some(issue => issue.collection === 'productGroups' && issue.field === field));
  }
});

test('collection controls include all eight locales with matching page placeholders', () => {
  const keys = Object.keys(collectionCopy('en')).sort();
  for (const locale of ['en', 'fr', 'zh', 'es', 'ar', 'ru', 'ko', 'de']) {
    const copy = collectionCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), keys);
    assert.ok(Object.values(copy).every(value => typeof value === 'string' && value.length > 0));
    assert.match(copy.page, /\{current\}/); assert.match(copy.page, /\{total\}/);
  }
});

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

test('random entry chooses an enabled flavor in the initial slot and preserves an explicit choice', () => {
  const data = fixture();
  data.productGroups.find(item => item.id === 'group-a').position = 0;
  data.packagingSlots.find(item => item.id === 'a330-slot').position = -1;
  assert.equal(randomStorefrontEntry(data, {}, 0).variantId, 'a330-orange');
  const entry = randomStorefrontEntry(data, {}, 0.999);
  assert.deepEqual(entry, { groupId: 'group-a', slotId: 'a330-slot', variantId: 'a330-mango' });
  assert.deepEqual(randomStorefrontEntry(data, entry, 0), entry);
  data.productVariants.find(item => item.id === 'a330-mango').enabled = false;
  assert.equal(randomStorefrontEntry(data, {}, 0.999).variantId, 'a330-orange');
  data.flavors.find(item => item.id === 'orange').lifecycle = 'archived';
  assert.deepEqual(randomStorefrontEntry(data, {}, 0.999), {});
  data.productGroups.forEach(item => { item.visible = false; });
  assert.deepEqual(randomStorefrontEntry(data, {}, 0.5), {});
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

test('card actions omit intentionally disabled slots and groups and restore them after On', () => {
  const { applyDisplayAction } = require('../../lib/catalog/display-management.ts');
  const data = fixture();
  const off = applyDisplayAction(data, { mode: '2d', id: 'display-b330-orange', action: 'set-enabled', enabled: false, expectedRevision: 1, expectedDraftHash: 'a'.repeat(64) });
  assert.deepEqual(resolveStorefrontSelection(off).groups.map(item => item.id), ['group-a']);
  assert.equal(catalogProducts(off).some(item => item.variant.id === 'b330-orange'), false);
  assert.deepEqual(validateCatalog(off, { mode: 'publish' }), []);
  const on = applyDisplayAction(off, { mode: '2d', id: 'display-b330-orange', action: 'set-enabled', enabled: true, expectedRevision: 2, expectedDraftHash: 'a'.repeat(64) });
  assert.deepEqual(resolveStorefrontSelection(on).groups.map(item => item.id), ['group-b', 'group-a']);
  assert.equal(resolveStorefrontSelection(on).variant.id, 'b330-orange');
  assert.deepEqual(validateCatalog(on, { mode: 'publish' }), []);
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

test('unready or model thumbnails are never returned as card images', () => {
  const data = fixture();
  data.media.find(item => item.id === 'thumb-orange').status = 'processing';
  assert.equal(catalogProducts(data).find(item => item.variant.id === 'b330-orange').thumbnail, undefined);
  data.media.find(item => item.id === 'thumb-mango').role = 'model';
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
    assert.equal((await fetchPublishedCatalog({ apiBase: '', mode: 'static', fetcher: async (url, options) => { calls.push({ url, options }); return response(envelope()); } })).source, 'static');
    assert.deepEqual(calls.map(call => call.url), ['/HyperDrink/catalog/current.json']);
    assert.equal(calls[0].options.cache, 'no-cache'); assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(new Request(`https://storefront.example.test${calls[0].url}`, calls[0].options).mode, 'cors', 'Static fetch must match the anonymous preload CORS mode');
    calls.length = 0;
    await fetchPublishedCatalog({ apiBase: '', mode: 'api', fetcher: async url => { calls.push(url); return response(envelope()); } });
    assert.deepEqual(calls, ['/HyperDrink/api/public/v1/catalog']);
  } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = old; }
});

test('Pages starts one matching static catalog preload before hydration and hosted API/local layouts omit it', () => {
  const keys = ['GITHUB_PAGES', 'NEXT_PUBLIC_ADMIN_API_URL', 'NEXT_PUBLIC_BASE_PATH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.GITHUB_PAGES = 'true'; process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink'; delete process.env.NEXT_PUBLIC_ADMIN_API_URL;
    const html = renderRootLayout();
    assert.match(html, /<head><link rel="preload" as="fetch" href="\/HyperDrink\/catalog\/current\.json" crossorigin="anonymous"\/><\/head>/i);
    assert.equal((html.match(/rel="preload"/g) || []).length, 1);
    process.env.NEXT_PUBLIC_ADMIN_API_URL = 'https://catalog.example.test';
    assert.doesNotMatch(renderRootLayout(), /catalog\/current\.json/);
    delete process.env.NEXT_PUBLIC_ADMIN_API_URL; process.env.GITHUB_PAGES = 'false';
    assert.doesNotMatch(renderRootLayout(), /catalog\/current\.json/);
  } finally { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});

test('static revalidation can receive a new release and rejects authoritative 404, invalid JSON and invalid graphs', async () => {
  let revision = 0;
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return response(envelope(fixture(), `release-${++revision}`)); };
  assert.equal((await fetchPublishedCatalog({ apiBase: '', mode: 'static', fetcher })).releaseId, 'release-1');
  assert.equal((await fetchPublishedCatalog({ apiBase: '', mode: 'static', fetcher })).releaseId, 'release-2');
  assert.ok(calls.every(call => call.options.cache === 'no-cache' && call.options.credentials === 'same-origin'));
  const invalidGraph = fixture(); invalidGraph.media[0].url = 'javascript:alert(1)';
  for (const bad of [response({ error: { message: 'No published release' } }, 404), new Response('{invalid', { headers: { 'content-type': 'application/json' } }), response(envelope(invalidGraph))]) {
    const attempts = [];
    await assert.rejects(fetchPublishedCatalog({ apiBase: '', mode: 'static', fetcher: async (url, options) => { attempts.push({ url, options }); return bad; } }));
    assert.deepEqual(attempts.map(call => call.url), ['/catalog/current.json']);
    assert.equal(attempts[0].options.cache, 'no-cache'); assert.equal(attempts[0].options.credentials, 'same-origin');
  }
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
    const result = await fetchPublishedCatalog({ apiBase: '', mode: 'api', fetcher: async (url, options) => { calls.push({ url, options }); if (calls.length === 1) { if (first === 'network') throw new TypeError('offline'); return response({ error: { message: 'Unavailable' } }, 503); } return response(envelope(fixture(), 'retained-release')); } });
    assert.equal(result.source, 'static'); assert.equal(result.releaseId, 'retained-release');
    assert.deepEqual(calls.map(call => call.url), ['/api/public/v1/catalog', '/catalog/current.json']);
    assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[1].options.cache, 'no-cache'); assert.equal(calls[1].options.credentials, 'same-origin');
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


test('flavor thumbnails accept every ready image category while rejecting non-image bytes', () => {
  for (const role of ['thumbnail', 'label', 'fruit', 'leaf', 'splash', 'ice', 'icon', 'poster', 'image-2d']) {
    const data = fixture(), media = data.media.find(item => item.id === 'thumb-mango'); media.role = role;
    assert.equal(catalogProducts(data).find(item => item.variant.id === 'a330-mango').thumbnail?.id, media.id);

    media.mime = 'model/gltf-binary';
    assert.equal(catalogProducts(data).find(item => item.variant.id === 'a330-mango').thumbnail, undefined);
  }
});
