'use client';

import { Heart } from 'lucide-react';
import { favoritesCopy } from '@/lib/i18n/favorites';
import { useLanguage } from '../LanguageProvider';
import { useFavorites } from './useFavorites';

export default function FavoritesTrigger({ onOpen, open, className = '' }: { onOpen: () => void; open: boolean; className?: string }) {
  const ids = useFavorites();
  const { locale } = useLanguage();
  const copy = favoritesCopy(locale);
  return <button type="button" className={`favorites-trigger ${className}`} aria-label={`${copy.open} (${ids.length})`} title={copy.title}
    aria-haspopup="dialog" aria-controls="favorites-panel" aria-expanded={open} onClick={onOpen}>
    <Heart size={22} strokeWidth={1.7} aria-hidden="true" />
    {ids.length > 0 && <span className="favorites-count" aria-hidden="true">{ids.length}</span>}
  </button>;
}
