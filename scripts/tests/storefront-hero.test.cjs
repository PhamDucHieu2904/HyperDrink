/* eslint-disable @typescript-eslint/no-require-imports -- Render the production TSX UI with only its expensive WebGL boundary replaced. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require.extensions['.tsx'] = function(module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(outputText, filename);
};
require.extensions['.css'] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };

let viewerCalls = [];
let visualCalls = [];
const dynamicBoundaries = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'next/dynamic') return (loader, options) => {
    dynamicBoundaries.push(options);
    return props => {
      viewerCalls.push(props);
      return React.createElement('div', { 'data-testid': 'webgl-boundary', 'data-model-src': props.asset.src, 'data-label-src': props.appearance.slots?.label?.baseColorMap });
    };
  };
  if (request === './catalog-hero/ProductVisual') {
    const production = originalLoad.call(this, request, ...args);
    return { __esModule: true, default: props => { visualCalls.push(props); return React.createElement(production.default, props); } };
  }
  return originalLoad.call(this, request, ...args);
};
const ShowcaseHero = require('../../components/ShowcaseHero.tsx').default;
const BeverageCategoryRail = require('../../components/BeverageCategoryRail.tsx').default;
const { LanguageProvider } = require('../../components/LanguageProvider.tsx');
const ProductDetailPanel = require('../../components/product-detail/ProductDetailPanel.tsx').default;
const { resolveProductDetail } = require('../../lib/catalog/product-detail.ts');
const { catalogProducts, parsePublishedCatalog } = require('../../lib/catalog/storefront.ts');
Module._load = originalLoad;

test('product panel follows the selected label, escapes editorial text, and handles missing, disabled and archived details', () => {
  const data = fixture(); const products = catalogProducts(data);
  const product = products.find(item => item.label);
  const detail = { ...entity('linked-detail'), labelId: product.label.id, posterId: null, eyebrow: 'Fruit collection', headline: 'Editorial headline', subtitle: 'A fresh story', introduction: '<script>alert(1)</script>', ingredients: 'Water & fruit', allergens: '', servingSize: 'Per 100 ml', nutrition: [], companyName: 'Manufacturer', companyAddress: 'Public address', countryOfOrigin: 'Vietnam', netContent: '330 ml', storage: 'Serve chilled', shelfLife: '', sections: [{ title: 'Extra', body: 'Additional information' }], enabled: true };
  data.productDetails = [detail];
  assert.equal(resolveProductDetail(data, product).id, detail.id);
  assert.equal(resolveProductDetail(data, products.find(item => item.label && item.label.id !== product.label.id)), undefined);
  const html = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ProductDetailPanel, { catalog: data, product, onClose: () => {} })));
  assert.match(html, /Editorial headline/); assert.match(html, /role="tablist"/); assert.match(html, /role="tabpanel"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Manufacturer/); assert.match(html, /Public address/); assert.match(html, /Additional information/);
  detail.enabled = false; assert.equal(resolveProductDetail(data, product), undefined);
  detail.enabled = true; detail.lifecycle = 'archived'; assert.equal(resolveProductDetail(data, product), undefined);
  delete data.productDetails;
  const parsed = parsePublishedCatalog({ data: { schemaVersion: 1, catalog: data, releaseId: 'legacy-release', publishedAt: '2026-10-01T04:00:00Z' } }, 'static');
  assert.deepEqual(parsed.catalog.productDetails, []);
});

let pagePublished, pageHeroCalls = [], pageStateWrites = [], pageStateValues = [], pageEffects = [], pageStateIndex = 0;
Module._load = function(request, ...args) {
  if (request === '@/components/usePublishedCatalog') return { usePublishedCatalog: () => ({ published: pagePublished, loading: false, error: '', refresh: async () => {} }) };
  if (request === '@/components/useTranslatedCatalog') return { useTranslatedCatalog: catalog => catalog };
  if (request === '@/components/useStorefrontTelemetry') return { useStorefrontTelemetry: () => () => {} };
  if (request === '@/components/ShowcaseHero') return { __esModule: true, default: props => { pageHeroCalls.push(props); return React.createElement(ShowcaseHero, props); } };
  if (request === 'react') return { ...React,
    useEffect: effect => { pageEffects.push(effect); },
    useState: initial => {
      const index = pageStateIndex++;
      const [value] = React.useState(initial);
      if (!(index in pageStateValues)) pageStateValues[index] = value;
      return [pageStateValues[index], next => {
        const updated = typeof next === 'function' ? next(pageStateValues[index]) : next;
        pageStateValues[index] = updated;
        pageStateWrites.push(updated);
      }];
    },
  };
  return originalLoad.call(this, request, ...args);
};
const HomePage = require('../../app/page.tsx').default;
Module._load = originalLoad;

const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: '2026-10-01T04:00:00Z', updatedAt: '2026-10-01T04:00:00Z' });
const media = (id, role) => ({ ...entity(id), role, status: 'ready', url: `/api/public/v1/media/${id}`, storageKey: '', mime: role === 'model' ? 'model/gltf-binary' : 'image/webp', bytes: 1024, sha256: 'c'.repeat(64), width: role === 'model' ? null : 512, height: role === 'model' ? null : 512, imageBounds: role === 'fruit' ? [0.1, 0.1, 0.9, 0.9] : null, error: '' });

function fixture() {
  const data = { schemaVersion: 1, drinkTypes: [{ ...entity('drink-juice'), name: 'Juice from admin', description: 'Juice taxonomy', position: 0 }], packagingCategories: [{ ...entity('business-can'), name: 'Admin Alu can', viewerKind: 'can', position: 0 }, { ...entity('business-glass'), name: 'Admin Glass bottle', viewerKind: 'glass', position: 1 }], packagingVariants: [{ ...entity('admin-can-330'), name: '330 ml admin can', categoryId: 'business-can', volumeMl: 330, shape: 'standard', position: 0 }, { ...entity('admin-glass-250'), name: '250 ml admin glass', categoryId: 'business-glass', volumeMl: 250, shape: 'tall', position: 1 }], flavors: [], flavorAssets: [], productGroups: [{ ...entity('juice-line'), name: 'Juice 30% from admin', buttonLabel: 'Juice 30%', drinkTypeId: 'drink-juice', description: 'Editorial product line', position: 1, visible: true }, { ...entity('other-line'), name: 'Other admin line', buttonLabel: 'Other', drinkTypeId: 'drink-juice', description: '', position: 0, visible: true }], productVariants: [], packagingSlots: [{ ...entity('can-slot'), groupId: 'juice-line', packagingVariantId: 'admin-can-330', regionKey: 'packaging-picker', position: 1, buttonLabel: 'Can 330 chooser', mode: '3d', defaultVariantId: 'can-product-4', enabled: true }, { ...entity('glass-slot'), groupId: 'juice-line', packagingVariantId: 'admin-glass-250', regionKey: 'packaging-picker', position: 0, buttonLabel: 'Glass 250 chooser', mode: '2d', defaultVariantId: 'glass-product', enabled: true }, { ...entity('other-slot'), groupId: 'other-line', packagingVariantId: 'admin-can-330', regionKey: 'packaging-picker', position: 0, buttonLabel: 'Other line can chooser', mode: '2d', defaultVariantId: 'other-product', enabled: true }], media: [], labels: [], models3d: [], assets2d: [], displays3d: [], displays2d: [] };
  data.media.push(media('uploaded-can-model', 'model'), media('neutral-can-poster', 'poster'));
  data.models3d.push({ ...entity('admin-can-model'), name: 'Admin 330 packaging reference', packagingVariantId: 'admin-can-330', mediaId: 'uploaded-can-model', posterId: 'neutral-can-poster', layoutProfile: 'can-wrap-v1', materialSlots: { label: ['user-label-mesh'] }, orientation: [0.1, 0.2, 0] });
  const names = ['Lychee', 'Guava', 'Tamarind', 'Mangosteen', 'Dragon fruit', 'Passion fruit'];
  const backgrounds = ['#224411', '#335522', '#446633', '#557744', '#166abb', '#779966'];
  for (let index = 0; index < names.length; index++) {
    const flavorId = `custom-flavor-${index}`, variantId = `can-product-${index}`;
    data.flavors.push({ ...entity(flavorId), name: names[index], shortName: names[index], description: `Admin tasting notes ${index}`, accentColor: index === 4 ? '#de1234' : '#ee8811', backgroundColor: backgrounds[index], textColor: index === 4 ? '#fdf3da' : '#ffffff', icon: 'leaf', thumbnailId: `uploaded-thumbnail-${index}`, position: index });
    data.productVariants.push({ ...entity(variantId), name: `Juice 30% ${names[index]} 330 ml`, groupId: 'juice-line', packagingVariantId: 'admin-can-330', flavorId, code: '', description: `SKU detail ${index}`, enabled: true });
    data.media.push(media(`uploaded-thumbnail-${index}`, 'thumbnail'), media(`uploaded-label-${index}`, 'label'), media(`uploaded-product-${index}`, 'image-2d'));
    data.labels.push({ ...entity(`admin-label-${index}`), drinkTypeId: 'drink-juice', flavorId, mediaId: `uploaded-label-${index}`, compatibilities: [{ packagingVariantId: 'admin-can-330', layoutProfile: 'can-wrap-v1' }] });
    data.displays3d.push({ ...entity(`display-3d-${index}`), productVariantId: variantId, modelId: 'admin-can-model', labelId: `admin-label-${index}`, enabled: true });
    data.assets2d.push({ ...entity(`asset-2d-${index}`), packagingVariantId: 'admin-can-330', drinkTypeId: 'drink-juice', flavorId, mediaId: `uploaded-product-${index}`, galleryIds: [], description: '' });
    data.displays2d.push({ ...entity(`display-2d-${index}`), productVariantId: variantId, assetId: `asset-2d-${index}`, alt: `Actual ${names[index]} 330 ml packaging`, enabled: true });
    for (const role of ['fruit', 'leaf', 'splash']) {
      data.media.push(media(`uploaded-${role}-${index}`, role));
      data.flavorAssets.push({ ...entity(`assignment-${role}-${index}`), flavorId, mediaId: `uploaded-${role}-${index}`, role, position: 0, enabled: true });
    }
  }
  for (const [variantId, groupId, packagingVariantId, flavorId, imageId] of [['glass-product', 'juice-line', 'admin-glass-250', 'custom-flavor-1', 'uploaded-glass-guava'], ['other-product', 'other-line', 'admin-can-330', 'custom-flavor-0', 'uploaded-other-product']]) {
    data.productVariants.push({ ...entity(variantId), name: variantId, groupId, packagingVariantId, flavorId, code: '', description: '', enabled: true });
    data.media.push(media(imageId, 'image-2d'));
    data.assets2d.push({ ...entity(`asset-${variantId}`), packagingVariantId, drinkTypeId: 'drink-juice', flavorId, mediaId: imageId, galleryIds: [], description: '' });
    data.displays2d.push({ ...entity(`display-${variantId}`), productVariantId: variantId, assetId: `asset-${variantId}`, alt: variantId, enabled: true });
  }
  return data;
}

function render(catalog, selection = { groupId: 'juice-line', slotId: 'can-slot' }) {
  viewerCalls = [];
  visualCalls = [];
  const html = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ShowcaseHero, { catalog, releaseId: 'committed-release-7', selection, onSelectGroup: () => {}, onSelectVariant: () => {} })));
  return { html, text: html.replace(/<!--.*?-->/gs, '').replace(/<[^>]+>/g, ''), viewers: [...viewerCalls], visuals: [...visualCalls] };
}
const productFigure = html => html.match(/<figure class="catalog-product-image"[^>]*>[\s\S]*?<\/figure>/)?.[0] || '';

test('360 tile opens Studio with the selected public display and a keyboard accessible link', () => {
  const data = fixture();
  const html = render(data).html;
  assert.match(html, /<a[^>]*class="[^"]*showcase-mockup-link[^"]*"[^>]*href="\/mockup\/\?display=display-3d-4"[^>]*aria-label="Open Mockup Studio"/);
  const imageOnly = render(data, { groupId: 'juice-line', slotId: 'glass-slot' }).html;
  assert.match(imageOnly, /<a[^>]*class="[^"]*showcase-mockup-link[^"]*"[^>]*href="\/mockup\/"/);
  assert.doesNotMatch(imageOnly, /\/mockup\/\?display=/);
});

test('each product line controls its own hero messages while volume follows the selected packaging', () => {
  const data = fixture(), group = data.productGroups.find(item => item.id === 'juice-line');
  Object.assign(group, { heroVolumeCaption: 'A chilled can', heroFlavorText: 'Choose <your> flavor', heroOriginText: 'Fruit & freshness' });
  const messages = render(data).html.match(/<div class="showcase-metrics[\s\S]*?<\/div>/)?.[0];
  assert.match(messages, /330<small>ml/); assert.match(messages, /A chilled can/);
  assert.match(messages, /Choose &lt;your&gt; flavor/); assert.match(messages, /Fruit &amp; freshness/);
  assert.doesNotMatch(messages, /Many flavor choices|Real fruit from Vietnam|<your>/);
  const glass = render(data, { groupId: 'juice-line', slotId: 'glass-slot' }).html.match(/<div class="showcase-metrics[\s\S]*?<\/div>/)?.[0];
  assert.match(glass, /250<small>ml/); assert.match(glass, /A chilled can/);
  const other = render(data, { groupId: 'other-line' }).text;
  assert.match(other, /Many flavor choices/); assert.doesNotMatch(other, /Fruit &amp; freshness|A chilled can/);
});

test('hero defaults work for legacy releases, blank fields and all supported website languages', () => {
  const { localizedHeroMessages } = require('../../lib/i18n/storefront-marketing.ts');
  const { languages } = require('../../lib/i18n/catalog.ts');
  const { HERO_PRODUCT_DEFAULTS } = require('../../lib/catalog/hero-marketing.ts');
  const group = fixture().productGroups[0];
  for (const language of languages) {
    const legacy = localizedHeroMessages(group, language.code);
    assert.deepEqual(localizedHeroMessages({ ...group, ...HERO_PRODUCT_DEFAULTS }, language.code), legacy);
    assert.deepEqual(localizedHeroMessages({ ...group, heroVolumeCaption: ' ', heroFlavorText: '', heroOriginText: '\n' }, language.code), legacy);
    assert.ok(Object.values(legacy).every(value => value.length > 0));
    if (language.code !== 'en') assert.notEqual(legacy.flavors, HERO_PRODUCT_DEFAULTS.heroFlavorText);
  }
});

test('homepage collection renders six cards per page and keeps the remaining products in pagination', () => {
  const CollectionRows = require('../../components/collection/CollectionRows.tsx').default;
  const { collectionSections, productPage } = require('../../lib/catalog/collection.ts');
  const data = fixture(), sections = collectionSections(data);
  const section = sections.find(item => item.group.id === 'juice-line');
  const html = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(CollectionRows, { catalog: data, sections: [section] })));
  assert.equal((html.match(/class="collection-card"/g) || []).length, 6);
  assert.match(html, /Page 1 of 2/);
  const second = productPage(section.products, 1, 6);
  assert.equal(second.items.length, section.products.length - 6);
  assert.deepEqual([...productPage(section.products, 0, 6).items, ...second.items], section.products);
});

test('Contact uses published company data, omits inactive records, and keeps a useful fallback', () => {
  const ContactSection = require('../../components/ContactSection.tsx').default;
  const data = fixture();
  const contact = catalog => renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ContactSection, { catalog })));
  data.productDetails = [
    { ...entity('archived-company'), lifecycle: 'archived', enabled: true, companyName: 'Old company', companyAddress: 'Old address' },
    { ...entity('disabled-company'), enabled: false, companyName: 'Disabled company', companyAddress: 'Disabled address' },
    { ...entity('public-company'), enabled: true, companyName: 'VINUT <company>', companyAddress: 'Public address & office' },
  ];
  const html = contact(data);
  assert.match(html, /id="contact"/); assert.match(html, /mailto:hello@vinut.com/);
  assert.match(html, /VINUT &lt;company&gt;/); assert.match(html, /Public address &amp; office/);
  assert.doesNotMatch(html, /Old company|Disabled company|Old address|<company>/);
  assert.match(contact(undefined), /<bdi>VINUT<\/bdi>/);
  assert.match(contact(undefined), /<address><bdi>Vietnam<\/bdi><\/address>/);
});

test('flavor buttons use their own fruit pool images and omit All flavors without replacing product artwork', () => {
  const data = fixture();
  const { html } = render(data);
  const dock = html.slice(html.indexOf('class="flavor-dock'), html.indexOf('class="showcase-details"'));
  for (let index = 0; index < data.flavors.length; index++) {
    assert.ok(dock.includes(`/api/public/v1/media/uploaded-fruit-${index}`));
    assert.ok(!dock.includes(`uploaded-thumbnail-${index}`));
    assert.ok(!dock.includes(`uploaded-label-${index}`));
  }
  assert.doesNotMatch(dock, /All flavors|lucide-layout-grid/);
  assert.match(html, /class="flavor-portrait"[^>]*[\s\S]*?uploaded-thumbnail-4/);
});

test('flavor icons choose the first usable own-fruit assignment stably and never fall back to label thumbnails', () => {
  const { resolveFlavorFruitImage } = require('../../lib/catalog/resolve.ts');
  const data = fixture();
  const flavor = data.flavors[0];
  const assignment = (id, mediaId, overrides = {}) => ({ ...entity(id), flavorId: flavor.id, role: 'fruit', mediaId, position: -1, enabled: true, ...overrides });
  data.media.push(media('backup-fruit', 'fruit'), media('disabled-fruit', 'fruit'), media('archived-fruit', 'fruit'), media('pending-fruit', 'fruit'));
  data.media.find(item => item.id === 'archived-fruit').lifecycle = 'archived';
  data.media.find(item => item.id === 'pending-fruit').status = 'processing';
  data.flavorAssets.push(
    assignment('a-label', 'uploaded-label-0'), assignment('b-disabled', 'disabled-fruit', { enabled: false }),
    assignment('c-archived', 'archived-fruit'), assignment('d-pending', 'pending-fruit'),
    assignment('e-foreign', 'backup-fruit', { flavorId: data.flavors[1].id }),
    assignment('f-backup', 'backup-fruit', { position: 1 }),
  );
  assert.equal(resolveFlavorFruitImage(data, flavor.id).id, 'uploaded-fruit-0');
  data.flavorAssets.reverse();
  assert.equal(resolveFlavorFruitImage(data, flavor.id).id, 'uploaded-fruit-0');
  data.media.find(item => item.id === 'uploaded-fruit-0').status = 'failed';
  assert.equal(resolveFlavorFruitImage(data, flavor.id).id, 'backup-fruit');
  data.flavorAssets.find(item => item.id === 'f-backup').lifecycle = 'archived';
  assert.equal(resolveFlavorFruitImage(data, flavor.id), undefined);
  const { html } = render(data);
  const button = html.match(/<button[^>]*data-variant-id="can-product-0"[\s\S]*?<\/button>/)?.[0];
  assert.match(button, /Lychee/);
  assert.match(button, /catalog-image-placeholder/);
  assert.doesNotMatch(button, /<img|uploaded-label|uploaded-thumbnail/);
});

test('production hero renders more than four admin flavors with the valid default, exact colors and ordered product line controls', () => {
  const data = fixture();
  const { html, text, viewers } = render(data);
  assert.match(html, /data-flavor="custom-flavor-4"/); assert.match(html, /data-variant="can-product-4"/); assert.match(html, /data-release="committed-release-7"/);
  assert.match(html, /--flavor-accent:#de1234/); assert.match(html, /--catalog-background:#166abb/); assert.match(html, /--catalog-text:#fdf3da/);
  assert.equal((html.match(/class="flavor-background-color"/g) || []).length, 6);
  assert.doesNotMatch(html, /catalog-carousel-controls|catalog-carousel-motion/);
  assert.match(html, /<span class="showcase-badge" dir="ltr">Hot<\/span>/);
  assert.match(text, /Many flavor choices/); assert.match(text, /Real fruit from Vietnam/);
  assert.match(text, /330/); assert.match(text, /Net content/); assert.match(text, /Juice 30% from admin/);
  const messages = html.match(/<div class="showcase-metrics[\s\S]*?<\/div>/)?.[0];
  assert.doesNotMatch(messages, /Experience|>3D<|>06<|Flavors/);
  for (const flavor of data.flavors) assert.ok(text.includes(flavor.shortName));
  const picker = html.match(/<div class="model-picker"[\s\S]*?<\/div><\/div>/)?.[0];
  assert.ok(picker); assert.match(picker, /BEST SELLER/);
  assert.ok(picker.indexOf('>Other<') < picker.indexOf('>Juice 30%<'));
  assert.match(picker, /aria-pressed="true"><bdi>Juice 30%<\/bdi>/);
  assert.doesNotMatch(html, /Glass 250 chooser|Can 330 chooser|Other line can chooser|Sparkling|Honey Peach|Ruby Berry|can-250-short|can-180/);
  assert.equal(viewers.length, 1);
});

test('BEST SELLER only lists active home-visible product lines and uses their display label or name', () => {
  const data = fixture();
  data.productGroups.push(
    { ...entity('hidden-line'), name: 'Hidden draft line', buttonLabel: 'Do not show hidden', drinkTypeId: 'drink-juice', description: '', position: -3, visible: false },
    { ...entity('archived-line'), name: 'Archived line', buttonLabel: 'Do not show archived', drinkTypeId: 'drink-juice', description: '', position: -2, visible: true, lifecycle: 'archived' },
    { ...entity('missing-type-line'), name: 'Unusable taxonomy line', buttonLabel: 'Do not show missing type', drinkTypeId: 'missing-drink', description: '', position: -1, visible: true },
  );
  data.productGroups.find(group => group.id === 'other-line').buttonLabel = '';
  const { html } = render(data);
  const picker = html.match(/<div class="model-picker"[\s\S]*?<\/div><\/div>/)?.[0];
  assert.equal((picker.match(/<button /g) || []).length, 2);
  assert.match(picker, /Other admin line/); assert.match(picker, /Juice 30%/);
  assert.doesNotMatch(picker, /Do not show|Hidden draft|Archived line|Unusable taxonomy|chooser/);
});

test('the advertising banner restores all ten beverage labels as noninteractive text', () => {
  const html = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(BeverageCategoryRail)));
  const labels = ['Juice', 'Sparkling', 'Nata De Coco', 'Coconut milk', 'Coffee', 'Energy Drink', 'Basil seed', 'Chia seed', 'Coconut water', 'Popping boba tea'];
  for (const label of labels) assert.ok(html.includes(`>${label}</span>`));
  assert.equal((html.match(/class="category-tag"/g) || []).length, 20);
  assert.match(html, /class="category-set" aria-hidden="true"/);
  assert.doesNotMatch(html, /<button|<a |tabindex|aria-pressed|aria-selected|onclick|onSelect/);
});

test('the page initializes a stable random entry then group selection resets the SKU without filtering the collection', async () => {
  const data = fixture();
  pagePublished = { catalog: data, releaseId: 'committed-release-7', schemaVersion: 1, publishedAt: '2026-10-01T04:00:00Z', source: 'api' };
  pageHeroCalls = []; pageStateWrites = []; pageStateValues = []; pageEffects = []; pageStateIndex = 0;
  renderToStaticMarkup(React.createElement(HomePage));
  assert.equal(pageHeroCalls.length, 0, 'Wait for the client entry choice before showing a default can');
  pageEffects.forEach(effect => effect());
  await Promise.resolve();
  assert.equal(pageStateWrites[0].variantId, 'other-product');
  pageStateIndex = 0; pageEffects = []; pageStateWrites = [];
  const html = renderToStaticMarkup(React.createElement(HomePage));
  const heroProps = pageHeroCalls[0];
  assert.equal(typeof heroProps.onSelectGroup, 'function'); assert.equal(heroProps.onSelectSlot, undefined);
  heroProps.onSelectGroup('juice-line');
  assert.deepEqual(pageStateWrites, [{ groupId: 'juice-line' }], 'Changing the product line resets packaging/flavor and does not write a collection group filter');
  const selected = render(data, pageStateWrites[0]);
  assert.match(selected.html, /data-variant="glass-product"/); assert.match(productFigure(selected.html), /uploaded-glass-guava/);
  assert.match(selected.text, /250/); assert.equal(selected.viewers.length, 0);
  const collection = html.slice(html.indexOf('<section id="collection"'), html.indexOf('<section id="contact"'));
  assert.match(collection, /Juice 30% Lychee 330 ml/); assert.match(collection, /other-product/);
  assert.doesNotMatch(collection, /category-filter-summary/);
  assert.match(collection, /collection-row/);
  assert.match(collection, /See all products/);
  assert.match(html, /href="#contact"[^>]*>Contact<\/a>/);
  assert.doesNotMatch(html, /id="story"|#story|Our story/);
});

test('uploaded model and label plus this flavor decoration reach the actual 3D boundary without procedural label data', () => {
  const { viewers } = render(fixture());
  const viewer = viewers[0];
  assert.equal(viewer.asset.src, '/api/public/v1/media/uploaded-can-model');
  assert.deepEqual(viewer.asset.materialSlots, { label: ['user-label-mesh'] });
  assert.deepEqual(viewer.asset.orientation, [0.1, 0.2, 0]);
  assert.equal(viewer.appearance.slots.label.baseColorMap, '/api/public/v1/media/uploaded-label-4');
  assert.equal(viewer.appearance.label, undefined);
  const decoration = viewer.accentScene.nodes.filter(item => ['fruit', 'leaf', 'splash'].includes(item.kind));
  assert.ok(decoration.length > 0);
  for (const role of ['fruit', 'leaf', 'splash']) assert.ok(decoration.some(item => item.kind === role));
  for (const node of decoration) { assert.equal(node.assetUrl, `/api/public/v1/media/uploaded-${node.kind}-4`); assert.equal(node.variants, undefined); }
});

test('first-entry background/refraction state already uses the selected nonfirst flavor before browser effects', () => {
  const { visuals } = render(fixture());
  const state = visuals[0].backgroundState;
  assert.equal(state.flavorIndex, 4);
  assert.equal(state.themes[4].color, '#166abb');
  assert.deepEqual(state.weights, [0, 0, 0, 0, 1, 0]);
});

test('chunk and model loading paths both use compact accessible indicators without a giant neutral can', () => {
  const { viewers } = render(fixture());
  assert.ok(viewers[0].loadingFallback);
  const modelLoading = renderToStaticMarkup(viewers[0].loadingFallback);
  const chunkLoading = renderToStaticMarkup(React.createElement(dynamicBoundaries[0].loading));
  for (const markup of [modelLoading, chunkLoading]) {
    assert.match(markup, /catalog-viewer-loading/); assert.match(markup, /role="status"/); assert.match(markup, /aria-live="polite"/);
    assert.match(markup, /width="72"/); assert.match(markup, /height="72"/);
    assert.doesNotMatch(markup, /<img|neutral-can-poster|width:80%|uploaded-can-model/);
  }
  assert.match(chunkLoading, /scene-shell catalog-viewer-chunk/);
});

test('changing the selected variant changes both rendered metadata and the label/scene reaching 3D', () => {
  const { html, viewers } = render(fixture(), { groupId: 'juice-line', slotId: 'can-slot', variantId: 'can-product-5' });
  assert.match(html, /data-flavor="custom-flavor-5"/); assert.match(html, /--catalog-background:#779966/);
  assert.equal(viewers[0].appearance.slots.label.baseColorMap, '/api/public/v1/media/uploaded-label-5');
  assert.ok(viewers[0].accentScene.nodes.filter(item => item.kind === 'fruit').every(item => item.assetUrl.endsWith('uploaded-fruit-5')));
});

test('2D mode renders only the selected variant image and bypasses the WebGL component', () => {
  const data = fixture(); data.packagingSlots.find(item => item.id === 'can-slot').mode = '2d';
  const { html, text, viewers } = render(data);
  assert.equal(viewers.length, 0);
  const figure = productFigure(html);
  assert.match(figure, /src="\/api\/public\/v1\/media\/uploaded-product-4"/);
  assert.match(figure, /Actual Dragon fruit 330 ml packaging/);
  assert.doesNotMatch(figure, /uploaded-product-[035]|neutral-can-poster|uploaded-other-product/);
  assert.match(text, /2D/);
  assert.match(html, /<span class="showcase-badge" dir="ltr">Hot<\/span>/);
  assert.match(text, /Many flavor choices/); assert.match(text, /Real fruit from Vietnam/);
});

test('a flavor without a reviewed thumbnail renders a named icon in the round portrait rather than an unrelated full-wrap image', () => {
  const data = fixture();
  data.flavorAssets = [];
  data.flavors.find(item => item.id === 'custom-flavor-4').thumbnailId = null;
  const unusedWrapper = data.media.find(item => item.id === 'uploaded-thumbnail-4');
  unusedWrapper.url = '/api/public/v1/media/unassigned-raw-full-wrap'; unusedWrapper.width = 512; unusedWrapper.height = 263;
  const { html } = render(data);
  const portrait = html.match(/<div class="flavor-portrait-ring">[\s\S]*?<\/div>/)?.[0];
  assert.ok(portrait);
  assert.match(portrait, /catalog-image-placeholder flavor-portrait/); assert.match(portrait, /role="img"/); assert.match(portrait, /aria-label="Dragon fruit"/);
  assert.doesNotMatch(portrait, /<img|raw-full-wrap|uploaded-product/);
  assert.doesNotMatch(html, /unassigned-raw-full-wrap/);
});

test('an incompatible 2D image never becomes a product fallback or a neutral model poster in 2D mode', () => {
  const data = fixture(); data.packagingSlots.find(item => item.id === 'can-slot').mode = '2d';
  data.assets2d.find(item => item.id === 'asset-2d-4').flavorId = 'custom-flavor-5';
  const { html, viewers } = render(data);
  assert.equal(viewers.length, 0);
  assert.match(productFigure(html), /role="status"/);
  assert.doesNotMatch(productFigure(html), /<img|uploaded-product|neutral-can-poster/);
});

test('an unavailable 3D association renders the matching 2D SKU and foreign group/slot requests remain scoped', () => {
  const data = fixture(); data.labels.find(item => item.id === 'admin-label-4').lifecycle = 'archived';
  const result = render(data);
  assert.equal(result.viewers.length, 0);
  assert.match(productFigure(result.html), /uploaded-product-4/);
  const scoped = render(data, { groupId: 'juice-line', slotId: 'other-slot', variantId: 'other-product' });
  assert.match(scoped.html, /data-variant="glass-product"/); assert.match(scoped.text, /250/);
  assert.match(productFigure(scoped.html), /uploaded-glass-guava/);
  assert.doesNotMatch(scoped.html, /uploaded-other-product/);
});

test('empty or disabled packaging slots render a useful empty state without legacy data or crashes', () => {
  const data = fixture(); data.packagingSlots.forEach(item => { item.enabled = false; });
  const { html, text, viewers } = render(data);
  assert.equal(viewers.length, 0); assert.match(html, /catalog-showcase-empty/); assert.match(html, /role="status"/);
  assert.match(text, /Juice 30% from admin/); assert.doesNotMatch(html, /flavor-background-color|uploaded-product|Sparkling/);
  data.productGroups = [];
  assert.doesNotThrow(() => render(data));
});


test('an uploaded flavor icon reaches the actual hero and shared water backdrop state, with a built-in fallback', () => {
  const data = fixture(), icon = media('reusable-symbol', 'icon'); data.media.push(icon); data.flavors[4].iconId = icon.id;
  const state = render(data).visuals[0].backgroundState;
  assert.equal(state.themes[4].iconUrl, '/api/public/v1/media/reusable-symbol');
  assert.equal(state.flavorIndex, 4); assert.equal(state.weights[4], 1);
  icon.lifecycle = 'archived';
  const fallback = render(data).visuals[0].backgroundState;
  assert.equal(fallback.themes[4].iconUrl, undefined); assert.equal(fallback.themes[4].icon, data.flavors[4].icon);
});
