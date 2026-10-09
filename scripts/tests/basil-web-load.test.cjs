'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual GLB metadata through the shared appearance and render hosts. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const web = require('../../lib/viewer/basil-web-materials.ts');
const { createAppearanceHandle } = require('../../lib/viewer/appearance.ts');
const { createPooledAppearanceHandle } = require('../../lib/viewer/pooled-appearance.ts');
const { renderBottleScene } = require('../../lib/viewer/bottle-materials.ts');
const { isBasilHighAsset } = require('../../lib/viewer/basil-presentation.ts');

const bytes = fs.readFileSync(path.resolve(__dirname, '../../public/models/bottles/glass-290-basil-web.glb'));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trimEnd());
const metadata = gltf.nodes.map(node => node.extras?.basilWebSeeds).find(Boolean);
const asset = { id: 'glass-290-basil', name: 'Basil', src: '/models/bottles/glass-290-basil-web.glb', packaging: 'glass',
  materialSlots: { body: ['basil-web-outer', 'basil-web-neck'], cap: ['basil-gold-cap'], label: ['printed-label'], liquid: ['basil-web-liquid'], inclusions: ['basil-web-seed-gel'] } };
const shader = material => {
  const result = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(result, {}); return result;
};
const seedLayers = root => { const result = []; root.traverse(node => { if (node.userData.basilWebGenerated) result.push(node); }); return result; };
function fixture(context) {
  const root = new THREE.Group(); root.userData.basilWebSeeds = structuredClone(metadata);
  const meshes = {};
  for (const [role, names] of Object.entries(asset.materialSlots)) for (const name of names) {
    if (role === 'inclusions') continue;
    const geometry = role === 'liquid' ? new THREE.CylinderGeometry(.03, .03, .15, 32, 8) : new THREE.SphereGeometry(.033, 16, 8);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .4 });
    material.name = name; material.userData.basilProfile = 'basil-web-v1';
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.userData.basilProfile = 'basil-web-v1'; root.add(mesh); meshes[name] = mesh;
  }
  context.after(() => root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  }));
  return { root, meshes };
}

test('preparing actual 330-seed metadata twice creates one instanced gel layer with positive transforms', context => {
  const { root } = fixture(context);
  web.prepareBasilWebLayers(root, asset); web.prepareBasilWebLayers(root, asset);
  const layers = seedLayers(root); assert.equal(layers.length, 1);
  const seed = layers[0]; assert.ok(seed instanceof THREE.InstancedMesh); assert.equal(seed.count, 330);
  const ratio = seed.geometry.getAttribute('basilCoreRatio');
  assert.ok(ratio instanceof THREE.InstancedBufferAttribute); assert.equal(ratio.count, 330);
  const frame = new THREE.Matrix4().set(...metadata.nativeToGlbMatrix), matrix = new THREE.Matrix4();
  for (let i = 0; i < seed.count; i++) {
    seed.getMatrixAt(i, matrix); assert.ok(matrix.determinant() > 0); assert.ok(matrix.elements.every(Number.isFinite));
    const actual = new THREE.Vector3().setFromMatrixPosition(matrix);
    const expected = new THREE.Vector3().fromArray(metadata.seeds[i].center).applyMatrix4(frame);
    assert.ok(actual.distanceTo(expected) < 1e-8, `Seed ${i} retains its source center`);
    for (let axis = 0; axis < 3; axis++) {
      const inverse = metadata.seeds[i][['inverseX', 'inverseY', 'inverseZ'][axis]];
      const radius = 1 / Math.hypot(...inverse), expectedRatio = radius / (radius + metadata.gelThicknessNative);
      assert.ok(Math.abs(ratio.array[i * 3 + axis] - expectedRatio) < 6e-8);
    }
  }
});

