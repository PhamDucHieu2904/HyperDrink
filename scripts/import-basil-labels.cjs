'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local, checksum-checked production artwork import. */
require('./register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { catalogWithDefaults } = require('../lib/catalog/contracts.ts');
const { validateCatalog, preflightCatalog } = require('../lib/catalog/validation.ts');
const { prepareCatalogRelease } = require('../lib/catalog/service.ts');
const { resolveDisplay3D } = require('../lib/catalog/resolve.ts');
const { inspectMedia } = require('../lib/server/media/inspect.ts');
const { ids } = require('./import-basil-290.cjs');
const { loadWebResources: loadModel } = require('./import-basil-web.cjs');
const { checkModelLabelGeometry } = require('../lib/server/media/model-slots.ts');
const { MAX_CATALOG_RELEASES } = require('../lib/catalog/contracts.ts');
const { exportPublishedCatalog } = require('./export-public-catalog.cjs');

const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entity = (id, name) => ({ id, name, slug: id, lifecycle: 'active', revision: 1, createdAt: stamp, updatedAt: stamp });
// Numbers verified against the printed flavor names, not inferred from file order.
const artwork = [
  { number: 3, key: 'strawberry', name: 'Strawberry', liquidColor: '#f14e78', enabled: true },
  { number: 1, key: 'mango', name: 'Mango', liquidColor: '#ffb52e', enabled: true },
  { number: 8, key: 'passion-fruit', name: 'Passion Fruit', liquidColor: '#f9b632', enabled: true },
  { number: 10, key: 'red-grape', name: 'Red Grape', liquidColor: '#be2838', enabled: true },
  { number: 7, key: 'blueberry', name: 'Blueberry', liquidColor: '#465ca9', enabled: true },
  { number: 2, key: 'mixed-fruit', name: 'Mixed Fruit', liquidColor: '#ffc05e', enabled: false },
  { number: 4, key: 'pineapple', name: 'Pineapple', liquidColor: '#f3d34b', enabled: false },
  { number: 5, key: 'pomegranate', name: 'Pomegranate', liquidColor: '#d8294e', enabled: false },
  { number: 6, key: 'lychee', name: 'Lychee', liquidColor: '#f5a5b4', enabled: false },
  { number: 9, key: 'peach', name: 'Peach', liquidColor: '#ffad67', enabled: false },
];
const mediaDirectory = path.join(root, 'public/assets/labels/basil-seed');
const manifestPath = path.join(mediaDirectory, 'manifest.json');

function loadLabels(source) {
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  return artwork.map(profile => {
    const saved = manifest?.labels.find(item => item.key === profile.key);
    const filename = source ? path.join(source, `Basil seed (${profile.number}).webp`) : saved && path.join(root, 'public', saved.url);
    if (!filename) throw new Error('No imported production artwork; supply --source=path.');
    const bytes = fs.readFileSync(filename);
    const info = inspectMedia(bytes, 'label');
    if (info.mime !== 'image/webp' || info.width !== 1000 || info.height !== 660) throw new Error(`Unexpected label format: ${filename}`);
    const sha256 = hash(bytes);
    if (!source && saved.sha256 !== sha256) throw new Error(`Artwork checksum mismatch: ${profile.key}`);
    const url = `/assets/labels/basil-seed/${profile.key}-${sha256.slice(0, 12)}.webp`;
    return { ...profile, bytes, record: { ...entity(`basil-label-media-${profile.key}`, `Basil seed · ${profile.name} · 290 ml`), role: 'label', status: 'ready', url, storageKey: '', mime: info.mime, bytes: bytes.length, sha256, width: info.width, height: info.height, imageBounds: null, error: '' } };
  });
}

function mergeProductionBasil(raw, resources, modelResources = loadModel()) {
  const data = catalogWithDefaults(structuredClone(raw));
  const changed = [];
  function put(collection, record) {
    const prior = data[collection].find(item => item.id === record.id);
    if (!prior) { data[collection].push(record); changed.push({ collection, id: record.id }); return record; }
    const candidate = { ...prior, ...record, createdAt: prior.createdAt, updatedAt: prior.updatedAt, revision: prior.revision };
    if (JSON.stringify(prior) === JSON.stringify(candidate)) return prior;
    Object.assign(prior, candidate, { revision: prior.revision + 1, updatedAt: stamp });
    changed.push({ collection, id: prior.id });
    return prior;
  }
  const model = data.models3d.find(item => item.id === ids.model && item.lifecycle === 'active');
  if (!model || model.packagingVariantId !== ids.packaging || model.layoutProfile !== modelResources.modelInfo.layoutProfile) throw new Error('Register the checked Basil 290 ml model before importing production artwork.');
  const geometryErrors = checkModelLabelGeometry(model, modelResources.modelBytes);
  if (geometryErrors.length) throw new Error(JSON.stringify(geometryErrors));
  if (data.media.find(item => item.id === model.mediaId)?.sha256 !== modelResources.sha256) throw new Error('Catalog model does not match the checked 290 ml GLB.');
  const group = data.productGroups.find(item => item.id === ids.group);
  if (!group) throw new Error('Missing Basil seed product group.');
  put('productGroups', { ...group, description: 'Basil seed drinks with tender hydrated seed gel, in a choice of fruit flavors.', visible: true, heroFlavorText: 'Many flavor choices', heroOriginText: 'From Vietnam' });
  const basePosition = data.flavors.find(item => item.id === ids.flavor)?.position ?? data.flavors.length;
  for (const [position, resource] of resources.entries()) {
    const { key, name, record, liquidColor, enabled } = resource;
    const flavorId = `basil-${key}`;
    const previousFlavor = data.flavors.find(item => item.id === flavorId);
    const base = data.flavors.find(item => item.id === `juice30-${key === 'mixed-fruit' ? 'mixed' : key}`) || data.flavors.find(item => item.id === `cojo-${key}`);
    const existing = previousFlavor || entity(flavorId, `Basil seed · ${name}`);
    put('flavors', { ...existing, name: `Basil seed · ${name}`, shortName: name, description: 'Basil seed drink with tender hydrated seed gel.', accentColor: previousFlavor?.accentColor || base?.accentColor || '#9caed8', backgroundColor: previousFlavor?.backgroundColor || base?.backgroundColor || '#536ba8', textColor: '#ffffff', icon: previousFlavor?.icon || base?.icon || 'leaf', iconId: previousFlavor?.iconId || base?.iconId || null, thumbnailId: previousFlavor?.thumbnailId || base?.thumbnailId || null, icePoolConfigured: true, position: previousFlavor?.position ?? basePosition + 1 + position });
    // Reuse existing artwork bytes and pool links; each flavor owns its pool switches.
    // Blueberry reuses only leaves and ice; mixed berries are not blueberry artwork.
    const poolBase = base || (key === 'blueberry' ? data.flavors.find(item => item.id === 'berry') : null);
    if (!previousFlavor && poolBase) for (const asset of data.flavorAssets.filter(item => item.flavorId === poolBase.id && item.lifecycle === 'active' && item.enabled && (key !== 'blueberry' || item.role !== 'fruit'))) {
      put('flavorAssets', { ...asset, ...entity(`basil-${key}-${asset.id}`, `Basil ${name} · ${asset.role}`), flavorId });
    }
    put('media', record);
    const labelId = `basil-glass290-${key}-label`;
    const label = data.labels.find(item => item.id === labelId);
    put('labels', { ...(label || entity(labelId, `Basil seed · ${name} · Glass 290 ml`)), drinkTypeId: 'basil-seed', flavorId, mediaId: record.id, compatibilities: [{ packagingVariantId: ids.packaging, layoutProfile: model.layoutProfile }], mockupVisible: true, mockupPosition: label?.mockupPosition ?? 100 + position });
    const variantId = `basil-glass290-${key}`;
    const variant = data.productVariants.find(item => item.id === variantId);
    put('productVariants', { ...(variant || entity(variantId, `Basil seed · ${name} · Glass 290 ml`)), groupId: ids.group, packagingVariantId: ids.packaging, flavorId, code: `BASIL-GLASS290-${key.toUpperCase()}`, description: 'Basil seed drink with tender hydrated seed gel · 290 ml.', enabled });
    const displayId = `${variantId}-3d`;
    const previousDisplay = data.displays3d.find(item => item.id === displayId);
    put('displays3d', { ...(previousDisplay || entity(displayId, `Basil seed · ${name} · Glass 290 ml`)), productVariantId: variantId, modelId: ids.model, labelId, liquidColor: previousDisplay?.liquidColor ?? liquidColor, enabled });
  }
  const demoLabel = data.labels.find(item => item.id === ids.label);
  if (demoLabel) put('labels', { ...demoLabel, mockupVisible: false });
  const slot = data.packagingSlots.find(item => item.id === ids.slot);
  if (!slot) throw new Error('Missing Basil 290 ml packaging slot.');
  put('packagingSlots', { ...slot, defaultVariantId: ids.variant, enabled: true });
  const failures = validateCatalog(data).filter(issue => issue.severity === 'error');
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  for (const profile of resources) {
    const display = data.displays3d.find(item => item.id === `basil-glass290-${profile.key}-3d`);
    const product = resolveDisplay3D(data, display);
    if (!product || product.asset.volumeMl !== 290 || product.appearance.slots.liquid?.color !== display.liquidColor) throw new Error(`Appearance mismatch: ${profile.key}`);
  }
  return { data, changed };
}

async function main() {
  const source = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
  const resources = loadLabels(source || (fs.existsSync(manifestPath) ? undefined : 'D:/Vinut-TK/Downloads/resized-images (33)'));
  const apply = process.argv.includes('--apply');
  const db = new DatabaseSync(path.join(root, 'data/admin/catalog.sqlite'), { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const original = db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data;
    const active = db.prepare('SELECT r.* FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
    if (!active) throw new Error('No active local release.');
    const draft = mergeProductionBasil(JSON.parse(original), resources);
    // Apply the same scoped import to the active release, preserving private draft work.
    const published = mergeProductionBasil(JSON.parse(active.data), resources);
    const released = prepareCatalogRelease(published.data);
    // Disabled draft profiles are intentionally pruned from a public release.
    // Recreating those five records during the merge must not create a new release.
    const releaseChanged = JSON.stringify(released) !== JSON.stringify(JSON.parse(active.data));
    const failures = preflightCatalog(released).filter(issue => issue.severity === 'error');
    if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
    const summary = { apply, labels: resources.length, profiles: resources.length, homepage: resources.filter(item => item.enabled).map(item => item.name), draftChanges: draft.changed.length, publishedChanges: releaseChanged ? published.changed.length : 0, preflight: 'passed' };
    if (apply) {
      if (releaseChanged && db.prepare('SELECT COUNT(*) AS count FROM releases').get().count >= MAX_CATALOG_RELEASES) throw new Error('Release limit reached; no catalog changes applied.');
      fs.mkdirSync(mediaDirectory, { recursive: true });
      for (const resource of resources) {
        const destination = path.join(root, 'public', resource.record.url);
        if (!fs.existsSync(destination)) fs.writeFileSync(destination, resource.bytes, { flag: 'wx' });
        if (hash(fs.readFileSync(destination)) !== resource.record.sha256) throw new Error(`Destination checksum mismatch: ${destination}`);
      }
      fs.writeFileSync(manifestPath, JSON.stringify({ labels: resources.map(({ key, name, number, record }) => ({ key, name, sourceFile: `Basil seed (${number}).webp`, url: record.url, sha256: record.sha256 })) }, null, 2) + '\n');
      if (draft.changed.length || releaseChanged) {
        const backup = path.join(root, 'data/admin/basil-production-backups', `before-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, JSON.stringify({ draft: JSON.parse(original), release: active }, null, 2));
        db.exec('BEGIN IMMEDIATE');
        if (db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data !== original || db.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id !== active.id) throw new Error('Catalog changed during import; rerun against current data.');
        if (draft.changed.length) db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(draft.data));
        if (releaseChanged) {
          const releaseId = randomUUID();
          db.prepare('INSERT INTO releases(id,created_at,created_by,note,data) VALUES(?,?,?,?,?)').run(releaseId, stamp, 'basil-production-import', 'Basil seed Glass 290 ml: ten real labels; Strawberry, Mango, Passion Fruit, Red Grape and Blueberry enabled', JSON.stringify(released));
          db.prepare('UPDATE publication SET release_id=? WHERE id=1').run(releaseId);
          summary.releaseId = releaseId;
        }
        const audit = db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)');
        for (const change of draft.changed) audit.run(randomUUID(), 'basil-production-import', `save:${change.collection}`, change.id, stamp);
        db.exec('COMMIT');
        summary.backup = backup;
      }
      summary.export = exportPublishedCatalog();
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
module.exports = { artwork, loadLabels, mergeProductionBasil };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
