'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Checksum-checked local catalog integration. */
require('./register-admin-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const { catalogWithDefaults } = require('../lib/catalog/contracts.ts');
const { validateCatalog, preflightCatalog } = require('../lib/catalog/validation.ts');
const { prepareCatalogRelease } = require('../lib/catalog/service.ts');
const { resolveDisplay3D } = require('../lib/catalog/resolve.ts');
const { getMockupLibrary } = require('../lib/catalog/mockup.ts');
const { inspectMedia } = require('../lib/server/media/inspect.ts');
const { checkModelLabelGeometry } = require('../lib/server/media/model-slots.ts');
const { exportPublishedCatalog } = require('./export-public-catalog.cjs');

const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString();
const option = key => process.argv.find(argument => argument.startsWith(`--${key}=`))?.slice(key.length + 3);
const ids = {
  packaging: 'pet-500-short', model: 'registry-pet-500-aloe', modelMedia: 'model-pet-500-aloe',
  posterMedia: 'poster-pet-500-aloe', flavor: 'aloe-strawberry', group: 'aloe-vera',
  label: 'aloe-pet500-strawberry-demo-label', labelMedia: 'label-pet500-aloe-strawberry-demo',
  neutralLabel: 'aloe-pet500-unprinted-label', neutralMedia: 'label-pet500-aloe-unprinted',
  variant: 'aloe-pet500-strawberry', display: 'aloe-pet500-strawberry-3d', slot: 'slot-aloe-pet500',
};
const paths = {
  manifest: path.join(root, 'public/models/bottles/pet-500-short-label.manifest.json'),
  model: '/models/bottles/pet-500-short-label.glb',
  poster: '/models/bottles/pet-500-aloe-poster.webp',
  label: '/assets/labels/aloe-demo/strawberry-pet500.webp',
  neutral: '/assets/labels/aloe-demo/unprinted-pet500.webp',
};
const hash = value => createHash('sha256').update(value).digest('hex');
const entity = (id, name) => ({ id, name, slug: id, lifecycle: 'active', revision: 1, createdAt: stamp, updatedAt: stamp });
const staticPath = url => path.join(root, 'public', url);

/** Temporary original artwork; the approved production label can replace its media in admin. */
async function prepareArt() {
  const panelCenters = (option('panel-centers') || '256,1280').split(',').map(Number);
  if (panelCenters.some(value => !Number.isFinite(value) || value < 0 || value > 2048)) throw new Error('Invalid panel centers.');
  const berry = `<path d="M-55-7Q-72 34 0 90Q72 34 55-7Q39-34 0-18Q-39-34-55-7Z" fill="#e94451"/>
    <path d="M-49-22 0-1 49-22 16-31 0-62-16-31Z" fill="#426844"/>
    <g fill="#ffe5a1"><ellipse cx="-26" cy="10" rx="3" ry="5"/><ellipse cx="24" cy="12" rx="3" ry="5"/><ellipse cy="30" rx="3" ry="5"/><ellipse cx="-19" cy="45" rx="3" ry="5"/><ellipse cx="19" cy="45" rx="3" ry="5"/><ellipse cy="65" rx="3" ry="5"/></g>`;
  const panels = panelCenters.map(center => `<g transform="translate(${center} 0)">
    <text y="129" text-anchor="middle" font-family="Arial,sans-serif" font-size="61" font-weight="900" fill="#2c5940">VINUT</text>
    <text y="300" text-anchor="middle" font-family="Georgia,serif" font-size="84" font-weight="bold" fill="#315f43">Aloe Vera</text>
    <rect x="-220" y="350" width="440" height="65" rx="15" fill="#db395f"/>
    <text y="395" text-anchor="middle" font-family="Arial,sans-serif" font-size="35" font-weight="bold" fill="#ffffff">STRAWBERRY</text>
    <text y="477" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" fill="#436145">with aloe vera pulp</text>
    <g transform="translate(-92 565) scale(.75)">${berry}</g><g transform="translate(56 578) scale(.55) rotate(18)">${berry}</g>
    <text y="724" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" fill="#6c7d67">DEMO LABEL · 500 ml</text>
  </g>`).join('');
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="768">
    <rect width="2048" height="768" fill="#fffdf4"/>
    <path d="M0 0H2048V40Q1536 88 1024 40T0 40Z" fill="#497747"/>
    <path d="M0 768H2048V744Q1536 703 1024 744T0 744Z" fill="#86a45b"/>
    ${panels}</svg>`;
  fs.mkdirSync(path.dirname(staticPath(paths.label)), { recursive: true });
  await sharp(Buffer.from(label)).webp({ quality: 92, effort: 6 }).toFile(staticPath(paths.label));
  const neutral = '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="768"><rect width="2048" height="768" fill="#f3f3f3"/></svg>';
  await sharp(Buffer.from(neutral)).webp({ quality: 92, effort: 6 }).toFile(staticPath(paths.neutral));
  // Bootstrap only. The final native WebGL capture replaces this exact file before delivery.
  if (!fs.existsSync(staticPath(paths.poster))) {
    const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
      <rect width="640" height="640" fill="#fffaf0"/>
      <path d="M292 123H348V145L395 224 404 260V553Q403 573 383 578H256Q238 572 237 553V260L246 224 292 145Z" fill="#ef632b"/>
      <rect x="284" y="76" width="72" height="70" rx="7" fill="#f5f3ed"/>
      <rect x="235" y="232" width="171" height="206" rx="13" fill="#fffdf4"/>
      <text x="320" y="282" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="bold" fill="#315f43">VINUT</text>
      <text x="320" y="325" text-anchor="middle" font-family="Georgia,serif" font-size="27" font-weight="bold" fill="#315f43">Aloe Vera</text>
      <text x="320" y="364" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#db395f">STRAWBERRY</text>
      <text x="320" y="415" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#65765d">DEMO · 500 ml</text>
      <g fill="none" stroke="#ffd49c" stroke-width="2"><rect x="260" y="471" width="54" height="12" rx="4"/><rect x="260" y="492" width="54" height="12" rx="4"/><rect x="260" y="513" width="54" height="12" rx="4"/><rect x="260" y="534" width="54" height="12" rx="4"/></g>
    </svg>`;
    fs.mkdirSync(path.dirname(staticPath(paths.poster)), { recursive: true });
    await sharp(Buffer.from(poster)).webp({ quality: 92 }).toFile(staticPath(paths.poster));
  }
  return { generated: [paths.label, paths.neutral], poster: paths.poster, temporaryArtwork: true, panelCenters };
}

