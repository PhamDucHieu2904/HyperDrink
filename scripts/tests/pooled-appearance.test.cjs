/* eslint-disable @typescript-eslint/no-require-imports -- Tests real material ownership with deferred image loads. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const materialAdjustments = require('../../lib/viewer/material-adjustments.ts');
function load(file, importer) {
  const text = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', js)(name => name === './material-adjustments' ? materialAdjustments : name === './bottle-backdrop' ? require('../../lib/viewer/bottle-backdrop.ts') : importer(name), loaded, loaded.exports); return loaded.exports;
}
const urls = load('lib/public-url.ts', require), config = load('lib/viewer-config.ts', require);
const aloeMaterials = load('lib/viewer/aloe-bottle-materials.ts', require);
const bottleMaterials = load('lib/viewer/bottle-materials.ts', name => name === './aloe-bottle-materials' ? aloeMaterials : name === './basil-bottle-materials' ? require('../../lib/viewer/basil-bottle-materials.ts') : name === './basil-web-materials' ? require('../../lib/viewer/basil-web-materials.ts') : require(name));
const appearance = id => ({ id, requiredSlots: ['label'], slots: { label: { baseColorMap: `/labels/${id}.webp`, roughness: .15 } } });
function fixture(context, options = {}) {
  const { importedTexture, ...poolOptions } = options;
  const requests = [], warmed = [], reports = [];
  class TextureLoader {
    loadAsync(url) {
      const texture = new THREE.Texture(); texture.disposals = 0;
      texture.addEventListener('dispose', () => texture.disposals++);
      let resolve, reject; const promise = new Promise((a, b) => { resolve = () => a(texture); reject = b; });
      requests.push({ url, resolve, reject, texture }); return promise;
    }
  }
  const legacy = load('lib/viewer/appearance.ts', name => {
    if (name === 'three') return { ...THREE, TextureLoader };
    if (name === '../public-url') return urls;
    if (name === '../viewer-config') return config;
    if (name === './bottle-materials') return bottleMaterials;
    throw new Error(name);
  });
  const pooling = load('lib/viewer/pooled-appearance.ts', name => name === 'three' ? THREE : name === './bottle-materials' ? bottleMaterials : legacy);
  const root = new THREE.Group(), original = new THREE.MeshPhysicalMaterial(); original.name = 'print';
  if (importedTexture) original.normalMap = importedTexture;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); root.add(mesh);
  const handle = pooling.createPooledAppearanceHandle(root, { id: 'can', name: 'Can', src: '/can.glb', packaging: 'can', materialSlots: { label: ['print'] } }, {
    warmup: async prepared => { assert.equal(prepared.children[0].geometry, mesh.geometry); warmed.push(prepared.children[0].material.map); },
    onChange: (ready, pending) => reports.push({ ready, pending }), ...poolOptions,
  });
  context.after(() => { handle.dispose(); mesh.geometry.dispose(); original.dispose(); });
  return { handle, mesh, original, requests, warmed, reports };
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
async function apply(f, id) { const promise = f.handle.apply(appearance(id)); f.requests.at(-1).resolve(); await promise; }

test('preparing neighbors shares geometry, leaves the visible label intact, and swaps a GPU-warmed set without loading again', async context => {
  const f = fixture(context); f.handle.setWindow(['a', 'b', 'c'].map(appearance)); await apply(f, 'a');
  const visible = f.mesh.material;
  const first = f.handle.prepare(appearance('b')), duplicate = f.handle.prepare(appearance('b'));
  assert.equal(f.requests.length, 2); f.requests[1].resolve(); await Promise.all([first, duplicate]);
  assert.equal(f.mesh.material, visible); assert.equal(f.warmed.length, 2); assert.ok(f.handle.has(appearance('b')));
  await f.handle.apply(appearance('b')); assert.equal(f.requests.length, 2); assert.equal(f.mesh.material.map, f.requests[1].texture);
  await f.handle.apply(appearance('a')); assert.equal(f.requests.length, 2); assert.equal(f.mesh.material, visible);
});

test('a cold selected appearance starts warmup as foreground without a background idle wait', async context => {
  let foregroundWarmups = 0, backgroundWarmups = 0;
  const f = fixture(context, { warmup: async (_root, _isCurrent, priority) => {
    if (priority.isForeground()) foregroundWarmups++;
    else backgroundWarmups++;
  } });
  f.handle.setWindow(['a', 'b'].map(appearance));
  await apply(f, 'a');
  assert.equal(foregroundWarmups, 1); assert.equal(backgroundWarmups, 0);
  const neighbor = f.handle.prepare(appearance('b')); f.requests[1].resolve(); await neighbor;
  assert.equal(foregroundWarmups, 1); assert.equal(backgroundWarmups, 1);
});

test('selecting a partially warmed neighbor wakes its idle yield without reloading or waiting for unrelated neighbors', async context => {
  const warmups = [], idleGates = new Map();
  const f = fixture(context, { warmup: async (root, _isCurrent, priority) => {
    const name = root.children[0].material.map.name;
    warmups.push({ name, foreground: priority.isForeground() });
    if (priority.isForeground()) return;
    // The first upload already finished; the remaining work waits for an idle
    // callback. Foreground selection must wake this exact task immediately.
    let releaseIdle;
    const idle = new Promise(resolve => { releaseIdle = resolve; });
    const unsubscribe = priority.onPromote(releaseIdle);
    idleGates.set(name, { releaseIdle, priority });
    try { await idle; }
    finally { unsubscribe(); }
  } });
  f.handle.setWindow(['a', 'b', 'c'].map(appearance));
  const initial = f.handle.apply(appearance('a')); f.requests[0].texture.name = 'a'; f.requests[0].resolve(); await initial;
  const visible = f.mesh.material;
  const first = f.handle.prepare(appearance('b')); f.requests[1].texture.name = 'b'; f.requests[1].resolve();
  const unrelated = f.handle.prepare(appearance('c')); f.requests[2].texture.name = 'c'; f.requests[2].resolve(); await settle();
  assert.equal(f.mesh.material, visible); assert.equal(f.handle.has(appearance('b')), false);
  assert.equal(idleGates.get('b').priority.isForeground(), false);
  const selected = f.handle.apply(appearance('b'));
  assert.equal(idleGates.get('b').priority.isForeground(), true, 'Promotion is synchronous');
  await settle();
  assert.equal(f.mesh.material.map, f.requests[1].texture, 'The selected label commits before either idle callback fires');
  assert.equal(f.requests.length, 3, 'Promotion reuses the already decoded neighbor texture');
  assert.deepEqual(warmups, [{ name: 'a', foreground: true }, { name: 'b', foreground: false }, { name: 'c', foreground: false }]);
  assert.equal(f.handle.has(appearance('c')), false, 'Unrelated background work stays pending');
  await Promise.all([first, selected]);
  idleGates.get('c').releaseIdle(); await unrelated;
  assert.equal(f.mesh.material.map, f.requests[1].texture, 'Completing another neighbor does not commit it');
});

test('foreground priority follows the newest selection while obsolete warming retains safe ownership', async context => {
  const gates = new Map();
  const f = fixture(context, { warmup: (root, _isCurrent, priority) => {
    const name = root.children[0].material.map.name;
    let finish;
    const promise = new Promise(resolve => { finish = resolve; });
    gates.set(name, { priority, finish });
    return promise;
  } });
  f.handle.setWindow(['a', 'b'].map(appearance));
  const first = f.handle.apply(appearance('a')); f.requests[0].texture.name = 'a'; f.requests[0].resolve(); await settle();
  assert.equal(gates.get('a').priority.isForeground(), true);
  const latest = f.handle.apply(appearance('b')); f.requests[1].texture.name = 'b'; f.requests[1].resolve(); await settle();
  assert.equal(gates.get('a').priority.isForeground(), false);
  assert.equal(gates.get('b').priority.isForeground(), true);
  gates.get('a').finish(); await first;
  assert.equal(f.mesh.material, f.original, 'An obsolete foreground request cannot commit');
  gates.get('b').finish(); await latest;
  assert.equal(f.mesh.material.map, f.requests[1].texture);
});

test('an oversized decoded neighbor is skipped before GPU warmup, remembered, and may still replace the pinned label', async context => {
  const f = fixture(context, { maxTextureBytes: 1500 });
  f.handle.setWindow(['a', 'b', 'c'].map(appearance));
  const first = f.handle.apply(appearance('a'));
  f.requests[0].texture.image = { width: 10, height: 10 }; f.requests[0].resolve(); await first;
  const visible = f.mesh.material;
  const oversized = f.handle.prepare(appearance('b'));
  f.requests[1].texture.image = { width: 20, height: 20 }; f.requests[1].resolve(); await oversized;
  assert.equal(f.warmed.length, 1, 'Oversized background texture never reaches GPU warmup');
  assert.equal(f.handle.has(appearance('b')), false); assert.equal(f.requests[1].texture.disposals, 1);
  assert.equal(f.mesh.material, visible); assert.equal(f.requests[0].texture.disposals, 0, 'Visible label stays pinned');
  await f.handle.prepare(appearance('b')); await f.handle.prepare(appearance('b'));
  assert.equal(f.requests.length, 2, 'The same inadmissible neighbor is not decoded repeatedly');
  const selected = f.handle.apply(appearance('b'));
  f.requests[2].texture.image = { width: 20, height: 20 }; f.requests[2].resolve(); await selected;
  assert.equal(f.mesh.material.map, f.requests[2].texture, 'Required replacement bypasses the background byte limit');
  assert.equal(f.requests[0].texture.disposals, 1, 'Outgoing label retires after oversized replacement commits');
  assert.equal(f.requests[2].texture.disposals, 0, 'An oversized selected label remains usable');
  const smaller = f.handle.apply(appearance('c'));
  f.requests[3].texture.image = { width: 10, height: 10 }; f.requests[3].resolve(); await smaller;
  assert.equal(f.requests[2].texture.disposals, 1); assert.equal(f.mesh.material.map, f.requests[3].texture);
  f.handle.dispose(); f.requests.forEach(request => assert.equal(request.texture.disposals, 1));
});

test('decoded budget includes mip allowance and evicts unpinned neighbors before uploading a selected replacement', async context => {
  const f = fixture(context, { maxTextureBytes: 1500 });
  f.handle.setWindow(['a', 'b', 'c'].map(appearance));
  const first = f.handle.apply(appearance('a')); f.requests[0].texture.image = { width: 10, height: 10 }; f.requests[0].resolve(); await first;
  const second = f.handle.prepare(appearance('b')); f.requests[1].texture.image = { width: 10, height: 10 }; f.requests[1].resolve(); await second;
  const third = f.handle.prepare(appearance('c')); f.requests[2].texture.image = { width: 10, height: 10 }; f.requests[2].resolve(); await third;
  assert.equal(f.warmed.length, 2, 'Three 400-byte RGBA maps would fit without mips; three 534-byte mip estimates must not');
  assert.equal(f.requests[2].texture.disposals, 1); assert.equal(f.requests[0].texture.disposals, 0);
  await f.handle.prepare(appearance('c')); assert.equal(f.requests.length, 3);
  const selected = f.handle.apply(appearance('c')); f.requests[3].texture.image = { width: 10, height: 10 }; f.requests[3].resolve(); await selected;
  assert.equal(f.requests[1].texture.disposals, 1, 'An unselected neighbor yields space to the new selected label');
  assert.equal(f.requests[0].texture.disposals, 0); assert.equal(f.requests[3].texture.disposals, 0);
  f.handle.dispose(); f.requests.forEach(request => assert.equal(request.texture.disposals, 1));
});

test('budget ignores shared imported textures and uses intrinsic image dimensions', async context => {
  const importedTexture = new THREE.Texture({ width: 2048, height: 2048 });
  let importedDisposals = 0; importedTexture.addEventListener('dispose', () => importedDisposals++);
  context.after(() => importedTexture.dispose());
  const f = fixture(context, { importedTexture, maxTextureBytes: 1200 });
  f.handle.setWindow(['a', 'b'].map(appearance));
  const first = f.handle.apply(appearance('a'));
  f.requests[0].texture.image = { naturalWidth: 10, naturalHeight: 10, width: 2048, height: 2048 }; f.requests[0].resolve(); await first;
  const second = f.handle.prepare(appearance('b'));
  f.requests[1].texture.image = { naturalWidth: 10, naturalHeight: 10, width: 2048, height: 2048 }; f.requests[1].resolve(); await second;
  assert.equal(f.handle.has(appearance('b')), true); assert.equal(f.warmed.length, 2);
  assert.equal(f.requests[0].texture.disposals, 0); assert.equal(f.requests[1].texture.disposals, 0);
  f.handle.dispose(); assert.equal(importedDisposals, 0, 'Shared model maps remain owned by the model');
});

test('moving the five-entry window pins the visible old label until replacement commits, then evicts it exactly once', async context => {
  const f = fixture(context); f.handle.setWindow(['a', 'b', 'c', 'd', 'e'].map(appearance)); await apply(f, 'a');
  for (const id of ['b', 'c', 'd', 'e']) { const promise = f.handle.prepare(appearance(id)); f.requests.at(-1).resolve(); await promise; }
  assert.equal(f.reports.at(-1).ready, 5);
  f.handle.setWindow(['f', 'g', 'h', 'i', 'j'].map(appearance));
  assert.equal(f.requests[0].texture.disposals, 0); assert.equal(f.mesh.material.map, f.requests[0].texture);
  f.requests.slice(1).forEach(request => assert.equal(request.texture.disposals, 1));
  await apply(f, 'f'); assert.equal(f.requests[0].texture.disposals, 1);
  for (const id of ['g', 'h', 'i', 'j']) { const promise = f.handle.prepare(appearance(id)); f.requests.at(-1).resolve(); await promise; }
  assert.ok(f.reports.every(value => value.ready + value.pending <= 5));
  f.handle.dispose(); f.handle.dispose(); assert.equal(f.mesh.material, f.original);
  f.requests.forEach(request => assert.equal(request.texture.disposals, 1));
});

test('rapid selection and obsolete prefetched completions never commit an old label or retain its texture', async context => {
  const f = fixture(context); f.handle.setWindow(['a', 'b', 'c'].map(appearance)); await apply(f, 'a');
  const slow = f.handle.apply(appearance('b'));
  f.handle.setWindow(['c'].map(appearance));
  const newest = f.handle.apply(appearance('c')); f.requests[2].resolve(); await newest;
  f.requests[1].resolve(); await slow;
  assert.equal(f.mesh.material.map, f.requests[2].texture); assert.equal(f.requests[1].texture.disposals, 1);
  assert.equal(f.requests[2].texture.disposals, 0);
});

test('a failed neighbor is retryable and does not alter the committed material', async context => {
  const f = fixture(context); f.handle.setWindow(['a', 'b'].map(appearance)); await apply(f, 'a');
  const visible = f.mesh.material, failed = f.handle.prepare(appearance('b'));
  f.requests[1].reject(new Error('missing')); await assert.rejects(failed);
  assert.equal(f.mesh.material, visible); assert.equal(f.handle.has(appearance('b')), false);
  await apply(f, 'b'); assert.equal(f.requests.length, 3); assert.equal(f.mesh.material.map, f.requests[2].texture);
});

test('disposal during download or shader warmup releases late results once and restores imported PBR', async context => {
  for (const duringWarmup of [false, true]) {
    let finishWarmup;
    const f = fixture(context, duringWarmup ? { warmup: () => new Promise(resolve => { finishWarmup = resolve; }) } : {});
    f.handle.setWindow([appearance('a')]); const pending = f.handle.apply(appearance('a'));
    if (duringWarmup) { f.requests[0].resolve(); await settle(); assert.ok(finishWarmup); }
    f.handle.dispose(); f.handle.dispose();
    if (duringWarmup) finishWarmup(); else f.requests[0].resolve();
    await pending; assert.equal(f.requests[0].texture.disposals, 1); assert.equal(f.mesh.material, f.original);
  }
});

test('cache URL leases are released after asynchronous texture decoding on success and failure', async context => {
  let acquired = 0, released = 0;
  const f = fixture(context, { acquireUrl: () => { acquired++; return { url: 'blob:prepared-file', release: () => released++ }; } });
  f.handle.setWindow(['a', 'b'].map(appearance));
  const first = f.handle.apply(appearance('a')); assert.equal(f.requests[0].url, 'blob:prepared-file'); assert.equal(released, 0);
  f.requests[0].resolve(); await first; assert.equal(released, 1);
  const failed = f.handle.prepare(appearance('b')); f.requests[1].reject(new Error('decode failed')); await assert.rejects(failed);
  assert.equal(acquired, 2); assert.equal(released, 2);
});

test('retiring an entry during shader polling keeps its material alive until warmup settles', async context => {
  let finishWarmup; let materialDisposals = 0;
  const f = fixture(context, { warmup: prepared => {
    prepared.children[0].material.addEventListener('dispose', () => materialDisposals++);
    return new Promise(resolve => { finishWarmup = resolve; });
  } });
  f.handle.setWindow([appearance('a')]); const pending = f.handle.apply(appearance('a'));
  f.requests[0].resolve(); await settle();
  f.handle.dispose();
  assert.equal(materialDisposals, 0, 'compileAsync must retain the material and its currentProgram');
  assert.equal(f.requests[0].texture.disposals, 0);
  assert.equal(f.mesh.material, f.original);
  finishWarmup(); await pending;
  assert.equal(materialDisposals, 1); assert.equal(f.requests[0].texture.disposals, 1);
});

test('window eviction cancels a compiling neighbor without disposing its material or committing its late result', async context => {
  let finishWarmup; let neighborDisposals = 0;
  const f = fixture(context, { capacity: 2, warmup: prepared => {
    if (!prepared.children[0].material.map.name.includes('neighbor')) return Promise.resolve();
    prepared.children[0].material.addEventListener('dispose', () => neighborDisposals++);
    return new Promise(resolve => { finishWarmup = resolve; });
  } });
  f.handle.setWindow(['a', 'b'].map(appearance)); await apply(f, 'a');
  const visible = f.mesh.material; const neighbor = f.handle.prepare(appearance('b'));
  f.requests[1].texture.name = 'compiling-neighbor'; f.requests[1].resolve(); await settle();
  f.handle.setWindow([appearance('c')]);
  assert.equal(neighborDisposals, 0); assert.equal(f.mesh.material, visible);
  await apply(f, 'c'); assert.equal(f.mesh.material.map, f.requests[2].texture);
  finishWarmup(); await neighbor;
  assert.equal(neighborDisposals, 1); assert.equal(f.requests[1].texture.disposals, 1);
  assert.equal(f.mesh.material.map, f.requests[2].texture);
  assert.equal(f.handle.has(appearance('b')), false);
});
