import * as THREE from 'three';
import type { ProductAppearance, ProductAsset } from '../viewer-config';
import { createAppearanceHandle, type AppearanceHandle, type AppearanceLoadOptions } from './appearance';

export interface AppearancePoolOptions extends AppearanceLoadOptions {
  capacity?: number;
  warmup?: (root: THREE.Object3D, isCurrent: () => boolean) => Promise<void>;
  onChange?: (ready: number, pending: number) => void;
}
export interface PooledAppearanceHandle extends AppearanceHandle {
  setWindow(appearances: readonly (ProductAppearance | undefined)[]): void;
  prepare(appearance?: ProductAppearance): Promise<void>;
  has(appearance?: ProductAppearance): boolean;
}
type Entry = { root: THREE.Object3D; handle: AppearanceHandle; ready: boolean; promise: Promise<void>; warming: boolean; retired: boolean };
const keyOf = (appearance?: ProductAppearance) => JSON.stringify(appearance ?? null);
const meshesOf = (root: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  root.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
  return meshes;
};

/** Five lightweight material sets share one geometry; only the committed set is visible. */
export function createPooledAppearanceHandle(root: THREE.Object3D, asset: ProductAsset, options: AppearancePoolOptions = {}): PooledAppearanceHandle {
  const capacity = Math.max(1, Math.min(5, options.capacity ?? 5));
  const targets = meshesOf(root);
  const originals = targets.map(mesh => mesh.material);
  const entries = new Map<string, Entry>();
  let requested: string[] = [];
  let activeKey: string | undefined;
  let applyingKey: string | undefined;
  let revision = 0;
  let disposed = false;
  const report = () => options.onChange?.([...entries.values()].filter(entry => entry.ready).length, [...entries.values()].filter(entry => !entry.ready).length);
  const restore = () => targets.forEach((mesh, index) => { mesh.material = originals[index]; });
  const evict = (key: string, entry: Entry) => {
    entries.delete(key);
    // r180 compileAsync polls each material's currentProgram. Disposing a material
    // during that poll deletes its renderer properties and can throw from a timer.
    // Retire the entry immediately, retaining ownership only until warmup settles.
    if (entry.warming) entry.retired = true;
    else entry.handle.dispose();
  };
  const prune = () => {
    // Keep the visible and requested material alive until the replacement commits.
    const keep = new Set([activeKey, applyingKey].filter((key): key is string => key !== undefined));
    for (const key of requested) { if (keep.size >= capacity) break; keep.add(key); }
    for (const [key, entry] of entries) if (!keep.has(key)) evict(key, entry);
    report();
    return keep;
  };
  const ensure = (appearance: ProductAppearance | undefined, required: boolean) => {
    const key = keyOf(appearance);
    const existing = entries.get(key);
    if (existing) return existing.promise;
    if (disposed || (!required && !prune().has(key))) return Promise.resolve();
    // clone() shares geometry/imported textures; make its materials independent of
    // the currently committed pool entry before creating the reversible handle.
    const preparedRoot = root.clone(true);
    meshesOf(preparedRoot).forEach((mesh, index) => { const material = originals[index]; mesh.material = Array.isArray(material) ? [...material] : material; });
    const handle = createAppearanceHandle(preparedRoot, asset, options);
    const entry: Entry = { root: preparedRoot, handle, ready: false, promise: Promise.resolve(), warming: false, retired: false };
    entries.set(key, entry);
    const isCurrent = () => !disposed && entries.get(key) === entry;
    entry.promise = handle.apply(appearance).then(async () => {
      if (!isCurrent()) return;
      entry.warming = true;
      try { await options.warmup?.(preparedRoot, isCurrent); }
      finally { entry.warming = false; if (entry.retired) entry.handle.dispose(); }
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
    setWindow(appearances) { requested = [...new Set(appearances.map(keyOf))].slice(0, capacity); prune(); },
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
      restore();
      for (const [key, entry] of entries) evict(key, entry);
      report();
    },
  };
}
