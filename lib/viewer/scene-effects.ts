export const SCENE_EFFECTS_STORAGE_KEY = 'vinut.scene-effects.v1';
export const SCENE_HINT_STORAGE_KEY = 'vinut.scene-effects-hint.v1';
const listeners = new Set<() => void>();
let enabled: boolean | undefined, acknowledged: boolean | undefined;
export function sceneEffectsSnapshot() {
  if (enabled === undefined) {
    try { enabled = window.localStorage.getItem(SCENE_EFFECTS_STORAGE_KEY) !== 'off'; }
    catch { enabled = true; }
  }
  return enabled;
}
export const sceneEffectsServerSnapshot = () => true;
export function sceneHintSnapshot() {
  if (acknowledged === undefined) {
    try { acknowledged = window.localStorage.getItem(SCENE_HINT_STORAGE_KEY) === 'seen'; }
    catch { acknowledged = false; }
  }
  return acknowledged;
}
export const sceneHintServerSnapshot = () => false;
export function setSceneEffects(value: boolean) {
  enabled = value;
  try { window.localStorage.setItem(SCENE_EFFECTS_STORAGE_KEY, value ? 'on' : 'off'); } catch { /* Session-only when storage is unavailable. */ }
  listeners.forEach(listener => listener());
}
export function acknowledgeSceneHint() {
  acknowledged = true;
  try { window.localStorage.setItem(SCENE_HINT_STORAGE_KEY, 'seen'); } catch { /* The hint stays dismissed for this visit. */ }
  listeners.forEach(listener => listener());
}
export function subscribeSceneEffects(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => {
    if (![SCENE_EFFECTS_STORAGE_KEY, SCENE_HINT_STORAGE_KEY, null].includes(event.key)) return;
    enabled = acknowledged = undefined; listener();
  };
  window.addEventListener('storage', sync);
  return () => { listeners.delete(listener); window.removeEventListener('storage', sync); };
}
