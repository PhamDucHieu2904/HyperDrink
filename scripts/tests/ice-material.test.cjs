/* Run with: node scripts/tests/ice-material.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness runs the production shader material with real Three.js texture transforms and resource events. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
const source = fs.readFileSync(path.resolve(__dirname, '../../lib/viewer/ice-material.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', outputText)(require, loaded, loaded.exports);
const { createIceMaterial, updateIceMaterial } = loaded.exports;

test('ice uses caller-owned atlas crop and linear backdrop with correct color/alpha pipeline', () => {
  const map = new THREE.Texture({ width: 1792, height: 896 });
  map.repeat.set(0.5, 1); map.offset.set(0, 0);
  const background = new THREE.Texture();
  const material = createIceMaterial(map, background);
  assert.equal(material.uniforms.iceMap.value, map);
  assert.equal(material.uniforms.backdrop.value, background);
  const transformed = new THREE.Vector3(1, 1, 1).applyMatrix3(material.uniforms.iceMapTransform.value);
  assert.ok(Math.abs(transformed.x - 0.5) < 1e-12 && Math.abs(transformed.y - 1) < 1e-12,
    'The cropped left atlas cell cannot sample the stock water droplet at its right');
  assert.ok(Math.abs(material.uniforms.iceTexel.value.x - 1 / 896) < 1e-12);
  assert.ok(Math.abs(material.uniforms.iceTexel.value.y - 1 / 896) < 1e-12);
  assert.equal(material.toneMapped, false, 'The CSS backdrop must not receive product lighting/exposure');
  assert.equal(material.premultipliedAlpha, true); assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false); assert.equal(material.side, THREE.DoubleSide);
  let atlasDisposals = 0, backdropDisposals = 0;
  map.addEventListener('dispose', () => { atlasDisposals += 1; });
  background.addEventListener('dispose', () => { backdropDisposals += 1; });
  material.dispose();
  assert.equal(atlasDisposals, 0); assert.equal(backdropDisposals, 0);
  map.dispose(); background.dispose();
});

test('frame updates preserve resources, clamp invalid admin values and keep/null/swap sampler deliberately', () => {
  const map = new THREE.Texture({ width: 1792, height: 896 }); map.repeat.set(0.5, 1);
  const material = createIceMaterial(map);
  assert.equal(material.uniforms.hasBackdrop.value, 0);
  const background = new THREE.Texture();
  updateIceMaterial(material, { resolution: [720, 1560], opacity: 0.6, blur: 0.7, background });
  assert.equal(material.opacity, 0.6); assert.equal(material.uniforms.opacity.value, 0.6);
  assert.equal(material.uniforms.blur.value, 0.7);
  assert.deepEqual(material.uniforms.resolution.value.toArray(), [720, 1560]);
  assert.equal(material.uniforms.hasBackdrop.value, 1); assert.equal(material.uniforms.backdrop.value, background);
  const vector = material.uniforms.resolution.value;
  updateIceMaterial(material, { resolution: [Infinity, -10], opacity: NaN, blur: 100 });
  assert.equal(material.uniforms.resolution.value, vector, 'Frames do not allocate new uniform vectors');
  assert.deepEqual(vector.toArray(), [1, 1]);
  assert.equal(material.uniforms.opacity.value, 0); assert.equal(material.uniforms.blur.value, 12);
  assert.equal(material.uniforms.backdrop.value, background, 'Omitting background retains the live sampler');
  map.offset.x = 0.08;
  updateIceMaterial(material, { resolution: [100, 100], opacity: 1, blur: 0, background: null });
  assert.equal(material.uniforms.hasBackdrop.value, 0); assert.equal(material.uniforms.backdrop.value, null);
  assert.ok(Math.abs(new THREE.Vector3(0, 0, 1).applyMatrix3(material.uniforms.iceMapTransform.value).x - 0.08) < 1e-12,
    'Changes to the caller crop remain reflected in the shader');
  material.dispose(); map.dispose(); background.dispose();
});
