/* Run with: node --test scripts/tests/basil-web-optics.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Exercise source optics with the actual Three.js types. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const web = require('../../lib/viewer/basil-web-optics.ts');
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
function cylinder(context, radius = .03, height = .18) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 64, 8);
  context.after(() => geometry.dispose());
  return web.fitBasilWebProfile(geometry, new THREE.Matrix4());
}
function shader(material) {
  const source = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(source, {}); return source;
}

test('authored liquid profile retains metres, center, source shape and cached immutable fit', context => {
  const geometry = new THREE.CylinderGeometry(.3, .3, 1.8, 64, 8); context.after(() => geometry.dispose());
  const transform = new THREE.Matrix4().makeScale(.1, .1, .1).setPosition(.02, .07, -.04);
  const profile = web.fitBasilWebProfile(geometry, transform);
  near(profile.minimumY, -.02); near(profile.maximumY, .16);
  near(profile.center.x, .02); near(profile.center.y, -.04);
  assert.equal(profile.sections.length, 8);
  for (const section of profile.sections) { near(section.z, .03); near(section.w, 0); }
  assert.equal(web.fitBasilWebProfile(geometry, transform.clone()), profile);
  const other = web.fitBasilWebProfile(geometry, new THREE.Matrix4().makeScale(.2, .2, .2));
  assert.notEqual(other, profile); near(other.maximumY, .18); near(other.sections[3].z, .06);
  assert.equal(web.fitBasilWebProfile(new THREE.BufferGeometry(), transform), undefined);
});

test('analytic cone exits cover body chord, top/bottom, off-axis rays and radius transitions', context => {
  const profile = cylinder(context), origin = new THREE.Vector3();
  near(web.basilWebExitDistance(profile, origin, new THREE.Vector3(1, 0, 0)), .03);
  near(web.basilWebExitDistance(profile, origin, new THREE.Vector3(0, -1, 0)), .09);
  near(web.basilWebExitDistance(profile, origin, new THREE.Vector3(0, 1, 0)), .09);
  near(web.basilWebExitDistance(profile, new THREE.Vector3(.01, 0, 0), new THREE.Vector3(1, 0, 0)), .02);
  near(web.basilWebExitDistance(profile, new THREE.Vector3(.01, 0, 0), new THREE.Vector3(-1, 0, 0)), .04);
  near(web.basilWebExitDistance(profile, origin, new THREE.Vector3(1, 1, 0)), .03 * Math.SQRT2);
  assert.equal(web.basilWebExitDistance(profile, origin, new THREE.Vector3()), 0);
  const cone = { ...profile, minimumY: 0, maximumY: .08,
    sections: Array.from({ length: 8 }, (_, i) => new THREE.Vector4(i * .01, (i + 1) * .01, .03 - i * .0025, -.25)) };
  near(web.basilWebExitDistance(cone, new THREE.Vector3(0, .04, 0), new THREE.Vector3(1, 0, 0)), .02);
  near(web.basilWebExitDistance(cone, new THREE.Vector3(0, .04, 0), new THREE.Vector3(0, 1, 0)), .04);
  near(web.basilWebExitDistance(cone, new THREE.Vector3(0, .04, 0), new THREE.Vector3(1, 1, 0)), .016 * Math.SQRT2);
});

test('source sRGB extinction is converted once to metres and retains a shorter pale neck path', () => {
  const srgb = new THREE.Color().setRGB(.8, .2, .3), absorption = web.basilWebAbsorption(srgb);
  near(absorption.x, 15); near(absorption.y, 60); near(absorption.z, 52.5);
  const body = web.basilWebBulkColor(srgb, .06), neck = web.basilWebBulkColor(srgb, .02);
  near(body.r, Math.exp(-.9)); near(body.g, Math.exp(-3.6)); near(body.b, Math.exp(-3.15));
  for (const channel of ['r', 'g', 'b']) assert.ok(neck[channel] > body[channel]);
  assert.ok(body.r > body.b && body.b > body.g, 'Red grape water stays warm, including its gel');
  const clear = web.basilWebBulkColor(new THREE.Color(1, 1, 1), .3);
  assert.deepEqual(clear.toArray(), [1, 1, 1]);
  assert.deepEqual(web.basilWebAbsorption(srgb, 0).toArray(), [0, 0, 0]);
  near(web.basilWebAbsorption(srgb, 999).x, 45);
});

test('a fixed source gel offset creates anisotropic ratio rather than guessed uniform enlargement', () => {
  const radii = new THREE.Vector3(.0015, .0006, .001);
  const ratio = radii.clone().divide(radii.clone().addScalar(web.BASIL_WEB_OPTICS.gelThicknessMetres));
  near(web.BASIL_WEB_OPTICS.gelThicknessMetres, .000832);
  assert.ok(ratio.x > ratio.z && ratio.z > ratio.y);
  const origin = new THREE.Vector3(0, 0, 1), direction = new THREE.Vector3(0, 0, -1);
  near(web.basilWebCoreIntersection(origin, direction, ratio), 1 - ratio.z);
  assert.equal(web.basilWebCoreIntersection(new THREE.Vector3(.8, 0, 1), direction, ratio), undefined);
  assert.equal(web.basilWebCoreIntersection(origin, direction, new THREE.Vector3(0, .5, .5)), undefined);
});

test('black source core receives water-distance veiling and clear tinted gel continues the reservoir', () => {
  const liquid = new THREE.Color('#be2838'), srgb = liquid.clone().convertLinearToSRGB();
  const absorption = web.basilWebAbsorption(srgb), background = web.basilWebBulkColor(srgb, .06);
  const base = { background, liquidColor: liquid, absorption, frontDepthMetres: .01, lighting: new THREE.Color(1, 1, 1) };
  const core = web.basilWebSeedColor({ ...base, coreHit: true });
  const gel = web.basilWebSeedColor({ ...base, coreHit: false });
  assert.ok(core.r < background.r && core.g < background.g && core.b < background.b);
  assert.ok(gel.r > gel.g && gel.r > gel.b, 'Gel haze carries the warm water hue instead of ivory');
  assert.ok(gel.r > core.r && gel.g > core.g && gel.b > core.b);
  const farCore = web.basilWebSeedColor({ ...base, frontDepthMetres: .08, coreHit: true });
  assert.ok(farCore.r > core.r, 'Water veil softens distant cores');
  const clearGel = web.basilWebSeedColor({ background: new THREE.Color(1, 1, 1), liquidColor: new THREE.Color(1, 1, 1),
    absorption: new THREE.Vector3(), frontDepthMetres: .01, coreHit: false, hazeLighting: new THREE.Color(.25, .25, .25) });
  near(clearGel.r, clearGel.g); near(clearGel.g, clearGel.b);
  assert.ok(clearGel.r > .9 && clearGel.r < 1, 'Clear gel remains a weak transparent envelope');
});

test('single instanced seed draw uses bounded core intersection and no fragment BVH or refraction texture', context => {
  const profile = cylinder(context), geometry = new THREE.SphereGeometry(1, 10, 6);
  geometry.setAttribute('basilCoreRatio', new THREE.InstancedBufferAttribute(new Float32Array([.5, .4, .6]), 3));
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.InstancedMesh(geometry, material, 1);
  context.after(() => { geometry.dispose(); material.dispose(); });
  const absorption = { value: new THREE.Vector3(15, 60, 52.5) }, liquid = { value: new THREE.Color('#be2838') };
  const uniforms = web.configureBasilWebInclusions(material, mesh, profile, new THREE.Matrix4(), {
    basilWebAbsorption: absorption, basilWebLiquidColor: liquid });
  const source = shader(material);
  assert.equal(source.uniforms.basilWebAbsorption, absorption); assert.equal(source.uniforms.basilWebLiquidColor, liquid);
  assert.equal(uniforms.basilWebSections.value.length, 8);
  assert.equal(material.transparent, false); assert.equal(material.depthWrite, true);
  assert.match(source.vertexShader, /basilWebExit\(basilPoint,basilRay\)/);
  assert.match(source.fragmentShader, /basilWebCoreHit\(/);
  assert.doesNotMatch(web.BASIL_WEB_SEED_GLSL, /for\s*\(|while\s*\(|sampler|texture|BVH/);
  assert.doesNotMatch(source.fragmentShader, /basilHighTrace|basilHighResidual|basilHighSeeds/);
  assert.equal(material.customProgramCacheKey(), 'basil-web-source-core-gel-v2');
  absorption.value.set(1, 2, 3); assert.deepEqual(source.uniforms.basilWebAbsorption.value.toArray(), [1, 2, 3]);
});

test('draw callback maps the actual pooled mesh and camera to fixed metric coordinates without framing drift', context => {
  const profile = cylinder(context), geometry = new THREE.SphereGeometry(1, 10, 6);
  geometry.setAttribute('basilCoreRatio', new THREE.InstancedBufferAttribute(new Float32Array([.5, .4, .6]), 3));
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.InstancedMesh(geometry, material, 1);
  let calls = 0; material.onBeforeRender = () => calls++;
  context.after(() => { geometry.dispose(); material.dispose(); });
  const uniforms = web.configureBasilWebInclusions(material, mesh, profile, new THREE.Matrix4().makeScale(.1, .1, .1));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  mesh.position.set(2, 3, 4); mesh.scale.setScalar(5); scene.add(mesh);
  camera.position.set(2, 3, 14); scene.add(camera); scene.updateMatrixWorld(true);
  material.onBeforeRender({}, scene, camera, geometry, mesh, null);
  near(uniforms.basilWebCameraLocal.value.z, 2); near(uniforms.basilWebCameraMetric.value.z, .2);
  near(uniforms.basilWebViewMetric.value.z, -1); assert.equal(uniforms.basilWebOrthographic.value, 0);
  const clone = mesh.clone(); clone.scale.setScalar(10); scene.add(clone); scene.updateMatrixWorld(true);
  material.onBeforeRender({}, scene, camera, geometry, clone, null);
  near(uniforms.basilWebCameraMetric.value.z, .1);
  const orthographic = new THREE.OrthographicCamera(); scene.add(orthographic); scene.updateMatrixWorld(true);
  material.onBeforeRender({}, scene, orthographic, geometry, clone, null);
  assert.equal(uniforms.basilWebOrthographic.value, 1); assert.equal(calls, 3);
});

test('shipped authored Water profile contains all 330 exact High seed centers in the exported metric frame', async context => {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../public/models/bottles/glass-290-basil-web.glb'));
  const jsonLength = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength), node = document.nodes.find(value => value.name === 'Water');
  const primitive = document.meshes[node.mesh].primitives[0], extension = primitive.extensions.KHR_draco_mesh_compression;
  const view = document.bufferViews[extension.bufferView], packed = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  const draco = await require('../../public/decoders/draco/draco_decoder.js')({});
  const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), mesh = new draco.Mesh();
  buffer.Init(packed, packed.length);
  const status = decoder.DecodeBufferToMesh(buffer, mesh); assert.equal(status.ok(), true);
  const positions = new draco.DracoFloat32Array(), triangles = new draco.DracoInt32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, extension.attributes.POSITION), positions);
  const vertices = Float32Array.from({ length: mesh.num_points() * 3 }, (_, i) => positions.GetValue(i));
  const indices = new Uint32Array(mesh.num_faces() * 3);
  for (let i = 0; i < mesh.num_faces(); i++) { decoder.GetFaceFromMesh(mesh, i, triangles); for (let j = 0; j < 3; j++) indices[i * 3 + j] = triangles.GetValue(j); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  context.after(() => geometry.dispose());
  for (const object of [triangles, positions, status, mesh, buffer, decoder]) draco.destroy(object);
  const profile = web.fitBasilWebProfile(geometry, new THREE.Matrix4());
  const metadata = document.nodes[0].extras.basilWebSeeds;
  const nativeToMetric = new THREE.Matrix4().set(...metadata.nativeToGlbMatrix);
  assert.equal(metadata.count, 330); assert.ok(profile.maximumY - profile.minimumY > .1);
  const directions = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)];
  for (const [i, seed] of metadata.seeds.entries()) {
    const center = new THREE.Vector3().fromArray(seed.center).applyMatrix4(nativeToMetric);
    assert.ok(center.y >= profile.minimumY && center.y <= profile.maximumY, `Seed${i} lies inside the liquid's height`);
    const radial = Math.hypot(center.x - profile.center.x, center.z - profile.center.y), radius = web.basilWebRadiusAt(profile, center.y);
    assert.ok(radial <= radius + .00001, `Seed${i}: radial${radial} radius${radius} at${center.toArray()} lies inside the radial liquid profile`);
    for (const direction of directions) assert.ok(web.basilWebExitDistance(profile, center, direction) > 0, `Seed${i} has a positive optical water path`);
  }
  near(metadata.gelThicknessNative * nativeToMetric.getMaxScaleOnAxis(), .000832, 1e-10);
});
