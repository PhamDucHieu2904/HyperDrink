/* eslint-disable @typescript-eslint/no-require-imports -- Run shipped TypeScript without browser/GPU boundaries. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const source = fs.readFileSync(path.resolve(__dirname, '../../lib/viewer/droplet-material.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputText)(require, loaded, loaded.exports);
const { createDropletMaterial, updateDropletMaterial } = loaded.exports;

test('droplet updates follow fades, DPR changes and backdrop replacement without taking sampler ownership', () => {
  const background = new THREE.Texture();
  const replacement = new THREE.Texture();
  let textureDisposals = 0;
  background.addEventListener('dispose', () => { textureDisposals += 1; });
  replacement.addEventListener('dispose', () => { textureDisposals += 1; });
  const material = createDropletMaterial(background);
  const resolution = material.uniforms.resolution.value;
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.depthTest, true);
  assert.equal(material.premultipliedAlpha, true);
  assert.equal(material.toneMapped, false, 'Changing product exposure must not re-expose the CSS backdrop payload');
  assert.equal(material.userData.accentOpacity, 1);
  updateDropletMaterial(material, { resolution: [1170, 2532], opacity: 0.38, blur: 2.5 });
  assert.equal(material.opacity, 0.38);
  assert.equal(material.uniforms.opacity.value, 0.38);
  assert.equal(material.uniforms.blur.value, 2.5);
  assert.deepEqual(resolution.toArray(), [1170, 2532]);
  assert.equal(material.uniforms.resolution.value, resolution, 'Frame updates reuse the same vector');
  assert.equal(material.uniforms.backdrop.value, background, 'Omitting the sampler retains the live resource');
  updateDropletMaterial(material, { resolution: [780, 1688], opacity: 1, blur: 0, background: replacement });
  assert.equal(material.uniforms.backdrop.value, replacement);
  assert.equal(material.uniforms.hasBackdrop.value, 1);
  updateDropletMaterial(material, { resolution: [780, 1688], opacity: 0.8, blur: 1, background: null });
  assert.equal(material.uniforms.hasBackdrop.value, 0, 'An unavailable backdrop returns to the clear fallback');
  assert.equal(material.uniforms.backdrop.value, null);
  material.dispose();
  assert.equal(textureDisposals, 0, 'Materials never dispose a shared backdrop owned by the viewer');
  background.dispose(); replacement.dispose();
});

test('missing backgrounds and invalid frame values remain safe during loading, resize and fade', () => {
  const material = createDropletMaterial(null);
  try {
    assert.equal(material.uniforms.hasBackdrop.value, 0);
    assert.equal(material.uniforms.backdrop.value, null);
    updateDropletMaterial(material, { resolution: [NaN, 0], opacity: Infinity, blur: -10 });
    assert.deepEqual(material.uniforms.resolution.value.toArray(), [1, 1], 'Collapsed/invalid drawing buffers cannot divide by zero');
    assert.equal(material.uniforms.opacity.value, 0);
    assert.equal(material.uniforms.blur.value, 0);
    updateDropletMaterial(material, { resolution: [1000000, 2000], opacity: 8, blur: 100 });
    assert.deepEqual(material.uniforms.resolution.value.toArray(), [16384, 2000]);
    assert.equal(material.uniforms.opacity.value, 1);
    assert.equal(material.uniforms.blur.value, 12);
  } finally { material.dispose(); }
});
