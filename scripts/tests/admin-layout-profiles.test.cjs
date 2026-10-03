/* eslint-disable @typescript-eslint/no-require-imports -- Tests run the shipped domain helpers. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultLayoutProfile, completeLabelLayouts, packagingLayoutChoices } = require('../../lib/catalog/layout-profiles.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');

test('choosing a registered can packaging completes a label without typing a UV code', () => {
  const data = createSeedCatalog();
  const pack = data.packagingVariants.find(item => item.id === 'can-330');
  const rows = [{ packagingVariantId: pack.id, layoutProfile: '' }];
  assert.equal(defaultLayoutProfile(data, pack.id), 'can-wrap-v1');
  assert.deepEqual(completeLabelLayouts(data, rows), [{ packagingVariantId: pack.id, layoutProfile: 'can-wrap-v1' }]);
  assert.equal(rows[0].layoutProfile, '', 'The input is not mutated');
});

test('a custom layout already saved on artwork survives editing', () => {
  const data = createSeedCatalog();
  assert.equal(completeLabelLayouts(data, [{ packagingVariantId: 'can-330', layoutProfile: 'custom-wrap-v2' }])[0].layoutProfile, 'custom-wrap-v2');
});

test('multiple different model layouts need an explicit choice, never arbitrary auto matching', () => {
  const data = createSeedCatalog();
  const model = data.models3d.find(item => item.packagingVariantId === 'can-330');
  data.models3d.push({ ...model, id: 'custom-can', name: 'Custom can', layoutProfile: 'custom-wrap-v2' });
  assert.equal(packagingLayoutChoices(data, 'can-330').length, 2);
  assert.equal(defaultLayoutProfile(data, 'can-330'), '');
  assert.equal(completeLabelLayouts(data, [{ packagingVariantId: 'can-330', layoutProfile: '' }])[0].layoutProfile, '');
  data.models3d[data.models3d.length - 1].lifecycle = 'archived';
  assert.equal(defaultLayoutProfile(data, 'can-330'), 'can-wrap-v1');
});

test('a second model with the same layout does not add an unnecessary choice', () => {
  const data = createSeedCatalog();
  const model = data.models3d.find(item => item.packagingVariantId === 'can-330');
  data.models3d.push({ ...model, id: 'same-layout-model' });
  assert.equal(packagingLayoutChoices(data, 'can-330').length, 1);
  assert.equal(defaultLayoutProfile(data, 'can-330'), model.layoutProfile);
});

test('new packaging receives a stable convention without claiming to inspect GLB UVs', () => {
  const data = createSeedCatalog();
  data.packagingVariants.push({ ...data.packagingVariants[0], id: 'custom-glass', slug: 'custom-glass', categoryId: data.packagingCategories.find(item => item.viewerKind === 'glass').id });
  assert.equal(defaultLayoutProfile(data, 'custom-glass'), 'custom-glass-wrap-v1');
  assert.equal(defaultLayoutProfile(data, ''), '');
  assert.equal(defaultLayoutProfile(data, 'missing'), '');
});
