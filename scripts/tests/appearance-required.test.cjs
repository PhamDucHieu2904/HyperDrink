/* Run with: node scripts/tests/appearance-required.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Executes the shipped appearance handle with real Three materials and deferred image loading. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const materialAdjustments = require('../../lib/viewer/material-adjustments.ts');
function loadSource(file, importer = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', outputText)(name => name === './material-adjustments' ? materialAdjustments : name === './bottle-backdrop' ? require('../../lib/viewer/bottle-backdrop.ts') : importer(name), loaded, loaded.exports); return loaded.exports;
}
const config = loadSource('lib/viewer-config.ts'), urls = loadSource('lib/public-url.ts');
const aloeMaterials = loadSource('lib/viewer/aloe-bottle-materials.ts');
const bottleMaterials = loadSource('lib/viewer/bottle-materials.ts', name => name === './aloe-bottle-materials' ? aloeMaterials : name === './basil-bottle-materials' ? require('../../lib/viewer/basil-bottle-materials.ts') : name === './basil-web-materials' ? require('../../lib/viewer/basil-web-materials.ts') : require(name));
const required = url => ({ requiredSlots: ['label'], slots: { label: { baseColorMap: url, roughness: .15 } } });
function fixture(context, { names = ['printed-label'], basic = false, uv = true, textureSamplers, secondary = false } = {}) {
  const requests = [], clones = [];
  class TextureLoader {
    loadAsync(url) {
      let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
      requests.push({ url, resolve, reject }); return promise;
    }
  }
  const appearance = loadSource('lib/viewer/appearance.ts', name => {
    if (name === 'three') return { ...THREE, TextureLoader };
    if (name === '../viewer-config') return config;
    if (name === '../public-url') return urls;
    if (name === './bottle-materials') return bottleMaterials;
    throw new Error(`Unexpected appearance dependency: ${name}`);
  });
  const texture = () => { const value = new THREE.Texture(); value.disposals = 0; value.addEventListener('dispose', () => { value.disposals++; }); return value; };
  const root = new THREE.Group(), meshes = [], importedTextures = [];
  const makeMesh = (materialName, meshName) => {
    const original = basic ? new THREE.MeshBasicMaterial() : new THREE.MeshPhysicalMaterial();
    original.name = materialName; original.map = texture(); importedTextures.push(original.map);
    if (!basic) {
      original.normalMap = texture(); original.roughnessMap = texture(); importedTextures.push(original.normalMap, original.roughnessMap);
      original.color.set('#667755'); original.metalness = .72; original.roughness = .64; original.clearcoat = .37;
      original.normalScale.set(.8, .6);
    }
    original.disposals = 0; original.addEventListener('dispose', () => { original.disposals++; });
    const cloneOriginal = original.clone.bind(original);
    original.clone = () => { const clone = cloneOriginal(); clone.disposals = 0; clone.addEventListener('dispose', () => { clone.disposals++; }); clones.push(clone); return clone; };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); mesh.name = meshName; root.add(mesh); meshes.push({ mesh, original });
    return { mesh, original };
  };
  const { mesh, original } = makeMesh('printed-label', 'label-mesh');
  const second = secondary ? makeMesh('secondary-print', 'secondary-mesh') : null;
  if (!uv) mesh.geometry.deleteAttribute('uv');
  const materialSlots = { label: names, ...(secondary ? { secondary: ['secondary-print'] } : {}) };
  const handle = appearance.createAppearanceHandle(root, { id: 'can', name: 'Can', src: '/can.glb', packaging: 'can', materialSlots, textureSamplers });
  context.after(() => { handle.dispose(); meshes.forEach(entry => { entry.mesh.geometry.dispose(); entry.original.dispose(); }); importedTextures.forEach(value => value.dispose()); });
  return { handle, mesh, original, second, requests, clones, texture, importedTextures };
}

function sampledUv(texture, u, v = .5) {
  return texture.transformUv(new THREE.Vector2(u, v));
}

async function waitForRequest(f, count) {
  for (let attempt = 0; attempt < 20 && f.requests.length < count; attempt++) await Promise.resolve();
  assert.equal(f.requests.length, count, `Expected ${count} deferred texture requests`);
}

test('a required print binds by material or mesh name, owns its texture and restores imported PBR on disposal', async context => {
  for (const names of [['printed-label'], ['label-mesh']]) {
    const f = fixture(context, { names });
    const pending = f.handle.apply(required('/labels/orange.webp')), texture = f.texture();
    assert.equal(f.requests[0].url, '/labels/orange.webp'); f.requests[0].resolve(texture); await pending;
    assert.notEqual(f.mesh.material, f.original); assert.equal(f.mesh.material.map, texture);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace); assert.equal(texture.flipY, false);
    assert.equal(f.mesh.material.roughness, .15); assert.notEqual(f.original.map, texture);
    f.handle.dispose(); f.handle.dispose();
    assert.equal(f.mesh.material, f.original); assert.equal(texture.disposals, 1); assert.equal(f.clones[0].disposals, 1);
  }
});

test('required slots reject missing bindings, unsupported materials and missing texture UVs instead of silently succeeding', async context => {
  for (const [options, pattern] of [[{ names: ['not-a-material'] }, /compatible material binding/], [{ basic: true }, /compatible material binding/], [{ uv: false }, /UV coordinates/]]) {
    const f = fixture(context, options);
    await assert.rejects(f.handle.apply(required('/labels/orange.webp')), pattern);
    assert.equal(f.mesh.material, f.original); assert.equal(f.requests.length, 0);
  }
});

test('required slots reject absent/empty appearance and invalid declared maps even if a finish override is present', async context => {
  const f = fixture(context);
  for (const value of [{ requiredSlots: ['label'] }, { requiredSlots: ['label'], slots: { label: {} } }]) await assert.rejects(f.handle.apply(value), /no print or override/);
  await assert.rejects(f.handle.apply(required('javascript:alert(1)')), /invalid texture URL/);
  assert.equal(f.mesh.material, f.original); assert.equal(f.requests.length, 0);
});

test('failed required textures clean the new materials while leaving the last committed appearance reversible', async context => {
  const f = fixture(context), first = f.texture();
  const initial = f.handle.apply(required('/labels/orange.webp')); f.requests[0].resolve(first); await initial;
  const material = f.mesh.material;
  const failed = f.handle.apply(required('/labels/mango.webp')); f.requests[1].reject(new Error('404 missing uploaded label'));
  await assert.rejects(failed, /could not be loaded/);
  assert.equal(f.mesh.material, material); assert.equal(f.mesh.material.map, first);
  assert.equal(first.disposals, 0); assert.equal(f.clones[1].disposals, 1);
  f.handle.dispose(); assert.equal(first.disposals, 1); assert.equal(f.clones[0].disposals, 1);
});

test('obsolete texture failures cannot undo the newer required label or dispose its owned texture', async context => {
  const f = fixture(context), latest = f.texture();
  const old = f.handle.apply(required('/labels/old.webp'));
  const current = f.handle.apply(required('/labels/new.webp')); f.requests[1].resolve(latest); await current;
  const material = f.mesh.material;
  f.requests[0].reject(new Error('Older request failed')); await assert.rejects(old, /could not be loaded/);
  assert.equal(f.mesh.material, material); assert.equal(f.mesh.material.map, latest); assert.equal(latest.disposals, 0);
  assert.equal(f.clones[0].disposals, 1);
});

test('optional appearances keep the established silent missing-binding behavior', async context => {
  const f = fixture(context, { names: ['absent'] });
  await f.handle.apply({ slots: { label: { baseColorMap: '/optional.webp' } } });
  assert.equal(f.mesh.material, f.original); assert.equal(f.requests.length, 0);
});

test('cylindrical seam UVs repeat uploaded labels beyond U=1 while unspecified generic slots clamp', async context => {
  for (const [textureSamplers, wrapS, seamU] of [
    [{ label: { wrapS: 'repeat', wrapT: 'clamp' } }, THREE.RepeatWrapping, .01],
    [undefined, THREE.ClampToEdgeWrapping, 1],
  ]) {
    const f = fixture(context, { textureSamplers }), texture = f.texture();
    // Imported seam triangles interpolate outside the 0..1 interval.
    f.mesh.geometry.getAttribute('uv').setXY(0, 1.01, .35);
    texture.wrapS = THREE.MirroredRepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    const pending = f.handle.apply(required('/labels/rambutan.webp')); f.requests[0].resolve(texture); await pending;
    const uv = f.mesh.geometry.getAttribute('uv');
    const sampled = sampledUv(f.mesh.material.map, uv.getX(0), uv.getY(0));
    assert.equal(texture.wrapS, wrapS); assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.ok(Math.abs(sampled.x - seamU) < 1e-6); assert.ok(Math.abs(sampled.y - .35) < 1e-6);
    assert.equal(sampledUv(texture, .4, 1.4).y, 1, 'The label top/bottom borders still clamp');
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace); assert.equal(texture.flipY, false);
    f.handle.dispose(); assert.equal(f.mesh.material, f.original); assert.equal(texture.disposals, 1);
  }
});

test('equal image URLs with different per-slot S or T addressing do not share mutable textures', async context => {
  for (const secondary of [{ wrapS: 'clamp', wrapT: 'clamp' }, { wrapS: 'repeat', wrapT: 'repeat' }]) {
    const f = fixture(context, { secondary: true, textureSamplers: { label: { wrapS: 'repeat', wrapT: 'clamp' }, secondary } });
    const pending = f.handle.apply({ requiredSlots: ['label', 'secondary'], slots: { label: { baseColorMap: '/labels/shared.webp' }, secondary: { baseColorMap: '/labels/shared.webp' } } });
    assert.deepEqual(f.requests.map(request => request.url), ['/labels/shared.webp', '/labels/shared.webp']);
    const textures = [f.texture(), f.texture()]; f.requests.forEach((request, index) => request.resolve(textures[index])); await pending;
    const first = f.mesh.material.map, second = f.second.mesh.material.map;
    assert.notEqual(first, second); assert.equal(first.wrapS, THREE.RepeatWrapping); assert.equal(first.wrapT, THREE.ClampToEdgeWrapping);
    assert.equal(second.wrapS, secondary.wrapS === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    assert.equal(second.wrapT, secondary.wrapT === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    assert.equal(sampledUv(first, 1.25, 1.25).x, .25); assert.equal(sampledUv(first, 1.25, 1.25).y, 1);
    assert.equal(sampledUv(second, 1.25, 1.25).x, secondary.wrapS === 'repeat' ? .25 : 1);
    assert.equal(sampledUv(second, 1.25, 1.25).y, secondary.wrapT === 'repeat' ? .25 : 1);
    f.handle.dispose();
    assert.equal(f.mesh.material, f.original); assert.equal(f.second.mesh.material, f.second.original);
    textures.forEach(texture => assert.equal(texture.disposals, 1));
  }
});

test('equal image URL, color space and sampler deduplicate across slots and dispose exactly once', async context => {
  const sampler = { wrapS: 'repeat', wrapT: 'clamp' };
  const f = fixture(context, { secondary: true, textureSamplers: { label: sampler, secondary: { ...sampler } } });
  const pending = f.handle.apply({ requiredSlots: ['label', 'secondary'], slots: { label: { baseColorMap: '/labels/shared.webp' }, secondary: { baseColorMap: '/labels/shared.webp' } } });
  assert.equal(f.requests.length, 1);
  const texture = f.texture(); f.requests[0].resolve(texture); await pending;
  assert.equal(f.mesh.material.map, texture); assert.equal(f.second.mesh.material.map, texture);
  assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.disposals, 0);
  f.handle.dispose(); f.handle.dispose(); assert.equal(texture.disposals, 1);
});

test('samplers apply to all declared maps without mixing color spaces or modifying imported PBR', async context => {
  const f = fixture(context, { textureSamplers: { label: { wrapS: 'repeat', wrapT: 'clamp' } } });
  const imported = { map: f.original.map, normalMap: f.original.normalMap, roughnessMap: f.original.roughnessMap, color: f.original.color.getHex(), metalness: f.original.metalness, roughness: f.original.roughness, clearcoat: f.original.clearcoat, normalScale: f.original.normalScale.toArray() };
  const pending = f.handle.apply({ requiredSlots: ['label'], slots: { label: { baseColorMap: '/maps/shared.webp', normalMap: '/maps/shared.webp', roughnessMap: '/maps/shared.webp', roughness: .15, metalness: 0, clearcoat: .2, normalScale: .4 } } });
  const color = f.texture(), data = f.texture();
  f.requests[0].resolve(color); await waitForRequest(f, 2); f.requests[1].resolve(data); await pending;
  assert.equal(f.requests.length, 2, 'The data-map request is separate from sRGB, then reused for roughness');
  assert.equal(f.mesh.material.map, color); assert.equal(f.mesh.material.normalMap, data); assert.equal(f.mesh.material.roughnessMap, data);
  assert.equal(color.colorSpace, THREE.SRGBColorSpace); assert.equal(data.colorSpace, THREE.NoColorSpace);
  for (const texture of [color, data]) { assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping); assert.equal(texture.flipY, false); assert.equal(sampledUv(texture, 1.25).x, .25); }
  assert.equal(f.mesh.material.color.getHex(), imported.color, 'Uploaded artwork preserves the imported material tint');
  assert.deepEqual(f.mesh.material.normalScale.toArray(), [.4, .4]);
  f.handle.dispose();
  assert.equal(f.mesh.material, f.original);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalness', 'roughness', 'clearcoat']) assert.equal(f.original[key], imported[key]);
  assert.equal(f.original.color.getHex(), imported.color); assert.deepEqual(f.original.normalScale.toArray(), imported.normalScale);
  f.importedTextures.forEach(texture => assert.equal(texture.disposals, 0, 'Imported maps remain owned by the loaded model'));
  assert.equal(f.original.disposals, 0); assert.equal(color.disposals, 1); assert.equal(data.disposals, 1); assert.equal(f.clones[0].disposals, 1);
});

test('procedural artwork uses its named slot sampler and restores original materials on disposal', async context => {
  const previousDocument = global.document;
  const context2d = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return { width: 0, height: 0, getContext: () => context2d }; } };
  context.after(() => { if (previousDocument === undefined) delete global.document; else global.document = previousDocument; });
  for (const [sampler, expectedS] of [[{ wrapS: 'repeat', wrapT: 'clamp' }, THREE.RepeatWrapping], [undefined, THREE.ClampToEdgeWrapping]]) {
    const f = fixture(context, { secondary: true, textureSamplers: sampler ? { label: { wrapS: 'clamp', wrapT: 'clamp' }, secondary: sampler } : undefined });
    await f.handle.apply({ requiredSlots: ['secondary'], label: { slot: 'secondary', name: 'Rambutan', colors: ['#aa1100', '#bb2200', '#cc3300'] } });
    assert.equal(f.requests.length, 0); assert.equal(f.mesh.material, f.original);
    const texture = f.second.mesh.material.map; assert.ok(texture instanceof THREE.CanvasTexture);
    assert.equal(texture.wrapS, expectedS); assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace); assert.equal(texture.flipY, false);
    assert.equal(sampledUv(texture, 1.25).x, sampler ? .25 : 1);
    let disposals = 0; texture.addEventListener('dispose', () => { disposals++; });
    f.handle.dispose(); f.handle.dispose(); assert.equal(disposals, 1); assert.equal(f.second.mesh.material, f.second.original);
    f.importedTextures.forEach(value => assert.equal(value.disposals, 0));
  }
});