test('shared appearance binds polished glass and one hydrated-seed material without any High fetch', async context => {
  const originalFetch = globalThis.fetch, requests = [];
  globalThis.fetch = async url => { requests.push(String(url)); throw new Error(`Unexpected network request: ${url}`); };
  context.after(() => { globalThis.fetch = originalFetch; });
  const { root, meshes } = fixture(context);
  const handle = createAppearanceHandle(root, asset, { editable: true }); context.after(() => handle.dispose());
  await handle.apply({ slots: { liquid: { color: '#be2838' } } });
  assert.deepEqual(requests, []);
  assert.equal(isBasilHighAsset(asset), false);
  const seed = seedLayers(root)[0];
  assert.equal(web.basilWebMaterialRole(asset, seed, seed.material), 'inclusions');
  assert.ok(seed.material.customProgramCacheKey().startsWith('basil-web-'));
  for (const name of asset.materialSlots.body) {
    const material = meshes[name].material;
    assert.ok(material instanceof THREE.MeshPhysicalMaterial); assert.equal(material.transmission, 1);
    assert.equal(material.ior, 1.52); assert.equal(material.normalMap, null);
    const source = shader(material);
    assert.ok(!source.fragmentShader.includes('basilHighResidualTriangles'));
    assert.ok(!Object.values(source.uniforms).some(uniform => uniform.value instanceof THREE.DataTexture));
  }
  const waterShader = shader(meshes['basil-web-liquid'].material), seedShader = shader(seed.material);
  assert.equal(waterShader.uniforms.basilWebLiquidColor, seedShader.uniforms.basilWebLiquidColor);
  const oldProgram = seed.material.customProgramCacheKey(), version = seed.material.version;
  handle.setLiveOverrides({ liquid: { color: '#148f43' } });
  assert.equal(seedShader.uniforms.basilWebLiquidColor.value.getHexString(), '148f43');
  assert.equal(seed.material.customProgramCacheKey(), oldProgram); assert.equal(seed.material.version, version);
  assert.deepEqual(requests, []);
});

test('interior layers draw only in the native transmission capture and restore after successful or failed beauty draws', context => {
  const { root, meshes } = fixture(context);
  web.prepareBasilWebLayers(root, asset);
  const optical = web.createBasilWebBottleMaterialContext(root, asset), water = meshes['basil-web-liquid'], seed = seedLayers(root)[0];
  for (const [mesh, role] of [[water, 'liquid'], [seed, 'inclusions']]) optical.configure(mesh.material, mesh, role, '#be2838');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(root);
  for (const beautyTarget of [null, { name: 'offscreen-native-png' }]) for (const throwFromDraw of [false, true]) {
    let target = beautyTarget;
    const renderer = {
      getRenderTarget: () => target,
      render() {
        for (const mesh of [water, seed]) {
          const original = { ...mesh.geometry.drawRange };
          target = { name: 'transmission' };
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.deepEqual(mesh.geometry.drawRange, original, 'Capture keeps its complete interior geometry');
          mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          target = beautyTarget;
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.equal(mesh.geometry.drawRange.count, 0, 'Beauty skips the already captured interior');
          if (!throwFromDraw) mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
        }
        if (throwFromDraw) throw new Error('Simulated GPU draw failure');
      },
    };
    const before = [water, seed].map(mesh => ({ ...mesh.geometry.drawRange }));
    if (throwFromDraw) assert.throws(() => renderBottleScene(renderer, scene, camera), /Simulated GPU draw failure/);
    else renderBottleScene(renderer, scene, camera);
    [water, seed].forEach((mesh, index) => assert.deepEqual(mesh.geometry.drawRange, before[index]));
  }
});

