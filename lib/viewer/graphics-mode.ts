/** Manual graphics preference. No device benchmark or automatic mode switching. */
export type GraphicsMode = 'standard' | 'enhanced';
export const GRAPHICS_STORAGE_KEY = 'vinut.graphics-mode.v1';
const listeners = new Set<() => void>();
let cached: GraphicsMode | undefined;

export function graphicsModeSnapshot(): GraphicsMode {
  if (typeof window === 'undefined') return 'standard';
  if (cached === undefined) {
    try { cached = window.localStorage.getItem(GRAPHICS_STORAGE_KEY) === 'enhanced' ? 'enhanced' : 'standard'; }
    catch { cached = 'standard'; }
  }
  return cached;
}
export const graphicsModeServerSnapshot = (): GraphicsMode => 'standard';
export function setGraphicsMode(mode: GraphicsMode) {
  cached = mode;
  try { window.localStorage.setItem(GRAPHICS_STORAGE_KEY, mode); } catch { /* Session preference still works. */ }
  listeners.forEach(listener => listener());
}
export function subscribeGraphicsMode(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GRAPHICS_STORAGE_KEY && event.key !== null) return;
    cached = undefined; listener();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
