/* Decode with the project's Draco library, including its explicit GPU normals. */
/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CommonJS asset validation CLI. */
const fs = require('node:fs');
const path = require('node:path');
const createDraco = require('../public/decoders/draco/draco_decoder.js');
const {Matrix4, Quaternion, Vector3} = require('three');
const root = path.resolve(__dirname, '..');

async function decode() {
  const decoderModule = await createDraco({});
  const file = path.join(root, 'public/models/bottles/glass-290-basil.glb');
  const buffer = fs.readFileSync(file), jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20+jsonLength)), binary = buffer.subarray(28+jsonLength);
  const parents = new Map();
  json.nodes.forEach((node, index) => (node.children || []).forEach((child) => parents.set(child, index)));
  const worlds = new Map();
  function world(index) {
    if (worlds.has(index)) return worlds.get(index);
    const node = json.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation || [0, 0, 0]),
      new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale || [1, 1, 1]));
    const result = parents.has(index) ? world(parents.get(index)).clone().multiply(local) : local;
    worlds.set(index, result);
    return result;
  }
  const meshes = [];
  for (let meshIndex = 0; meshIndex < json.meshes.length; meshIndex++) {
    const mesh = json.meshes[meshIndex];
    const nodeIndex = json.nodes.findIndex((node) => node.mesh === meshIndex);
    const node = json.nodes[nodeIndex];
    const row = {name: mesh.name, role: node.extras.materialSlot,
      blenderWorldMatrix: new Matrix4().makeRotationX(Math.PI/2).multiply(world(nodeIndex)).toArray(), primitives: []};
    for (const primitive of mesh.primitives) {
      if (!primitive.extensions?.KHR_draco_mesh_compression) {
        const attributes={};
        for (const name of ['POSITION','NORMAL']) {
          const accessor=json.accessors[primitive.attributes[name]],view=json.bufferViews[accessor.bufferView];
          const offset=(view.byteOffset||0)+(accessor.byteOffset||0);
          attributes[name]=Array.from({length:accessor.count*3},(_,i)=>binary.readFloatLE(offset+i*4));
        }
        row.primitives.push(attributes);continue;
      }
      const extension = primitive.extensions.KHR_draco_mesh_compression, view = json.bufferViews[extension.bufferView];
      const bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0)+view.byteLength);
      const decoder = new decoderModule.Decoder(), db = new decoderModule.DecoderBuffer(), dm = new decoderModule.Mesh();
      db.Init(bytes, bytes.length);
      const status = decoder.DecodeBufferToMesh(db, dm);
      if (!status.ok()) throw new Error(status.error_msg());
      const attributes = {};
      for (const name of ['POSITION', 'NORMAL']) {
        const attr = decoder.GetAttributeByUniqueId(dm, extension.attributes[name]);
        const array = new decoderModule.DracoFloat32Array();
        decoder.GetAttributeFloatForAllPoints(dm, attr, array);
        attributes[name] = Array.from({length: array.size()}, (_, i) => array.GetValue(i));
        decoderModule.destroy(array);
      }
      row.primitives.push(attributes);
      decoderModule.destroy(status); decoderModule.destroy(dm); decoderModule.destroy(db); decoderModule.destroy(decoder);
    }
    meshes.push(row);
  }
  fs.writeFileSync(path.join(root, '.tmp/basil-290/gpu-decoded.json'), JSON.stringify({meshes}));
  console.log('BASIL_290_GPU_DECODED', meshes.length);
}
decode().catch((error) => {console.error(error); process.exitCode = 1;});

