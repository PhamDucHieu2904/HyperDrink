'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPublishedCatalog } from '@/components/usePublishedCatalog';
import type { PublishedCatalog } from '@/lib/catalog/storefront';

/** A Studio scene belongs to one immutable public release until the user reloads it. */
export function useMockupCatalog() {
  const [published, setPublished] = useState<PublishedCatalog | null>(null);
  const [available, setAvailable] = useState<PublishedCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const current = useRef<PublishedCatalog | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(false);
    try {
      const release = await fetchPublishedCatalog({ signal: request.signal });
      if (!mounted.current || request.signal.aborted) return;
      current.current = release; setPublished(release); setAvailable(null);
    } catch { if (mounted.current && !request.signal.aborted) setError(true); }
    finally { if (mounted.current && !request.signal.aborted) setLoading(false); }
  }, []);
  const adopt = useCallback(() => {
    if (!available) return;
    current.current = available; setPublished(available); setAvailable(null);
  }, [available]);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    let probe: AbortController | null = null;
    const interval = setInterval(() => {
      if (!current.current || document.visibilityState !== 'visible' || controller.current?.signal.aborted) return;
      probe?.abort(); probe = new AbortController();
      const request = probe;
      const pinnedId = current.current.releaseId;
      void fetchPublishedCatalog({ signal: request.signal, allowStaticFallback: false }).then(release => {
        if (mounted.current && !request.signal.aborted && current.current?.releaseId === pinnedId) setAvailable(release.releaseId !== pinnedId ? release : null);
      }).catch(() => { /* An unavailable newer release must not interrupt an existing scene. */ });
    }, 60_000);
    return () => { mounted.current = false; clearTimeout(initial); clearInterval(interval); controller.current?.abort(); probe?.abort(); };
  }, [refresh]);
  return { published, available, loading, error, refresh, adopt };
}
