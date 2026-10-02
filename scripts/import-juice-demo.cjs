'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated local demo importer uses Node built-ins. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const DEFAULT_SOURCE = 'C:/Users/thietke06.VINUT/Desktop/5x/Juice 330 ml';
const GROUP_ID = 'juice-30';
const PACKAGING_ID = 'can-330';
const SLOT_ID = 'juice30-can330-slot';
const MODEL_ID = 'registry-can-330';
const FLAVORS = [
  ['apple', 'Apple', ['apple'], '#c0d46a', '#506833', 'leaf'],
  ['avocado', 'Avocado', ['avocado'], '#bdc96b', '#526039', 'leaf'],
  ['banana', 'Banana', ['banana'], '#f4ce65', '#826426', 'leaf'],
  ['guava', 'Guava', ['guava'], '#f0a08e', '#9a625e', 'leaf'],
  ['lime', 'Lime', ['lime'], '#b3d368', '#5c803c', 'lime'],
  ['longan', 'Longan', ['logan', 'longan'], '#ddb782', '#806145', 'leaf'],
  ['lychee', 'Lychee', ['lychee'], '#f0a3ad', '#a15467', 'leaf'],
  ['mango', 'Mango', ['mango'], '#ffc864', '#ad752c', 'leaf'],
  ['mangosteen', 'Mangosteen', ['mangosteen'], '#d7a5df', '#72517e', 'berry'],
  ['mixed', 'Mixed Fruit', ['mixed', 'mixedfruit'], '#f5ba76', '#a06945', 'citrus'],
  ['noni', 'Noni', ['noni'], '#c8d597', '#687346', 'leaf'],
  ['orange', 'Orange', ['orange'], '#ffa866', '#b66e32', 'citrus'],
  ['passion-fruit', 'Passion Fruit', ['passionfruit'], '#e5b969', '#8f7040', 'leaf'],
  ['papaya', 'Papaya', ['payaya', 'papaya'], '#f5b173', '#ad6e42', 'leaf'],
  ['peach', 'Peach', ['peach'], '#f6b195', '#a46a59', 'peach'],
  ['pineapple', 'Pineapple', ['pineapple'], '#e4ca65', '#88752d', 'leaf'],
  ['pomegranate', 'Pomegranate', ['pomegranate'], '#e78a9a', '#963f57', 'berry'],
  ['rambutan', 'Rambutan', ['rabutan', 'rambutan'], '#df969e', '#904958', 'leaf'],
  ['red-grape', 'Red Grape', ['redgrape'], '#c49cd3', '#775785', 'berry'],
  ['sapodilla', 'Sapodilla', ['sapodilla'], '#d2b488', '#7b664b', 'leaf'],
  ['soursop', 'Soursop', ['soursop'], '#bad18d', '#5e7446', 'leaf'],
  ['strawberry', 'Strawberry', ['strawberry'], '#f09ba5', '#aa5367', 'berry'],
  ['tamarind', 'Tamarind', ['tamarind'], '#cdb08b', '#7f6548', 'leaf'],
  ['watermelon', 'Watermelon', ['watermelon'], '#f2a0a5', '#a2555f', 'leaf'],
].map(([key, name, aliases, accentColor, backgroundColor, icon]) => ({ key, name, aliases, accentColor, backgroundColor, icon }));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizeFilename = filename => path.parse(filename).name.toLowerCase().replace(/[^a-z0-9]/g, '');

function optionsFromArgs(args) {
  const options = { source: DEFAULT_SOURCE, apiUrl: process.env.ADMIN_API_URL || 'http://127.0.0.1:3010', origin: process.env.ADMIN_ORIGIN || 'http://localhost:3100', poster: '', posterId: '', publish: false, help: false, dryRun: false };
  const flags = { '--source': 'source', '--api-url': 'apiUrl', '--origin': 'origin', '--poster': 'poster', '--poster-id': 'posterId' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--publish') options.publish = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (flags[arg]) { if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${arg}.`); options[flags[arg]] = args[++index]; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.poster && options.posterId) throw new Error('Use either --poster or --poster-id.');
  if (options.dryRun && options.publish) throw new Error('--dry-run cannot publish.');
  const api = new URL(options.apiUrl);
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash) throw new Error('API URL must be HTTP(S), without credentials, query or fragment.');
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Origin must be an HTTP(S) origin without a path.');
  options.apiUrl = options.apiUrl.replace(/\/$/, '');
  return options;
}

