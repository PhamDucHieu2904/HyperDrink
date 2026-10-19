/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the shared nutrition form definitions. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { nutritionTemplates, rowsForNutritionTemplate } = require('../../lib/catalog/nutrition-templates.ts');
const { validateRecord } = require('../../lib/catalog/validation.ts');

test('every nutrition template creates a stable set of editable rows', () => {
  for (const template of nutritionTemplates) {
    const rows = rowsForNutritionTemplate(template.id, []);
    assert.equal(rows.length, template.rows.length);
    assert.deepEqual(rows.map(row => row.label), template.rows);
    assert.ok(rows.every(row => row.amount === '' && row.dailyValue === ''));
  }
});

test('switching to the two-column US template preserves matching values', () => {
  const rows = rowsForNutritionTemplate('us-container', [{ label: 'Total carbohydrate', amount: '58 g', dailyValue: '21%', secondaryAmount: '174 g', secondaryDailyValue: '58%' }]);
  assert.deepEqual(rows[6], { label: 'Total Carbohydrate', amount: '58 g', dailyValue: '21%', secondaryAmount: '174 g', secondaryDailyValue: '58%' });
});

test('a selected template contains only its predefined form rows', () => {
  const rows = rowsForNutritionTemplate('basic', [
    { label: 'Calories / Calories (kcal)', amount: '40', dailyValue: '' },
    { label: 'Potassium', amount: '60 mg', dailyValue: '' },
    { label: 'Vitamin D', amount: '0 mcg', dailyValue: '' },
  ]);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map(row => row.label), [
    'Calories / Calories (kcal)',
    'Total Fat / Lipides totaux (g)',
    'Saturated Fat / Gras saturés (g)',
    'Trans Fat / Gras trans (g)',
    'Cholesterol / Cholestérol (mg)',
    'Sodium / Sodium (mg)',
    'Total Carbohydrates / Glucides totaux (g)',
    'Total Sugar / Sucres totaux (g)',
    'Protein / Protéines (g)',
  ]);
  assert.equal(rows[0].amount, '40');
});

test('legacy nutrition rows remain valid and secondary values are type checked', () => {
  const now = '2026-10-19T00:00:00.000Z';
  const record = { id: 'detail-1', name: 'Detail', slug: 'detail', lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now, labelId: 'label-1', posterId: null, eyebrow: '', headline: '', subtitle: '', introduction: '', ingredients: '', allergens: '', servingSize: '', nutrition: [{ label: 'Calories', amount: '40', dailyValue: '' }], companyName: '', companyAddress: '', countryOfOrigin: '', netContent: '', storage: '', shelfLife: '', sections: [], enabled: true };
  assert.deepEqual(validateRecord('productDetails', record), []);
  assert.ok(validateRecord('productDetails', { ...record, nutritionTemplate: 'us-container', nutrition: [{ ...record.nutrition[0], secondaryAmount: 40 }] }).some(issue => issue.field === 'nutrition.0'));
});
