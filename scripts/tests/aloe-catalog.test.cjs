/* eslint-disable @typescript-eslint/no-require-imports -- Actual standalone catalog and read-only import integration. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ids, loadResources, mergeAloe } = require('../import-aloe-500-demo.cjs');
const { preflightCatalog, validateCatalog } = require('../../lib/catalog/validation.ts');
const { prepareCatalogRelease } = require('../../lib/catalog/service.ts');
const { resolveDisplay3D } = require('../../lib/catalog/resolve.ts');
const { getMockupLibrary, resolveMockupSelection, resolveMockupProduct } = require('../../lib/catalog/mockup.ts');
const { checkModelLabelGeometry } = require('../../lib/server/media/model-slots.ts');

const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/catalog/current.json'), 'utf8')).data.catalog;
const resources = loadResources();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = issues => issues.filter(issue => issue.severity === 'error');
const displayOf = data => data.displays3d.find(item => item.id === ids.display);

test('shipped Aloe preset is reachable in sales and Mockup alongside the existing Cojo bottle', () => {
  assert.deepEqual(errors(validateCatalog(catalog)), []);
  assert.deepEqual(errors(preflightCatalog(catalog)), []);
  const library = getMockupLibrary(catalog);
  assert.ok(library.models.some(model => model.id === 'registry-pet-320-nata'), 'Import must retain the existing 320 ml model');
  assert.ok(library.displays.some(display => display.id === 'cojo-pet320-strawberry-3d'), 'Import must retain existing Cojo presets');
  assert.ok(library.displays.some(display => display.id === ids.display));
  assert.ok(library.labels.some(label => label.id === ids.neutralLabel));
  const selection = resolveMockupSelection(catalog, { display: ids.display });
  assert.equal(selection.warning, null);
  assert.equal(selection.model.id, ids.model);
  assert.equal(selection.label.id, displayOf(catalog).labelId);
  const sales = resolveDisplay3D(catalog, displayOf(catalog));
  assert.equal(sales.asset.volumeMl, 500);
  assert.equal(sales.asset.packaging, 'pet');
  assert.deepEqual(resolveMockupProduct(catalog, selection).appearance.slots, sales.appearance.slots);
});

test('published model and both labels reference the checked asset, readable media and native wrap UV', () => {
  const model = catalog.models3d.find(item => item.id === ids.model);
  assert.equal(model.layoutProfile, resources.layoutProfile);
  assert.deepEqual(model.materialSlots, resources.modelInfo.materialSlots);
  assert.deepEqual(checkModelLabelGeometry(model, resources.modelBytes), []);
  const printedLabel = catalog.labels.find(item => item.id === displayOf(catalog).labelId);
  for (const id of [model.mediaId, model.posterId, printedLabel.mediaId, ids.neutralMedia]) {
    const media = catalog.media.find(item => item.id === id);
    assert.ok(media, `Missing public media ${id}`);
    assert.equal(media.status, 'ready');
    assert.equal(media.storageKey, '');
    const filename = path.resolve(root, 'public', `.${media.url}`);
    assert.ok(filename.startsWith(path.join(root, 'public') + path.sep));
    const bytes = fs.readFileSync(filename);
    assert.equal(bytes.length, media.bytes, id);
    assert.equal(hash(bytes), media.sha256, id);
  }
  const modelMedia = catalog.media.find(item => item.id === model.mediaId);
  assert.equal(modelMedia.sha256, resources.manifest.sha256);
  const comparison = resolveMockupSelection(catalog, { model: ids.model, label: ids.neutralLabel });
  assert.equal(comparison.warning, null);
  assert.equal(comparison.display, null);
  assert.equal(comparison.label.flavorId, null, 'Neutral comparison must retain the authored water color');
  assert.equal(resolveMockupProduct(catalog, comparison).appearance.slots.liquid, undefined);
});

test('display liquid tint stays independent from Strawberry flavor and follows it only when cleared', () => {
  const data = structuredClone(catalog);
  const display = displayOf(data);
  const variant = data.productVariants.find(item => item.id === display.productVariantId);
  const flavor = data.flavors.find(item => item.id === variant.flavorId);
  assert.match(display.liquidColor, /^#[0-9a-f]{6}$/i);
  const before = resolveDisplay3D(data, display);
  const artwork = before.appearance.slots.label;
  const storedLiquid = display.liquidColor;
  flavor.accentColor = '#4780cc';
  flavor.backgroundColor = '#172943';
  assert.equal(resolveDisplay3D(data, display).appearance.slots.liquid.color, storedLiquid);
  assert.deepEqual(resolveDisplay3D(data, display).appearance.slots.label, artwork);
  assert.equal(resolveDisplay3D(data, display).flavor.backgroundColor, '#172943');
  display.liquidColor = null;
  assert.equal(resolveDisplay3D(data, display).appearance.slots.liquid.color, '#4780cc');
  assert.deepEqual(resolveDisplay3D(data, display).appearance.slots.label, artwork);
});

test('initial Aloe merge leaves every unrelated catalog record intact and does not publish private draft work', () => {
  const data = structuredClone(catalog);
  const owned = new Set(Object.values(ids));
  for (const key of Object.keys(data)) {
    if (!Array.isArray(data[key])) continue;
    data[key] = data[key].filter(record => !owned.has(record.id) && record.id !== 'aloe-vera' && record.flavorId !== ids.flavor);
  }
  const privateFlavor = {
    id: 'private-aloe-test-draft', name: 'Private draft', slug: 'private-aloe-test-draft', lifecycle: 'active', revision: 7,
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', shortName: 'Draft',
    description: 'Unpublished work from another editor', accentColor: '#aabbcc', backgroundColor: '#ffffff',
    textColor: '#000000', icon: 'leaf', thumbnailId: null, position: 999,
  };
  data.flavors.push(privateFlavor);
  const before = structuredClone(data);
  const merged = mergeAloe(data, resources);
  assert.deepEqual(data, before, 'Import must not mutate its input');
  for (const key of Object.keys(before)) {
    if (!Array.isArray(before[key])) continue;
    for (const previous of before[key]) assert.deepEqual(merged.data[key].find(item => item.id === previous.id), previous, `${key}:${previous.id}`);
  }
  assert.ok(merged.changed.some(change => change.collection === 'displays3d' && change.id === ids.display));
  assert.deepEqual(errors(preflightCatalog(merged.data)), []);
  const publicData = prepareCatalogRelease(merged.data);
  assert.ok(!publicData.flavors.some(flavor => flavor.id === privateFlavor.id));
  assert.ok(publicData.displays3d.some(display => display.id === ids.display));
});

test('rerunning the importer preserves artist appearance/orientation edits without duplicate records', () => {
  const data = mergeAloe(catalog, resources).data;
  const model = data.models3d.find(item => item.id === ids.model);
  const display = displayOf(data);
  const label = data.labels.find(item => item.id === ids.label);
  model.orientation = [0.04, 0.16, -0.02];
  model.mockupFrontYaw = 0.17;
  display.liquidColor = '#d26e31';
  label.name = 'Artist-approved replacement';
  const before = structuredClone(data);
  const merged = mergeAloe(data, resources);
  assert.deepEqual(merged.changed, []);
  assert.deepEqual(merged.data, before);
  assert.deepEqual(data, before);
  assert.equal(merged.liquidColor, '#d26e31');
  const initializeOnly = mergeAloe(data, resources, { liquidColor: '#e84a3c' });
  assert.deepEqual(initializeOnly.changed, [], 'Initialization color must not replace artist settings');
  assert.equal(initializeOnly.liquidColor, '#d26e31');
});

test('explicit retint changes only the owned display water color and preserves artist/private draft work', () => {
  const data = mergeAloe(catalog, resources).data;
  const display = displayOf(data);
  display.liquidColor = '#e29c37';
  const model = data.models3d.find(item => item.id === ids.model);
  model.orientation = [0.02, -0.07, 0.04];
  model.mockupFrontYaw = 0.29;
  data.labels.find(item => item.id === ids.label).name = 'Artist sleeve revision';
  const privateFlavor = {
    ...structuredClone(data.flavors.find(item => item.id === ids.flavor)),
    id: 'private-retint-test-draft', slug: 'private-retint-test-draft', name: 'Private unpublished flavor',
  };
  data.flavors.push(privateFlavor);
  const before = structuredClone(data);
  assert.deepEqual(mergeAloe(data, resources).data, before, 'Default import must preserve the artist color');
  const result = mergeAloe(data, resources, { setLiquidColor: '#E84A3C' });
  assert.deepEqual(result.changed, [{ collection: 'displays3d', id: ids.display }]);
  assert.equal(result.liquidColor, '#e84a3c');
  assert.deepEqual(data, before, 'Explicit retint must not mutate its input');
  for (const key of Object.keys(before)) {
    if (!Array.isArray(before[key])) continue;
    for (const previous of before[key]) {
      const next = result.data[key].find(item => item.id === previous.id);
      if (key === 'displays3d' && previous.id === ids.display) {
        const { liquidColor, revision, updatedAt, ...unchanged } = next;
        assert.equal(liquidColor, '#e84a3c');
        assert.equal(revision, previous.revision + 1);
        assert.match(updatedAt, /^\d{4}-\d{2}-\d{2}T/);
        const { liquidColor: priorColor, revision: priorRevision, updatedAt: priorUpdate, ...priorFields } = previous;
        assert.equal(priorColor, '#e29c37'); assert.ok(priorRevision); assert.ok(priorUpdate);
        assert.deepEqual(unchanged, priorFields);
      } else assert.deepEqual(next, previous, `${key}:${previous.id}`);
    }
  }
  assert.ok(!prepareCatalogRelease(result.data).flavors.some(flavor => flavor.id === privateFlavor.id));
  assert.deepEqual(mergeAloe(result.data, resources, { setLiquidColor: '#e84a3c' }).changed, [], 'Same retint is idempotent');
  assert.throws(() => mergeAloe(data, resources, { setLiquidColor: 'red' }), /Invalid --set-liquid-color/);
});
