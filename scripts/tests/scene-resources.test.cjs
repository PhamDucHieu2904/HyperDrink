/* eslint-disable @typescript-eslint/no-require-imports -- Tests production code with deterministic browser boundaries. */
require('../register-admin-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createSceneResourceLoader } = require('../../lib/viewer/scene-resources.ts');
const { createSceneResourcePlan } = require('../../lib/catalog/scene-resource-plan.ts');
const { catalogProducts } = require('../../lib/catalog/storefront.ts');
const { resolveDisplay3D, resolveFlavorFruitImage, mediaUrl } = require('../../lib/catalog/resolve.ts');
const { decodeHomepageLayout } = require('../../lib/catalog/homepage-layout.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (bytes = 4) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/webp' } });
function fixture(context, plan, options = {}) {
  const tasks = [], requests = [], created = [], revoked = [];
  const handle = createSceneResourceLoader(plan, {
    schedule(work) { const task = { work, cancelled: false }; tasks.push(task); return () => { task.cancelled = true; }; },
    fetch(source, init) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ source, init, resolve, reject }); return promise; },
    createObjectURL(blob) { const url = `blob:test-${created.length}`; created.push({ url, bytes: blob.size }); return url; },
    revokeObjectURL(url) { revoked.push(url); },
    ...options,
  });
  context.after(() => handle.dispose());
  const next = async () => { const task = tasks.find(task => !task.cancelled); if (!task) return false; task.cancelled = true; task.work(); await flush(); return true; };
  const complete = async (index, bytes = 4) => { requests[index].resolve(response(bytes)); await flush(); };
  return { handle, requests, created, revoked, next, complete };
}

test('waits for the selected product, deduplicates avatars shared with effects and finishes every core request before decoration discovery', async context => {
  const f = fixture(context, { core: ['/model.glb', '/label.webp', '/avatar.webp', '/model.glb'], effects: ['/avatar.webp', '/fruit.webp', '/splash.webp'] });
  assert.equal(f.handle.snapshot().phase, 'waiting'); assert.equal(await f.next(), false);
  f.handle.setEnabled(true); await f.next();
  assert.deepEqual(f.requests.map(r => r.source), ['/model.glb', '/label.webp']);
  assert.equal(f.requests[0].init.cache, 'force-cache'); assert.equal(f.requests[0].init.priority, 'low');
  await f.complete(1); await f.next(); assert.equal(f.requests[2].source, '/avatar.webp');
  await f.complete(2); assert.equal(await f.next(), false, 'Outstanding model still blocks the decoration stage');
  await f.complete(0); assert.equal(f.handle.snapshot().phase, 'effects'); await f.next();
  assert.deepEqual(f.requests.slice(3).map(r => r.source), ['/fruit.webp', '/splash.webp']);
  await f.complete(3); assert.notEqual(f.handle.snapshot().phase, 'ready');
  await f.complete(4); assert.deepEqual(f.handle.snapshot(), { phase: 'ready', completed: 5, total: 5, failed: 0, cachedBytes: 20 });
  assert.equal(f.created.length, 0, 'Downloading files does not create decoded images, textures or even Blob URLs');
});

test('failed core files block effects, retry only failures, and a failed effects file never announces ready', async context => {
  const f = fixture(context, { core: ['/good.glb', '/bad.webp'], effects: ['/fruit.webp'] });
  f.handle.setEnabled(true); await f.next(); await f.complete(0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.requests[attempt].reject(new Error('Offline')); await flush(); await f.next();
  }
  assert.equal(f.handle.snapshot().phase, 'error'); assert.equal(f.handle.snapshot().failed, 1);
  assert.ok(f.requests.every(r => r.source !== '/fruit.webp'));
  f.handle.retry(); await f.next(); await f.complete(4); await f.next();
  assert.equal(f.requests[5].source, '/fruit.webp');
  for (let attempt = 5; attempt <= 7; attempt++) { f.requests[attempt].resolve(new Response('Missing', { status: 404 })); await flush(); await f.next(); }
  assert.equal(f.handle.snapshot().phase, 'error');
  f.handle.retry(); await f.next(); await f.complete(8);
  assert.equal(f.handle.snapshot().phase, 'ready');
  assert.equal(f.requests.filter(r => r.source === '/good.glb').length, 1);
});

test('hidden/paused pages stop new work without cancelling or repeating completed transfers', async context => {
  const f = fixture(context, { core: ['/a.glb', '/b.webp', '/c.webp'], effects: ['/splash.webp'] }, { concurrency: 1 });
  f.handle.setEnabled(true); await f.next(); f.handle.setEnabled(false); await f.complete(0);
  assert.equal(await f.next(), false); assert.equal(f.requests[0].init.signal.aborted, false);
  f.handle.setEnabled(true); await f.next(); assert.equal(f.requests[1].source, '/b.webp');
  assert.equal(f.requests.filter(r => r.source === '/a.glb').length, 1);
});

