/* Run with: node scripts/tests/product-hit-region.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated shipped TypeScript test harness. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
const loaded = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../../lib/viewer/product-hit-region.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText)(require, loaded, loaded.exports);
const { ProductGestureProxy, visibleProductGestureMeshes, createProductHitRegion } = loaded.exports;

function insidePath(cssPath, x, y) {
  let winding = 0;
  for (const section of cssPath.match(/M[^Z]+Z/g) ?? []) {
    const points = [...section.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
  }
  return winding !== 0;
}
function camera() {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.z = 6; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return camera;
}
function bottle() {
  const root = new THREE.Group();
  const profile = [[0, -1.4], [0.95, -1.4], [1, -1.3], [1, 0.3], [0.4, 0.95], [0.4, 1.2], [0, 1.2]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 64), new THREE.MeshBasicMaterial());
  body.userData.materialSlot = 'body';
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 64), new THREE.MeshBasicMaterial());
  cap.position.y = 1.55; cap.userData.materialSlot = 'cap';
  root.add(body, cap); root.updateMatrixWorld(true);
  return { root, body, cap };
}

test('outer proxy follows bottle shoulder and cap while blank corners and the cap gap remain scrollable', () => {
  const { root } = bottle(), proxy = new ProductGestureProxy();
  const result = proxy.project(visibleProductGestureMeshes(root), camera(), 400, 400);
  assert.ok(insidePath(result, 290, 270), 'The broad body accepts a gesture');
  assert.ok(insidePath(result, 235, 45), 'The cap accepts a gesture');
  assert.ok(insidePath(result, 225, 85), 'The narrow neck accepts a gesture');
  assert.equal(insidePath(result, 290, 80), false, 'The empty shoulder corner is not a bounding-box hit');
  assert.equal(insidePath(result, 200, 70), false, 'Separate outer meshes do not fill their gap');
  assert.equal(insidePath(result, 20, 20), false);
  const denseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 64, 128), new THREE.MeshBasicMaterial());
  const denseResult = proxy.project([denseCylinder], camera(), 400, 400);
  assert.ok(insidePath(denseResult, 200, 105) && insidePath(denseResult, 200, 295), 'Straight dense walls retain both authored end bounds');
});

test('outer proxy excludes interior geometry before reading positions and honors hidden ancestors', () => {
  const { root, body, cap } = bottle();
  for (const [name, slot, flag] of [['Water', 'liquid'], ['runtime-liquid-back', 'liquid-back', 'aloeLiquidBack'], ['Aloe Pulp', 'inclusions']]) {
    const inner = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    inner.name = name; inner.userData.materialSlot = slot; if (flag) inner.userData[flag] = true;
    inner.geometry.getAttribute = () => { throw new Error('Gesture routing read interior topology'); };
    root.add(inner);
  }
  const primitive = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), liquidParent = new THREE.Group();
  primitive.geometry.getAttribute = () => { throw new Error('Primitive inherited liquid semantics'); };
  liquidParent.userData.materialSlot = 'liquid'; liquidParent.add(primitive); root.add(liquidParent);
  assert.deepEqual(visibleProductGestureMeshes(root), [body, cap]);
  assert.ok(new ProductGestureProxy().project(visibleProductGestureMeshes(root), camera(), 400, 400));
  root.visible = false;
  assert.deepEqual(visibleProductGestureMeshes(body), []);
  root.visible = true; body.material.visible = false; cap.material.opacity = 0;
  assert.deepEqual(visibleProductGestureMeshes(root), []);
});

test('proxy cache reuses position supports across poses without re-reading triangles, and invalidates changed geometry', () => {
  const { root, body } = bottle(), proxy = new ProductGestureProxy(), view = camera();
  const position = body.geometry.getAttribute('position'), index = body.geometry.index;
  let reads = 0;
  for (const attribute of [position, index]) {
    const original = attribute.getX;
    attribute.getX = function (id) { reads++; return original.call(this, id); };
  }
  proxy.project([body], view, 400, 400); assert.ok(reads > 0);
  reads = 0; root.rotation.set(0.2, 0.5, -0.1); root.updateMatrixWorld(true);
  proxy.project([body], view, 400, 400);
  assert.equal(reads, 0, 'A new pose only projects the bounded cached support points');
  position.needsUpdate = true;
  proxy.project([body], view, 400, 400); assert.ok(reads > 0);
  reads = 0;
  const replacement = position.clone(); body.geometry.setAttribute('position', replacement);
  proxy.project([body], view, 400, 400); assert.ok(reads > 0, 'Attribute identity invalidates even when its version starts at zero');
});

test('visible material groups, draw ranges and unreferenced outliers cannot claim unrelated screen area', () => {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
    -1.5, -0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0, -1.5, 0.5, 0,
    0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 0.5, 0, 0.5, 0.5, 0,
    500, 500, 500,
  ], 3)).setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.addGroup(0, 6, 0); geometry.addGroup(6, 6, 1);
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial({ visible: false })];
  const mesh = new THREE.Mesh(geometry, materials), proxy = new ProductGestureProxy(), view = camera();
  let result = proxy.project([mesh], view, 400, 400);
  assert.ok(insidePath(result, 100, 200)); assert.equal(insidePath(result, 300, 200), false);
  materials[0].visible = false; materials[1].visible = true;
  result = proxy.project([mesh], view, 400, 400);
  assert.equal(insidePath(result, 100, 200), false); assert.ok(insidePath(result, 300, 200));
  geometry.setDrawRange(0, 6);
  assert.equal(proxy.project([mesh], view, 400, 400), '', 'Only invisible material falls inside the draw range');
  mesh.material = new THREE.MeshBasicMaterial();
  result = proxy.project([mesh], view, 400, 400);
  assert.ok(insidePath(result, 100, 200)); assert.equal(insidePath(result, 300, 200), false, 'Scalar materials still respect drawRange');
  geometry.setDrawRange(0, 0); assert.equal(proxy.project([mesh], view, 400, 400), '');
});

test('nested and mirrored transforms produce union winding and safely clipped screen paths', () => {
  const { root, body } = bottle(), parent = new THREE.Group(), view = camera(), proxy = new ProductGestureProxy();
  parent.rotation.z = 0.35; parent.position.x = 0.3; parent.scale.set(-1, 1.15, 0.8); parent.add(root); parent.updateMatrixWorld(true);
  const middle = new THREE.Vector3(0, -0.5, 0).applyMatrix4(body.matrixWorld).project(view);
  const result = proxy.project(visibleProductGestureMeshes(root), view, 400, 400);
  assert.ok(insidePath(result, (middle.x + 1) * 200, (1 - middle.y) * 200));
  const duplicate = body.clone(); duplicate.scale.x = -1; root.add(duplicate); parent.updateMatrixWorld(true);
  assert.ok(insidePath(proxy.project([body, duplicate], view, 400, 400), (middle.x + 1) * 200, (1 - middle.y) * 200), 'Mirrored overlap cannot cancel winding');
  const perspective = new THREE.PerspectiveCamera(50, 1, 0.1, 10); perspective.updateMatrixWorld();
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); box.position.z = 2; box.updateMatrixWorld();
  assert.equal(proxy.project([box], perspective, 400, 400), '');
  box.position.z = -0.2; box.rotation.y = 0.3; box.updateMatrixWorld();
  const clipped = proxy.project([box], perspective, 400, 400);
  assert.ok(clipped && !clipped.includes('NaN') && !clipped.includes('Infinity'));
  for (const match of clipped.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
    assert.ok(Number(match[1]) >= 0 && Number(match[1]) <= 400);
    assert.ok(Number(match[2]) >= 0 && Number(match[2]) <= 400);
  }
});

test('captured drag freezes the gesture path until release and still permits clearing an unavailable product', () => {
  const previousDocument = global.document;
  try {
    const element = { style: {}, dataset: {}, setAttribute() {}, remove() {} };
    global.document = { createElement: () => element };
    const region = createProductHitRegion({ appendChild() {} }), { root, body } = bottle(), view = camera();
    region.update(root, view, 400, 400, 0, true);
    const before = element.style.clipPath;
    const original = body.geometry.getAttribute;
    body.geometry.getAttribute = () => { throw new Error('Captured drag must not inspect visual meshes'); };
    region.beginDrag(); root.position.x = 0.5; root.updateMatrixWorld(true);
    region.update(root, view, 400, 400, 16, true);
    assert.equal(element.style.clipPath, before);
    body.geometry.getAttribute = original;
    region.endDrag(); region.update(root, view, 400, 400, 17);
    assert.notEqual(element.style.clipPath, before, 'Release refreshes ownership immediately despite the normal update throttle');
    const replacement = body.geometry.getAttribute('position').clone();
    for (let index = 0; index < replacement.count; index++) replacement.setX(index, replacement.getX(index) * 0.5);
    const beforeReplacement = element.style.clipPath;
    body.geometry.setAttribute('position', replacement);
    region.update(root, view, 400, 400, 100);
    assert.notEqual(element.style.clipPath, beforeReplacement, 'A new position attribute refreshes a stationary product even with the same version');
    region.beginDrag(); region.update(null, view, 400, 400, 18);
    assert.equal(element.style.display, 'none');
    region.dispose();
  } finally { global.document = previousDocument; }
});
