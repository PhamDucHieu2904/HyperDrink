/* eslint-disable @typescript-eslint/no-require-imports -- Checked production artwork integration. */
require('../register-admin-typescript.cjs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const assert = require('node:assert/strict');
const { artwork, loadLabels, mergeProductionBasil } = require('../import-basil-labels.cjs');
const { prepareCatalogRelease } = require('../../lib/catalog/service.ts');
const { validateCatalog, preflightCatalog } = require('../../lib/catalog/validation.ts');
const { resolveDisplay3D } = require('../../lib/catalog/resolve.ts');
const { getCompatibleMockupLabels } = require('../../lib/catalog/mockup.ts');
const root = path.resolve(__dirname, '../..');
const db = new DatabaseSync(path.join(root, 'data/admin/catalog.sqlite'), { readOnly: true });
const draft = JSON.parse(db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data);
const active = JSON.parse(db.prepare('SELECT r.data FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get().data);
db.close();
const resources = loadLabels('D:/Vinut-TK/Downloads/resized-images (33)');
const merged = mergeProductionBasil(draft, resources);
const errors = issues => issues.filter(issue => issue.severity === 'error');

test('all ten printed artworks retain source bytes and the 290 ml UV compatibility', () => {
  assert.equal(resources.length, 10);
  assert.equal(new Set(artwork.map(item => item.number)).size, 10);
  const labels = getCompatibleMockupLabels(merged.data, 'registry-glass-290-basil');
  for (const resource of resources) {
    const label = labels.find(item => item.id === `basil-glass290-${resource.key}-label`);
    assert.ok(label, resource.name);
    assert.equal(label.flavorId, `basil-${resource.key}`);
    assert.deepEqual(label.compatibilities, [{ packagingVariantId: 'glass-290-basil', layoutProfile: 'glass-290-basil-wrap-v1' }]);
    const media = merged.data.media.find(item => item.id === label.mediaId);
    assert.equal(media.sha256, createHash('sha256').update(resource.bytes).digest('hex'));
    assert.equal(media.width, 1000); assert.equal(media.height, 660);
  }
  assert.ok(!labels.some(item => item.id === 'basil-glass290-unprinted-label'));
});

test('ten draft profiles resolve; home includes precisely the five requested flavors', () => {
  for (const profile of artwork) {
    const display = merged.data.displays3d.find(item => item.id === `basil-glass290-${profile.key}-3d`);
    const variant = merged.data.productVariants.find(item => item.id === display.productVariantId);
    assert.equal(display.enabled, profile.enabled); assert.equal(variant.enabled, profile.enabled);
    const product = resolveDisplay3D(merged.data, display);
    assert.equal(product.asset.volumeMl, 290);
    assert.equal(product.appearance.slots.liquid.color, display.liquidColor);
  }
  const released = prepareCatalogRelease(merged.data);
  assert.deepEqual(released.displays3d.filter(item => item.modelId === 'registry-glass-290-basil').map(item => item.productVariantId).sort(), ['strawberry', 'mango', 'passion-fruit', 'red-grape', 'blueberry'].map(key => `basil-glass290-${key}`).sort());
  assert.equal(released.packagingSlots.find(item => item.id === 'slot-basil-glass290').defaultVariantId, 'basil-glass290-red-grape');
  assert.deepEqual(errors(validateCatalog(merged.data)), []);
  assert.deepEqual(errors(preflightCatalog(released)), []);
});

test('imports are idempotent and preserve unrelated data and private draft changes', () => {
  assert.deepEqual(mergeProductionBasil(merged.data, resources).changed, []);
  const before = structuredClone(draft);
  mergeProductionBasil(draft, resources);
  assert.deepEqual(draft, before, 'Input must not be mutated');
  const changes = new Set(merged.changed.map(item => `${item.collection}:${item.id}`));
  for (const [collection, records] of Object.entries(before)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) if (!changes.has(`${collection}:${record.id}`)) assert.deepEqual(merged.data[collection].find(item => item.id === record.id), record);
  }
  const separate = mergeProductionBasil(active, resources);
  assert.deepEqual(separate.data.models3d, active.models3d, 'Active model artist settings remain independent of draft');
});

test('artist label offset, material finishes, water color and pool switches survive reimport', () => {
  const customized = structuredClone(merged.data);
  const display = customized.displays3d.find(item => item.id === 'basil-glass290-red-grape-3d');
  Object.assign(display, { liquidColor: '#ab1234', capColor: '#dd9900', labelOffset: 0.12 });
  const asset = customized.flavorAssets.find(item => item.flavorId === 'basil-red-grape');
  if (asset) asset.enabled = false;
  const result = mergeProductionBasil(customized, resources);
  assert.deepEqual(result.data.displays3d.find(item => item.id === display.id), display);
  assert.deepEqual(result.data.models3d, customized.models3d);
  assert.deepEqual(result.data.flavorAssets, customized.flavorAssets);
  assert.ok(!result.data.flavorAssets.some(item => item.flavorId === 'basil-blueberry' && item.role === 'fruit'), 'Do not present mixed berries as blueberry');
});

test('replaced model checksum refuses the import before modifying data', () => {
  const replaced = structuredClone(draft);
  replaced.media.find(item => item.id === 'model-glass-290-basil').sha256 = '0'.repeat(64);
  assert.throws(() => mergeProductionBasil(replaced, resources), /does not match/);
});
