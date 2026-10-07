/* eslint-disable @typescript-eslint/no-require-imports -- Integration tests run the actual local TypeScript backend. */
require('../register-admin-typescript.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { LocalCatalogRepository } = require('../../lib/server/local-repository.ts');
const { createAdminHandler } = require('../../lib/server/admin-api.ts');
const { newEntity } = require('../../lib/catalog/seed.ts');
const { getMediaPath } = require('../../lib/server/media/upload.ts');
const { exportPublishedCatalog } = require('../export-public-catalog.cjs');
const project = path.resolve(__dirname, '../..');
const allowedOrigin = 'http://localhost:3100';
const owner = { email: 'owner@example.test', password: 'demo-owner-password-2026' };

async function withBackend(callback, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vinut-admin-api-'));
  let repository = new LocalCatalogRepository(folder);
  const staticOutputDir = path.join(folder, 'export/catalog');
  const handlerOptions = { allowedOrigins: [allowedOrigin], dataDir: folder, ...(options.syncPublicCatalog ? { syncPublicCatalog: () => exportPublishedCatalog({ dataDir: folder, outputDir: staticOutputDir }) } : {}) };
  let handle = createAdminHandler(repository, handlerOptions);
  let ownerCookie = '';
  const context = {
    folder,
    staticOutputDir,
    get repository() { return repository; },
    async request(endpoint, options = {}) {
      const method = options.method || 'GET';
      const headers = new Headers(options.headers);
      const origin = options.origin === undefined ? allowedOrigin : options.origin;
      if (origin !== null) headers.set('Origin', origin);
      const cookie = options.cookie === undefined ? ownerCookie : options.cookie;
      if (cookie) headers.set('Cookie', cookie);
      let body;
      if (options.form) body = options.form;
      else if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(options.body); }
      const response = await handle(new Request(`http://127.0.0.1:3010${endpoint}`, { method, headers, ...(body === undefined ? {} : { body }) }));
      const payload = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : null;
      return { response, payload };
    },
    async setup() {
      const result = await this.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '' });
      assert.equal(result.response.status, 201, JSON.stringify(result.payload));
      ownerCookie = result.response.headers.get('Set-Cookie').split(';')[0];
      assert.match(result.response.headers.get('Set-Cookie'), /HttpOnly/);
      return ownerCookie;
    },
    async save(collection, record, expectedRevision = null) {
      const result = await this.request('/api/admin/v1/record', { method: 'POST', body: { collection, record, expectedRevision } });
      assert.equal(result.response.status, 200, JSON.stringify(result.payload));
      return result.payload.data;
    },
    async upload(role = 'image-2d', assetName = 'citrus-preview.jpg') {
      const bytes = fs.readFileSync(path.join(project, 'public/assets/flavors', assetName));
      const form = new FormData(); form.set('role', role); form.set('file', new File([bytes], assetName, { type: 'image/jpeg' }));
      const result = await this.request('/api/admin/v1/upload', { method: 'POST', form });
      assert.equal(result.response.status, 201, JSON.stringify(result.payload));
      const media = result.payload.data;
      const runtimeBytes = fs.readFileSync(getMediaPath(media.storageKey, folder));
      assert.equal(runtimeBytes.length, media.bytes);
      assert.equal(createHash('sha256').update(runtimeBytes).digest('hex'), media.sha256);
      return { media, bytes: runtimeBytes, sourceBytes: bytes };
    },
    reopen() {
      repository.close(); repository = new LocalCatalogRepository(folder);
      handle = createAdminHandler(repository, handlerOptions);
    },
  };
  try { await callback(context); }
  finally {
    repository.close();
    const absolute = path.resolve(folder);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith('vinut-admin-api-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

async function createVisible2DProduct(context) {
  const { media, bytes } = await context.upload();
  let group = await context.save('productGroups', { ...newEntity('API test Juice 30%', 'api-test-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Juice 30%', position: 0, visible: false });
  const flavor = await context.save('flavors', { ...newEntity('API test citrus', 'api-test-flavor'), shortName: 'Citrus', description: '', accentColor: '#ee9933', backgroundColor: '#886622', textColor: '#ffffff', icon: 'citrus', thumbnailId: null, position: 0 });
  const variant = await context.save('productVariants', { ...newEntity('API citrus 330 ml', 'api-test-variant'), groupId: group.id, packagingVariantId: 'can-330', flavorId: flavor.id, code: 'API330', description: '', enabled: true });
  const asset = await context.save('assets2d', { ...newEntity('API citrus render', 'api-test-asset'), packagingVariantId: 'can-330', drinkTypeId: 'juice', flavorId: flavor.id, mediaId: media.id, galleryIds: [], description: '' });
  const display = await context.save('displays2d', { ...newEntity('API citrus display', 'api-test-display'), productVariantId: variant.id, assetId: asset.id, alt: 'Juice 30% citrus can 330 ml', enabled: true });
  const slot = await context.save('packagingSlots', { ...newEntity('API can slot', 'api-test-slot'), groupId: group.id, packagingVariantId: 'can-330', regionKey: 'packaging-picker', position: 0, buttonLabel: '330 ml', mode: '2d', defaultVariantId: variant.id, enabled: true });
  group = await context.save('productGroups', { ...group, visible: true }, group.revision);
  return { media, bytes, group, flavor, variant, asset, display, slot };
}

test('liquidColor survives record and display API saves, preflight and backend restart across nine draft displays', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const colors = [null, null, '#ff3e68', '#ff4430', '#ffb52e', '#ffb52e', '#5144ad', '#f783ad', '#f9a4be'];
  const displays = [];
  for (const [index, liquidColor] of colors.entries()) {
    const flavor = await context.save('flavors', { ...product.flavor, ...newEntity(`Liquid flavor ${index}`, `liquid-flavor-${index}`) });
    const variant = await context.save('productVariants', { ...product.variant, ...newEntity(`Liquid product ${index}`, `liquid-product-${index}`), flavorId: flavor.id, code: `LIQUID-${index}`, enabled: false });
    const display = await context.save('displays3d', { ...newEntity(`Liquid display ${index}`, `liquid-display-${index}`), productVariantId: variant.id, modelId: null, labelId: null, enabled: false, liquidColor });
    assert.equal(display.liquidColor, liquidColor);
    displays.push({ variant, display });
  }
  const target = displays[2];
  const saved = await context.request('/api/admin/v1/display', { method: 'POST', body: {
    mode: '3d', variant: target.variant, expectedVariantRevision: target.variant.revision,
    display: { ...target.display, liquidColor: '#ef315f' }, expectedDisplayRevision: target.display.revision,
    slot: null, expectedSlotRevision: null,
  } });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.data.display.liquidColor, '#ef315f');
  const before = await context.repository.readDraft();
  const invalid = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'displays3d', record: { ...saved.payload.data.display, liquidColor: 'pink' }, expectedRevision: saved.payload.data.display.revision } });
  assert.equal(invalid.response.status, 422);
  assert.deepEqual(await context.repository.readDraft(), before);
  context.reopen();
  assert.deepEqual(await context.repository.readDraft(), before);
  const checked = await context.request('/api/admin/v1/preflight');
  assert.equal(checked.response.status, 200);
  assert.deepEqual(checked.payload.data.filter(issue => issue.severity === 'error'), []);
}));

test('pool imports assign names, unique IDs, flavor and append order automatically; retries survive restart without duplicates', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const media = (await context.upload('fruit')).media;
  const input = { id: randomUUID(), flavorId: product.flavor.id, mediaId: media.id, role: 'fruit' };
  const denied = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', cookie: '', body: input });
  assert.equal(denied.response.status, 401);
  const initialCount = (await context.repository.readDraft()).flavorAssets.length;
  const first = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: input });
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  const saved = first.payload.data;
  assert.equal(saved.flavorId, product.flavor.id); assert.equal(saved.mediaId, media.id);
  assert.equal(saved.position, 0); assert.equal(saved.enabled, true); assert.equal(saved.revision, 1);
  assert.match(saved.name, /citrus-preview/); assert.ok(saved.name.includes(product.flavor.shortName));
  assert.equal(saved.slug, `pool-${input.id}`);
  context.reopen();
  const retry = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: input });
  assert.equal(retry.response.status, 200); assert.deepEqual(retry.payload.data, saved);
  assert.equal((await context.repository.readDraft()).flavorAssets.length, initialCount + 1);
  const leaf = (await context.upload('leaf')).media;
  const batch = await Promise.all(['fruit', 'leaf'].map(role => context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: { ...input, id: randomUUID(), role, mediaId: role === 'leaf' ? leaf.id : media.id } })));
  batch.forEach(result => assert.equal(result.response.status, 200, JSON.stringify(result.payload)));
  assert.deepEqual(batch.map(result => result.payload.data.position).sort(), [0, 1]);
  assert.equal((await context.repository.readActiveRelease()), null);
  const conflict = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: { ...input, role: 'leaf', mediaId: leaf.id } });
  assert.equal(conflict.response.status, 409);
  const audits = context.repository.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id=? AND action='save:flavorAssets'").get(input.id);
  assert.equal(audits.count, 1);
}));

