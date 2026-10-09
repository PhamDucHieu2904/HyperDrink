'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Checked local model migration with a recoverable scoped release. */
require('./register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { catalogWithDefaults } = require('../lib/catalog/contracts.ts');
const { validateCatalog, preflightCatalog } = require('../lib/catalog/validation.ts');
const { prepareCatalogRelease } = require('../lib/catalog/service.ts');
const { resolveDisplay3D } = require('../lib/catalog/resolve.ts');
const { getMockupLibrary } = require('../lib/catalog/mockup.ts');
const { inspectMedia } = require('../lib/server/media/inspect.ts');
const { checkModelLabelGeometry } = require('../lib/server/media/model-slots.ts');
const { exportPublishedCatalog } = require('./export-public-catalog.cjs');
const { ids } = require('./import-basil-290.cjs');

const root = path.resolve(__dirname, '..');
const paths = Object.freeze({
  model: '/models/bottles/glass-290-basil-web.glb',
  highModel: '/models/bottles/glass-290-basil.glb',
  manifest: path.join(root, 'public/models/bottles/glass-290-basil-web.manifest.json'),
  certificate: path.join(root, 'public/models/bottles/glass-290-basil-web.validation.json'),
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const staticPath = url => path.join(root, 'public', url);
const canonicalSlots = slots => JSON.stringify(Object.fromEntries(Object.entries(slots).sort(([a], [b]) => a.localeCompare(b)).map(([key, names]) => [key, [...names].sort()])));

/** Read-only: the final geometry certificate must belong to the exact web asset and retained High reference. */
function loadWebResources() {
  const modelBytes = fs.readFileSync(staticPath(paths.model));
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  const certificate = JSON.parse(fs.readFileSync(paths.certificate, 'utf8'));
  const sha256 = hash(modelBytes);
  if (manifest.sha256 !== sha256 || manifest.bytes !== modelBytes.length) throw new Error('Basil web GLB differs from its manifest.');
  if (certificate.passed !== true || certificate.glbSha256 !== sha256 || certificate.sourceUnchanged !== true) throw new Error('Basil web geometry certificate must pass for this exact GLB and unchanged source.');
  const highBytes = fs.readFileSync(staticPath(paths.highModel));
  const highSha256 = hash(highBytes);
  if (manifest.referenceHighSha256 !== highSha256 || certificate.referenceHighSha256 !== highSha256 || certificate.referenceHighPreserved !== true) throw new Error('The retained High reference changed since the web certificate.');
  if (certificate.retainedGeometryByteIdentical !== true || certificate.noHighBvhResources !== true || certificate.seedInstances?.passed !== true || certificate.seedInstances?.nativeFramePassed !== true || certificate.seedInstances?.maximumHighFloat32Difference !== 0) throw new Error('Basil web must preserve the checked retained geometry and source seed coordinates without High BVH resources.');
  if (hash(fs.readFileSync(manifest.source)) !== manifest.sourceSha256) throw new Error('The original Basil Blender source changed since certification.');
  const gltf = JSON.parse(modelBytes.subarray(20, 20 + modelBytes.readUInt32LE(12)).toString('utf8').trimEnd());
  const modelInfo = inspectMedia(modelBytes, 'model').model;
  const sourceHighInfo = inspectMedia(highBytes, 'model').model;
  if (manifest.triangleCount !== modelInfo.triangleCount || modelInfo.layoutProfile !== 'glass-290-basil-wrap-v1') throw new Error('Basil web geometry or authored label UV contract differs from its manifest.');
  if (gltf.materials.some(material => material.extras?.basilProfile !== 'basil-web-v1' || /basil-high-/.test(material.name))) throw new Error('Basil web must carry only its lightweight optical profile.');
  const expectedSlots = { body: ['basil-web-outer', 'basil-web-neck'], cap: ['basil-gold-cap'], label: ['printed-label'], liquid: ['basil-web-liquid'] };
  if (canonicalSlots(modelInfo.materialSlots) !== canonicalSlots(expectedSlots)) throw new Error('Unexpected Basil web semantic slots.');
  const seedMetadata = gltf.nodes.map(node => node.extras?.basilWebSeeds).find(Boolean);
  if (seedMetadata?.formatVersion !== 1 || seedMetadata.count !== 330 || seedMetadata.seeds?.length !== 330 || seedMetadata.nativeToGlbMatrix?.length !== 16 || seedMetadata.gelThicknessNative !== certificate.seedInstances.gelThicknessNative) throw new Error('Basil web needs all 330 source seed ellipsoids and exact gel envelope metadata.');
  if (!seedMetadata.nativeToGlbMatrix.every(Number.isFinite) || seedMetadata.seeds.some(seed => ['center', 'inverseX', 'inverseY', 'inverseZ'].some(key => seed[key]?.length !== 3 || !seed[key].every(Number.isFinite)))) throw new Error('Invalid Basil web seed coordinates.');
  // Instanced inclusions are created before appearance binding. Catalog semantic
  // slots must name that generated material even though it is not in the GLB.
  const runtimeSlots = { ...modelInfo.materialSlots, inclusions: ['basil-web-seed-gel'] };
  return { modelBytes, manifest, certificate, modelInfo, runtimeSlots, sourceHighInfo, highSha256, sha256, seedMetadata };
}

/** Replace only this existing model's source URL/byte facts and semantic slots; retain all artist presentation data. */
function mergeBasilWeb(raw, resources, stamp = new Date().toISOString()) {
  const data = catalogWithDefaults(structuredClone(raw));
  const model = data.models3d.find(item => item.id === ids.model);
  const media = data.media.find(item => item.id === ids.modelMedia);
  const display = data.displays3d.find(item => item.id === ids.display);
  if (!model || !media || !display) throw new Error('Register the Basil 290 ml display before its web-model migration.');
  if (model.mediaId !== media.id || model.layoutProfile !== resources.modelInfo.layoutProfile || model.packagingVariantId !== ids.packaging) throw new Error('Basil model mapping was edited; refusing to replace artist model/layout choices.');
  if (media.storageKey || ![paths.highModel, paths.model].includes(media.url)) throw new Error('Basil model media was replaced by an artist; refusing to overwrite that source.');
  if (media.url === paths.highModel && (media.sha256 !== resources.highSha256 || canonicalSlots(model.materialSlots) !== canonicalSlots(resources.sourceHighInfo.materialSlots))) throw new Error('Basil High source facts/slots were edited; refusing an ambiguous migration.');
  if (media.url === paths.model && ![canonicalSlots(resources.modelInfo.materialSlots), canonicalSlots(resources.runtimeSlots)].includes(canonicalSlots(model.materialSlots))) throw new Error('Basil web slots were edited; refusing to overwrite artist slot mappings.');
  const changed = [];
  const update = (collection, record, patch) => {
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(record[key]) === JSON.stringify(value))) return;
    Object.assign(record, patch, { revision: record.revision + 1, updatedAt: stamp });
    changed.push({ collection, id: record.id });
  };
  update('media', media, { url: paths.model, mime: 'model/gltf-binary', bytes: resources.modelBytes.length, sha256: resources.sha256 });
  update('models3d', model, { materialSlots: resources.runtimeSlots });
  const failures = validateCatalog(data).filter(issue => issue.severity === 'error');
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  const geometryIssues = checkModelLabelGeometry(model, resources.modelBytes);
  if (geometryIssues.length) throw new Error(JSON.stringify(geometryIssues, null, 2));
  const resolved = resolveDisplay3D(data, display);
  if (!resolved || resolved.asset.src !== paths.model || resolved.asset.volumeMl !== 290 || resolved.asset.packaging !== 'glass') throw new Error('Basil web display does not resolve to the checked glass 290 ml asset.');
  return { data, changed, liquidColor: resolved.appearance.slots.liquid?.color, resolved };
}

async function main() {
  const resources = loadWebResources();
  const apply = process.argv.includes('--apply');
  const stamp = new Date().toISOString();
  const db = new DatabaseSync(path.join(root, 'data/admin/catalog.sqlite'), { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const draftRow = db.prepare('SELECT data FROM draft_catalog WHERE id=1').get();
    const active = db.prepare('SELECT r.* FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
    if (!active) throw new Error('No local active catalog release.');
    const draft = mergeBasilWeb(JSON.parse(draftRow.data), resources, stamp);
    const activeMerge = mergeBasilWeb(JSON.parse(active.data), resources, stamp);
    const released = prepareCatalogRelease(activeMerge.data);
    const errors = preflightCatalog(released).filter(issue => issue.severity === 'error');
    if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
    const library = getMockupLibrary(released);
    if (!library.displays.some(display => display.id === ids.display) || !library.models.some(model => model.id === ids.model)) throw new Error('Basil web must remain reachable through the same Mockup selection.');
    const summary = { apply, modelId: ids.model, displayId: ids.display, previousReleaseId: active.id, src: paths.model,
      glbBytes: resources.modelBytes.length, triangles: resources.modelInfo.triangleCount, seedCount: resources.seedMetadata.count,
      liquidColor: draft.liquidColor, draftChanges: draft.changed, publishedChanges: activeMerge.changed, preflight: 'passed' };
    if (apply && (draft.changed.length || activeMerge.changed.length)) {
      const backup = path.join(root, 'data/admin/basil-web-backups', `before-${Date.now()}-${randomUUID()}.json`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, JSON.stringify({ draft: JSON.parse(draftRow.data), release: active }, null, 2));
      db.exec('BEGIN IMMEDIATE');
      if (db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data !== draftRow.data || db.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id !== active.id) throw new Error('Catalog changed during Basil web migration; rerun against current data.');
      if (hash(fs.readFileSync(staticPath(paths.model))) !== resources.sha256 || hash(fs.readFileSync(staticPath(paths.highModel))) !== resources.highSha256) throw new Error('Basil assets changed during migration; rerun against the checked export.');
      if (draft.changed.length) db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(draft.data));
      if (activeMerge.changed.length) {
        summary.releaseId = randomUUID();
        db.prepare('INSERT INTO releases(id,created_at,created_by,note,data) VALUES(?,?,?,?,?)').run(summary.releaseId, stamp, 'basil-web-import', 'Basil 290 ml: lightweight web model; same display, tint and label', JSON.stringify(released));
        db.prepare('UPDATE publication SET release_id=? WHERE id=1').run(summary.releaseId);
      }
      const audit = db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)');
      for (const change of draft.changed) audit.run(randomUUID(), 'basil-web-import', `save:${change.collection}`, change.id, stamp);
      db.exec('COMMIT');
      summary.backup = backup;
    }
    if (apply) summary.export = exportPublishedCatalog();
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

module.exports = { ids, paths, loadWebResources, mergeBasilWeb };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
