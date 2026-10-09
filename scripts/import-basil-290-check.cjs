'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local import integrity and preservation checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { loadResources, mergeBasil, ids, paths } = require('./import-basil-290.cjs');
const { prepareCatalogRelease } = require('../lib/catalog/service.ts');
const { resolveDisplay3D } = require('../lib/catalog/resolve.ts');
const { getMockupLibrary } = require('../lib/catalog/mockup.ts');

const db = new DatabaseSync('data/admin/catalog.sqlite', { readOnly: true });
const draft = JSON.parse(db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data);
const active = JSON.parse(db.prepare('SELECT r.data FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get().data);
db.close();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const resources = loadResources();

test('checks the High GLB, unchanged source and solid blank sleeve without catalog writes', async () => {
  const result = await resources;
  assert.equal(result.manifest.sha256, sha256(result.modelBytes));
  assert.equal(result.manifest.triangleCount, result.modelInfo.triangleCount);
  assert.equal(result.manifest.sourceUnchanged, true);
  assert.equal(result.certificate.passed, true);
  assert.equal(result.certificate.glbSha256, result.manifest.sha256);
  assert.equal(result.manifest.sourceSha256, sha256(fs.readFileSync(result.manifest.source)));
  assert.equal(result.liquidColor, '#be2838');
  const label = result.media.find(item => item.id === ids.labelMedia);
  assert.deepEqual([label.width, label.height], [16, 16]);
  assert.equal(label.url, paths.blank);
  assert.equal(result.layoutProfile, 'glass-290-basil-wrap-v1');
  assert.deepEqual([...result.modelInfo.materialSlots.inclusions].sort(), ['basil-gel', 'basil-seeds']);
});

test('registers glass 290 ml with the neutral sleeve and independent reference tint', async () => {
  const result = mergeBasil(active, await resources);
  const display = result.data.displays3d.find(item => item.id === ids.display);
  const resolved = resolveDisplay3D(result.data, display);
  assert.equal(resolved.asset.volumeMl, 290);
  assert.equal(resolved.asset.packaging, 'glass');
  assert.equal(resolved.appearance.slots.liquid.color, '#be2838');
  assert.equal(display.labelId, ids.label);
  assert.equal(display.capColor, undefined);
  const library = getMockupLibrary(prepareCatalogRelease(result.data));
  assert.ok(library.displays.some(item => item.id === ids.display));
  assert.ok(library.labels.some(item => item.id === ids.label));
});

test('a second merge is idempotent and does not mutate its input', async () => {
  const input = structuredClone(draft);
  const before = JSON.stringify(input);
  const initial = mergeBasil(input, await resources);
  assert.equal(JSON.stringify(input), before);
  const repeated = mergeBasil(initial.data, await resources);
  assert.deepEqual(repeated.changed, []);
  assert.deepEqual(repeated.data, initial.data);
});

test('reimport retains artist display, model, sleeve and private draft edits', async () => {
  const initial = mergeBasil(draft, await resources).data;
  const display = initial.displays3d.find(item => item.id === ids.display);
  display.liquidColor = '#803154'; display.capColor = '#d0b132'; display.enabled = false;
  const model = initial.models3d.find(item => item.id === ids.model);
  model.orientation = [0.1, 0.2, 0.3]; model.mockupFrontYaw = 0.7; model.mockupVisible = false;
  const sleeve = initial.labels.find(item => item.id === ids.label);
  sleeve.name = 'Artist edited sleeve';
  const unrelated = initial.flavors.find(item => item.id !== ids.flavor);
  unrelated.description = 'Private draft edit retained';
  const repeated = mergeBasil(initial, await resources);
  assert.deepEqual(repeated.changed, []);
  for (const [collection, record] of [['displays3d', display], ['models3d', model], ['labels', sleeve], ['flavors', unrelated]]) {
    assert.deepEqual(repeated.data[collection].find(item => item.id === record.id), record);
  }
});

test('an explicit tint update touches only this display and remains idempotent', async () => {
  const loaded = await resources;
  const initial = mergeBasil(draft, loaded).data;
  const result = mergeBasil(initial, loaded, { setLiquidColor: '#962534' });
  assert.deepEqual(result.changed, [{ collection: 'displays3d', id: ids.display }]);
  assert.equal(result.liquidColor, '#962534');
  assert.deepEqual(mergeBasil(result.data, loaded, { setLiquidColor: '#962534' }).changed, []);
  assert.throws(() => mergeBasil(initial, loaded, { setLiquidColor: 'red' }), /Invalid set-liquid-color/);
});

test('active release merge does not publish unrelated draft changes', async () => {
  const draftCopy = structuredClone(draft);
  const target = draftCopy.flavors.find(item => active.flavors.some(record => record.id === item.id));
  target.description = 'Private Basil task sentinel';
  const mergedDraft = mergeBasil(draftCopy, await resources);
  assert.equal(mergedDraft.data.flavors.find(item => item.id === target.id).description, 'Private Basil task sentinel');
  const published = prepareCatalogRelease(mergeBasil(active, await resources).data);
  assert.equal(published.flavors.find(item => item.id === target.id).description, active.flavors.find(item => item.id === target.id).description);
});