test('reusable ice adopts a flavor pool atomically, deduplicates assignments and exports with the product', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const ice = (await context.upload('ice')).media;
  const filesBefore = fs.readdirSync(path.join(context.folder, 'media')).sort();
  const input = { id: randomUUID(), flavorId: product.flavor.id, mediaId: ice.id, role: 'ice' };
  const saved = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: input });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  const retry = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: { ...input, id: randomUUID() } });
  assert.deepEqual(retry.payload.data, saved.payload.data);
  const shared = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: { ...input, id: randomUUID(), flavorId: 'peach' } });
  assert.equal(shared.response.status, 200);
  let draft = await context.repository.readDraft();
  assert.equal(draft.flavors.find(flavor => flavor.id === product.flavor.id).icePoolConfigured, true);
  assert.equal(draft.flavors.find(flavor => flavor.id === product.flavor.id).revision, product.flavor.revision + 1);
  assert.equal(draft.flavorAssets.filter(asset => asset.mediaId === ice.id).length, 2);
  assert.deepEqual(fs.readdirSync(path.join(context.folder, 'media')).sort(), filesBefore);
  context.reopen(); assert.deepEqual(await context.repository.readDraft(), draft);
  const release = await context.repository.publish(draft, owner.email, 'Reusable ice', null);
  exportPublishedCatalog({ dataDir: context.folder, outputDir: context.staticOutputDir });
  const published = JSON.parse(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8')).data.catalog;
  assert.equal(published.media.filter(media => media.id === ice.id).length, 1);
  assert.match(published.media.find(media => media.id === ice.id).url, /^\/catalog\/media\//);
  assert.equal(published.flavors.find(flavor => flavor.id === product.flavor.id).icePoolConfigured, true);
  assert.equal(published.flavorAssets.filter(asset => asset.mediaId === ice.id).length, 1);
  const hash = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  await context.repository.deleteRecord('flavorAssets', saved.payload.data.id, saved.payload.data.revision, hash, owner.email);
  draft = await context.repository.readDraft();
  const { resolveFlavorScene } = require('../../lib/catalog/resolve.ts');
  assert.equal(resolveFlavorScene(draft, draft.flavors.find(flavor => flavor.id === product.flavor.id), 'deleted').nodes.filter(node => node.kind === 'ice').length, 0);
  assert.deepEqual(await context.repository.readActiveRelease(), release);
}));

test('pool rejects wrong-role, missing or archived resources and cannot accept manual metadata', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const fruit = (await context.upload('fruit')).media;
  const input = { id: randomUUID(), flavorId: product.flavor.id, mediaId: fruit.id, role: 'fruit' };
  for (const body of [{ ...input, role: 'leaf' }, { ...input, role: 'model' }, { ...input, flavorId: 'missing' }, { ...input, mediaId: 'missing' }, { ...input, id: '../../invalid' }, { ...input, position: 999, enabled: false, name: 'Manual' }]) {
    const rejected = await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body });
    assert.equal(rejected.response.status, 422, JSON.stringify(rejected.payload));
  }
  await context.save('media', { ...fruit, lifecycle: 'archived' }, fruit.revision);
  assert.equal((await context.request('/api/admin/v1/flavor-pool', { method: 'POST', body: input })).response.status, 422);
  assert.equal((await context.repository.readDraft()).flavorAssets.some(item => item.id === input.id), false);
}));

test('editorial 2D collections and items persist, check revisions and publish homepage toggles independently of hero', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const artwork = (await context.upload('label')).media;
  const label = await context.save('labels', { ...newEntity('Collection label', 'collection-label'), drinkTypeId: 'juice', flavorId: product.flavor.id, mediaId: artwork.id, compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] });
  const sample = JSON.parse(fs.readFileSync(path.join(project, 'docs/samples/product-detail-mangosteen.json'), 'utf8'));
  const detail = await context.save('productDetails', { ...newEntity('Collection detail', 'collection-detail'), ...sample, slug: 'collection-detail', labelId: label.id, posterId: null, headline: 'Citrus' });
  const collection = await context.save('catalogCollections', { ...newEntity('Summer Juice', 'summer-juice'), drinkTypeId: 'juice', position: 0, homeVisible: true, enabled: true });
  const item = await context.save('catalogItems', { ...newEntity('Citrus', 'collection-citrus'), collectionId: collection.id, mediaId: product.media.id, productDetailId: detail.id, packagingVariantId: 'can-330', position: 0, enabled: true });
  const denied = await context.request('/api/admin/v1/record', { method: 'POST', cookie: '', body: { collection: 'catalogCollections', record: collection, expectedRevision: collection.revision } });
  assert.equal(denied.response.status, 401);
  const hidden = await context.save('catalogCollections', { ...collection, homeVisible: false }, collection.revision);
  const stale = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'catalogCollections', record: collection, expectedRevision: collection.revision } });
  assert.equal(stale.response.status, 409);
  context.reopen(); assert.equal((await context.repository.readDraft()).catalogCollections[0].homeVisible, false);
  const published = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null, note: 'Independent 2D catalog' } });
  assert.equal(published.response.status, 201, JSON.stringify(published.payload));
  const release = await context.repository.readActiveRelease();
  assert.equal(release.data.catalogItems[0].id, item.id);
  assert.equal(release.data.catalogCollections[0].homeVisible, hidden.homeVisible);
  assert.equal(release.data.productGroups.find(group => group.id === product.group.id).visible, true);
  assert.ok(release.data.productDetails.some(record => record.id === detail.id));
  const exported = JSON.parse(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8')).data.catalog;
  assert.ok(exported.media.find(media => media.id === item.mediaId).url.startsWith('/catalog/media/'));
}, { syncPublicCatalog: true }));

test('product detail CRUD is authenticated, revision checked, published by label and retained in backups after deletion', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const labelMedia = (await context.upload('label')).media;
  const poster = (await context.upload('poster')).media;
  const catalog = await context.repository.readDraft();
  const baseModel = catalog.models3d.find(model => model.packagingVariantId === 'can-330');
  const model = await context.save('models3d', { ...baseModel, posterId: poster.id }, baseModel.revision);
  const label = await context.save('labels', { ...newEntity('Citrus label', 'api-detail-label'), drinkTypeId: 'juice', flavorId: product.flavor.id, mediaId: labelMedia.id, compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: model.layoutProfile }] });
  await context.save('packagingSlots', { ...product.slot, mode: '3d' }, product.slot.revision);
  await context.save('displays3d', { ...newEntity('Citrus 3D', 'api-detail-display'), productVariantId: product.variant.id, modelId: model.id, labelId: label.id, enabled: true });
  const sample = JSON.parse(fs.readFileSync(path.join(project, 'docs/samples/product-detail-mangosteen.json'), 'utf8'));
  const record = { ...newEntity('Citrus detail', 'api-product-detail'), ...sample, name: 'Citrus detail', slug: 'citrus-detail', labelId: label.id, posterId: poster.id, headline: 'Citrus' };
  const unauthorized = await context.request('/api/admin/v1/record', { method: 'POST', cookie: '', body: { collection: 'productDetails', record, expectedRevision: null } });
  assert.equal(unauthorized.response.status, 401);
  const saved = await context.save('productDetails', record);
  const stale = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'productDetails', record: { ...saved, introduction: 'Stale' }, expectedRevision: null } });
  assert.equal(stale.response.status, 409);
  context.reopen();
  assert.equal((await context.repository.readDraft()).productDetails[0].labelId, label.id);
  const publication = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null, note: 'Product detail backup' } });
  assert.equal(publication.response.status, 201, JSON.stringify(publication.payload));
  const active = await context.repository.readActiveRelease();
  assert.equal(active.data.productDetails[0].posterId, poster.id);
  const snapshot = exportPublishedCatalog({ dataDir: context.folder, outputDir: context.staticOutputDir });
  assert.ok(snapshot.media > 0);
  const exported = JSON.parse(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8'));
  assert.equal(exported.data.catalog.productDetails[0].headline, 'Citrus');
  assert.ok(exported.data.catalog.media.find(media => media.id === poster.id).url.startsWith('/catalog/media/'));
  const draftHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  await context.repository.deleteRecord('productDetails', saved.id, saved.revision, draftHash, 'owner@example.test');
  assert.equal((await context.repository.readDraft()).productDetails.length, 0);
  assert.equal((await context.repository.readActiveRelease()).data.productDetails[0].id, saved.id);
}, { syncPublicCatalog: true }));

test('collection settings persist through restart and publish a line independently of the Best seller button', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const group = await context.save('productGroups', { ...product.group, visible: false, collectionVisible: true, collectionTitle: 'Summer Juice', collectionPosition: 3 }, product.group.revision);
  context.reopen();
  assert.deepEqual((await context.repository.readDraft()).productGroups.find(item => item.id === group.id), group);
  const publication = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Collection-only line', expectedReleaseId: null } });
  assert.equal(publication.response.status, 201, JSON.stringify(publication.payload));
  const release = await context.repository.readActiveRelease();
  const publicGroup = release.data.productGroups.find(item => item.id === group.id);
  assert.equal(publicGroup.visible, false);
  assert.equal(publicGroup.collectionVisible, true);
  assert.equal(publicGroup.collectionTitle, 'Summer Juice');
  assert.equal(publicGroup.collectionPosition, 3);
  assert.ok(release.data.productVariants.some(item => item.id === product.variant.id));
  await context.save('productGroups', { ...group, collectionVisible: false }, group.revision);
  assert.deepEqual(await context.repository.readActiveRelease(), release, 'Draft changes do not alter the active website');
}));

