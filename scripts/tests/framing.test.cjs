/* eslint-disable @typescript-eslint/no-require-imports -- Node-only source evaluation harness. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const projectRoot = path.resolve(__dirname, '../..');
const load = (file) => {
  const loaded = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(projectRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
};
const framing = load('lib/viewer/framing.ts');
const packageMotion = load('lib/viewer/package-motion.ts');
const config = load('lib/viewer-config.ts').DEFAULT_VIEWER_PRESENTATION;

test('radial envelopes enclose every transformed static vertex and decline animated geometry', () => {
  const product = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.145, 72), new THREE.MeshStandardMaterial());
  mesh.rotation.y = 0.071;
  product.add(mesh);
  const bounds = new THREE.Box3().setFromObject(product);
  const envelope = framing.createRadialProductEnvelope(product, bounds);
  assert.equal(envelope.length, 64);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex += 1) {
    point.fromBufferAttribute(mesh.geometry.attributes.position, vertex).applyMatrix4(mesh.matrixWorld);
    assert.ok(point.y >= bounds.min.y && point.y <= bounds.max.y);
    for (let side = 0; side < 32; side += 1) {
      const angle = (side + 0.5) * Math.PI / 16;
      const edge = envelope[side];
      const extent = (edge.x - center.x) / (size.x / 2) * Math.cos(angle)
        + (edge.z - center.z) / (size.z / 2) * Math.sin(angle);
      const projection = (point.x - center.x) / (size.x / 2) * Math.cos(angle)
        + (point.z - center.z) / (size.z / 2) * Math.sin(angle);
      assert.ok(projection <= extent + 1e-10, 'Actual vertex falls outside a circumscribed polygon face');
    }
  }
  mesh.geometry.morphAttributes.position = [mesh.geometry.attributes.position.clone()];
  assert.equal(framing.createRadialProductEnvelope(product, bounds), undefined);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('motion-fitted cameras keep actual geometry visible through entrance, rebound and rapid reselection', () => {
  let seed = 1001;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.pose, 'YXZ'));
  const cap = packageMotion.packageCapPose(config.motion.packageTilt);
  const axis = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3();
  let checked = 0;
  for (const dimensions of [[0.066, 0.091], [0.053, 0.11], [0.054, 0.133], [0.058, 0.146], [0.066, 0.168]]) {
    const product = new THREE.Group();
    const geometry = new THREE.CylinderGeometry(dimensions[0] / 2, dimensions[0] / 2, dimensions[1], 64);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); product.add(mesh);
    const bounds = new THREE.Box3().setFromObject(product);
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const points = framing.createRadialProductEnvelope(product, bounds);
    const motion = config.motion;
    const frames = framing.createProductFramingFrames(rest, {
      rocking: motion.rocking, tilt: motion.packageTilt,
      maximumScale: packageMotion.packageMaximumScale(motion.packageAnticipationScale, motion.packageBounceAmount),
      anticipationScale: motion.packageAnticipationScale, entranceSeconds: motion.packageInSeconds,
      entryScale: (time) => packageMotion.packageEntryScale(time, 0.01, motion),
    }, radius);
    for (const aspect of [0.55, 0.68, 0.95, 1.3]) {
      const distance = framing.fitProductCamera(bounds, rest, aspect, config.camera.fov, config.camera.fill,
        motion.rocking, new THREE.Vector3(), radius, motion.packageTilt, 1.2,
        { points, frames, sizeMultiplier: aspect < 1 ? 1.55 : 1, referenceMaximumScale: 1.15 });
      const camera = new THREE.PerspectiveCamera(config.camera.fov, aspect, 0.0001, 10);
      camera.position.z = distance; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      for (let sample = 0; sample < 240; sample += 1) {
        const t = random();
        let pose; let scale;
        if (sample % 3 === 0) {
          const origin = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, random() * Math.PI * 2))
            .premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((random() * 2 - 1) * motion.rocking, 0, (random() * 2 - 1) * motion.rocking)));
          pose = framing.interpolatePackageAim(origin, cap, t); scale = 1;
        } else if (sample % 3 === 1) {
          pose = cap.clone().slerp(rest, packageMotion.smoothstep(t))
            .multiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * 2 * packageMotion.packageSpinProgress(t)));
          scale = packageMotion.packageEntryScale(t * motion.packageInSeconds, 0.01, motion);
          if (sample % 2) pose = framing.interpolatePackageAim(pose, cap, random());
        } else {
          pose = framing.interpolatePackageAim(rest, cap, t); scale = 1.2;
        }
        for (let vertex = 0; vertex < geometry.attributes.position.count; vertex += 12) {
          point.fromBufferAttribute(geometry.attributes.position, vertex).multiplyScalar(scale).applyQuaternion(pose).project(camera);
          assert.ok(Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1, `Actual package vertex clips at aspect ${aspect}`);
          checked += 1;
        }
      }
    }
    geometry.dispose(); mesh.material.dispose();
  }
  assert.ok(checked > 100000);
});

test('lid aim unwinds yaw without swinging a full-size can sideways', () => {
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...config.pose, 'YXZ'));
  const cap = packageMotion.packageCapPose(config.motion.packageTilt);
  const y = new THREE.Vector3(0, 1, 0);
  const endUp = y.clone().applyQuaternion(cap);
  for (let turn = 0; turn < 64; turn += 1) {
    const origin = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(y, turn * Math.PI / 32));
    const startUp = y.clone().applyQuaternion(origin);
    const swing = new THREE.Quaternion().setFromUnitVectors(startUp, endUp);
    assert.ok(framing.interpolatePackageAim(origin, cap, 0).angleTo(origin) < 1e-7);
    assert.ok(framing.interpolatePackageAim(origin, cap, 1).angleTo(cap) < 1e-7);
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      const pose = framing.interpolatePackageAim(origin, cap, t);
      const expectedUp = startUp.clone().applyQuaternion(new THREE.Quaternion().slerp(swing, t));
      const actualUp = y.clone().applyQuaternion(pose);
      assert.ok(actualUp.distanceTo(expectedUp) < 1e-12, 'Local yaw changes must not bend the product-axis path');
      assert.ok(Math.abs(actualUp.x) < 0.2, 'Can unexpectedly lies across a portrait viewport');
    }
  }
});

test('perspective size multipliers compare real silhouettes and clamp to safe headroom', () => {
  const product = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.09, 64), new THREE.MeshStandardMaterial());
  product.add(mesh);
  const bounds = new THREE.Box3().setFromObject(product);
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const points = framing.createRadialProductEnvelope(product, bounds);
  const rest = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const footprint = (distance) => {
    const camera = new THREE.PerspectiveCamera(30, 1.3, 0.0001, 10);
    camera.position.z = distance; camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const projected = points.map((point) => point.clone().applyQuaternion(rest).project(camera));
    return Math.max(
      Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x)),
      Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y)),
    );
  };
  const base = framing.fitProductCamera(bounds, rest, 1.3, 30, 0.94, 0, target, radius, 1.3, 1.15);
  const options = { points, frames: [{ orientation: rest, scale: 1 }], referenceMaximumScale: 1.15 };
  const exact = framing.fitProductCamera(bounds, rest, 1.3, 30, 0.94, 0, target, radius, 1.3, 1.2, { ...options, sizeMultiplier: 1.05 });
  assert.ok(Math.abs(footprint(exact) / footprint(base) - 1.05) < 1e-8, 'Size request must affect projected dimensions exactly');
  const bounded = framing.fitProductCamera(bounds, rest, 1.3, 30, 0.94, 0, target, radius, 1.3, 1.2,
    { ...options, frames: [{ orientation: rest, scale: 1.2 }], sizeMultiplier: 2 });
  assert.ok(footprint(bounded) * 1.2 <= 1.88, 'Enlargement cannot consume rebound clearance');
  mesh.geometry.dispose(); mesh.material.dispose();
});