function loadResources() {
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  const modelBytes = fs.readFileSync(staticPath(paths.model));
  if (hash(modelBytes) !== manifest.sha256 || modelBytes.length !== manifest.bytes) throw new Error('GLB does not match the validated 500 ml manifest.');
  const gltf = JSON.parse(modelBytes.subarray(20, 20 + modelBytes.readUInt32LE(12)).toString('utf8').trimEnd());
  if (!gltf.materials.some(material => material.extras?.bottleProfile === 'aloe-pet-v1')) throw new Error('GLB has no aloe-pet-v1 optical metadata; finish the derived asset before importing.');
  const modelInfo = inspectMedia(modelBytes, 'model').model;
  const layoutProfile = modelInfo.layoutProfile || option('layout-profile');
  if (!layoutProfile) throw new Error('GLB must declare the checked label UV layoutProfile, or supply --layout-profile after visual verification.');
  for (const role of ['body', 'liquid', 'inclusions', 'cap', 'label']) if (!modelInfo.materialSlots[role]?.length) throw new Error(`Missing semantic material slot: ${role}`);
  const media = (id, name, role, url) => {
    const bytes = fs.readFileSync(staticPath(url));
    const info = inspectMedia(bytes, role);
    return { ...entity(id, name), role, status: 'ready', url, storageKey: '', mime: info.mime, bytes: bytes.length, sha256: hash(bytes), width: info.width, height: info.height, imageBounds: null, error: '' };
  };
  return { manifest, modelBytes, modelInfo, layoutProfile, media: [
    media(ids.modelMedia, 'PET 500 ml · Aloe Vera · Short label', 'model', paths.model),
    media(ids.posterMedia, 'PET 500 ml · Aloe Vera · Preview', 'poster', paths.poster),
    media(ids.labelMedia, 'Aloe Vera · Strawberry · Demo label · 500 ml', 'label', paths.label),
    media(ids.neutralMedia, 'PET 500 ml · Unprinted comparison sleeve', 'label', paths.neutral),
  ] };
}

