/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the real Three.js material/texture ownership. */
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const { createAppearanceHandle } = require('../../lib/viewer/appearance.ts');
const { createPooledAppearanceHandle } = require('../../lib/viewer/pooled-appearance.ts');
const { validateRecord } = require('../../lib/catalog/validation.ts');
const { resolveDisplay3D } = require('../../lib/catalog/resolve.ts');
const { resolveMockupProduct, resolveMockupSelection } = require('../../lib/catalog/mockup.ts');

function fixture(t, packaging = 'pet') {
  const root = new THREE.Group(), meshes = {}, imported = {};
  const slots = { body: ['shell'], cap: ['cap'], liquid: ['water'], inclusions: ['jelly'], label: ['print'] };
  const asset = { id: 'test', name: 'Test', src: '/model.glb', packaging, materialSlots: slots, textureSamplers: { label: { wrapS: 'repeat', wrapT: 'clamp' } } };
  for (const [slot, names] of Object.entries(slots)) {
    const material = new THREE.MeshPhysicalMaterial({ color: slot === 'liquid' ? '#ffc440' : '#ffffff', roughness: 0.4, metalness: 0.1 });
    material.name = names[0];
    if (packaging === 'pet') material.userData.bottleProfile = 'nata-pet-v1';
    const geometry = slot === 'liquid' ? new THREE.CylinderGeometry(1, 1, 4, 16) : new THREE.BoxGeometry();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = slot; root.add(mesh); meshes[slot] = mesh; imported[slot] = material;
  }
  let loads = 0;
  const originalLoad = THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = async () => { loads++; return new THREE.Texture({ width: 32, height: 16 }); };
  t.after(() => { THREE.TextureLoader.prototype.loadAsync = originalLoad; root.traverse(node => { if (node.isMesh) node.geometry.dispose(); }); Object.values(imported).forEach(m => m.dispose()); });
  return { root, meshes, imported, asset, loads: () => loads };
}
const base = { id: 'base', requiredSlots: ['label'], slots: { label: { baseColorMap: '/print.webp', textureOffsetX: .125, metalness: 0, roughness: .15 }, cap: { color: '#008b28' }, liquid: { color: '#ffc440' } } };

test('continuous edits retain material/texture identities, optical shader colors and original UV height; reset restores the profile', async t => {
  const f = fixture(t), handle = createAppearanceHandle(f.root, f.asset, { editable: true }); t.after(() => handle.dispose());
  await handle.apply(base);
  const material = f.meshes.label.material, texture = material.map, version = material.version;
  const water = f.meshes.liquid.material, back = f.meshes.liquid.children[0].material, shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  water.onBeforeCompile(shader);
  const defaultTransmission = water.transmission;
  for (let i = 0; i < 100; i++) handle.setLiveOverrides({ label: { textureOffsetX: -.25, metalness: .65, roughness: .08 }, cap: { color: '#ff2244', metalness: .4, roughness: .2 }, liquid: { color: '#148f43' }, body: { metalness: .2, roughness: .11 } });
  assert.equal(f.loads(), 1, 'Dragging must not load labels again');
  assert.equal(f.meshes.label.material, material); assert.equal(material.map, texture); assert.equal(material.version, version, 'Finish changes need no shader rebuild');
  assert.equal(texture.offset.x, -.25); assert.equal(texture.offset.y, 0); assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(texture.flipY, false); assert.equal(material.metalness, .65); assert.equal(material.roughness, .08);
  assert.equal(f.meshes.cap.material.color.getHexString(), 'ff2244'); assert.equal(f.meshes.body.material.roughness, .11);
  assert.equal(shader.uniforms.nataJuiceColor.value.getHexString(), '148f43'); assert.notEqual(back.color.getHexString(), 'ffc440');
  assert.equal(water.transmission, defaultTransmission); assert.equal(water.color.getHexString(), 'ffffff');
  handle.setLiveOverrides({});
  assert.equal(texture.offset.x, .125); assert.equal(material.metalness, 0); assert.equal(material.roughness, .15);
  assert.equal(f.meshes.cap.material.color.getHexString(), '008b28'); assert.equal(shader.uniforms.nataJuiceColor.value.getHexString(), 'ffc440');
  assert.equal(f.imported.cap.color.getHexString(), 'ffffff');
});

test('pooled label switches keep each base finish and UV alignment; edits do not allocate another cache entry', async t => {
  const f = fixture(t, 'can'), pool = createPooledAppearanceHandle(f.root, f.asset, { editable: true }); t.after(() => pool.dispose());
  const next = { ...base, id: 'next', slots: { label: { baseColorMap: '/next.webp', textureOffsetX: -.1, roughness: .3 } } };
  pool.setWindow([base, next]); await pool.apply(base);
  const first = f.meshes.label.material;
  pool.setLiveOverrides({ label: { textureOffsetX: .4, roughness: .02 } });
  await pool.prepare(next); assert.equal(f.meshes.label.material, first);
  await pool.apply(next); pool.setLiveOverrides({});
  assert.equal(f.meshes.label.material.map.offset.x, -.1); assert.equal(f.meshes.label.material.roughness, .3);
  await pool.apply(base); pool.setLiveOverrides({}); assert.equal(f.meshes.label.material, first); assert.equal(first.map.offset.x, .125);
  assert.equal(f.loads(), 2); assert.equal(pool.materialValues().label.textureOffsetX, .125);
});

test('saved horizontal percent resolves identically in storefront and Studio; non-finite/out-of-range values are rejected', () => {
  const catalog = structuredClone(require('../../public/catalog/current.json').data.catalog);
  const display = catalog.displays3d.find(d => d.id === 'aloe-pet500-original-3d'); display.labelOffset = -12.5;
  const sales = resolveDisplay3D(catalog, display);
  const studio = resolveMockupProduct(catalog, resolveMockupSelection(catalog, { display: display.id }));
  assert.equal(sales.appearance.slots.label.textureOffsetX, -.125); assert.equal(studio.appearance.slots.label.textureOffsetX, -.125);
  assert.equal(validateRecord('displays3d', display).filter(i => i.field === 'labelOffset').length, 0);
  for (const labelOffset of [NaN, Infinity, -51, 51, '12', null]) assert.ok(validateRecord('displays3d', { ...display, labelOffset }).some(i => i.field === 'labelOffset'));
  assert.equal(validateRecord('displays3d', { ...display, labelOffset: undefined }).filter(i => i.field === 'labelOffset').length, 0);
});
