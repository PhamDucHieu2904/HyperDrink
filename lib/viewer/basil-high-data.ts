import * as THREE from 'three';
import { publicUrl } from '../public-url';

export const BASIL_HIGH_DATA_URL = '/models/bottles/glass-290-basil-high.bin.gz';
export const BASIL_NECK_DATA_URL = '/models/bottles/glass-290-basil-neck.bin.gz';
const bufferStrides = { residualTriangles: 24, residualNodes: 12, profiles: 12, profileNodes: 12, seedEllipsoids: 16, seedNodes: 12 } as const;
export type BasilHighBufferName = keyof typeof bufferStrides;
interface BasilHighHeader {
  version: number; profile: string; residualNodeStride: number; neck?: boolean;
  bounds: { center: number[]; extent: number[] };
  buffers: Record<BasilHighBufferName, { byteOffset: number; floatCount: number; count: number }>;
}
export interface BasilHighData {
  header: BasilHighHeader;
  width: number;
  textures: Record<BasilHighBufferName, THREE.DataTexture>;
  dispose(): void;
}

/** Decode the original Float32 fields; no quantization of optical interfaces. */
export function decodeBasilHighData(bytes: Uint8Array): BasilHighData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'B290') throw new Error('Invalid Basil High data');
  const headerLength = view.getUint32(4, true), dataOffset = 8 + headerLength;
  if (headerLength % 4 || dataOffset > bytes.length) throw new Error('Invalid Basil High header');
  const header: BasilHighHeader = JSON.parse(new TextDecoder().decode(bytes.subarray(8, dataOffset)).trimEnd().replace(/\0+$/, ''));
  if (header.version !== 1 || header.profile !== 'basil-high-v1' || !Number.isInteger(header.residualNodeStride) || header.residualNodeStride < (header.neck ? 0 : 1)) throw new Error('Unsupported Basil High profile');
  const textures = {} as Record<BasilHighBufferName, THREE.DataTexture>;
  const width = 1024;
  try {
    for (const [name, stride] of Object.entries(bufferStrides) as [BasilHighBufferName, number][]) {
      const block = header.buffers[name];
      if (!block || !Number.isInteger(block.count) || block.count < 1 || block.floatCount !== block.count * stride || block.byteOffset % 4 || block.byteOffset < 0 || dataOffset + block.byteOffset + block.floatCount * 4 > bytes.length) throw new Error(`Invalid Basil buffer: ${name}`);
      const height = Math.ceil(block.floatCount / (width * 4));
      if (height > 4096) throw new Error('Basil data exceeds WebGL texture bounds');
      const data = new Float32Array(width * height * 4);
      const start = dataOffset + block.byteOffset;
      for (let i = 0; i < block.floatCount; i++) data[i] = view.getFloat32(start + i * 4, true);
      const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
      texture.name = `basil-high-${name}`; texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
      textures[name] = texture;
    }
  } catch (error) { Object.values(textures).forEach(texture => texture.dispose()); throw error; }
  return { header, width, textures, dispose: () => Object.values(textures).forEach(texture => texture.dispose()) };
}

async function loadData(url: string): Promise<BasilHighData> {
  const response = await fetch(publicUrl(url), { credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Basil High optical data unavailable');
  const compressed = new Uint8Array(await response.arrayBuffer());
  let bytes: Uint8Array;
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    // The shipped Three decoder supplies a fallback for older browsers.
    const { gunzipSync } = await import('three/examples/jsm/libs/fflate.module.js');
    bytes = gunzipSync(compressed);
  }
  return decodeBasilHighData(bytes);
}

type CacheEntry = { users: number; promise: Promise<BasilHighData> };
const cached = new Map<string, CacheEntry>();
/** All appearance clones/viewers share the same six immutable GPU data textures. */
export function acquireBasilHighData(neck = false) {
  const url = neck ? BASIL_NECK_DATA_URL : BASIL_HIGH_DATA_URL;
  let entry = cached.get(url);
  if (!entry) { entry = { users: 0, promise: loadData(url) }; cached.set(url, entry); }
  const owned = entry;
  entry.users++;
  let released = false;
  return { ready: owned.promise, release() {
    if (released) return; released = true;
    if (--owned.users !== 0) return;
    if (cached.get(url) === owned) cached.delete(url);
    void owned.promise.then(data => data.dispose(), () => {});
  } };
}
