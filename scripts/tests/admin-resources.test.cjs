/* eslint-disable @typescript-eslint/no-require-imports -- Domain tests use the project's TS loader. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogResources, filterResources, resourceLocation, resourceConfigurationContext } = require('../../lib/catalog/resources.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { flavorPoolLibrary, mergeFlavorPoolAsset } = require('../../lib/catalog/flavor-pool-library.ts');
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
test('model and label links open their catalog modules while generic files retain resource filters', () => {
  assert.deepEqual(resourceLocation('labels'), { module: 'labels', filter: 'label' });
  assert.deepEqual(resourceLocation('models3d'), { module: 'models3d', filter: 'model' });
  assert.deepEqual(resourceLocation('icons'), { module: 'media', filter: 'icon' });
  assert.deepEqual(resourceLocation('media', 'fruit'), { module: 'media', filter: 'fruit' });
  assert.deepEqual(resourceLocation('media', 'invalid'), { module: 'media', filter: 'all' });
  assert.deepEqual(resourceLocation('displays3d'), { module: 'displays3d', filter: 'all' });
});
test('shared leaves and ice belong to every linked flavor and remain single files in filtered libraries', () => {
  const data = fixture();
  data.flavorAssets = [];
  for (const role of ['leaf', 'ice']) {
    const media = { ...data.media[0], id: `${role}-shared`, name: role === 'leaf' ? 'Lá xanh' : 'Đá viên', role, status: 'ready', mime: 'image/webp', url: `/assets/${role}.webp` };
    data.media.push(media);
    for (const flavorId of ['citrus', 'peach']) data.flavorAssets.push({ id: `${role}-${flavorId}`, flavorId, mediaId: media.id, role, lifecycle: 'active', enabled: true });
    for (const flavorId of ['citrus', 'peach']) {
      const library = flavorPoolLibrary(data, role, flavorId);
      assert.equal(library.length, 1);
      assert.deepEqual(new Set(library[0].flavorIds), new Set(['citrus', 'peach']));
      assert.equal(filterResources(catalogResources(data), role, 'active', '', flavorId).length, 1);
    }
    assert.equal(flavorPoolLibrary(data, role, 'lime').length, 0);
    assert.equal(flavorPoolLibrary(data, role, 'unassigned').length, 0);
    assert.equal(flavorPoolLibrary(data, role, 'all', role === 'leaf' ? 'la xanh' : 'da vien').length, 1);
    media.status = 'failed'; assert.equal(flavorPoolLibrary(data, role).length, 0);
  }
});
test('an ice pool response updates flavor adoption once and keeps client revisions stable on retries', () => {
  const data = fixture(), before = data.flavors.find(flavor => flavor.id === 'citrus');
  const asset = { id: 'new-ice', flavorId: before.id, mediaId: 'shared-ice', role: 'ice', updatedAt: '2026-10-06T00:00:00Z' };
  const saved = mergeFlavorPoolAsset(data, asset), retried = mergeFlavorPoolAsset(saved, asset);
  assert.deepEqual(retried, saved);
  assert.equal(saved.flavors.find(flavor => flavor.id === before.id).revision, before.revision + 1);
  assert.equal(saved.flavors.find(flavor => flavor.id === before.id).icePoolConfigured, true);
  assert.equal(data.flavorAssets.some(item => item.id === asset.id), false);
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
