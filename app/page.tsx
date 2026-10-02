'use client';

import ShowcaseHero from '@/components/ShowcaseHero';
import BeverageCategoryRail from '@/components/BeverageCategoryRail';
import LanguageSelector from '@/components/LanguageSelector';
import { LanguageProvider, useLanguage } from '@/components/LanguageProvider';
import { normalizeSearch } from '@/lib/i18n/catalog';
import { storefrontStatus } from '@/lib/i18n/storefront-status';
import { usePublishedCatalog } from '@/components/usePublishedCatalog';
import { catalogProducts, resolveStorefrontSelection, type StorefrontSelectionRequest } from '@/lib/catalog/storefront';
import { mediaUrl } from '@/lib/catalog/resolve';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Menu, Search, X } from 'lucide-react';


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
  const copy = storefrontStatus[locale];
  const { published, loading, error, refresh } = usePublishedCatalog();
  const usingSnapshotFallback = published?.source === 'static' && process.env.NEXT_PUBLIC_CATALOG_MODE !== 'static';
  const data = published?.catalog;
  const [selection, setSelection] = useState<StorefrontSelectionRequest>({});
  const current = useMemo(() => data ? resolveStorefrontSelection(data, selection) : null, [data, selection]);
  const products = useMemo(() => data ? catalogProducts(data) : [], [data]);
  const [filter, setFilter] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const categories = useMemo(() => [...new Map(products.map(product => [product.category.id, product.category])).values()].sort((a, b) => a.position - b.position), [products]);

  const visibleProducts = useMemo(() => {
    const byPacking = products.filter(product =>
      filter === 'all' || !categories.some(category => category.id === filter) || product.category.id === filter);
    const query = normalizeSearch(searchQuery);
    if (!query) return byPacking;
    return byPacking.filter(product => normalizeSearch([product.variant.name, product.variant.code, product.variant.description,
      product.group.name, product.flavor.name, product.flavor.shortName, product.flavor.description,
      product.packaging.name, product.packaging.volumeMl, product.category.name,
      data?.drinkTypes.find(type => type.id === product.group.drinkTypeId)?.name].join(' ')).includes(query));
  }, [products, categories, filter, searchQuery, data]);

  useEffect(() => {
    if (!searchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

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
          <a className="nav-link" href="#collection" onClick={() => setMenuOpen(false)}>{t('nav.products')}</a>
          <a className="nav-link" href="#story" onClick={() => setMenuOpen(false)}>{t('nav.story')}</a>
        </nav>
        <BeverageCategoryRail />
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label={searchOpen ? t('search.close') : t('search.open')} aria-expanded={searchOpen} onClick={() => { setLanguageOpen(false); setMenuOpen(false); setSearchOpen((open) => !open); }}>{searchOpen ? <X /> : <Search />}</button>
          <LanguageSelector open={languageOpen} onOpenChange={open => { setLanguageOpen(open); if (open) { setSearchOpen(false); setMenuOpen(false); } }} />
          <button type="button" className="icon-btn menu-toggle" aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => { setLanguageOpen(false); setSearchOpen(false); setMenuOpen((open) => !open); }}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
        {searchOpen && (
          <form className="search-popover" role="search" onSubmit={(event) => { event.preventDefault(); scrollTo('collection'); }}>
            <Search size={17} aria-hidden="true" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus placeholder={t('search.placeholder')} aria-label={t('search.label')} />
            <kbd>ESC</kbd>
          </form>
        )}
      </header>

      {data && published ? <ShowcaseHero catalog={data} releaseId={published.releaseId} selection={selection}
        onSelectGroup={id => setSelection({ groupId: id })}
        onSelectVariant={id => setSelection({ groupId: current?.group?.id, slotId: current?.slot?.id, variantId: id })}
        onExplore={() => scrollTo('collection')} /> : <section className="catalog-placeholder" aria-busy={loading}>
        <p role={error ? 'alert' : 'status'}>{loading ? copy.loading : error ? copy.unavailable : copy.empty}</p>
        {!loading && <button type="button" className="btn btn-primary" onClick={() => void refresh()}>{copy.retry}</button>}
      </section>}
      {published && (error || usingSnapshotFallback) && <div className="catalog-update-notice" role="status"><span>{copy.refreshFailed}</span><button type="button" disabled={loading} onClick={() => void refresh()}>{copy.retry}</button></div>}

      <section id="collection" className="section" aria-labelledby="collection-title">
        <div className="section-heading">
          <div><p className="section-kicker">{t('collection.kicker')}</p><h2 id="collection-title" className="section-title">{t('collection.title')}</h2></div>
          <p className="section-description">{t('collection.copy')}</p>
        </div>
        <div className="catalog-controls">
          <div className="filter-group" role="group" aria-label={t('collection.filter')}>
            <button type="button" className="filter-btn" aria-pressed={filter === 'all' || !categories.some(category => category.id === filter)} onClick={() => setFilter('all')}>{t('packaging.all')}</button>
            {categories.map(item => <button type="button" key={item.id} className="filter-btn" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.name}</button>)}
          </div>
          <span className="catalog-count" aria-live="polite">{t(visibleProducts.length === 1 ? 'collection.countOne' : 'collection.count', { count: visibleProducts.length })}</span>
        </div>
        <div className="product-grid" aria-live="polite">
          {visibleProducts.length > 0 ? visibleProducts.map((product) => (
            <article key={product.variant.id} className="product-card catalog-product-card">
              <button type="button" className="catalog-product-link" onClick={() => {
                setSelection({ groupId: product.group.id, slotId: product.slot.id, variantId: product.variant.id });
                scrollTo('top');
              }}>
                <div className="product-art" style={{ '--catalog-accent': product.flavor.accentColor } as React.CSSProperties}>
                  {(product.image2d || product.thumbnail) ? <Image unoptimized width={512} height={280} sizes="(max-width:760px) 46vw, 23vw" className="catalog-card-image" src={mediaUrl(product.image2d || product.thumbnail)} alt={product.flavor.name} /> : <span>{product.flavor.shortName || product.flavor.name}</span>}
                  {!product.image2d && product.thumbnail && <span className="catalog-artwork-caption">{copy.artwork}</span>}
                </div>
                <h3>{product.variant.name}</h3>
                <p className="product-meta">{product.flavor.shortName || product.flavor.name} · <bdi>{product.packaging.volumeMl ? `${product.packaging.volumeMl} ml` : product.packaging.name}</bdi></p>
                <div className="product-footer"><span className="product-tag">{product.group.buttonLabel || product.group.name}</span><span className="product-arrow" aria-hidden="true"><ArrowRight size={15} /></span></div>
              </button>
            </article>
          )) : <p className="empty-state">{!published ? (loading ? copy.loading : error ? copy.unavailable : copy.empty) : !products.length ? copy.empty : t('collection.emptySearch')}</p>}
        </div>
      </section>

      <section id="story" className="section" aria-labelledby="story-title">
        <div className="experience-strip">
          <div className="experience-visual"><div className="can-fallback" aria-hidden="true" /></div>
          <div className="experience-copy">
            <p className="section-kicker">{t('story.kicker')}</p>
            <h2 id="story-title">{t('story.titleFirst')}<br />{t('story.titleSecond')}</h2>
            <p>{t('story.copy')}</p>
            <ul className="bullet-list">
              <li><Check size={16} aria-hidden="true" /> {t('story.packaging')}</li>
              <li><Check size={16} aria-hidden="true" /> {t('story.data')}</li>
              <li><Check size={16} aria-hidden="true" /> {t('story.interactive')}</li>
            </ul>
            <button type="button" className="btn btn-ghost" onClick={() => scrollTo('collection')}>{t('story.viewAll')} <ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      <footer className="site-footer"><span className="footer-brand">VINUT</span><span>{t('footer.copy')}</span><div className="footer-links"><a href="#collection">{t('nav.products')}</a><a href="#story">{t('nav.story')}</a><a href="mailto:hello@vinut.com">{t('nav.contact')}</a></div></footer>
    </main>
  );
}

