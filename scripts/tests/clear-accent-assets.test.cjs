/* Run with: node scripts/tests/clear-accent-assets.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Node verifies shipped asset bytes and loads the actual TypeScript scene contract. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '../..');
const publicRoot = path.join(projectRoot, 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'assets/scene/clear-accents.manifest.json'), 'utf8'));
const splashManifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'assets/scene/water-splash.manifest.json'), 'utf8'));

/** RIFF chunks and VP8X layout follow the official WebP container specification:
 * https://developers.google.com/speed/webp/docs/riff_container . */
function readWebp(buffer) {
  assert.ok(buffer.length >= 30, 'Truncated WebP cannot be uploaded');
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', 'A PNG renamed .webp is not a WebP asset');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  assert.equal(buffer.readUInt32LE(4) + 8, buffer.length, 'RIFF declared length must match the actual file');
  const chunks = new Map();
  for (let cursor = 12; cursor < buffer.length;) {
    assert.ok(cursor + 8 <= buffer.length, 'Chunk header must fit');
    const type = buffer.toString('ascii', cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const begin = cursor + 8, end = begin + length;
    assert.ok(end <= buffer.length, `${type} cannot reference missing payload bytes`);
    assert.equal(chunks.has(type), false, `Unexpected duplicate ${type} chunk`);
    chunks.set(type, buffer.subarray(begin, end));
    if (length % 2) {
      assert.ok(end < buffer.length, 'Odd chunk needs its RIFF padding byte');
      assert.equal(buffer[end], 0);
    }
    cursor = end + length % 2;
  }
  const extended = chunks.get('VP8X');
  assert.ok(extended && extended.length === 10, 'The transparent lossy pipeline must emit an extended WebP header');
  assert.ok(extended[0] & 0x10, 'WebP header must advertise alpha, not an opaque RGB replacement');
  assert.equal(extended[0] & 0x02, 0, 'Runtime accents are still images, not animated downloads');
  assert.ok(chunks.get('ALPH')?.length > 1, 'Transparency must have a real encoded alpha payload');
  assert.ok(chunks.get('VP8 ')?.length > 10, 'Image pixels must have a real encoded lossy payload');
  return { width: extended.readUIntLE(4, 3) + 1, height: extended.readUIntLE(7, 3) + 1 };
}

function assetBytes(asset) {
  const target = path.resolve(publicRoot, '.' + asset.src);
  assert.ok(target.startsWith(publicRoot + path.sep), 'Manifest asset must remain inside shipped public assets');
  return fs.readFileSync(target);
}

test('clear artwork exports contain four distinct water variants and one ice image within the download budget', () => {
  assert.equal(manifest.assets.length, 5);
  assert.equal(manifest.assets.filter(asset => asset.kind === 'droplet').length, 4);
  assert.equal(manifest.assets.filter(asset => asset.kind === 'ice').length, 1);
  assert.equal(new Set(manifest.assets.map(asset => asset.src)).size, 5);
  const buffers = manifest.assets.map(assetBytes);
  const actualHashes = buffers.map(buffer => crypto.createHash('sha256').update(buffer).digest('hex'));
  assert.equal(new Set(actualHashes).size, 5, 'Different entries must not silently reuse the same water photograph');
  const total = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  assert.equal(total, manifest.totalOutputBytes);
  assert.ok(total <= 160 * 1024, `Transparent accents exceed 160KiB: ${total} bytes`);
  assert.ok(total < manifest.totalSourceBytes * 0.05, 'Do not ship large original PNGs under the optimized URLs');
});

for (const asset of manifest.assets) test(`${asset.id} ships its verified transparent square WebP without changing the original artwork export`, () => {
  const buffer = assetBytes(asset);
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256, 'Changed bytes require rerunning the alpha/quality pipeline and recording its verification');
  assert.equal(buffer.length, asset.bytes);
  const dimensions = readWebp(buffer);
  const size = asset.kind === 'ice' ? 384 : 192;
  assert.deepEqual(dimensions, { width: size, height: size });
  assert.equal(dimensions.width, asset.width); assert.equal(dimensions.height, asset.height);
  // These decoded-pixel measurements are produced by Pillow and bound to the
  // exact bytes above. CI needs no image-decoder or private source PNG folder.
  assert.equal(asset.qualityCheck.alphaExact, true, 'Interior alpha must be unchanged by WebP compression');
  assert.ok(asset.qualityCheck.premultipliedRgbRmse < 5, 'Compression may not erase white highlight detail');
  assert.equal(asset.alpha.minimum, 0); assert.equal(asset.alpha.maximum, 255);
  assert.ok(asset.alpha.partialPixels > 0, 'Soft glass edges must retain partial transparency');
  assert.equal(asset.alpha.transparentPixels + asset.alpha.partialPixels + asset.alpha.opaquePixels, size * size);
  const [left, top, right, bottom] = asset.alpha.contentBounds;
  assert.ok(left > 0 && top > 0 && right < size && bottom < size, 'Decoded subject must have clear sampling borders on every side');
  assert.ok(asset.alpha.coverageFraction > 0.02 && asset.alpha.coverageFraction < 0.6, 'Do not flatten the transparent subject onto an opaque background');
});