test('display actions persist On/Off and deletion atomically, repair defaults and preserve the active public release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const publication = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Before card changes', expectedReleaseId: null } });
  assert.equal(publication.response.status, 201);
  const release = await context.repository.readActiveRelease();
  const sibling = await context.save('productVariants', { ...newEntity('Other lime', 'other-card-product'), groupId: product.group.id, packagingVariantId: 'can-330', flavorId: 'lime', code: '', description: '', enabled: true });
  const asset = await context.save('assets2d', { ...product.asset, ...newEntity('Other render', 'other-card-asset'), flavorId: 'lime' });
  const display = await context.save('displays2d', { ...product.display, ...newEntity('Other display', 'other-card-display'), productVariantId: sibling.id, assetId: asset.id });
  const act = async (id, action, enabled) => {
    const draft = await context.repository.readDraft();
    const record = draft.displays2d.find(item => item.id === id);
    return context.request('/api/admin/v1/display/action', { method: 'POST', body: { mode: '2d', id, action, enabled, expectedRevision: record.revision, expectedDraftHash: createHash('sha256').update(JSON.stringify(draft)).digest('hex') } });
  };
  const off = await act(product.display.id, 'set-enabled', false);
  assert.equal(off.response.status, 200, JSON.stringify(off.payload));
  assert.equal(off.payload.data.productVariants.find(item => item.id === product.variant.id).enabled, false);
  assert.equal(off.payload.data.packagingSlots.find(item => item.id === product.slot.id).defaultVariantId, sibling.id);
  assert.deepEqual((await context.repository.preflight()).filter(issue => issue.severity === 'error'), []);
  const on = await act(product.display.id, 'set-enabled', true);
  assert.equal(on.response.status, 200); assert.equal(on.payload.data.productVariants.find(item => item.id === product.variant.id).enabled, true);
  const removed = await act(display.id, 'delete');
  assert.equal(removed.response.status, 200, JSON.stringify(removed.payload));
  assert.equal(removed.payload.data.displays2d.some(item => item.id === display.id), false);
  assert.equal(removed.payload.data.packagingSlots.find(item => item.id === product.slot.id).defaultVariantId, product.variant.id);
  assert.equal(removed.payload.data.productVariants.find(item => item.id === sibling.id).enabled, false);
  assert.equal(removed.payload.data.assets2d.some(item => item.id === asset.id), true);
  assert.deepEqual(await context.repository.readActiveRelease(), release);
  assert.equal(context.repository.database.prepare('SELECT actor FROM audit_events WHERE action=? AND entity_id=?').get('delete:displays2d', display.id).actor, owner.email);
  context.reopen(); assert.deepEqual(await context.repository.readDraft(), removed.payload.data);
}));

test('display action API enforces authentication, full-draft conflict checks and transaction rollback', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const initial = await context.repository.readDraft();
  const body = { mode: '2d', id: product.display.id, action: 'set-enabled', enabled: false, expectedRevision: product.display.revision, expectedDraftHash: createHash('sha256').update(JSON.stringify(initial)).digest('hex') };
  const options = { method: 'POST', body };
  assert.equal((await context.request('/api/admin/v1/display/action', { ...options, cookie: '' })).response.status, 401);
  for (const origin of [null, 'https://untrusted.example']) assert.equal((await context.request('/api/admin/v1/display/action', { ...options, origin })).response.status, 403);
  for (const patch of [{ mode: 'media' }, { action: 'archive' }, { enabled: 'false' }, { expectedRevision: null }, { expectedDraftHash: undefined }]) assert.equal((await context.request('/api/admin/v1/display/action', { method: 'POST', body: { ...body, ...patch } })).response.status, 422);
  const auditCount = context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  context.repository.database.exec("CREATE TRIGGER reject_display_action BEFORE INSERT ON audit_events WHEN NEW.entity_id='api-test-display' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  assert.equal((await context.request('/api/admin/v1/display/action', options)).response.status, 500);
  assert.deepEqual(await context.repository.readDraft(), initial);
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, auditCount);
  context.repository.database.exec('DROP TRIGGER reject_display_action');
  await context.save('productGroups', { ...product.group, description: 'Changed in another tab' }, product.group.revision);
  const newer = await context.repository.readDraft();
  const stale = await context.request('/api/admin/v1/display/action', { method: 'POST', body: { ...body, action: 'delete' } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.error.code, 'revision_conflict');
  assert.deepEqual(await context.repository.readDraft(), newer);
  const staleRecord = await context.request('/api/admin/v1/display/action', { method: 'POST', body: { ...body, expectedRevision: body.expectedRevision + 1, expectedDraftHash: createHash('sha256').update(JSON.stringify(newer)).digest('hex') } });
  assert.equal(staleRecord.response.status, 409);
}));

test('atomic display API creates a distinct Lychee display when the old display was renamed Peach', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const old = await context.save('displays3d', { ...newEntity('Peach renamed from Lychee', 'old-peach-display'), slug: 'lychee-display', productVariantId: product.variant.id, modelId: 'registry-can-330', labelId: null, enabled: false });
  const variant = await context.save('productVariants', { ...newEntity('Lychee partial product', 'lychee-partial-product'), groupId: product.group.id, packagingVariantId: 'can-330', flavorId: 'lime', code: '', description: '', enabled: true });
  const input = { mode: '3d', variant, expectedVariantRevision: variant.revision, display: { ...newEntity('Lychee display', 'new-lychee-display'), slug: old.slug, productVariantId: variant.id, modelId: 'registry-can-330', labelId: null, enabled: true }, expectedDisplayRevision: null, slot: { ...product.slot, mode: 'auto' }, expectedSlotRevision: product.slot.revision };
  assert.equal((await context.request('/api/admin/v1/display', { method: 'POST', body: input, cookie: '' })).response.status, 401);
  assert.equal((await context.request('/api/admin/v1/display', { method: 'POST', body: input, origin: 'https://untrusted.example' })).response.status, 403);
  const result = await context.request('/api/admin/v1/display', { method: 'POST', body: input });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.data.display.slug, 'lychee-display-2');
  assert.deepEqual(result.payload.data.catalog.displays3d.find(item => item.id === old.id), old);
  assert.equal(result.payload.data.catalog.productVariants.filter(item => item.id === variant.id).length, 1);
  assert.equal(result.payload.data.catalog.packagingSlots.find(item => item.id === product.slot.id).mode, 'auto');
  assert.equal(context.repository.database.prepare("SELECT actor FROM audit_events WHERE entity_id='new-lychee-display'").get().actor, owner.email);
  context.reopen(); assert.deepEqual(await context.repository.readDraft(), result.payload.data.catalog);
  const beforeDuplicate = await context.repository.readDraft();
  const duplicate = await context.request('/api/admin/v1/display', { method: 'POST', body: { ...input, display: { ...input.display, id: 'duplicate-attempt' } } });
  assert.equal(duplicate.response.status, 422); assert.equal(duplicate.payload.error.code, 'display_exists');
  assert.deepEqual(await context.repository.readDraft(), beforeDuplicate);
}));

test('retargeting a display disables its orphaned old tuple, fixes the default and audits both owners without changing releases', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const release = await context.repository.publish(await context.repository.readDraft(), owner.email, 'Before flavor change', null);
  const flavor = await context.save('flavors', { ...product.flavor, ...newEntity('Dedicated citrus flavor', 'dedicated-citrus') });
  const asset = await context.save('assets2d', { ...product.asset, ...newEntity('Dedicated citrus render', 'dedicated-citrus-render'), flavorId: flavor.id });
  const input = {
    mode: '2d', variant: { ...product.variant, ...newEntity('Dedicated citrus product', 'dedicated-citrus-product'), flavorId: flavor.id, code: '' }, expectedVariantRevision: null,
    display: { ...product.display, productVariantId: 'dedicated-citrus-product', assetId: asset.id }, expectedDisplayRevision: product.display.revision,
    slot: null, expectedSlotRevision: null,
  };
  const before = await context.repository.readDraft();
  const auditBefore = context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  context.repository.database.exec("CREATE TRIGGER fail_old_owner_audit BEFORE INSERT ON audit_events WHEN NEW.action='save:productVariants' AND NEW.entity_id='api-test-variant' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  const failed = await context.request('/api/admin/v1/display', { method: 'POST', body: input });
  assert.equal(failed.response.status, 500);
  assert.deepEqual(await context.repository.readDraft(), before);
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, auditBefore);
  context.repository.database.exec('DROP TRIGGER fail_old_owner_audit');
  const result = await context.request('/api/admin/v1/display', { method: 'POST', body: input });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const catalog = result.payload.data.catalog;
  assert.equal(catalog.productVariants.find(item => item.id === product.variant.id).enabled, false);
  assert.equal(catalog.productVariants.find(item => item.id === input.variant.id).enabled, true);
  assert.equal(catalog.packagingSlots.find(item => item.id === product.slot.id).defaultVariantId, input.variant.id);
  assert.equal(catalog.displays2d.filter(item => item.id === product.display.id).length, 1);
  assert.equal(catalog.displays2d.find(item => item.id === product.display.id).productVariantId, input.variant.id);
  assert.deepEqual((await context.repository.preflight()).filter(issue => issue.severity === 'error'), []);
  for (const id of [product.variant.id, input.variant.id]) assert.equal(context.repository.database.prepare("SELECT actor FROM audit_events WHERE entity_id=? AND action='save:productVariants' ORDER BY created_at DESC LIMIT 1").get(id).actor, owner.email);
  assert.deepEqual(await context.repository.readActiveRelease(), release);
  for (const collection of ['media', 'flavors', 'labels', 'models3d', 'assets2d']) assert.deepEqual(catalog[collection], before[collection]);
  context.reopen(); assert.deepEqual(await context.repository.readDraft(), catalog);
  assert.deepEqual(await context.repository.readActiveRelease(), release);
  const retry = await context.request('/api/admin/v1/display', { method: 'POST', body: input });
  assert.equal(retry.response.status, 409);
  assert.deepEqual(await context.repository.readDraft(), catalog);
}));

