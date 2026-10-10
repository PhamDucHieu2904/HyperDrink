'use client';
import { useSyncExternalStore } from 'react';
import { Gem } from 'lucide-react';
import { graphicsModeSnapshot, graphicsModeServerSnapshot, setGraphicsMode, subscribeGraphicsMode } from '@/lib/viewer/graphics-mode';
import { useLanguage } from './LanguageProvider';

const labels = {
  en: ['Enhanced graphics', 'On · Transparent refraction', 'Off · Smooth performance'],
  fr: ['Graphismes améliorés', 'Activé · Réfraction transparente', 'Désactivé · Fluidité'],
  zh: ['增强画质', '开启 · 透明折射', '关闭 · 流畅性能'],
  es: ['Gráficos mejorados', 'Activado · Refracción transparente', 'Desactivado · Mayor fluidez'],
  ar: ['رسومات محسّنة', 'مفعّل · انكسار شفاف', 'معطّل · أداء سلس'],
  ru: ['Улучшенная графика', 'Вкл. · Прозрачное преломление', 'Выкл. · Плавная работа'],
  ko: ['향상된 그래픽', '켜짐 · 투명 굴절', '꺼짐 · 부드러운 성능'],
  de: ['Verbesserte Grafik', 'An · Transparente Brechung', 'Aus · Flüssige Darstellung'],
} as const;
export function useGraphicsMode() { return useSyncExternalStore(subscribeGraphicsMode, graphicsModeSnapshot, graphicsModeServerSnapshot); }
export default function GraphicsToggle({ className = '' }: { className?: string }) {
  const { locale } = useLanguage();
  const mode = useGraphicsMode(), enhanced = mode === 'enhanced';
  const copy = labels[locale], detail = copy[enhanced ? 1 : 2];
  return <button type="button" className={`graphics-toggle${className ? ` ${className}` : ''}`} aria-label={copy[0]} aria-pressed={enhanced}
    aria-describedby="graphics-toggle-description" onClick={() => setGraphicsMode(enhanced ? 'standard' : 'enhanced')}>
    <Gem size={21} strokeWidth={1.6} aria-hidden="true" />
    <span id="graphics-toggle-description" className="graphics-toggle-caption"><strong>{copy[0]}</strong><span>{detail}</span></span>
  </button>;
}
