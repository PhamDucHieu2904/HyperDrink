'use client';

import Image from 'next/image';
import { ZoomIn } from 'lucide-react';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { mediaUrl } from '@/lib/catalog/resolve';
import type { MediaAsset } from '@/lib/catalog/contracts';
import { useLanguage } from '../LanguageProvider';
import styles from './inspect-image.module.css';

const hints = { en: 'Hold to inspect · Release to return', fr: 'Maintenez pour agrandir · Relâchez pour revenir', zh: '按住查看细节 · 松开还原', es: 'Mantén pulsado para ampliar · Suelta para volver', ar: 'اضغط مطولاً للتكبير · اترك للعودة', ru: 'Удерживайте для увеличения · Отпустите для возврата', ko: '길게 눌러 확대 · 놓으면 돌아갑니다', de: 'Gedrückt halten zum Vergrößern · Loslassen zum Zurücksetzen' };

export default function InspectableProductImage({ image, name }: { image: MediaAsset; name: string }) {
  const frame = useRef<HTMLButtonElement>(null);
  const activePointer = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const { locale } = useLanguage();
  const id = useId();
  function reset() { activePointer.current = null; if (frame.current) frame.current.dataset.zoomed = 'false'; }
  useEffect(() => { window.addEventListener('blur', reset); return () => window.removeEventListener('blur', reset); }, []);
  function point(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--inspect-x', `${Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100))}%`);
    event.currentTarget.style.setProperty('--inspect-y', `${Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100))}%`);
  }
  return <div className={styles.visual}>
    <button ref={frame} type="button" className={styles.frame} aria-label={name} aria-describedby={id} disabled={failed} data-zoomed="false"
      onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); point(event); event.currentTarget.dataset.zoomed = 'true'; }}
      onPointerMove={event => { if (activePointer.current === event.pointerId) point(event); }}
      onPointerUp={reset} onPointerCancel={reset} onLostPointerCapture={reset} onBlur={reset}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (event.repeat) return; event.currentTarget.style.setProperty('--inspect-x', '50%'); event.currentTarget.style.setProperty('--inspect-y', '50%'); event.currentTarget.dataset.zoomed = 'true'; } }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); reset(); } }}>
      {failed ? <span>{name}</span> : <Image unoptimized src={mediaUrl(image)} alt={name} width={image.width || 1024} height={image.height || 1024} draggable={false} onError={() => setFailed(true)} />}
    </button>
    <p id={id} className={styles.hint}><ZoomIn size={16} aria-hidden="true" />{hints[locale]}</p>
  </div>;
}
