/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the actual catalog filtering code. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { buildProductDetailFilterIndex, productDetailMatchesFilters, productDetailFilterOptions, EMPTY_PRODUCT_DETAIL_FILTERS } = require('../../lib/catalog/product-detail-filters.ts');

function fixture() {
  const data = createSeedCatalog();
  data.drinkTypes = [{ id: 'juice', name: 'Juice', position: 0 }, { id: 'boba', name: 'Boba', position: 1 }];
  data.flavors = [{ id: 'mango', name: 'Mango' }, { id: 'lychee', name: 'Lychee' }];
  data.packagingVariants = [{ id: 'can330', name: 'Alu can 330 ml' }, { id: 'pet320', name: 'PET 320 ml' }];
  data.labels = [
    { id: 'juice-mango', drinkTypeId: 'juice', flavorId: 'mango', compatibilities: [{ packagingVariantId: 'can330' }, { packagingVariantId: 'pet320' }, { packagingVariantId: 'can330' }] },
    { id: 'boba-mango', drinkTypeId: 'boba', flavorId: 'mango', compatibilities: [{ packagingVariantId: 'pet320' }] },
    { id: 'juice-lychee', drinkTypeId: 'juice', flavorId: 'lychee', compatibilities: [{ packagingVariantId: 'can330' }] },
  ];
  data.productDetails = [
    { id: 'a', labelId: 'juice-mango', lifecycle: 'active', enabled: true },
    { id: 'b', labelId: 'boba-mango', lifecycle: 'active', enabled: false },
    { id: 'c', labelId: 'juice-lychee', lifecycle: 'active', enabled: true },
    { id: 'd', labelId: 'juice-lychee', lifecycle: 'archived', enabled: true },
  ];
  return data;
}

test('a shared flavor is classified by each detail label; combined filters cannot leak another drink type', () => {
  const data = fixture(), index = buildProductDetailFilterIndex(data);
  const filter = { drinkTypeId: 'juice', flavorId: 'mango', packagingVariantId: 'pet320' };
  assert.deepEqual(data.productDetails.filter(detail => productDetailMatchesFilters(index, detail.id, filter)).map(detail => detail.id), ['a']);
  assert.equal(productDetailMatchesFilters(index, 'b', { ...filter, drinkTypeId: 'boba' }), true);
  assert.equal(productDetailMatchesFilters(index, 'b', { ...filter, packagingVariantId: 'can330', drinkTypeId: 'boba' }), false);
});

test('all compatible formats are searchable and duplicate compatibility rows do not inflate counts', () => {
  const data = fixture(), index = buildProductDetailFilterIndex(data);
  const options = productDetailFilterOptions(data, index, EMPTY_PRODUCT_DETAIL_FILTERS, 'active');
  assert.deepEqual(options.packaging.map(item => [item.id, item.count]), [['can330', 2], ['pet320', 2]]);
  assert.equal(options.flavors.find(item => item.id === 'mango').count, 2);
});

test('dependent flavor/packaging choices narrow correctly while all drink types remain reachable', () => {
  const data = fixture(), index = buildProductDetailFilterIndex(data);
  const options = productDetailFilterOptions(data, index, { drinkTypeId: 'boba', flavorId: 'mango', packagingVariantId: '' }, 'active');
  assert.deepEqual(options.flavors.map(item => item.id), ['mango']);
  assert.deepEqual(options.packaging.map(item => item.id), ['pet320']);
  assert.deepEqual(options.drinkTypes.map(item => item.id), ['juice', 'boba']);
});

test('archived and disabled details remain accessible and zero-count selections can be cleared', () => {
  const data = fixture(), index = buildProductDetailFilterIndex(data);
  const filter = { drinkTypeId: 'boba', flavorId: 'mango', packagingVariantId: 'pet320' };
  const options = productDetailFilterOptions(data, index, filter, 'archived');
  assert.equal(options.drinkTypes.find(item => item.id === 'boba').count, 0);
  assert.equal(options.flavors.find(item => item.id === 'mango').count, 0);
  assert.equal(productDetailFilterOptions(data, index, EMPTY_PRODUCT_DETAIL_FILTERS, 'all').flavors.find(item => item.id === 'lychee').count, 2);
});

test('missing label or packaging references do not crash or hide the detail from the unfiltered list', () => {
  const data = fixture();
  data.productDetails.push({ id: 'orphan', labelId: 'deleted-label', lifecycle: 'active' });
  data.labels[0].compatibilities.push({ packagingVariantId: 'deleted-packaging' });
  const original = JSON.stringify(data), index = buildProductDetailFilterIndex(data);
  assert.equal(productDetailMatchesFilters(index, 'orphan', EMPTY_PRODUCT_DETAIL_FILTERS), true);
  assert.equal(productDetailMatchesFilters(index, 'orphan', { ...EMPTY_PRODUCT_DETAIL_FILTERS, drinkTypeId: 'juice' }), false);
  assert.equal(index.get('a').packagingIds.has('deleted-packaging'), false);
  assert.equal(JSON.stringify(data), original);
});

test('packaging option names distinguish format and volume without repeating the category', () => {
  const data = fixture();
  data.packagingCategories = [{ id: 'can', name: 'Alu can' }, { id: 'pet', name: 'PET' }];
  data.packagingVariants[0] = { id: 'can330', name: '330 ml', categoryId: 'can' };
  data.packagingVariants[1] = { id: 'pet320', name: 'PET 320 ml', categoryId: 'pet' };
  const options = productDetailFilterOptions(data, buildProductDetailFilterIndex(data), EMPTY_PRODUCT_DETAIL_FILTERS, 'active');
  assert.deepEqual(options.packaging.map(item => item.name), ['Alu can · 330 ml', 'PET 320 ml']);
});
