'use client';

import ShowcaseHero from '@/components/ShowcaseHero';
import BeverageCategoryRail from '@/components/BeverageCategoryRail';
import LanguageSelector from '@/components/LanguageSelector';
import ContactSection from '@/components/ContactSection';
import WhyChooseSection from '@/components/WhyChooseSection';
import FavoritesPanel from '@/components/favorites/FavoritesPanel';
import FavoritesTrigger from '@/components/favorites/FavoritesTrigger';
import { storefrontMarketingCopy } from '@/lib/i18n/storefront-marketing';
import { LanguageProvider, useLanguage } from '@/components/LanguageProvider';
import { collectionProducts, collectionSections, filterCollectionProducts } from '@/lib/catalog/collection';
import { publicUrl } from '@/lib/public-url';
import CollectionRows from '@/components/collection/CollectionRows';
import FeaturedBanner from '@/components/collection/FeaturedBanner';
import { storefrontStatus } from '@/lib/i18n/storefront-status';
import { usePublishedCatalog } from '@/components/usePublishedCatalog';
import { useTranslatedCatalog } from '@/components/useTranslatedCatalog';
import { useStorefrontTelemetry } from '@/components/useStorefrontTelemetry';
import { randomStorefrontEntry, resolveStorefrontSelection, type StorefrontSelectionRequest } from '@/lib/catalog/storefront';
import { mediaUrl, resolveFlavorIcon } from '@/lib/catalog/resolve';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Image from 'next/image';


function BrandMark() {
  const { t } = useLanguage();
  const logo = publicUrl('/assets/branding/vinut-logo.svg');
  return (
    <a className="brand-mark" href="#top" aria-label={t('nav.backToTop')}>
      <span className="brand-logo" aria-hidden="true" style={{ '--brand-logo-mask': `url("${logo}")` } as React.CSSProperties}>
        <Image src={logo} alt="" width={968} height={492} loading="eager" unoptimized />
        <span className="brand-logo-shine" />
      </span>
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
  const [favoritesOpen, setFavoritesOpen] = useState(false);

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
  // Keep banner slots attached to their rows even when search hides another collection.
  const bannerCollectionIds = useMemo(() => data ? collectionSections(data, products).slice(0, 2).map(section => section.group.id) : [], [data, products]);

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
          <a className="nav-link" href={publicUrl('/mockup/')} onClick={() => setMenuOpen(false)}>Mockup Side</a>
          <a className="nav-link" href={publicUrl('/products/')} onClick={() => setMenuOpen(false)}>{t('nav.products')}</a>
          <a className="nav-link" href="#contact" onClick={() => setMenuOpen(false)}>{t('nav.contact')}</a>
        </nav>
        <BeverageCategoryRail />
        <div className="header-actions">
          <FavoritesTrigger className="icon-btn" open={favoritesOpen} onOpen={() => { setLanguageOpen(false); setMenuOpen(false); setSearchOpen(false); setFavoritesOpen(true); }} />
          <button type="button" className="icon-btn" aria-label={searchOpen ? t('search.close') : t('search.open')} aria-expanded={searchOpen} onClick={() => { if(!searchOpen)track('search_open'); setLanguageOpen(false); setMenuOpen(false); setSearchOpen((open) => !open); }}>{searchOpen ? <X /> : <Search />}</button>
          <LanguageSelector open={languageOpen} onOpenChange={open => { setLanguageOpen(open); if (open) { setSearchOpen(false); setMenuOpen(false); } }} />
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
        favoritesOpen={favoritesOpen} onFavoritesOpen={() => setFavoritesOpen(true)}
        onSelectGroup={id => { track('group_select',id); setSelection({ groupId: id }); }}
        onSelectVariant={id => { track('flavor_select',id); setSelection({ groupId: current?.group?.id, slotId: current?.slot?.id, variantId: id }); }}
        onExplore={() => scrollTo('collection')} /> : <section className="catalog-placeholder" aria-busy={loading || Boolean(data && !entryReady)}>
        <p role={error ? 'alert' : 'status'}>{loading || (data && !entryReady) ? copy.loading : error ? copy.unavailable : copy.empty}</p>
        {!loading && <button type="button" className="btn btn-primary" onClick={() => void refresh()}>{copy.retry}</button>}
      </section>}
      {published && (error || usingSnapshotFallback) && <div className="catalog-update-notice" role="status"><span>{copy.refreshFailed}</span><button type="button" disabled={loading} onClick={() => void refresh()}>{copy.retry}</button></div>}

      <section id="collection" className="section collection-section" aria-label={t('collection.title')}>
        {data && sections.length > 0 ? <CollectionRows catalog={data} sections={sections} beforeSection={section => {
          const placement = section.group.id === bannerCollectionIds[0] ? 'home-1' : section.group.id === bannerCollectionIds[1] ? 'home-2' : null;
          return placement ? <FeaturedBanner catalog={data} sections={sections} placement={placement} /> : null;
        }} /> : <p className="collection-empty" role="status">{!published ? (loading ? copy.loading : error ? copy.unavailable : copy.empty) : !products.length || !searchQuery.trim() ? copy.empty : t('collection.emptySearch')}</p>}
      </section>

      <WhyChooseSection />

      <ContactSection catalog={data} flavorColor={current?.flavor?.backgroundColor} flavorAccent={current?.flavor?.accentColor} flavorIcon={current?.flavor?.icon} flavorIconUrl={data && current?.flavor ? mediaUrl(resolveFlavorIcon(data, current.flavor)) || undefined : undefined} />

      <footer className="site-footer"><span className="footer-brand">VINUT</span><span>{t('footer.copy')}</span><div className="footer-links"><a href={publicUrl('/products/')}>{t('nav.products')}</a><a href="#contact">{t('nav.contact')}</a><a href="mailto:hello@vinut.com">{marketingText.emailCta}</a></div></footer>
      {favoritesOpen && <FavoritesPanel catalog={data} products={products} onClose={() => setFavoritesOpen(false)} />}
    </main>
  );
}