test('actual pooled target meshes retain capture hooks across material swaps and restore after a failed frame', async context => {
  const { root, meshes } = fixture(context), warmRoots = [];
  const pool = createPooledAppearanceHandle(root, asset, { capacity: 2, warmup: async prepared => { warmRoots.push(prepared); } });
  context.after(() => pool.dispose());
  const first = { slots: { liquid: { color: '#be2838' } } }, second = { slots: { liquid: { color: '#148f43' } } };
  pool.setWindow([first, second]);
  await pool.apply(first); await pool.prepare(second);
  assert.equal(warmRoots.length, 2); assert.ok(warmRoots.every(prepared => prepared !== root));
  const water = meshes['basil-web-liquid'], seed = seedLayers(root)[0];
  assert.equal(seedLayers(root).length, 1); assert.equal(seed.count, 330);
  const originalMaterials = [water.material, seed.material];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(root);
  for (const appearance of [second, first]) {
    await pool.apply(appearance);
    const live = shader(seed.material);
    assert.equal(live.uniforms.basilWebLiquidColor.value.getHexString(), appearance.slots.liquid.color.slice(1));
    for (const beautyTarget of [null, { name: 'native-png' }]) for (const throwAfterHooks of [false, true]) {
      const ranges = [water, seed].map(mesh => ({ ...mesh.geometry.drawRange }));
      let target = beautyTarget;
      const renderer = { getRenderTarget: () => target, render() {
        // These are the visible original meshes whose materials were replaced,
        // rather than the pool's never-displayed preparation clones.
        for (const [index, mesh] of [water, seed].entries()) {
          target = { name: 'native-transmission-capture' };
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.deepEqual(mesh.geometry.drawRange, ranges[index]);
          mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          target = beautyTarget;
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.equal(mesh.geometry.drawRange.count, 0, 'Pooled visible interiors must not be drawn twice');
          if (!throwAfterHooks) mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
        }
        if (throwAfterHooks) throw new Error('Pooled beauty draw failed');
      } };
      if (throwAfterHooks) assert.throws(() => renderBottleScene(renderer, scene, camera), /Pooled beauty draw failed/);
      else renderBottleScene(renderer, scene, camera);
      [water, seed].forEach((mesh, index) => assert.deepEqual(mesh.geometry.drawRange, ranges[index]));
    }
  }
  assert.equal(water.material, originalMaterials[0], 'Returning to the prepared first flavor reuses its water material');
  assert.equal(seed.material, originalMaterials[1], 'Returning to the prepared first flavor reuses its hydrated-seed material');
});

test('solid two-sided cap and sleeve occlude glass in beauty, stay excluded from refraction and survive pooled swaps', async context => {
  const { root, meshes } = fixture(context);
  const pool = createPooledAppearanceHandle(root, asset, { capacity: 2 });
  context.after(() => pool.dispose());
  const first = { slots: { liquid: { color: '#be2838' } } }, second = { slots: { liquid: { color: '#148f43' } } };
  pool.setWindow([first, second]);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(root);
  for (const appearance of [first, second, first]) {
    await pool.apply(appearance);
    const solid = [meshes['basil-gold-cap'], meshes['printed-label']];
    solid.forEach(mesh => {
      assert.equal(mesh.material.side, THREE.DoubleSide, 'Interior faces must remain visible from below');
      assert.equal(mesh.material.transparent, false, 'Solid faces must write depth before the transmitting glass queue');
      assert.equal(mesh.material.opacity, 1); assert.equal(mesh.material.depthWrite, true); assert.equal(mesh.material.depthTest, true);
      assert.equal(mesh.material.forceSinglePass, true, 'Two-sided faces need no duplicate transparent draw');
    });
    for (const beautyTarget of [null, { name: 'png' }]) for (const failInCapture of [false, true]) {
      let target = beautyTarget;
      const ranges = solid.map(mesh => ({ ...mesh.geometry.drawRange }));
      const renderer = { getRenderTarget: () => target, render() {
        for (const [i, mesh] of solid.entries()) {
          target = { name: 'transmission' };
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.equal(mesh.geometry.drawRange.count, 0, 'Cap/label color must never enter the water capture');
          if (failInCapture) throw new Error('Solid capture failed');
          mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          target = beautyTarget;
          mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
          assert.deepEqual(mesh.geometry.drawRange, ranges[i], 'Beauty must draw complete solid inside/outside faces');
          mesh.onAfterRender(renderer, scene, camera, mesh.geometry, mesh.material, null);
        }
      } };
      if (failInCapture) assert.throws(() => renderBottleScene(renderer, scene, camera), /Solid capture failed/);
      else renderBottleScene(renderer, scene, camera);
      solid.forEach((mesh, i) => assert.deepEqual(mesh.geometry.drawRange, ranges[i]));
    }
  }
});
