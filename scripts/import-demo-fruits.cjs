/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated local demo importer. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
require('./register-admin-typescript.cjs');
const { optimizeImage } = require('../lib/server/media/upload.ts');

/** Import only artwork and assignments. Never publish or modify product/model/label configuration. */
async function importDemoArtwork({ apiUrl = 'http://127.0.0.1:3010', origin = 'http://127.0.0.1:3100', email, password, role = 'fruit', familyByFlavor }) {
  if (!['fruit', 'leaf'].includes(role)) throw new Error('Only fruit or leaf demo artwork is supported.');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname)) throw new Error('Demo importer only supports the local admin API.');
  if (!email || !password) throw new Error('Provide the existing demo admin credentials in memory or environment variables.');
  const directory = path.resolve(`public/assets/demo-${role}-pool`);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  let cookie = '';
  async function request(endpoint, body, form) {
    const response = await fetch(`${apiUrl}/api/admin/v1/${endpoint}`, { method: body || form ? 'POST' : 'GET', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : form ? { body: form } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `Admin request failed: ${response.status}`);
    const session = response.headers.get('set-cookie');
    if (session) cookie = session.split(';')[0];
    return result.data;
  }
  const actor = await request('login', { email, password });
  let catalog;
  const counters = { uploaded: 0, reusedMedia: 0, addedAssignments: 0, retainedAssignments: 0, flavors: 0 };
  try {
    ({ catalog } = await request('catalog'));
    const aliases = familyByFlavor || { citrus: 'orange', berry: 'berry', peach: 'peach', lime: 'lime' };
    const targets = catalog.flavors.filter(item => item.lifecycle === 'active').map(flavor => ({ flavor, key: aliases[flavor.id] || flavor.id.replace(/^juice30-/, '') })).filter(item => manifest.assets.some(asset => asset.key === item.key));
    const mediaByFile = new Map();
    for (const target of targets) {
      for (const asset of manifest.assets.filter(item => item.key === target.key)) {
        const assignmentId = role === 'fruit' ? `demo-fruit-${target.flavor.id}-${asset.variant}-v1` : `demo-leaf-${target.flavor.id}-${asset.key}-${asset.variant}-v1`;
        if (catalog.flavorAssets.some(item => item.id === assignmentId)) { counters.retainedAssignments++; continue; }
        let media = mediaByFile.get(asset.filename);
        if (!media) {
          const bytes = await fs.readFile(path.join(directory, path.basename(asset.filename)));
          if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Asset changed: ${asset.filename}`);
          const optimized = await optimizeImage(bytes, role);
          const digest = createHash('sha256').update(optimized.buffer).digest('hex');
          media = catalog.media.find(item => item.role === role && item.sha256 === digest && item.lifecycle === 'active' && item.status === 'ready');
          if (media) counters.reusedMedia++;
          else {
            const form = new FormData();
            form.set('role', role); form.set('file', new File([bytes], asset.filename, { type: 'image/webp' }));
            media = await request('upload', undefined, form);
            catalog.media.push(media); counters.uploaded++;
          }
          mediaByFile.set(asset.filename, media);
        }
        const now = new Date().toISOString();
        const artworkName = role === 'fruit' ? `Fruit ${asset.variant}` : `Leaf ${asset.key} ${asset.variant}`;
        const record = { id: assignmentId, name: `${target.flavor.shortName} · ${artworkName} · Demo`, slug: assignmentId, lifecycle: 'active', revision: 0, createdAt: now, updatedAt: now, flavorId: target.flavor.id, mediaId: media.id, role, position: Math.max(-1, ...catalog.flavorAssets.filter(item => item.flavorId === target.flavor.id).map(item => item.position)) + 1, enabled: true };
        const saved = await request('record', { collection: 'flavorAssets', record, expectedRevision: null });
        catalog.flavorAssets.push(saved); counters.addedAssignments++;
      }
      counters.flavors++;
    }
    console.log({ ...counters, publication: 'unchanged', actor: actor.role });
    return counters;
  } finally { await request('logout', {}).catch(() => {}); }
}
function importDemoFruits(options) { return importDemoArtwork({ ...options, role: 'fruit' }); }
module.exports = { importDemoFruits, importDemoArtwork };
if (require.main === module) importDemoFruits({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).catch(error => { console.error(error.message); process.exitCode = 1; });