test('a late slot error rolls back the complete 2D save, with no partial product/display or audit entries', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const input = { mode: '2d', variant: { ...newEntity('Atomic new Lime', 'atomic-new-lime'), groupId: product.group.id, packagingVariantId: 'can-330', flavorId: 'lime', code: '', description: '', enabled: true }, expectedVariantRevision: null, display: { ...newEntity('Atomic new display', 'atomic-new-display'), productVariantId: 'atomic-new-lime', assetId: product.asset.id, alt: '', enabled: true }, expectedDisplayRevision: null, slot: { ...product.slot, buttonLabel: 'Changed in panel' }, expectedSlotRevision: product.slot.revision + 1 };
  const before = await context.repository.readDraft();
  const auditBefore = context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  const failure = await context.request('/api/admin/v1/display', { method: 'POST', body: input });
  assert.equal(failure.response.status, 409); assert.equal(failure.payload.error.code, 'revision_conflict');
  assert.deepEqual(await context.repository.readDraft(), before);
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, auditBefore);
  const saved = await context.request('/api/admin/v1/display', { method: 'POST', body: { ...input, expectedSlotRevision: product.slot.revision } });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.payload));
  assert.equal(saved.payload.data.catalog.productVariants.some(item => item.id === input.variant.id), true);
  assert.equal(saved.payload.data.catalog.displays2d.some(item => item.id === input.display.id), true);
  const beforeMalformed = await context.repository.readDraft();
  for (const body of [null, {}, { ...input, mode: 'media' }, { ...input, expectedVariantRevision: undefined }]) assert.equal((await context.request('/api/admin/v1/display', { method: 'POST', body })).response.status, 422);
  assert.deepEqual(await context.repository.readDraft(), beforeMalformed);
}));

test('delete API removes a failing default product with owned displays, preserves the release and persists its audit', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const published = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Deletion fixture', expectedReleaseId: null } });
  assert.equal(published.response.status, 201, JSON.stringify(published.payload));
  const originalRelease = await context.repository.readActiveRelease();
  const broken = await context.save('productVariants', { ...newEntity('Delete test missing display', 'delete-test-product'), groupId: product.group.id, packagingVariantId: 'can-330', flavorId: 'lime', code: '', description: '', enabled: true });
  const display = await context.save('displays3d', { ...newEntity('Delete test disabled 3D', 'delete-test-display'), productVariantId: broken.id, modelId: null, labelId: null, enabled: false });
  const slot = await context.save('packagingSlots', { ...product.slot, defaultVariantId: broken.id }, product.slot.revision);
  const draft = await context.repository.readDraft();
  const body = { collection: 'productVariants', id: broken.id, expectedRevision: broken.revision, expectedDraftHash: createHash('sha256').update(JSON.stringify(draft)).digest('hex') };
  assert.equal((await context.request('/api/admin/v1/delete', { method: 'POST', body, cookie: '' })).response.status, 401);
  assert.equal((await context.request('/api/admin/v1/delete', { method: 'POST', body, origin: 'https://untrusted.example' })).response.status, 403);
  const result = await context.request('/api/admin/v1/delete', { method: 'POST', body });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload.data.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(result.payload.data.issues, await context.repository.preflight());
  assert.equal(result.payload.data.catalog.productVariants.some(item => item.id === broken.id), false);
  assert.equal(result.payload.data.catalog.displays3d.some(item => item.id === display.id), false);
  const updatedSlot = result.payload.data.catalog.packagingSlots.find(item => item.id === slot.id);
  assert.equal(updatedSlot.defaultVariantId, product.variant.id); assert.equal(updatedSlot.revision, slot.revision + 1);
  assert.deepEqual(await context.repository.readActiveRelease(), originalRelease);
  assert.equal(fs.existsSync(getMediaPath(product.media.storageKey, context.folder)), true);
  for (const collection of ['flavors', 'media', 'labels', 'models3d', 'assets2d']) assert.deepEqual(result.payload.data.catalog[collection], draft[collection]);
  const audit = context.repository.database.prepare("SELECT actor, action, entity_id FROM audit_events WHERE action LIKE 'delete:%'").all();
  assert.equal(audit.length, 2); assert.equal(audit.every(item => item.actor === owner.email), true);
  context.reopen();
  assert.deepEqual(await context.repository.readDraft(), result.payload.data.catalog);
}));

test('delete API rejects unconfirmed and stale-scope requests but accepts an incomplete draft atomically', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const draft = await context.repository.readDraft();
  const hash = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  const body = { collection: 'productVariants', id: product.variant.id, expectedRevision: product.variant.revision, expectedDraftHash: hash };
  for (const patch of [{ expectedDraftHash: undefined }, { expectedDraftHash: 'invalid' }, { expectedRevision: null }, { expectedRevision: 0 }]) {
    assert.equal((await context.request('/api/admin/v1/delete', { method: 'POST', body: { ...body, ...patch } })).response.status, 422);
  }
  assert.deepEqual(await context.repository.readDraft(), draft);
  const changed = await context.save('productGroups', { ...product.group, description: 'Changed while confirmation is open' }, product.group.revision);
  const newer = await context.repository.readDraft();
  const stale = await context.request('/api/admin/v1/delete', { method: 'POST', body });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.error.code, 'revision_conflict');
  assert.equal(changed.revision, product.group.revision + 1); assert.deepEqual(await context.repository.readDraft(), newer);
  assert.equal(context.repository.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action LIKE 'delete:%'").get().count, 0);
  const removed = await context.request('/api/admin/v1/delete', { method: 'POST', body: { ...body, expectedDraftHash: createHash('sha256').update(JSON.stringify(newer)).digest('hex') } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.payload));
  assert.ok(removed.payload.data.issues.some(issue => issue.severity === 'error'));
  assert.equal(removed.payload.data.catalog.productVariants.some(item => item.id === product.variant.id), false);
  assert.deepEqual(await context.repository.readDraft(), removed.payload.data.catalog);
  assert.equal((await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } })).response.status, 422, 'Preflight still protects the live site');
}));

test('deleting a used library asset keeps its released backup, clears draft references and audits the entire change', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const published = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } });
  assert.equal(published.response.status, 201);
  const release = await context.repository.readActiveRelease(), draft = await context.repository.readDraft();
  const asset = draft.assets2d.find(item => item.id === product.asset.id);
  const removed = await context.request('/api/admin/v1/delete', { method: 'POST', body: { collection: 'assets2d', id: asset.id, expectedRevision: asset.revision, expectedDraftHash: createHash('sha256').update(JSON.stringify(draft)).digest('hex') } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.payload));
  assert.equal(removed.payload.data.catalog.displays2d.find(item => item.productVariantId === product.variant.id).assetId, null);
  assert.ok(removed.payload.data.issues.some(issue => issue.severity === 'error'));
  assert.deepEqual(await context.repository.readActiveRelease(), release);
  assert.equal((await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' })).response.status, 200);
  const audit = context.repository.database.prepare("SELECT action, actor FROM audit_events WHERE action='delete:assets2d' OR (action='save:displays2d' AND actor=?)").all(owner.email);
  assert.ok(audit.some(item => item.action === 'delete:assets2d' && item.actor === owner.email));
  assert.ok(audit.some(item => item.action === 'save:displays2d'));
  const unchanged = await context.repository.readDraft();
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: release.id, expectedReleaseId: release.id } })).response.status, 200);
  assert.deepEqual(await context.repository.readDraft(), unchanged, 'Rollback uses the released snapshot without overwriting current draft edits');
  context.reopen(); assert.deepEqual(await context.repository.readActiveRelease(), release);
}));

test('history retains at most ten releases; manual deletion frees a slot and retries and rollback work at capacity', async () => withBackend(async context => {
  await context.setup(); await createVisible2DProduct(context);
  const firstOptions = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Backup 1', expectedReleaseId: null } };
  const first = await context.request('/api/admin/v1/publish', firstOptions);
  assert.equal(first.response.status, 201);
  const ids = [first.payload.data.id]; let active = ids[0];
  for (let i = 2; i <= 10; i++) {
    const result = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: `Backup ${i}`, expectedReleaseId: active } });
    assert.equal(result.response.status, 201, JSON.stringify(result.payload));
    active = result.payload.data.id; ids.push(active);
  }
  const releases = await context.repository.listReleases(), draft = await context.repository.readDraft();
  const auditCount = context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
  const exportBefore = fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8');
  const fullOptions = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Backup 11', expectedReleaseId: active } };
  const blocked = await context.request('/api/admin/v1/publish', fullOptions);
  assert.equal(blocked.response.status, 422); assert.equal(blocked.payload.error.code, 'release_limit_reached');
  assert.match(blocked.payload.error.message, /10\/10/);
  assert.deepEqual(await context.repository.listReleases(), releases);
  assert.deepEqual(await context.repository.readDraft(), draft);
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, auditCount);
  assert.equal(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8'), exportBefore);
  assert.equal((await context.request('/api/admin/v1/publish', firstOptions)).payload.data.id, ids[0], 'Existing successful retries work at capacity');
  assert.equal((await context.repository.readActiveRelease()).id, active, 'An old retry does not reactivate an old backup');
  const rollback = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: ids[0], expectedReleaseId: active } });
  assert.equal(rollback.response.status, 200);
  assert.equal((await context.repository.listReleases()).length, 10, 'Rollback consumes no history slot');
  const activeDelete = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: ids[0], expectedReleaseId: ids[0] } });
  assert.equal(activeDelete.response.status, 422);
  const deletion = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: ids[1], expectedReleaseId: ids[0] } });
  assert.equal(deletion.response.status, 200);
  assert.equal((await context.repository.listReleases()).length, 9);
  const next = await context.request('/api/admin/v1/publish', { ...fullOptions, body: { ...fullOptions.body, expectedReleaseId: ids[0] } });
  assert.equal(next.response.status, 201, JSON.stringify(next.payload));
  assert.equal((await context.repository.listReleases()).length, 10);
  const removedRetry = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: next.payload.data.id } });
  assert.equal(removedRetry.payload.error.code, 'release_limit_reached');
  context.reopen(); assert.equal((await context.repository.listReleases()).length, 10);
}, { syncPublicCatalog: true }));

