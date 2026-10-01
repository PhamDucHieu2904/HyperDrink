/* eslint-disable @typescript-eslint/no-require-imports -- Execute shipped TypeScript in this Node-only harness. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

function loadSource(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(require, loaded, loaded.exports);
  return loaded.exports;
}
const config = loadSource('lib/viewer-config.ts');
const environment = loadSource('lib/viewer/environment.ts');

test('environment records retain uploaded HDRIs and bound partial procedural admin settings', () => {
  const defaults = config.resolveViewerPresentation().environment;
  assert.equal(defaults.mode, 'hdri');
  assert.equal(config.resolveViewerPresentation({ environment: { src: '/environments/custom.exr' } }).environment.mode, 'hdri', 'Old HDRI records must keep their existing asset without an explicit mode');
  assert.equal(config.resolveViewerPresentation({ environment: { src: 'javascript:alert(1)' } }).environment.mode, 'hdri');
  const edited = config.resolveViewerPresentation({ environment: { mode: 'procedural', procedural: { seed: 45.8, skyIntensity: 99, groundIntensity: -4, canopyStrength: Infinity } } }).environment;
  assert.equal(edited.procedural.seed, 45);
  assert.equal(edited.procedural.skyIntensity, 3);
  assert.equal(edited.procedural.groundIntensity, 0.05);
  assert.equal(edited.procedural.canopyStrength, defaults.procedural.canopyStrength);
  assert.equal(edited.procedural.preset, 'soft-daylight');
  assert.deepEqual(config.resolveViewerPresentation(JSON.parse(JSON.stringify({ environment: edited }))).environment, edited, 'Persisted admin data survives a JSON round trip');
});

test('generated daylight is finite linear HDR with smooth radiance and a seamless horizon', () => {
  const texture = environment.createDaylightEnvironment(config.DEFAULT_VIEWER_PRESENTATION.environment.procedural);
  try {
    assert.equal(texture.type, THREE.HalfFloatType);
    assert.equal(texture.colorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
    assert.equal(texture.image.width, texture.image.height * 2);
    const { data, width, height } = texture.image;
    assert.ok(data instanceof Uint16Array);
    let minimum = Infinity;
    let maximum = 0;
    let neighborJump = 0;
    let colorSpread = 0;
    const sample = (x, y, channel = 0) => THREE.DataUtils.fromHalfFloat(data[(y * width + x) * 4 + channel]);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rgb = [0, 1, 2].map((channel) => sample(x, y, channel));
        assert.ok(rgb.every((value) => Number.isFinite(value) && value > 0));
        assert.equal(sample(x, y, 3), 1);
        minimum = Math.min(minimum, ...rgb);
        maximum = Math.max(maximum, ...rgb);
        colorSpread = Math.max(colorSpread, Math.max(...rgb) - Math.min(...rgb));
        neighborJump = Math.max(neighborJump, Math.abs(rgb[0] - sample((x + 1) % width, y)), y ? Math.abs(rgb[0] - sample(x, y - 1)) : 0);
      }
    }
    assert.ok(maximum > 3 && maximum < 4, 'Broad HDR sky openings reveal metal without a clipped sun hotspot');
    assert.ok(minimum > 0.4, 'No black horizon wall can darken one side of the print');
    assert.ok(neighborJump < 0.065, `Daylight should be broad, not a sharp studio stripe (${neighborJump})`);
    assert.ok(colorSpread < 0.065, 'Neutral daylight should not tint flavor artwork green or yellow');
    for (let y = 0; y < height; y += 1) {
      const seam = sample(0, y) - sample(width - 1, y);
      const before = sample(width - 1, y) - sample(width - 2, y);
      const after = sample(1, y) - sample(0, y);
      assert.ok(Math.abs(seam - before) < 0.006 && Math.abs(seam - after) < 0.006, 'Longitude seam gradient must continue like adjacent pixels, including half-float quantization');
    }
    assert.ok(sample(200, height - 1) > sample(200, 0) * 1.5, 'Sky belongs above the object, ground bounce below it');
  } finally { texture.dispose(); }
});

test('seeded lighting is deterministic and cache keys separate radiance from live rotation/intensity edits', () => {
  const defaults = config.resolveViewerPresentation({ environment: { mode: 'procedural' } }).environment;
  const first = environment.createDaylightEnvironment(defaults.procedural);
  const second = environment.createDaylightEnvironment(defaults.procedural);
  const alternate = environment.createDaylightEnvironment({ ...defaults.procedural, seed: defaults.procedural.seed + 1 });
  try {
    assert.deepEqual(first.image.data, second.image.data);
    assert.notDeepEqual(first.image.data, alternate.image.data, 'Seed changes actual reflected canopy/cloud structure');
    const key = environment.environmentCacheKey(defaults);
    assert.equal(environment.environmentCacheKey({ ...defaults, intensity: 1.8, rotation: [0, 2, 0] }), key, 'Live edits reuse PMREM instead of rebuilding GPU data');
    assert.notEqual(environment.environmentCacheKey({ ...defaults, procedural: { ...defaults.procedural, seed: 10 } }), key);
    assert.notEqual(environment.environmentCacheKey({ ...defaults, mode: 'hdri' }), key);
    assert.equal(environment.environmentCacheKey({ ...defaults, mode: 'hdri' }), `hdri:${defaults.src}`);
  } finally { first.dispose(); second.dispose(); alternate.dispose(); }
});
