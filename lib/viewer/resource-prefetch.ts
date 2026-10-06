import { publicUrl } from '../public-url';
import { assetUrl, type ProductAppearance, type ProductAsset } from '../viewer-config';

export interface ViewerResourceCandidate { asset: ProductAsset; appearance?: ProductAppearance }
export interface ViewerResourceWindow { ready: ViewerResourceCandidate[]; files: ViewerResourceCandidate[] }
export interface ResourcePrefetchDiagnostics { entries: number; bytes: number; queued: number; inFlight: number }
export interface ResourceUrlLease { url: string; release(): void }
export interface ResourcePrefetchOptions {
  maxCandidates?: number;
  maxFiles?: number;
  maxBytes?: number;
  onDiagnostics?: (value: ResourcePrefetchDiagnostics) => void;
  /** Injectable browser boundaries also allow deterministic queue/lifetime tests. */
  fetch?: typeof fetch;
  schedule?: (work: () => void) => () => void;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  allowBackground?: () => boolean;
}

type CachedFile = { source: string; url: string; bytes: number; leases: number; retired: boolean };
type Download = { source: string; controller: AbortController; cancelled: boolean };

function scheduleIdle(work: () => void): () => void {
  // Leave a gap between downloads so decoding/rendering the selected can takes priority.
  let idle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idle = window.requestIdleCallback(work, { timeout: 1500 });
    } else work();
  }, 80);
  return () => {
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

function backgroundAllowed(): boolean {
  if (typeof navigator === 'undefined') return true;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return !connection?.saveData && connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g';
}

/** Stores compressed files only: no Image, image decoding, material, or GPU allocation. */
export function createResourcePrefetcher(options: ResourcePrefetchOptions = {}) {
  const maxCandidates = Math.max(1, Math.min(21, options.maxCandidates ?? 21));
  const maxFiles = Math.max(1, Math.min(60, options.maxFiles ?? 60));
  const maxBytes = Math.max(1, options.maxBytes ?? 32 * 1024 * 1024);
  const fetchFile = options.fetch ?? globalThis.fetch.bind(globalThis);
  const schedule = options.schedule ?? scheduleIdle;
  const createUrl = options.createObjectURL ?? (blob => URL.createObjectURL(blob));
  const revokeUrl = options.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
  const allowBackground = options.allowBackground ?? backgroundAllowed;
  const cache = new Map<string, CachedFile>();
  // Remember attempts in a stable window, including evicted/oversize files. Otherwise
  // a full byte budget would cause an endless download/evict/download cycle.
  const attempted = new Set<string>();
  const waitingForLease = new Set<string>();
  let desired: string[] = [];
  let desiredSet = new Set<string>();
  let bytes = 0;
  let download: Download | null = null;
  let cancelScheduled: (() => void) | null = null;
  let enabled = true;
  let disposed = false;

  const canonical = (original: string) => publicUrl(original);
  const queued = () => desired.filter(source => !cache.has(source) && !attempted.has(source) && !waitingForLease.has(source) && source !== download?.source);
  const report = () => options.onDiagnostics?.({ entries: cache.size, bytes, queued: queued().length, inFlight: download ? 1 : 0 });
  const remove = (file: CachedFile) => {
    if (cache.get(file.source) !== file) return;
    cache.delete(file.source);
    bytes -= file.bytes;
    revokeUrl(file.url);
  };
  const cancelDownload = () => {
    if (!download) return;
    download.cancelled = true;
    download.controller.abort();
  };
  const makeRoom = (incomingBytes: number, source: string) => {
    if (incomingBytes > maxBytes) return false;
    const priority = desired.indexOf(source);
    const farthestFirst = [...cache.values()].sort((a, b) => desired.indexOf(b.source) - desired.indexOf(a.source));
    for (const file of farthestFirst) {
      if (cache.size < maxFiles && bytes + incomingBytes <= maxBytes) break;
      // Keep nearer files when a farther neighbor will not fit. A new selection
      // changes this ordering and may replace those files with its new neighbors.
      if (!file.leases && (file.retired || desired.indexOf(file.source) > priority)) remove(file);
    }
    return cache.size < maxFiles && bytes + incomingBytes <= maxBytes;
  };
  const wanted = (task: Download) => !disposed && enabled && !task.cancelled && desiredSet.has(task.source);

  const scheduleNext = () => {
    if (disposed || !enabled || download || cancelScheduled || !allowBackground() || !queued().length) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = null;
      if (disposed || !enabled || download || !allowBackground()) return;
      const source = queued()[0];
      if (!source) return;
      const task: Download = { source, controller: new AbortController(), cancelled: false };
      download = task;
      report();
      void fetchFile(source, { signal: task.controller.signal, credentials: 'same-origin', cache: 'force-cache' })
        .then(async response => {
          if (!response.ok) throw new Error('Prefetch request failed');
          const declaredBytes = Number(response.headers.get('content-length'));
          if (declaredBytes > maxBytes) {
            task.controller.abort();
            return;
          }
          if (!wanted(task)) return;
          const blob = await response.blob();
          if (!wanted(task)) return;
          if (!makeRoom(blob.size, source)) {
            if (blob.size <= maxBytes && [...cache.values()].some(file => file.leases)) waitingForLease.add(source);
            return;
          }
          const file: CachedFile = { source, url: createUrl(blob), bytes: blob.size, leases: 0, retired: false };
          cache.set(source, file);
          bytes += file.bytes;
        })
        .catch(() => { /* A failed background download must not disturb the selected can. */ })
        .finally(() => {
          if (wanted(task) && !waitingForLease.has(source)) attempted.add(source);
          if (download === task) download = null;
          report();
          scheduleNext();
        });
    });
  };

  return {
    allowsBackground() { return !disposed && allowBackground(); },
    configure(candidates: ViewerResourceCandidate[]) {
      if (disposed) return;
      const urls = new Set<string>();
      const include = (original: string | undefined) => {
        const valid = assetUrl(original);
        if (valid && urls.size < maxFiles) urls.add(canonical(valid));
      };
      for (const candidate of candidates.slice(0, maxCandidates)) {
        include(candidate.asset.src);
        for (const slot of Object.values(candidate.appearance?.slots ?? {})) {
          include(slot.baseColorMap); include(slot.normalMap); include(slot.roughnessMap);
        }
      }
      const nextDesired = [...urls];
      if (nextDesired.length !== desired.length || nextDesired.some((source, index) => desired[index] !== source)) attempted.clear();
      desired = nextDesired;
      desiredSet = new Set(desired);
      waitingForLease.clear();
      for (const file of cache.values()) {
        file.retired = !desiredSet.has(file.source);
        if (file.retired && !file.leases) remove(file);
      }
      if (download && !desiredSet.has(download.source)) cancelDownload();
      cancelScheduled?.(); cancelScheduled = null;
      report();
      scheduleNext();
    },
    setEnabled(value: boolean) {
      if (disposed) return;
      enabled = value;
      if (!enabled) {
        cancelScheduled?.(); cancelScheduled = null;
        cancelDownload();
      } else scheduleNext();
      report();
    },
    resolveUrl(original: string): string {
      const source = canonical(original), file = cache.get(source);
      return file && !file.retired ? file.url : source;
    },
    acquireUrl(original: string): ResourceUrlLease {
      const source = canonical(original), file = cache.get(source);
      if (!file || file.retired || disposed) return { url: source, release() {} };
      // Keep the Blob URL valid while ImageLoader/GLTFLoader consumes its contents.
      cache.delete(source); cache.set(source, file);
      file.leases += 1;
      let released = false;
      return {
        url: file.url,
        release() {
          if (released) return;
          released = true; file.leases -= 1;
          if (!file.leases && (file.retired || disposed)) remove(file);
          if (!file.leases) { waitingForLease.clear(); scheduleNext(); }
          report();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      desired = []; desiredSet.clear(); attempted.clear(); waitingForLease.clear();
      cancelScheduled?.(); cancelScheduled = null;
      cancelDownload();
      // Leases survive disposal until their loader completes, then revoke exactly once.
      for (const file of cache.values()) { file.retired = true; if (!file.leases) remove(file); }
      report();
    },
  };
}
