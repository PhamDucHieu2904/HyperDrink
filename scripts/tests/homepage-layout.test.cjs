/* eslint-disable @typescript-eslint/no-require-imports -- Local TypeScript domain test. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../lib/catalog/homepage-layout.ts');
const { DEFAULT_PRODUCT_ACCENT_SCENE, normalizeAccentScene } = require('../../lib/viewer/accent-config.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { validateCatalog } = require('../../lib/catalog/validation.ts');
const { collectPublicCatalog } = require('../../lib/catalog/compatibility.ts');

test('old catalogs keep every decoration and malformed layouts are rejected', () => {
  assert.deepEqual(config.resolveHomepageLayout(), config.DEFAULT_HOMEPAGE_LAYOUT);
  for (const invalid of [null, [], {}, { ...config.DEFAULT_HOMEPAGE_LAYOUT, fruit: 'false' }, { ...config.DEFAULT_HOMEPAGE_LAYOUT, unknown: true }]) {
    assert.equal(config.isHomepageLayout(invalid), false);
    assert.ok(validateCatalog({ ...createSeedCatalog(), homepageLayout: invalid }).some(issue => issue.field === 'homepageLayout'));
  }
});
test('all 32 combinations round trip; filtering removes disabled kinds without changing source', () => {
  const scene = { ...DEFAULT_PRODUCT_ACCENT_SCENE, nodes: DEFAULT_PRODUCT_ACCENT_SCENE.nodes.map(node => ({ ...node, enabled: true })) };
  const original = structuredClone(scene);
  for (let mask = 0; mask < 32; mask++) {
    const bits = mask.toString(2).padStart(5, '0');
    const layout = config.decodeHomepageLayout(bits);
    assert.equal(config.encodeHomepageLayout(layout), bits);
    const filtered = config.filterHomepageAccents(scene, layout);
    assert.deepEqual(filtered.nodes, scene.nodes.filter(node => layout[node.kind]));
    assert.equal(filtered.enabled, filtered.nodes.length > 0);
    assert.equal(normalizeAccentScene(filtered).nodes.length, filtered.nodes.length, 'Empty lists must not restore default nodes');
  }
  assert.deepEqual(scene, original);
  for (const bad of ['', null, '000000', 'abcde', '1001']) assert.equal(config.decodeHomepageLayout(bad), undefined);
});
test('publication carries layout without pruning admin/Studio assets', () => {
  const data = createSeedCatalog();
  const layout = config.decodeHomepageLayout('00000');
  const baseline = collectPublicCatalog(data);
  const published = collectPublicCatalog({ ...data, homepageLayout: layout });
  assert.deepEqual(published.homepageLayout, layout);
  assert.deepEqual(published.media, baseline.media);
  assert.deepEqual(published.flavorAssets, baseline.flavorAssets);
  assert.notEqual(published.homepageLayout, layout);
});
