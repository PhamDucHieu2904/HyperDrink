/* eslint-disable @typescript-eslint/no-require-imports -- Registers the local TypeScript test loader. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspectMedia } = require('../../lib/server/media/inspect.ts');
const { checkModelLabelGeometry } = require('../../lib/server/media/model-slots.ts');
const root = path.resolve(__dirname, '../..');
const asset = JSON.parse(fs.readFileSync(path.join(root, 'public/models/bottles/assets.manifest.json'), 'utf8')).assets[0];
const bytes = fs.readFileSync(path.join(root, 'public', asset.src));

function mutate(change) {
  const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  change(gltf);
  const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = bytes.subarray(20 + jsonLength), result = Buffer.alloc(20 + padded.length + binary.length);
  bytes.subarray(0, 20).copy(result); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12);
  padded.copy(result, 20); binary.copy(result, 20 + padded.length); return result;
}

test('shipped PET keeps liquid and jelly slots, its UV contract, and compressed geometry metadata', () => {
  const result = inspectMedia(bytes, 'model').model;
  assert.deepEqual(result.materialSlots, asset.materialSlots);
  assert.equal(result.layoutProfile, 'pet-wrap-v1');
  assert.equal(result.triangleCount, asset.triangles);
  assert.deepEqual(checkModelLabelGeometry(asset, bytes), []);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.extensionsRequired.includes('KHR_draco_mesh_compression'));
  assert.ok(gltf.meshes.every(mesh => mesh.primitives.every(primitive => primitive.extensions?.KHR_draco_mesh_compression)));
});

test('Ring embeds the exact supplied Plastic PNG and preserves its transparency', async () => {
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const ring = gltf.materials.find(material => material.name === 'pet-ring');
  assert.equal(ring.extras.nataRing, true); assert.equal(ring.extras.materialSlot, 'body');
  assert.equal(ring.alphaMode, 'BLEND');
  const texture = gltf.textures[ring.pbrMetallicRoughness.baseColorTexture.index];
  const image = gltf.images[texture.source], view = gltf.bufferViews[image.bufferView];
  assert.equal(image.mimeType, 'image/png');
  const start = 28 + bytes.readUInt32LE(12) + (view.byteOffset ?? 0);
  const png = bytes.subarray(start, start + view.byteLength);
  assert.equal(createHash('sha256').update(png).digest('hex'), asset.ringBasemap.sha256);
  const sharp = require('sharp'), metadata = await sharp(png).metadata(), stats = await sharp(png).stats();
  assert.equal(metadata.hasAlpha, true);
  assert.equal(stats.channels[3].min, 0);
  assert.ok(stats.channels[3].mean < 1, 'The almost-clear alpha must not be replaced by white RGB');
  assert.ok(gltf.meshes.find(mesh => mesh.name === 'body').primitives.some(primitive => gltf.materials[primitive.material] === ring));
  assert.ok(gltf.meshes.find(mesh => mesh.name === 'cap').primitives.every(primitive => gltf.materials[primitive.material].name === 'pet-cap'));
});

test('UV profile inference requires a valid, consistent hint in the active scene', () => {
  assert.equal(inspectMedia(mutate(gltf => gltf.nodes.forEach(node => delete node.extras.layoutProfile)), 'model').model.layoutProfile, '');
  assert.equal(inspectMedia(mutate(gltf => { gltf.nodes[0].extras.layoutProfile = 'another-wrap-v1'; }), 'model').model.layoutProfile, '');
  assert.equal(inspectMedia(mutate(gltf => gltf.nodes.forEach(node => { node.extras.layoutProfile = 'invalid profile'; })), 'model').model.layoutProfile, '');
  assert.equal(inspectMedia(mutate(gltf => {
    gltf.nodes.push({ extras: { layoutProfile: 'unrelated-wrap-v1' } });
    gltf.scenes.push({ nodes: [gltf.nodes.length - 1] });
  }), 'model').model.layoutProfile, 'pet-wrap-v1');
});

test('shipped PET matches its independent source-fidelity and surface audit', () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'public/models/bottles/surface-audit.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.assetSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.sourceSha256, asset.sourceSha256);
  assert.equal(report.sourceStillUnchanged, true);
  for (const role of ['body', 'cap', 'liquid']) {
    assert.ok(report.sourceFidelity.positionChecks[role].maximumDecodedVertexErrorMeters < 0.000025, role);
    assert.ok(report.sourceFidelity.normalFidelity[role].maximumCornerAngleDegrees < 1, role);
    assert.equal(report.sourceFidelity.normalFidelity[role].overOneDegree, 0, role);
  }
  for (const role of ['body', 'cap', 'label', 'inclusions']) {
    assert.equal(asset.trianglesByRole[role], report.sourceFidelity.evaluatedSourceTriangles[role], role);
  }
  assert.equal(report.denseLiquidNesting.outsideSamples, 0);
  assert.equal(report.denseLiquidNesting.radialOutsideSamples, 0);
  assert.equal(report.denseJellyNesting.outsideSamples, 0);
  assert.equal(report.labelClearance.negativeSamples, 0);
  assert.equal(report.labelClearance.under25MicrometerSamples, 0);
  assert.ok(report.decoded.every(mesh => !mesh.degenerateTriangles && !mesh.degenerateUvTriangles));
});
