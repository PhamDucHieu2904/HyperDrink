/* Pack the derived GLB with a full-resolution WebP normal map; no mesh edits. */
/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CommonJS asset packaging CLI. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '.tmp/bottle-500');
const out = path.join(root, 'public/models/bottles');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid GLB');
  const length = buffer.readUInt32LE(12);
  return {buffer, json: JSON.parse(buffer.subarray(20, 20+length)), binary: buffer.subarray(28+length)};
}
function meshStats(json) {
  return json.meshes.reduce((stats, mesh) => {
    for (const primitive of mesh.primitives) {
      stats.triangles += json.accessors[primitive.indices].count/3;
      stats.vertices += json.accessors[primitive.attributes.POSITION].count;
      stats.dracoBytes += json.bufferViews[primitive.extensions.KHR_draco_mesh_compression.bufferView].byteLength;
    }
    return stats;
  }, {triangles: 0, vertices: 0, dracoBytes: 0});
}

async function pack() {
  const report = JSON.parse(fs.readFileSync(path.join(temp, 'export-report.json'), 'utf8'));
  if (report.state !== 'complete' || !report.sourceUnchanged) throw new Error('Blender export did not complete');
  const {json, binary} = readGlb(path.join(temp, 'pet-500-pruned-png.glb'));
  const precise = readGlb(path.join(temp, 'pet-500-water-precise.glb'));
  const waterNode = json.nodes.find((node) => node.extras?.materialSlot === 'liquid');
  const preciseNode = precise.json.nodes.find((node) => node.extras?.materialSlot === 'liquid');
  const waterPrimitive = json.meshes[waterNode.mesh].primitives[0];
  const precisePrimitive = precise.json.meshes[preciseNode.mesh].primitives[0];
  if (json.accessors[waterPrimitive.indices].count !== precise.json.accessors[precisePrimitive.indices].count) throw new Error('Water topology changed');
  const waterViewIndex = waterPrimitive.extensions.KHR_draco_mesh_compression.bufferView;
  const preciseExtension = precisePrimitive.extensions.KHR_draco_mesh_compression;
  const preciseView = precise.json.bufferViews[preciseExtension.bufferView];
  const preciseWater = precise.binary.subarray(preciseView.byteOffset || 0, (preciseView.byteOffset || 0)+preciseView.byteLength);
  waterPrimitive.extensions.KHR_draco_mesh_compression.attributes = preciseExtension.attributes;
  if (json.images.length !== 1) throw new Error('Expected only the authored normal map');
  const image = json.images[0], imageView = image.bufferView;
  const originalView = json.bufferViews[imageView];
  const original = binary.subarray(originalView.byteOffset || 0, (originalView.byteOffset || 0)+originalView.byteLength);
  if (hash(original) !== report.normalMapSourceSha256) throw new Error('Exporter changed the normal-map pixels; inspect before packing');
  // No resizing, color grading or gamma conversion. Non-color RGB stays at 668².
  // Smart chroma subsampling reduces directional error versus Blender's encoder.
  const webp = await sharp(original).removeAlpha().webp({quality: 95, effort: 6, smartSubsample: true}).toBuffer();
  const metadata = await sharp(webp).metadata();
  image.mimeType = 'image/webp';
  for (const texture of json.textures) {
    if (texture.source !== 0) throw new Error('Unexpected texture source');
    texture.extensions = {...texture.extensions, EXT_texture_webp: {source: 0}};
    delete texture.source;
  }
  for (const property of ['extensionsUsed', 'extensionsRequired']) {
    json[property] = [...new Set([...(json[property] || []), 'EXT_texture_webp'])];
  }
  const chunks = [];
  let offset = 0;
  for (let index = 0; index < json.bufferViews.length; index++) {
    const view = json.bufferViews[index];
    const data = index === imageView ? webp : index === waterViewIndex ? preciseWater : binary.subarray(view.byteOffset || 0, (view.byteOffset || 0)+view.byteLength);
    view.byteOffset = offset;
    view.byteLength = data.length;
    view.buffer = 0;
    const padded = Buffer.alloc(Math.ceil(data.length/4)*4);
    data.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  }
  json.buffers = [{byteLength: offset}];
  const center = report.sourceBounds.center;
  const scale = report.exportScale;
  // glTF is Y-up; Blender source coordinates are Z-up. Normalize uniformly,
  // preserving all authored object transforms, proportions and explicit normals.
  const parentIndex = json.nodes.length;
  json.nodes.push({name: 'PET 500 ml short label', children: [...json.scenes[json.scene || 0].nodes],
    scale: [scale, scale, scale], translation: [-center[0]*scale, -center[2]*scale, center[1]*scale]});
  json.scenes[json.scene || 0].nodes = [parentIndex];
  const jsonData = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(Math.ceil(jsonData.length/4)*4, 0x20);
  jsonData.copy(jsonChunk);
  const binChunk = Buffer.concat(chunks);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28+jsonChunk.length+binChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const final = Buffer.concat([header, jsonChunk, binHeader, binChunk]);
  if (final.length > 1150000) throw new Error(`Target exceeded: ${final.length} bytes; inspect source changes`);
  if (hash(fs.readFileSync(report.source)) !== report.sourceSha256) throw new Error('Source changed since export');
  fs.mkdirSync(out, {recursive: true});
  const filename = 'pet-500-short-label.glb';
  fs.writeFileSync(path.join(out, filename), final);
  const baselinePath = path.join(temp, 'original-draco.glb');
  const baseline = fs.existsSync(baselinePath) ? readGlb(baselinePath) : null;
  const stats = meshStats(json);
  const manifest = {...report, id: 'pet-500-short-label', file: filename, bytes: final.length, sha256: hash(final),
    compression: ['KHR_draco_mesh_compression', 'EXT_texture_webp'],
    triangleCountUnchanged: stats.triangles === report.triangleCount, gltf: stats,
    normalMap: {width: metadata.width, height: metadata.height, originalBytes: original.length,
      encodedBytes: webp.length, encoding: 'WebP quality 95, smartSubsample, full resolution', normalStrength: 0.35,
      lossy: true, colorGrading: false, resized: false},
    baseline: baseline ? {bytes: baseline.buffer.length, ...meshStats(baseline.json)} : null,
    registeredInCatalog: false};
  if (!manifest.triangleCountUnchanged) throw new Error('Triangle count changed');
  fs.writeFileSync(path.join(out, 'pet-500-short-label.manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
  console.log(JSON.stringify({file: path.join(out, filename), bytes: final.length, triangles: stats.triangles, vertices: stats.vertices}));
}
pack().catch((error) => {console.error(error); process.exitCode = 1;});
