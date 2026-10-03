/* eslint-disable @typescript-eslint/no-require-imports -- Local image optimization and QA contact sheet. */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { createHash } = require('node:crypto');

async function main() {
  const source = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const role = process.argv[3] || 'fruit';
  if (!['fruit', 'leaf'].includes(role)) throw new Error('Only fruit or leaf demo artwork is supported.');
  const directory = path.resolve(`public/assets/demo-${role}-pool`);
  await fs.mkdir(directory, { recursive: true });
  const assets = [];
  for (const item of source.sort((a, b) => a.key.localeCompare(b.key) || a.variant - b.variant)) {
    if (!item.path || item.error) throw new Error(`Missing generated image: ${item.key} ${item.variant}`);
    const filename = `${item.key}-${item.variant}-v1.webp`;
    const output = path.join(directory, filename);
    const { data, info } = await sharp(item.path).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100, effort: 5 }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) throw new Error(`Generated image has no alpha: ${filename}`);
    const alpha = await sharp(data).extractChannel('alpha').raw().toBuffer();
    const transparent = alpha.filter(value => value === 0).length / alpha.length;
    if (transparent < .15) throw new Error(`Generated image is not a usable cutout: ${filename}`);
    await fs.writeFile(output, data, { flag: 'wx' });
    assets.push({ key: item.key, variant: item.variant, filename, width: info.width, height: info.height, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), transparentFraction: Number(transparent.toFixed(3)), prompt: item.prompt });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ generatedWith: 'built-in image_gen', createdAt: '2026-10-03', assets }, null, 2) + '\n');
  const columns = 5, cellWidth = 240, cellHeight = 180;
  const tiles = [];
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index];
    const label = `${asset.key} ${asset.variant}`;
    const tile = await sharp({ create: { width: cellWidth, height: cellHeight, channels: 4, background: '#e8efdf' } }).composite([
      { input: await sharp(path.join(directory, asset.filename)).resize({ width: 220, height: 142, fit: 'contain', background: '#00000000' }).toBuffer(), left: 10, top: 5 },
      { input: Buffer.from(`<svg width="240" height="28"><text x="10" y="20" fill="#183830" font-family="sans-serif" font-size="14">${label}</text></svg>`), left: 0, top: 150 },
    ]).png().toBuffer();
    tiles.push({ input: tile, left: index % columns * cellWidth, top: Math.floor(index / columns) * cellHeight });
  }
  await fs.mkdir('docs/screenshots', { recursive: true });
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(assets.length / columns) * cellHeight, channels: 4, background: '#fff' } }).composite(tiles).png().toFile(`docs/screenshots/demo-${role}-pool-2026-10-03.png`);
  console.log({ count: assets.length, bytes: assets.reduce((sum, item) => sum + item.bytes, 0), maxEdge: 640 });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
