'use client';

import { useLanguage } from '../LanguageProvider';

/** The product area stays reserved while the viewer chunk, model and label load. */
export default function ViewerLoading() {
  const { t } = useLanguage();
  return <div className="catalog-viewer-loading" role="status" aria-live="polite" aria-atomic="true">
    <svg className="catalog-viewer-loading-mark" width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <circle cx="36" cy="36" r="28" className="catalog-viewer-loading-track" />
      <circle cx="36" cy="36" r="28" className="catalog-viewer-loading-stroke" />
      <path d="M27 34V41M36 28V44M45 31V38" className="catalog-viewer-loading-bars" />
    </svg>
    <span>{t('viewer.loading')}</span>
  </div>;
}
