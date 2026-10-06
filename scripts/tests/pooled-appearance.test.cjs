/* eslint-disable @typescript-eslint/no-require-imports -- Tests real material ownership with deferred image loads. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
function load(file, importer) {
  const text = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', js)(importer, loaded, loaded.exports); return loaded.exports;
}
const urls = load('lib/public-url.ts', require), config = load('lib/viewer-config.ts', require);
const appearance = id => ({ id, requiredSlots: ['label'], slots: { label: { baseColorMap: `/labels/${id}.webp`, roughness: .15 } } });
function fixture(context, options = {}) {
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
    throw new Error(name);
  });
  const pooling = load('lib/viewer/pooled-appearance.ts', name => name === 'three' ? THREE : legacy);
  const root = new THREE.Group(), original = new THREE.MeshPhysicalMaterial(); original.name = 'print';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); root.add(mesh);
  const handle = pooling.createPooledAppearanceHandle(root, { id: 'can', name: 'Can', src: '/can.glb', packaging: 'can', materialSlots: { label: ['print'] } }, {
    warmup: async prepared => { assert.equal(prepared.children[0].geometry, mesh.geometry); warmed.push(prepared.children[0].material.map); },
    onChange: (ready, pending) => reports.push({ ready, pending }), ...options,
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