test('anonymous requests and untrusted origins cannot read or write the admin catalog', async () => withBackend(async context => {
  const initial = await context.request('/api/admin/v1/session', { cookie: '' });
  assert.equal(initial.payload.data.needsSetup, true); assert.equal(initial.payload.data.session, null);
  assert.equal((await context.request('/api/admin/v1/catalog', { cookie: '' })).response.status, 401);
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).response.status, 404);
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '', origin: 'https://untrusted.example' })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner, cookie: '', origin: null })).response.status, 403);
  const preflight = await context.request('/api/admin/v1/setup', { method: 'OPTIONS', cookie: '' });
  assert.equal(preflight.response.status, 204); assert.equal(preflight.response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  await context.setup();
  assert.equal((await context.request('/api/admin/v1/catalog', { origin: 'https://untrusted.example' })).response.status, 403);
  const catalog = await context.request('/api/admin/v1/catalog');
  assert.equal(catalog.response.status, 200); assert.equal(catalog.payload.data.session.role, 'owner');
  assert.equal((await context.request('/api/admin/v1/setup', { method: 'POST', body: owner })).response.status, 422);
}));

test('draft CRUD persists across database reopen and stale changes produce HTTP 409', async () => withBackend(async context => {
  await context.setup();
  const record = await context.save('drinkTypes', { ...newEntity('API test tea', 'api-test-tea'), description: 'Draft record', position: 20 });
  assert.equal(record.revision, 1);
  const saved = await context.save('drinkTypes', { ...record, description: 'New description' }, 1);
  assert.equal(saved.revision, 2);
  const stale = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'drinkTypes', record: { ...record, description: 'Stale overwrite' }, expectedRevision: 1 } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.error.code.toLowerCase(), 'revision_conflict');
  context.reopen();
  const reload = await context.request('/api/admin/v1/catalog');
  assert.equal(reload.response.status, 200, 'Persistent owner session remains valid');
  const persistent = reload.payload.data.catalog.drinkTypes.find(item => item.id === record.id);
  assert.equal(persistent.description, 'New description'); assert.equal(persistent.revision, 2);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', body: { collection: 'drinkTypes', id: record.id, expectedRevision: 2 } });
  assert.equal(archive.response.status, 200);
  context.reopen();
  assert.equal((await context.repository.readDraft()).drinkTypes.find(item => item.id === record.id).lifecycle, 'archived');
}));

test('trusted media metadata must come from file inspection and cannot be forged through CRUD', async () => withBackend(async context => {
  await context.setup();
  const forged = { ...newEntity('Forged media', 'forged-media'), role: 'image-2d', status: 'ready', url: '/api/public/v1/media/forged-media', storageKey: `${'a'.repeat(64)}.jpg`, mime: 'image/jpeg', bytes: 12, sha256: 'a'.repeat(64), width: 100, height: 100, imageBounds: null, error: '' };
  const creation = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'media', record: forged, expectedRevision: null } });
  assert.equal(creation.response.status, 422); assert.equal(creation.payload.error.code, 'MEDIA_UPLOAD_REQUIRED');
  const { media } = await context.upload();
  for (const patch of [{ status: 'processing' }, { mime: 'text/html' }, { storageKey: `${'b'.repeat(64)}.jpg` }, { sha256: 'b'.repeat(64) }, { url: 'https://uninspected.example/file.jpg' }, { role: 'label' }]) {
    const result = await context.request('/api/admin/v1/record', { method: 'POST', body: { collection: 'media', record: { ...media, ...patch }, expectedRevision: media.revision } });
    assert.equal(result.response.status, 422); assert.equal(result.payload.error.code, 'MEDIA_IMMUTABLE');
  }
  const renamed = await context.save('media', { ...media, name: 'Human-facing artwork name' }, media.revision);
  assert.equal(renamed.name, 'Human-facing artwork name'); assert.equal(renamed.storageKey, media.storageKey);
  assert.equal((await context.request(`/api/public/v1/media/${media.id}`, { cookie: '' })).response.status, 404, 'Unpublished upload remains private');
  const preview = await context.request(`/api/public/v1/media/${media.id}`);
  assert.equal(preview.response.status, 200); assert.match(preview.response.headers.get('Cache-Control'), /private/);
}));

test('button reorder checks every revision in its group and does not change another group', async () => withBackend(async context => {
  await context.setup();
  const group = await context.save('productGroups', { ...newEntity('Reorder group', 'reorder-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Order test', position: 20, visible: false });
  const otherGroup = await context.save('productGroups', { ...newEntity('Other group', 'other-order-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Other order test', position: 21, visible: false });
  const makeSlot = (id, groupId, packagingVariantId, position) => ({ ...newEntity(id, id), groupId, packagingVariantId, regionKey: 'packaging-picker', position, buttonLabel: id, mode: '2d', defaultVariantId: null, enabled: true });
  const first = await context.save('packagingSlots', makeSlot('order-slot-330', group.id, 'can-330', 0));
  const second = await context.save('packagingSlots', makeSlot('order-slot-250', group.id, 'can-250', 1));
  const unrelated = await context.save('packagingSlots', makeSlot('other-order-slot', otherGroup.id, 'can-330', 0));
  const revisions = { [first.id]: first.revision, [second.id]: second.revision };
  const result = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'down', expectedRevisions: revisions } });
  assert.equal(result.response.status, 200);
  const slots = result.payload.data.packagingSlots;
  assert.equal(slots.find(slot => slot.id === first.id).position, 1); assert.equal(slots.find(slot => slot.id === second.id).position, 0);
  assert.equal(slots.find(slot => slot.id === first.id).revision, 2); assert.equal(slots.find(slot => slot.id === second.id).revision, 2);
  assert.equal(slots.find(slot => slot.id === unrelated.id).revision, unrelated.revision); assert.equal(slots.find(slot => slot.id === unrelated.id).position, unrelated.position);
  const stale = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'up', expectedRevisions: revisions } });
  assert.equal(stale.response.status, 409);
  const missingRevisions = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'packagingSlots', id: first.id, direction: 'up' } });
  assert.equal(missingRevisions.response.status, 409);
  const persisted = await context.repository.readDraft();
  assert.equal(persisted.packagingSlots.find(slot => slot.id === first.id).position, 1);
  assert.equal(persisted.packagingSlots.find(slot => slot.id === first.id).revision, 2);
}));

test('2D operational workflow publishes an immutable reachable graph, then updates and rolls back safely', async () => withBackend(async context => {
  await context.setup();
  const product = await createVisible2DProduct(context);
  const preflight = await context.request('/api/admin/v1/preflight');
  assert.equal(preflight.response.status, 200); assert.deepEqual(preflight.payload.data.filter(issue => issue.severity === 'error'), []);
  const publish = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'First 2D release', expectedReleaseId: null } });
  assert.equal(publish.response.status, 201, JSON.stringify(publish.payload));
  const first = publish.payload.data;
  const publicRead = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(publicRead.response.status, 200); assert.equal(publicRead.payload.data.releaseId, first.id);
  const publicCatalog = publicRead.payload.data.catalog;
  assert.equal(publicCatalog.productGroups.length, 1); assert.equal(publicCatalog.productGroups[0].buttonLabel, 'Juice 30%');
  assert.equal(publicCatalog.models3d.length, 0); assert.equal(publicCatalog.labels.length, 0);
  assert.equal(publicCatalog.media.length, 1); assert.equal(publicCatalog.media[0].id, product.media.id);
  assert.equal(publicCatalog.packagingCategories.length, 1); assert.equal(publicCatalog.drinkTypes.length, 1);
  const media = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
  assert.equal(media.response.status, 200); assert.match(media.response.headers.get('Cache-Control'), /immutable/);
  assert.equal(media.response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await media.response.arrayBuffer()), product.bytes);
  const edited = await context.save('productGroups', { ...product.group, buttonLabel: 'Juice 50%' }, product.group.revision);
  assert.equal(edited.buttonLabel, 'Juice 50%');
  const whileDraft = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(whileDraft.payload.data.catalog.productGroups[0].buttonLabel, 'Juice 30%');
  const publish2 = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Second release', expectedReleaseId: first.id } });
  assert.equal(publish2.response.status, 201); const second = publish2.payload.data;
  assert.notEqual(second.id, first.id);
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.productGroups[0].buttonLabel, 'Juice 50%');
  const stalePublish = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.id } });
  assert.equal(stalePublish.response.status, 409);
  const rollback = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(rollback.response.status, 200);
  context.reopen();
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.productGroups[0].buttonLabel, 'Juice 30%');
  assert.equal((await context.repository.readDraft()).productGroups.find(item => item.id === product.group.id).buttonLabel, 'Juice 50%');
  const history = await context.request('/api/admin/v1/catalog');
  assert.equal(history.payload.data.releases.length, 2); assert.equal(history.payload.data.activeReleaseId, first.id);
}));

