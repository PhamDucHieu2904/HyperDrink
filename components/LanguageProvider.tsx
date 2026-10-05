'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createTranslator, DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, localeDirection, resolveLocale, type Locale, type Translator } from '@/lib/i18n/catalog';
import { BrowserCatalogTranslator, type BrowserTranslationEnvironment, type TranslationProgress } from '@/lib/i18n/browser-translator';

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator; catalogTranslator: BrowserCatalogTranslator; translation: TranslationProgress; activateTranslation: () => void };
const browserEnvironment = () => typeof window === 'undefined' ? {} : window as unknown as BrowserTranslationEnvironment;
const LanguageContext = createContext<LanguageContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => {}, t: createTranslator(DEFAULT_LOCALE), catalogTranslator: new BrowserCatalogTranslator(browserEnvironment), translation: { status: 'idle', completed: 0, total: 0 }, activateTranslation: () => {} });

/** English SSR works with static export; only an explicit saved choice overrides it. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [catalogTranslator] = useState(() => new BrowserCatalogTranslator(browserEnvironment));
  const [translation, setTranslation] = useState<TranslationProgress>({ status: 'idle', completed: 0, total: 0 });
  useEffect(() => catalogTranslator.subscribe(setTranslation), [catalogTranslator]);
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
    void catalogTranslator.activate(next);
    updateLocale(next);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* The selection still works for this visit. */ }
  }, [catalogTranslator]);
  const activateTranslation = useCallback(() => { void catalogTranslator.activate(locale); }, [catalogTranslator, locale]);
  useEffect(() => {
    const activate = () => { if (catalogTranslator.status === 'needs-activation') activateTranslation(); };
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => { window.removeEventListener('pointerdown', activate); window.removeEventListener('keydown', activate); };
  }, [catalogTranslator, activateTranslation]);
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale), catalogTranslator, translation, activateTranslation }), [locale, setLocale, catalogTranslator, translation, activateTranslation]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
