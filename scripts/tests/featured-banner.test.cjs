'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Exercise published catalog rules without a build step. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectionSections } = require('../../lib/catalog/collection.ts');
const { featuredBannerSlides, featuredSlideIndex } = require('../../lib/catalog/featured-banner.ts');
const { featuredBannerCopy } = require('../../lib/i18n/featured-banner.ts');
const published = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/catalog/current.json'), 'utf8')).data.catalog;

test('featured slides resolve to actual homepage products with correct detail links and transparent renders', () => {
  const catalog = published();
  const slides = featuredBannerSlides(catalog, collectionSections(catalog));
  assert.deepEqual(slides.map(slide => slide.product.flavor.id), ['juice30-guava', 'juice30-mango', 'juice30-strawberry', 'juice30-passion-fruit', 'juice30-pineapple']);
  for (const slide of slides) {
    assert.equal(slide.cutout, true);
    assert.ok(fs.existsSync(path.join(__dirname, '../../public', slide.image)));
    assert.ok(slide.href.includes(`product=${encodeURIComponent(slide.product.variant.id)}`));
    assert.ok(slide.href.includes(`group=${encodeURIComponent(slide.product.group.id)}`));
    assert.ok(slide.fruit.every(media => media.lifecycle === 'active' && media.status === 'ready' && media.role === 'fruit'));
  }
});

test('admin homepage visibility and disabled items remove their promotions without exposing catalog-only products', () => {
  const catalog = published();
  catalog.catalogCollections.find(item => item.id === 'juice-30').homeVisible = false;
  const slides = featuredBannerSlides(catalog, collectionSections(catalog));
  assert.ok(slides.length > 0);
  assert.ok(slides.every(slide => slide.product.group.id !== 'juice-30'));
  catalog.catalogCollections.forEach(item => { item.homeVisible = false; });
  assert.deepEqual(featuredBannerSlides(catalog, collectionSections(catalog)), []);
  const changed = published();
  changed.catalogItems.find(item => item.id === 'juice30-can330-guava').enabled = false;
  assert.ok(featuredBannerSlides(changed, collectionSections(changed)).every(slide => slide.product.variant.id !== 'juice30-can330-guava'));
});

test('replaced label artwork falls back to the current editorial image instead of showing an obsolete render', () => {
  const catalog = published();
  const label = catalog.labels.find(item => item.id === 'juice30-can330-guava-label');
  catalog.media.find(media => media.id === label.mediaId).sha256 = 'f'.repeat(64);
  const slide = featuredBannerSlides(catalog, collectionSections(catalog))[0];
  assert.equal(slide.cutout, false);
  assert.equal(slide.image, slide.product.image2d.url);
});

test('disabled decorations are excluded and a single-product collection remains a valid slide', () => {
  const catalog = published();
  catalog.flavorAssets.filter(asset => asset.flavorId === 'juice30-guava').forEach(asset => { asset.enabled = false; });
  const sections = collectionSections(catalog);
  const guava = sections[0].products.find(product => product.flavor.id === 'juice30-guava');
  const slides = featuredBannerSlides(catalog, [{ ...sections[0], products: [guava] }]);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].fruit, []);
  assert.deepEqual(slides[0].leaves, []);
  assert.equal(slides[0].ice, undefined);
});

test('slide indexing wraps in both directions and all languages preserve product copy placeholders', () => {
  assert.equal(featuredSlideIndex(5, 5), 0);
  assert.equal(featuredSlideIndex(-1, 5), 4);
  assert.equal(featuredSlideIndex(15, 5), 0);
  assert.equal(featuredSlideIndex(1, 0), 0);
  for (const locale of ['en', 'fr', 'zh', 'es', 'ar', 'ru', 'ko', 'de']) {
    const copy = featuredBannerCopy(locale);
    assert.ok(copy.title.includes('{flavor}'));
    assert.ok(copy.description.includes('{collection}') && copy.description.includes('{flavor}'));
    assert.ok(copy.pause && copy.play && copy.slide.includes('{flavor}'));
  }
});
