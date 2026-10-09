/* Run with: node --test scripts/tests/basil-neck-export.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Real Three scene/target ownership is tested with an instrumented renderer, not a GPU driver. */
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const { createBasilNeckExport } = require('../../lib/mockup/basil-neck-export.ts');

function fixture(context) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), meshes = [];
  const makeMesh = (name, material, metadata = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.name = name; mesh.userData = metadata;
    scene.add(mesh); meshes.push(mesh); return mesh;
  };
  const originalNeck = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: true });
  originalNeck.name = 'basil-high-neck'; originalNeck.userData.basilProfile = 'basil-high-v1';
  let nativeDraws = 0; originalNeck.onBeforeRender = () => { nativeDraws++; };
  const neck = makeMesh('native-neck', originalNeck, { basilHighNeck: true });
  const cap = makeMesh('cap', new THREE.MeshStandardMaterial()); cap.renderOrder = 30;
  const label = makeMesh('label', new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true })); label.renderOrder = 30;
  const outer = new THREE.MeshStandardMaterial(), inner = new THREE.MeshStandardMaterial(); inner.visible = false;
  const body = makeMesh('body', [outer, inner]);
  const hidden = makeMesh('authored-water', new THREE.MeshStandardMaterial()); hidden.visible = false;
  const hiddenParent = new THREE.Group(); hiddenParent.visible = false; scene.add(hiddenParent);
  const excluded = makeMesh('hidden-parent-seeds', new THREE.MeshStandardMaterial()); scene.remove(excluded); hiddenParent.add(excluded);
  const background = new THREE.Color('#fefefe'), override = new THREE.MeshBasicMaterial();
  scene.background = background; scene.overrideMaterial = override;
  const state = { target: new THREE.WebGLRenderTarget(8, 8), cubeFace: 3, mip: 2, color: new THREE.Color('#c12345'), alpha: .37 };
  const originalState = { ...state, color: state.color.clone(), autoClear: true }, passes = [], selections = [];
  let throwAt = -1;
  const renderer = {
    autoClear: true, capabilities: { maxSamples: 8 }, extensions: { has: () => true },
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.cubeFace, getActiveMipmapLevel: () => state.mip,
    getClearColor: target => target.copy(state.color), getClearAlpha: () => state.alpha,
    setClearColor: (color, alpha) => { state.color.set(color); state.alpha = alpha; },
    setRenderTarget: (target, cubeFace = 0, mip = 0) => { state.target = target; state.cubeFace = cubeFace; state.mip = mip; selections.push(target); },
    clear: (color, depth, stencil) => { assert.equal(color, true); assert.equal(depth, true); assert.equal(stencil, true); },
    render(current, view) {
      assert.equal(current, scene); assert.equal(view, camera);
      assert.equal(scene.background, null); assert.equal(scene.overrideMaterial, null);
      assert.equal(state.alpha, 0); assert.equal(state.color.getHexString(), '000000');
      const visible = [];
      scene.traverseVisible(mesh => {
        if (!(mesh instanceof THREE.Mesh)) return;
        const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(material => material.visible);
        visible.push({ name: mesh.name, materials });
        materials.forEach(material => material.onBeforeRender(renderer, current, view, mesh.geometry, mesh, {}));
      });
      passes.push({ target: state.target, visible });
      if (passes.length - 1 === throwAt) throw new Error('synthetic render interruption');
    },
  };
  const capture = createBasilNeckExport(renderer);
  const originals = meshes.map(mesh => ({ mesh, material: mesh.material, visible: mesh.visible }));
  context.after(() => {
    capture.dispose(); originals.forEach(({ mesh, material }) => { mesh.geometry.dispose(); (Array.isArray(material) ? material : [material]).forEach(item => item.dispose()); });
    override.dispose(); originalState.target.dispose();
  });
  const restored = () => {
    originals.forEach(({ mesh, material, visible }) => { assert.equal(mesh.material, material, mesh.name); assert.equal(mesh.visible, visible, mesh.name); });
    assert.equal(scene.background, background); assert.equal(scene.overrideMaterial, override);
    assert.equal(state.target, originalState.target); assert.equal(state.cubeFace, 3); assert.equal(state.mip, 2);
    assert.equal(state.alpha, .37); assert.equal(state.color.getHexString(), 'c12345'); assert.equal(renderer.autoClear, true);
  };
  return { scene, camera, neck, body, cap, label, hidden, excluded, renderer, capture, passes, selections, restored,
    get nativeDraws() { return nativeDraws; }, interruptAt(index) { throwAt = index; } };
}

test('ordinary scenes and hidden or unrelated necks allocate no export targets and do not render', context => {
  const f = fixture(context); f.neck.visible = false;
  assert.equal(f.capture.render(f.scene, f.camera, 100, 100), null);
  assert.equal(f.passes.length, 0); assert.equal(f.selections.length, 0);
  f.neck.visible = true; f.neck.userData = {}; f.neck.material.userData = {};
  assert.equal(f.capture.render(f.scene, f.camera, 100, 100), null);
  assert.equal(f.passes.length, 0); assert.equal(f.selections.length, 0);
});

