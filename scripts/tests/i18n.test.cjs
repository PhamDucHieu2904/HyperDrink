/* eslint-disable @typescript-eslint/no-require-imports -- Node-only TypeScript source harness. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

function load(file) {
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  const sourceRequire = specifier => {
    const resolved = path.resolve(path.dirname(file), specifier);
    return load(specifier.endsWith('.json') ? resolved : `${resolved}.ts`);
  };
  new Function('require', 'module', 'exports', output)(sourceRequire, loaded, loaded.exports);
  return loaded.exports;
}
const catalog = load(path.resolve(__dirname, '../../lib/i18n/catalog.ts'));
const tokens = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const productCopy = load(path.resolve(__dirname, '../../lib/i18n/product-copy.ts'));
const { products, packagingFilters } = load(path.resolve(__dirname, '../../lib/products.ts'));

test('all nine languages are available, default to English and restore only supported preferences', () => {
  assert.deepEqual(catalog.languages.map(item => item.code), ['en', 'fr', 'zh', 'es', 'ar', 'ru', 'ko', 'de', 'vi']);
  assert.equal(catalog.DEFAULT_LOCALE, 'en');
  for (const invalid of [null, undefined, '', 'xx', '<script>', {}]) assert.equal(catalog.resolveLocale(invalid), 'en');
  for (const { code } of catalog.languages) assert.equal(catalog.resolveLocale(code), code);
});

test('every published language covers all storefront messages and retains interpolation placeholders', () => {
  const baseline = catalog.dictionaries.en;
  for (const { code } of catalog.languages) {
    const dictionary = catalog.dictionaries[code];
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(baseline).sort(), `${code}: untranslated or extra keys`);
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `${code}.${key}: empty message`);
      assert.deepEqual(tokens(value), tokens(baseline[key]), `${code}.${key}: lost placeholder`);
    }
  }
});

test('language search finds English, native and Vietnamese names, ignores accents, and treats locale codes exactly', () => {
  for (const [query, expected] of [['French', 'fr'], ['francais', 'fr'], ['  fr  ', 'fr'], ['中文', 'zh'], ['tiếng Trung', 'zh'],
    ['Tay Ban Nha', 'es'], ['Español', 'es'], ['a rap', 'ar'], ['العربية', 'ar'], ['Русский', 'ru'], ['한국어', 'ko'], ['tiếng Đức', 'de'],
    ['vi', 'vi'], ['Vietnamese', 'vi'], ['Tiếng Việt', 'vi'], ['tieng viet', 'vi'], ['viet nam', 'vi']]) {
    assert.deepEqual(catalog.findLanguages(query).map(item => item.code), [expected], query);
  }
  assert.equal(catalog.findLanguages('').length, 9);
  assert.equal(catalog.findLanguages('not-a-language').length, 0);
});

test('Why choose us has complete curated copy for every selected language, including accessible labels', () => {
  const { whyChooseCopy } = load(path.resolve(__dirname, '../../lib/i18n/why-choose.ts'));
  const english = whyChooseCopy('en');
  assert.equal(english.kicker, 'WHY CHOOSE US');
  assert.equal(whyChooseCopy('vi').kicker, 'TẠI SAO CHỌN CHÚNG TÔI');
  for (const { code } of catalog.languages) {
    const copy = whyChooseCopy(code);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort(), code);
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(value.trim(), `${code}.${key}: missing company copy`);
    }
    if (code !== 'en') {
      for (const key of ['kicker', 'intro', 'factoryBody', 'naturalBody', 'countriesLabel']) {
        assert.notEqual(copy[key], english[key], `${code}.${key}: English copy remains`);
      }
    }
    assert.ok(copy.countriesLabel.includes('200'), code);
    assert.ok(copy.certificationsLabel, code);
  }
});

test('favorites controls and empty state have complete copy in all supported languages', () => {
  const { favoritesCopy } = load(path.resolve(__dirname, '../../lib/i18n/favorites.ts'));
  const english = favoritesCopy('en');
  for (const { code } of catalog.languages) {
    const copy = favoritesCopy(code);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort(), code);
    for (const text of Object.values(copy)) assert.ok(text.trim(), code);
    if (code !== 'en') assert.notEqual(copy.emptyBody, english.emptyBody, code);
  }
});

test('Arabic switches reading direction while other languages remain LTR, and translated values interpolate safely as text', () => {
  for (const { code } of catalog.languages) {
    assert.equal(catalog.localeDirection(code), code === 'ar' ? 'rtl' : 'ltr');
    const t = catalog.createTranslator(code);
    assert.ok(t('viewer.canName', { volume: 330 }).includes('330'));
    assert.ok(t('collection.count', { count: 8 }).includes('8'));
    assert.ok(t('hero.exploreFlavor', { flavor: '<b>Lime</b>' }).includes('<b>Lime</b>'));
    assert.ok(!t('language.current', { language: 'English' }).includes('{language}'));
  }
});

test('catalog copy translates by stable IDs and preserves source copy for new products', () => {
  for (const { code } of catalog.languages) {
    const t = catalog.createTranslator(code);
    for (const product of products) {
      assert.ok(catalog.dictionaries[code][`product.${product.id}.ingredients`]);
      assert.equal(productCopy.productIngredients(product, t), catalog.dictionaries[code][`product.${product.id}.ingredients`]);
      assert.ok(productCopy.productCategory(product, t));
      assert.ok(t(productCopy.productPackagingMessages[product.packaging]));
    }
    for (const filter of packagingFilters) assert.ok(t(productCopy.packagingFilterMessages[filter]));
  }
  assert.equal(productCopy.productIngredients({ id: 'future-drink', flavor: 'Apple · Pear' }, catalog.createTranslator('fr')), 'Apple · Pear');
});