test('compressed byte budget stays bounded, active leases survive eviction/disposal and revoke exactly once', async context => {
  const f = fixture(context, { core: ['/a.glb', '/b.webp', '/c.webp'], effects: ['/splash.webp'] }, { concurrency: 1, maxBytes: 8 });
  f.handle.setEnabled(true); await f.next(); await f.complete(0);
  const a = f.handle.acquireUrl('/a.glb'); await f.next(); await f.complete(1);
  const b = f.handle.acquireUrl('/b.webp'); b.release();
  await f.next(); await f.complete(2);
  assert.equal(f.handle.snapshot().cachedBytes, 8); assert.deepEqual(f.revoked, [b.url]);
  const a2 = f.handle.acquireUrl('/a.glb'); assert.equal(a2.url, a.url);
  f.handle.dispose(); assert.ok(!f.revoked.includes(a.url));
  a.release(); assert.ok(!f.revoked.includes(a.url)); a2.release(); a2.release();
  assert.equal(f.revoked.filter(url => url === a.url).length, 1);
  assert.equal(await f.next(), false);
});

test('disposal aborts active requests and late responses cannot update readiness or retain files', async context => {
  const updates = [];
  const f = fixture(context, { core: ['/can.glb'], effects: ['/fruit.webp'] }, { onProgress: p => updates.push(p) });
  f.handle.setEnabled(true); await f.next(); const before = updates.length;
  f.handle.dispose(); assert.equal(f.requests[0].init.signal.aborted, true); await f.complete(0);
  assert.equal(updates.length, before); assert.equal(f.handle.snapshot().cachedBytes, 0); assert.equal(f.created.length, 0);
});

test('published replacements get fresh HTTP cache keys while viewer leases retain canonical asset names and existing queries', async context => {
  const f = fixture(context, { core: ['/can.glb?variant=1'], effects: [] }, { cacheKey: 'release:2' });
  f.handle.setEnabled(true); await f.next();
  assert.equal(f.requests[0].source, '/can.glb?variant=1&vinut-release=release%3A2');
  await f.complete(0);
  const lease = f.handle.acquireUrl('/can.glb?variant=1');
  assert.match(lease.url, /^blob:/); lease.release();
  assert.equal(f.handle.snapshot().phase, 'ready');
});

test('published homepage plan includes every reachable label/model and every enabled random pool image, with admin switches respected', () => {
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/catalog/current.json'))).data.catalog;
  const products = catalogProducts(data), plan = createSceneResourcePlan(data, products);
  assert.equal(new Set([...plan.core, ...plan.effects]).size, plan.core.length + plan.effects.length);
  for (const product of products) {
    const scene = product.display3d && resolveDisplay3D(data, product.display3d);
    if (scene) { assert.ok(plan.core.includes(scene.asset.src)); assert.ok(plan.core.includes(scene.appearance.slots.label.baseColorMap)); }
    const avatar = mediaUrl(resolveFlavorFruitImage(data, product.flavor.id)); if (avatar) assert.ok(plan.core.includes(avatar));
  }
  const visibleFlavors = new Set(products.map(p => p.flavor.id));
  for (const asset of data.flavorAssets.filter(a => a.enabled && a.lifecycle === 'active' && visibleFlavors.has(a.flavorId))) {
    const media = data.media.find(m => m.id === asset.mediaId && m.status === 'ready' && m.lifecycle === 'active' && m.role === asset.role);
    if (media) assert.ok([...plan.core, ...plan.effects].includes(mediaUrl(media)), 'All alternatives are ready before future random selections');
  }
  const reduced = createSceneResourcePlan(data, products, decodeHomepageLayout('00000'));
  assert.deepEqual(reduced.core, plan.core); assert.deepEqual(reduced.effects, []);
  for (const url of [...plan.core, ...plan.effects]) {
    assert.ok(fs.existsSync(path.join(__dirname, '../../public', decodeURIComponent(url))), `Missing public file: ${url}`);
  }
  const onlyFirstLine = { ...data, productGroups: data.productGroups.map(g => ({ ...g, visible: g.id === products[0].group.id })) };
  assert.ok(createSceneResourcePlan(onlyFirstLine, catalogProducts(onlyFirstLine)).core.length < plan.core.length);
});

test('scene preference defaults on, persists off/on and acknowledgment, and works with blocked storage', () => {
  const modulePath = require.resolve('../../lib/viewer/scene-effects.ts');
  const savedWindow = global.window; const entries = new Map(), events = new Map();
  try {
    global.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
    delete require.cache[modulePath]; let prefs = require(modulePath);
    assert.equal(prefs.sceneEffectsSnapshot(), true); assert.equal(prefs.sceneHintSnapshot(), false);
    let notifications = 0; const stop = prefs.subscribeSceneEffects(() => notifications++);
    prefs.setSceneEffects(false); prefs.acknowledgeSceneHint(); assert.equal(notifications, 2); stop();
    delete require.cache[modulePath]; prefs = require(modulePath);
    assert.equal(prefs.sceneEffectsSnapshot(), false); assert.equal(prefs.sceneHintSnapshot(), true);
    prefs.setSceneEffects(true); assert.equal(entries.get(prefs.SCENE_EFFECTS_STORAGE_KEY), 'on');
    global.window.localStorage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
    delete require.cache[modulePath]; prefs = require(modulePath);
    assert.equal(prefs.sceneEffectsSnapshot(), true); prefs.setSceneEffects(false); prefs.acknowledgeSceneHint();
    assert.equal(prefs.sceneEffectsSnapshot(), false); assert.equal(prefs.sceneHintSnapshot(), true);
  } finally { global.window = savedWindow; delete require.cache[modulePath]; }
});
