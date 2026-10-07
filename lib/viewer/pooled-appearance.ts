import * as THREE from 'three';
import type { ProductAppearance, ProductAsset } from '../viewer-config';
import { createAppearanceHandle, type AppearanceHandle, type AppearanceLoadOptions } from './appearance';
import { prepareBottleLayers } from './bottle-materials';

export interface AppearanceWarmupPriority {
  /** A selected appearance must not wait for its background warmup's idle gap. */
  isForeground(): boolean;
  /** Wake an in-progress background yield when this entry becomes selected. */
  onPromote(callback: () => void): () => void;
}
export interface AppearancePoolOptions extends AppearanceLoadOptions {
  capacity?: number;
  /** Decoded RGBA/mip estimate; the visible and selected labels remain pinned. */
  maxTextureBytes?: number;
  warmup?: (root: THREE.Object3D, isCurrent: () => boolean, priority: AppearanceWarmupPriority) => Promise<void>;
  onChange?: (ready: number, pending: number, textureBytes: number) => void;
}
export interface PooledAppearanceHandle extends AppearanceHandle {
  setWindow(appearances: readonly (ProductAppearance | undefined)[]): void;
  prepare(appearance?: ProductAppearance): Promise<void>;
  has(appearance?: ProductAppearance): boolean;
}
type Entry = { root: THREE.Object3D; handle: AppearanceHandle; ready: boolean; promise: Promise<void>; warming: boolean; retired: boolean; promotions: Set<() => void>; textureBytes: number };
const keyOf = (appearance?: ProductAppearance) => JSON.stringify(appearance ?? null);
const meshesOf = (root: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  root.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
  return meshes;
};
const texturesOf = (materials: readonly (THREE.Material | THREE.Material[])[]) => {
  const textures = new Set<THREE.Texture>();
  for (const material of materials.flat()) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  }
  return textures;
};
const decodedBytesOf = (root: THREE.Object3D, imported: ReadonlySet<THREE.Texture>) => {
  let bytes = 0;
  for (const texture of texturesOf(meshesOf(root).map(mesh => mesh.material))) {
    if (imported.has(texture)) continue;
    const image = texture.source.data as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number } | undefined;
    const width = image?.naturalWidth || image?.videoWidth || image?.width || 0;
    const height = image?.naturalHeight || image?.videoHeight || image?.height || 0;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) bytes += Math.ceil(width * height * 4 * (texture.generateMipmaps ? 4 / 3 : 1));
  }
  return bytes;
};

