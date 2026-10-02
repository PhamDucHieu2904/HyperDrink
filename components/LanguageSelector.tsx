'use client';

import { Check, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { findLanguages, languages } from '@/lib/i18n/catalog';
import { useLanguage } from './LanguageProvider';

export default function LanguageSelector({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale, setLocale, t } = useLanguage();
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const choices = findLanguages(query);
  const current = languages.find(language => language.code === locale)!;
  const close = (restoreFocus = false) => {
    onOpenChange(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false); };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);

  return <div ref={rootRef} className="language-selector" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onOpenChange(false);
  }} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-language-option]') ?? []);
    const index = options.indexOf(event.target as HTMLButtonElement);
    if (event.target === searchRef.current && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    if (index < 0 && event.target !== searchRef.current) return;
    if (!options.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowUp' ? (index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length) : (index + 1) % options.length;
    options[next].focus();
  }}>
    <button ref={triggerRef} type="button" className="icon-btn language-trigger" aria-label={`${locale.toUpperCase()} — ${t('language.open')}`}
      title={t('language.current', { language: current.nativeName })} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`}
      onClick={() => { setQuery(''); onOpenChange(!open); }}><span className="language-trigger-code" aria-hidden="true" lang="en" dir="ltr">{locale.toUpperCase()}</span></button>
    {open && <div id={`${id}-panel`} className="language-popover" role="dialog" aria-labelledby={`${id}-title`}>
      <div className="language-popover-heading"><h2 id={`${id}-title`}>{t('language.title')}</h2>
        <button type="button" className="language-close" aria-label={t('language.close')} onClick={() => close(true)}><X size={18} aria-hidden="true" /></button></div>
      <label htmlFor={`${id}-search`} className="language-search-label">{t('language.search')}</label>
      <div className="language-search"><Search size={17} aria-hidden="true" /><input ref={searchRef} id={`${id}-search`} type="search"
        autoComplete="off" spellCheck={false} placeholder={t('language.placeholder')} value={query} onChange={event => setQuery(event.target.value)} /></div>
      <ul className="language-options" aria-label={t('language.title')}>
        {choices.map(language => <li key={language.code}><button type="button" data-language-option aria-pressed={locale === language.code}
          onClick={() => { setLocale(language.code); close(true); }}>
          <span className="language-code" aria-hidden="true">{language.code.toUpperCase()}</span>
          <span className="language-names"><strong lang={language.code}>{language.nativeName}</strong><span>{language.name}</span></span>
          {locale === language.code && <Check size={18} aria-label={t('language.selected')} />}
        </button></li>)}
      </ul>
      {!choices.length && <p className="language-empty" role="status">{t('language.empty')}</p>}
    </div>}
  </div>;
}
