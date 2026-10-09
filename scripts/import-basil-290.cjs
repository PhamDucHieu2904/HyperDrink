'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Checksum-checked local Basil registration. */
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
  packaging: 'glass-290-basil', model: 'registry-glass-290-basil', modelMedia: 'model-glass-290-basil',
  posterMedia: 'poster-glass-290-basil', group: 'basil-seed', flavor: 'basil-red-grape',
  label: 'basil-glass290-unprinted-label', labelMedia: 'label-glass290-basil-unprinted',
  variant: 'basil-glass290-red-grape', display: 'basil-glass290-red-grape-3d', slot: 'slot-basil-glass290',
};
const paths = {
  model: '/models/bottles/glass-290-basil.glb',
  manifest: path.join(root, 'public/models/bottles/glass-290-basil.manifest.json'),
  certificate: path.join(root, 'public/models/bottles/glass-290-basil.validation.json'),
  poster: '/models/bottles/glass-290-basil-poster.webp',
  blank: '/assets/labels/basil-seed/unprinted-glass290.webp',
};
const referencePoster = 'C:/Users/thietke06.VINUT/Desktop/Mockup Renders/Mockup_Standard_Transparent_20260925_174317_976.png';
// The source Unity material does not serialize the user's imported Red Grape input.
// This independent display preset is calibrated against the supplied High reference.
const referenceLiquidColor = '#be2838';
const hash = value => createHash('sha256').update(value).digest('hex');
const entity = (id, name) => ({ id, name, slug: id, lifecycle: 'active', revision: 1, createdAt: stamp, updatedAt: stamp });
const staticPath = url => path.join(root, 'public', url);
const checkHex = (value, name) => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid ${name}: use #rrggbb.`);
  return value.toLowerCase();
};

/** The user explicitly requested a blank sleeve; this is a solid white texel, not replacement artwork. */
async function blankLabel() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } })
    .webp({ lossless: true, effort: 6 }).toBuffer();
}

