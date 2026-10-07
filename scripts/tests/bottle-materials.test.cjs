/* Run with: node scripts/tests/bottle-materials.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Runs the shipped materials, appearance ownership and pool with real Three.js. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
function load(file, importer = require) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', js)(importer, loaded, loaded.exports); return loaded.exports;
}
const config = load('lib/viewer-config.ts'), urls = load('lib/public-url.ts');
const bottles = load('lib/viewer/bottle-materials.ts');
const appearances = load('lib/viewer/appearance.ts', name => ({ three: THREE, '../viewer-config': config, '../public-url': urls, './bottle-materials': bottles })[name]);
const pooling = load('lib/viewer/pooled-appearance.ts', name => name === 'three' ? THREE : name === './bottle-materials' ? bottles : appearances);
const asset = { id: 'pet', name: 'PET', src: '/pet.glb', packaging: 'pet', materialSlots: {
  body: ['pet-shell'], liquid: ['nata-liquid'], inclusions: ['nata-jelly'], cap: ['pet-cap'], label: ['printed-label'],
} };
function fixture(context) {
  const root = new THREE.Group(), meshes = {}, originals = {};
  for (const [role, names] of Object.entries(asset.materialSlots)) {
    const material = new THREE.MeshPhysicalMaterial({ color: role === 'liquid' ? '#ffc440' : '#ffffff', transmission: 0.7 });
    material.name = names[0]; material.userData = { bottleProfile: 'nata-pet-v1', materialSlot: role };
    const geometry = role === 'liquid' ? new THREE.CylinderGeometry(1, 1, 4, 16) : new THREE.BoxGeometry();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = role;
    meshes[role] = mesh; originals[role] = material; root.add(mesh);
  }
  context.after(() => Object.values(meshes).forEach(mesh => { mesh.geometry.dispose(); originals[mesh.name].dispose(); }));
  return { root, meshes, originals };
}

test('Ring keeps its embedded alpha basemap and frosted bulk independently of the opaque cap', async context => {
  const f = fixture(context), map = new THREE.Texture();
  const original = new THREE.MeshStandardMaterial({ map, transparent: true, opacity: 1 });
  original.name = 'pet-ring'; original.userData = { bottleProfile: 'nata-pet-v1', nataRing: true };
  const ring = new THREE.Mesh(new THREE.BoxGeometry(), original); ring.name = 'body_1'; f.root.add(ring);
  context.after(() => { ring.geometry.dispose(); original.dispose(); map.dispose(); });
  const ringAsset = { ...asset, materialSlots: { ...asset.materialSlots, body: ['pet-shell', 'pet-ring'] } };
  const handle = appearances.createAppearanceHandle(f.root, ringAsset);
  context.after(() => handle.dispose());
  assert.equal(bottles.bottleMaterialRole(ringAsset, ring, original), 'ring');
  await handle.apply({ slots: { liquid: { color: '#ff4430' } } });
  assert.equal(ring.material.map, map, 'The GLB RGBA map must survive appearance preparation');
  assert.equal(ring.material.transparent, true); assert.equal(ring.material.depthWrite, false);
  assert.equal(ring.material.color.getHexString(), 'fff9ed');
  assert.equal(f.meshes.cap.material.transparent, false); assert.equal(f.meshes.cap.material.opacity, 1);
  assert.match(compile(ring.material).fragmentShader, /1.0 - diffuseColor.a/);
  assert.match(compile(ring.material).fragmentShader, /exp\(-nataRingOpticalDepth \/ ringCosine\)/);
  assert.match(compile(ring.material).fragmentShader, /totalSpecular/);
  await handle.apply({ slots: { liquid: { color: '#ffc440' } } });
  assert.equal(ring.material.map, map, 'A flavor swap must preserve Ring alpha');
  assert.equal(ring.material.color.getHexString(), 'fff9ed', 'Ring haze must not be dyed by the drink color');
  handle.dispose(); assert.equal(ring.material, original);
});

test('molded Ring stays partly translucent face-on, gains haze at the rim and preserves opaque basemap marks', () => {
  const front = bottles.nataRingHaze(1), edge = bottles.nataRingHaze(0);
  assert.ok(front > 0.15 && front < 0.3, 'The front must show bulk plastic without becoming an opaque white cap');
  assert.ok(edge > 0.6 && edge < 0.8, 'The rim crosses more frosted plastic');
  assert.ok(bottles.nataRingHaze(0.5) > front);
  assert.equal(bottles.nataRingHaze(-1), front);
  assert.equal(bottles.nataRingHaze(1, 1), 1);
});

test('printed sleeve stays solid and ordered after PET while being excluded from the opaque refraction capture', async context => {
  const f = fixture(context), map = new THREE.Texture(); f.originals.label.map = map;
  context.after(() => map.dispose());
  const handle = pooling.createPooledAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  for (const color of ['#ff4430', '#ffc440']) {
    await handle.apply({ id: color, slots: { liquid: { color } } });
    const label = f.meshes.label.material;
    assert.equal(label.map, map, 'Existing printed artwork must be retained');
    assert.equal(label.transparent, true, 'Three excludes this final queue from its opaque transmission capture');
    assert.equal(label.opacity, 1); assert.equal(label.transmission, 0);
    assert.equal(label.depthWrite, true); assert.equal(label.depthTest, true);
    assert.ok(f.meshes.label.renderOrder > f.meshes.body.renderOrder);
    assert.ok(f.meshes.label.renderOrder > f.meshes.liquid.renderOrder);
    assertScatteringBaseline(f, color);
  }
  handle.dispose(); assert.equal(f.meshes.label.material, f.originals.label);
});
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {}); return shader;
}
function assertScatteringBaseline(f, color) {
  const expected = bottles.nataScatteringColor(new THREE.Color(color)), front = f.meshes.liquid.material.color;
  const back = f.meshes.liquid.children[0].material.color;
  assert.equal(front.getHexString(), 'ffffff', 'A neutral front preserves ivory jelly instead of dyeing it with the flavor');
  assert.ok(back.distanceTo ? back.distanceTo(expected) < 1e-10 : Math.abs(back.r - expected.r) + Math.abs(back.g - expected.g) + Math.abs(back.b - expected.b) < 1e-10);
  const jellyScattering = compile(f.meshes.inclusions.material).uniforms.nataScatteringColor.value;
  const capturedReservoir = compile(f.meshes.liquid.children[0].material).uniforms.nataScatteringColor.value;
  for (const channel of ['r', 'g', 'b']) {
    assert.ok(Math.abs(jellyScattering[channel] - capturedReservoir[channel]) < 1e-10,
      'Deep jelly shares the exact captured reservoir radiance, independent of geometry normals');
    assert.ok(Math.abs(jellyScattering[channel] - expected[channel]) < 1e-10);
  }
}

test('only explicitly profiled PET material slots use the bottle rendering', context => {
  const f = fixture(context), material = f.originals.body;
  assert.equal(bottles.bottleMaterialRole(asset, f.meshes.body, material), 'body');
  assert.equal(bottles.bottleMaterialRole({ ...asset, packaging: 'can' }, f.meshes.body, material), undefined);
  assert.equal(bottles.bottleMaterialRole({ ...asset, materialSlots: { body: ['unrelated'] } }, f.meshes.body, material), undefined);
  material.userData = {};
  assert.equal(bottles.bottleMaterialRole(asset, f.meshes.body, material), undefined);
  f.meshes.body.userData.bottleProfile = 'nata-pet-v1';
  assert.equal(bottles.bottleMaterialRole(asset, f.meshes.body, material), 'body');
});

test('profile defaults block the rear scene, refract real opaque jelly and retain PBR tone/color output', async context => {
  const f = fixture(context), handle = appearances.createAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  await handle.apply();
  assert.equal(f.meshes.liquid.renderOrder, 10); assert.equal(f.meshes.body.renderOrder, 20);
  for (const role of ['body', 'liquid', 'inclusions', 'cap']) {
    assert.notEqual(f.meshes[role].material, f.originals[role]);
    if (role !== 'liquid') assert.equal(f.meshes[role].material.transmission, 0, 'Only the liquid uses the transmission pyramid');
  }
  assert.equal(f.meshes.body.material.transparent, true); assert.equal(f.meshes.body.material.depthWrite, false);
  assert.equal(f.meshes.liquid.material.transparent, false); assert.equal(f.meshes.liquid.material.depthWrite, true);
  assert.equal(f.meshes.liquid.material.transmission, 1); assert.equal(f.meshes.liquid.material.ior, 1.335);
  assert.equal(f.meshes.inclusions.material.transparent, false); assert.equal(f.meshes.inclusions.material.depthWrite, true);
  const back = f.meshes.liquid.children.find(mesh => mesh.userData.nataLiquidBack);
  assert.ok(back); assert.equal(back.geometry, f.meshes.liquid.geometry, 'The scattering layer shares source geometry');
  assert.equal(back.material.side, THREE.BackSide); assert.equal(back.material.transparent, false); assert.equal(back.material.depthWrite, true);
  assertScatteringBaseline(f, '#ffc440');
  for (const role of ['body', 'liquid', 'inclusions']) {
    const shader = compile(f.meshes[role].material);
    assert.ok(shader.fragmentShader.includes('#include <tonemapping_fragment>'));
    assert.ok(shader.fragmentShader.includes('#include <colorspace_fragment>'));
    assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'), 'All optical surfaces retain actual HDRI/PBR lighting');
    if (role === 'liquid') {
      assert.ok(shader.fragmentShader.includes('#include <transmission_fragment>'), 'Three applies real refraction, rough pyramid blur and spectral Beer absorption');
      assert.ok(shader.fragmentShader.includes('gl_FragColor = vec4(totalDiffuse + totalSpecular * 0.25, 1.0);'), 'Opaque coverage prevents background leakage at rough-refraction mip edges');
    }
    else assert.ok(!shader.fragmentShader.includes('#include <opaque_fragment>'));
  }
  const liquid = compile(f.meshes.liquid.material);
  assert.deepEqual(liquid.uniforms.nataBounds.value.toArray(), [1, -2, 2]);
  assert.equal(liquid.uniforms.nataJuiceColor.value.getHexString(), 'ffc440');
  assert.equal(f.originals.liquid.transmission, 0.7, 'Imported source materials stay reversible');
  handle.dispose(); Object.entries(f.meshes).forEach(([role, mesh]) => assert.equal(mesh.material, f.originals[role]));
});

test('independent liquid colors tint both scattering reservoir and submerged jelly and restore on reset', async context => {
  const f = fixture(context), handle = appearances.createAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  await handle.apply({ slots: { liquid: { color: '#baef92' } } });
  assertScatteringBaseline(f, '#baef92');
  assert.equal(compile(f.meshes.inclusions.material).uniforms.nataJuiceColor.value.getHexString(), 'baef92');
  await handle.apply();
  assertScatteringBaseline(f, '#ffc440');
  assert.equal(compile(f.meshes.inclusions.material).uniforms.nataJuiceColor.value.getHexString(), 'ffc440');
});

test('pooled materials update depth using the drawn mesh and camera, including rotations, scale and orthographic capture', async context => {
  const f = fixture(context), handle = pooling.createPooledAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  await handle.apply({ id: 'mango', slots: { liquid: { color: '#ffce49' } } });
  assert.equal(f.meshes.liquid.renderOrder, 10); assert.equal(f.meshes.body.renderOrder, 20, 'Visible mesh order is set, not merely the prepared clone');
  const material = f.meshes.inclusions.material, shader = compile(material);
  f.root.position.set(4, 2, -1); f.root.rotation.set(0.1, 0.7, 0); f.root.scale.setScalar(2); f.root.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(8, 3, 9); camera.lookAt(4, 2, -1); camera.updateMatrixWorld(true);
  material.onBeforeRender({}, {}, camera, f.meshes.inclusions.geometry, f.meshes.inclusions, {});
  const expected = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(f.meshes.inclusions.matrixWorld.clone().invert());
  assert.ok(shader.uniforms.nataCamera.value.distanceTo(expected) < 1e-10, 'Depth follows actual scene placement after clone material commit');
  assert.equal(shader.uniforms.nataOrthographic.value, 0);
  const uniformVector = shader.uniforms.nataCamera.value;
  const ortho = new THREE.OrthographicCamera(); ortho.position.copy(camera.position); ortho.quaternion.copy(camera.quaternion); ortho.updateMatrixWorld(true);
  material.onBeforeRender({}, {}, ortho, f.meshes.inclusions.geometry, f.meshes.inclusions, {});
  assert.equal(shader.uniforms.nataOrthographic.value, 1); assert.equal(shader.uniforms.nataCamera.value, uniformVector, 'Frame callbacks reuse uniforms');
  assert.ok(Math.abs(shader.uniforms.nataViewDirection.value.length() - 1) < 1e-10);
});

test('pooled flavor switches keep optical materials independent and dispose all owned material sets exactly once', async context => {
  const f = fixture(context), handle = pooling.createPooledAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  let disposals = 0;
  const a = { id: 'mango', slots: { liquid: { color: '#ffc440' } } }, b = { id: 'lychee', slots: { liquid: { color: '#f1e3bb' } } };
  handle.setWindow([a, b]); await handle.apply(a);
  const first = f.meshes.liquid.material; first.addEventListener('dispose', () => disposals++);
  await handle.prepare(b); assert.equal(f.meshes.liquid.material, first, 'Neighbor preparation does not change the visible liquid');
  await handle.apply(b); const second = f.meshes.liquid.material; second.addEventListener('dispose', () => disposals++);
  assert.notEqual(second, first); assertScatteringBaseline(f, '#f1e3bb');
  handle.dispose(); handle.dispose(); assert.equal(disposals, 2);
  assert.equal(f.meshes.liquid.material, f.originals.liquid);
});

test('repeated pool creation and clone preparation retain exactly one back layer and upgrade standard liquid PBR', async context => {
  const f = fixture(context);
  f.meshes.liquid.material = new THREE.MeshStandardMaterial({ color: '#ffc440' });
  f.meshes.liquid.material.name = 'nata-liquid'; f.meshes.liquid.material.userData.bottleProfile = 'nata-pet-v1';
  const original = f.meshes.liquid.material; context.after(() => original.dispose());
  bottles.prepareBottleLayers(f.root, asset); bottles.prepareBottleLayers(f.root, asset);
  assert.equal(f.meshes.liquid.children.length, 1);
  const back = f.meshes.liquid.children[0], importedBack = back.material;
  let backDisposals = 0; importedBack.addEventListener('dispose', () => backDisposals++);
  context.after(() => importedBack.dispose());
  const handle = pooling.createPooledAppearanceHandle(f.root, asset);
  await handle.apply({ slots: { liquid: { color: '#ef4444' } } });
  assert.ok(f.meshes.liquid.material instanceof THREE.MeshPhysicalMaterial);
  assert.equal(f.meshes.liquid.children.length, 1);
  assertScatteringBaseline(f, '#ef4444');
  handle.dispose(); assert.equal(back.material, importedBack); assert.equal(backDisposals, 0, 'Pool never disposes the model-owned reservoir material');
});

test('jelly visibility depends on centimetres of liquid, fades continuously and removes far silhouettes', context => {
  const depths = [0, 0.005, 0.01, 0.015, 0.02, 0.024, 0.04];
  const reveal = depths.map(bottles.nataJellyReveal);
  assert.equal(reveal[0], bottles.NATA_PET_OPTICS.jellyVisibility);
  for (let i = 1; i < reveal.length; i++) assert.ok(reveal[i] <= reveal[i - 1]);
  assert.ok(reveal[1] > 0.1 && reveal[1] < 0.3, 'Near-wall pieces produce a soft ivory lift, not opaque white blocks');
  assert.ok(reveal[4] < 0.02, 'Two centimetres of colored liquid hides almost all cube contrast');
  assert.equal(reveal[5], 0); assert.equal(reveal[6], 0); assert.equal(bottles.nataJellyReveal(Infinity), 0);
  const f = fixture(context), profile = bottles.createBottleMaterialContext(f.root, asset);
  const material = f.originals.inclusions.clone(); context.after(() => material.dispose());
  profile.configure(material, f.meshes.inclusions, 'inclusions', '#ff4430');
  const shader = compile(material);
  assert.equal(shader.uniforms.nataJellyFadeRange.value.y, 0.024);
  assert.ok(shader.fragmentShader.includes('if (nataDepth >= nataJellyFadeRange.y) discard;'), 'Far geometry leaves both capture color and depth to the real liquid reservoir');
});

test('vivid scattering preserves hue, stays neutral for clear/ivory flavors and reacts to independent water color', async context => {
  const f = fixture(context), handle = appearances.createAppearanceHandle(f.root, asset);
  context.after(() => handle.dispose());
  for (const color of ['#ff4430', '#ffc440', '#efefef']) {
    await handle.apply({ slots: { liquid: { color } } });
    assertScatteringBaseline(f, color);
    const original = new THREE.Color(color), vivid = bottles.nataScatteringColor(original);
    assert.ok(Math.max(vivid.r, vivid.g, vivid.b) >= Math.max(original.r, original.g, original.b));
    if (color === '#efefef') assert.ok(Math.abs(vivid.r - vivid.g) + Math.abs(vivid.g - vivid.b) < 1e-10, 'White coconut juice cannot acquire an invented hue');
  }
});
