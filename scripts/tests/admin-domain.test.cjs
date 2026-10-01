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
  };
}
const errors = issues => issues.filter(issue => issue.severity === 'error');
const codes = issues => new Set(issues.map(issue => issue.code));
function expectCode(data, code) { assert.ok(codes(validation.preflightCatalog(data)).has(code), `Expected ${code}`); }

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
