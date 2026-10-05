/* eslint-disable @typescript-eslint/no-require-imports -- Node-only export integration tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { exportPublishedCatalog } = require('../export-public-catalog.cjs');
const { pathToFileURL } = require('node:url');

function fixture() {
  fs.mkdirSync(path.resolve('.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/static-catalog-test-'));
  const dataDir = path.join(root, 'private'), publicDir = path.join(root, 'public'), outputDir = path.join(publicDir, 'catalog');
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(publicDir, 'models'), { recursive: true });
  const bytes = Buffer.from('published image fixture'), hash = createHash('sha256').update(bytes).digest('hex');
  const key = `${hash}.webp`;
  fs.writeFileSync(path.join(dataDir, 'media', key), bytes);
  fs.writeFileSync(path.join(publicDir, 'models/can.glb'), 'static model');
  const catalog = { schemaVersion: 1, productGroups: [{ id: 'juice' }], productVariants: [{ id: 'orange' }], media: [
    { id: 'label', status: 'ready', lifecycle: 'active', url: '/api/public/v1/media/label', storageKey: key, sha256: hash, bytes: bytes.length },
    { id: 'model', status: 'ready', lifecycle: 'active', url: '/models/can.glb', storageKey: '', sha256: '', bytes: 12 },
  ] };
  const db = new DatabaseSync(path.join(dataDir, 'catalog.sqlite'));
  db.exec('CREATE TABLE releases(id TEXT,created_at TEXT,data TEXT); CREATE TABLE publication(id INTEGER,release_id TEXT); CREATE TABLE draft_catalog(data TEXT); CREATE TABLE admin_users(email TEXT,password_hash TEXT)');
  db.prepare('INSERT INTO releases VALUES(?,?,?)').run('release-1', '2026-10-02T07:00:00Z', JSON.stringify(catalog));
  db.exec("INSERT INTO publication VALUES(1,'release-1'); INSERT INTO draft_catalog VALUES('PRIVATE DRAFT'); INSERT INTO admin_users VALUES('PRIVATE ACCOUNT','PRIVATE HASH')");
  db.close();
  return { root, dataDir, publicDir, outputDir, key, catalog };
}

function cleanup(root) {
  assert.ok(path.resolve(root).startsWith(path.resolve('.tmp') + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
}

test('static export serves only active public release with standalone media and no private draft/account data', () => {
  const f = fixture();
  try {
    const report = exportPublishedCatalog(f);
    assert.equal(report.releaseId, 'release-1');
    const text = fs.readFileSync(path.join(f.outputDir, 'current.json'), 'utf8');
    assert.ok(!text.includes('PRIVATE'));
    const data = JSON.parse(text).data;
    assert.equal(data.catalog.media[0].url, `/catalog/media/${f.key}`);
    assert.equal(data.catalog.media[0].storageKey, '');
    assert.equal(data.catalog.media[1].url, '/models/can.glb');
    assert.ok(fs.readFileSync(path.join(f.outputDir, 'media', f.key)).equals(fs.readFileSync(path.join(f.dataDir, 'media', f.key))));
    assert.equal(exportPublishedCatalog(f).copiedFiles, 1);
  } finally { cleanup(f.root); }
});

test('a corrupt or missing media file cannot replace the last working public snapshot', () => {
  const f = fixture();
  try {
    exportPublishedCatalog(f);
    const previous = fs.readFileSync(path.join(f.outputDir, 'current.json'), 'utf8');
    fs.writeFileSync(path.join(f.dataDir, 'media', f.key), 'corrupt');
    assert.throws(() => exportPublishedCatalog(f), /checksum mismatch/);
    assert.equal(fs.readFileSync(path.join(f.outputDir, 'current.json'), 'utf8'), previous);
    fs.unlinkSync(path.join(f.dataDir, 'media', f.key));
    assert.throws(() => exportPublishedCatalog(f), /ENOENT/);
    assert.equal(fs.readFileSync(path.join(f.outputDir, 'current.json'), 'utf8'), previous);
  } finally { cleanup(f.root); }
});

test('an unpublished database has no public snapshot to export', () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(path.join(f.dataDir, 'catalog.sqlite'));
    db.exec('UPDATE publication SET release_id=NULL'); db.close();
    assert.throws(() => exportPublishedCatalog(f), /No active published catalog/);
    assert.equal(fs.existsSync(path.join(f.outputDir, 'current.json')), false);
  } finally { cleanup(f.root); }
});

test('committed standalone catalog includes readable media for every published pool assignment', () => {
  const publicDir = path.resolve('public');
  const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'catalog/current.json'), 'utf8')).data;
  const catalog = snapshot.catalog;
  for (const media of catalog.media) {
    assert.equal(media.storageKey, '', `Private media path leaked: ${media.id}`);
    assert.match(media.url, /^\/(catalog\/media|assets|models)\//);
    const filename = path.resolve(publicDir, `.${media.url}`);
    assert.ok(filename.startsWith(publicDir + path.sep));
    const bytes = fs.readFileSync(filename);
    assert.equal(bytes.length, media.bytes, media.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), media.sha256, media.id);
  }
  for (const assignment of catalog.flavorAssets) {
    assert.ok(catalog.flavors.some(flavor => flavor.id === assignment.flavorId));
    const media = catalog.media.find(item => item.id === assignment.mediaId);
    assert.ok(media, `Missing public pool image: ${assignment.id}`);
    assert.equal(media.role, assignment.role, assignment.id);
    assert.equal(media.status, 'ready'); assert.equal(media.lifecycle, 'active');
  }
});

test('local and Pages storefronts default to standalone data; an explicitly configured API retains live mode', async () => {
  const previousApi = process.env.NEXT_PUBLIC_ADMIN_API_URL, previousPages = process.env.GITHUB_PAGES;
  const configUrl = pathToFileURL(path.resolve('next.config.mjs')).href;
  try {
    delete process.env.NEXT_PUBLIC_ADMIN_API_URL;
    for (const pages of ['false', 'true']) {
      process.env.GITHUB_PAGES = pages;
      const { default: config } = await import(`${configUrl}?standalone=${pages}`);
      assert.equal(config.env.NEXT_PUBLIC_CATALOG_MODE, 'static');
    }
    process.env.NEXT_PUBLIC_ADMIN_API_URL = 'https://catalog.example.test';
    const { default: configured } = await import(`${configUrl}?standalone=hosted`);
    assert.equal(configured.env.NEXT_PUBLIC_CATALOG_MODE, 'api');
  } finally {
    if (previousApi === undefined) delete process.env.NEXT_PUBLIC_ADMIN_API_URL; else process.env.NEXT_PUBLIC_ADMIN_API_URL = previousApi;
    if (previousPages === undefined) delete process.env.GITHUB_PAGES; else process.env.GITHUB_PAGES = previousPages;
  }
});