test('editor sessions cannot publish, rollback or delete releases and owner logout revokes access', async () => withBackend(async context => {
  const ownerCookie = await context.setup();
  const id = randomUUID();
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(id, 'editor@example.test', '0'.repeat(128), 'test-salt', 'editor');
  const token = context.repository.createSession({ userId: id, email: 'editor@example.test', role: 'editor' });
  const editorCookie = `vinut_admin_session=${token}`;
  const editRead = await context.request('/api/admin/v1/catalog', { cookie: editorCookie });
  assert.equal(editRead.response.status, 200);
  assert.equal((await context.request('/api/admin/v1/publish', { method: 'POST', cookie: editorCookie, body: { expectedReleaseId: null } })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', cookie: editorCookie, body: { releaseId: 'any', expectedReleaseId: null } })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/releases/delete', { method: 'POST', cookie: editorCookie, body: { releaseId: 'any', expectedReleaseId: null } })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/logout', { method: 'POST', cookie: ownerCookie })).response.status, 200);
  assert.equal((await context.request('/api/admin/v1/catalog', { cookie: ownerCookie })).response.status, 401);
  const login = await context.request('/api/admin/v1/login', { method: 'POST', cookie: '', body: owner });
  assert.equal(login.response.status, 200); assert.ok(login.response.headers.get('Set-Cookie'));
}));

test('archive impact blocks removing artwork currently used by a published product', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const usage = await context.request(`/api/admin/v1/usage?collection=media&id=${product.media.id}`);
  assert.equal(usage.response.status, 200); assert.equal(usage.payload.data.affectsPublic, true); assert.ok(usage.payload.data.blockingIssues.length);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', body: { collection: 'media', id: product.media.id, expectedRevision: product.media.revision } });
  assert.equal(archive.response.status, 422); assert.equal(archive.payload.error.code, 'archive_in_use');
  assert.equal((await context.repository.readDraft()).media.find(item => item.id === product.media.id).lifecycle, 'active');
}));

test('unexpected storage failures return a generic server error without exposing filesystem details', async () => withBackend(async context => {
  await context.setup(); const { media } = await context.upload();
  fs.unlinkSync(getMediaPath(media.storageKey, context.folder));
  const result = await context.request(`/api/public/v1/media/${media.id}`);
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, 'SERVER_ERROR');
  assert.ok(!JSON.stringify(result.payload).includes(context.folder));
  assert.ok(!JSON.stringify(result.payload).includes(media.storageKey));
}));

test('file-aware preflight and publication reject missing or corrupt media and preserve the current release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const initial = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Known good release', expectedReleaseId: null } });
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  assert.notEqual(replacement.media.storageKey, product.media.storageKey);
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const target = getMediaPath(replacement.media.storageKey, context.folder);
  for (const condition of ['deleted', 'corrupted']) {
    if (condition === 'deleted') fs.unlinkSync(target); else fs.writeFileSync(target, Buffer.from('corrupt image data'));
    const preflight = await context.request('/api/admin/v1/preflight');
    assert.equal(preflight.response.status, 200);
    assert.ok(preflight.payload.data.some(issue => issue.severity === 'error' && issue.collection === 'media' && issue.entityId === replacement.media.id), `${condition} file must be reported before publish`);
    const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: `Reject ${condition}`, expectedReleaseId: first.id } });
    assert.equal(rejected.response.status, 422, `${condition} asset cannot become public`);
    assert.equal((await context.repository.readActiveRelease()).id, first.id);
    assert.equal((await context.repository.listReleases()).length, 1, 'Failed publication leaves no partial release');
    const currentMedia = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
    assert.equal(currentMedia.response.status, 200); assert.deepEqual(Buffer.from(await currentMedia.response.arrayBuffer()), product.bytes);
    fs.writeFileSync(target, replacement.bytes);
  }
  const verified = await context.request('/api/admin/v1/preflight');
  assert.deepEqual(verified.payload.data.filter(issue => issue.severity === 'error'), []);
  const valid = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Verified replacement', expectedReleaseId: first.id } });
  assert.equal(valid.response.status, 201); assert.notEqual(valid.payload.data.id, first.id);
}));

test('rollback verifies retained media and preserves the active release when an old asset is missing', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const initial = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Original artwork', expectedReleaseId: null } });
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const updated = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Replacement artwork', expectedReleaseId: first.id } });
  assert.equal(updated.response.status, 201); const second = updated.payload.data;
  const oldPath = getMediaPath(product.media.storageKey, context.folder);
  fs.unlinkSync(oldPath);
  const rejected = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(rejected.response.status, 422);
  assert.equal((await context.repository.readActiveRelease()).id, second.id);
  const current = await context.request(`/api/public/v1/media/${replacement.media.id}`, { cookie: '' });
  assert.equal(current.response.status, 200); assert.deepEqual(Buffer.from(await current.response.arrayBuffer()), replacement.bytes);
  fs.writeFileSync(oldPath, product.bytes);
  const restored = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(restored.response.status, 200); assert.equal((await context.repository.readActiveRelease()).id, first.id);
}));

test('stale draft snapshots cannot publish newer edits that the owner has not reviewed', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const reviewedHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  await context.save('productGroups', { ...product.group, buttonLabel: 'Unreviewed Juice 50%' }, product.group.revision);
  const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Publish reviewed version', expectedReleaseId: null, expectedDraftHash: reviewedHash } });
  assert.equal(rejected.response.status, 409); assert.equal(rejected.payload.error.code.toLowerCase(), 'revision_conflict');
  assert.equal(await context.repository.readActiveRelease(), null); assert.equal((await context.repository.listReleases()).length, 0);
  const freshHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const reviewed = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Owner reviewed refreshed version', expectedReleaseId: null, expectedDraftHash: freshHash } });
  assert.equal(reviewed.response.status, 201); assert.equal(reviewed.payload.data.data.productGroups[0].buttonLabel, 'Unreviewed Juice 50%');
}));

test('publish retries are idempotent, reject key reuse and never reactivate a superseded release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const expectedDraftHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const requestKey = randomUUID();
  const body = { note: 'Idempotent first release', expectedReleaseId: null, expectedDraftHash };
  const options = { method: 'POST', headers: { 'X-Idempotency-Key': requestKey }, body };
  const initial = await context.request('/api/admin/v1/publish', options);
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const retry = await context.request('/api/admin/v1/publish', options);
  assert.equal(retry.response.status, 201); assert.equal(retry.payload.data.id, first.id);
  assert.equal((await context.repository.listReleases()).length, 1);
  const changedNote = await context.request('/api/admin/v1/publish', { ...options, body: { ...body, note: 'Different publication intent' } });
  assert.equal(changedNote.response.status, 409); assert.equal(changedNote.payload.error.code.toLowerCase(), 'idempotency_conflict');
  await context.save('productGroups', { ...product.group, buttonLabel: 'New reviewed Juice 50%' }, product.group.revision);
  const latestHash = createHash('sha256').update(JSON.stringify(await context.repository.readDraft())).digest('hex');
  const latestBody = { note: 'Second release', expectedReleaseId: first.id, expectedDraftHash: latestHash };
  const reused = await context.request('/api/admin/v1/publish', { ...options, body: latestBody });
  assert.equal(reused.response.status, 409); assert.equal(reused.payload.error.code.toLowerCase(), 'idempotency_conflict');
  assert.equal((await context.repository.readActiveRelease()).id, first.id);
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: latestBody });
  assert.equal(second.response.status, 201); assert.notEqual(second.payload.data.id, first.id);
  const delayedRetry = await context.request('/api/admin/v1/publish', options);
  assert.equal(delayedRetry.response.status, 201); assert.equal(delayedRetry.payload.data.id, first.id);
  assert.equal((await context.repository.readActiveRelease()).id, second.payload.data.id, 'An old network retry must not roll back the current site');
  assert.equal((await context.repository.listReleases()).length, 2);
  const otherOwnerId = randomUUID();
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(otherOwnerId, 'other-owner@example.test', '0'.repeat(128), 'test-salt', 'owner');
  const otherToken = context.repository.createSession({ userId: otherOwnerId, email: 'other-owner@example.test', role: 'owner' });
  const otherActor = await context.request('/api/admin/v1/publish', { ...options, cookie: `vinut_admin_session=${otherToken}` });
  assert.equal(otherActor.response.status, 409, 'Idempotency keys must be scoped to their original actor');
  assert.equal(otherActor.payload.error.code.toLowerCase(), 'revision_conflict');
}));

