/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated, idempotent local asset migration. */
require('./register-admin-typescript.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { optimizeImage } = require('../lib/server/media/upload.ts');

/** One shared image supplies both existing ice slots. Change only draft pools; never publish. */
async function importFlavorIce({ email, password, apiUrl = 'http://127.0.0.1:3010', origin = 'http://127.0.0.1:3100' }) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname)) throw new Error('Ice migration only supports the local admin API.');
  if (!email || !password) throw new Error('Provide existing admin credentials in memory or environment variables.');
  let cookie = '';
  async function request(endpoint, body, form) {
    const response = await fetch(`${apiUrl}/api/admin/v1/${endpoint}`, {
      method: body || form ? 'POST' : 'GET',
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : form ? { body: form } : {}), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `Admin request failed: ${response.status}`);
    const session = response.headers.get('set-cookie'); if (session) cookie = session.split(';')[0];
    return result.data;
  }
  await request('login', { email, password });
  try {
    const workspace = await request('catalog');
    const catalog = workspace.catalog;
    const targets = catalog.flavors.filter(flavor => flavor.lifecycle === 'active' && !flavor.icePoolConfigured && !catalog.flavorAssets.some(asset => asset.flavorId === flavor.id && asset.role === 'ice'));
    if (!targets.length) return { uploaded: 0, addedPools: 0, publication: 'unchanged' };
    const bytes = await fs.readFile(path.resolve('public/assets/scene/ice-clear.webp'));
    const optimized = await optimizeImage(bytes, 'ice');
    const digest = createHash('sha256').update(optimized.buffer).digest('hex');
    let media = catalog.media.find(asset => asset.role === 'ice' && asset.sha256 === digest && asset.status === 'ready' && asset.lifecycle === 'active');
    const uploaded = media ? 0 : 1;
    if (!media) {
      const form = new FormData(); form.set('role', 'ice'); form.set('file', new File([bytes], 'Ice cube.webp', { type: 'image/webp' }));
      media = await request('upload', undefined, form);
    }
    for (const flavor of targets) await request('flavor-pool', { id: randomUUID(), flavorId: flavor.id, mediaId: media.id, role: 'ice' });
    const after = await request('catalog');
    if (after.activeReleaseId !== workspace.activeReleaseId) throw new Error('Publication changed concurrently during migration.');
    return { uploaded, addedPools: targets.length, publication: 'unchanged' };
  } finally { await request('logout', {}).catch(() => {}); }
}
module.exports = { importFlavorIce };
if (require.main === module) importFlavorIce({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).then(result => console.log(result)).catch(error => { console.error(error.message); process.exitCode = 1; });
