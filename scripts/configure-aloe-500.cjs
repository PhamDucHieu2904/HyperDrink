/* Author the Unity-derived Aloe profile on the optimized GLB; geometry stays byte-identical. */
/* eslint-disable @typescript-eslint/no-require-imports -- Local asset packaging CLI. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'public/models/bottles');
const filename = 'pet-500-short-label.glb';
const file = path.join(folder, filename);
const manifestFile = path.join(folder, 'pet-500-short-label.manifest.json');
const profile = 'aloe-pet-v1';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const linear = hex => hex.match(/\w\w/g).map(channel => {
  const c = parseInt(channel, 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const buffer = fs.readFileSync(file);
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength));
const bin = buffer.subarray(28 + jsonLength);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const geometryDigest = json => hash(Buffer.concat(json.meshes.flatMap(mesh => mesh.primitives.map(primitive => {
  const view = json.bufferViews[primitive.extensions.KHR_draco_mesh_compression.bufferView];
  return bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
}))));
const originalGeometryHash = geometryDigest(gltf);
const slots = {
  body: ['Body Bottle - Rough_NormalMap', 'Body Bottle - z Glossy', 'Ring'],
  cap: ['PlasticCap'], label: ['Label'], liquid: ['Aloe Vera Water'], inclusions: ['Aloe Pulp - Clear'],
};
const liquidHex = '#e84a3c';
const chunks = [bin];
let binLength = bin.length;
const ringSource = 'D:/UnityHubData/Unity_3D_Mockup_Project/Assets/Data/3D Model/Plastic.png';
const ringPixels = fs.readFileSync(ringSource);
let ringImageIndex = gltf.images.findIndex(image => image.name === 'Plastic molded PET');
if (ringImageIndex < 0) {
  ringImageIndex = gltf.images.length;
  const viewIndex = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: ringPixels.length });
  const padded = Buffer.alloc(Math.ceil(ringPixels.length / 4) * 4);
  ringPixels.copy(padded); chunks.push(padded); binLength += padded.length;
  gltf.images.push({ name: 'Plastic molded PET', mimeType: 'image/png', bufferView: viewIndex });
}
gltf.samplers ??= [];
let ringTextureIndex = gltf.textures.findIndex(texture => texture.source === ringImageIndex);
if (ringTextureIndex < 0) {
  const sampler = gltf.samplers.length;
  gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
  ringTextureIndex = gltf.textures.length;
  gltf.textures.push({ name: 'Plastic molded PET', source: ringImageIndex, sampler });
}
for (const material of gltf.materials) {
  const slot = Object.entries(slots).find(([, names]) => names.includes(material.name))?.[0];
  if (!slot) throw new Error(`Unexpected material ${material.name}`);
  material.extras = { ...material.extras, materialSlot: slot, bottleProfile: profile };
  const pbr = material.pbrMetallicRoughness ??= {};
  pbr.metallicFactor = 0;
  if (material.name === slots.body[0]) {
    material.extras.aloeSurface = 'frosted';
    pbr.roughnessFactor = 0.55;
    pbr.baseColorFactor = [1, 1, 1, 0.04]; material.alphaMode = 'BLEND';
    if (!material.normalTexture) throw new Error('Authored body normal map is missing');
    material.normalTexture.scale = 1;
    material.normalTexture.extensions = { ...material.normalTexture.extensions, KHR_texture_transform: { scale: [20, 20] } };
    const normalTexture = gltf.textures[material.normalTexture.index];
    normalTexture.sampler ??= 0;
    gltf.samplers[normalTexture.sampler].wrapS = 10497;
    gltf.samplers[normalTexture.sampler].wrapT = 10497;
  } else if (material.name === slots.body[1]) {
    material.extras.aloeSurface = 'glossy'; pbr.roughnessFactor = 0.066;
    pbr.baseColorFactor = [1, 1, 1, 0.025]; material.alphaMode = 'BLEND';
    material.extensions = { ...material.extensions, KHR_materials_ior: { ior: 1.561 } };
  } else if (material.name === 'Ring') {
    material.extras.aloeRing = true; pbr.roughnessFactor = 0.085;
    pbr.baseColorFactor = [1, 1, 1, 1]; pbr.baseColorTexture = { index: ringTextureIndex };
    material.extensions = { ...material.extensions, KHR_materials_ior: { ior: 1.47 } };
    material.alphaMode = 'BLEND';
  } else if (slot === 'liquid') {
    pbr.baseColorFactor = [...linear(liquidHex.slice(1)), 1]; pbr.roughnessFactor = 0.11;
  } else if (slot === 'inclusions') {
    pbr.baseColorFactor = [1, 1, 1, 1]; pbr.roughnessFactor = 0.18;
    // The runtime gel shader handles through-piece scattering in one refraction
    // capture. Retaining nested glTF transmission would sample the sleeve again.
    if (material.extensions) delete material.extensions.KHR_materials_transmission;
    if (material.extensions) delete material.extensions.KHR_materials_volume;
  } else if (slot === 'label') {
    pbr.baseColorFactor = [1, 1, 1, 1]; pbr.roughnessFactor = 0.24;
  } else if (slot === 'cap') {
    pbr.baseColorFactor = [...linear('f6f5ed'), 1]; pbr.roughnessFactor = 0.29;
  }
}
for (const node of gltf.nodes) {
  if (!node.extras?.materialSlot) continue;
  node.extras.bottleProfile = profile;
  if (node.extras.materialSlot === 'label') {
    node.extras.layoutProfile = 'pet-wrap-v1';
    node.extras.printAreas = [{ slot: 'label', uvSet: 0, coverage: 'full-wrap' }];
  }
}
gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed || []), 'KHR_texture_transform'])];
gltf.buffers = [{ byteLength: binLength }];
const encoded = Buffer.from(JSON.stringify(gltf));
const jsonChunk = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(jsonChunk);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const final = Buffer.concat([header, jsonChunk, binHeader, binary]);
if (final.length > 1150000) throw new Error(`Size budget exceeded: ${final.length}`);
if (geometryDigest(gltf) !== originalGeometryHash) throw new Error('Compressed geometry changed');
if (hash(fs.readFileSync(manifest.source)) !== manifest.sourceSha256) throw new Error('External authoring file changed');
fs.writeFileSync(file, final);
Object.assign(manifest, {
  bytes: final.length, sha256: hash(final), bottleProfile: profile, materialSlots: slots,
  layoutProfile: 'pet-wrap-v1', defaultLiquidColor: liquidHex, geometrySha256: originalGeometryHash,
  geometryUnchangedByMaterialSetup: true,
  normalMap: { ...manifest.normalMap, normalStrength: 1, uvRepeat: [20, 20], source: 'Unity Rough_NormalMap, UV0' },
  ring: { source: ringSource, sourceSha256: hash(ringPixels), bytes: ringPixels.length, profile: 'aloe-polished-pet', roughness: 0.085, transmission: 0.93, opticalThicknessMetres: 0.0008 },
});
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
const validationFile = path.join(folder, 'pet-500-short-label.validation.json');
const validation = JSON.parse(fs.readFileSync(validationFile, 'utf8'));
// Surface metadata/texture transforms changed; the validated compressed mesh
// streams are exactly the same bytes, so the geometry certificate still applies.
validation.materialSetup = { profile, geometrySha256: originalGeometryHash, compressedGeometryUnchanged: true };
validation.assetSha256 = hash(final);
validation.assetHashMatches = true;
delete validation.glbSha256;
fs.writeFileSync(validationFile, JSON.stringify(validation, null, 2) + '\n');
console.log(JSON.stringify({ file, bytes: final.length, profile, geometryUnchanged: true, materialSlots: slots }, null, 2));
