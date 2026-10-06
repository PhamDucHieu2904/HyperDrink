/* eslint-disable @typescript-eslint/no-require-imports -- Tests the shipped TypeScript with injected browser boundaries. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

function loadSource(file, importer = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(importer, loaded, loaded.exports);
  return loaded.exports;
}
const config = loadSource('lib/viewer-config.ts'), urls = loadSource('lib/public-url.ts');
const { createResourcePrefetcher } = loadSource('lib/viewer/resource-prefetch.ts', name => {
  if (name === '../public-url') return urls;
  if (name === '../viewer-config') return config;
  throw new Error(`Unexpected prefetch dependency: ${name}`);
});
const candidate = (label, model = '/can.glb', extra = {}) => ({
  asset: { id: model, name: 'Can', src: model, packaging: 'can' },
  appearance: { slots: { label: { baseColorMap: label, ...extra } } },
});
const response = (bytes = 2, headers) => ({ ok: true, headers: new Headers(headers), blob: async () => new Blob([new Uint8Array(bytes)]) });
async function flush() { await new Promise(resolve => setImmediate(resolve)); }

function fixture(context, options = {}) {
  const scheduled = [], requests = [], created = [], revoked = [], diagnostics = [];
  const deferred = options.deferred ?? false;
  const handle = createResourcePrefetcher({
    schedule(work) { const task = { work, cancelled: false }; scheduled.push(task); return () => { task.cancelled = true; }; },
    fetch(source, init) {
      let resolve, reject;
      const pending = new Promise((accept, fail) => { resolve = accept; reject = fail; });
      requests.push({ source, init, resolve, reject });
      return deferred ? pending : Promise.resolve(options.respond?.(source) ?? response());
    },
    createObjectURL(blob) { const url = `blob:test-${created.length}`; created.push({ url, blob }); return url; },
    revokeObjectURL(url) { revoked.push(url); },
    onDiagnostics(value) { diagnostics.push(value); },
    allowBackground: () => true,
    ...options,
  });
  context.after(() => handle.dispose());
  const next = async () => {
    const task = scheduled.find(value => !value.cancelled);
    if (!task) return false;
    task.cancelled = true; task.work(); await flush(); return true;
  };
  const drain = async () => { let count = 0; while (await next()) { if (++count > 100) throw new Error('Queue did not settle'); } };
  return { handle, requests, created, revoked, diagnostics, next, drain };
}

test('deduplicates shared model/maps, prefetches nearest-first and caps the candidate window at 21', async context => {
  const f = fixture(context);
  f.handle.configure(Array.from({ length: 25 }, (_, index) => candidate(`/label-${index}.webp`, '/can.glb', { normalMap: `/label-${index}.webp` })));
  assert.equal(f.requests.length, 0, 'Downloads wait for idle scheduling');
  await f.next();
  assert.deepEqual(f.requests.map(value => value.source), ['/can.glb']);
  assert.equal(f.requests[0].init.cache, 'force-cache');
  assert.equal(f.requests[0].init.credentials, 'same-origin');
  assert.equal(f.requests[0].init.priority, 'low');
  await f.drain();
  assert.deepEqual(f.requests.map(value => value.source), ['/can.glb', ...Array.from({ length: 21 }, (_, index) => `/label-${index}.webp`)]);
  assert.equal(f.diagnostics.at(-1).entries, 22);
  assert.ok(f.diagnostics.every(value => value.inFlight <= 1));
  assert.match(f.handle.resolveUrl('/label-0.webp'), /^blob:/);
  assert.equal(f.handle.resolveUrl('/label-21.webp'), '/label-21.webp');
});

test('caps distinct file count even when appearances contain several maps', async context => {
  const f = fixture(context);
  f.handle.configure(Array.from({ length: 21 }, (_, index) => candidate(`/label-${index}.webp`, `/can-${index}.glb`, {
    normalMap: `/normal-${index}.webp`, roughnessMap: `/rough-${index}.webp`,
  })));
  await f.drain();
  assert.equal(f.requests.length, 60);
  assert.equal(f.diagnostics.at(-1).entries, 60);
  assert.equal(f.handle.resolveUrl('/can-20.glb'), '/can-20.glb');
});

test('completed selected model/maps do not download again into the compressed Blob cache', async context => {
  const f = fixture(context);
  const selected = candidate('/selected.webp', '/selected.glb'), neighbor = candidate('/neighbor.webp', '/selected.glb');
  f.handle.configure([selected, neighbor]);
  f.handle.markLoaded('/selected.glb'); f.handle.markLoaded('/selected.webp');
  await f.drain();
  assert.deepEqual(f.requests.map(request => request.source), ['/neighbor.webp']);
  assert.equal(f.handle.acquireUrl('/selected.glb').url, '/selected.glb');
  assert.equal(f.handle.acquireUrl('/selected.webp').url, '/selected.webp');
  f.handle.configure([neighbor, selected]); await f.drain();
  assert.equal(f.requests.length, 1, 'Successful selected URLs survive a pure priority reorder');
  f.handle.configure([selected, neighbor]); await f.drain();
  assert.equal(f.requests.length, 1, 'An improved rank must not clear a successful selected-file marker');
});

test('completing a selected file aborts its duplicate in-flight prefetch and does not accept or retry a late response', async context => {
  const f = fixture(context, { deferred: true });
  f.handle.configure([candidate('/selected.webp', '/selected.glb'), candidate('/neighbor.webp', '/selected.glb')]);
  await f.next(); assert.equal(f.requests[0].source, '/selected.glb');
  f.handle.markLoaded('/selected.glb'); f.handle.markLoaded('/selected.webp');
  assert.equal(f.requests[0].init.signal.aborted, true);
  assert.equal(await f.next(), false, 'Wait for the aborted transport to settle instead of overlapping requests');
  f.requests[0].resolve(response()); await flush();
  assert.equal(f.created.length, 0);
  await f.next(); assert.equal(f.requests[1].source, '/neighbor.webp');
  f.requests[1].resolve(response()); await flush(); await f.drain();
  assert.deepEqual(f.requests.map(request => request.source), ['/selected.glb', '/neighbor.webp']);
});

test('marking a fetched file preserves its cached Blob and outstanding lease through retirement', async context => {
  const f = fixture(context);
  f.handle.configure([candidate('/a.webp')]); await f.drain();
  const lease = f.handle.acquireUrl('/a.webp');
  f.handle.markLoaded('/a.webp');
  assert.equal(f.handle.resolveUrl('/a.webp'), lease.url); assert.equal(f.revoked.includes(lease.url), false);
  f.handle.configure([candidate('/b.webp')]);
  assert.equal(f.revoked.includes(lease.url), false);
  lease.release(); lease.release();
  assert.equal(f.revoked.filter(url => url === lease.url).length, 1);
});

test('pure reorders retry only improved ranks, while changed membership can retry previously rejected files', async context => {
  const f = fixture(context, { maxBytes: 1, respond: source => response(source === '/can.glb' ? 1 : 2) });
  f.handle.configure([candidate('/a.webp'), candidate('/b.webp'), candidate('/c.webp')]); await f.drain();
  assert.deepEqual(f.requests.map(request => request.source), ['/can.glb', '/a.webp', '/b.webp', '/c.webp']);
  f.handle.configure([candidate('/a.webp'), candidate('/c.webp'), candidate('/b.webp')]); await f.drain();
  assert.deepEqual(f.requests.slice(4).map(request => request.source), ['/c.webp']);
  f.handle.configure([candidate('/a.webp'), candidate('/c.webp'), candidate('/b.webp')]); await f.drain();
  assert.equal(f.requests.length, 5, 'Stable rejected files do not churn');
  f.handle.configure([candidate('/a.webp'), candidate('/c.webp'), candidate('/d.webp')]); await f.drain();
  assert.deepEqual(f.requests.slice(5).map(request => request.source), ['/a.webp', '/c.webp', '/d.webp']);
  assert.ok(f.diagnostics.every(value => value.bytes <= 1));
});

test('byte budget preserves nearer files, stops instead of churning and moves with selection', async context => {
  const f = fixture(context, { maxBytes: 5, respond: source => response(source === '/can.glb' ? 1 : 2) });
  f.handle.configure([candidate('/a.webp'), candidate('/b.webp'), candidate('/c.webp')]);
  await f.drain();
  assert.equal(f.requests.length, 4);
  assert.equal(f.diagnostics.at(-1).bytes, 5);
  assert.match(f.handle.resolveUrl('/a.webp'), /^blob:/);
  assert.match(f.handle.resolveUrl('/b.webp'), /^blob:/);
  assert.equal(f.handle.resolveUrl('/c.webp'), '/c.webp');
  f.handle.configure([candidate('/a.webp'), candidate('/b.webp'), candidate('/c.webp')]);
  await f.drain(); assert.equal(f.requests.length, 4, 'Stable full windows do not repeatedly fetch dropped files');
  f.handle.configure([candidate('/c.webp'), candidate('/a.webp'), candidate('/b.webp')]);
  await f.drain();
  assert.match(f.handle.resolveUrl('/c.webp'), /^blob:/);
  assert.match(f.handle.resolveUrl('/a.webp'), /^blob:/);
  assert.equal(f.handle.resolveUrl('/b.webp'), '/b.webp');
  assert.ok(f.diagnostics.every(value => value.bytes <= 5));
});

test('obsolete downloads abort and cannot commit late responses into a new window', async context => {
  const f = fixture(context, { deferred: true });
  f.handle.configure([candidate('/a.webp', '/a.glb')]);
  await f.next();
  assert.equal(f.requests[0].source, '/a.glb');
  f.handle.configure([candidate('/b.webp', '/b.glb')]);
  assert.equal(f.requests[0].init.signal.aborted, true);
  assert.equal(await f.next(), false, 'Only one download remains in flight, even if transport ignores abort');
  f.requests[0].resolve(response()); await flush();
  assert.equal(f.created.length, 0);
  await f.next(); assert.equal(f.requests[1].source, '/b.glb');
  f.requests[1].resolve(response()); await flush();
  assert.match(f.handle.resolveUrl('/b.glb'), /^blob:/);
  assert.equal(f.handle.resolveUrl('/a.glb'), '/a.glb');
});

test('leases survive window eviction/disposal and revoke exactly once after the last loader releases', async context => {
  const f = fixture(context);
  f.handle.configure([candidate('/a.webp')]); await f.drain();
  const first = f.handle.acquireUrl('/a.webp'), second = f.handle.acquireUrl('/a.webp');
  assert.equal(first.url, second.url);
  f.handle.configure([candidate('/b.webp')]);
  assert.equal(f.handle.resolveUrl('/a.webp'), '/a.webp');
  assert.equal(f.revoked.includes(first.url), false);
  f.handle.dispose(); f.handle.dispose();
  assert.equal(f.revoked.includes(first.url), false);
  first.release(); first.release();
  assert.equal(f.revoked.includes(first.url), false);
  second.release(); second.release();
  assert.equal(f.revoked.filter(url => url === first.url).length, 1);
  assert.equal(f.diagnostics.at(-1).entries, 0);
  assert.equal(f.diagnostics.at(-1).bytes, 0);
});

test('disabled/offscreen prefetch aborts work, then resumes without overlapping downloads', async context => {
  const f = fixture(context, { deferred: true });
  f.handle.setEnabled(false); f.handle.configure([candidate('/a.webp')]);
  assert.equal(await f.next(), false);
  f.handle.setEnabled(true); await f.next();
  f.handle.setEnabled(false); assert.equal(f.requests[0].init.signal.aborted, true);
  f.handle.setEnabled(true); assert.equal(await f.next(), false);
  f.requests[0].resolve(response()); await flush();
  assert.equal(f.created.length, 0);
  await f.next(); assert.equal(f.requests.length, 2);
  f.handle.dispose();
  f.requests[1].resolve(response()); await flush();
  assert.equal(f.created.length, 0);
  assert.ok(f.diagnostics.every(value => value.inFlight <= 1));
});

test('a released retired lease lets a bounded cache retry files previously blocked by that lease', async context => {
  const f = fixture(context, { maxBytes: 3, respond: source => response(source === '/can.glb' ? 1 : 2) });
  f.handle.configure([candidate('/a.webp')]); await f.drain();
  const lease = f.handle.acquireUrl('/a.webp');
  f.handle.configure([candidate('/b.webp')]); await f.drain();
  assert.equal(f.handle.resolveUrl('/b.webp'), '/b.webp');
  lease.release(); await f.drain();
  assert.match(f.handle.resolveUrl('/b.webp'), /^blob:/);
  assert.ok(f.diagnostics.every(value => value.bytes <= 3));
});

test('slow-network opt-out and background failures leave normal URL loading available', async context => {
  const guarded = fixture(context, { allowBackground: () => false });
  guarded.handle.configure([candidate('/a.webp')]); await guarded.drain();
  assert.equal(guarded.requests.length, 0);
  assert.equal(guarded.handle.acquireUrl('/a.webp').url, '/a.webp');
  const f = fixture(context, { maxBytes: 3, respond: source => source === '/can.glb'
    ? new Response('', { status: 500 }) : response(4, { 'content-length': '4' }) });
  f.handle.configure([candidate('/a.webp')]); await f.drain();
  assert.equal(f.requests.length, 2); assert.equal(f.created.length, 0);
  assert.equal(f.handle.resolveUrl('/a.webp'), '/a.webp');
  f.handle.configure([candidate('/a.webp')]); await f.drain();
  assert.equal(f.requests.length, 2, 'A stable window does not hammer failed resources');
});

test('unsafe URLs are never fetched and deployment base paths are resolved once', async context => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink';
  try {
    const f = fixture(context);
    f.handle.configure([candidate('javascript:alert(1)', '/can.glb', { normalMap: '/HyperDrink/n.webp', roughnessMap: 'data:application/octet-stream;base64,abc' })]);
    await f.drain();
    assert.deepEqual(f.requests.map(value => value.source), ['/HyperDrink/can.glb', '/HyperDrink/n.webp']);
    assert.match(f.handle.resolveUrl('/can.glb'), /^blob:/);
    assert.equal(f.handle.acquireUrl('/missing.webp').url, '/HyperDrink/missing.webp');
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});
