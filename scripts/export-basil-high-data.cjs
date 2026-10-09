/* eslint-disable @typescript-eslint/no-require-imports */
/** Pack the accepted Unity High buffers without rebaking or changing a vertex. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const arrays = {
  residualTriangles: ['a', 'e1', 'e2', 'n0', 'n1', 'n2'],
  residualNodes: ['min', 'max', 'range'],
  profiles: ['shape', 'normals', 'media'],
  profileNodes: ['min', 'max', 'range'],
  seedEllipsoids: ['center', 'inverseX', 'inverseY', 'inverseZ'],
  seedNodes: ['min', 'max', 'range'],
};
function packHighAsset(source, neck = false) {
  if (!/^  formatVersion: 1$/m.test(source)) throw new Error('Unsupported High data version');
  const values = {};
  for (const [name, fields] of Object.entries(arrays)) {
    if (neck && !['residualTriangles', 'residualNodes'].includes(name)) { values[name] = new Float32Array(fields.length * 4); continue; }
    const sourceName = neck ? name === 'residualTriangles' ? 'triangles' : 'nodes' : name;
    const section = source.match(new RegExp(`^  ${sourceName}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z]|$(?![\\s\\S]))`, 'm'))?.[1];
    if (!section) throw new Error(`Missing High buffer: ${name}`);
    const fieldPattern = /^\s*(?:-\s*)?(\w+): \{x: ([^,]+), y: ([^,]+), z: ([^,]+), w: ([^}]+)\}/gm;
    const numbers = []; let fieldIndex = 0;
    for (const match of section.matchAll(fieldPattern)) {
      if (match[1] !== fields[fieldIndex++ % fields.length]) throw new Error(`Invalid ${name} field order`);
      numbers.push(...match.slice(2).map(Number));
    }
    if (!numbers.length || numbers.length % (fields.length * 4) || !numbers.every(Number.isFinite)) throw new Error(`Invalid ${name} buffer`);
    values[name] = new Float32Array(numbers);
  }
  const bounds = source.match(/^  bounds:\r?\n\s+m_Center: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)\}\r?\n\s+m_Extent: \{x: ([^,]+), y: ([^,]+), z: ([^}]+)\}/m);
  if (!bounds) throw new Error('Missing bounds');
  const header = {
    version: 1, profile: 'basil-high-v1', sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    sourceHash: source.match(/^  sourceHash: (.+)$/m)?.[1].trim(),
    residualNodeStride: neck ? 0 : Number(source.match(/^  residualNodeStride: (\d+)/m)?.[1]),
    neck,
    bounds: { center: bounds.slice(1, 4).map(Number), extent: bounds.slice(4, 7).map(Number) },
    buffers: {},
  };
  const parts = []; let byteOffset = 0;
  for (const [name, array] of Object.entries(values)) {
    header.buffers[name] = { byteOffset, floatCount: array.length, count: array.length / (arrays[name].length * 4) };
    const bytes = Buffer.from(array.buffer); parts.push(bytes); byteOffset += bytes.length;
  }
  const encoded = Buffer.from(JSON.stringify(header));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
  const prefix = Buffer.alloc(8); prefix.write('B290', 0); prefix.writeUInt32LE(padded.length, 4);
  return { header, bytes: Buffer.concat([prefix, padded, ...parts]) };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const sourcePath = process.argv[2] || 'D:/UnityHubData/Unity_3D_Mockup_Project/Assets/Resources/Glass290High/BasilVan.asset';
  for (const [input, stem, neck] of [[sourcePath, 'glass-290-basil-high', false], [path.join(path.dirname(sourcePath), 'NeckVan.asset'), 'glass-290-basil-neck', true]]) {
    const result = packHighAsset(fs.readFileSync(input, 'utf8'), neck);
    const output = path.join(root, `public/models/bottles/${stem}.bin.gz`);
    const compressed = zlib.gzipSync(result.bytes, { level: 9 });
    fs.writeFileSync(output, compressed);
    fs.writeFileSync(output.replace('.bin.gz', '.data.json'), `${JSON.stringify({ ...result.header, sourcePath: input, outputBytes: compressed.length, expandedBytes: result.bytes.length }, null, 2)}\n`);
    console.log(JSON.stringify({ output, outputBytes: compressed.length, expandedBytes: result.bytes.length, counts: Object.fromEntries(Object.entries(result.header.buffers).map(([key, value]) => [key, value.count])) }));
  }
}
module.exports = { packHighAsset };