/** Merge only this import's entities; retain existing appearance/orientation/admin edits. */
function mergeAloe(raw, resources, options = {}) {
  const data = catalogWithDefaults(structuredClone(raw));
  const changed = [];
  function add(collection, record) {
    const prior = data[collection].find(item => item.id === record.id);
    if (!prior) {
      data[collection].push(record); changed.push({ collection, id: record.id }); return record;
    }
    let derived;
    if (collection === 'media' && (prior.sha256 !== record.sha256 || prior.bytes !== record.bytes)) derived = { ...prior, ...record, createdAt: prior.createdAt };
    if (collection === 'models3d' && prior.id === ids.model && prior.mediaId === record.mediaId) {
      if (JSON.stringify(prior.materialSlots) !== JSON.stringify(record.materialSlots) || prior.layoutProfile !== record.layoutProfile) derived = { ...prior, materialSlots: record.materialSlots, layoutProfile: record.layoutProfile };
    }
    if (derived) {
      Object.assign(prior, derived, { revision: prior.revision + 1, updatedAt: stamp });
      changed.push({ collection, id: prior.id });
    }
    return prior;
  }
  const category = data.packagingCategories.find(item => item.viewerKind === 'pet' && item.lifecycle === 'active') || add('packagingCategories', { ...entity('pet-bottle', 'PET bottle'), viewerKind: 'pet', position: data.packagingCategories.length });
  add('drinkTypes', { ...entity('aloe-vera', 'Aloe Vera'), description: '', position: data.drinkTypes.length });
  add('packagingVariants', { ...entity(ids.packaging, '500 ml PET · Short label'), categoryId: category.id, volumeMl: 500, shape: 'square-short-label', position: data.packagingVariants.length });
  const strawberry = data.flavors.find(item => item.id === 'juice30-strawberry');
  const liquidColor = options.liquidColor || resources.manifest.defaultLiquidColor || '#e84a3c';
  if (!/^#[0-9a-f]{6}$/i.test(liquidColor)) throw new Error('Invalid --liquid-color hex.');
  const setLiquidColor = options.setLiquidColor;
  if (setLiquidColor !== undefined && !/^#[0-9a-f]{6}$/i.test(setLiquidColor)) throw new Error('Invalid --set-liquid-color hex.');
  if (!data.flavors.some(item => item.id === ids.flavor)) {
    add('flavors', { ...entity(ids.flavor, 'Aloe Vera · Strawberry'), shortName: 'Strawberry', description: 'Aloe vera drink with translucent pulp. Temporary demo label.', accentColor: strawberry?.accentColor || '#f09ba5', backgroundColor: strawberry?.backgroundColor || '#db395f', textColor: '#ffffff', icon: strawberry?.icon || 'berry', iconId: strawberry?.iconId || null, thumbnailId: strawberry?.thumbnailId || null, icePoolConfigured: true, position: data.flavors.length });
    if (strawberry) for (const asset of data.flavorAssets.filter(item => item.flavorId === strawberry.id && item.lifecycle === 'active' && item.enabled)) add('flavorAssets', { ...asset, ...entity(`aloe-${asset.id}`, `Aloe Strawberry · ${asset.role}`), flavorId: ids.flavor });
  }
  resources.media.forEach(record => add('media', record));
  const model = add('models3d', { ...entity(ids.model, 'PET 500 ml · Aloe Vera · Short label'), packagingVariantId: ids.packaging, mediaId: ids.modelMedia, posterId: ids.posterMedia, layoutProfile: resources.layoutProfile, materialSlots: resources.modelInfo.materialSlots, orientation: [0, 0, 0], mockupVisible: true, mockupPosition: data.models3d.length, mockupFrontYaw: Number(options.frontYaw || 0) });
  const compatibility = [{ packagingVariantId: ids.packaging, layoutProfile: model.layoutProfile }];
  add('labels', { ...entity(ids.label, 'Aloe Vera · Strawberry · PET 500 ml · Demo'), drinkTypeId: 'aloe-vera', flavorId: ids.flavor, mediaId: ids.labelMedia, compatibilities: compatibility, mockupVisible: true, mockupPosition: data.labels.length });
  add('labels', { ...entity(ids.neutralLabel, 'PET 500 ml · Unprinted sleeve'), drinkTypeId: 'aloe-vera', flavorId: null, mediaId: ids.neutralMedia, compatibilities: compatibility, mockupVisible: true, mockupPosition: data.labels.length });
  add('productGroups', { ...entity(ids.group, 'Aloe Vera'), drinkTypeId: 'aloe-vera', description: 'Aloe vera drinks with translucent pulp. Preview with a temporary Strawberry demo label.', buttonLabel: 'Aloe Vera', position: data.productGroups.length, visible: true, collectionVisible: false, heroVolumeCaption: 'Net content', heroFlavorText: 'Strawberry with aloe vera pulp', heroOriginText: 'Vietnam' });
  add('productVariants', { ...entity(ids.variant, 'Aloe Vera · Strawberry · PET 500 ml'), groupId: ids.group, packagingVariantId: ids.packaging, flavorId: ids.flavor, code: 'ALOE-PET500-STRAWBERRY', description: 'Temporary demo artwork; replace with approved production label.', enabled: true });
  const display = add('displays3d', { ...entity(ids.display, 'Aloe Vera · Strawberry · PET 500 ml'), productVariantId: ids.variant, modelId: ids.model, labelId: ids.label, liquidColor: setLiquidColor?.toLowerCase() ?? liquidColor, enabled: true });
  // Explicit retint is authorized separately from initialization. Keep the
  // artist's model, flavor/background, artwork and all other displays intact.
  if (setLiquidColor !== undefined && display.liquidColor?.toLowerCase() !== setLiquidColor.toLowerCase()) {
    Object.assign(display, { liquidColor: setLiquidColor.toLowerCase(), revision: display.revision + 1, updatedAt: stamp });
    changed.push({ collection: 'displays3d', id: display.id });
  }
  add('packagingSlots', { ...entity(ids.slot, 'Aloe Vera · PET 500 ml'), groupId: ids.group, packagingVariantId: ids.packaging, regionKey: 'packaging-picker', position: 0, buttonLabel: '500 ml PET', mode: '3d', defaultVariantId: ids.variant, enabled: true });
  // Unpublished records from other work do not have to pass publication preflight.
  const failures = validateCatalog(data).filter(issue => issue.severity === 'error');
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  const geometryIssues = checkModelLabelGeometry(model, resources.modelBytes);
  if (geometryIssues.length) throw new Error(JSON.stringify(geometryIssues, null, 2));
  const resolved = resolveDisplay3D(data, data.displays3d.find(item => item.id === ids.display));
  if (!resolved || !resolved.appearance.slots.liquid?.color || resolved.asset.volumeMl !== 500) throw new Error('500 ml display does not resolve with its liquid slot.');
  return { data, changed, liquidColor: resolved.appearance.slots.liquid.color };
}

async function main() {
  if (process.argv.includes('--prepare-art')) {
    console.log(JSON.stringify(await prepareArt(), null, 2));
    return;
  }
  const resources = loadResources();
  const databasePath = path.join(root, 'data/admin/catalog.sqlite');
  const apply = process.argv.includes('--apply');
  const db = new DatabaseSync(databasePath, { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const originalDraft = db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data;
    const active = db.prepare('SELECT r.* FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
    if (!active) throw new Error('No local active published catalog.');
    const mergeOptions = { liquidColor: option('liquid-color'), setLiquidColor: option('set-liquid-color'), frontYaw: option('front-yaw') };
    const draft = mergeAloe(JSON.parse(originalDraft), resources, mergeOptions);
    // Publish only this bottle's records against the active release; never publish unrelated drafts.
    const activeMerge = mergeAloe(JSON.parse(active.data), resources, mergeOptions);
    const released = prepareCatalogRelease(activeMerge.data);
    const failures = preflightCatalog(released).filter(issue => issue.severity === 'error');
    if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
    const library = getMockupLibrary(released);
    if (!library.displays.some(display => display.id === ids.display)) throw new Error('Aloe display is missing from the public Mockup library.');
    if (!library.labels.some(label => label.id === ids.neutralLabel)) throw new Error('Unprinted comparison sleeve is missing from Mockup.');
    const summary = { apply, displayId: ids.display, modelId: ids.model, liquidColor: draft.liquidColor, layoutProfile: resources.layoutProfile, glbBytes: resources.manifest.bytes, triangles: resources.manifest.triangleCount, draftChanges: draft.changed, publishedChanges: activeMerge.changed, draftPreserved: true, preflight: 'passed', temporaryArtwork: true };
    if (apply && (draft.changed.length || activeMerge.changed.length)) {
      const backup = path.join(root, 'data/admin/aloe-500-backups', `before-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, JSON.stringify({ draft: JSON.parse(originalDraft), release: active }, null, 2));
      db.exec('BEGIN IMMEDIATE');
      if (db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data !== originalDraft || db.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id !== active.id) throw new Error('Catalog changed during import; rerun to merge current records.');
      if (draft.changed.length) db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(draft.data));
      if (activeMerge.changed.length) {
        const releaseId = randomUUID();
        db.prepare('INSERT INTO releases(id,created_at,created_by,note,data) VALUES(?,?,?,?,?)').run(releaseId, stamp, 'aloe-500-import', 'PET 500 ml Aloe Vera: local Strawberry optics demo and checked short-label model', JSON.stringify(released));
        db.prepare('UPDATE publication SET release_id=? WHERE id=1').run(releaseId);
        summary.releaseId = releaseId;
      }
      const audit = db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)');
      for (const change of draft.changed) audit.run(randomUUID(), 'aloe-500-import', `save:${change.collection}`, change.id, stamp);
      db.exec('COMMIT');
      summary.backup = backup;
    }
    if (apply) summary.export = exportPublishedCatalog();
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}

module.exports = { ids, loadResources, mergeAloe };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