function loadSource(relativePath) {
  const absolute = path.resolve(projectRoot, relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = { exports: {} };
  const localRequire = name => name.startsWith('.')
    ? loadSource(path.relative(projectRoot, path.resolve(path.dirname(absolute), `${name}.ts`)))
    : require(name);
  new Function('require', 'module', 'exports', outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

test('the default scene keeps verified white ice and restores native water without image assignments', () => {
  const { DEFAULT_PRODUCT_ACCENT_SCENE } = loadSource('lib/viewer/accent-config.ts');
  const expected = new Map(manifest.assets.map(asset => [asset.src, asset.kind]));
  const water = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.filter(node => node.enabled && ['droplet', 'ice'].includes(node.kind));
  assert.ok(water.length > 0);
  for (const node of water) {
    if (node.kind === 'droplet') {
      assert.equal(node.assetUrl, undefined, 'The selected water preset refracts the live scene');
      continue;
    }
    assert.equal(expected.get(node.assetUrl), node.kind, `${node.id} must select the matching supplied artwork rather than a missing/fake fallback`);
    assert.ok(fs.existsSync(path.resolve(publicRoot, '.' + node.assetUrl)));
  }
  assert.equal(water.filter(node => node.kind === 'ice').length, 2);
});

test('supplied splash ships transparent 768px WebP with clear padding within its download budget', () => {
  const asset = splashManifest.asset;
  const buffer = assetBytes(asset);
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256);
  assert.equal(buffer.length, asset.bytes);
  assert.ok(buffer.length <= 300 * 1024, 'Splash must remain a lightweight image, not the authoring PNG');
  assert.deepEqual(readWebp(buffer), { width: 768, height: 768 });
  assert.equal(asset.qualityCheck.alphaExact, true);
  assert.ok(asset.qualityCheck.premultipliedRgbRmse < 5);
  assert.equal(asset.alpha.minimum, 0);
  assert.ok(asset.alpha.partialPixels > 0);
  assert.ok(asset.alpha.coverageFraction > 0.02 && asset.alpha.coverageFraction < 0.4);
  const [left, top, right, bottom] = asset.alpha.contentBounds;
  assert.ok(left > 0 && top > 0 && right < 768 && bottom < 768);
});

test('the enabled splash node uses the verified supplied asset and the supplied glass exports stay distinct', () => {
  const { DEFAULT_PRODUCT_ACCENT_SCENE } = loadSource('lib/viewer/accent-config.ts');
  const splash = DEFAULT_PRODUCT_ACCENT_SCENE.nodes.filter(node => node.enabled && node.kind === 'splash');
  assert.equal(splash.length, 1);
  assert.equal(splash[0].assetUrl, splashManifest.asset.src);
  const { width, height, alpha } = splashManifest.asset;
  assert.deepEqual(splash[0].imageBounds,
    alpha.contentBounds.map((value, axis) => value / (axis % 2 === 0 ? width : height)),
    'Mobile fitting may ignore only the verified transparent margins, never visible water');
  assert.ok(!manifest.assets.some(asset => asset.src === splash[0].assetUrl));
  assert.ok(fs.existsSync(path.resolve(publicRoot, '.' + splash[0].assetUrl)));
});
