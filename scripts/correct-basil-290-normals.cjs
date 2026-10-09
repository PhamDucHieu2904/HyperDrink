/* Correct the exported GPU normals from immutable evaluated source data.
 * Blender custom-normal storage can quantize normals at tiny base corners.
 * No indices, vertex positions, UVs, topology or source files are changed.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Local asset CLI. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const createDecoder = require('../public/decoders/draco/draco_decoder.js');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'public/models/bottles/glass-290-basil.glb');
const referenceFile = path.join(root, '.tmp/basil-290/normal-reference.json');
const encoderFile = require.resolve('three').replace(/build[\\/]three.cjs$/, 'examples/jsm/libs/draco/gltf/draco_encoder.js');
function createEncoder() {
  const runtime = {module: {exports: {}}, exports: {}, require, __dirname: path.dirname(encoderFile), console, process, Buffer, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(encoderFile, 'utf8'), runtime, {filename: encoderFile});
  return runtime.module.exports({});
}
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const key = (x, y, z) => `${x},${y},${z}`;
const unit = (a) => {const d = Math.hypot(...a); return a.map((v) => v / d);};
async function main() {
  const decoderModule = await createDecoder({});
  // Bundled asm.js encoder is synchronously ready and exposes a self-returning
  // legacy thenable; awaiting it would recursively assimilate itself forever.
  const encoderModule = createEncoder();
  if (!encoderModule.calledRun || !encoderModule.Encoder) throw new Error('Bundled encoder is not ready');
  const raw = fs.readFileSync(file), length = raw.readUInt32LE(12);
  const json = JSON.parse(raw.subarray(20, 20 + length)), binary = raw.subarray(28 + length);
  const references = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
  const replacement = new Map(), report = [], extraBuffers = new Map();
  const addBuffer = (data, target) => {const index = json.bufferViews.length;json.bufferViews.push({buffer:0, byteOffset:0, byteLength:data.length,target});extraBuffers.set(index,data);return index;};
  const addAccessor = (values, components, integer = false) => {
    const array = integer ? new Uint32Array(values) : new Float32Array(values), view=addBuffer(Buffer.from(array.buffer),integer?34963:34962), index=json.accessors.length;
    const accessor={bufferView:view,componentType:integer?5125:5126,count:values.length/components,type:components===1?'SCALAR':`VEC${components}`};
    if (!integer && components===3) {accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++) {const axis=i%3;accessor.min[axis]=Math.min(accessor.min[axis],array[i]);accessor.max[axis]=Math.max(accessor.max[axis],array[i]);}}
    json.accessors.push(accessor);return index;
  };
  for (const node of json.nodes) {
    if (!['Base', 'G290_ClosedGlass'].includes(node.name)) continue;
    if (node.name==='Base') {
      const rawBase=JSON.parse(fs.readFileSync(path.join(root,'.tmp/basil-290/base-raw.json'),'utf8'));
      const primitive=json.meshes[node.mesh].primitives[0];
      primitive.attributes={POSITION:addAccessor(rawBase.POSITION,3),NORMAL:addAccessor(rawBase.NORMAL,3),TEXCOORD_0:addAccessor(rawBase.TEXCOORD_0,2)};
      primitive.indices=addAccessor(rawBase.indices,1,true);delete primitive.extensions;
      report.push({name:'Base',method:'uncompressed immutable authored attributes and all original triangle indices',vertices:rawBase.POSITION.length/3,triangles:rawBase.triangles});continue;
    }
    const ref = references[node.name], grid = new Map(), cell = 1e-6;
    ref.positions.forEach((p, index) => {const k = key(...p.map((v) => Math.floor(v / cell))); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(index);});
    const row = {name: node.name, corrected: 0, vertices: 0, maximumSourceDistanceMeters: 0};
    for (const primitive of json.meshes[node.mesh].primitives) {
      const extension = primitive.extensions.KHR_draco_mesh_compression;
      const view = json.bufferViews[extension.bufferView];
      const bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const decoder = new decoderModule.Decoder(), db = new decoderModule.DecoderBuffer(), decoded = new decoderModule.Mesh();
      db.Init(bytes, bytes.length); const status = decoder.DecodeBufferToMesh(db, decoded);
      if (!status.ok()) throw new Error(status.error_msg());
      const attributes = {};
      for (const name of Object.keys(primitive.attributes)) {
        const attribute = decoder.GetAttributeByUniqueId(decoded, extension.attributes[name]);
        const values = new decoderModule.DracoFloat32Array(); decoder.GetAttributeFloatForAllPoints(decoded, attribute, values);
        attributes[name] = {size: attribute.num_components(), values: Float32Array.from({length: values.size()}, (_, i) => values.GetValue(i))}; decoderModule.destroy(values);
      }
      const faces = new Uint32Array(decoded.num_faces() * 3), tri = new decoderModule.DracoInt32Array();
      for (let i = 0; i < decoded.num_faces(); i++) {decoder.GetFaceFromMesh(decoded, i, tri); for (let j = 0; j < 3; j++) faces[i * 3 + j] = tri.GetValue(j);}
      decoderModule.destroy(tri);
      const points = attributes.POSITION.values, normals = attributes.NORMAL.values;
      for (let i = 0; i < decoded.num_points(); i++) {
        const p = [points[i * 3], -points[i * 3 + 2], points[i * 3 + 1]], n = unit([normals[i * 3], -normals[i * 3 + 2], normals[i * 3 + 1]]);
        const c = p.map((v) => Math.floor(v / cell)); let candidates = [], distance = Infinity;
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
          for (const index of grid.get(key(c[0] + x, c[1] + y, c[2] + z)) || []) {
            const d = Math.hypot(...p.map((v, axis) => v - ref.positions[index][axis]));
            if (d < distance - 2e-8) {candidates = [index]; distance = d;} else if (d <= distance + 2e-8) candidates.push(index);
          }
        }
        if (!candidates.length || distance > 2e-6) throw new Error(`No immutable source normal for ${node.name} vertex ${i}`);
        let closest = null, similarity = -Infinity;
        for (const index of candidates) for (const value of ref.normals[index]) {const s = n.reduce((sum, v, axis) => sum + v * value[axis], 0); if (s > similarity) {closest = value; similarity = s;}}
        normals.set([closest[0], closest[2], -closest[1]], i * 3);row.corrected++;row.vertices++;row.maximumSourceDistanceMeters = Math.max(row.maximumSourceDistanceMeters, distance);
      }
      const builder = new encoderModule.MeshBuilder(), encoder = new encoderModule.Encoder(), mesh = new encoderModule.Mesh();
      builder.AddFacesToMesh(mesh, faces.length / 3, faces);
      const ids = {};
      for (const [name, attribute] of Object.entries(attributes)) {
        const type = name === 'POSITION' ? encoderModule.POSITION : name === 'NORMAL' ? encoderModule.NORMAL : name.startsWith('TEXCOORD') ? encoderModule.TEX_COORD : encoderModule.GENERIC;
        ids[name] = builder.AddFloatAttributeToMesh(mesh, type, decoded.num_points(), attribute.size, attribute.values);
      }
      // Sequential encoding retains the legacy authored Base's degenerate
      // triangles. Edgebreaker would remove them during a second encoding.
      encoder.SetSpeedOptions(0, 0);encoder.SetEncodingMethod(node.name === 'Base' ? encoderModule.MESH_SEQUENTIAL_ENCODING : encoderModule.MESH_EDGEBREAKER_ENCODING);
      encoder.SetAttributeQuantization(encoderModule.POSITION, 24);encoder.SetAttributeQuantization(encoderModule.NORMAL, 16);encoder.SetAttributeQuantization(encoderModule.TEX_COORD, 14);
      const output = new encoderModule.DracoInt8Array(), size = encoder.EncodeMeshToDracoBuffer(mesh, output);
      if (size <= 0) throw new Error('Draco re-encoding failed');
      replacement.set(extension.bufferView, Buffer.from(Array.from({length: size}, (_, i) => output.GetValue(i) & 255)));extension.attributes = ids;
      encoderModule.destroy(output);encoderModule.destroy(mesh);encoderModule.destroy(encoder);encoderModule.destroy(builder);
      decoderModule.destroy(status);decoderModule.destroy(decoded);decoderModule.destroy(db);decoderModule.destroy(decoder);
    }
    report.push(row);
  }
  const chunks = [];let offset = 0;
  json.bufferViews.forEach((view, index) => {const data = extraBuffers.get(index) || replacement.get(index) || binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);view.byteOffset = offset;view.byteLength = data.length;const aligned = Buffer.alloc(Math.ceil(data.length / 4) * 4);data.copy(aligned);chunks.push(aligned);offset += aligned.length;});
  json.buffers[0].byteLength = offset;
  const text = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);text.copy(jsonChunk);
  const binChunk = Buffer.concat(chunks), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2, 4);header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);header.writeUInt32LE(jsonChunk.length, 12);header.writeUInt32LE(0x4e4f534a, 16);binHeader.writeUInt32LE(binChunk.length);binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, jsonChunk, binHeader, binChunk]);fs.writeFileSync(file, result);
  const manifestPath = path.join(root, 'public/models/bottles/glass-290-basil.manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.sha256 = manifest.outputSha256 = hash(result);manifest.bytes = manifest.outputBytes = result.length;manifest.normalCorrection = {method: 'immutable-source Float32 normals, actual Draco attribute replacement', geometryChanged: false, correctedMeshes: report};
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');console.log(JSON.stringify({bytes: result.length, sha256: manifest.sha256, report}));
}
main().catch((error) => {console.error(error);process.exitCode = 1;});