test('native radiance uses the actual neck kernel and cap collider while visibility uses only cheap depth blockers', context => {
  const f = fixture(context), original = f.neck.material;
  const layers = f.capture.render(f.scene, f.camera, 320, 240); f.restored();
  assert.ok(layers.radiance instanceof THREE.Texture); assert.ok(layers.coverage instanceof THREE.Texture);
  assert.equal(f.passes.length, 2); assert.equal(f.nativeDraws, 1, 'The expensive native kernel runs only in the radiance pass');
  assert.deepEqual(f.passes[0].visible.map(mesh => mesh.name), ['native-neck']);
  assert.equal(f.passes[0].visible[0].materials[0], original);
  const raw = f.passes[0].target, mask = f.passes[1].target;
  assert.equal(raw.texture.type, THREE.HalfFloatType); assert.equal(mask.texture.type, THREE.UnsignedByteType);
  for (const target of [raw, mask]) { assert.equal(target.samples, 4); assert.equal(target.depthBuffer, true); assert.equal(target.width, 320); assert.equal(target.height, 240); }
  assert.equal(layers.radiance, raw.texture); assert.equal(layers.coverage, mask.texture);
  const visible = f.passes[1].visible;
  assert.deepEqual(visible.map(mesh => mesh.name), ['native-neck', 'cap', 'label', 'body']);
  const white = visible[0].materials[0];
  assert.ok(white instanceof THREE.MeshBasicMaterial); assert.equal(white.color.getHexString(), 'ffffff');
  assert.equal(white.transparent, true, 'Visibility draws after opaque depth blockers regardless of source renderOrder');
  assert.equal(white.blending, THREE.NoBlending); assert.equal(white.side, THREE.FrontSide);
  const blockers = visible.slice(1).flatMap(mesh => mesh.materials);
  assert.equal(new Set(blockers).size, 1); assert.ok(blockers[0] instanceof THREE.MeshBasicMaterial);
  assert.equal(blockers[0].colorWrite, false); assert.equal(blockers[0].depthWrite, true); assert.equal(blockers[0].transparent, false);
  assert.equal(visible.at(-1).materials.length, 1, 'Hidden inner material groups remain hidden in the depth mask');
  assert.equal(f.hidden.visible, false); assert.equal(f.excluded.parent.visible, false);
});

test('both capture phases restore scene/material/renderer state after an interrupted draw', context => {
  for (const phase of [0, 1]) {
    const f = fixture(context); f.interruptAt(phase);
    assert.throws(() => f.capture.render(f.scene, f.camera, 120, 90), /synthetic render interruption/);
    f.restored();
  }
});

test('target leases resize/reuse, release on product switch and dispose shared mask materials once', context => {
  const f = fixture(context), first = f.capture.render(f.scene, f.camera, 80, 60);
  const [raw, mask] = f.passes.map(pass => pass.target);
  const materials = [f.passes[1].visible[0].materials[0], f.passes[1].visible[1].materials[0]];
  const targetDisposals = [0, 0], materialDisposals = [0, 0];
  [raw, mask].forEach((target, i) => target.addEventListener('dispose', () => targetDisposals[i]++));
  materials.forEach((material, i) => material.addEventListener('dispose', () => materialDisposals[i]++));
  const same = f.capture.render(f.scene, f.camera, 80, 60);
  assert.equal(same.radiance, first.radiance); assert.equal(same.coverage, first.coverage);
  const resized = f.capture.render(f.scene, f.camera, 100, 75);
  assert.equal(resized.radiance, first.radiance); assert.equal(raw.width, 100); assert.equal(mask.height, 75);
  assert.deepEqual(targetDisposals, [1, 1], 'Resize retires the old GPU attachments without allocating another target wrapper');
  f.capture.release(); f.capture.release(); assert.deepEqual(targetDisposals, [2, 2]);
  assert.deepEqual(materialDisposals, [0, 0], 'Solid-background switch can reuse cheap mask materials');
  const renewed = f.capture.render(f.scene, f.camera, 80, 60);
  assert.notEqual(renewed.radiance, first.radiance); assert.notEqual(renewed.coverage, first.coverage);
  f.capture.dispose(); f.capture.dispose(); assert.deepEqual(materialDisposals, [1, 1]);
  assert.equal(f.capture.render(f.scene, f.camera, 80, 60), null); f.restored();
});

test('compatible renderers retain unsigned-byte native output and their supported MSAA count', context => {
  const f = fixture(context); f.renderer.extensions.has = () => false; f.renderer.capabilities.maxSamples = 2;
  f.capture.render(f.scene, f.camera, 64, 64); f.restored();
  f.passes.forEach(pass => { assert.equal(pass.target.texture.type, THREE.UnsignedByteType); assert.equal(pass.target.samples, 2); });
});
