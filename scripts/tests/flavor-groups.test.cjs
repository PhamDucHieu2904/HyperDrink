/* eslint-disable @typescript-eslint/no-require-imports -- Run catalog logic with the shared test loader. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');
const { flavorDrinkTypeGroups, flavorMatchesDrinkType, UNCLASSIFIED_FLAVORS } = require('../../lib/catalog/flavor-groups.ts');

function fixture() {
  const data = createSeedCatalog();
  data.drinkTypes = [{ id: 'juice', name: 'Juice', position: 2 }, { id: 'nata', name: 'Nata De Coco', position: 1 }, { id: 'boba', name: 'Boba', position: 3 }];
  data.flavors = [{ id: 'juice-mango', name: 'Mango', lifecycle: 'active' }, { id: 'nata-mango', name: 'Mango', lifecycle: 'active' }, { id: 'shared', name: 'Shared', lifecycle: 'active' }, { id: 'orphan', name: 'Boba Mango', lifecycle: 'active' }, { id: 'old', name: 'Old', lifecycle: 'archived' }];
  data.labels = [{ flavorId: 'juice-mango', drinkTypeId: 'juice' }, { flavorId: 'nata-mango', drinkTypeId: 'nata' }, { flavorId: 'shared', drinkTypeId: 'juice' }, { flavorId: 'shared', drinkTypeId: 'juice' }];
  data.productGroups = [{ id: 'boba-group', drinkTypeId: 'boba' }];
  data.productVariants = [{ flavorId: 'shared', groupId: 'boba-group', enabled: false }];
  data.assets2d = [{ flavorId: 'old', drinkTypeId: 'nata', lifecycle: 'archived' }];
  return data;
}

test('same-name flavors stay in their own drink families; shared flavors match each linked family once', () => {
  const { groups, memberships, total } = flavorDrinkTypeGroups(fixture(), 'active');
  assert.deepEqual(groups.map(group => [group.id, group.count]), [['nata', 1], ['juice', 2], ['boba', 1], [UNCLASSIFIED_FLAVORS, 1]]);
  assert.equal(total, 4);
  assert.equal(flavorMatchesDrinkType(memberships, 'juice-mango', 'nata'), false);
  assert.equal(flavorMatchesDrinkType(memberships, 'nata-mango', 'nata'), true);
  assert.equal(flavorMatchesDrinkType(memberships, 'shared', 'boba'), true);
  assert.equal(flavorMatchesDrinkType(memberships, 'shared', 'juice'), true);
  assert.equal(flavorMatchesDrinkType(memberships, 'shared', UNCLASSIFIED_FLAVORS), false);
});

test('unlinked flavors and broken references remain discoverable without guessing from names', () => {
  const data = fixture();
  data.labels.push({ flavorId: 'orphan', drinkTypeId: 'deleted-type' }, { flavorId: null, drinkTypeId: 'juice' }, { flavorId: 'deleted-flavor', drinkTypeId: 'juice' });
  data.productVariants.push({ flavorId: 'orphan', groupId: 'deleted-group' });
  const { memberships } = flavorDrinkTypeGroups(data, 'active');
  assert.equal(flavorMatchesDrinkType(memberships, 'orphan', UNCLASSIFIED_FLAVORS), true);
  assert.equal(flavorMatchesDrinkType(memberships, 'orphan', 'boba'), false);
  assert.equal(flavorMatchesDrinkType(memberships, 'orphan', ''), true);
});

test('archived and all-state counts retain classification; disabled draft links remain usable', () => {
  const data = fixture();
  data.labels[0].lifecycle = 'archived';
  const archived = flavorDrinkTypeGroups(data, 'archived');
  assert.equal(archived.total, 1);
  assert.equal(archived.groups.find(group => group.id === 'nata').count, 1);
  assert.equal(flavorDrinkTypeGroups(data, 'all').total, 5);
  assert.equal(flavorDrinkTypeGroups(data, 'active').groups.find(group => group.id === 'juice').count, 2);
});

test('new drink types and changed label assignments update grouping without mutating catalog records', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  flavorDrinkTypeGroups(data, 'active');
  assert.equal(JSON.stringify(data), before);
  data.drinkTypes.push({ id: 'coffee', name: 'Coffee', position: 0 });
  data.labels[0].drinkTypeId = 'coffee';
  const next = flavorDrinkTypeGroups(data, 'active');
  assert.equal(next.groups[0].id, 'coffee');
  assert.equal(flavorMatchesDrinkType(next.memberships, 'juice-mango', 'juice'), false);
  assert.equal(flavorMatchesDrinkType(next.memberships, 'juice-mango', 'coffee'), true);
});
