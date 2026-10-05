/* eslint-disable @typescript-eslint/no-require-imports -- Domain tests use the project's TS loader. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogResources, filterResources, resourceLocation, resourceConfigurationContext } = require('../../lib/catalog/resources.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
function fixture() {
  const data = createSeedCatalog();
  const base = { lifecycle: 'active', revision: 1, slug: 'resource' };
  data.media = [
    { ...base, id: 'label-file', name: 'Label artwork', role: 'label' },
    { ...base, id: 'model-file', name: 'Can GLB', role: 'model' },
    { ...base, id: 'fruit-file', name: 'Orange cutout', role: 'fruit' },
  ];
  data.labels = [{ ...base, id: 'label', name: 'Orange label', mediaId: 'label-file' }];
  data.models3d = [{ ...base, id: 'model', name: 'Can model', mediaId: 'model-file' }];
  data.assets2d = [];
  return data;
}

test('a shared file appears once with all of its editable label configurations', () => {
  const data = fixture();
  const label = data.labels[0];
  data.labels.push({ ...label, id: 'reused-label', name: 'Nhãn tái sử dụng' });
  const snapshot = JSON.stringify(data);
  const rows = catalogResources(data);
  const row = rows.find(item => item.media?.id === label.mediaId);
  assert.equal(rows.filter(item => item.media?.id === label.mediaId).length, 1);
  assert.ok(row.configurations.some(item => item.record.id === 'reused-label'));
  assert.ok(row.configurations.some(item => item.record.id === label.id));
  assert.equal(JSON.stringify(data), snapshot);
});
test('incomplete and wrongly linked configurations remain discoverable by resource type', () => {
  const data = fixture();
  data.models3d[0].mediaId = 'missing-file';
  data.labels[0].mediaId = data.media.find(item => item.role === 'fruit').id;
  const rows = catalogResources(data);
  assert.ok(filterResources(rows, 'model', 'active', '').some(item => item.configurations.some(config => config.record.id === data.models3d[0].id)));
  assert.ok(filterResources(rows, 'label', 'active', '').some(item => item.configurations.some(config => config.record.id === data.labels[0].id)));
});
test('type, lifecycle and accent-insensitive configuration searches combine correctly', () => {
  const data = fixture();
  data.labels[0].name = 'Nhãn cam dùng chung';
  const rows = catalogResources(data);
  const labels = filterResources(rows, 'label', 'active', 'nhan cam');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].role, 'label');
  assert.equal(filterResources(rows, 'fruit', 'active', 'nhan cam').length, 0);
  labels[0].media.lifecycle = 'archived';
  assert.equal(filterResources(rows, 'label', 'active', 'nhan cam').length, 0);
  assert.equal(filterResources(rows, 'label', 'archived', 'nhan cam').length, 1);
});
test('legacy library links point to the corresponding filter in the unified resource workspace', () => {
  assert.deepEqual(resourceLocation('labels'), { module: 'media', filter: 'label' });
  assert.deepEqual(resourceLocation('models3d'), { module: 'media', filter: 'model' });
  assert.deepEqual(resourceLocation('icons'), { module: 'media', filter: 'icon' });
  assert.deepEqual(resourceLocation('media', 'fruit'), { module: 'media', filter: 'fruit' });
  assert.deepEqual(resourceLocation('media', 'invalid'), { module: 'media', filter: 'all' });
  assert.deepEqual(resourceLocation('displays3d'), { module: 'displays3d', filter: 'all' });
});
test('adding another configuration for an already used file generates a free slug, including archived drafts', () => {
  const data = fixture(), media = data.media[0];
  data.labels.push({ id: 'second-label', lifecycle: 'archived', slug: 'resource-2' });
  const context = resourceConfigurationContext(data, 'labels', media);
  assert.equal(context.mediaId, media.id);
  assert.equal(context.slug, 'resource-3');
  assert.equal(context.name, 'Label artwork · 3');
  assert.equal(data.labels.length, 2);
});
