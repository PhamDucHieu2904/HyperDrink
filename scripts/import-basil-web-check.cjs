'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Actual asset, registration and artist-edit preservation regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { ids, paths, loadWebResources, mergeBasilWeb } = require('./import-basil-web.cjs');
const { prepareCatalogRelease } = require('../lib/catalog/service.ts');
const { getMockupLibrary } = require('../lib/catalog/mockup.ts');
const { loadResources, mergeBasil } = require('./import-basil-290.cjs');

const db = new DatabaseSync('data/admin/catalog.sqlite', { readOnly: true });
const draft = JSON.parse(db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data);
const active = JSON.parse(db.prepare('SELECT r.data FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get().data);
db.close();
const resources = loadWebResources();
const beforeMigration = raw => {
  const result = structuredClone(raw);
  const media = result.media.find(item => item.id === ids.modelMedia);
  Object.assign(media, { url: paths.highModel, bytes: fs.statSync(`public${paths.highModel}`).size, sha256: resources.highSha256 });
  result.models3d.find(item => item.id === ids.model).materialSlots = structuredClone(resources.sourceHighInfo.materialSlots);
  return result;
};

test('the shipped optimized model retains the authored label contract and all 330 exact gel envelopes', () => {
  assert.equal(resources.certificate.passed, true);
  assert.equal(resources.certificate.glbSha256, resources.sha256);
  assert.equal(resources.certificate.referenceHighSha256, resources.highSha256);
  assert.equal(resources.seedMetadata.count, 330);
  assert.equal(resources.seedMetadata.gelThicknessNative, resources.certificate.seedInstances.gelThicknessNative);
  assert.equal(resources.modelInfo.layoutProfile, 'glass-290-basil-wrap-v1');
  assert.deepEqual(resources.modelInfo.materialSlots.body.sort(), ['basil-web-neck', 'basil-web-outer']);
  assert.equal(resources.modelInfo.materialSlots.inclusions, undefined, 'Seed/gel are one runtime instanced layer, not duplicate retained geometry');
  assert.deepEqual(resources.runtimeSlots.inclusions, ['basil-web-seed-gel'], 'Appearance binding names the generated hydrated seed material');
});

test('migration changes only owned model/media fields and leaves other active records byte-identical', () => {
  const input = beforeMigration(active);
  const before = JSON.stringify(input);
  const result = mergeBasilWeb(input, resources);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.changed, [{ collection: 'media', id: ids.modelMedia }, { collection: 'models3d', id: ids.model }]);
  for (const [collection, records] of Object.entries(input)) if (Array.isArray(records)) for (const record of records) {
    const current = result.data[collection].find(item => item.id === record.id);
    if (collection === 'media' && record.id === ids.modelMedia) {
      for (const [key, value] of Object.entries(record)) if (!['url', 'bytes', 'sha256', 'mime', 'revision', 'updatedAt'].includes(key)) assert.deepEqual(current[key], value);
    } else if (collection === 'models3d' && record.id === ids.model) {
      for (const [key, value] of Object.entries(record)) if (!['materialSlots', 'revision', 'updatedAt'].includes(key)) assert.deepEqual(current[key], value);
    } else assert.deepEqual(current, record, `${collection}:${record.id}`);
  }
  assert.equal(result.resolved.asset.src, paths.model);
  const library = getMockupLibrary(prepareCatalogRelease(result.data));
  assert.ok(library.displays.some(item => item.id === ids.display));
  assert.ok(library.models.some(item => item.id === ids.model));
});

test('artist names, tint, cap, label selection, orientation and private draft edits survive', () => {
  const input = beforeMigration(draft);
  const display = input.displays3d.find(item => item.id === ids.display);
  display.liquidColor = '#8c2546'; display.capColor = '#c0a332';
  const model = input.models3d.find(item => item.id === ids.model);
  model.name = 'Artist basil model'; model.orientation = [.1, .2, .3]; model.mockupFrontYaw = .75;
  const media = input.media.find(item => item.id === ids.modelMedia); media.name = 'Artist model asset';
  const variant = input.productVariants.find(item => item.id === ids.variant); variant.description = 'Artist product copy';
  const unrelated = input.flavors.find(item => item.id !== ids.flavor); unrelated.description = 'Unpublished private edit';
  const result = mergeBasilWeb(input, resources);
  for (const [collection, record] of [['displays3d', display], ['productVariants', variant], ['flavors', unrelated]]) assert.deepEqual(result.data[collection].find(item => item.id === record.id), record);
  assert.equal(result.data.models3d.find(item => item.id === model.id).name, model.name);
  assert.deepEqual(result.data.models3d.find(item => item.id === model.id).orientation, model.orientation);
  assert.equal(result.data.models3d.find(item => item.id === model.id).mockupFrontYaw, model.mockupFrontYaw);
  assert.equal(result.data.media.find(item => item.id === media.id).name, media.name);
  assert.equal(result.liquidColor, '#8c2546');
});

test('artist-replaced source or slot mappings cannot be silently overwritten', () => {
  for (const mutate of [
    input => { input.media.find(item => item.id === ids.modelMedia).url = '/models/artist-basil.glb'; },
    input => { input.models3d.find(item => item.id === ids.model).materialSlots.body.push('artist-body'); },
    input => { input.models3d.find(item => item.id === ids.model).mediaId = 'artist-model-media'; },
  ]) {
    const input = beforeMigration(draft); mutate(input);
    const before = JSON.stringify(input);
    assert.throws(() => mergeBasilWeb(input, resources), /edited|artist|ambiguous/);
    assert.equal(JSON.stringify(input), before);
  }
});

test('repeat migration is idempotent and scoped publication does not expose private drafts', () => {
  const result = mergeBasilWeb(beforeMigration(active), resources);
  assert.deepEqual(mergeBasilWeb(result.data, resources).changed, []);
  const privateDraft = beforeMigration(draft);
  const target = privateDraft.flavors.find(item => active.flavors.some(record => record.id === item.id) && item.id !== ids.flavor);
  target.description = 'Do not publish this draft';
  assert.equal(mergeBasilWeb(privateDraft, resources).data.flavors.find(item => item.id === target.id).description, target.description);
  const published = prepareCatalogRelease(result.data);
  assert.equal(published.flavors.find(item => item.id === target.id).description, active.flavors.find(item => item.id === target.id).description);
});

test('rerunning the High reference importer does not restore incompatible High slots on the web URL', async () => {
  const web = mergeBasilWeb(beforeMigration(active), resources).data;
  const repeated = mergeBasil(web, await loadResources());
  assert.deepEqual(repeated.changed, []);
  assert.deepEqual(repeated.data, web);
});