/** Five lightweight material sets share one geometry; only the committed set is visible. */
export function createPooledAppearanceHandle(root: THREE.Object3D, asset: ProductAsset, options: AppearancePoolOptions = {}): PooledAppearanceHandle {
  prepareBottleLayers(root, asset);
  const capacity = Math.max(1, Math.min(5, options.capacity ?? 5));
  const targets = meshesOf(root);
  const originals = targets.map(mesh => mesh.material);
  const importedTextures = texturesOf(originals);
  const maxTextureBytes = options.maxTextureBytes !== undefined && Number.isFinite(options.maxTextureBytes) ? Math.max(0, options.maxTextureBytes) : Infinity;
  const entries = new Map<string, Entry>();
  // Retain estimates only within the small current window, so an oversized
  // neighbor is not repeatedly decoded just to discover the same byte limit.
  const deferredBytes = new Map<string, number>();
  let requested: string[] = [];
  let activeKey: string | undefined;
  let applyingKey: string | undefined;
  let revision = 0;
  let disposed = false;
  const report = () => options.onChange?.([...entries.values()].filter(entry => entry.ready).length, [...entries.values()].filter(entry => !entry.ready).length, textureBytes());
  const restore = () => targets.forEach((mesh, index) => { mesh.material = originals[index]; });
  const evict = (key: string, entry: Entry) => {
    entries.delete(key);
    // r180 compileAsync polls each material's currentProgram. Disposing a material
    // during that poll deletes its renderer properties and can throw from a timer.
    // Retire the entry immediately, retaining ownership only until warmup settles.
    if (entry.warming) entry.retired = true;
    else entry.handle.dispose();
  };
  const textureBytes = () => [...entries.values()].reduce((total, entry) => total + entry.textureBytes, 0);
  const rememberSize = (key: string, entry: Entry) => {
    if (entry.textureBytes && requested.includes(key)) deferredBytes.set(key, entry.textureBytes);
  };
  const prune = () => {
    // Keep the visible and requested material alive until the replacement commits.
    const keep = new Set([activeKey, applyingKey].filter((key): key is string => key !== undefined));
    for (const key of requested) { if (keep.size >= capacity) break; keep.add(key); }
    for (const [key, entry] of entries) if (!keep.has(key)) evict(key, entry);
    const pinned = new Set([activeKey, applyingKey]);
    const farthestFirst = [...entries].filter(([key]) => !pinned.has(key)).sort(([a], [b]) => requested.indexOf(b) - requested.indexOf(a));
    let bytes = textureBytes();
    for (const [key, entry] of farthestFirst) {
      if (bytes <= maxTextureBytes) break;
      rememberSize(key, entry);
      evict(key, entry);
      bytes -= entry.textureBytes;
    }
    report();
    return keep;
  };
  const ensure = (appearance: ProductAppearance | undefined, required: boolean) => {
    const key = keyOf(appearance);
    const existing = entries.get(key);
    if (existing) {
      if (required) [...existing.promotions].forEach(callback => callback());
      return existing.promise;
    }
    if (disposed || (!required && !prune().has(key))) return Promise.resolve();
    const estimate = deferredBytes.get(key);
    if (!required && estimate !== undefined && textureBytes() + estimate > maxTextureBytes) return Promise.resolve();
    // clone() shares geometry/imported textures; make its materials independent of
    // the currently committed pool entry before creating the reversible handle.
    const preparedRoot = root.clone(true);
    meshesOf(preparedRoot).forEach((mesh, index) => { const material = originals[index]; mesh.material = Array.isArray(material) ? [...material] : material; });
    const handle = createAppearanceHandle(preparedRoot, asset, { ...options, renderOrderRoot: root });
    const entry: Entry = { root: preparedRoot, handle, ready: false, promise: Promise.resolve(), warming: false, retired: false, promotions: new Set(), textureBytes: 0 };
    entries.set(key, entry);
    const isCurrent = () => !disposed && entries.get(key) === entry;
    const priority: AppearanceWarmupPriority = {
      // Check selection live: a promoted request may become a background neighbor
      // again if the user selects another flavor before its warmup finishes.
      isForeground: () => isCurrent() && applyingKey === key,
      onPromote(callback) {
        entry.promotions.add(callback);
        if (priority.isForeground()) callback();
        return () => { entry.promotions.delete(callback); };
      },
    };
    entry.promise = handle.apply(appearance).then(async () => {
      if (!isCurrent()) return;
      entry.textureBytes = decodedBytesOf(preparedRoot, importedTextures);
      // Never upload an inadmissible background image to the GPU. A selected
      // replacement can temporarily exceed the limit until the old label retires.
      prune();
      if (!isCurrent()) return;
      deferredBytes.delete(key);
      entry.warming = true;
      try { await options.warmup?.(preparedRoot, isCurrent, priority); }
      finally { entry.warming = false; entry.promotions.clear(); if (entry.retired) entry.handle.dispose(); }
      if (!isCurrent()) return;
      entry.ready = true;
      report();
    }).catch(error => {
      if (entries.get(key) === entry) { evict(key, entry); report(); }
      throw error;
    });
    report();
    return entry.promise;
  };
  return {
    setWindow(appearances) {
      requested = [...new Set(appearances.map(keyOf))].slice(0, capacity);
      for (const key of deferredBytes.keys()) if (!requested.includes(key)) deferredBytes.delete(key);
      prune();
    },
    prepare(appearance) { return ensure(appearance, false); },
    has(appearance) { return entries.get(keyOf(appearance))?.ready ?? false; },
    async apply(appearance) {
      if (disposed) return;
      const thisRevision = ++revision;
      const key = keyOf(appearance);
      applyingKey = key;
      prune();
      try {
        await ensure(appearance, true);
        const entry = entries.get(key);
        if (disposed || thisRevision !== revision || !entry?.ready) return;
        const sources = meshesOf(entry.root);
        targets.forEach((mesh, index) => { mesh.material = sources[index].material; });
        activeKey = key;
      } finally {
        if (thisRevision === revision) { applyingKey = undefined; prune(); }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; revision++;
      deferredBytes.clear();
      restore();
      for (const [key, entry] of entries) evict(key, entry);
      report();
    },
  };
}
