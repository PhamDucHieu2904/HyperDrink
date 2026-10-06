/* eslint-disable @typescript-eslint/no-require-imports -- Tests run the shipped TS catalog modules. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} }; cache.set(filename, loaded);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const importer = name => name.startsWith('@/') ? load(`${name.slice(2)}.ts`) : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name);
  new Function('require', 'module', 'exports', outputText)(importer, loaded, loaded.exports);
  return loaded.exports;
}
const { collectPublicCatalog, checkModelLabelCompatibility, checkDisplay3DCompatibility } = load('lib/catalog/compatibility.ts');
const { getMockupLibrary, getCompatibleMockupLabels, resolveMockupSelection, resolveMockupProduct } = load('lib/catalog/mockup.ts');
const { preflightCatalog, validateRecord } = load('lib/catalog/validation.ts');
const { prepareCatalogRelease, getArchiveImpact, getUsageReferences } = load('lib/catalog/service.ts');
const { deleteCatalogRecord } = load('lib/catalog/deletion.ts');
const { resolveDisplay3D } = load('lib/catalog/resolve.ts');
const { checkModelLabelGeometry } = load('lib/server/media/model-slots.ts');
const { exportPublishedCatalog } = require('../export-public-catalog.cjs');
const now = '2026-10-06T03:00:00.000Z';
const entity = id => ({ id, name: id, slug: id, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now });
const media = (id, role) => ({ ...entity(id), role, status: 'ready', url: `/assets/${id}.webp`, storageKey: '', mime: 'image/webp', bytes: 4, sha256: 'a'.repeat(64), width: 128, height: 128, imageBounds: null, error: '' });
const flavor = (id, thumbnailId) => ({ ...entity(id), shortName: id, description: '', accentColor: '#228844', backgroundColor: '#efffee', textColor: '#112233', icon: 'leaf', thumbnailId, position: 0 });
function fixture() {
  return {
    schemaVersion: 1,
    drinkTypes: [{ ...entity('juice'), description: '', position: 0 }],
    packagingCategories: [{ ...entity('can'), viewerKind: 'can', position: 0 }],
    packagingVariants: [{ ...entity('can-330'), categoryId: 'can', volumeMl: 330, shape: 'standard', position: 0 }],
    flavors: [flavor('lime', 'thumb-lime')],
    flavorAssets: [],
    productGroups: [{ ...entity('juice-group'), drinkTypeId: 'juice', description: '', buttonLabel: 'Juice', position: 0, visible: true }],
    productVariants: [{ ...entity('lime-product'), groupId: 'juice-group', packagingVariantId: 'can-330', flavorId: 'lime', code: 'lime330', description: '', enabled: true }],
    packagingSlots: [{ ...entity('slot'), groupId: 'juice-group', packagingVariantId: 'can-330', regionKey: 'packaging-picker', position: 0, buttonLabel: '330 ml', mode: '3d', defaultVariantId: 'lime-product', enabled: true }],
    media: [{ ...media('model-media', 'model'), url: '/models/can.glb', mime: 'model/gltf-binary', width: null, height: null }, media('poster-media', 'poster'), media('lime-media', 'label'), media('thumb-lime', 'thumbnail')],
    models3d: [{ ...entity('model'), packagingVariantId: 'can-330', mediaId: 'model-media', posterId: 'poster-media', layoutProfile: 'can-wrap-v1', materialSlots: { label: ['printed-label'] }, orientation: [0, 0, 0] }],
    labels: [{ ...entity('lime-label'), drinkTypeId: 'juice', flavorId: 'lime', mediaId: 'lime-media', compatibilities: [{ packagingVariantId: 'can-330', layoutProfile: 'can-wrap-v1' }] }],
    assets2d: [], displays3d: [{ ...entity('preset'), productVariantId: 'lime-product', modelId: 'model', labelId: 'lime-label', enabled: true }], displays2d: [], productDetails: [],
  };
}
function withMockupRoots() {
  const data = fixture();
  data.drinkTypes.push({ ...entity('tea'), description: '', position: 1 });
  data.packagingVariants.push({ ...entity('can-250-short'), categoryId: 'can', volumeMl: 250, shape: 'short', position: 1 });
  data.media.push({ ...media('studio-glb', 'model'), url: '/models/studio.glb', mime: 'model/gltf-binary', width: null, height: null }, media('studio-poster', 'poster'), media('peach-artwork', 'label'), media('peach-thumb', 'thumbnail'), media('private-fruit', 'fruit'));
  data.models3d.push({ ...entity('studio-model'), packagingVariantId: 'can-250-short', mediaId: 'studio-glb', posterId: 'studio-poster', layoutProfile: 'short-v1', materialSlots: { label: ['printed-label'] }, orientation: [0, 0, 0], mockupVisible: true, mockupPosition: 8, mockupFrontYaw: 0.2 });
  data.flavors.push(flavor('peach', 'peach-thumb'));
  data.labels.push({ ...entity('peach-label'), drinkTypeId: 'tea', flavorId: 'peach', mediaId: 'peach-artwork', compatibilities: [{ packagingVariantId: 'can-250-short', layoutProfile: 'short-v1' }], mockupVisible: true, mockupPosition: 4 });
  data.flavorAssets.push({ ...entity('private-pool'), flavorId: 'peach', mediaId: 'private-fruit', role: 'fruit', position: 0, enabled: true });
  data.productDetails.push({ ...entity('private-detail'), labelId: 'peach-label', posterId: 'studio-poster', enabled: true, eyebrow: '', headline: '', subtitle: '', introduction: '', ingredients: '', allergens: '', servingSize: '', nutrition: [], companyName: '', companyAddress: '', countryOfOrigin: '', netContent: '', storage: '', shelfLife: '', sections: [] });
  data.models3d.push({ ...structuredClone(data.models3d[1]), ...entity('private-model'), mockupVisible: undefined });
  data.labels.push({ ...structuredClone(data.labels[1]), ...entity('private-label'), mockupVisible: undefined });
  return data;
}
const ids = records => records.map(item => item.id).sort();
const errors = issues => issues.filter(item => item.severity === 'error');

test('legacy permission comes only from sales roots and explicit hidden resources remain sales-valid', () => {
  const data = withMockupRoots();
  assert.deepEqual(ids(getMockupLibrary(data).models), ['model', 'studio-model']);
  assert.deepEqual(ids(getMockupLibrary(data).labels), ['lime-label', 'peach-label']);
  data.models3d[0].mockupVisible = false;
  assert.deepEqual(checkDisplay3DCompatibility(data, data.displays3d[0]), []);
  assert.equal(collectPublicCatalog(data).displays3d.length, 1);
  assert.equal(getMockupLibrary(data).displays.length, 0);
  assert.equal(resolveMockupSelection(data, { display: 'preset' }).warning, 'unavailable-display');
  assert.equal(resolveMockupSelection(data, { model: 'model', label: 'lime-label' }).warning, 'unavailable-model');
});

test('Mockup publication brings complete metadata/media but never unrelated drafts, flavor pools or details', () => {
  const data = withMockupRoots();
  assert.deepEqual(errors(preflightCatalog(data)), []);
  const published = prepareCatalogRelease(data);
  assert.deepEqual(ids(published.models3d), ['model', 'studio-model']);
  assert.deepEqual(ids(published.labels), ['lime-label', 'peach-label']);
  assert.deepEqual(ids(published.packagingVariants), ['can-250-short', 'can-330']);
  assert.deepEqual(ids(published.drinkTypes), ['juice', 'tea']);
  assert.deepEqual(ids(published.flavors), ['lime', 'peach']);
  assert.ok(published.media.some(item => item.id === 'studio-glb'));
  assert.ok(published.media.some(item => item.id === 'studio-poster'));
  assert.ok(published.media.some(item => item.id === 'peach-thumb'));
  assert.equal(published.flavorAssets.length, 0);
  assert.equal(published.productDetails.length, 0);
  assert.ok(!published.media.some(item => item.id === 'private-fruit'));
  assert.equal(published.productVariants.length, 1, 'No SKU is invented for a free pairing');
});

test('same-volume packaging and UV differences cannot cross the shared compatibility boundary', () => {
  const data = withMockupRoots(), model = data.models3d[0], label = data.labels[1];
  assert.ok(checkModelLabelCompatibility(data, model, label).some(issue => issue.code === 'layout_mismatch'));
  data.packagingVariants[1].volumeMl = 330;
  label.compatibilities[0].layoutProfile = model.layoutProfile;
  assert.ok(checkModelLabelCompatibility(data, model, label).some(issue => issue.code === 'layout_mismatch'));
  label.compatibilities[0].packagingVariantId = model.packagingVariantId;
  assert.deepEqual(checkModelLabelCompatibility(data, model, label), [], 'Drink and flavor differ but UV pairing is valid for Mockup');
  assert.deepEqual(ids(getCompatibleMockupLabels(data, model.id)), ['lime-label', 'peach-label']);
  label.compatibilities[0].layoutProfile = '';
  assert.ok(checkModelLabelCompatibility(data, model, label).some(issue => issue.code === 'layout_mismatch'));
});

test('preflight validates Mockup-only media, poster, UV and label semantic slots', () => {
  for (const change of [
    data => { data.media.find(item => item.id === 'studio-glb').status = 'processing'; },
    data => { data.media.find(item => item.id === 'studio-glb').mime = 'image/webp'; },
    data => { data.media.find(item => item.id === 'studio-poster').role = 'label'; },
    data => { data.media.find(item => item.id === 'studio-poster').mime = 'model/gltf-binary'; },
    data => { data.media.find(item => item.id === 'peach-artwork').role = 'poster'; },
    data => { data.models3d[1].posterId = null; },
    data => { data.models3d[1].layoutProfile = ''; },
    data => { data.models3d[1].materialSlots.label = []; },
  ]) {
    const data = withMockupRoots(); change(data);
    assert.ok(errors(preflightCatalog(data)).length > 0);
    assert.throws(() => prepareCatalogRelease(data), error => error.code === 'publish_invalid');
  }
});

test('archived, not-ready, wrong-media and hidden libraries are excluded from direct IDs as well as cards', () => {
  for (const change of [
    data => { data.models3d[1].lifecycle = 'archived'; },
    data => { data.models3d[1].mockupVisible = false; },
    data => { data.media.find(item => item.id === 'studio-glb').status = 'failed'; },
    data => { data.media.find(item => item.id === 'studio-glb').mime = 'image/webp'; },
    data => { data.media.find(item => item.id === 'studio-poster').lifecycle = 'archived'; },
    data => { data.models3d[1].materialSlots.label = []; },
  ]) {
    const data = withMockupRoots(); change(data);
    assert.ok(!getMockupLibrary(data).models.some(item => item.id === 'studio-model'));
    assert.equal(resolveMockupSelection(data, { model: 'studio-model' }).warning, 'unavailable-model');
  }
  const data = withMockupRoots(); data.labels[0].mockupVisible = false;
  assert.equal(getMockupLibrary(data).displays.length, 0);
  assert.equal(resolveMockupSelection(data, { model: 'model', label: 'lime-label' }).warning, 'unavailable-label');
});

test('deep links choose an exact permitted preset/pair and incompatible labels fall back to the selected empty model', () => {
  const data = withMockupRoots();
  assert.equal(resolveMockupSelection(data).display.id, 'preset');
  assert.equal(resolveMockupSelection(data, { display: 'deleted-preset' }).warning, 'unavailable-display');
  const good = resolveMockupSelection(data, { model: 'studio-model', label: 'peach-label' });
  assert.equal(good.model.id, 'studio-model'); assert.equal(good.label.id, 'peach-label'); assert.equal(good.display, null); assert.equal(good.warning, null);
  const incompatible = resolveMockupSelection(data, { model: 'studio-model', label: 'lime-label' });
  assert.equal(incompatible.model.id, 'studio-model'); assert.equal(incompatible.label, null); assert.equal(incompatible.warning, 'incompatible-label');
  const bare = resolveMockupSelection(data, { model: 'studio-model' });
  assert.equal(bare.label, null); assert.equal(bare.warning, null);
  data.models3d[0].mockupVisible = false;
  assert.equal(resolveMockupSelection(data).model.id, 'studio-model');
  assert.equal(resolveMockupSelection(data).label, null);
});

test('asset and appearance mapping reuse the sales resolver with base paths and reject forged hidden records', () => {
  const data = withMockupRoots();
  const old = process.env.NEXT_PUBLIC_BASE_PATH; process.env.NEXT_PUBLIC_BASE_PATH = '/HyperDrink';
  try {
    const mockup = resolveMockupProduct(data, resolveMockupSelection(data));
    const sales = resolveDisplay3D(data, data.displays3d[0]);
    assert.deepEqual(mockup.asset, sales.asset);
    assert.deepEqual(mockup.appearance.slots, sales.appearance.slots);
    assert.equal(mockup.asset.src, '/HyperDrink/models/can.glb');
    assert.equal(mockup.appearance.slots.label.baseColorMap, '/HyperDrink/assets/lime-media.webp');
    data.models3d[0].mockupVisible = false;
    assert.equal(resolveMockupProduct(data, { model: data.models3d[0], label: data.labels[0] }), null);
  } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = old; }
});

test('optional fields preserve legacy records and validate booleans, order and finite front yaw', () => {
  const data = fixture();
  for (const [collection, record] of [['models3d', data.models3d[0]], ['labels', data.labels[0]]]) {
    assert.deepEqual(validateRecord(collection, record, { mode: 'publish' }), []);
    for (const [key, value] of [['mockupVisible', 'yes'], ['mockupPosition', -1], ['mockupPosition', 1.5]]) assert.ok(validateRecord(collection, { ...record, [key]: value }).some(issue => issue.field === key));
  }
  for (const value of [NaN, Infinity, 30, '0']) assert.ok(validateRecord('models3d', { ...data.models3d[0], mockupFrontYaw: value }).some(issue => issue.field === 'mockupFrontYaw'));
  const roots = withMockupRoots(); roots.models3d[1].mockupPosition = 0; roots.models3d[0].mockupPosition = 2;
  assert.equal(getMockupLibrary(roots).models[0].id, 'studio-model');
});

test('Mockup references enter archive/deletion impacts without mutating retained immutable payloads', () => {
  const data = withMockupRoots(), release = prepareCatalogRelease(data), before = JSON.stringify(release);
  assert.ok(getUsageReferences(data, 'media', 'studio-glb').some(item => item.entityId === 'studio-model'));
  assert.equal(getArchiveImpact(data, 'media', 'studio-glb').affectsPublic, true);
  const after = deleteCatalogRecord(data, 'media', 'studio-glb', 1);
  assert.equal(after.models3d.find(item => item.id === 'studio-model').mediaId, null);
  assert.ok(errors(preflightCatalog(after)).some(item => item.entityId === 'studio-model'));
  assert.equal(JSON.stringify(release), before);
  assert.ok(release.media.some(item => item.id === 'studio-glb'));
});

function mutateGlb(change) {
  const original = fs.readFileSync(path.join(root, 'public/models/cans/can-330.glb'));
  const length = original.readUInt32LE(12), value = JSON.parse(original.subarray(20, 20 + length).toString());
  change(value);
  const json = Buffer.from(JSON.stringify(value)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const bin = original.subarray(20 + length), result = Buffer.alloc(20 + padded.length + bin.length);
  original.subarray(0, 20).copy(result); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12); padded.copy(result, 20); bin.copy(result, 20 + padded.length);
  return result;
}
test('preflight geometry validates UV on the actual label slot and excludes unlit/unused slot bindings', () => {
  const model = fixture().models3d[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/models/cans/assets.manifest.json'), 'utf8'));
  for (const entry of manifest.assets) assert.deepEqual(checkModelLabelGeometry({ ...model, materialSlots: entry.materialSlots }, fs.readFileSync(path.join(root, 'public', entry.src))), []);
  const uv = mutateGlb(gltf => { for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) if (gltf.materials[primitive.material]?.name === 'printed-label') delete primitive.attributes.TEXCOORD_0; });
  assert.ok(checkModelLabelGeometry(model, uv).some(issue => issue.code === 'label_uv_missing'));
  const unlit = mutateGlb(gltf => { gltf.materials.find(item => item.name === 'printed-label').extensions = { KHR_materials_unlit: {} }; });
  assert.ok(checkModelLabelGeometry(model, unlit).some(issue => issue.code === 'label_material_unsupported'));
  assert.ok(checkModelLabelGeometry({ ...model, materialSlots: { label: ['unused-label-material'] } }, uv).some(issue => issue.code === 'label_slot_missing'));
});

test('static export copies Mockup-only hashed media from the immutable release and retains previous hashes', () => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(root, '.tmp/mockup-catalog-'));
  const dataDir = path.join(temporary, 'private'), publicDir = path.join(temporary, 'public'), outputDir = path.join(publicDir, 'catalog');
  try {
    fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
    const catalog = prepareCatalogRelease(withMockupRoots());
    for (const item of catalog.media) {
      const bytes = Buffer.from(item.id), hash = createHash('sha256').update(bytes).digest('hex'), ext = item.role === 'model' ? 'glb' : 'webp';
      item.sha256 = hash; item.bytes = bytes.length; item.storageKey = `${hash}.${ext}`; item.url = `/api/public/v1/media/${item.id}`;
      fs.writeFileSync(path.join(dataDir, 'media', item.storageKey), bytes);
    }
    const db = new DatabaseSync(path.join(dataDir, 'catalog.sqlite'));
    db.exec('CREATE TABLE releases(id TEXT,created_at TEXT,data TEXT); CREATE TABLE publication(id INTEGER,release_id TEXT); CREATE TABLE draft_catalog(data TEXT)');
    db.prepare('INSERT INTO releases VALUES(?,?,?)').run('mockup-release', now, JSON.stringify(catalog));
    db.exec("INSERT INTO publication VALUES(1,'mockup-release'); INSERT INTO draft_catalog VALUES('PRIVATE DRAFT')");
    db.close();
    exportPublishedCatalog({ dataDir, publicDir, outputDir });
    const snapshot = JSON.parse(fs.readFileSync(path.join(outputDir, 'current.json'), 'utf8'));
    const glb = snapshot.data.catalog.media.find(item => item.id === 'studio-glb');
    const previousHash = path.basename(glb.url);
    assert.ok(fs.existsSync(path.join(outputDir, 'media', previousHash)));
    assert.equal(snapshot.data.catalog.models3d.length, 2);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
    const next = new DatabaseSync(path.join(dataDir, 'catalog.sqlite'));
    catalog.media = catalog.media.filter(item => item.id !== 'studio-glb');
    next.prepare('INSERT INTO releases VALUES(?,?,?)').run('next-mockup-release', now, JSON.stringify(catalog));
    next.prepare('UPDATE publication SET release_id=? WHERE id=1').run('next-mockup-release'); next.close();
    exportPublishedCatalog({ dataDir, publicDir, outputDir });
    assert.ok(fs.existsSync(path.join(outputDir, 'media', previousHash)), 'Export preserves hashed files for already open releases');
  } finally {
    const resolved = path.resolve(temporary); assert.ok(resolved.startsWith(path.join(root, '.tmp') + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
