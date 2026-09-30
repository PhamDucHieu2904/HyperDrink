#!/usr/bin/env node

/**
 * Convert the supplied Blender OBJ export to a self-contained GLB without
 * requiring Blender or a native converter. This intentionally handles the
 * subset used by the Vinut demo asset (objects, material groups, positions,
 * UVs, normals and polygon faces) and keeps the converter dependency-free so
 * it can run in CI and on a clean workstation.
 *
 * The source OBJ remains the canonical editable asset. The generated GLB is
 * the web runtime asset and is baked to metres, centered at the geometric
 * origin, and split into semantic Cap/Can/Label primitives.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const sourcePath = process.env.CAN_OBJ
  ? path.resolve(process.env.CAN_OBJ)
  : path.resolve(projectRoot, 'source-assets/legacy-can/can.obj');
const outputPath = process.env.CAN_GLB
  ? path.resolve(process.env.CAN_GLB)
  : path.resolve(projectRoot, 'source-assets/legacy-can/can.glb');
const manifestPath = process.env.CAN_MANIFEST
  ? path.resolve(process.env.CAN_MANIFEST)
  : path.resolve(projectRoot, 'source-assets/legacy-can/can.manifest.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const lines = source.split(/\r?\n/);

const positions = [];
const texcoords = [];
const normals = [];
const objects = [];
let currentObject = null;
let currentMaterial = 'Metal';

function beginObject(name) {
  currentObject = { name: name || `Object_${objects.length + 1}`, groups: [] };
  objects.push(currentObject);
  currentMaterial = 'Metal';
}

function ensureObject() {
  if (!currentObject) beginObject('Can');
}

function beginGroup(material) {
  ensureObject();
  currentMaterial = material || 'Metal';
  const previous = currentObject.groups.at(-1);
  if (previous && previous.material === currentMaterial) return previous;
  const group = {
    material: currentMaterial,
    // Each primitive deduplicates the OBJ's (position, uv, normal) tuples.
    vertices: [],
    indices: [],
    indexByTuple: new Map(),
  };
  currentObject.groups.push(group);
  return group;
}

function parseIndex(value, length) {
  if (!value) return null;
  const integer = Number.parseInt(value, 10);
  if (!Number.isInteger(integer) || integer === 0) return null;
  return integer > 0 ? integer - 1 : length + integer;
}

function parseFaceVertex(token) {
  const [position, uv, normal] = token.split('/');
  return {
    position: parseIndex(position, positions.length),
    uv: parseIndex(uv, texcoords.length),
    normal: parseIndex(normal, normals.length),
  };
}

for (const rawLine of lines) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const [directive, ...rest] = line.split(/\s+/);
  if (directive === 'o' || directive === 'g') {
    beginObject(rest.join(' ') || `Object_${objects.length + 1}`);
    continue;
  }
  if (directive === 'usemtl') {
    beginGroup(rest.join(' '));
    continue;
  }
  if (directive === 'v') {
    positions.push([Number(rest[0]), Number(rest[1]), Number(rest[2])]);
    continue;
  }
  if (directive === 'vt') {
    texcoords.push([Number(rest[0]), Number(rest[1])]);
    continue;
  }
  if (directive === 'vn') {
    normals.push([Number(rest[0]), Number(rest[1]), Number(rest[2])]);
    continue;
  }
  if (directive !== 'f' || rest.length < 3) continue;

  const group = beginGroup(currentMaterial);
  const face = rest.map(parseFaceVertex);
  // OBJ supports polygons; triangulate with a fan. The provided asset is all
  // quads, but this also keeps future source revisions safe.
  for (let i = 1; i < face.length - 1; i += 1) {
    for (const vertex of [face[0], face[i], face[i + 1]]) {
      const tuple = `${vertex.position ?? ''}/${vertex.uv ?? ''}/${vertex.normal ?? ''}`;
      let index = group.indexByTuple.get(tuple);
      if (index === undefined) {
        index = group.vertices.length;
        group.indexByTuple.set(tuple, index);
        group.vertices.push(vertex);
      }
      group.indices.push(index);
    }
  }
}

if (positions.length === 0 || objects.length === 0) {
  throw new Error(`No geometry found in ${sourcePath}`);
}

// The source uses Blender units with the can standing on Y=0. Centering the
// aggregate keeps orbit behavior stable. Scale 0.1 maps the ~1.15-unit can to
// ~115 mm in metres, matching the supplied 330 ml can proportions.
const bounds = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
};
for (const [x, y, z] of positions) {
  bounds.min[0] = Math.min(bounds.min[0], x);
  bounds.min[1] = Math.min(bounds.min[1], y);
  bounds.min[2] = Math.min(bounds.min[2], z);
  bounds.max[0] = Math.max(bounds.max[0], x);
  bounds.max[1] = Math.max(bounds.max[1], y);
  bounds.max[2] = Math.max(bounds.max[2], z);
}
const center = bounds.min.map((min, axis) => (min + bounds.max[axis]) / 2);
const scale = 0.1;

function transformedPosition(index) {
  const value = positions[index];
  if (!value) return [0, 0, 0];
  return value.map((component, axis) => (component - center[axis]) * scale);
}

function normalAt(index) {
  const value = normals[index];
  if (!value) return [0, 1, 0];
  return value;
}

function uvAt(index) {
  const value = texcoords[index];
  if (!value) return [0, 0];
  return value;
}

const gltfMeshes = [];
const gltfNodes = [];
const allBufferParts = [];
const bufferViews = [];
const accessors = [];

function align4(value) {
  return (value + 3) & ~3;
}

function appendTypedArray(typedArray, target) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const offset = allBufferParts.reduce((sum, part) => sum + part.length, 0);
  const alignedOffset = align4(offset);
  if (alignedOffset > offset) allBufferParts.push(Buffer.alloc(alignedOffset - offset));
  const finalOffset = alignedOffset;
  allBufferParts.push(bytes);
  const byteLength = bytes.byteLength;
  const viewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: finalOffset, byteLength, target });
  return { viewIndex, finalOffset, byteLength };
}

function addAccessor(typedArray, type, componentType, count, target, min, max) {
  const { viewIndex } = appendTypedArray(typedArray, target);
  const accessor = {
    bufferView: viewIndex,
    componentType,
    count,
    type,
  };
  if (min) accessor.min = min;
  if (max) accessor.max = max;
  const index = accessors.length;
  accessors.push(accessor);
  return index;
}

const materialNames = ['Metal', 'Label'];
const materials = materialNames.map((name) => ({
  name,
  pbrMetallicRoughness: name === 'Metal'
    ? { baseColorFactor: [0.68, 0.73, 0.78, 1], metallicFactor: 0.82, roughnessFactor: 0.24 }
    : { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0.08, roughnessFactor: 0.42 },
  doubleSided: false,
}));

for (const object of objects) {
  const meshPrimitiveIndices = [];
  for (const group of object.groups) {
    if (!group.indices.length) continue;
    const flattenedPositions = [];
    const flattenedNormals = [];
    const flattenedUvs = [];
    const groupMin = [Infinity, Infinity, Infinity];
    const groupMax = [-Infinity, -Infinity, -Infinity];
    for (const vertex of group.vertices) {
      const p = transformedPosition(vertex.position);
      const n = normalAt(vertex.normal);
      const uv = uvAt(vertex.uv);
      flattenedPositions.push(...p);
      flattenedNormals.push(...n);
      flattenedUvs.push(...uv);
      for (let axis = 0; axis < 3; axis += 1) {
        groupMin[axis] = Math.min(groupMin[axis], p[axis]);
        groupMax[axis] = Math.max(groupMax[axis], p[axis]);
      }
    }
    const indexArray = group.vertices.length <= 65535
      ? Uint16Array.from(group.indices)
      : Uint32Array.from(group.indices);
    const positionAccessor = addAccessor(
      Float32Array.from(flattenedPositions), 'VEC3', 5126,
      group.vertices.length, 34962, groupMin, groupMax,
    );
    const normalAccessor = addAccessor(
      Float32Array.from(flattenedNormals), 'VEC3', 5126,
      group.vertices.length, 34962,
    );
    const uvAccessor = addAccessor(
      Float32Array.from(flattenedUvs), 'VEC2', 5126,
      group.vertices.length, 34962,
    );
    const indexAccessor = addAccessor(
      indexArray, 'SCALAR', indexArray instanceof Uint16Array ? 5123 : 5125,
      group.indices.length, 34963,
    );
    meshPrimitiveIndices.push({
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor },
      indices: indexAccessor,
      material: Math.max(0, materialNames.indexOf(group.material)),
      mode: 4,
    });
  }
  if (!meshPrimitiveIndices.length) continue;
  const meshIndex = gltfMeshes.length;
  gltfMeshes.push({ name: object.name, primitives: meshPrimitiveIndices });
  gltfNodes.push({ name: object.name, mesh: meshIndex });
}

const binary = Buffer.concat(allBufferParts);
const json = {
  asset: { version: '2.0', generator: 'vinut-can-obj-to-glb' },
  scene: 0,
  scenes: [{ nodes: gltfNodes.map((_, index) => index) }],
  nodes: gltfNodes,
  meshes: gltfMeshes,
  materials,
  buffers: [{ byteLength: binary.byteLength }],
  bufferViews,
  accessors,
};

function jsonChunk(value) {
  const data = Buffer.from(JSON.stringify(value));
  const paddedLength = align4(data.length);
  return Buffer.concat([data, Buffer.alloc(paddedLength - data.length, 0x20)]);
}

function chunk(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(payload.length, 0);
  header.writeUInt32LE(type, 4);
  return Buffer.concat([header, payload]);
}

const jsonPayload = jsonChunk(json);
const binPayload = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
const totalLength = 12 + 8 + jsonPayload.length + 8 + binPayload.length;
const glbHeader = Buffer.alloc(12);
glbHeader.writeUInt32LE(0x46546c67, 0); // glTF
glbHeader.writeUInt32LE(2, 4);
glbHeader.writeUInt32LE(totalLength, 8);
const glb = Buffer.concat([
  glbHeader,
  chunk(0x4e4f534a, jsonPayload), // JSON
  chunk(0x004e4942, binPayload), // BIN\0
]);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, glb);

const triangleCount = objects.reduce(
  (sum, object) => sum + object.groups.reduce((groupSum, group) => groupSum + group.indices.length / 3, 0),
  0,
);
const manifest = {
  id: 'vinut-can-330ml',
  source: 'can.obj',
  runtime: 'can.glb',
  license: 'TBD — confirm production usage rights before publishing',
  axis: 'Y-up',
  unitScale: scale,
  pivot: 'geometric-center',
  sourceBounds: { min: bounds.min, max: bounds.max, center },
  runtimeBoundsMeters: {
    min: bounds.min.map((value, axis) => (value - center[axis]) * scale),
    max: bounds.max.map((value, axis) => (value - center[axis]) * scale),
  },
  sourceStats: {
    positions: positions.length,
    texcoords: texcoords.length,
    normals: normals.length,
    triangles: triangleCount,
  },
  runtimeStats: {
    meshes: gltfMeshes.length,
    primitives: gltfMeshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    triangles: triangleCount,
    bytes: glb.byteLength,
  },
  materials: materialNames,
  textureMaps: [],
  defaultPose: { rotationEulerRadians: [0.02, 0.18, -0.4] },
  // Use a reproducible timestamp by default. CI can provide
  // SOURCE_DATE_EPOCH when the source file's filesystem mtime is not stable.
  generatedAt: new Date(
    process.env.SOURCE_DATE_EPOCH
      ? Number(process.env.SOURCE_DATE_EPOCH) * 1000
      : fs.statSync(sourcePath).mtimeMs,
  ).toISOString(),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${path.relative(projectRoot, outputPath)} (${glb.byteLength} bytes)`);
console.log(`Wrote ${path.relative(projectRoot, manifestPath)}`);
console.log(`Meshes: ${gltfMeshes.length}; triangles: ${triangleCount}`);
