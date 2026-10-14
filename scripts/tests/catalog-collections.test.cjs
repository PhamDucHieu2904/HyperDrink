'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Test the shipped domain without a build step. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { collectionProducts, collectionSections, filterCollectionProducts } = require('../../lib/catalog/collection.ts');
const { catalogProducts } = require('../../lib/catalog/storefront.ts');
const { collectPublicCatalog } = require('../../lib/catalog/compatibility.ts');
const { updateCatalogRecord, prepareCatalogRelease, getUsageReferences } = require('../../lib/catalog/service.ts');
const { preflightCatalog, validateCatalog } = require('../../lib/catalog/validation.ts');
const { deleteCatalogRecord } = require('../../lib/catalog/deletion.ts');

const entity = (id, name = id) => ({ id, name, slug: id, lifecycle: 'active', revision: 1, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' });
function fixture() {
  const data = createSeedCatalog();
  for (const media of data.media.filter(item => item.mime.startsWith('image/'))) Object.assign(media, { bytes: 100, sha256: 'a'.repeat(64), width: 1024, height: 1024 });
  const baseImage = data.media.find(item => item.mime.startsWith('image/'));
  data.media.push({ ...baseImage, ...entity('catalog-image'), role: 'image-2d' }, { ...baseImage, ...entity('catalog-artwork'), role: 'label' });
  data.labels.push({ ...entity('catalog-label'), drinkTypeId: 'juice', flavorId: data.flavors[0].id, mediaId: 'catalog-artwork', compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] });
  data.productDetails.push({ ...entity('catalog-detail'), labelId: 'catalog-label', posterId: null, eyebrow: '', headline: 'Citrus', subtitle: '', introduction: 'Editorial story', ingredients: '', allergens: '', servingSize: '', nutrition: [], companyName: '', companyAddress: '', countryOfOrigin: '', netContent: '330 ml', storage: '', shelfLife: '', sections: [], enabled: true });
  data.catalogCollections.push({ ...entity('summer-juice', 'Summer Juice'), drinkTypeId: 'juice', homeVisible: true, enabled: true, position: 0 });
  data.catalogItems.push({ ...entity('catalog-citrus', 'Citrus'), collectionId: 'summer-juice', mediaId: 'catalog-image', productDetailId: 'catalog-detail', packagingVariantId: 'can-330', enabled: true, position: 0 });
  return data;
}
function fixtureWith3d() {
  const data = fixture();
  const model = data.models3d.find(item => item.packagingVariantId === 'can-330');
  const image = data.media.find(item => item.id === 'catalog-image');
  data.media.push({ ...image, ...entity('model-poster'), role: 'poster' });
  model.posterId = 'model-poster';
  data.productGroups[0].visible = true;
  data.productVariants.push({ ...entity('sales-citrus'), groupId: data.productGroups[0].id, packagingVariantId: 'can-330', flavorId: data.labels[0].flavorId, code: '', description: '', enabled: true });
  data.packagingSlots.push({ ...entity('sales-can'), groupId: data.productGroups[0].id, packagingVariantId: 'can-330', regionKey: 'packaging-picker', buttonLabel: '330 ml', mode: 'auto', defaultVariantId: 'sales-citrus', enabled: true, position: 0 });
  data.displays3d.push({ ...entity('catalog-3d'), productVariantId: 'sales-citrus', modelId: model.id, labelId: 'catalog-label', liquidColor: '#abcdef', capColor: '#123456', labelOffset: 12, enabled: true });
  return data;
}
const errors = data => preflightCatalog(data).filter(issue => issue.severity === 'error');

test('a 2D collection publishes with no hero slots, products or geometry', () => {
  const data = fixture();
  data.models3d = []; data.productVariants = []; data.packagingSlots = []; data.displays3d = [];
  assert.deepEqual(errors(data), []);
  const release = prepareCatalogRelease(data);
  assert.equal(release.catalogItems.length, 1);
  assert.equal(release.productDetails[0].introduction, 'Editorial story');
  assert.equal(release.models3d.length, 0);
  assert.equal(catalogProducts(release).length, 0);
  const products = collectionProducts(release);
  assert.equal(products[0].image2d.id, 'catalog-image');
  assert.equal(products[0].productDetail.id, 'catalog-detail');
  assert.equal(products[0].display3d, undefined);
});
test('homepage visibility does not remove a collection from the catalog, and disabling it removes owned items from the release', () => {
  const data = fixture();
  const changed = updateCatalogRecord(data, 'catalogCollections', { ...data.catalogCollections[0], homeVisible: false }, 1);
  assert.equal(data.catalogCollections[0].homeVisible, true);
  assert.equal(changed.catalogCollections[0].revision, 2);
  const release = prepareCatalogRelease(changed);
  assert.equal(collectionSections(release).length, 0);
  assert.equal(collectionProducts(release).length, 1);
  changed.catalogCollections[0].enabled = false;
  assert.equal(collectPublicCatalog(changed).catalogItems.length, 0);
  assert.equal(collectionProducts(changed).length, 0);
});
test('unready images, disabled or archived details, foreign drinks and incompatible packaging block publication', () => {
  const changes = [data => data.media.find(item => item.id === 'catalog-image').status = 'processing', data => data.media.find(item => item.id === 'catalog-image').role = 'fruit', data => data.productDetails[0].enabled = false, data => data.productDetails[0].lifecycle = 'archived', data => data.catalogCollections[0].drinkTypeId = 'coffee', data => data.catalogItems[0].packagingVariantId = 'can-320', data => data.catalogItems[0].mediaId = null, data => data.catalogItems[0].productDetailId = null];
  for (const change of changes) { const data = fixture(); change(data); assert.ok(errors(data).length > 0); }
});
test('collection deletion cascades its items and keeps shared images, labels and details', () => {
  const data = fixture();
  assert.ok(getUsageReferences(data, 'productDetails', 'catalog-detail').some(item => item.collection === 'catalogItems'));
  const deleted = deleteCatalogRecord(data, 'catalogCollections', 'summer-juice', 1);
  assert.equal(deleted.catalogCollections.length, 0); assert.equal(deleted.catalogItems.length, 0);
  assert.equal(deleted.productDetails.length, 1); assert.equal(deleted.labels.length, 1);
  assert.ok(deleted.media.some(item => item.id === 'catalog-image'));
  assert.equal(collectionProducts(deleted).length, 0);
  const imageRemoved = deleteCatalogRecord(data, 'media', 'catalog-image', 1);
  assert.equal(imageRemoved.catalogItems[0].mediaId, null);
  assert.deepEqual(validateCatalog(imageRemoved).filter(issue => issue.severity === 'error'), []);
  assert.ok(errors(imageRemoved).length > 0);
});
test('ordering and original-language search use editorial collection and item names', () => {
  const data = fixture(); data.catalogItems.push({ ...data.catalogItems[0], ...entity('catalog-lime', 'Lime'), position: 1 }); data.catalogItems[0].name = 'Bright Citrus';
  data.catalogItems[0].position = 2;
  const products = collectionProducts(data);
  assert.deepEqual(products.map(item => item.variant.name), ['Lime', 'Bright Citrus']);
  const translated = structuredClone(products); translated[1].variant.name = 'Agrume'; translated[1].group.name = 'Jus'; translated[1].group.collectionTitle = 'Jus';
  assert.equal(filterCollectionProducts(translated, 'Summer Bright', data)[0].variant.id, 'catalog-citrus');
});

test('editorial details offer only the exact compatible published sales 3D while keeping their 2D identity', () => {
  const data = fixtureWith3d();
  const product = collectionProducts(data)[0];
  assert.equal(product.variant.id, 'catalog-citrus');
  assert.equal(product.slot.mode, '2d');
  assert.equal(product.display3d.productVariantId, 'sales-citrus');
  assert.equal(product.display3d.labelId, product.label.id);
  assert.equal(product.model.packagingVariantId, product.packaging.id);
  assert.equal(product.image2d.id, 'catalog-image');
  assert.equal(collectionProducts(collectPublicCatalog(data))[0].display3d.id, 'catalog-3d');
});

test('missing, disabled, archived, foreign or unready 3D never removes the editorial 2D product', () => {
  const changes = [
    data => data.displays3d = [],
    data => data.displays3d[0].enabled = false,
    data => data.displays3d[0].lifecycle = 'archived',
    data => data.displays3d[0].labelId = 'another-label',
    data => data.productVariants[0].enabled = false,
    data => data.productVariants[0].lifecycle = 'archived',
    data => data.productVariants[0].packagingVariantId = 'can-320',
    data => data.productVariants[0].flavorId = data.flavors[1].id,
    data => data.productGroups[0].lifecycle = 'archived',
    data => data.packagingSlots[0].mode = '2d',
    data => data.packagingSlots[0].enabled = false,
    data => data.packagingSlots[0].lifecycle = 'archived',
    data => data.models3d.find(model => model.id === data.displays3d[0].modelId).lifecycle = 'archived',
    data => data.models3d.find(model => model.id === data.displays3d[0].modelId).layoutProfile = 'foreign-layout',
    data => data.media.find(media => media.id === data.models3d.find(model => model.id === data.displays3d[0].modelId).mediaId).status = 'processing',
    data => data.media.find(media => media.id === 'catalog-artwork').status = 'failed',
    data => data.media.find(media => media.id === 'model-poster').lifecycle = 'archived',
  ];
  for (const change of changes) {
    const data = fixtureWith3d(); change(data);
    const products = collectionProducts(data);
    assert.equal(products.length, 1);
    assert.equal(products[0].image2d.id, 'catalog-image');
    assert.equal(products[0].display3d, undefined);
    assert.equal(products[0].model, undefined);
  }
});
