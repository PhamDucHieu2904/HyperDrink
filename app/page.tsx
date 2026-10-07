'use client';

import ShowcaseHero from '@/components/ShowcaseHero';
import BeverageCategoryRail from '@/components/BeverageCategoryRail';
import LanguageSelector from '@/components/LanguageSelector';
import ContactSection from '@/components/ContactSection';
import { storefrontMarketingCopy } from '@/lib/i18n/storefront-marketing';
import { LanguageProvider, useLanguage } from '@/components/LanguageProvider';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { collectionProducts, collectionSections, filterCollectionProducts } from '@/lib/catalog/collection';
import { publicUrl } from '@/lib/public-url';
import CollectionRows from '@/components/collection/CollectionRows';
import { storefrontStatus } from '@/lib/i18n/storefront-status';
import { usePublishedCatalog } from '@/components/usePublishedCatalog';
import { useTranslatedCatalog } from '@/components/useTranslatedCatalog';
import { useStorefrontTelemetry } from '@/components/useStorefrontTelemetry';
import { randomStorefrontEntry, resolveStorefrontSelection, type StorefrontSelectionRequest } from '@/lib/catalog/storefront';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Menu, Search, X } from 'lucide-react';


function BrandMark() {
  const { t } = useLanguage();
  return (
    <a className="brand-mark" href="#top" aria-label={t('nav.backToTop')}>
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 28.8C12.1 12.3 22.3 7.8 33.8 7.3c-1.7 10.7-7.5 19.2-19.2 21.3 3.4-4.4 6.6-7.4 12.4-10.9" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="brand-word">VINUT</span>
    </a>
  );
}

export default function HomePage() {
  return <LanguageProvider><Storefront /></LanguageProvider>;
}

function Storefront() {
  const { t, locale } = useLanguage();
  const track = useStorefrontTelemetry(locale);
  const copy = storefrontStatus[locale];
  const collectionText = collectionCopy(locale);
  const marketingText = storefrontMarketingCopy(locale);
  const { published, loading, error, refresh } = usePublishedCatalog();
  const usingSnapshotFallback = published?.source === 'static' && process.env.NEXT_PUBLIC_CATALOG_MODE !== 'static';
  const data = useTranslatedCatalog(published?.catalog);
  const [selection, setSelection] = useState<StorefrontSelectionRequest>({});
  const [entryReady, setEntryReady] = useState(false);
  const entryInitialized = useRef(false);
  const current = useMemo(() => data ? resolveStorefrontSelection(data, selection) : null, [data, selection]);
  const products = useMemo(() => data ? collectionProducts(data) : [], [data]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    const catalog = published?.catalog;
    if (!catalog || entryInitialized.current) return;
    let live = true;
    queueMicrotask(() => {
      if (!live || entryInitialized.current) return;
      entryInitialized.current = true;
      const sample = Math.random();
      setSelection(previous => randomStorefrontEntry(catalog, previous, sample));
      setEntryReady(true);
    });
    return () => { live = false; };
  }, [published?.catalog]);

  const visibleProducts = useMemo(() => filterCollectionProducts(products, searchQuery, published?.catalog), [products, searchQuery, published?.catalog]);
  const sections = useMemo(() => data ? collectionSections(data, visibleProducts) : [], [data, visibleProducts]);

  useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);
  useEffect(() => {
    if(!searchOpen||!searchQuery.trim())return;
    const timer=window.setTimeout(()=>track('search_use'),700);
    return()=>window.clearTimeout(timer);
  },[searchOpen,searchQuery,track]);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main id="main-content" className="site-shell" data-language={locale}>
      <a className="skip-link" href="#collection">{t('nav.skip')}</a>
      <header id="top" className="site-header">
        <BrandMark />
        <nav id="primary-navigation" className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label={t('nav.label')}>
          <a className="nav-link" aria-current="page" href="#top" onClick={() => setMenuOpen(false)}>{t('nav.home')}</a>
          <a className="nav-link" href="#collection" onClick={() => setMenuOpen(false)}>{t('nav.flavors')}</a>
          <a className="nav-link" href={publicUrl('/products/')} onClick={() => setMenuOpen(false)}>{t('nav.products')}</a>
          <a className="nav-link" href="#contact" onClick={() => setMenuOpen(false)}>{t('nav.contact')}</a>
        </nav>
        <BeverageCategoryRail />
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label={searchOpen ? t('search.close') : t('search.open')} aria-expanded={searchOpen} onClick={() => { if(!searchOpen)track('search_open'); setLanguageOpen(false); setMenuOpen(false); setSearchOpen((open) => !open); }}>{searchOpen ? <X /> : <Search />}</button>
          <LanguageSelector open={languageOpen} onOpenChange={open => { setLanguageOpen(open); if (open) { setSearchOpen(false); setMenuOpen(false); } }} />
          <button type="button" className="icon-btn menu-toggle" aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => { if(!menuOpen)track('menu_open'); setLanguageOpen(false); setSearchOpen(false); setMenuOpen((open) => !open); }}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
        {searchOpen && (
          <form className="search-popover" role="search" onSubmit={(event) => { event.preventDefault(); scrollTo('collection'); }}>
            <Search size={17} aria-hidden="true" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus placeholder={t('search.placeholder')} aria-label={t('search.label')} />
            <kbd>ESC</kbd>
          </form>
        )}
      </header>

      {data && published && entryReady ? <ShowcaseHero catalog={data} releaseId={published.releaseId} selection={selection}
        onSelectGroup={id => { track('group_select',id); setSelection({ groupId: id }); }}
        onSelectVariant={id => { track('flavor_select',id); setSelection({ groupId: current?.group?.id, slotId: current?.slot?.id, variantId: id }); }}
        onExplore={() => scrollTo('collection')} /> : <section className="catalog-placeholder" aria-busy={loading || Boolean(data && !entryReady)}>
        <p role={error ? 'alert' : 'status'}>{loading || (data && !entryReady) ? copy.loading : error ? copy.unavailable : copy.empty}</p>
        {!loading && <button type="button" className="btn btn-primary" onClick={() => void refresh()}>{copy.retry}</button>}
      </section>}
      {published && (error || usingSnapshotFallback) && <div className="catalog-update-notice" role="status"><span>{copy.refreshFailed}</span><button type="button" disabled={loading} onClick={() => void refresh()}>{copy.retry}</button></div>}

      <section id="collection" className="section collection-section" aria-labelledby="collection-title">
        <div className="section-heading">
          <div><p className="section-kicker">{t('collection.kicker')}</p><h2 id="collection-title" className="section-title">{t('collection.title')}</h2></div>
          <div className="collection-heading-end"><p className="section-description">{t('collection.copy')}</p><a className="collection-see-all" href={publicUrl('/products/')}>{collectionText.allProducts}<ArrowRight size={18} /></a></div>
        </div>
        {data && sections.length > 0 ? <CollectionRows catalog={data} sections={sections} /> : <p className="collection-empty" role="status">{!published ? (loading ? copy.loading : error ? copy.unavailable : copy.empty) : !products.length || !searchQuery.trim() ? copy.empty : t('collection.emptySearch')}</p>}
      </section>

      <ContactSection catalog={data} />

      <footer className="site-footer"><span className="footer-brand">VINUT</span><span>{t('footer.copy')}</span><div className="footer-links"><a href={publicUrl('/products/')}>{t('nav.products')}</a><a href="#contact">{t('nav.contact')}</a><a href="mailto:hello@vinut.com">{marketingText.emailCta}</a></div></footer>
    </main>
  );
}

