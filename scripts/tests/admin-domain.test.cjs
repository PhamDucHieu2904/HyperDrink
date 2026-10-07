/* eslint-disable @typescript-eslint/no-require-imports -- Tests execute shipped TypeScript without a build step. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function loadSource(relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const loaded = { exports: {} }; cache.set(absolute, loaded);
  const source = fs.readFileSync(absolute, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } });
  const requireSource = name => {
    if (name.startsWith('@/')) return loadSource(name.slice(2).endsWith('.json') ? name.slice(2) : `${name.slice(2)}.ts`);
    return name.startsWith('.') ? loadSource(path.relative(root, path.resolve(path.dirname(absolute), `${name}.ts`))) : require(name);
  };
  new Function('require', 'module', 'exports', outputText)(requireSource, loaded, loaded.exports);
  return loaded.exports;
}
const validation = loadSource('lib/catalog/validation.ts');
const compatibility = loadSource('lib/catalog/compatibility.ts');
const service = loadSource('lib/catalog/service.ts');
const deletion = loadSource('lib/catalog/deletion.ts');
const displayDrafts = loadSource('lib/catalog/display-drafts.ts');
const displayManagement = loadSource('lib/catalog/display-management.ts');
const displayList = loadSource('lib/catalog/display-list.ts');
const flavorMedia = loadSource('lib/catalog/flavor-media.ts');
const seed = loadSource('lib/catalog/seed.ts');
const now = '2026-10-01T04:00:00.000Z';
const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now });
const image = (id, role) => ({ ...entity(id), role, status: 'ready', url: `/assets/${id}.webp`, storageKey: `media/${id}.webp`, mime: 'image/webp', bytes: 1024, sha256: 'a'.repeat(64), width: 512, height: 512, imageBounds: null, error: '' });
function fixture() {
  return {
    schemaVersion: 1,
    drinkTypes: [{ ...entity('juice'), description: '', position: 0 }],
    packagingCategories: [{ ...entity('alu'), viewerKind: 'can', position: 0 }],
    packagingVariants: [{ ...entity('can-330'), categoryId: 'alu', volumeMl: 330, shape: 'standard', position: 0 }],
    flavors: [{ ...entity('lime'), shortName: 'Lime', description: '', accentColor: '#aabb22', backgroundColor: '#445522', textColor: '#ffffff', icon: 'lime', thumbnailId: 'thumbnail-lime', position: 0 }],
    flavorAssets: [{ ...entity('lime-fruit'), flavorId: 'lime', mediaId: 'fruit-lime', role: 'fruit', position: 0, enabled: true }],
    productGroups: [{ ...entity('juice-thirty'), drinkTypeId: 'juice', description: '', buttonLabel: 'Juice 30%', position: 0, visible: true }],
    productVariants: [{ ...entity('juice-lime-can'), groupId: 'juice-thirty', packagingVariantId: 'can-330', flavorId: 'lime', code: 'JL330', description: '', enabled: true }],
    packagingSlots: [{ ...entity('slot-can'), groupId: 'juice-thirty', packagingVariantId: 'can-330', regionKey: 'packaging-picker', position: 0, buttonLabel: '330 ml', mode: 'auto', defaultVariantId: 'juice-lime-can', enabled: true }],
    media: [{ ...image('model-can', 'model'), url: '/models/can.glb', storageKey: 'media/can.glb', mime: 'model/gltf-binary', width: null, height: null }, image('poster-can', 'poster'), image('label-lime', 'label'), image('image-lime', 'image-2d'), image('thumbnail-lime', 'thumbnail'), image('fruit-lime', 'fruit')],
    labels: [{ ...entity('label-lime'), drinkTypeId: 'juice', flavorId: 'lime', mediaId: 'label-lime', compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] }],
    models3d: [{ ...entity('can-model'), packagingVariantId: 'can-330', mediaId: 'model-can', posterId: 'poster-can', layoutProfile: 'can-wrap-v1', materialSlots: { body: ['aluminum'], label: ['printed-label'] }, orientation: [0, 0, 0] }],
    assets2d: [{ ...entity('lime-render'), packagingVariantId: 'can-330', drinkTypeId: 'juice', flavorId: 'lime', mediaId: 'image-lime', galleryIds: [], description: '' }],
    displays3d: [{ ...entity('display-lime-3d'), productVariantId: 'juice-lime-can', modelId: 'can-model', labelId: 'label-lime', enabled: true }],
    displays2d: [{ ...entity('display-lime-2d'), productVariantId: 'juice-lime-can', assetId: 'lime-render', alt: 'Juice 30% Lime can 330 ml', enabled: true }],
    productDetails: [],
  };
}
const errors = issues => issues.filter(issue => issue.severity === 'error');

test('product marketing messages remain optional for legacy drafts and survive release creation', () => {
  const data = fixture(), group = data.productGroups[0];
  assert.deepEqual(validation.validateRecord('productGroups', group, { mode: 'publish' }), []);
  Object.assign(group, { heroVolumeCaption: 'Net content', heroFlavorText: 'Many flavor choices', heroOriginText: 'Real fruit from Vietnam' });
  assert.deepEqual(validation.validateRecord('productGroups', group, { mode: 'publish' }), []);
  const published = service.prepareCatalogRelease(data).productGroups[0];
  for (const field of ['heroVolumeCaption', 'heroFlavorText', 'heroOriginText']) {
    assert.equal(published[field], group[field]);
    assert.ok(validation.validateRecord('productGroups', { ...group, [field]: 'x'.repeat(101) }).some(issue => issue.field === field));
    assert.ok(validation.validateRecord('productGroups', { ...group, [field]: 123 }).some(issue => issue.field === field));
    assert.ok(validation.validateRecord('productGroups', { ...group, [field]: '\u0000' }).some(issue => issue.field === field));
  }
});
const codes = issues => new Set(issues.map(issue => issue.code));
function expectCode(data, code) { assert.ok(codes(validation.preflightCatalog(data)).has(code), `Expected ${code}`); }

function deletionFixture() {
  const data = fixture();
  data.flavors.push({ ...data.flavors[0], ...entity('orange'), thumbnailId: null, position: 1 });
  data.productVariants.push({ ...data.productVariants[0], ...entity('broken-orange'), flavorId: 'orange', code: 'JO330' });
  return data;
}

const cardAction = (data, id, action, enabled, mode = '3d') => displayManagement.applyDisplayAction(data, { mode, id, action, enabled, expectedRevision: data[mode === '3d' ? 'displays3d' : 'displays2d'].find(item => item.id === id).revision, expectedDraftHash: 'a'.repeat(64) }, now);

function managedFixture() {
  const data = deletionFixture();
  data.packagingSlots[0].mode = '3d';
  data.labels.push({ ...data.labels[0], ...entity('label-orange'), flavorId: 'orange' });
  data.displays3d.push({ ...data.displays3d[0], ...entity('display-orange-3d'), productVariantId: 'broken-orange', labelId: 'label-orange' });
  return data;
}

test('card Off hides a 3D product and repairs its default; On restores it without changing shared assets', () => {
  const data = managedFixture(), before = structuredClone(data);
  const off = cardAction(data, 'display-lime-3d', 'set-enabled', false);
  assert.equal(off.productVariants[0].enabled, false, '2D cannot keep a product visible in a 3D-only slot');
  assert.equal(off.packagingSlots[0].defaultVariantId, 'broken-orange');
  assert.equal(off.packagingSlots[0].revision, 2);
  assert.deepEqual(errors(validation.preflightCatalog(off)), []);
  assert.deepEqual(service.prepareCatalogRelease(off).productVariants.map(item => item.id), ['broken-orange']);
  const on = cardAction(off, 'display-lime-3d', 'set-enabled', true);
  assert.equal(on.productVariants[0].enabled, true);
  assert.equal(on.packagingSlots[0].defaultVariantId, 'broken-orange', 'Turning On must not steal an existing default');
  assert.equal(service.prepareCatalogRelease(on).productVariants.length, 2);
  for (const name of ['media', 'labels', 'models3d', 'flavors', 'flavorAssets', 'assets2d']) assert.deepEqual(on[name], data[name]);
  assert.deepEqual(data, before);
});

test('delete removes only the selected display, preserves 2D fallback in auto mode and supports recreating its tuple', () => {
  const data = fixture();
  const removed = cardAction(data, 'display-lime-3d', 'delete');
  assert.equal(removed.displays3d.length, 0);
  assert.deepEqual(removed.displays2d, data.displays2d);
  assert.equal(removed.productVariants[0].enabled, true);
  assert.deepEqual(errors(validation.preflightCatalog(removed)), []);
  const noFallback = cardAction(removed, 'display-lime-2d', 'delete', undefined, '2d');
  assert.equal(noFallback.productVariants[0].enabled, false);
  assert.equal(noFallback.packagingSlots[0].defaultVariantId, null);
  assert.equal(noFallback.productGroups[0].visible, true, 'Visibility preference is retained for recreation');
  const variant = noFallback.productVariants[0];
  const recreated = displayDrafts.saveDisplayDraft(noFallback, { mode: '3d', variant, expectedVariantRevision: variant.revision, display: data.displays3d[0], expectedDisplayRevision: null, slot: null, expectedSlotRevision: null }, now);
  assert.equal(recreated.catalog.productVariants.length, 1);
  assert.equal(recreated.catalog.productVariants[0].enabled, true);
  assert.equal(recreated.catalog.packagingSlots[0].defaultVariantId, variant.id);
  assert.deepEqual(errors(validation.preflightCatalog(recreated.catalog)), []);
});

test('switching the last product Off omits its region, and switching On restores the existing group and slot', () => {
  const data = managedFixture();
  let off = cardAction(data, 'display-lime-3d', 'set-enabled', false);
  off = cardAction(off, 'display-orange-3d', 'set-enabled', false);
  assert.equal(off.packagingSlots[0].defaultVariantId, null);
  assert.equal(compatibility.collectPublicCatalog(off).productGroups.length, 0);
  const failureCodes = codes(validation.preflightCatalog(off));
  assert.equal(failureCodes.has('slot_without_variants'), false);
  assert.equal(failureCodes.has('default_variant_unavailable'), false);
  assert.equal(failureCodes.has('empty_public_catalog'), true, 'Existing requirement for at least one public group remains');
  const on = cardAction(off, 'display-orange-3d', 'set-enabled', true);
  assert.equal(on.packagingSlots[0].defaultVariantId, 'broken-orange');
  assert.deepEqual(errors(validation.preflightCatalog(on)), []);
  assert.equal(service.prepareCatalogRelease(on).productGroups[0].id, data.productGroups[0].id);
});

test('the editor checkbox uses the same visibility and default repair as the card', () => {
  const data = managedFixture();
  const off = displayDrafts.saveDisplayDraft(data, { mode: '3d', variant: data.productVariants[0], expectedVariantRevision: 1, display: { ...data.displays3d[0], enabled: false }, expectedDisplayRevision: 1, slot: null, expectedSlotRevision: null }, now);
  assert.equal(off.catalog.productVariants[0].enabled, false);
  assert.equal(off.catalog.packagingSlots[0].defaultVariantId, 'broken-orange');
  assert.deepEqual(errors(validation.preflightCatalog(off.catalog)), []);
  assert.throws(() => displayManagement.applyDisplayAction(off.catalog, { mode: '3d', id: 'display-lime-3d', action: 'delete', expectedRevision: 1 }), error => error.code === 'revision_conflict');
});

test('display filters group by Best Seller ID and combine group, status and accent-insensitive metadata search', () => {
  const data = managedFixture();
  data.productGroups[0].name = 'Nước trái cây'; data.productGroups[0].buttonLabel = 'Juice';
  data.productGroups.push({ ...data.productGroups[0], ...entity('juice-other'), name: 'Nước trái cây khác', position: 1 });
  data.productVariants.push({ ...data.productVariants[0], ...entity('other-lime'), groupId: 'juice-other', code: 'Other330' });
  data.displays3d.push({ ...data.displays3d[0], ...entity('other-display'), productVariantId: 'other-lime', enabled: false });
  const all = displayList.displayListGroups(data, '3d', { query: '', groupId: '', status: 'all' });
  assert.deepEqual(all.map(group => [group.id, group.label, group.records.length]), [['juice-thirty', 'Juice', 2], ['juice-other', 'Juice', 1]]);
  const selected = displayList.displayListGroups(data, '3d', { query: 'nuoc trai cay', groupId: 'juice-other', status: 'off' });
  assert.deepEqual(selected[0].records.map(item => item.id), ['other-display']);
  assert.equal(displayList.displayListGroups(data, '3d', { query: 'Other330', groupId: '', status: 'on' }).length, 0);
  data.displays3d[2].lifecycle = 'archived';
  assert.equal(displayList.displayListGroups(data, '3d', { query: '', groupId: 'juice-other', status: 'all' }).length, 0);
});

test('deleting a missing-display product physically removes its data and finding while retaining shared libraries', () => {
  const data = deletionFixture(), before = structuredClone(data);
  const impact = deletion.getDeletionImpact(data, 'productVariants', 'broken-orange');
  assert.deepEqual(impact.publicationIssues, []); assert.deepEqual(impact.references, []);
  const result = deletion.deleteCatalogRecord(data, 'productVariants', 'broken-orange', 1, now);
  assert.equal(result.productVariants.some(item => item.id === 'broken-orange'), false);
  assert.deepEqual(validation.preflightCatalog(result), []);
  for (const collection of ['flavors', 'media', 'labels', 'models3d', 'assets2d', 'flavorAssets']) assert.deepEqual(result[collection], data[collection]);
  assert.deepEqual(data, before, 'Preview and deletion never mutate the caller graph');
});

test('deleting a product removes only its owned active and archived 2D/3D displays', () => {
  const data = deletionFixture();
  data.displays3d.push({ ...data.displays3d[0], ...entity('broken-3d'), productVariantId: 'broken-orange', enabled: false });
  data.displays2d.push({ ...data.displays2d[0], ...entity('broken-2d'), productVariantId: 'broken-orange', lifecycle: 'archived' });
  const result = deletion.deleteCatalogRecord(data, 'productVariants', 'broken-orange', 1, now);
  assert.deepEqual(result.displays3d, fixture().displays3d); assert.deepEqual(result.displays2d, fixture().displays2d);
  assert.equal(deletion.getDeletionImpact(data, 'productVariants', 'broken-orange').records.length, 3);
});

test('deleting the default product chooses a render-ready sibling and revisions the slot atomically', () => {
  const data = deletionFixture(); data.packagingSlots[0].defaultVariantId = 'broken-orange';
  // An incomplete sibling appears first; the valid Lime display should win.
  data.flavors.push({ ...data.flavors[0], ...entity('peach'), thumbnailId: null, position: 2 });
  data.productVariants.unshift({ ...data.productVariants[1], ...entity('broken-peach'), flavorId: 'peach', code: 'JP330' });
  const impact = deletion.getDeletionImpact(data, 'productVariants', 'broken-orange');
  assert.equal(impact.defaults[0].variantId, 'juice-lime-can');
  const result = deletion.deleteCatalogRecord(data, 'productVariants', 'broken-orange', 1, now);
  assert.equal(result.packagingSlots[0].defaultVariantId, 'juice-lime-can');
  assert.equal(result.packagingSlots[0].revision, 2); assert.equal(result.packagingSlots[0].updatedAt, now);
  assert.equal(validation.preflightCatalog(result).some(item => item.code === 'default_variant_unavailable'), false);
});

test('deletion permits incomplete drafts, clears shared and nested references, and never mutates the input', () => {
  for (const [collection, id] of [['productVariants', 'juice-lime-can'], ['media', 'label-lime'], ['packagingVariants', 'can-330'], ['models3d', 'can-model']]) {
    const data = fixture(), before = structuredClone(data);
    const result = deletion.deleteCatalogRecord(data, collection, id, 1, now);
    assert.equal(result[collection].some(item => item.id === id), false);
    assert.deepEqual(errors(validation.validateCatalog(result)), [], 'No dangling IDs or malformed data in the draft');
    if (collection !== 'models3d') assert.ok(errors(validation.preflightCatalog(result)).length, 'Incomplete public selections block publication, not draft deletion');
    assert.deepEqual(data, before);
  }
  const gallery = fixture(); gallery.assets2d[0].galleryIds.push('fruit-lime'); gallery.flavorAssets = [];
  assert.equal(deletion.getDeletionImpact(gallery, 'media', 'fruit-lime').references[0].field, 'galleryIds.0');
  const removed = deletion.deleteCatalogRecord(gallery, 'media', 'fruit-lime', 1, now);
  assert.deepEqual(removed.assets2d[0].galleryIds, []); assert.equal(removed.assets2d[0].revision, 2);
  const model = deletion.deleteCatalogRecord(fixture(), 'models3d', 'can-model', 1, now);
  assert.equal(model.displays3d[0].modelId, null); assert.equal(model.displays3d[0].revision, 2);
});

test('deletion rejects stale revisions and still detects references from archived library records', () => {
  const data = deletionFixture();
  assert.throws(() => deletion.deleteCatalogRecord(data, 'productVariants', 'broken-orange', 0), error => error.code === 'revision_conflict');
  assert.throws(() => deletion.getDeletionImpact(data, 'productVariants', 'missing'), error => error.code === 'record_not_found');
  data.labels[0].lifecycle = 'archived';
  assert.ok(deletion.getDeletionImpact(data, 'media', 'label-lime').references.some(item => item.collection === 'labels'));
  const result = deletion.deleteCatalogRecord(data, 'media', 'label-lime', 1, now);
  assert.equal(result.labels[0].mediaId, null); assert.equal(result.labels[0].revision, 2);
  assert.equal(result.labels[0].lifecycle, 'archived');
});

test('every catalog collection supports draft deletion with structurally valid remaining records', () => {
  for (const collection of validation.CATALOG_COLLECTIONS) {
    const data = fixture();
    if (collection === 'productDetails') data.productDetails.push(detailRecord());
    if (collection === 'catalogCollections' || collection === 'catalogItems') {
      data.productDetails.push(detailRecord());
      data.catalogCollections = [{ ...data.productGroups[0], id: 'collection-2d', slug: 'collection-2d', drinkTypeId: 'juice', position: 0, homeVisible: true, enabled: true }];
      for (const field of ['description', 'buttonLabel', 'visible']) delete data.catalogCollections[0][field];
      data.catalogItems = [{ ...data.productVariants[0], id: 'catalog-product', slug: 'catalog-product', collectionId: 'collection-2d', mediaId: null, productDetailId: null, packagingVariantId: data.packagingVariants[0].id, position: 0, enabled: true }];
      for (const field of ['groupId', 'flavorId', 'code', 'description']) delete data.catalogItems[0][field];
    }
    const target = data[collection][0], before = structuredClone(data);
    const result = deletion.deleteCatalogRecord(data, collection, target.id, target.revision, now);
    assert.deepEqual(errors(validation.validateCatalog(result)), [], collection);
    assert.equal(result[collection].some(item => item.id === target.id), false, collection);
    assert.deepEqual(data, before);
  }
});

function detailRecord(overrides = {}) {
  return { ...entity('lime-detail'), labelId: 'label-lime', posterId: null, eyebrow: '', headline: 'Lime', subtitle: '', introduction: '', ingredients: '', allergens: '', servingSize: 'Per 100 ml', nutrition: [{ label: 'Total sugar', amount: '9.0 g', dailyValue: '' }], companyName: '', companyAddress: '', countryOfOrigin: '', netContent: '', storage: '', shelfLife: '', sections: [], enabled: true, ...overrides };
}

test('legacy catalogs normalize the optional detail collection, while malformed details and duplicate label links fail', () => {
  const data = fixture(); delete data.productDetails;
  assert.deepEqual(errors(validation.validateCatalog(data)), []);
  assert.deepEqual(compatibility.collectPublicCatalog(data).productDetails, []);
  data.productDetails = [detailRecord()];
  assert.deepEqual(errors(validation.validateCatalog(data)), []);
  data.productDetails.push(detailRecord({ ...entity('second-detail') }));
  assert.ok(codes(validation.validateCatalog(data)).has('duplicate_product_detail'));
  assert.ok(validation.validateRecord('productDetails', detailRecord({ nutrition: [{ label: 'Sugar', amount: 9, dailyValue: '' }] })).some(issue => issue.field.startsWith('nutrition')));
  assert.ok(validation.validateRecord('productDetails', detailRecord({ sections: [{ title: 'Story', body: 'Text', html: '<script />' }] })).some(issue => issue.field.startsWith('sections')));
});

test('published product details follow their applied label and include ready image posters only', () => {
  const data = fixture(); data.productDetails.push(detailRecord({ posterId: 'fruit-lime' }));
  assert.deepEqual(errors(validation.preflightCatalog(data)), []);
  assert.equal(service.prepareCatalogRelease(data).productDetails[0].posterId, 'fruit-lime');
  data.productDetails[0].posterId = 'model-can';
  assert.ok(codes(validation.preflightCatalog(data)).has('poster_unavailable'));
  data.productDetails[0].enabled = false;
  assert.deepEqual(compatibility.collectPublicCatalog(data).productDetails, []);
  assert.deepEqual(errors(validation.preflightCatalog(data)), [], 'A disabled detail does not block products');
  data.productDetails[0].enabled = true; data.productDetails[0].lifecycle = 'archived';
  assert.deepEqual(compatibility.collectPublicCatalog(data).productDetails, []);
});

test('deleting a detail or its poster retains the product and deleting its label detaches the detail safely', () => {
  const data = fixture(); data.productDetails.push(detailRecord({ posterId: 'fruit-lime' }));
  const deleted = deletion.deleteCatalogRecord(data, 'productDetails', 'lime-detail', 1, now);
  assert.equal(deleted.productDetails.length, 0); assert.deepEqual(deleted.displays3d, data.displays3d);
  const poster = deletion.deleteCatalogRecord(data, 'media', 'fruit-lime', 1, now);
  assert.equal(poster.productDetails[0].posterId, null); assert.equal(poster.productDetails[0].revision, 2);
  const label = deletion.deleteCatalogRecord(data, 'labels', 'label-lime', 1, now);
  assert.equal(label.productDetails[0].labelId, ''); assert.deepEqual(errors(validation.validateCatalog(label)), []);
  assert.equal(data.productDetails[0].labelId, 'label-lime', 'Source data remains immutable');
});

test('deleting a group removes owned products, slots and displays but preserves all shared libraries', () => {
  const data = fixture();
  const impact = deletion.getDeletionImpact(data, 'productGroups', 'juice-thirty');
  assert.equal(impact.records.length, 5);
  const result = deletion.deleteCatalogRecord(data, 'productGroups', 'juice-thirty', 1, now);
  for (const collection of ['productGroups', 'productVariants', 'packagingSlots', 'displays3d', 'displays2d']) assert.deepEqual(result[collection], []);
  for (const collection of ['flavors', 'media', 'labels', 'models3d', 'assets2d', 'flavorAssets', 'packagingVariants', 'drinkTypes']) assert.deepEqual(result[collection], data[collection]);
});

test('deleting flavor or pool media removes its pool assignments and detaches only matching references', () => {
  const data = fixture();
  const result = deletion.deleteCatalogRecord(data, 'flavors', 'lime', 1, now);
  assert.deepEqual(result.flavorAssets, []);
  assert.equal(result.productVariants[0].flavorId, '');
  assert.equal(result.labels[0].flavorId, null); assert.equal(result.assets2d[0].flavorId, null);
  assert.deepEqual(result.media, data.media);
  const withoutMedia = deletion.deleteCatalogRecord(data, 'media', 'fruit-lime', 1, now);
  assert.deepEqual(withoutMedia.flavorAssets, []);
  assert.deepEqual(withoutMedia.flavors, data.flavors);
  assert.equal(withoutMedia.labels[0].mediaId, 'label-lime');
});

test('display creation survives a renamed legacy display retaining its old slug, and reuses the partial product', () => {
  const data = deletionFixture();
  data.displays3d[0].name = 'Renamed Peach'; data.displays3d[0].slug = 'new-orange-display';
  const before = structuredClone(data), variant = data.productVariants.find(item => item.id === 'broken-orange');
  const display = { ...data.displays3d[0], ...entity('new-orange-3d'), name: 'New Orange', slug: 'new-orange-display', productVariantId: variant.id };
  assert.throws(() => service.updateCatalogRecord(data, 'displays3d', display, null), error => error.issues.some(issue => issue.code === 'duplicate_slug'));
  const result = displayDrafts.saveDisplayDraft(data, { mode: '3d', variant, expectedVariantRevision: variant.revision, display, expectedDisplayRevision: null, slot: null, expectedSlotRevision: null }, now);
  assert.equal(result.display.slug, 'new-orange-display-2');
  assert.deepEqual(result.catalog.displays3d[0], data.displays3d[0]);
  assert.equal(result.catalog.productVariants.length, data.productVariants.length);
  assert.equal(result.catalog.productVariants.find(item => item.id === variant.id).revision, variant.revision + 1);
  assert.equal(validation.preflightCatalog(result.catalog).some(issue => issue.entityId === variant.id && issue.code === 'display_unavailable'), false);
  assert.deepEqual(data, before);
});

test('same display names on distinct products receive unique automatic slugs and edits retain stable identity', () => {
  const data = deletionFixture();
  const variant = { ...data.productVariants[1], name: data.productVariants[0].name, slug: data.productVariants[0].slug };
  // New tuple with a fresh ID and a colliding name-derived product slug.
  data.productVariants.pop();
  const display = { ...data.displays3d[0], ...entity('same-name-new-display'), name: data.displays3d[0].name, slug: data.displays3d[0].slug, productVariantId: variant.id };
  const created = displayDrafts.saveDisplayDraft(data, { mode: '3d', variant, expectedVariantRevision: null, display, expectedDisplayRevision: null, slot: null, expectedSlotRevision: null }, now);
  const savedVariant = created.catalog.productVariants.find(item => item.id === variant.id);
  assert.equal(savedVariant.slug, `${data.productVariants[0].slug}-2`);
  assert.equal(created.display.slug, `${data.displays3d[0].slug}-2`);
  const edited = displayDrafts.saveDisplayDraft(created.catalog, { mode: '3d', variant: { ...savedVariant, name: 'Renamed' }, expectedVariantRevision: savedVariant.revision, display: { ...created.display, name: 'Renamed' }, expectedDisplayRevision: created.display.revision, slot: null, expectedSlotRevision: null }, now);
  assert.equal(edited.display.id, created.display.id); assert.equal(edited.display.slug, created.display.slug);
  assert.equal(edited.catalog.displays3d.length, created.catalog.displays3d.length);
});

test('moving a display to a new flavor synchronizes both product tuples and repairs the slot default', () => {
  for (const mode of ['3d', '2d']) {
    const data = deletionFixture(), before = structuredClone(data);
    data.packagingSlots[0].mode = mode;
    const collection = mode === '3d' ? 'displays3d' : 'displays2d';
    const variant = data.productVariants[1];
    const display = { ...data[collection][0], productVariantId: variant.id };
    if (mode === '3d') {
      data.labels.push({ ...data.labels[0], ...entity('label-orange'), flavorId: 'orange' });
      display.labelId = 'label-orange';
    } else {
      data.assets2d.push({ ...data.assets2d[0], ...entity('orange-render'), flavorId: 'orange' });
      display.assetId = 'orange-render';
    }
    const immutableInput = structuredClone(data);
    const result = displayDrafts.saveDisplayDraft(data, { mode, variant, expectedVariantRevision: 1, display, expectedDisplayRevision: 1, slot: null, expectedSlotRevision: null }, now).catalog;
    assert.equal(result.productVariants[0].enabled, false, 'Opposite-mode display must not keep the old product in a single-mode slot');
    assert.equal(result.productVariants[0].revision, 2);
    assert.equal(result.productVariants[1].enabled, true);
    assert.equal(result.packagingSlots[0].defaultVariantId, variant.id);
    assert.equal(result.packagingSlots[0].revision, 2);
    assert.equal(result[collection][0].id, before[collection][0].id);
    assert.equal(result[collection][0].productVariantId, variant.id);
    assert.equal(result.productVariants.length, 2, 'Previous product data is retained');
    assert.deepEqual(errors(validation.preflightCatalog(result)), []);
    for (const name of ['flavors', 'flavorAssets', 'media', 'labels', 'models3d', 'assets2d']) assert.deepEqual(result[name], data[name]);
    assert.deepEqual(data, immutableInput);
    assert.deepEqual(before.productVariants[0].enabled, true, 'Existing snapshots are unchanged');
  }
});

test('moving 3D preserves a usable 2D fallback in auto mode, while unrelated missing displays still block publication', () => {
  const data = deletionFixture();
  data.labels.push({ ...data.labels[0], ...entity('label-orange'), flavorId: 'orange' });
  const variant = data.productVariants[1];
  const result = displayDrafts.saveDisplayDraft(data, { mode: '3d', variant, expectedVariantRevision: 1, display: { ...data.displays3d[0], productVariantId: variant.id, labelId: 'label-orange' }, expectedDisplayRevision: 1, slot: null, expectedSlotRevision: null }, now).catalog;
  assert.equal(result.productVariants[0].enabled, true);
  assert.equal(result.productVariants[0].revision, 1);
  assert.equal(result.packagingSlots[0].defaultVariantId, data.productVariants[0].id);
  assert.deepEqual(errors(validation.preflightCatalog(result)), []);
  assert.ok(validation.preflightCatalog(deletionFixture()).some(issue => issue.entityId === 'broken-orange' && issue.code === 'display_unavailable'));
});

test('preflight recognizes the same usable fruit pool image as storefront flavor buttons', () => {
  const data = fixture(); data.flavors[0].thumbnailId = null;
  assert.equal(codes(validation.preflightCatalog(data)).has('thumbnail_missing'), false);
  for (const invalidate of [
    draft => { draft.flavorAssets[0].enabled = false; },
    draft => { draft.flavorAssets[0].lifecycle = 'archived'; },
    draft => { draft.flavorAssets[0].flavorId = 'another-flavor'; },
    draft => { draft.flavorAssets[0].role = 'leaf'; draft.media.find(item => item.id === 'fruit-lime').role = 'leaf'; },
    draft => { draft.media.find(item => item.id === 'fruit-lime').lifecycle = 'archived'; },
    draft => { draft.media.find(item => item.id === 'fruit-lime').status = 'processing'; },
    draft => { draft.media.find(item => item.id === 'fruit-lime').mime = 'application/octet-stream'; },
    draft => { draft.media.find(item => item.id === 'fruit-lime').url = ''; },
  ]) {
    const invalid = structuredClone(data); invalidate(invalid);
    assert.equal(flavorMedia.resolveFlavorFruitImage(invalid, 'lime'), undefined);
    const issues = validation.preflightCatalog(invalid);
    assert.ok(errors(issues).length || issues.some(issue => issue.entityId === 'lime' && issue.code === 'thumbnail_missing'), 'Unusable pool images must warn or fail integrity validation');
  }
  const invalidThumbnail = structuredClone(data); invalidThumbnail.flavors[0].thumbnailId = 'model-can';
  assert.ok(errors(validation.preflightCatalog(invalidThumbnail)).some(issue => issue.entityId === 'lime' && issue.field === 'thumbnailId'), 'A fruit fallback must not excuse an invalid explicit thumbnail');
});

test('display drafts reject duplicate displays, mismatched slots and stale tuple creation without mutating data', () => {
  const data = fixture(), before = structuredClone(data);
  const input = { mode: '3d', variant: data.productVariants[0], expectedVariantRevision: 1, display: { ...data.displays3d[0], id: 'new-display' }, expectedDisplayRevision: null, slot: null, expectedSlotRevision: null };
  assert.throws(() => displayDrafts.saveDisplayDraft(data, input), error => error.code === 'display_exists');
  assert.throws(() => displayDrafts.saveDisplayDraft(data, { ...input, slot: { ...data.packagingSlots[0], groupId: 'other' } }), error => error.code === 'display_draft_invalid');
  assert.throws(() => displayDrafts.saveDisplayDraft(data, { ...input, variant: { ...input.variant, id: 'stale-new-product' }, display: { ...input.display, productVariantId: 'stale-new-product' } }), error => error.code === 'revision_conflict');
  assert.deepEqual(data, before);
});

test('the actual migration seed is draft-safe and permits edits without auto-publishing demo content', () => {
  const data = seed.createSeedCatalog();
  assert.deepEqual(errors(validation.validateCatalog(data)), []);
  assert.equal(data.packagingCategories.some(category => category.viewerKind === 'pp'), true);
  assert.equal(data.packagingVariants.filter(variant => variant.volumeMl === 250).length, 2);
  assert.equal(data.productGroups.every(group => !group.visible), true);
  const record = { ...data.productGroups[0], buttonLabel: 'Juice 50%' };
  const updated = service.updateCatalogRecord(data, 'productGroups', record, record.revision, now);
  assert.equal(updated.productGroups[0].buttonLabel, 'Juice 50%');
  assert.deepEqual(errors(validation.validateCatalog(updated)), []);
  assert.throws(() => service.prepareCatalogRelease(updated), error => error.code === 'publish_invalid' && error.issues.some(issue => issue.code === 'empty_public_catalog'));
});

test('complete 3D and 2D graph publishes compatible content, not unfinished library drafts', () => {
  const data = fixture();
  data.labels.push({ ...entity('unfinished-label'), name: '', slug: '', drinkTypeId: '', flavorId: null, mediaId: null, compatibilities: [] });
  assert.deepEqual(errors(validation.validateCatalog(data)), []);
  assert.deepEqual(errors(validation.preflightCatalog(data)), []);
  const release = service.prepareCatalogRelease(data);
  assert.equal(release.labels.length, 1);
  assert.equal(release.productGroups[0].buttonLabel, 'Juice 30%');
  release.models3d[0].materialSlots.label[0] = 'changed';
  assert.equal(data.models3d[0].materialSlots.label[0], 'printed-label', 'Release cloning also isolates nested values');
});

test('draft saves incomplete business choices while publish gives actionable missing-choice errors', () => {
  const data = fixture(); data.displays3d[0].modelId = null;
  assert.deepEqual(errors(validation.validateCatalog(data)), []);
  const issue = validation.preflightCatalog(data).find(item => item.collection === 'displays3d' && item.field === 'modelId');
  assert.ok(issue); assert.equal(issue.severity, 'error');
  assert.throws(() => service.prepareCatalogRelease(data), error => error.code === 'publish_invalid' && error.issues.some(item => item.field === 'modelId'));
});

test('malformed unknown JSON is rejected without throwing before graph traversal', () => {
  for (const input of [null, [], { schemaVersion: 2 }, { ...fixture(), productGroups: [null] }, { ...fixture(), labels: [{ ...fixture().labels[0], compatibilities: [null] }] }, { ...fixture(), flavors: 'wrong' }]) {
    assert.doesNotThrow(() => validation.validateCatalog(input));
    assert.ok(errors(validation.validateCatalog(input)).length);
  }
  assert.ok(codes(validation.validateRecord('productGroups', { ...fixture().productGroups[0], injected: 'field' })).has('unknown_field'));
});

test('URL schemes, credentials, backslashes and storage traversal never become valid media data', () => {
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,abc', '//host/image.png', '/\\host/image.png', 'https://user:pass@host/image.png', 'https://host/a\nb.png']) {
    assert.ok(codes(validation.validateRecord('media', { ...image('unsafe', 'label'), url })).has('unsafe_url'), url);
  }
  for (const url of ['/assets/a.webp?v=1', 'https://cdn.example.com/assets/a.webp?v=1']) assert.equal(validation.isSafeAssetUrl(url), true);
  for (const storageKey of ['/absolute/file', '../file', 'media/../file', 'media\\file']) assert.ok(codes(validation.validateRecord('media', { ...image('unsafe', 'label'), storageKey })).has('unsafe_storage_key'));
});

test('invalid colors, non-finite numbers, alpha bounds and material maps are rejected when saving drafts', () => {
  assert.ok(errors(validation.validateRecord('flavors', { ...fixture().flavors[0], accentColor: 'red' })).length);
  assert.ok(errors(validation.validateRecord('packagingVariants', { ...fixture().packagingVariants[0], volumeMl: 0 })).length);
  assert.ok(errors(validation.validateRecord('packagingSlots', { ...fixture().packagingSlots[0], position: -1 })).length);
  for (const imageBounds of [[0.8, 0, 0.2, 1], [0, 0, 1, Infinity], [0, 0, 1], [0, 0, 1.1, 1]]) assert.ok(errors(validation.validateRecord('media', { ...image('bounds', 'fruit'), imageBounds })).length);
  assert.ok(errors(validation.validateRecord('models3d', { ...fixture().models3d[0], orientation: [0, Infinity, 0] })).length);
  assert.ok(errors(validation.validateRecord('models3d', { ...fixture().models3d[0], materialSlots: { label: ['same', 'same'] } })).length);
});

test('stable ID, slug, product tuple and optional code uniqueness are enforced independently of names', () => {
  for (const [change, code] of [
    [data => data.flavors.push({ ...data.flavors[0] }), 'duplicate_id'],
    [data => data.flavors.push({ ...data.flavors[0], id: 'new-flavor' }), 'duplicate_slug'],
    [data => data.productVariants.push({ ...data.productVariants[0], id: 'duplicate-product', slug: 'duplicate-product', code: '' }), 'duplicate_product_tuple'],
    [data => data.productVariants.push({ ...data.productVariants[0], id: 'other-product', slug: 'other-product' }), 'duplicate_code'],
    [data => data.displays3d.push({ ...data.displays3d[0], id: 'second-display', slug: 'second-display' }), 'duplicate_display'],
  ]) { const data = fixture(); change(data); expectCode(data, code); }
});

test('slots cannot duplicate packaging or position and defaults must belong to their slot', () => {
  const data = fixture();
  data.packagingVariants.push({ ...data.packagingVariants[0], id: 'can-250-short', slug: 'can-250-short', volumeMl: 250, shape: 'short', position: 1 });
  data.packagingSlots.push({ ...data.packagingSlots[0], id: 'second-slot', slug: 'second-slot', packagingVariantId: 'can-250-short', defaultVariantId: null });
  expectCode(data, 'duplicate_position');
  data.packagingSlots[1].position = 1; data.packagingSlots[1].defaultVariantId = 'juice-lime-can';
  expectCode(data, 'default_variant_mismatch');
  data.packagingSlots[1].defaultVariantId = null; data.packagingSlots[1].packagingVariantId = 'can-330';
  expectCode(data, 'duplicate_slot');
});

test('non-empty dangling references fail draft integrity, while archive references are visible at preflight', () => {
  const data = fixture(); data.models3d[0].mediaId = 'missing-file';
  assert.ok(codes(validation.validateCatalog(data)).has('reference_missing'));
  const archived = fixture(); archived.flavors[0].lifecycle = 'archived';
  assert.deepEqual(errors(validation.validateCatalog(archived)), []);
  expectCode(archived, 'dependency_archived');
});

test('matching volume does not make different packaging shapes or UV profiles compatible', () => {
  const data = fixture();
  data.packagingVariants.push({ ...data.packagingVariants[0], id: 'can-330-sleek', slug: 'can-330-sleek', shape: 'sleek', position: 1 });
  data.models3d[0].packagingVariantId = 'can-330-sleek';
  expectCode(data, 'packaging_mismatch');
  data.models3d[0].packagingVariantId = 'can-330'; data.models3d[0].layoutProfile = 'different-wrap';
  expectCode(data, 'layout_mismatch');
  data.models3d[0].materialSlots.label = [];
  expectCode(data, 'label_slot_missing');
});

test('one material cannot belong to competing semantic slots and silently bypass its label override', () => {
  const model = fixture().models3d[0];
  const issues = validation.validateRecord('models3d', { ...model, materialSlots: { body: ['printed-label'], label: ['printed-label'] } });
  assert.ok(issues.some(issue => issue.code === 'ambiguous_material_slot' && issue.field === 'materialSlots.label'));
  assert.deepEqual(errors(validation.validateRecord('models3d', { ...model, materialSlots: { body: ['aluminum'], label: ['printed-label', 'front-artwork'] } })), []);
});

test('DrinkType changes revalidate all artwork, and flavor-specific artwork cannot serve another flavor', () => {
  const data = fixture(); data.drinkTypes.push({ ...entity('energy'), description: '', position: 1 }); data.productGroups[0].drinkTypeId = 'energy';
  const mismatches = validation.preflightCatalog(data).filter(issue => issue.code === 'drink_type_mismatch');
  assert.ok(mismatches.some(issue => issue.collection === 'displays3d'));
  assert.ok(mismatches.some(issue => issue.collection === 'displays2d'));
  const flavorMismatch = fixture(); flavorMismatch.flavors.push({ ...flavorMismatch.flavors[0], id: 'berry', slug: 'berry' });
  flavorMismatch.labels[0].flavorId = 'berry'; flavorMismatch.assets2d[0].flavorId = 'berry';
  assert.equal(validation.preflightCatalog(flavorMismatch).filter(issue => issue.code === 'flavor_mismatch').length, 2);
  flavorMismatch.labels[0].flavorId = null; flavorMismatch.assets2d[0].flavorId = null;
  assert.deepEqual(errors(validation.preflightCatalog(flavorMismatch)), [], 'Generic artwork is an explicit supported choice');
});

test('pending media and wrong roles cannot be published even when a URL is present', () => {
  const data = fixture(); data.media.find(item => item.id === 'label-lime').status = 'processing';
  assert.deepEqual(errors(validation.validateCatalog(data)), []); expectCode(data, 'media_not_ready');
  data.media.find(item => item.id === 'label-lime').status = 'ready'; data.media.find(item => item.id === 'label-lime').role = 'image-2d';
  expectCode(data, 'media_role_mismatch');
  const wrongFruit = fixture(); wrongFruit.media.find(item => item.id === 'fruit-lime').role = 'leaf'; expectCode(wrongFruit, 'media_role_mismatch');
});

test('2D-only and auto 2D-only catalogs work without labels, model uploads or GLB metadata', () => {
  for (const mode of ['2d', 'auto']) {
    const data = fixture(); data.packagingSlots[0].mode = mode; data.displays3d = []; data.models3d = []; data.labels = [];
    data.media = data.media.filter(item => !['model', 'label', 'poster'].includes(item.role));
    assert.deepEqual(errors(validation.preflightCatalog(data)), []);
    assert.equal(service.prepareCatalogRelease(data).displays2d.length, 1);
  }
  const data = fixture(); data.displays3d = []; data.packagingSlots[0].mode = '3d'; expectCode(data, 'display_unavailable');
});

test('2D-only slots exclude incomplete unused 3D attempts from both validation and released graph', () => {
  const data = fixture(); data.packagingSlots[0].mode = '2d';
  data.displays3d[0].modelId = null; data.displays3d[0].labelId = null;
  assert.deepEqual(errors(validation.preflightCatalog(data)), []);
  const release = service.prepareCatalogRelease(data);
  assert.deepEqual(release.displays3d, []); assert.deepEqual(release.models3d, []); assert.deepEqual(release.labels, []);
  assert.equal(release.media.some(media => ['model', 'label'].includes(media.role)), false);
});

test('a ready 2D image from another variant cannot serve as auto fallback for an unavailable variant', () => {
  const data = fixture(); data.displays3d = [];
  data.flavors.push({ ...data.flavors[0], id: 'berry', slug: 'berry' });
  data.productVariants.push({ ...data.productVariants[0], id: 'juice-berry-can', slug: 'juice-berry-can', flavorId: 'berry', code: '' });
  const issues = validation.preflightCatalog(data);
  assert.ok(issues.some(issue => issue.entityId === 'juice-berry-can' && issue.code === 'display_unavailable'));
  assert.throws(() => service.prepareCatalogRelease(data), error => error.code === 'publish_invalid');
});

test('visible groups and slot defaults require enabled content, while hidden drafts stay outside publication', () => {
  const data = fixture(); data.productVariants[0].enabled = false;
  expectCode(data, 'slot_without_variants'); expectCode(data, 'default_variant_unavailable');
  const noSlots = fixture(); noSlots.packagingSlots[0].enabled = false; expectCode(noSlots, 'group_without_slots');
  const hidden = fixture(); hidden.productGroups.push({ ...entity('hidden-group'), drinkTypeId: '', description: '', buttonLabel: '', position: 1, visible: false });
  assert.deepEqual(errors(validation.preflightCatalog(hidden)), []);
  assert.equal(service.prepareCatalogRelease(hidden).productGroups.length, 1);
});

test('PP taxonomy keeps its identity while the existing GLB viewer receives other', () => {
  const data = fixture(); data.packagingCategories[0].viewerKind = 'pp';
  assert.equal(compatibility.viewerKindForCategory(data.packagingCategories[0]), 'other');
  assert.equal(data.packagingCategories[0].viewerKind, 'pp');
  assert.deepEqual(errors(validation.preflightCatalog(data)), []);
});

test('optimistic edits reject stale revisions and isolate source objects and timestamps', () => {
  const data = fixture(); const record = { ...data.productGroups[0], buttonLabel: 'Juice 50%', revision: 999, createdAt: '2000-01-01T00:00:00.000Z' };
  const later = '2026-10-01T05:00:00.000Z';
  const updated = service.updateCatalogRecord(data, 'productGroups', record, 1, later);
  assert.equal(updated.productGroups[0].revision, 2); assert.equal(updated.productGroups[0].createdAt, now); assert.equal(updated.productGroups[0].updatedAt, later);
  assert.equal(data.productGroups[0].buttonLabel, 'Juice 30%');
  assert.throws(() => service.updateCatalogRecord(updated, 'productGroups', record, 1), error => error.code === 'revision_conflict' && error.actualRevision === 2);
  assert.throws(() => service.updateCatalogRecord(data, 'productGroups', record, null), error => error.code === 'revision_conflict');
  assert.throws(() => service.assertActiveReleaseRevision('release-new', 'release-old'), error => error.code === 'release_conflict');
});

test('create rejects duplicate combinations and reports draft errors distinct from publication errors', () => {
  const data = fixture();
  assert.throws(() => service.updateCatalogRecord(data, 'productGroups', { ...data.productGroups[0], buttonLabel: 123 }, 1), error => error.code === 'draft_invalid');
  const duplicate = { ...data.productVariants[0], id: 'new-duplicate', slug: 'new-duplicate', code: '' };
  assert.throws(() => service.updateCatalogRecord(data, 'productVariants', duplicate, null), error => error.code === 'draft_integrity');
  const result = service.ensureProductVariant(data, { groupId: 'juice-thirty', packagingVariantId: 'can-330', flavorId: 'lime' }, 'unused-id');
  assert.equal(result.created, false); assert.equal(result.variant.id, 'juice-lime-can');
  data.flavors.push({ ...data.flavors[0], id: 'berry', slug: 'berry', name: 'Berry' });
  const newProduct = service.ensureProductVariant(data, { groupId: 'juice-thirty', packagingVariantId: 'can-330', flavorId: 'berry' }, 'new-berry', now);
  assert.equal(newProduct.created, true); assert.equal(newProduct.variant.revision, 1); assert.equal(data.productVariants.length, 1);
});

test('archive impact includes nested compatibility/gallery references and protects currently visible dependencies', () => {
  const data = fixture(); data.assets2d[0].galleryIds = ['image-lime'];
  const references = service.getUsageReferences(data, 'packagingVariants', 'can-330');
  assert.ok(references.some(item => item.collection === 'labels' && item.field === 'compatibilities.0.packagingVariantId'));
  assert.ok(service.getUsageReferences(data, 'media', 'image-lime').some(item => item.field === 'galleryIds.0'));
  const impact = service.getArchiveImpact(data, 'media', 'image-lime');
  assert.equal(impact.affectsPublic, true); assert.ok(impact.publicReferences.length); assert.ok(impact.blockingIssues.length);
  assert.throws(() => service.archiveCatalogRecord(data, 'media', 'image-lime', 1), error => error.code === 'archive_in_use');
  const archived = service.archiveCatalogRecord(data, 'media', 'image-lime', 1, { allowPublicImpact: true, now });
  assert.equal(archived.media.find(item => item.id === 'image-lime').lifecycle, 'archived');
  assert.equal(data.media.find(item => item.id === 'image-lime').lifecycle, 'active');
  assert.throws(() => service.prepareCatalogRelease(archived), error => error.code === 'publish_invalid');
});

test('unused library records can archive without affecting visible products', () => {
  const data = fixture(); data.media.push(image('unused-image', 'image-2d'));
  const impact = service.getArchiveImpact(data, 'media', 'unused-image'); assert.equal(impact.affectsPublic, false); assert.deepEqual(impact.blockingIssues, []);
  const archived = service.archiveCatalogRecord(data, 'media', 'unused-image', 1, { now });
  assert.deepEqual(errors(validation.preflightCatalog(archived)), []);
});

test('button reorder is atomic, complete and checks each slot revision', () => {
  const data = fixture(); data.packagingVariants.push({ ...data.packagingVariants[0], id: 'can-250', slug: 'can-250', volumeMl: 250, position: 1 });
  data.packagingSlots.push({ ...data.packagingSlots[0], id: 'slot-250', slug: 'slot-250', packagingVariantId: 'can-250', defaultVariantId: null, position: 1, enabled: false });
  const reordered = service.reorderPackagingSlots(data, 'juice-thirty', ['slot-250', 'slot-can'], { 'slot-can': 1, 'slot-250': 1 }, now);
  assert.equal(reordered.packagingSlots.find(item => item.id === 'slot-can').position, 1); assert.equal(reordered.packagingSlots.find(item => item.id === 'slot-250').position, 0);
  assert.deepEqual(errors(validation.validateCatalog(reordered)), []); assert.equal(data.packagingSlots[0].position, 0);
  assert.throws(() => service.reorderPackagingSlots(data, 'juice-thirty', ['slot-can'], { 'slot-can': 1 }), error => error.code === 'invalid_reorder');
  assert.throws(() => service.reorderPackagingSlots(data, 'juice-thirty', ['slot-can', 'slot-250'], { 'slot-can': 0, 'slot-250': 1 }), error => error.code === 'revision_conflict');
});


test('flavor thumbnails accept all image roles, reusable icon links are published, and old flavors remain valid', () => {
  for (const role of ['thumbnail', 'fruit', 'label', 'leaf', 'splash', 'ice', 'poster', 'image-2d', 'icon']) {
    const data = fixture(); data.media.find(item => item.id === 'thumbnail-lime').role = role;
    assert.deepEqual(errors(validation.preflightCatalog(data)), []);
  }
  const data = fixture(); data.media.push(image('custom-icon', 'icon'), image('unused-icon', 'icon'));
  data.flavors[0].iconId = 'custom-icon';
  assert.deepEqual(errors(validation.preflightCatalog(data)), []);
  assert.equal(compatibility.collectPublicCatalog(data).media.some(item => item.id === 'custom-icon'), true);
  assert.equal(compatibility.collectPublicCatalog(data).media.some(item => item.id === 'unused-icon'), false);
  const removed = deletion.deleteCatalogRecord(data, 'media', 'custom-icon', 1, now);
  assert.equal(removed.flavors[0].iconId, null); assert.equal(removed.flavors[0].icon, 'lime');
  const bad = fixture(); bad.flavors[0].iconId = 'fruit-lime'; expectCode(bad, 'media_role_mismatch');
  bad.flavors[0].iconId = 'missing-icon'; assert.ok(codes(validation.validateCatalog(bad)).has('reference_missing'));
  assert.deepEqual(errors(validation.validateCatalog(fixture())), [], 'A release without the optional field still loads');
});
