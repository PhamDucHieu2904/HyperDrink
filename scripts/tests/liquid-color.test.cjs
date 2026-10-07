/* eslint-disable @typescript-eslint/no-require-imports -- Run the actual catalog modules. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecord } = require('../../lib/catalog/validation.ts');
const { saveDisplayDraft } = require('../../lib/catalog/display-drafts.ts');
const { prepareCatalogRelease } = require('../../lib/catalog/service.ts');
const { parsePublishedCatalog } = require('../../lib/catalog/storefront.ts');
const { resolveDisplay3D } = require('../../lib/catalog/resolve.ts');
const { resolveMockupProduct, resolveMockupSelection } = require('../../lib/catalog/mockup.ts');
const now = '2026-10-07T04:00:00.000Z';
const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now });
const media = (id, role) => ({ ...entity(id), role, status: 'ready', url: `/assets/${id}.webp`, storageKey: '', mime: 'image/webp', bytes: 1024, sha256: 'a'.repeat(64), width: 128, height: 128, imageBounds: null, error: '' });
function fixture() {
  return {
    schemaVersion: 1,
    drinkTypes: [{ ...entity('nata'), description: '', position: 0 }],
    packagingCategories: [{ ...entity('pet'), viewerKind: 'pet', position: 0 }],
    packagingVariants: [{ ...entity('pet-320'), categoryId: 'pet', volumeMl: 320, shape: 'bottle', position: 0 }],
    flavors: [{ ...entity('mango'), shortName: 'Mango', description: '', accentColor: '#ffc440', backgroundColor: '#447722', textColor: '#ffffff', icon: 'leaf', thumbnailId: 'thumb', position: 0 }],
    flavorAssets: [],
    productGroups: [{ ...entity('nata-group'), drinkTypeId: 'nata', description: '', buttonLabel: 'Nata De Coco', position: 0, visible: true }],
    productVariants: [{ ...entity('mango-product'), groupId: 'nata-group', packagingVariantId: 'pet-320', flavorId: 'mango', code: '', description: '', enabled: true }],
    packagingSlots: [{ ...entity('slot'), groupId: 'nata-group', packagingVariantId: 'pet-320', regionKey: 'packaging-picker', position: 0, buttonLabel: '320 ml', mode: '3d', defaultVariantId: 'mango-product', enabled: true }],
    media: [{ ...media('model-media', 'model'), url: '/models/bottle.glb', mime: 'model/gltf-binary', width: null, height: null }, media('poster', 'poster'), media('artwork', 'label'), media('thumb', 'thumbnail')],
    models3d: [{ ...entity('model'), packagingVariantId: 'pet-320', mediaId: 'model-media', posterId: 'poster', layoutProfile: 'pet-wrap-v1', materialSlots: { body: ['pet-shell'], liquid: ['nata-liquid'], inclusions: ['nata-jelly'], cap: ['pet-cap'], label: ['printed-label'] }, orientation: [0, 0, 0] }],
    labels: [{ ...entity('label'), drinkTypeId: 'nata', flavorId: 'mango', mediaId: 'artwork', compatibilities: [{ packagingVariantId: 'pet-320', layoutProfile: 'pet-wrap-v1' }] }],
    assets2d: [], displays3d: [{ ...entity('display'), productVariantId: 'mango-product', modelId: 'model', labelId: 'label', enabled: true }], displays2d: [], productDetails: [], catalogCollections: [], catalogItems: [],
  };
}

test('legacy/default colors are accepted and malformed overrides fail draft and publication validation', () => {
  const display = fixture().displays3d[0];
  for (const mode of ['draft', 'publish']) {
    for (const liquidColor of [undefined, null, '#ffc440', '#AABBCC']) assert.deepEqual(validateRecord('displays3d', { ...display, liquidColor }, { mode }), []);
    for (const liquidColor of ['', '#abc', '#12345678', 'orange', 12, {}, '#ffcc00\n']) assert.ok(validateRecord('displays3d', { ...display, liquidColor }, { mode }).some(issue => issue.field === 'liquidColor'));
  }
});

test('PET resolver follows flavor, overrides only liquid and gives changed colors distinct appearances', () => {
  const data = fixture(), display = data.displays3d[0];
  const inherited = resolveDisplay3D(data, display);
  assert.deepEqual(inherited.asset.textureSamplers.label, { wrapS: 'repeat', wrapT: 'clamp' });
  assert.deepEqual(inherited.appearance.requiredSlots, ['label']);
  assert.deepEqual(inherited.appearance.slots.liquid, { color: '#ffc440' });
  assert.equal(inherited.appearance.slots.body, undefined);
  assert.equal(inherited.appearance.slots.inclusions, undefined);
  display.liquidColor = '#ffaa33';
  const overridden = resolveDisplay3D(data, display);
  assert.deepEqual(overridden.appearance.slots.liquid, { color: '#ffaa33' });
  assert.notEqual(inherited.appearance.id, overridden.appearance.id);
  assert.deepEqual(inherited.appearance.slots.label, overridden.appearance.slots.label);
  assert.equal(data.flavors[0].backgroundColor, '#447722');
  display.liquidColor = null; data.flavors[0].accentColor = '#8899aa';
  const changedFlavor = resolveDisplay3D(data, display);
  assert.equal(changedFlavor.appearance.slots.liquid.color, '#8899aa');
  assert.notEqual(changedFlavor.appearance.id, inherited.appearance.id);
  delete data.models3d[0].materialSlots.liquid;
  display.liquidColor = '#ffaa33';
  assert.equal(resolveDisplay3D(data, display).appearance.slots.liquid, undefined, 'Can/other models retain their existing material behavior');
  display.labelId = null;
  assert.equal(resolveDisplay3D(data, display), null, 'A sales display still requires its approved label');
});

test('Studio uses exact display override or free label flavor and leaves bare imported material intact', () => {
  const data = fixture(); data.displays3d[0].liquidColor = '#ffaa33';
  const sales = resolveDisplay3D(data, data.displays3d[0]);
  const studio = resolveMockupProduct(data, resolveMockupSelection(data, { model: 'model', label: 'label' }));
  assert.deepEqual(studio.appearance.slots, sales.appearance.slots);
  data.flavors.push({ ...data.flavors[0], ...entity('lychee'), accentColor: '#eedddd', position: 1 });
  data.labels.push({ ...data.labels[0], ...entity('lychee-label'), flavorId: 'lychee', mockupVisible: true });
  const free = resolveMockupProduct(data, resolveMockupSelection(data, { model: 'model', label: 'lychee-label' }));
  assert.deepEqual(free.appearance.slots.liquid, { color: '#eedddd' });
  const bare = resolveMockupProduct(data, resolveMockupSelection(data, { model: 'model' }));
  assert.deepEqual(bare.appearance.slots, {});
  data.labels[0].flavorId = null;
  data.productVariants.push({ ...data.productVariants[0], ...entity('lychee-product'), flavorId: 'lychee' });
  data.displays3d.push({ ...data.displays3d[0], ...entity('lychee-display'), productVariantId: 'lychee-product', liquidColor: '#ddccbb' });
  const sharedLabelPreset = resolveMockupProduct(data, resolveMockupSelection(data, { display: 'lychee-display' }));
  assert.deepEqual(sharedLabelPreset.appearance.slots.liquid, { color: '#ddccbb' }, 'An explicitly selected flavor retains its own tint when labels are shared');
});

test('atomic draft save and immutable release retain independent water color and can reset inheritance', () => {
  const original = fixture(), before = JSON.stringify(original);
  const input = liquidColor => ({ mode: '3d', variant: original.productVariants[0], expectedVariantRevision: 1, display: { ...original.displays3d[0], liquidColor }, expectedDisplayRevision: 1, slot: null, expectedSlotRevision: null });
  assert.throws(() => saveDisplayDraft(original, input('invalid'), now), error => error.code === 'draft_invalid');
  assert.equal(JSON.stringify(original), before);
  const saved = saveDisplayDraft(original, input('#ffaa33'), now);
  assert.equal(saved.display.liquidColor, '#ffaa33');
  const released = prepareCatalogRelease(saved.catalog);
  const publicData = parsePublishedCatalog({ data: { schemaVersion: 1, releaseId: 'pet-release', publishedAt: now, catalog: released } }, 'static');
  assert.equal(publicData.catalog.displays3d[0].liquidColor, '#ffaa33');
  assert.equal(resolveDisplay3D(publicData.catalog, publicData.catalog.displays3d[0]).appearance.slots.liquid.color, '#ffaa33');
  const reset = saveDisplayDraft(saved.catalog, { ...input(null), variant: saved.catalog.productVariants[0], expectedVariantRevision: 2, display: { ...saved.display, liquidColor: null }, expectedDisplayRevision: 2 }, now);
  assert.equal(resolveDisplay3D(reset.catalog, reset.display).appearance.slots.liquid.color, '#ffc440');
  assert.equal(released.displays3d[0].liquidColor, '#ffaa33', 'Published payload is immutable when a draft resets');
});
