export const FAVORITES_STORAGE_KEY = 'vinut.favorites.v1';
const empty: readonly string[] = [];
const listeners = new Set<() => void>();
let cached: readonly string[] | undefined;

/** Store stable product IDs only; names and images come from the current catalog. */
export function parseFavoriteIds(value: string | null): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return empty;
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 1000);
  } catch { return empty; }
}

export function favoritesSnapshot(): readonly string[] {
  if (typeof window === 'undefined') return empty;
  if (cached === undefined) {
    try { cached = parseFavoriteIds(window.localStorage.getItem(FAVORITES_STORAGE_KEY)); }
    catch { cached = empty; }
  }
  return cached;
}

export const favoritesServerSnapshot = () => empty;
const notify = () => listeners.forEach(listener => listener());
function syncFavorites(event: StorageEvent) {
  if (event.key !== FAVORITES_STORAGE_KEY && event.key !== null) return;
  cached = undefined;
  notify();
}

export function subscribeFavorites(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', syncFavorites);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', syncFavorites);
  };
}

export function toggleFavorite(id: string): boolean {
  if (!id || id.length > 200) return false;
  const current = favoritesSnapshot();
  const added = !current.includes(id);
  cached = added ? [id, ...current].slice(0, 1000) : current.filter(item => item !== id);
  try { window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(cached)); }
  catch { /* Keep the list usable for this visit when storage is unavailable. */ }
  notify();
  return added;
}
