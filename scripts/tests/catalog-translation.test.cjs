/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the real browser translation adapter with native API fixtures. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserCatalogTranslator } = require('../../lib/i18n/browser-translator.ts');
const { catalogTexts, localizeCatalog, catalogTextParts } = require('../../lib/i18n/dynamic-catalog.ts');
const { translationStatus } = require('../../lib/i18n/translation-status.ts');
const { createSeedCatalog } = require('../../lib/catalog/seed.ts');

function fixture() {
  const data = createSeedCatalog();
  for (const key of Object.keys(data)) if (Array.isArray(data[key])) data[key] = [];
  data.flavors = [{ id: 'orange', name: 'Orange', shortName: 'Orange', description: 'Cam mọng nước · VINUT 330 ml', thumbnailId: 'photo', backgroundColor: '#fff', accentColor: '#ff0', textColor: '#111' }];
  data.productGroups = [{ id: 'juice', name: 'Juice 30%', buttonLabel: 'Juice 30%', description: 'Fresh juice' }];
  data.productVariants = [{ id: 'can', name: 'Juice 30% · Orange · 330 ml', groupId: 'juice', flavorId: 'orange', code: 'JUICE-330', description: 'Fresh juice' }];
  data.media = [{ id: 'photo', name: 'Private filename.png', role: 'fruit', url: '/fruit.webp' }];
  data.labels = [{ id: 'label', name: 'Internal layout', mediaId: 'photo', compatibilities: [] }];
  return data;
}
function nativeEnvironment(options = {}) {
  const calls = [], created = [], storage = new Map();
  const environment = {
    navigator: { userActivation: { isActive: options.active ?? true } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Translator: {
      availability: async () => options.availability ?? 'available',
      create: async pair => {
        created.push(pair);
        if (options.failCreate) throw options.failCreate;
        pair.monitor?.({ addEventListener: (type, listener) => listener({ loaded: .5 }) });
        return { destroy() {}, translate: async text => { calls.push({ ...pair, text }); if (options.failText === text) throw new Error('Native translation failed'); return options.translate ? options.translate(text, pair) : `${pair.targetLanguage}:${text}`; } };
      },
    },
  };
  return { environment, calls, created, storage };
}
async function run(engine, data, locale = 'ar', signal = new AbortController().signal) {
  let translated = new Map();
  await engine.translate(data, locale, signal, value => { translated = value; });
  return localizeCatalog(data, translated);
}

test('catalog translation deduplicates text, excludes internal assets and preserves quantities and brand', () => {
  const data = fixture();
  const texts = catalogTexts(data);
  assert.equal(texts.filter(text => text === 'Orange').length, 1);
  assert.ok(texts.includes('Cam mọng nước'));
  assert.ok(!texts.includes('Private filename.png'));
  assert.ok(!texts.includes('Internal layout'));
  assert.ok(!texts.some(text => /VINUT|330 ml|30%/.test(text)));
  assert.equal(catalogTextParts('VINUT · 330 ml · 30% · Juice').join(''), 'VINUT · 330 ml · 30% · Juice');
});

test('Mockup name translation is explicit, covers its library, and preserves IDs and the source release', async () => {
  const data = fixture();
  data.models3d = [{ id: 'model', name: 'Slim can', mediaId: 'model-media', packagingVariantId: 'slim' }];
  data.displays3d = [{ id: 'display', name: 'Orange preset', modelId: 'model', labelId: 'label' }];
  const source = JSON.stringify(data);
  assert.ok(!catalogTexts(data).includes('Slim can'));
  assert.ok(!catalogTexts(data).includes('Orange preset'));
  const options = { mockupNames: true }, texts = catalogTexts(data, options);
  for (const text of ['Slim can', 'Orange preset', 'Internal layout']) assert.ok(texts.includes(text));
  let translations = new Map();
  const native = nativeEnvironment();
  await new BrowserCatalogTranslator(() => native.environment).translate(data, 'fr', new AbortController().signal, value => { translations = value; }, options);
  const localized = localizeCatalog(data, translations, options);
  assert.equal(localized.models3d[0].name, 'fr:Slim can');
  assert.equal(localized.labels[0].name, 'fr:Internal layout');
  assert.equal(localized.displays3d[0].name, 'fr:Orange preset');
  assert.equal(localized.models3d[0].id, 'model');
  assert.equal(localized.labels[0].mediaId, 'photo');
  assert.equal(localized.displays3d[0].modelId, 'model');
  assert.equal(JSON.stringify(data), source);
  assert.strictEqual(localizeCatalog(data, translations).labels, data.labels);
});

test('admin hero messages join catalog translation without changing packaging or source data', () => {
  const data = fixture();
  Object.assign(data.productGroups[0], { heroVolumeCaption: 'Net content', heroFlavorText: 'Many flavor choices', heroOriginText: 'Real fruit from Vietnam' });
  const source = JSON.stringify(data), texts = catalogTexts(data);
  for (const value of ['Net content', 'Many flavor choices', 'Real fruit from Vietnam']) assert.ok(texts.includes(value));
  const translated = localizeCatalog(data, new Map([['Net content', '净含量'], ['Many flavor choices', '丰富的口味选择'], ['Real fruit from Vietnam', '越南水果']]));
  assert.equal(translated.productGroups[0].heroVolumeCaption, '净含量');
  assert.equal(translated.productGroups[0].heroFlavorText, '丰富的口味选择');
  assert.equal(translated.productGroups[0].heroOriginText, '越南水果');
  assert.equal(translated.productGroups[0].id, 'juice');
  assert.equal(JSON.stringify(data), source);
});

test('admin collection headings join the automatic translation without changing visibility or ordering', () => {
  const data = fixture();
  Object.assign(data.productGroups[0], { collectionTitle: 'Summer fruits', collectionVisible: true, collectionPosition: 3 });
  assert.ok(catalogTexts(data).includes('Summer fruits'));
  const translated = localizeCatalog(data, new Map([['Summer fruits', 'Fruits d’été']]));
  assert.equal(translated.productGroups[0].collectionTitle, 'Fruits d’été');
  assert.equal(translated.productGroups[0].collectionVisible, true);
  assert.equal(translated.productGroups[0].collectionPosition, 3);
  assert.equal(data.productGroups[0].collectionTitle, 'Summer fruits');
});

test('product detail translates prose and nutrient names without changing quantities or label references', () => {
  const data = fixture(); data.productDetails = [{ id: 'detail', labelId: 'label', posterId: 'photo', headline: 'Orange', ingredients: 'Water', servingSize: 'Per 100 ml', nutrition: [{ label: 'Total sugar', amount: '9.0 g', dailyValue: '3%' }], sections: [{ title: 'Enjoyment', body: 'Serve chilled' }] }];
  const source = JSON.stringify(data), texts = catalogTexts(data);
  assert.ok(texts.includes('Total sugar')); assert.ok(texts.includes('Serve chilled')); assert.ok(!texts.includes('9.0 g'));
  const translated = localizeCatalog(data, new Map([['Total sugar', '糖'], ['Water', '水'], ['Enjoyment', '饮用建议'], ['Serve chilled', '冷藏后饮用']]));
  assert.equal(translated.productDetails[0].ingredients, '水');
  assert.deepEqual(translated.productDetails[0].nutrition[0], { label: '糖', amount: '9.0 g', dailyValue: '3%' });
  assert.deepEqual(translated.productDetails[0].sections[0], { title: '饮用建议', body: '冷藏后饮用' });
  assert.equal(translated.productDetails[0].labelId, 'label'); assert.equal(translated.productDetails[0].posterId, 'photo');
  assert.equal(JSON.stringify(data), source);
});
test('automatic data translation changes all public fields but never rewrites the source catalog or identities', async () => {
  const data = fixture(), source = JSON.stringify(data);
  const native = nativeEnvironment();
  const engine = new BrowserCatalogTranslator(() => native.environment);
  const translated = await run(engine, data);
  assert.equal(translated.flavors[0].name, 'ar:Orange');
  assert.equal(translated.productVariants[0].name, 'ar:Juice 30% · ar:Orange · 330 ml');
  assert.match(translated.flavors[0].description, /VINUT 330 ml/);
  assert.equal(translated.productVariants[0].code, 'JUICE-330');
  assert.equal(translated.productVariants[0].flavorId, 'orange');
  assert.strictEqual(translated.media, data.media);
  assert.strictEqual(translated.labels, data.labels);
  assert.equal(JSON.stringify(data), source);
  assert.equal(native.calls.filter(call => call.text === 'Orange').length, 1);
  assert.equal(native.calls.find(call => call.text === 'Cam mọng nước').sourceLanguage, 'vi');
  assert.equal(engine.status, 'ready');
});
test('cached translations work on repeat visits without a native API and changed source text is not served an old translation', async () => {
  const data = fixture(), native = nativeEnvironment();
  const engine = new BrowserCatalogTranslator(() => native.environment);
  await run(engine, data, 'fr');
  const previous = native.calls.length;
  await run(engine, data, 'fr');
  assert.equal(native.calls.length, previous);
  const cachedOnly = new BrowserCatalogTranslator(() => ({ localStorage: native.environment.localStorage }));
  assert.equal((await run(cachedOnly, data, 'fr')).flavors[0].name, 'fr:Orange');
  data.flavors[0].name = 'New fruit';
  assert.equal((await run(cachedOnly, data, 'fr')).flavors[0].name, 'New fruit');
});
test('downloads require a real user activation and retry after activating the chosen locale', async () => {
  const native = nativeEnvironment({ availability: 'downloadable', active: false });
  const engine = new BrowserCatalogTranslator(() => native.environment);
  const data = fixture();
  assert.equal((await run(engine, data)).flavors[0].name, 'Orange');
  assert.equal(native.created.length, 0);
  assert.equal(engine.status, 'needs-activation');
  native.environment.navigator.userActivation.isActive = true;
  let activated = 0;
  engine.onActivation(() => activated++);
  await engine.activate('ar');
  assert.equal(activated, 1);
  assert.equal((await run(engine, data)).flavors[0].name, 'ar:Orange');
});
test('unsupported browsers and native failures retain source copy; failed text is retried, not cached', async () => {
  const data = fixture();
  const unsupported = new BrowserCatalogTranslator(() => ({}));
  assert.deepEqual(await run(unsupported, data), data);
  assert.equal(unsupported.status, 'unsupported');
  const native = nativeEnvironment({ failText: 'Orange' });
  const engine = new BrowserCatalogTranslator(() => native.environment);
  const output = await run(engine, data);
  assert.equal(output.flavors[0].name, 'Orange');
  const priorCalls = native.calls.filter(call => call.text === 'Orange').length;
  await run(engine, data);
  assert.equal(native.calls.filter(call => call.text === 'Orange').length, priorCalls + 1);
  assert.equal(engine.status, 'error');
});
test('cancellation prevents stale translations from updating a newly selected language', async () => {
  const controller = new AbortController();
  const native = nativeEnvironment({ translate: text => { controller.abort(); return `late:${text}`; } });
  const engine = new BrowserCatalogTranslator(() => native.environment);
  let updates = 0;
  await engine.translate(fixture(), 'fr', controller.signal, () => updates++);
  assert.equal(updates, 1, 'Only the initial cached result is delivered');
});
test('English default also translates Vietnamese descriptions while keeping English source text', async () => {
  const native = nativeEnvironment();
  const engine = new BrowserCatalogTranslator(() => native.environment);
  const translated = await run(engine, fixture(), 'en');
  assert.equal(translated.flavors[0].name, 'Orange');
  assert.match(translated.flavors[0].description, /^en:Cam mọng nước/);
  assert.ok(native.calls.every(call => call.sourceLanguage === 'vi' && call.targetLanguage === 'en'));
});
test('all eight selected locales are forwarded to the native translator and have curated progress copy', async () => {
  for (const locale of ['en', 'fr', 'zh', 'es', 'ar', 'ru', 'ko', 'de']) {
    const native = nativeEnvironment();
    await run(new BrowserCatalogTranslator(() => native.environment), fixture(), locale);
    assert.ok(native.calls.some(call => call.targetLanguage === locale), locale);
    for (const text of Object.values(translationStatus[locale])) assert.ok(text.length > 5);
  }
});
test('LanguageDetector handles newly entered non-English source copy', async () => {
  const data = fixture(); data.flavors[0].description = 'Un délicieux jus de fruits';
  const native = nativeEnvironment();
  native.environment.LanguageDetector = { availability: async () => 'available', create: async () => ({ destroy() {}, detect: async text => [{ detectedLanguage: text.startsWith('Un délicieux') ? 'fr' : 'en', confidence: .99 }] }) };
  await run(new BrowserCatalogTranslator(() => native.environment), data, 'de');
  assert.equal(native.calls.find(call => call.text.startsWith('Un délicieux')).sourceLanguage, 'fr');
});
test('a denied native creation remains retryable via a user click', async () => {
  const denied = new Error('Activation required'); denied.name = 'NotAllowedError';
  const native = nativeEnvironment({ failCreate: denied, active: false });
  const engine = new BrowserCatalogTranslator(() => native.environment);
  await run(engine, fixture());
  assert.equal(engine.status, 'needs-activation');
  assert.equal(native.calls.length, 0);
});
test('a slow optional language detector download cannot block the available translators', async () => {
  const native = nativeEnvironment();
  native.environment.LanguageDetector = { availability: async () => 'downloadable', create: () => new Promise(() => {}) };
  const engine = new BrowserCatalogTranslator(() => native.environment);
  await engine.activate('ar');
  const output = await run(engine, fixture());
  assert.equal(output.flavors[0].name, 'ar:Orange');
  assert.equal(engine.status, 'ready');
});
