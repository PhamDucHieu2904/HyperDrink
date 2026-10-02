'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Node-only static catalog export. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/** Export only the immutable active public release; never export accounts/drafts. */
function exportPublishedCatalog(options = {}) {
  const root = path.resolve(__dirname, '..');
  const dataDir = path.resolve(options.dataDir || process.env.ADMIN_DATA_DIR || path.join(root, 'data/admin'));
  const publicDir = path.resolve(options.publicDir || path.join(root, 'public'));
  const outputDir = path.resolve(options.outputDir || path.join(publicDir, 'catalog'));
  const database = new DatabaseSync(path.join(dataDir, 'catalog.sqlite'), { readOnly: true });
  let row;
  try {
    row = database.prepare('SELECT r.id,r.created_at,r.data FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
  } finally { database.close(); }
  if (!row) throw new Error('No active published catalog. Publish in admin before exporting.');
  const catalog = JSON.parse(row.data);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.media)) throw new Error('Unsupported published catalog schema.');
  const files = new Map();
  for (const media of catalog.media) {
    if (media.status !== 'ready' || media.lifecycle !== 'active') throw new Error(`Published media is not ready: ${media.id}`);
    let source;
    if (media.storageKey) {
      if (!/^[a-f0-9]{64}\.(png|jpg|webp|glb)$/.test(media.storageKey)) throw new Error(`Invalid media storage key: ${media.id}`);
      source = path.join(dataDir, 'media', media.storageKey);
    } else {
      if (!media.url.startsWith('/') || media.url.startsWith('//') || /[?#\\]/.test(media.url)) throw new Error(`Unsupported static media URL: ${media.id}`);
      source = path.resolve(publicDir, `.${media.url}`);
      if (!source.startsWith(publicDir + path.sep)) throw new Error(`Static media is outside public: ${media.id}`);
    }
    const bytes = fs.readFileSync(source);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (media.sha256 && checksum !== media.sha256) throw new Error(`Media checksum mismatch: ${media.id}`);
    if (media.bytes && bytes.length !== media.bytes) throw new Error(`Media byte length mismatch: ${media.id}`);
    if (media.storageKey) {
      if (!media.storageKey.startsWith(checksum + '.')) throw new Error(`Media storage checksum mismatch: ${media.id}`);
      files.set(media.storageKey, bytes);
      media.url = `/catalog/media/${media.storageKey}`;
      media.storageKey = '';
    }
  }
  // Validate every source before changing the public snapshot. Immutable hashed files
  // remain available to pages already viewing an earlier exported release.
  fs.mkdirSync(path.join(outputDir, 'media'), { recursive: true });
  for (const [name, bytes] of files) {
    const target = path.join(outputDir, 'media', name);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) continue;
    const temporary = path.join(outputDir, 'media', `${name}.${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, target);
  }
  const snapshot = { data: { catalog, releaseId: row.id, schemaVersion: 1, publishedAt: row.created_at } };
  const temporary = path.join(outputDir, `current.${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(snapshot) + '\n');
  fs.renameSync(temporary, path.join(outputDir, 'current.json'));
  return { releaseId: row.id, groups: catalog.productGroups.length, variants: catalog.productVariants.length, media: catalog.media.length, copiedFiles: files.size };
}

module.exports = { exportPublishedCatalog };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(exportPublishedCatalog(), null, 2) + '\n'); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1; }
}
