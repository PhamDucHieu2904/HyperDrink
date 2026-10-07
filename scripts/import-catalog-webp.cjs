'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- One-time local catalog import. */
require('./register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { catalogWithDefaults } = require('../lib/catalog/contracts.ts');
const { inspectMedia } = require('../lib/server/media/inspect.ts');
const { validateCatalog, preflightCatalog } = require('../lib/catalog/validation.ts');
const { LocalCatalogRepository } = require('../lib/server/local-repository.ts');
const { exportPublishedCatalog } = require('./export-public-catalog.cjs');

async function main() {
  const apply = process.argv.includes('--apply');
  const source = path.resolve(process.argv.find(value => value.startsWith('--source='))?.slice(9) || 'D:/Vinut-TK/Downloads/converted-images (1)');
  const manifestPath = path.resolve('.tmp/thumbnail-batch/output/thumbnail-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const read = new DatabaseSync('data/admin/catalog.sqlite', { readOnly: true });
  const raw = JSON.parse(read.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data);
  const activeId = read.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id;
  read.close();
  const data = catalogWithDefaults(structuredClone(raw));
  const now = new Date().toISOString();
  const entity = (id, name) => ({ id, name, slug: id, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now });
  const touch = record => { record.updatedAt = now; record.revision++; };
  const writes = [];
  for (const entry of manifest.files) {
    const filename = entry.filename.replace(/\.png$/i, '.webp');
    const bytes = fs.readFileSync(path.join(source, filename));
    const role = entry.labelId ? 'image-2d' : 'poster';
    const inspected = inspectMedia(bytes, role);
    if (inspected.mime !== 'image/webp' || inspected.width !== 1024 || inspected.height !== 1024) throw new Error(`Unexpected dimensions or format: ${filename}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `${sha256}.webp`;
    let media = data.media.find(item => item.sha256 === sha256 && item.role === role && item.lifecycle === 'active');
    if (!media) {
      const id = `catalog-webp-${sha256.slice(0, 24)}`;
      media = { ...entity(id, entry.name.slice(0, 160)), role, status: 'ready', url: `/api/public/v1/media/${id}`, storageKey, mime: inspected.mime, bytes: bytes.length, sha256, width: inspected.width, height: inspected.height, imageBounds: null, error: '' };
      data.media.push(media);
    }
    writes.push({ storageKey, bytes });
    const model = data.models3d.find(item => item.id === entry.modelId);
    if (!model) throw new Error(`Missing model: ${entry.modelId}`);
    if (!entry.labelId) { if (model.posterId !== media.id) { model.posterId = media.id; touch(model); } continue; }
    const label = data.labels.find(item => item.id === entry.labelId);
    const flavor = data.flavors.find(item => item.id === label?.flavorId);
    const packaging = data.packagingVariants.find(item => item.id === model.packagingVariantId);
    const group = data.productGroups.find(item => item.drinkTypeId === label?.drinkTypeId);
    if (!label || !flavor || !packaging || !group) throw new Error(`Missing product metadata: ${filename}`);
    let collection = data.catalogCollections.find(item => item.id === group.id);
    if (!collection) { collection = { ...entity(group.id, group.name), drinkTypeId: label.drinkTypeId, homeVisible: true, enabled: true, position: group.position }; data.catalogCollections.push(collection); }
    let detail = data.productDetails.find(item => item.labelId === label.id && item.lifecycle === 'active');
    if (!detail) {
      detail = { ...entity(`catalog-detail-${label.id}`, `${flavor.shortName || flavor.name} · ${collection.name} · ${packaging.volumeMl} ml`.slice(0, 160)), labelId: label.id, posterId: null, eyebrow: collection.name, headline: flavor.shortName || flavor.name, subtitle: `${collection.name} · ${packaging.volumeMl} ml`, introduction: '', ingredients: '', allergens: '', servingSize: '', nutrition: [], companyName: '', companyAddress: '', countryOfOrigin: '', netContent: `${packaging.volumeMl} ml`, storage: '', shelfLife: '', sections: [], enabled: true };
      data.productDetails.push(detail);
    }
    const variant = data.productVariants.find(item => item.groupId === group.id && item.packagingVariantId === packaging.id && item.flavorId === flavor.id);
    const id = variant?.id || `catalog-item-${label.id}`;
    let item = data.catalogItems.find(item => item.id === id);
    if (!item) { item = { ...entity(id, flavor.shortName || flavor.name), collectionId: collection.id, mediaId: media.id, productDetailId: detail.id, packagingVariantId: packaging.id, position: flavor.position, enabled: true }; data.catalogItems.push(item); }
    else if (item.mediaId !== media.id) { item.mediaId = media.id; touch(item); }
  }
  // Retire the earlier homepage-row switches; editorial collections own them now.
  for (const group of data.productGroups) if (group.collectionVisible !== false) { group.collectionVisible = false; touch(group); }
  const errors = [...validateCatalog(data), ...preflightCatalog(data)].filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
  const report = { mode: apply ? 'applied' : 'dry-run', collections: data.catalogCollections.map(item => ({ name: item.name, products: data.catalogItems.filter(product => product.collectionId === item.id).length })), details: data.productDetails.length, images: writes.length, bytes: writes.reduce((total, item) => total + item.bytes.length, 0) };
  if (apply) {
    const backup = path.resolve('.tmp/catalog-webp-backup'); fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, `draft-${Date.now()}.json`), JSON.stringify({ activeId, catalog: raw }, null, 2));
    for (const write of writes) { const target = path.resolve('data/admin/media', write.storageKey); if (!fs.existsSync(target)) fs.writeFileSync(target, write.bytes); else if (!fs.readFileSync(target).equals(write.bytes)) throw new Error('Storage checksum mismatch'); }
    const repository = new LocalCatalogRepository();
    try {
      repository.database.exec('BEGIN IMMEDIATE');
      const current = JSON.parse(repository.database.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data);
      if (JSON.stringify(current) !== JSON.stringify(raw)) throw new Error('Draft changed during import; retry with fresh data.');
      repository.database.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(data));
      repository.database.exec('COMMIT');
      const release = await repository.publish(data, 'catalog-webp-import', 'Catalog collections: imported 28 product images and 6 packaging posters', activeId);
      report.releaseId = release.id;
      report.export = exportPublishedCatalog();
    } catch (error) { if (repository.database.isTransaction) repository.database.exec('ROLLBACK'); throw error; }
    finally { repository.database.close(); }
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
