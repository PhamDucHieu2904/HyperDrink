/* eslint-disable @typescript-eslint/no-require-imports -- Node-only TypeScript harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../lib/favorites.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function environment() {
  const data = new Map();
  const handlers = new Set();
  return {
    data, handlers,
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
    addEventListener: (name, handler) => { if (name === 'storage') handlers.add(handler); },
    removeEventListener: (name, handler) => { if (name === 'storage') handlers.delete(handler); },
  };
}
function load(window) {
  const exports = {};
  new Function('exports', 'window', compiled)(exports, window);
  return exports;
}

test('favorites add and remove individual products and survive a full page reload', () => {
  const browser = environment();
  const store = load(browser);
  assert.equal(store.toggleFavorite('apple-330'), true);
  assert.equal(store.toggleFavorite('guava-330'), true);
  const reloaded = load(browser);
  assert.deepEqual(reloaded.favoritesSnapshot(), ['guava-330', 'apple-330']);
  assert.equal(reloaded.toggleFavorite('apple-330'), false);
  assert.deepEqual(JSON.parse(browser.data.get(store.FAVORITES_STORAGE_KEY)), ['guava-330']);
});

test('malformed and duplicate stored entries cannot break the list', () => {
  const store = load(environment());
  for (const value of [null, 'oops', '{}', 'null', '12']) assert.deepEqual(store.parseFavoriteIds(value), []);
  assert.deepEqual(store.parseFavoriteIds(JSON.stringify(['apple', null, 42, {}, '', 'apple', 'guava', 'x'.repeat(201)])), ['apple', 'guava']);
});

test('all cards share one storage listener, synchronize tabs, and clean up on unmount', () => {
  const browser = environment();
  const store = load(browser);
  let notifications = 0;
  const first = store.subscribeFavorites(() => notifications++);
  const second = store.subscribeFavorites(() => notifications++);
  assert.equal(browser.handlers.size, 1);
  store.toggleFavorite('apple');
  assert.equal(notifications, 2);
  browser.data.set(store.FAVORITES_STORAGE_KEY, '["guava"]');
  for (const handler of browser.handlers) handler({ key: store.FAVORITES_STORAGE_KEY });
  assert.deepEqual(store.favoritesSnapshot(), ['guava']);
  browser.data.clear();
  for (const handler of browser.handlers) handler({ key: null });
  assert.deepEqual(store.favoritesSnapshot(), []);
  first(); second();
  assert.equal(browser.handlers.size, 0);
});

test('blocked storage still allows adding and removing products during the visit', () => {
  const browser = environment();
  browser.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const store = load(browser);
  assert.deepEqual(store.favoritesSnapshot(), []);
  store.toggleFavorite('apple');
  assert.deepEqual(store.favoritesSnapshot(), ['apple']);
  store.toggleFavorite('apple');
  assert.deepEqual(store.favoritesSnapshot(), []);
});

test('SSR and hydration use a stable empty snapshot without reading browser storage', () => {
  const store = load(undefined);
  assert.deepEqual(store.favoritesSnapshot(), []);
  assert.equal(store.favoritesServerSnapshot(), store.favoritesServerSnapshot());
});
