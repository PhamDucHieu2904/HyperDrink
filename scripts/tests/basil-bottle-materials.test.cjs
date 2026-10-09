/* Run with: node --test scripts/tests/basil-bottle-materials.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Uses the shipped host with real Three.js and original optical data. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const basil = require('../../lib/viewer/basil-bottle-materials.ts');
const data = require('../../lib/viewer/basil-high-data.ts');
const { createPooledAppearanceHandle } = require('../../lib/viewer/pooled-appearance.ts');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/models/bottles/glass-290-basil.manifest.json'), 'utf8'));
const compressed = Object.fromEntries(['high', 'neck'].map(kind => [kind, fs.readFileSync(path.resolve(__dirname, `../../public/models/bottles/glass-290-basil-${kind}.bin.gz`))]));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function mockFetch(context) {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async url => {
    const kind = String(url).includes('-neck.bin.gz') ? 'neck' : String(url).includes('-high.bin.gz') ? 'high' : undefined;
    assert.ok(kind, `Only the two original optical data files are requested: ${url}`);
    requests.push(kind);
    return new Response(compressed[kind], { status: 200 });
  };
  context.after(async () => { await settle(); globalThis.fetch = original; });
  return requests;
}
const asset = { id: 'glass-290-basil', name: 'Basil', src: '/models/bottles/glass-290-basil.glb', packaging: 'glass', materialSlots: {
  body: ['glass-body', 'glass-base', 'glass-neck', 'basil-high-outer', 'basil-high-inner', 'basil-high-neck'],
  liquid: ['basil-liquid'], inclusions: ['basil-seed', 'basil-gel'], cap: ['gold-cap'], label: ['paper-label'],
} };
function fixture(context) {
  const root = new THREE.Group(), meshes = {}, originals = {}, geometries = [], imported = [];
  function mesh(key, names, userData = {}) {
    const materials = names.map(name => {
      const material = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: .8, roughness: .3 });
      material.name = name; material.userData = { basilProfile: 'basil-high-v1' }; return material;
    });
    const geometry = new THREE.BoxGeometry(); geometries.push(geometry);
    const object = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    object.name = key; object.userData = userData; root.add(object); meshes[key] = object;
    originals[key] = object.material; return object;
  }
  mesh('body', ['glass-body']); mesh('base', ['glass-base']); mesh('oldNeck', ['glass-neck']);
  mesh('water', ['basil-liquid']); mesh('seeds', ['basil-seed']); mesh('gel', ['basil-gel']);
  mesh('outer', ['basil-high-outer', 'basil-high-inner'], {
    basilHighInterface: true, unityAlignment: manifest.highInterface.nativeToSourceScale / 100,
    nativeToGlbMatrix: manifest.highInterface.nativeToGlbMatrixRowMajor.flat(),
  });
  mesh('neck', ['basil-high-neck'], { basilHighNeck: true, nativeToGlbMatrix: manifest.highNeck.nativeToGlbMatrixRowMajor.flat() });
  mesh('cap', ['gold-cap']); mesh('label', ['paper-label']);
  for (const slot of ['map', 'normalMap', 'roughnessMap']) {
    const texture = new THREE.Texture(); texture.disposals = 0; texture.addEventListener('dispose', () => texture.disposals++);
    originals.outer[0][slot] = texture; imported.push(texture);
  }
  const print = new THREE.Texture(); print.disposals = 0; print.addEventListener('dispose', () => print.disposals++);
  originals.label.map = print; imported.push(print);
  context.after(() => {
    geometries.forEach(geometry => geometry.dispose());
    Object.values(originals).flat().forEach(material => material.dispose());
    imported.forEach(texture => texture.dispose());
  });
  return { root, meshes, originals, imported, print };
}
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {}); return shader;
}
const samplerNames = ['basilHighResidualTriangles', 'basilHighResidualNodes', 'basilHighProfiles', 'basilHighProfileNodes', 'basilHighSeeds', 'basilHighSeedNodes'];
function texturesOf(shader) { return samplerNames.map(name => shader.uniforms[name].value); }
function assertNear(a, b, epsilon = 1e-10) { assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`); }

test('only the explicit Basil glass profile selects High; unrelated packaging and materials remain untouched', context => {
  const f = fixture(context), original = f.originals.outer[0];
  assert.equal(basil.basilMaterialRole(asset, f.meshes.outer, original), 'body');
  assert.equal(basil.basilMaterialRole({ ...asset, packaging: 'pet' }, f.meshes.outer, original), undefined);
  assert.equal(basil.basilMaterialRole({ ...asset, materialSlots: { body: ['unrelated'] } }, f.meshes.outer, original), undefined);
  assert.equal(basil.createBasilBottleMaterialContext(f.root, { ...asset, packaging: 'can' }), undefined);
  original.userData = {}; f.originals.outer[1].userData = {};
  assert.equal(basil.basilMaterialRole(asset, f.meshes.outer, original), undefined);
  const unrelated = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); unrelated.add(mesh);
  basil.prepareBasilHighLayers(unrelated, asset); assert.equal(mesh.visible, true); assert.equal(mesh.renderOrder, 0);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('High retains authored layers but draws only the outer shell and separate neck, without water/seed/gel overdraw', context => {
  const f = fixture(context); basil.prepareBasilHighLayers(f.root, asset);
  for (const key of ['body', 'base', 'oldNeck', 'water', 'seeds', 'gel']) assert.equal(f.meshes[key].visible, false, key);
  for (const key of ['outer', 'neck', 'cap', 'label']) assert.equal(f.meshes[key].visible, true, key);
  assert.equal(f.originals.outer[1].visible, false, 'Inner geometry is traced, never independently rasterized');
  assert.equal(f.meshes.outer.renderOrder, 10); assert.equal(f.meshes.neck.renderOrder, 10);
  assert.equal(f.meshes.cap.renderOrder, 30); assert.equal(f.meshes.label.renderOrder, 30);
  assert.equal(Object.keys(f.meshes).length, 10, 'No extra scattering, gel or backdrop mesh is allocated');
});

test('body and neck bind the shipped Float32 interfaces, separate coordinate frames and original optical distance units', async context => {
  const requests = mockFetch(context), f = fixture(context);
  const handle = basil.createBasilBottleMaterialContext(f.root, asset); context.after(() => handle.dispose());
  await handle.ready;
  const outer = f.originals.outer[0].clone(), neck = f.originals.neck.clone();
  context.after(() => { outer.dispose(); neck.dispose(); });
  handle.configure(outer, f.meshes.outer, 'body'); handle.configure(neck, f.meshes.neck, 'body');
  const shaders = [compile(outer), compile(neck)];
  assert.deepEqual(requests.sort(), ['high', 'neck']);
  shaders.forEach(shader => {
    assert.match(shader.fragmentShader, /texelFetch/);
    texturesOf(shader).forEach(texture => {
      assert.ok(texture instanceof THREE.DataTexture); assert.ok(texture.image.data instanceof Float32Array);
      assert.equal(texture.type, THREE.FloatType); assert.equal(texture.format, THREE.RGBAFormat);
      assert.equal(texture.minFilter, THREE.NearestFilter); assert.equal(texture.magFilter, THREE.NearestFilter);
      assert.equal(texture.generateMipmaps, false); assert.equal(texture.colorSpace, THREE.NoColorSpace);
    });
  });
  assert.equal(shaders[0].uniforms.basilHighResidualNodeStride.value, 8191);
  assert.equal(shaders[1].uniforms.basilHighResidualNodeStride.value, 0);
  assert.equal(shaders[0].uniforms.basilHighNeck.value, 0); assert.equal(shaders[1].uniforms.basilHighNeck.value, 1);
  assert.ok(shaders[1].uniforms.basilHighRayEpsilon.value > shaders[0].uniforms.basilHighRayEpsilon.value * 20);
  assert.equal(new Set(shaders.flatMap(texturesOf)).size, 12, 'NeckVan never accidentally samples BasilVan body data');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .01, 100);
  f.root.scale.setScalar(2.7); f.root.rotation.set(.2, -.7, .1); scene.add(f.root);
  camera.position.set(.3, .2, 1); camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
  for (const [material, mesh, shader, scale] of [[outer, f.meshes.outer, shaders[0], manifest.highInterface.nativeToSourceScale], [neck, f.meshes.neck, shaders[1], 1]]) {
    material.onBeforeRender({}, scene, camera, mesh.geometry, mesh, {});
    const matrix = shader.uniforms.basilHighLocalToWorld.value;
    for (let axis = 0; axis < 3; axis++) assertNear(new THREE.Vector3().setFromMatrixColumn(matrix, axis).length(), scale);
    assertNear(shader.uniforms.basilHighBackgroundDistance.value, .25 * manifest.appMetersPerSourceUnit * f.root.scale.x,
      1e-10);
    const restoredCamera = shader.uniforms.basilHighCameraNative.value.clone().applyMatrix4(shader.uniforms.basilHighNativeToScene.value);
    assert.ok(restoredCamera.distanceTo(camera.position) < 1e-10);
  }
  assert.equal(outer.map, null); assert.equal(outer.normalMap, null); assert.equal(outer.roughnessMap, null);
  assert.equal(outer.transmission, 0, 'High does not silently invoke Three\'s separate transmission pyramid');
  assert.equal(outer.side, THREE.FrontSide); assert.equal(outer.depthWrite, true);
  f.imported.forEach(texture => assert.equal(texture.disposals, 0, 'Imported maps remain model-owned'));
  basil.setBasilHighBackdrop(scene, null, null, null, true);
  outer.onBeforeRender({}, scene, camera, f.meshes.outer.geometry, f.meshes.outer, {});
  neck.onBeforeRender({}, scene, camera, f.meshes.neck.geometry, f.meshes.neck, {});
  assert.equal(shaders[0].uniforms.basilHighNativeAlpha.value, 0, 'Body beauty keeps product-silhouette alpha');
  assert.equal(shaders[1].uniforms.basilHighNativeAlpha.value, 1, 'Only native neck capture measures transmitted alpha');
  assert.equal(shaders[1].uniforms.basilHighHasMatte.value, 0);
  basil.setBasilHighBackdrop(scene, null, new THREE.Color('#ffffff'));
  neck.onBeforeRender({}, scene, camera, f.meshes.neck.geometry, f.meshes.neck, {});
  assert.equal(shaders[1].uniforms.basilHighNativeAlpha.value, 0);
  assert.equal(shaders[1].uniforms.basilHighHasMatte.value, 1);
  basil.setBasilHighBackdrop(scene, null);
});

test('liquid roughness drives the High seed blur without later seed/gel edits replacing it', async context => {
  mockFetch(context); const f = fixture(context);
  const pool = createPooledAppearanceHandle(f.root, asset); context.after(() => pool.dispose());
  await pool.apply({ slots: { liquid: { color: '#be2838', roughness: .34 } } });
  const shader = compile(f.meshes.outer.material[0]);
  assertNear(shader.uniforms.basilHighSpread.value, .015 * .34 ** 1.5);
  for (const roughness of [.2, .7, .13, 0]) {
    pool.setLiveOverrides({ liquid: { color: '#8d1528', roughness }, inclusions: { roughness: .91 } });
    assertNear(shader.uniforms.basilHighSpread.value, .015 * roughness ** 1.5);
    const tint = new THREE.Color('#8d1528');
    assertNear(shader.uniforms.basilHighLiquidColor.value.r, tint.r);
  }
  pool.setLiveOverrides(); assertNear(shader.uniforms.basilHighSpread.value, .015 * .34 ** 1.5);
});

test('pooled appearances share immutable data, preserve gold/print, keep optical uniforms local and release each GPU texture once', async context => {
  const requests = mockFetch(context), f = fixture(context);
  const pool = createPooledAppearanceHandle(f.root, asset); context.after(() => pool.dispose());
  const red = { id: 'red', slots: { liquid: { color: '#be2838' } } }, goldDefault = { id: 'yellow', slots: { liquid: { color: '#d99d2b' } } };
  const greenCap = { id: 'green', slots: { liquid: { color: '#4a913d' }, cap: { color: '#058c24' } } };
  pool.setWindow([red, greenCap, goldDefault]); await pool.apply(red);
  const redOuter = f.meshes.outer.material[0], redShader = compile(redOuter), redColor = redShader.uniforms.basilHighLiquidColor.value.clone();
  const redTextures = texturesOf(redShader), redNeckTextures = texturesOf(compile(f.meshes.neck.material));
  const disposals = new Map([...redTextures, ...redNeckTextures].map(texture => [texture, 0]));
  disposals.forEach((_count, texture) => texture.addEventListener('dispose', () => disposals.set(texture, disposals.get(texture) + 1)));
  await pool.prepare(greenCap);
  assert.equal(f.meshes.outer.material[0], redOuter, 'Neighbor preparation cannot commit or mutate the visible material');
  assertNear(redShader.uniforms.basilHighLiquidColor.value.r, redColor.r);
  await pool.apply(greenCap);
  assert.equal(f.meshes.cap.material.color.getHexString(), '058c24');
  const greenShader = compile(f.meshes.outer.material[0]);
  assert.notEqual(greenShader.uniforms.basilHighLiquidColor.value, redShader.uniforms.basilHighLiquidColor.value);
  assert.deepEqual(texturesOf(greenShader), redTextures, 'All warmed appearances share the six immutable body textures');
  await pool.apply(goldDefault);
  const expectedGold = new THREE.Color().setRGB(...basil.BASIL_HIGH_PRESET.goldColorSrgb, THREE.SRGBColorSpace);
  assert.equal(f.meshes.cap.material.color.getHexString(), expectedGold.getHexString());
  assert.equal(f.meshes.cap.material.roughness, .388); assert.equal(f.meshes.cap.material.metalness, 1);
  assert.equal(f.meshes.label.material.map, f.print); assert.equal(f.meshes.label.material.side, THREE.DoubleSide);
  assert.equal(f.meshes.label.material.roughness, .5);
  const beforeDispose = [...disposals.values()]; assert.ok(beforeDispose.every(count => count === 0));
  assert.deepEqual(requests.sort(), ['high', 'neck'], 'Pool warmup never refetches body or neck optical data');
  pool.dispose(); await settle();
  for (const [key, mesh] of Object.entries(f.meshes)) assert.equal(mesh.material, f.originals[key], `Restores ${key}`);
  assert.ok([...disposals.values()].every(count => count === 1), 'Last lease disposes all twelve GPU textures exactly once');
  f.imported.forEach(texture => assert.equal(texture.disposals, 0, 'Appearance disposal cannot dispose imported artwork or maps'));
});

test('malformed optical headers fail before allocating data textures', () => {
  const bytes = zlib.gunzipSync(compressed.high), headerLength = bytes.readUInt32LE(4);
  const original = JSON.parse(bytes.toString('utf8', 8, 8 + headerLength).trim());
  for (const mutate of [header => { header.version = 2; }, header => { header.residualNodeStride = -1; }, header => { header.buffers.residualTriangles.floatCount--; }]) {
    const header = structuredClone(original); mutate(header);
    const text = JSON.stringify(header), length = Math.ceil(Buffer.byteLength(text) / 4) * 4;
    const payload = Buffer.alloc(8 + length + bytes.length - 8 - headerLength);
    payload.write('B290', 0); payload.writeUInt32LE(length, 4); payload.write(text, 8);
    bytes.copy(payload, 8 + length, 8 + headerLength);
    assert.throws(() => data.decodeBasilHighData(payload), /Unsupported|Invalid/);
  }
});
