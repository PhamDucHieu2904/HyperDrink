/* eslint-disable @typescript-eslint/no-require-imports -- Runs the actual GLB through the admin importer. */
require('../register-admin-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspectMedia } = require('../../lib/server/media/inspect.ts');
const { checkModelLabelGeometry } = require('../../lib/server/media/model-slots.ts');
const createDraco = require('../../public/decoders/draco/draco_decoder.js');
const folder = path.resolve(__dirname, '../../public/models/bottles');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'pet-500-short-label.manifest.json')));
const validation = JSON.parse(fs.readFileSync(path.join(folder, 'pet-500-short-label.validation.json')));
const bytes = fs.readFileSync(path.join(folder, manifest.file));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const binary = bytes.subarray(28 + bytes.readUInt32LE(12));
const hash = data => createHash('sha256').update(data).digest('hex');

test('Aloe 500 imports all checked print/material roles within the optimized size budget', () => {
  const model = inspectMedia(bytes, 'model').model;
  assert.deepEqual(model.materialSlots, manifest.materialSlots);
  assert.equal(model.layoutProfile, 'pet-wrap-v1');
  assert.equal(model.triangleCount, 246768 + 192);
  assert.equal(manifest.waterTopRepair.addedTriangles, 192);
  assert.equal(manifest.waterTopRepair.addedVertices, 1);
  assert.equal(manifest.waterTopRepair.originalPositionsUnchanged, true);
  assert.deepEqual(checkModelLabelGeometry(manifest, bytes), []);
  assert.ok(bytes.length < 1150000);
  assert.equal(hash(bytes), manifest.sha256);
  assert.equal(validation.assetSha256, manifest.sha256);
  assert.equal(validation.passed, true);
  assert.equal(validation.sourceUnchanged, true);
  const streams = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => {
    const view = gltf.bufferViews[primitive.extensions.KHR_draco_mesh_compression.bufferView];
    return binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  }));
  assert.equal(hash(Buffer.concat(streams)), manifest.geometrySha256,
    'Shader setup must retain the independently validated compressed geometry');
  assert.ok(validation.meshes.every(mesh => mesh.decodedDegenerateTriangles === 0 && mesh.maximumGpuNormalAngleDegrees < 1));
});

test('decoded Aloe water is a sealed, consistently wound volume including its top', async () => {
  const draco = await createDraco({});
  const node = gltf.nodes.find(item => item.extras?.materialSlot === 'liquid');
  const primitive = gltf.meshes[node.mesh].primitives[0];
  const extension = primitive.extensions.KHR_draco_mesh_compression;
  const view = gltf.bufferViews[extension.bufferView];
  const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), mesh = new draco.Mesh();
  const positions = new draco.DracoFloat32Array(), face = new draco.DracoInt32Array();
  let status;
  try {
    const data = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    buffer.Init(data, data.length); status = decoder.DecodeBufferToMesh(buffer, mesh);
    assert.equal(status.ok(), true);
    decoder.GetAttributeFloatForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, extension.attributes.POSITION), positions);
    // glTF splits vertices at the flat cap normal. Weld exact decoded positions
    // before testing geometric closure; this also detects Draco-created cracks.
    const welded = new Map(), ids = [], edges = new Map();
    for (let index = 0; index < mesh.num_points(); index++) {
      const key = [0, 1, 2].map(axis => positions.GetValue(index * 3 + axis)).join(',');
      if (!welded.has(key)) welded.set(key, welded.size);
      ids.push(welded.get(key));
    }
    for (let index = 0; index < mesh.num_faces(); index++) {
      decoder.GetFaceFromMesh(mesh, index, face);
      const triangle = [0, 1, 2].map(corner => ids[face.GetValue(corner)]);
      assert.equal(new Set(triangle).size, 3, 'No cap or existing triangle may collapse');
      for (let corner = 0; corner < 3; corner++) {
        const a = triangle[corner], b = triangle[(corner + 1) % 3];
        const key = `${Math.min(a, b)},${Math.max(a, b)}`;
        const edge = edges.get(key) || { count: 0, winding: 0 };
        edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
      }
    }
    assert.equal(mesh.num_faces(), 94664 + 192);
    assert.equal(welded.size, 47429 + 1);
    assert.equal([...edges.values()].filter(edge => edge.count !== 2).length, 0, 'Water must have no boundary or non-manifold edge');
    assert.equal([...edges.values()].filter(edge => edge.winding !== 0).length, 0, 'Adjacent water faces must have opposite edge winding');
    assert.equal(welded.size - edges.size + mesh.num_faces(), 2, 'Water must form one closed genus-zero volume');
  } finally {
    if (status) draco.destroy(status);
    for (const object of [face, positions, mesh, buffer, decoder]) draco.destroy(object);
  }
});

test('Aloe retains separate rough/glossy zones and actual Unity microtexture tiling', () => {
  const frosted = gltf.materials.find(material => material.extras?.aloeSurface === 'frosted');
  const glossy = gltf.materials.find(material => material.extras?.aloeSurface === 'glossy');
  assert.equal(frosted.pbrMetallicRoughness.roughnessFactor, 0.55);
  assert.equal(glossy.pbrMetallicRoughness.roughnessFactor, 0.066);
  assert.equal(glossy.normalTexture, undefined);
  assert.equal(frosted.normalTexture.scale, 1);
  assert.deepEqual(frosted.normalTexture.extensions.KHR_texture_transform.scale, [20, 20]);
  const sampler = gltf.samplers[gltf.textures[frosted.normalTexture.index].sampler];
  assert.equal(sampler.wrapS, 10497); assert.equal(sampler.wrapT, 10497);
  assert.ok(gltf.materials.every(material => material.extras.bottleProfile === 'aloe-pet-v1'));
});

test('Aloe Ring embeds the exact supplied Plastic texture and gel avoids nested refraction', () => {
  const ring = gltf.materials.find(material => material.extras?.aloeRing);
  const image = gltf.images[gltf.textures[ring.pbrMetallicRoughness.baseColorTexture.index].source];
  const view = gltf.bufferViews[image.bufferView];
  assert.equal(hash(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)), manifest.ring.sourceSha256);
  const pulp = gltf.materials.find(material => material.extras.materialSlot === 'inclusions');
  assert.equal(pulp.extensions?.KHR_materials_transmission, undefined);
  assert.equal(pulp.extensions?.KHR_materials_volume, undefined);
});
