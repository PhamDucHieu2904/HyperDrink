'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createTranslator, DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, localeDirection, resolveLocale, type Locale, type Translator } from '@/lib/i18n/catalog';

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator };
const LanguageContext = createContext<LanguageContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: createTranslator(DEFAULT_LOCALE) });

/** English SSR works with static export; only an explicit saved choice overrides it. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try { updateLocale(resolveLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY))); } catch { /* Storage may be disabled. English remains usable. */ }
    });
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) updateLocale(resolveLocale(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => { live = false; window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
    return () => { document.documentElement.lang = DEFAULT_LOCALE; document.documentElement.dir = 'ltr'; };
  }, [locale]);
  const setLocale = useCallback((choice: Locale) => {
    const next = resolveLocale(choice);
    updateLocale(next);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* The selection still works for this visit. */ }
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
