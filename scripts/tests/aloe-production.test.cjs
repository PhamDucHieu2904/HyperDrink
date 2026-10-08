/* eslint-disable @typescript-eslint/no-require-imports -- Real production artwork and catalog integration. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { artwork, loadLabels, mergeProductionAloe } = require('../import-aloe-labels.cjs');
const { validateCatalog, preflightCatalog, validateRecord } = require('../../lib/catalog/validation.ts');
const { collectSalesCatalogRoots } = require('../../lib/catalog/compatibility.ts');
const { resolveDisplay3D } = require('../../lib/catalog/resolve.ts');
const { getCompatibleMockupLabels, resolveMockupSelection, resolveMockupProduct } = require('../../lib/catalog/mockup.ts');
const { prepareCatalogRelease } = require('../../lib/catalog/service.ts');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/catalog/current.json'), 'utf8')).data.catalog;
const resources = loadLabels();
const errors = issues => issues.filter(issue => issue.severity === 'error');

test('all nine real artworks are shipped byte-for-byte and compatible with the 500 ml bottle', () => {
  assert.equal(resources.length, 9);
  const labels = getCompatibleMockupLabels(catalog, 'registry-pet-500-aloe');
  for (const resource of resources) {
    const label = labels.find(item => item.id === `aloe-pet500-${resource.key}-label`);
    assert.ok(label, resource.name);
    assert.equal(label.flavorId, `aloe-${resource.key}`);
    const media = catalog.media.find(item => item.id === label.mediaId);
    assert.equal(media.sha256, createHash('sha256').update(resource.bytes).digest('hex'));
    assert.equal(media.bytes, resource.bytes.length);
    assert.equal(media.width, 1200); assert.equal(media.height, 419);
  }
  assert.ok(!labels.some(item => item.id === 'aloe-pet500-strawberry-demo-label'));
  assert.deepEqual(errors(validateCatalog(catalog)), []);
  assert.deepEqual(errors(preflightCatalog(catalog)), []);
});

test('home has exactly the five requested flavors with Original as the default', () => {
  const sales = collectSalesCatalogRoots(catalog);
  const variants = sales.variants.filter(item => item.groupId === 'aloe-vera');
  assert.deepEqual(variants.map(item => item.flavorId).sort(), ['original', 'strawberry', 'mango', 'pineapple', 'passion-fruit'].map(key => `aloe-${key}`).sort());
  assert.equal(sales.slots.find(item => item.id === 'slot-aloe-pet500').defaultVariantId, 'aloe-pet500-original');
  assert.equal(sales.displays3d.filter(item => item.modelId === 'registry-pet-500-aloe').length, 5);
});

test('nine draft profiles resolve; four remain disabled and later merges do not duplicate records', () => {
  const before = structuredClone(catalog);
  const first = mergeProductionAloe(catalog, resources);
  assert.deepEqual(catalog, before);
  for (const profile of artwork) {
    const display = first.data.displays3d.find(item => item.id === `aloe-pet500-${profile.key}-3d`);
    assert.equal(display.enabled, profile.enabled);
    const variant = first.data.productVariants.find(item => item.id === display.productVariantId);
    assert.equal(variant.enabled, profile.enabled);
    const product = resolveDisplay3D(first.data, display);
    assert.equal(product.asset.volumeMl, 500);
    assert.equal(product.appearance.slots.liquid.color, profile.liquidColor);
    assert.equal(product.appearance.slots.cap?.color ?? null, profile.capColor ?? null);
  }
  assert.deepEqual(mergeProductionAloe(first.data, resources).changed, []);
  assert.deepEqual(errors(preflightCatalog(first.data)), []);
  const published = prepareCatalogRelease(first.data);
  assert.equal(published.displays3d.filter(item => item.modelId === 'registry-pet-500-aloe').length, 5);
});

test('Original green cap and liquid are shared by home, Studio preset and free label pairing', () => {
  const display = catalog.displays3d.find(item => item.id === 'aloe-pet500-original-3d');
  const sales = resolveDisplay3D(catalog, display);
  const studio = resolveMockupProduct(catalog, resolveMockupSelection(catalog, { display: display.id }));
  const label = resolveMockupProduct(catalog, resolveMockupSelection(catalog, { model: display.modelId, label: display.labelId }));
  assert.equal(sales.appearance.slots.cap.color, '#008b28');
  assert.equal(sales.appearance.slots.liquid.color, '#119d25');
  assert.deepEqual(studio.appearance.slots, sales.appearance.slots);
  assert.deepEqual(label.appearance.slots, sales.appearance.slots);
  const strawberry = resolveDisplay3D(catalog, catalog.displays3d.find(item => item.id === 'aloe-pet500-strawberry-3d'));
  assert.equal(strawberry.appearance.slots.cap, undefined, 'Other flavors keep their default cap');
  assert.notEqual(strawberry.appearance.id, sales.appearance.id);
});

test('cap overrides are validated independently and never injected into models without a cap slot', () => {
  const display = catalog.displays3d.find(item => item.id === 'aloe-pet500-original-3d');
  for (const mode of ['draft', 'publish']) {
    for (const capColor of [null, undefined, '#008b28', '#AABBCC']) assert.deepEqual(validateRecord('displays3d', { ...display, capColor }, { mode }), []);
    for (const capColor of ['', '#abc', '#12345678', 'green', 10, {}, '#008b28\n']) assert.ok(validateRecord('displays3d', { ...display, capColor }, { mode }).some(issue => issue.field === 'capColor'));
  }
  const data = structuredClone(catalog);
  delete data.models3d.find(item => item.id === display.modelId).materialSlots.cap;
  assert.equal(resolveDisplay3D(data, display).appearance.slots.cap, undefined);
});

test('scoped production merge preserves unrelated records and unpublished work', () => {
  const data = structuredClone(catalog);
  const privateFlavor = { ...data.flavors[0], id: 'private-production-test', slug: 'private-production-test', name: 'Private draft' };
  data.flavors.push(privateFlavor);
  const before = structuredClone(data);
  const result = mergeProductionAloe(data, resources);
  const changes = new Set(result.changed.map(item => `${item.collection}:${item.id}`));
  for (const [key, records] of Object.entries(before)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) if (!changes.has(`${key}:${record.id}`)) assert.deepEqual(result.data[key].find(item => item.id === record.id), record, `${key}:${record.id}`);
  }
  assert.deepEqual(result.data.flavors.find(item => item.id === privateFlavor.id), privateFlavor);
  assert.ok(!prepareCatalogRelease(result.data).flavors.some(item => item.id === privateFlavor.id));
});
