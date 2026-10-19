'use client';

import { useSyncExternalStore } from 'react';
import { favoritesServerSnapshot, favoritesSnapshot, subscribeFavorites } from '@/lib/favorites';

export const useFavorites = () => useSyncExternalStore(subscribeFavorites, favoritesSnapshot, favoritesServerSnapshot);