test('deleting an old release removes its snapshot durably without changing the draft, live site or published media', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const options = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Old artwork', expectedReleaseId: null } };
  const initial = await context.request('/api/admin/v1/publish', options);
  assert.equal(initial.response.status, 201); const first = initial.payload.data;
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  const unused = await context.upload('image-2d', 'peach-preview.jpg');
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const updated = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Current artwork', expectedReleaseId: first.id } });
  assert.equal(updated.response.status, 201); const second = updated.payload.data;
  const draft = await context.repository.readDraft();
  const files = fs.readdirSync(path.dirname(getMediaPath(product.media.storageKey, context.folder))).sort();
  const deleted = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.payload));
  assert.equal(context.repository.database.prepare('SELECT id FROM releases WHERE id=?').get(first.id), undefined, 'Snapshot is removed, not merely hidden');
  assert.equal(context.repository.database.prepare('SELECT actor FROM audit_events WHERE action=? AND entity_id=?').get('delete:release', first.id).actor, owner.email);
  assert.deepEqual(fs.readdirSync(path.dirname(getMediaPath(product.media.storageKey, context.folder))).sort(), files, 'No media files are deleted');
  context.reopen();
  const workspace = await context.request('/api/admin/v1/catalog');
  assert.deepEqual(workspace.payload.data.catalog, draft);
  assert.deepEqual(workspace.payload.data.releases.map(release => release.id), [second.id]);
  assert.equal(workspace.payload.data.activeReleaseId, second.id);
  const current = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.deepEqual(current.payload.data.catalog, second.data);
  for (const asset of [product, replacement]) {
    const media = await context.request(`/api/public/v1/media/${asset.media.id}`, { cookie: '' });
    assert.equal(media.response.status, 200); assert.deepEqual(Buffer.from(await media.response.arrayBuffer()), asset.bytes);
  }
  assert.equal((await context.request(`/api/public/v1/media/${unused.media.id}`, { cookie: '' })).response.status, 404, 'Unpublished uploads are not exposed by deletion');
  const replay = await context.request('/api/admin/v1/publish', options);
  assert.equal(replay.response.status, 409); assert.equal(replay.payload.error.code, 'release_deleted_conflict');
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } })).response.status, 422);
  assert.equal((await context.repository.listReleases()).length, 1);
  assert.equal((await context.repository.readActiveRelease()).id, second.id);
  const future = await context.request('/api/admin/v1/publish', { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Fresh publication still works', expectedReleaseId: second.id } });
  assert.equal(future.response.status, 201);
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: second.id, expectedReleaseId: future.payload.data.id } })).response.status, 200, 'Remaining history still supports rollback');
}));

test('release deletion validates confirmation and protects the live release even after a concurrent rollback', async () => withBackend(async context => {
  await context.setup(); await createVisible2DProduct(context);
  const first = (await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } })).payload.data;
  const second = (await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.id } })).payload.data;
  const options = { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } };
  assert.equal((await context.request('/api/admin/v1/releases/delete', { ...options, cookie: '' })).response.status, 401);
  assert.equal((await context.request('/api/admin/v1/releases/delete', { ...options, origin: 'https://untrusted.example' })).response.status, 403);
  assert.equal((await context.request('/api/admin/v1/releases/delete', { ...options, origin: null })).response.status, 403);
  for (const body of [null, {}, { releaseId: first.id }, { releaseId: '', expectedReleaseId: second.id }, { releaseId: first.id, expectedReleaseId: 1 }]) {
    assert.equal((await context.request('/api/admin/v1/releases/delete', { method: 'POST', body })).response.status, 422);
  }
  const active = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: second.id, expectedReleaseId: second.id } });
  assert.equal(active.response.status, 422); assert.equal(active.payload.error.code, 'active_release');
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: options.body })).response.status, 200);
  const stale = await context.request('/api/admin/v1/releases/delete', options);
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.error.code, 'release_conflict');
  const nowActive = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: first.id } });
  assert.equal(nowActive.payload.error.code, 'active_release');
  const missing = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: randomUUID(), expectedReleaseId: first.id } });
  assert.equal(missing.payload.error.code, 'release_not_found');
  assert.equal((await context.repository.listReleases()).length, 2);
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM retained_public_media').get().count, 0, 'Failed confirmations write nothing');
  assert.equal(context.repository.database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE action=?').get('delete:release').count, 0);
  const fresh = await context.request('/api/admin/v1/releases/delete', { method: 'POST', body: { releaseId: second.id, expectedReleaseId: first.id } });
  assert.equal(fresh.response.status, 200, 'A release without a publish request key can also be removed');
  assert.equal((await context.repository.readActiveRelease()).id, first.id);
}));

test('release deletion rolls back snapshot, media metadata and retry-key writes if its audit insert fails', async () => withBackend(async context => {
  await context.setup(); await createVisible2DProduct(context);
  const options = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { expectedReleaseId: null } };
  const first = (await context.request('/api/admin/v1/publish', options)).payload.data;
  const second = (await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.id } })).payload.data;
  context.repository.database.exec("CREATE TRIGGER reject_release_delete_audit BEFORE INSERT ON audit_events WHEN NEW.action='delete:release' BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
  const deletion = { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.id } };
  const failed = await context.request('/api/admin/v1/releases/delete', deletion);
  assert.equal(failed.response.status, 500);
  assert.equal((await context.repository.listReleases()).length, 2);
  assert.equal((await context.repository.readActiveRelease()).id, second.id);
  for (const table of ['retained_public_media', 'deleted_publish_requests']) assert.equal(context.repository.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  assert.equal((await context.request('/api/admin/v1/publish', options)).payload.data.id, first.id, 'Original retry key is restored by rollback');
  context.repository.database.exec('DROP TRIGGER reject_release_delete_audit');
  assert.equal((await context.request('/api/admin/v1/releases/delete', deletion)).response.status, 200);
}));

test('publication exports fruit/leaf pools and standalone images; rollback and delayed retries track the current public release', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const firstOptions = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { expectedReleaseId: null } };
  const first = (await context.request('/api/admin/v1/publish', firstOptions)).payload.data;
  const readSnapshot = () => JSON.parse(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8')).data;
  assert.equal(readSnapshot().releaseId, first.id);
  for (const role of ['fruit', 'leaf']) {
    const { media } = await context.upload(role, role === 'fruit' ? 'citrus-preview.jpg' : 'lime-preview.jpg');
    await context.save('flavorAssets', { ...newEntity(`Published ${role}`, `published-${role}`), flavorId: product.flavor.id, mediaId: media.id, role, enabled: true, position: 0 });
  }
  const privateUpload = (await context.upload('fruit', 'peach-preview.jpg')).media;
  assert.equal(readSnapshot().releaseId, first.id, 'Draft changes cannot alter the standalone site');
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.id } });
  assert.equal(second.response.status, 201); assert.equal(second.payload.data.staticExportWarning, undefined);
  const snapshot = readSnapshot();
  assert.equal(snapshot.releaseId, second.payload.data.id);
  assert.equal(snapshot.catalog.flavorAssets.length, 2);
  for (const assignment of snapshot.catalog.flavorAssets) {
    const media = snapshot.catalog.media.find(item => item.id === assignment.mediaId);
    assert.equal(media.role, assignment.role); assert.match(media.url, /^\/catalog\/media\/[a-f0-9]{64}\.webp$/);
    assert.equal(media.storageKey, '');
    const bytes = fs.readFileSync(path.join(context.staticOutputDir, 'media', path.basename(media.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), media.sha256);
  }
  assert.equal(snapshot.catalog.media.some(media => media.id === privateUpload.id), false, 'Draft-only artwork stays private');
  assert.equal((await context.request('/api/admin/v1/publish', firstOptions)).payload.data.id, first.id);
  assert.equal(readSnapshot().releaseId, second.payload.data.id, 'Replaying an old publication cannot replace the standalone snapshot');
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: second.payload.data.id } })).response.status, 200);
  assert.equal(readSnapshot().releaseId, first.id);
  assert.equal((await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: second.payload.data.id, expectedReleaseId: first.id } })).response.status, 200);
  assert.equal(readSnapshot().catalog.flavorAssets.length, 2);
}, { syncPublicCatalog: true }));

test('a standalone export failure reports committed publication accurately and an idempotent retry repairs the snapshot', async () => withBackend(async context => {
  await context.setup(); await createVisible2DProduct(context);
  const first = (await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } })).payload.data;
  const snapshotPath = path.join(context.staticOutputDir, 'current.json');
  const original = fs.readFileSync(snapshotPath, 'utf8');
  const mediaDir = path.join(context.staticOutputDir, 'media'), savedDir = path.join(context.staticOutputDir, 'saved-media');
  fs.renameSync(mediaDir, savedDir); fs.writeFileSync(mediaDir, 'test-only directory blocker');
  const options = { method: 'POST', headers: { 'X-Idempotency-Key': randomUUID() }, body: { expectedReleaseId: first.id } };
  const result = await context.request('/api/admin/v1/publish', options);
  assert.equal(result.response.status, 201);
  assert.match(result.payload.data.staticExportWarning, /npm run catalog:export/);
  assert.equal((await context.repository.readActiveRelease()).id, result.payload.data.id);
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), original, 'Failed export preserves the previous working snapshot');
  const rolledBack = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.id, expectedReleaseId: result.payload.data.id } });
  assert.equal(rolledBack.response.status, 200); assert.match(rolledBack.payload.data.staticExportWarning, /npm run catalog:export/);
  fs.unlinkSync(mediaDir); fs.renameSync(savedDir, mediaDir);
  const retry = await context.request('/api/admin/v1/publish', options);
  assert.equal(retry.response.status, 201); assert.equal(retry.payload.data.id, result.payload.data.id);
  assert.equal(retry.payload.data.staticExportWarning, undefined);
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).data.releaseId, first.id, 'Retry exports the active rollback target, not its superseded release');
  assert.equal((await context.repository.listReleases()).length, 2);
}, { syncPublicCatalog: true }));

