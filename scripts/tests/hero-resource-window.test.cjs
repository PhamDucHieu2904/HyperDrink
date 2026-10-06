/* eslint-disable @typescript-eslint/no-require-imports -- Test the production TypeScript window without a browser. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHeroResourceWindow } = require('../../lib/viewer/hero-resource-window.ts');

const key = entry => entry.id;
const entries = count => Array.from({ length: count }, (_, id) => ({ id: String(id) }));
const ids = list => list.map(key);

test('hero windows prioritize the selected flavor then nearest neighbors in both directions', () => {
  const window = createHeroResourceWindow(entries(30), 14, key);
  assert.deepEqual(ids(window.ready), ['14', '15', '13', '16', '12']);
  assert.deepEqual(ids(window.files), ['14', '15', '13', '16', '12', '17', '11', '18', '10', '19', '9', '20', '8', '21', '7', '22', '6', '23', '5', '24', '4']);
  assert.equal(window.ready.length, 5);
  assert.equal(window.files.length, 21);
});

test('the carousel wrap has no repeated entries even when there are fewer than five flavors', () => {
  const window = createHeroResourceWindow(entries(4), 0, key);
  assert.deepEqual(ids(window.ready), ['0', '1', '3', '2']);
  assert.deepEqual(ids(window.files), ['0', '1', '3', '2']);
  const last = createHeroResourceWindow(entries(30), 29, key);
  assert.deepEqual(ids(last.ready), ['29', '0', '28', '1', '27']);
});

test('missing 3D displays keep their carousel position and duplicate displays are requested once', () => {
  const values = entries(30);
  values[15] = null;
  values[13] = values[14];
  values[16] = undefined;
  const window = createHeroResourceWindow(values, 14, key);
  assert.deepEqual(ids(window.ready), ['14', '12']);
  assert.equal(window.files.length, 18);
  assert.ok(!ids(window.ready).includes('17'), 'Do not expand the ready radius to replace an unavailable neighbor');
  assert.ok(window.ready.every(entry => window.files.includes(entry)));
});

test('empty and invalid selection windows request nothing, while a sole flavor is requested once', () => {
  assert.deepEqual(createHeroResourceWindow([], 0, key), { ready: [], files: [] });
  for (const selected of [-1, 1, 0.5, NaN]) assert.deepEqual(createHeroResourceWindow(entries(1), selected, key), { ready: [], files: [] });
  const only = entries(1);
  assert.deepEqual(createHeroResourceWindow(only, 0, key), { ready: only, files: only });
});
