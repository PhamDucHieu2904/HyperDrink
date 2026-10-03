/* eslint-disable @typescript-eslint/no-require-imports -- Tests exercise the actual validation-to-editor routing. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { issueRemedy } = require('../../lib/catalog/issue-remedies.ts');
const { checkDisplay3DCompatibility } = require('../../lib/catalog/compatibility.ts');

function fixture() {
  const data = createSeedCatalog();
  const model = data.models3d.find(item => item.packagingVariantId === 'can-320');
  const variant = { ...data.productGroups[0], id: 'boba-lychee', groupId: data.productGroups[0].id, packagingVariantId: 'can-320', flavorId: data.flavors[0].id, enabled: true };
  data.productVariants.push(variant);
  data.packagingSlots.push({ ...variant, id: 'boba-slot', mode: '3d', enabled: true });
  const issue = { collection: 'productVariants', entityId: variant.id, field: 'enabled', code: 'display_unavailable', severity: 'error', message: 'Missing display' };
  return { data, model, variant, issue };
}

test('a missing 3D display opens a new form for the existing product, without changing data', () => {
  const { data, variant, issue } = fixture();
  const before = structuredClone(data);
  const target = issueRemedy(data, issue);
  assert.equal(target.kind, 'display'); assert.equal(target.mode, '3d');
  assert.equal(target.variantId, variant.id); assert.equal(target.displayId, ''); assert.equal(target.field, 'modelId');
  assert.deepEqual(data, before);
});

test('a disabled display is edited instead of starting a duplicate', () => {
  const { data, variant, issue } = fixture();
  data.displays3d.push({ ...variant, id: 'existing-3d', productVariantId: variant.id, enabled: false });
  const target = issueRemedy(data, issue);
  assert.equal(target.displayId, 'existing-3d'); assert.equal(target.field, 'enabled');
});

test('2D slots and auto slots with a disabled 2D configuration open the matching 2D form', () => {
  const { data, variant, issue } = fixture();
  data.packagingSlots.at(-1).mode = '2d';
  let target = issueRemedy(data, issue);
  assert.equal(target.mode, '2d'); assert.equal(target.field, 'assetId');
  data.packagingSlots.at(-1).mode = 'auto';
  data.displays2d.push({ ...variant, id: 'existing-2d', productVariantId: variant.id, enabled: false });
  target = issueRemedy(data, issue);
  assert.equal(target.mode, '2d'); assert.equal(target.displayId, 'existing-2d');
});

test('model and display poster findings both open the model poster field', () => {
  const { data, model, variant } = fixture();
  const display = { ...variant, id: 'peach-display', productVariantId: variant.id, modelId: model.id, labelId: null, enabled: true };
  data.displays3d.push(display);
  const sourceIssues = checkDisplay3DCompatibility(data, display);
  const posterIssue = sourceIssues.find(issue => issue.field === 'modelId.posterId');
  assert.ok(posterIssue); assert.match(posterIssue.message, /ảnh poster/);
  const fromDisplay = issueRemedy(data, posterIssue);
  const fromModel = issueRemedy(data, { ...posterIssue, collection: 'models3d', entityId: model.id, field: 'posterId' });
  assert.deepEqual(fromDisplay, fromModel);
  assert.equal(fromDisplay.recordId, model.id); assert.equal(fromDisplay.field, 'posterId');
});

test('findings from an older API also route a missing poster to its actual field', () => {
  const { data, model, variant } = fixture();
  data.displays3d.push({ ...variant, id: 'legacy-display', productVariantId: variant.id, modelId: model.id });
  const target = issueRemedy(data, { collection: 'displays3d', entityId: 'legacy-display', field: 'modelId', code: 'media_missing', message: 'Missing media' });
  assert.equal(target.collection, 'models3d'); assert.equal(target.field, 'posterId');
});

test('generic record findings target the actual field and stale records have no action', () => {
  const { data, variant, issue } = fixture();
  assert.equal(issueRemedy(data, { ...issue, code: 'invalid_value', field: 'code' }).field, 'code');
  assert.equal(issueRemedy(data, { ...issue, code: 'invalid_value', field: undefined }).field, '');
  assert.equal(issueRemedy(data, { ...issue, entityId: 'gone' }), null);
  assert.equal(issueRemedy(data, { ...issue, entityId: '' }), null);
  data.packagingSlots = [];
  assert.equal(issueRemedy(data, issue), null);
  assert.equal(data.productVariants.at(-1).id, variant.id);
});