test('published media remains available to older pages while unrelated draft uploads stay private', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const first = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } });
  assert.equal(first.response.status, 201);
  const replacement = await context.upload('image-2d', 'berry-preview.jpg');
  const unused = await context.upload('image-2d', 'peach-preview.jpg');
  await context.save('assets2d', { ...product.asset, mediaId: replacement.media.id }, product.asset.revision);
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.payload.data.id } });
  assert.equal(second.response.status, 201);
  const current = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(current.payload.data.catalog.media.some(media => media.id === product.media.id), false, 'Replacement removes the old image from the current snapshot');
  context.reopen();
  const retained = await context.request(`/api/public/v1/media/${product.media.id}`, { cookie: '' });
  assert.equal(retained.response.status, 200, 'Previously published immutable URL remains readable');
  assert.deepEqual(Buffer.from(await retained.response.arrayBuffer()), product.bytes);
  const replacementRead = await context.request(`/api/public/v1/media/${replacement.media.id}`, { cookie: '' });
  assert.equal(replacementRead.response.status, 200); assert.deepEqual(Buffer.from(await replacementRead.response.arrayBuffer()), replacement.bytes);
  assert.equal((await context.request(`/api/public/v1/media/${unused.media.id}`, { cookie: '' })).response.status, 404);
}));

test('real 3D model publication validates declared material names against the inspected GLB', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const labelMedia = (await context.upload('label')).media;
  const posterMedia = (await context.upload('poster')).media;
  const seedModel = (await context.repository.readDraft()).models3d.find(model => model.packagingVariantId === 'can-330');
  let model = await context.save('models3d', { ...seedModel, posterId: posterMedia.id }, seedModel.revision);
  const label = await context.save('labels', { ...newEntity('API approved label', 'api-3d-label'), drinkTypeId: 'juice', flavorId: product.flavor.id, mediaId: labelMedia.id, compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: model.layoutProfile }] });
  await context.save('displays3d', { ...newEntity('API approved 3D display', 'api-3d-display'), productVariantId: product.variant.id, modelId: model.id, labelId: label.id, enabled: true });
  await context.save('packagingSlots', { ...product.slot, mode: '3d' }, product.slot.revision);
  const invalid = await context.save('models3d', { ...model, materialSlots: { ...model.materialSlots, label: ['material-that-does-not-exist'] } }, model.revision);
  const preflight = await context.request('/api/admin/v1/preflight');
  assert.ok(preflight.payload.data.some(issue => issue.entityId === model.id && issue.field === 'materialSlots' && issue.severity === 'error'));
  const rejected = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Incorrect model slot', expectedReleaseId: null } });
  assert.equal(rejected.response.status, 422); assert.equal(await context.repository.readActiveRelease(), null);
  model = await context.save('models3d', { ...invalid, materialSlots: seedModel.materialSlots }, invalid.revision);
  const corrected = await context.request('/api/admin/v1/preflight');
  assert.deepEqual(corrected.payload.data.filter(issue => issue.severity === 'error'), []);
  const published = await context.request('/api/admin/v1/publish', { method: 'POST', body: { note: 'Actual can GLB and valid label', expectedReleaseId: null } });
  assert.equal(published.response.status, 201, JSON.stringify(published.payload));
  const catalog = published.payload.data.data;
  assert.equal(catalog.models3d.length, 1); assert.equal(catalog.models3d[0].id, model.id);
  assert.deepEqual(catalog.models3d[0].materialSlots.label, ['printed-label']);
  assert.equal(catalog.displays3d[0].labelId, label.id);
  assert.equal(catalog.media.find(media => media.id === seedModel.mediaId).mime, 'model/gltf-binary');
  const labelRead = await context.request(`/api/public/v1/media/${labelMedia.id}`, { cookie: '' });
  assert.equal(labelRead.response.status, 200); assert.equal(labelRead.response.headers.get('Content-Type'), labelMedia.mime);
}));

test('CRUD audit events identify the actual authenticated owner or editor', async () => withBackend(async context => {
  await context.setup();
  const record = await context.save('drinkTypes', { ...newEntity('Audited tea', 'audited-tea'), description: '', position: 25 });
  const editorId = randomUUID(); const editorEmail = 'audit-editor@example.test';
  context.repository.database.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(editorId, editorEmail, '0'.repeat(128), 'test-salt', 'editor');
  const token = context.repository.createSession({ userId: editorId, email: editorEmail, role: 'editor' });
  const cookie = `vinut_admin_session=${token}`;
  const edit = await context.request('/api/admin/v1/record', { method: 'POST', cookie, body: { collection: 'drinkTypes', record: { ...record, description: 'Editor contribution' }, expectedRevision: record.revision } });
  assert.equal(edit.response.status, 200);
  const archive = await context.request('/api/admin/v1/archive', { method: 'POST', cookie, body: { collection: 'drinkTypes', id: record.id, expectedRevision: edit.payload.data.revision } });
  assert.equal(archive.response.status, 200);
  const events = context.repository.database.prepare('SELECT actor,action FROM audit_events WHERE entity_id=? ORDER BY rowid').all(record.id);
  assert.deepEqual(events.map(event => ({ ...event })), [
    { actor: owner.email, action: 'save:drinkTypes' },
    { actor: editorEmail, action: 'save:drinkTypes' },
    { actor: editorEmail, action: 'archive:drinkTypes' },
  ]);
}));

test('reordering an image pool changes only assets belonging to that flavor', async () => withBackend(async context => {
  await context.setup();
  const firstMedia = (await context.upload('fruit')).media;
  const secondMedia = (await context.upload('fruit', 'berry-preview.jpg')).media;
  const makeAsset = (id, flavorId, mediaId, position) => ({ ...newEntity(id, id), flavorId, mediaId, role: 'fruit', position, enabled: true });
  const first = await context.save('flavorAssets', makeAsset('ordered-citrus-first', 'citrus', firstMedia.id, 0));
  const second = await context.save('flavorAssets', makeAsset('ordered-citrus-second', 'citrus', secondMedia.id, 1));
  const unrelated = await context.save('flavorAssets', makeAsset('ordered-berry-first', 'berry', firstMedia.id, 0));
  const result = await context.request('/api/admin/v1/reorder', { method: 'POST', body: { collection: 'flavorAssets', id: first.id, direction: 'down', expectedRevisions: { [first.id]: first.revision, [second.id]: second.revision } } });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const assets = result.payload.data.flavorAssets;
  assert.equal(assets.find(asset => asset.id === first.id).position, 1); assert.equal(assets.find(asset => asset.id === second.id).position, 0);
  assert.equal(assets.find(asset => asset.id === first.id).revision, 2); assert.equal(assets.find(asset => asset.id === second.id).revision, 2);
  assert.deepEqual(assets.find(asset => asset.id === unrelated.id), unrelated, 'An unrelated flavor pool keeps its position, revision and timestamps');
}));


test('reusable SVG icons publish anonymously, export standalone and retain history after draft deletion', async () => withBackend(async context => {
  await context.setup(); const product = await createVisible2DProduct(context);
  const form = new FormData(); form.set('role', 'icon');
  form.set('file', new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 20"><path fill="white" d="M4 10L40 2L76 10L40 18Z"/></svg>'], 'symbol.svg', { type: 'image/svg+xml' }));
  const uploaded = await context.request('/api/admin/v1/upload', { method: 'POST', form });
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.payload)); const icon = uploaded.payload.data;
  assert.equal(icon.role, 'icon'); assert.equal(icon.mime, 'image/webp'); assert.equal(icon.width, 256); assert.equal(icon.height, 64);
  assert.equal((await context.request(`/api/public/v1/media/${icon.id}`, { cookie: '' })).response.status, 404);
  const flavor = await context.save('flavors', { ...product.flavor, iconId: icon.id, thumbnailId: product.media.id }, product.flavor.revision);
  const first = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: null } });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  const publicRead = await context.request('/api/public/v1/catalog', { cookie: '' });
  assert.equal(publicRead.payload.data.catalog.flavors[0].iconId, icon.id);
  const publicIcon = await context.request(`/api/public/v1/media/${icon.id}`, { cookie: '' });
  assert.equal(publicIcon.response.status, 200); assert.equal(publicIcon.response.headers.get('Content-Type'), 'image/webp');
  const exported = JSON.parse(fs.readFileSync(path.join(context.staticOutputDir, 'current.json'), 'utf8'));
  const exportedIcon = exported.data.catalog.media.find(item => item.id === icon.id);
  assert.ok(exportedIcon); assert.equal(exported.data.catalog.flavors[0].iconId, icon.id);
  assert.deepEqual(fs.readFileSync(path.join(context.staticOutputDir, 'media', icon.storageKey)), Buffer.from(await publicIcon.response.arrayBuffer()));
  const draft = await context.repository.readDraft();
  const removed = await context.request('/api/admin/v1/delete', { method: 'POST', body: { collection: 'media', id: icon.id, expectedRevision: icon.revision, expectedDraftHash: createHash('sha256').update(JSON.stringify(draft)).digest('hex') } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.payload));
  assert.equal(removed.payload.data.catalog.flavors.find(item => item.id === flavor.id).iconId, null);
  const second = await context.request('/api/admin/v1/publish', { method: 'POST', body: { expectedReleaseId: first.payload.data.id } });
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.media.some(item => item.id === icon.id), false);
  const rolled = await context.request('/api/admin/v1/rollback', { method: 'POST', body: { releaseId: first.payload.data.id, expectedReleaseId: second.payload.data.id } });
  assert.equal(rolled.response.status, 200);
  assert.equal((await context.request('/api/public/v1/catalog', { cookie: '' })).payload.data.catalog.flavors[0].iconId, icon.id);
  assert.equal((await context.request(`/api/public/v1/media/${icon.id}`, { cookie: '' })).response.status, 200);
}, { syncPublicCatalog: true }));