async function discoverFiles(source) {
  const directory = path.resolve(source);
  const files = (await fs.readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && /\.(png|webp|jpe?g)$/i.test(file.name)).map(file => file.name);
  const records = [];
  for (const flavor of FLAVORS) {
    const candidates = files.filter(filename => flavor.aliases.includes(normalizeFilename(filename)));
    if (candidates.length !== 1) throw new Error(`Expected one label file for ${flavor.name}, found ${candidates.length}. Keep one version per fruit in the import directory.`);
    const filename = candidates[0], filePath = path.join(directory, filename);
    const bytes = await fs.readFile(filePath);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error(`Label file ${filename} is empty or exceeds 20 MB.`);
    records.push({ ...flavor, filename, filePath, sourceHash: hash(bytes), bytes: bytes.length });
  }
  return records;
}

function baseRecord(id, name, current) {
  const now = new Date().toISOString();
  return current ? { ...current, name, lifecycle: 'active' } : { id, name, slug: id, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now };
}
function sameBusinessValues(left, right) {
  const business = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['revision', 'createdAt', 'updatedAt'].includes(key)));
  return JSON.stringify(business(left)) === JSON.stringify(business(right));
}

/** No account bootstrap: imports require an existing authorized admin session. */
async function importJuiceDemo(options, credentials, output = message => process.stdout.write(`${message}\n`)) {
  const records = await discoverFiles(options.source);
  if (options.dryRun) {
    output(`Dry run: ${records.length} label files; ${records.reduce((sum, record) => sum + record.bytes, 0).toLocaleString('en-US')} source bytes.`);
    for (const record of records) output(`${record.filename} -> ${record.name} (${record.key})`);
    return { dryRun: true, count: records.length };
  }
  if (!credentials.email || !credentials.password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD for the existing local admin account. Credentials are never written to disk.');
  require('./register-admin-typescript.cjs');
  const { optimizeImage } = require('../lib/server/media/upload.ts');
  if (typeof optimizeImage !== 'function') throw new Error('The backend must export its shared optimizeImage helper before this importer can compare processed media hashes.');
  let cookie = '';
  let catalog;
  const counters = { created: 0, updated: 0, unchanged: 0, uploaded: 0, reusedMedia: 0 };
  async function request(endpoint, { body, form, headers: extraHeaders, method } = {}) {
    const headers = new Headers(extraHeaders); headers.set('Origin', options.origin);
    if (cookie) headers.set('Cookie', cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${options.apiUrl}/api/admin/v1/${endpoint}`, { method: method || (body !== undefined || form ? 'POST' : 'GET'), headers, ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      const error = new Error(result?.error?.message || `API ${endpoint} failed (HTTP ${response.status}).`);
      error.code = result?.error?.code; error.issues = result?.error?.issues;
      throw error;
    }
    const session = response.headers.get('Set-Cookie'); if (session) cookie = session.split(';')[0];
    return result.data;
  }
  async function save(collection, candidate) {
    const current = catalog[collection].find(record => record.id === candidate.id);
    if (current && sameBusinessValues(current, candidate)) { counters.unchanged++; return current; }
    const saved = await request('record', { body: { collection, record: candidate, expectedRevision: current?.revision ?? null } });
    const index = catalog[collection].findIndex(record => record.id === saved.id);
    if (index < 0) { catalog[collection].push(saved); counters.created++; } else { catalog[collection][index] = saved; counters.updated++; }
    return saved;
  }
  async function uploadMedia(filePath, role, importKey) {
    const bytes = await fs.readFile(filePath);
    // Share the server's exact encoding recipe, so deduplication compares the served file's checksum.
    const optimized = await optimizeImage(bytes, role);
    const runtimeHash = hash(optimized.buffer);
    const marker = `${importKey}-${runtimeHash.slice(0, 20)}`;
    const reusable = catalog.media.find(media => media.lifecycle === 'active' && media.status === 'ready' && media.role === role && media.sha256 === runtimeHash);
    if (reusable) { counters.reusedMedia++; return reusable; }
    const form = new FormData(); form.set('role', role);
    const mime = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(filePath).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image file: ${path.basename(filePath)}.`);
    form.set('file', new File([bytes], path.basename(filePath), { type: mime }));
    const uploaded = await request('upload', { form });
    if (uploaded.sha256 !== runtimeHash) throw new Error('The running API and local optimizer produced different image revisions. Restart the backend with the current code before retrying.');
    catalog.media.push(uploaded); counters.uploaded++;
    return save('media', { ...uploaded, slug: marker, name: `${importKey} · ${path.basename(filePath)}`.slice(0, 160) });
  }
  try {
    const user = await request('login', { body: credentials });
    if (options.publish && user.role !== 'owner') throw new Error('--publish requires the owner role.');
    let workspace = await request('catalog'); catalog = workspace.catalog;
    const drink = catalog.drinkTypes.find(record => record.id === 'juice' && record.lifecycle === 'active');
    const packaging = catalog.packagingVariants.find(record => record.id === PACKAGING_ID && record.lifecycle === 'active');
    let model = catalog.models3d.find(record => record.id === MODEL_ID && record.lifecycle === 'active');
    if (!drink || !packaging || !model || model.packagingVariantId !== PACKAGING_ID || model.layoutProfile !== 'can-wrap-v1' || !model.materialSlots.label?.length) throw new Error('Seed Juice, can-330 and registry-can-330 with can-wrap-v1 are required. Restore/import the actual model registry first.');
    let poster;
    if (options.poster) poster = await uploadMedia(path.resolve(options.poster), 'poster', 'juice30-can330-poster');
    else if (options.posterId) poster = catalog.media.find(media => media.id === options.posterId && media.status === 'ready' && media.lifecycle === 'active' && media.role === 'poster');
    else poster = catalog.media.find(media => media.id === model.posterId && media.status === 'ready' && media.lifecycle === 'active' && media.role === 'poster');
    if (!poster) throw new Error('Provide a real can poster with --poster FILE or --poster-id READY_MEDIA_ID; the existing model has no approved poster.');
    if (model.posterId !== poster.id) model = await save('models3d', { ...model, posterId: poster.id });
    const currentGroup = catalog.productGroups.find(record => record.id === GROUP_ID);
    let group = await save('productGroups', { ...baseRecord(GROUP_ID, 'Juice 30%', currentGroup), drinkTypeId: drink.id, description: 'Juice 30% · Alu can 330 ml · Bộ nhãn demo để kiểm tra bố cục và hương vị.', buttonLabel: 'Juice 30%', position: 0, visible: currentGroup?.visible ?? false });
    const oldSlot = catalog.packagingSlots.find(slot => slot.lifecycle === 'active' && slot.groupId === group.id && slot.packagingVariantId === packaging.id);
    if (oldSlot && oldSlot.id !== SLOT_ID) throw new Error(`Group already has another 330 ml slot (${oldSlot.id}). Keep a single slot; archive or migrate it before this import.`);
    const conflictingFirstSlot = catalog.packagingSlots.find(slot => slot.lifecycle === 'active' && slot.groupId === group.id && slot.id !== SLOT_ID && slot.position === 0);
    if (conflictingFirstSlot) throw new Error(`Slot position 0 is used by ${conflictingFirstSlot.id}. Reorder it before importing the 330 ml first slot.`);
    for (const [position, record] of records.entries()) {
      const flavorId = `juice30-${record.key}`, labelId = `juice30-can330-${record.key}-label`, variantId = `juice30-can330-${record.key}`, displayId = `juice30-can330-${record.key}-3d`;
      const media = await uploadMedia(record.filePath, 'label', `juice30-label-${record.key}`);
      const thumbnail = await uploadMedia(record.filePath, 'thumbnail', `juice30-thumbnail-${record.key}`);
      const flavor = await save('flavors', { ...baseRecord(flavorId, record.name, catalog.flavors.find(item => item.id === flavorId)), shortName: record.name, description: `${record.name} · Bộ nhãn Juice 30% 330 ml.`, accentColor: record.accentColor, backgroundColor: record.backgroundColor, textColor: '#ffffff', icon: record.icon, thumbnailId: thumbnail.id, position });
      const label = await save('labels', { ...baseRecord(labelId, `Juice 30% · ${record.name} · 330 ml`, catalog.labels.find(item => item.id === labelId)), drinkTypeId: drink.id, flavorId: flavor.id, mediaId: media.id, compatibilities: [{ packagingVariantId: packaging.id, layoutProfile: 'can-wrap-v1' }] });
      const variant = await save('productVariants', { ...baseRecord(variantId, `Juice 30% · ${record.name} · 330 ml`, catalog.productVariants.find(item => item.id === variantId)), groupId: group.id, packagingVariantId: packaging.id, flavorId: flavor.id, code: `JUICE30-330-${record.key.toUpperCase()}`, description: `${record.name} · Juice 30% · Alu can 330 ml.`, enabled: true });
      await save('displays3d', { ...baseRecord(displayId, `Juice 30% · ${record.name} · 330 ml`, catalog.displays3d.find(item => item.id === displayId)), productVariantId: variant.id, modelId: model.id, labelId: label.id, enabled: true });
      output(`Prepared ${String(position + 1).padStart(2, '0')}/${records.length}: ${record.name}`);
    }
    await save('packagingSlots', { ...baseRecord(SLOT_ID, 'Juice 30% · 330 ml', catalog.packagingSlots.find(item => item.id === SLOT_ID)), groupId: group.id, packagingVariantId: packaging.id, regionKey: 'packaging-picker', position: 0, buttonLabel: '330 ml', mode: '3d', defaultVariantId: 'juice30-can330-orange', enabled: true });
    group = await save('productGroups', { ...group, visible: true });
    const issues = await request('preflight');
    const blockers = issues.filter(issue => issue.severity === 'error');
    if (blockers.length) { const error = new Error(`Draft imported; ${blockers.length} publication blockers remain.`); error.issues = blockers; throw error; }
    output(`Draft ready: ${records.length} flavors, labels and 3D displays; 330 ml first slot, Orange default. ${JSON.stringify(counters)}`);
    if (!options.publish) { output('Draft only. Review artwork, colors and label orientation, then publish in admin or rerun with --publish.'); return { counters, count: records.length, issues, published: false }; }
    workspace = await request('catalog');
    const release = await request('publish', { headers: { 'X-Idempotency-Key': randomUUID() }, body: { note: 'Demo Juice 30% · 330 ml · 24 supplied labels; Orange default.', expectedReleaseId: workspace.activeReleaseId, expectedDraftHash: hash(JSON.stringify(workspace.catalog)) } });
    output(`Published local demo release ${release.id}.`);
    return { counters, count: records.length, issues, published: true, releaseId: release.id };
  } finally {
    if (cookie) await request('logout', { body: {} }).catch(() => {});
  }
}

function printHelp() {
  process.stdout.write(`Import Juice 30% / 330 ml demo using an existing admin account.\n\nEnvironment: ADMIN_EMAIL, ADMIN_PASSWORD (required), ADMIN_API_URL, ADMIN_ORIGIN (optional).\n\nnode scripts/import-juice-demo.cjs [--source DIRECTORY] [--poster FILE | --poster-id ID] [--api-url URL] [--origin ORIGIN] [--publish | --dry-run]\n\nDefault: authenticated local API http://127.0.0.1:3010; allowed Origin http://localhost:3100.\nNo default credentials or account setup. By default only the draft is imported.\nSource accepts 24 PNG/WebP/JPEG files by fruit name; original Logan/Payaya/Rabutan filenames map to Longan/Papaya/Rambutan.\nRe-running reuses stable records and media with the same source revision.\n`);
}

if (require.main === module) {
  let options;
  try { options = optionsFromArgs(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  if (options) {
    if (options.help) printHelp();
    else importJuiceDemo(options, { email: process.env.ADMIN_EMAIL || '', password: process.env.ADMIN_PASSWORD || '' }).catch(error => {
      process.stderr.write(`${error.message}\n`);
      for (const issue of error.issues || []) process.stderr.write(`${issue.collection}/${issue.entityId}: ${issue.message}\n`);
      process.exitCode = 1;
    });
  }
}
module.exports = { FLAVORS, optionsFromArgs, discoverFiles, importJuiceDemo };
