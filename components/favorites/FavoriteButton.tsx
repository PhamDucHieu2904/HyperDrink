'use client';

import { Heart } from 'lucide-react';
import { toggleFavorite } from '@/lib/favorites';
import { favoritesCopy } from '@/lib/i18n/favorites';
import { trackUsage } from '@/lib/operations/client';
import { useLanguage } from '../LanguageProvider';
import { useFavorites } from './useFavorites';

export default function FavoriteButton({ productId, name, className = '', onToggle }: { productId: string; name: string; className?: string; onToggle?: (liked: boolean) => void }) {
  const favorites = useFavorites();
  const liked = favorites.includes(productId);
  const { locale } = useLanguage();
  const copy = favoritesCopy(locale);
  const label = `${liked ? copy.remove : copy.add}: ${name}`;
  return <button type="button" className={`favorite-button ${className}`} aria-label={label} title={label} aria-pressed={liked}
    onClick={() => { const added = toggleFavorite(productId); if (added) trackUsage('favorite', productId); onToggle?.(added); }}>
    <Heart size={20} strokeWidth={1.7} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
  </button>;
}
