import { publicUrl } from '../public-url';
import type { ResourceUrlLease } from './resource-prefetch';

export interface SceneResourcePlan { core: string[]; effects: string[] }
export interface SceneResourceProgress {
  phase: 'waiting' | 'core' | 'effects' | 'ready' | 'error';
  completed: number;
  total: number;
  failed: number;
  cachedBytes: number;
}
export const INITIAL_SCENE_PROGRESS: SceneResourceProgress = { phase: 'waiting', completed: 0, total: 0, failed: 0, cachedBytes: 0 };
interface Options {
  fetch?: typeof fetch;
  schedule?: (work: () => void) => () => void;
  onProgress?: (progress: SceneResourceProgress) => void;
  concurrency?: number;
  maxBytes?: number;
  timeoutMs?: number;
  /** Publication-scoped HTTP cache keys prevent same-path asset replacements
   * from serving stale files after an admin publishes a new release. */
  cacheKey?: string;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}
type File = { blob: Blob; url?: string; leases: number };

const idle = (work: () => void) => {
  let idleId: number | undefined;
  const timer = setTimeout(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) idleId = window.requestIdleCallback(work, { timeout: 500 });
    else work();
  }, 40);
  return () => { clearTimeout(timer); if (idleId !== undefined) window.cancelIdleCallback(idleId); };
};

/** Two download stages, with a bounded cache of compressed files. It never
 * decodes images, parses geometry, creates textures or allocates GPU memory. */
export function createSceneResourceLoader(plan: SceneResourcePlan, options: Options = {}) {
  const core = [...new Set(plan.core.filter(Boolean).map(publicUrl))];
  const coreSet = new Set(core);
  const effects = [...new Set(plan.effects.filter(Boolean).map(publicUrl))].filter(url => !coreSet.has(url));
  const all = [...core, ...effects];
  const done = new Set<string>(), failures = new Set<string>(), attempts = new Map<string, number>();
  const pending = new Map<string, AbortController>(), cache = new Map<string, File>();
  const fetchFile = options.fetch ?? globalThis.fetch.bind(globalThis);
  const schedule = options.schedule ?? idle;
  const createUrl = options.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeUrl = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const concurrency = Math.max(1, Math.min(2, options.concurrency ?? 2));
  const maxBytes = Math.max(1, options.maxBytes ?? 32 * 1024 * 1024);
  let bytes = 0, enabled = false, disposed = false, cancelScheduled: (() => void) | undefined;
  const stageUrls = () => core.every(url => done.has(url)) ? effects : core;
  const queued = () => stageUrls().filter(url => !done.has(url) && !failures.has(url) && !pending.has(url));
  const progress = (): SceneResourceProgress => ({
    phase: all.every(url => done.has(url)) ? 'ready'
      : !pending.size && !queued().length && failures.size ? 'error'
      : !enabled ? 'waiting' : core.every(url => done.has(url)) ? 'effects' : 'core',
    completed: done.size, total: all.length, failed: failures.size, cachedBytes: bytes,
  });
  const report = () => { if (!disposed) options.onProgress?.(progress()); };
  const remove = (source: string, file: File) => {
    cache.delete(source); bytes -= file.blob.size;
    if (file.url) revokeUrl(file.url);
  };
  const store = (source: string, blob: Blob) => {
    if (blob.size > maxBytes) return; // The HTTP cache still owns this download.
    for (const [key, file] of cache) {
      if (bytes + blob.size <= maxBytes) break;
      if (!file.leases) remove(key, file);
    }
    if (bytes + blob.size <= maxBytes) { cache.set(source, { blob, leases: 0 }); bytes += blob.size; }
  };
  const pump = () => {
    if (disposed || !enabled || cancelScheduled || pending.size >= concurrency || !queued().length) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = undefined;
      if (disposed || !enabled) return;
      for (const source of queued().slice(0, concurrency - pending.size)) {
        const controller = new AbortController();
        pending.set(source, controller);
        attempts.set(source, (attempts.get(source) ?? 0) + 1);
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
        controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
        const requestUrl = options.cacheKey ? `${source}${source.includes('?') ? '&' : '?'}vinut-release=${encodeURIComponent(options.cacheKey)}` : source;
        void fetchFile(requestUrl, { signal: controller.signal, credentials: 'same-origin', cache: 'force-cache', priority: 'low' })
          .then(async response => {
            if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Resource unavailable');
            const blob = await response.blob();
            if (disposed) return;
            store(source, blob); done.add(source);
          }).catch(() => {
            if (!disposed && attempts.get(source)! >= 3) failures.add(source);
          }).finally(() => {
            clearTimeout(timeout); pending.delete(source);
            report(); pump();
          });
      }
      report();
    });
  };
  return {
    snapshot: progress,
    setEnabled(value: boolean) {
      if (disposed) return;
      enabled = value;
      if (!enabled) { cancelScheduled?.(); cancelScheduled = undefined; }
      // Already-running requests can finish; a newly selected product is never
      // blocked by an unlimited background queue or repeated aborted transfers.
      report(); pump();
    },
    retry() {
      if (disposed) return;
      failures.forEach(url => attempts.delete(url)); failures.clear();
      report(); pump();
    },
    acquireUrl(original: string): ResourceUrlLease {
      const source = publicUrl(original), file = cache.get(source);
      if (!file || disposed) return { url: source, release() {} };
      cache.delete(source); cache.set(source, file);
      file.url ??= createUrl(file.blob); file.leases++;
      let released = false;
      return { url: file.url, release() {
        if (released) return;
        released = true; file.leases--;
        if (disposed && !file.leases) remove(source, file);
      } };
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelScheduled?.(); pending.forEach(controller => controller.abort());
      // A loader may still be consuming a Blob; its last lease owns revocation.
      for (const [source, file] of cache) if (!file.leases) remove(source, file);
    },
  };
}
