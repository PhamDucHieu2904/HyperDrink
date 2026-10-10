'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Leaf, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useLanguage } from './LanguageProvider';
import { sceneEffectsCopy } from '@/lib/i18n/scene-effects';
import type { SceneResourceProgress } from '@/lib/viewer/scene-resources';
import { acknowledgeSceneHint, sceneEffectsSnapshot, sceneEffectsServerSnapshot, sceneHintSnapshot, sceneHintServerSnapshot, setSceneEffects, subscribeSceneEffects } from '@/lib/viewer/scene-effects';

export const useSceneEffects = () => useSyncExternalStore(subscribeSceneEffects, sceneEffectsSnapshot, sceneEffectsServerSnapshot);

export default function SceneEffectsToggle({ progress, onRetry }: { progress: SceneResourceProgress; onRetry: () => void }) {
  const { locale } = useLanguage(), copy = sceneEffectsCopy[locale];
  const enabled = useSceneEffects();
  const seen = useSyncExternalStore(subscribeSceneEffects, sceneHintSnapshot, sceneHintServerSnapshot);
  const [panel, setPanel] = useState<'hidden' | 'open' | 'closing'>('hidden');
  const shown = useRef(false), button = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null);
  const ready = progress.phase === 'ready', error = progress.phase === 'error';
  const percent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;
  const detail = ready ? enabled ? copy.on : copy.off : error ? `${copy.error} ${copy.retry}` : copy[progress.phase as 'waiting' | 'core' | 'effects'];
  useEffect(() => {
    if (!ready || seen || shown.current) return;
    const timer = setTimeout(() => { shown.current = true; setPanel('open'); }, 650);
    return () => clearTimeout(timer);
  }, [ready, seen]);
  useEffect(() => {
    if (panel !== 'closing') return;
    const timer = setTimeout(() => { acknowledgeSceneHint(); setPanel('hidden'); }, 400);
    return () => clearTimeout(timer);
  }, [panel]);
  const close = () => {
    if (panel !== 'open') return;
    // Move focus before removing any focused descendant. Auto-opening the
    // hint never steals keyboard focus from the customer's current activity.
    if (panelRef.current?.contains(document.activeElement)) button.current?.focus();
    setPanel('closing');
  };
  const Icon = ready ? Leaf : error ? RotateCcw : LoaderCircle;
  return <div className="scene-effects-control" data-load-phase={progress.phase} data-loaded-files={progress.completed} data-total-files={progress.total} data-file-cache-bytes={progress.cachedBytes}>
    <button ref={button} type="button" className="graphics-toggle scene-effects-toggle" aria-label={error ? `${copy.name} · ${copy.retry}` : copy.name}
      aria-pressed={ready && enabled} aria-disabled={!ready && !error} aria-busy={!ready && !error}
      aria-describedby="scene-effects-description" onClick={() => { if (error) onRetry(); else if (ready) { close(); setSceneEffects(!enabled); } }}>
      <Icon size={21} strokeWidth={1.6} aria-hidden="true" className={!ready && !error ? 'scene-effects-spinner' : undefined} />
      {!ready && !error && <svg className="scene-effects-progress" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="21" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>}
      <span id="scene-effects-description" className="graphics-toggle-caption"><strong>{copy.name}</strong><span>{detail}{!ready && !error && progress.total > 0 ? ` ${percent}%` : ''}</span></span>
    </button>
    <span className="scene-effects-announcement" role="status">{ready ? copy.title : error ? copy.error : ''}</span>
    {panel !== 'hidden' && <div ref={panelRef} className={`scene-effects-panel glass-surface${panel === 'closing' ? ' is-closing' : ''}`} inert={panel === 'closing'} role="dialog" aria-labelledby="scene-effects-title" aria-describedby="scene-effects-message" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <span className="scene-effects-panel-icon" aria-hidden="true"><Sparkles size={24} strokeWidth={1.5} /><span><Check size={12} strokeWidth={2.4} /></span></span>
      <h2 id="scene-effects-title">{copy.title}</h2>
      <p id="scene-effects-message">{enabled ? copy.body : copy.savedOff}</p>
      <button type="button" className="btn btn-primary" onClick={close}>{copy.confirm}<Check size={17} aria-hidden="true" /></button>
    </div>}
  </div>;
}
