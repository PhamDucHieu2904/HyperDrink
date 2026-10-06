'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parsePublishedCatalog, type PublishedCatalog } from '@/lib/catalog/storefront';
import { publicUrl } from '@/lib/public-url';

export interface PublishedCatalogLoadOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  apiBase?: string;
  mode?: 'api' | 'static';
  allowStaticFallback?: boolean;
  timeoutMs?: number;
}

class CatalogLoadError extends Error {
  constructor(message: string, readonly kind: 'http' | 'unavailable' | 'invalid') { super(message); }
}

async function readRelease(fetcher: typeof fetch, url: string, source: PublishedCatalog['source'], signal?: AbortSignal, timeoutMs = 10_000): Promise<PublishedCatalog> {
  const request = new AbortController();
  let timedOut = false;
  const relayAbort = () => request.abort(signal?.reason);
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; request.abort(new DOMException('Catalog request timed out', 'TimeoutError')); }, timeoutMs);
  const assertNotAborted = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new CatalogLoadError('Nguồn bản phát hành chưa phản hồi kịp thời.', 'unavailable');
  };
  try {
    assertNotAborted();
    let response: Response;
    // Static snapshots revalidate cached bytes and match the anonymous HTML preload.
    // The API keeps its independent, credential-free request policy.
    const cache = source === 'static' ? 'no-cache' : 'no-store';
    const credentials = source === 'static' ? 'same-origin' : 'omit';
    try { response = await fetcher(url, { cache, credentials, signal: request.signal }); }
    catch (cause) {
      assertNotAborted();
      if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      throw new CatalogLoadError('Không kết nối được nguồn bản phát hành.', 'unavailable');
    }
    assertNotAborted();
    if (!response.ok) {
      let message = response.status === 404 ? 'Chưa có bản phát hành được xuất bản.' : `Không tải được bản phát hành (${response.status}).`;
      try { const body = await response.json(); if (typeof body?.error?.message === 'string') message = body.error.message; } catch { /* HTTP status remains authoritative for an HTML error response. */ }
      if (signal?.aborted) assertNotAborted();
      throw new CatalogLoadError(message, response.status >= 500 ? 'unavailable' : 'http');
    }
    try {
      const body: unknown = await response.json();
      assertNotAborted();
      return parsePublishedCatalog(body, source);
    } catch (cause) {
      assertNotAborted();
      if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      throw new CatalogLoadError(cause instanceof Error ? cause.message : 'Bản phát hành có dữ liệu không hợp lệ.', 'invalid');
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', relayAbort);
  }
}

/** Public committed endpoint only. Static deployments skip the API unless an explicit API origin is configured. */
export async function fetchPublishedCatalog(options: PublishedCatalogLoadOptions = {}): Promise<PublishedCatalog> {
  const fetcher = options.fetcher || fetch;
  const api = (options.apiBase ?? process.env.NEXT_PUBLIC_ADMIN_API_URL ?? '').replace(/\/+$/, '');
  const mode = options.mode || (process.env.NEXT_PUBLIC_CATALOG_MODE === 'static' ? 'static' : 'api');
  const snapshotUrl = publicUrl('/catalog/current.json');
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs : 10_000;
  if (mode === 'static' && !api) return readRelease(fetcher, snapshotUrl, 'static', options.signal, timeoutMs);
  try { return await readRelease(fetcher, api ? `${api}/api/public/v1/catalog` : publicUrl('/api/public/v1/catalog'), 'api', options.signal, timeoutMs); }
  catch (cause) {
    if (options.signal?.aborted || !(cause instanceof CatalogLoadError) || cause.kind !== 'unavailable' || options.allowStaticFallback === false) throw cause;
    return readRelease(fetcher, snapshotUrl, 'static', options.signal, timeoutMs);
  }
}

export function usePublishedCatalog(): { published: PublishedCatalog | null; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [published, setPublished] = useState<PublishedCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastGood = useRef<PublishedCatalog | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const cancelPending = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    controller.current?.abort();
    const current = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPublishedCatalog({ signal: request.signal, allowStaticFallback: !lastGood.current });
      if (!mounted.current || current !== sequence.current || request.signal.aborted) return;
      lastGood.current = result;
      setPublished(previous => previous?.releaseId === result.releaseId && previous.source === result.source && previous.publishedAt === result.publishedAt ? previous : result);
    } catch (cause) {
      if (mounted.current && current === sequence.current && !request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Không tải được bản phát hành.');
    } finally {
      if (mounted.current && current === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = setInterval(refreshVisible, 30_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mounted.current = false;
      cancelPending();
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh, cancelPending]);

  return { published, loading, error, refresh };
}