/** Default runs never write assets or catalogs. The loading poster is the supplied Unity reference. */
async function loadResources(options = {}) {
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  const modelBytes = fs.readFileSync(staticPath(paths.model));
  if (hash(modelBytes) !== manifest.sha256 || modelBytes.length !== manifest.bytes) throw new Error('GLB does not match the checked Basil 290 ml manifest.');
  const certificate = JSON.parse(fs.readFileSync(paths.certificate, 'utf8'));
  if (certificate.passed !== true || certificate.sourceUnchanged !== true || certificate.glbSha256 !== manifest.sha256 || certificate.perSeedDerivedBlend?.objects !== 330 || certificate.perSeedDerivedBlend?.passed !== true) throw new Error('Basil authored geometry, native High boundaries and per-seed gel certificate must pass for this exact GLB.');
  const gltf = JSON.parse(modelBytes.subarray(20, 20 + modelBytes.readUInt32LE(12)).toString('utf8').trimEnd());
  const profiled = gltf.materials?.some(material => material.extras?.basilProfile === 'basil-high-v1' || material.extras?.bottleProfile === 'basil-glass290-high-v1');
  if (!profiled) throw new Error('Finish the Label Lab High optical profile before registration.');
  const modelInfo = inspectMedia(modelBytes, 'model').model;
  if (modelInfo.layoutProfile !== 'glass-290-basil-wrap-v1') throw new Error('GLB must declare its authored glass-290-basil-wrap-v1 label UV contract.');
  for (const role of ['body', 'liquid', 'inclusions', 'cap', 'label']) if (!modelInfo.materialSlots[role]?.length) throw new Error(`Missing semantic material slot: ${role}`);
  if (!modelInfo.materialSlots.inclusions.includes('basil-seeds') || !modelInfo.materialSlots.inclusions.includes('basil-gel')) throw new Error('Expected both original Basil seeds and generated gel in the checked asset.');
  if (manifest.triangleCount !== modelInfo.triangleCount) throw new Error('Manifest triangle count differs from the GLB.');
  const liquidColor = checkHex(options.liquidColor ?? referenceLiquidColor, 'liquid-color');
  const blankBytes = await blankLabel();
  let posterBytes;
  const posterSource = options.posterSource ?? (!fs.existsSync(staticPath(paths.poster)) ? referencePoster : undefined);
  if (posterSource) {
    const source = fs.readFileSync(path.resolve(posterSource));
    inspectMedia(source, 'poster');
    posterBytes = await sharp(source).rotate().resize(640, 640, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toColourspace('srgb').webp({ quality: 95, effort: 6 }).toBuffer();
  } else posterBytes = fs.readFileSync(staticPath(paths.poster));
  const media = (id, name, role, url, bytes) => {
    const info = inspectMedia(bytes, role);
    return { ...entity(id, name), role, status: 'ready', url, storageKey: '', mime: info.mime, bytes: bytes.length, sha256: hash(bytes), width: info.width, height: info.height, imageBounds: null, error: '' };
  };
  return {
    manifest, certificate, modelBytes, modelInfo, layoutProfile: modelInfo.layoutProfile, liquidColor,
    files: [{ url: paths.blank, bytes: blankBytes }, { url: paths.poster, bytes: posterBytes }],
    media: [
      media(ids.modelMedia, 'Glass 290 ml · Basil seed · Label Lab High', 'model', paths.model, modelBytes),
      media(ids.posterMedia, 'Glass 290 ml · Basil seed · Unity High reference preview', 'poster', paths.poster, posterBytes),
      media(ids.labelMedia, 'Glass 290 ml · Blank white sleeve', 'label', paths.blank, blankBytes),
    ],
  };
}

/** Merge only this bottle's records. Existing names, colors, artwork, orientation and admin switches remain editable. */
function mergeBasil(raw, resources, options = {}) {
  const data = catalogWithDefaults(structuredClone(raw));
  const changed = [];
  const add = (collection, record) => {
    const prior = data[collection].find(item => item.id === record.id);
    if (!prior) { data[collection].push(record); changed.push({ collection, id: record.id }); return record; }
    let derived;
    // Refresh only byte-derived facts of our own URL; a manually replaced media URL is retained.
    if (collection === 'media' && prior.url === record.url && (prior.sha256 !== record.sha256 || prior.bytes !== record.bytes)) {
      derived = { ...prior, mime: record.mime, bytes: record.bytes, sha256: record.sha256, width: record.width, height: record.height };
    }
    const usesBasilWeb = collection === 'models3d' && data.media.some(item => item.id === prior.mediaId && item.url === '/models/bottles/glass-290-basil-web.glb');
    if (collection === 'models3d' && !usesBasilWeb && prior.mediaId === record.mediaId && prior.layoutProfile === record.layoutProfile && JSON.stringify(prior.materialSlots) !== JSON.stringify(record.materialSlots)) {
      // The rebuilt asset is authoritative for semantic names; preserve all presentation fields.
      derived = { ...prior, materialSlots: record.materialSlots };
    }
    // Replace only our initial engineering notes with storefront copy. Retain
    // any description an artist has subsequently edited in the catalog.
    const initialNote = collection === 'flavors' && record.id === ids.flavor
      ? 'Basil seed drink with hydrated gel shells · 290 ml. Blank sleeve pending original artwork.'
      : collection === 'productVariants' && record.id === ids.variant
        ? 'Label Lab High geometry and seed gel · 290 ml. Unprinted sleeve pending artwork.' : undefined;
    if (initialNote && prior.description === initialNote) derived = { ...prior, description: record.description };
    if (derived) {
      Object.assign(prior, derived, { revision: prior.revision + 1, updatedAt: stamp });
      changed.push({ collection, id: prior.id });
    }
    return prior;
  };
  const category = data.packagingCategories.find(item => item.viewerKind === 'glass' && item.lifecycle === 'active')
    || add('packagingCategories', { ...entity('glass-bottle', 'Glass bottle'), viewerKind: 'glass', position: data.packagingCategories.length });
  add('drinkTypes', { ...entity('basil-seed', 'Basil seed'), description: '', position: data.drinkTypes.length });
  add('packagingVariants', { ...entity(ids.packaging, '290 ml Glass · Basil seed'), categoryId: category.id, volumeMl: 290, shape: 'glass-basil-screw-cap', position: data.packagingVariants.length });
  const base = data.flavors.find(item => item.id === 'juice30-red-grape');
  const flavorExisted = data.flavors.some(item => item.id === ids.flavor);
  add('flavors', {
    ...entity(ids.flavor, 'Basil seed · Red Grape'), shortName: 'Red Grape',
    description: 'Red grape drink with tender basil seeds · 290 ml.',
    accentColor: base?.accentColor || '#c49cd3', backgroundColor: base?.backgroundColor || '#775785', textColor: '#ffffff',
    icon: base?.icon || 'berry', iconId: base?.iconId || null, thumbnailId: base?.thumbnailId || null,
    icePoolConfigured: true, position: data.flavors.length,
  });
  if (!flavorExisted && base) for (const asset of data.flavorAssets.filter(item => item.flavorId === base.id && item.lifecycle === 'active' && item.enabled)) {
    add('flavorAssets', { ...asset, ...entity(`basil-${asset.id}`, `Basil Red Grape · ${asset.role}`), flavorId: ids.flavor });
  }
  resources.media.forEach(record => add('media', record));
  const yaw = options.frontYaw ?? resources.manifest.mockupFrontYaw ?? 0;
  if (!Number.isFinite(Number(yaw))) throw new Error('Invalid --front-yaw.');
  const model = add('models3d', {
    ...entity(ids.model, 'Glass 290 ml · Basil seed · High'), packagingVariantId: ids.packaging,
    mediaId: ids.modelMedia, posterId: ids.posterMedia, layoutProfile: resources.layoutProfile,
    materialSlots: resources.modelInfo.materialSlots, orientation: [0, 0, 0],
    mockupVisible: true, mockupPosition: data.models3d.length, mockupFrontYaw: Number(yaw),
  });
  add('labels', {
    ...entity(ids.label, 'Glass 290 ml · Unprinted sleeve'), drinkTypeId: 'basil-seed', flavorId: null,
    mediaId: ids.labelMedia, compatibilities: [{ packagingVariantId: ids.packaging, layoutProfile: model.layoutProfile }],
    mockupVisible: true, mockupPosition: data.labels.length,
  });
  add('productGroups', {
    ...entity(ids.group, 'Basil seed'), drinkTypeId: 'basil-seed',
    description: 'Basil seed drinks with tender hydrated seed gel.', buttonLabel: 'Basil seed',
    position: data.productGroups.length, visible: true, collectionVisible: false,
    heroVolumeCaption: 'Net content', heroFlavorText: 'Red Grape with basil seeds', heroOriginText: 'From Vietnam',
  });
  add('productVariants', {
    ...entity(ids.variant, 'Basil seed · Red Grape · Glass 290 ml'), groupId: ids.group,
    packagingVariantId: ids.packaging, flavorId: ids.flavor, code: 'BASIL-GLASS290-RED-GRAPE',
    description: 'Red grape flavor with hydrated basil seeds · 290 ml.', enabled: true,
  });
  const display = add('displays3d', {
    ...entity(ids.display, 'Basil seed · Red Grape · Glass 290 ml'), productVariantId: ids.variant,
    modelId: ids.model, labelId: ids.label, liquidColor: resources.liquidColor, enabled: true,
  });
  if (options.setLiquidColor !== undefined) {
    const color = checkHex(options.setLiquidColor, 'set-liquid-color');
    if (display.liquidColor !== color) {
      Object.assign(display, { liquidColor: color, revision: display.revision + 1, updatedAt: stamp });
      changed.push({ collection: 'displays3d', id: display.id });
    }
  }
  add('packagingSlots', {
    ...entity(ids.slot, 'Basil seed · Glass 290 ml'), groupId: ids.group, packagingVariantId: ids.packaging,
    regionKey: 'packaging-picker', position: 0, buttonLabel: '290 ml Glass', mode: '3d', defaultVariantId: ids.variant, enabled: true,
  });
  const failures = validateCatalog(data).filter(issue => issue.severity === 'error');
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  const geometryIssues = checkModelLabelGeometry(model, resources.modelBytes);
  if (geometryIssues.length) throw new Error(JSON.stringify(geometryIssues, null, 2));
  const resolved = resolveDisplay3D(data, display);
  if (!resolved || resolved.asset.volumeMl !== 290 || resolved.asset.packaging !== 'glass' || !resolved.appearance.slots.liquid?.color) throw new Error('Basil display does not resolve to its glass 290 ml asset and independent liquid color.');
  return { data, changed, liquidColor: resolved.appearance.slots.liquid.color };
}

function writeResources(resources) {
  for (const file of resources.files) {
    const destination = staticPath(file.url);
    if (fs.existsSync(destination) && hash(fs.readFileSync(destination)) === hash(file.bytes)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, file.bytes);
    fs.renameSync(temporary, destination);
  }
}

async function main() {
  const resources = await loadResources({ liquidColor: option('liquid-color'), posterSource: option('poster-source') });
  if (process.argv.includes('--prepare-assets')) {
    writeResources(resources);
    console.log(JSON.stringify({ prepared: resources.files.map(file => ({ url: file.url, bytes: file.bytes.length, sha256: hash(file.bytes) })), catalogWritten: false, artwork: 'blank sleeve requested by user' }, null, 2));
    return;
  }
  const apply = process.argv.includes('--apply');
  const db = new DatabaseSync(path.join(root, 'data/admin/catalog.sqlite'), { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const originalDraft = db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data;
    const active = db.prepare('SELECT r.* FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
    if (!active) throw new Error('No local active catalog release.');
    const mergeOptions = { frontYaw: option('front-yaw'), setLiquidColor: option('set-liquid-color') };
    const draft = mergeBasil(JSON.parse(originalDraft), resources, mergeOptions);
    const activeMerge = mergeBasil(JSON.parse(active.data), resources, mergeOptions);
    const released = prepareCatalogRelease(activeMerge.data);
    const failures = preflightCatalog(released).filter(issue => issue.severity === 'error');
    if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
    const library = getMockupLibrary(released);
    if (!library.displays.some(display => display.id === ids.display) || !library.models.some(model => model.id === ids.model)) throw new Error('Basil is missing from the public Mockup library.');
    const summary = {
      apply, displayId: ids.display, modelId: ids.model, quality: 'Label Lab High', artwork: 'blank white sleeve requested by user',
      liquidColor: draft.liquidColor, liquidColorSource: 'reference appearance calibration; runtime Unity color is not serialized in the source material',
      layoutProfile: resources.layoutProfile, glbBytes: resources.modelBytes.length, triangles: resources.modelInfo.triangleCount,
      draftChanges: draft.changed, publishedChanges: activeMerge.changed, unrelatedDraftsPreserved: true, preflight: 'passed',
    };
    if (apply && (draft.changed.length || activeMerge.changed.length)) {
      const backup = path.join(root, 'data/admin/basil-290-backups', `before-${Date.now()}-${randomUUID()}.json`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, JSON.stringify({ draft: JSON.parse(originalDraft), release: active }, null, 2));
      db.exec('BEGIN IMMEDIATE');
      if (db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data !== originalDraft || db.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id !== active.id) throw new Error('Catalog changed during import; rerun against current data.');
      if (hash(fs.readFileSync(staticPath(paths.model))) !== resources.manifest.sha256) throw new Error('Model changed during import; rerun against the validated final asset.');
      writeResources(resources);
      if (draft.changed.length) db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(draft.data));
      if (activeMerge.changed.length) {
        const releaseId = randomUUID();
        db.prepare('INSERT INTO releases(id,created_at,created_by,note,data) VALUES(?,?,?,?,?)').run(releaseId, stamp, 'basil-290-import', 'Glass 290 ml Basil seed: High source optics and generated seed gel; unprinted sleeve', JSON.stringify(released));
        db.prepare('UPDATE publication SET release_id=? WHERE id=1').run(releaseId);
        summary.releaseId = releaseId;
      }
      const audit = db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)');
      for (const change of draft.changed) audit.run(randomUUID(), 'basil-290-import', `save:${change.collection}`, change.id, stamp);
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

module.exports = { ids, paths, loadResources, mergeBasil, blankLabel };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
