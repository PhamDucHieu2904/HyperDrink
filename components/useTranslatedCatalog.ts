'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CatalogData } from '@/lib/catalog/contracts';
import type { Locale } from '@/lib/i18n/catalog';
import { localizeCatalog } from '@/lib/i18n/dynamic-catalog';
import { useLanguage } from './LanguageProvider';

export function useTranslatedCatalog(catalog: CatalogData | undefined) {
  const { locale, catalogTranslator } = useLanguage();
  const [snapshot, setSnapshot] = useState<{ catalog: CatalogData; locale: Locale; translations: Map<string, string> } | null>(null);
  useEffect(() => {
    if (!catalog) return;
    let controller = new AbortController();
    const translate = () => {
      controller.abort(); controller = new AbortController();
      const request = controller;
      void catalogTranslator.translate(catalog, locale, request.signal, translations => {
        if (!request.signal.aborted) setSnapshot({ catalog, locale, translations });
      }).catch(() => { /* Source copy stays visible when the browser cannot translate. */ });
    };
    translate();
    const unsubscribe = catalogTranslator.onActivation(translate);
    return () => { controller.abort(); unsubscribe(); };
  }, [catalog, locale, catalogTranslator]);
  return useMemo(() => catalog && snapshot?.catalog === catalog && snapshot.locale === locale ? localizeCatalog(catalog, snapshot.translations) : catalog, [catalog, snapshot, locale]);
}
