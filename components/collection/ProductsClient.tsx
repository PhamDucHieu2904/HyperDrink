'use client';

import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import LanguageSelector from '../LanguageSelector';
import { LanguageProvider, useLanguage } from '../LanguageProvider';
import { usePublishedCatalog } from '../usePublishedCatalog';
import { useTranslatedCatalog } from '../useTranslatedCatalog';
import { useStorefrontTelemetry } from '../useStorefrontTelemetry';
import { catalogProducts } from '@/lib/catalog/storefront';
import { collectionDrinkTypes, filterCollectionProducts, productPage } from '@/lib/catalog/collection';
import { publicUrl } from '@/lib/public-url';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { storefrontStatus } from '@/lib/i18n/storefront-status';
import CatalogCard from './CatalogCard';
import ProductDialog from './ProductDialog';
import { CollectionPager } from './CollectionRows';

export default function ProductsClient() { return <LanguageProvider><ProductsCatalog /></LanguageProvider>; }

function ProductsCatalog() {
  const { locale, t } = useLanguage();
  const track = useStorefrontTelemetry(locale);
  const copy = collectionCopy(locale);
  const status = storefrontStatus[locale];
  const { published, loading, error, refresh } = usePublishedCatalog();
  const data = useTranslatedCatalog(published?.catalog);
  const products = useMemo(() => data ? catalogProducts(data, 'catalog') : [], [data]);
  const types = useMemo(() => data ? collectionDrinkTypes(data, products) : [], [data, products]);
  const [drinkId, setDrink] = useState('');
  const [groupId, setGroup] = useState('');
  const [packagingId, setPackaging] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [detailId, setDetail] = useState('');
  const selectedGroup = products.find(product => product.group.id === groupId)?.group;
  const activeDrink = types.some(type => type.id === drinkId) ? drinkId : selectedGroup?.drinkTypeId || '';
  const groups = [...new Map(products.filter(product => !activeDrink || product.group.drinkTypeId === activeDrink).map(product => [product.group.id, product.group])).values()];
  const packaging = [...new Map(products.map(product => [product.packaging.id, product.packaging])).values()];
  const matches = useMemo(() => filterCollectionProducts(products.filter(product =>
    (!activeDrink || product.group.drinkTypeId === activeDrink) && (!selectedGroup || product.group.id === selectedGroup.id) &&
    (!packagingId || product.packaging.id === packagingId)), query, published?.catalog), [products, activeDrink, selectedGroup, packagingId, query, published?.catalog]);
  const result = productPage(matches, page, 12);
  const detail = products.find(product => product.variant.id === detailId);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => { setGroup(params.get('group') || ''); setDetail(params.get('product') || ''); });
  }, []);
  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(() => track('search_use'), 700);
    return () => window.clearTimeout(timer);
  }, [query, track]);
  const clear = () => { setDrink(''); setGroup(''); setPackaging(''); setQuery(''); setPage(0); };
  const pageControl = <CollectionPager label={t('nav.products')} page={result.page} totalPages={result.totalPages} onPage={setPage} />;

  return <main className="products-page" data-language={locale}>
    <a className="skip-link" href="#products-results">{t('nav.skip')}</a>
    <header className="products-header"><a className="products-brand" href={publicUrl('/')} aria-label={copy.back}><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 28.8C12.1 12.3 22.3 7.8 33.8 7.3c-1.7 10.7-7.5 19.2-19.2 21.3 3.4-4.4 6.6-7.4 12.4-10.9" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" /></svg><strong>VINUT</strong></a><nav aria-label={t('nav.label')}><a href={publicUrl('/')}>{t('nav.home')}</a><a href={`${publicUrl('/')}#collection`}>{t('nav.flavors')}</a><a href={publicUrl('/products/')} aria-current="page">{t('nav.products')}</a></nav><LanguageSelector open={languageOpen} onOpenChange={setLanguageOpen} /></header>
    <div className="products-intro"><a className="products-back" href={publicUrl('/')}><ArrowLeft size={16} />{copy.back}</a><p className="collection-kicker">{t('collection.kicker')}</p><h1>{copy.browse}</h1></div>
    <div className="products-layout"><aside className="products-sidebar"><nav aria-label={copy.drinkTypes}><h2>{copy.drinkTypes}</h2><button type="button" aria-pressed={!activeDrink} onClick={clear}>{copy.allDrinks}<span>{products.length}</span></button>{types.map(type => <button type="button" key={type.id} aria-pressed={type.id === activeDrink} onClick={() => { setDrink(type.id); setGroup(''); setPackaging(''); setPage(0); track('collection_open', type.id); }}><bdi>{type.name}</bdi><span>{products.filter(product => product.group.drinkTypeId === type.id).length}</span></button>)}</nav></aside>
      <section id="products-results" className="products-results" aria-label={t('nav.products')}>
        <div className="products-filters"><label className="products-search"><Search size={18} /><input type="search" aria-label={t('search.label')} placeholder={t('search.placeholder')} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><label><span>{copy.allLines}</span><select aria-label={copy.allLines} value={selectedGroup?.id || ''} onChange={event => { setGroup(event.target.value); setPage(0); }}><option value="">{copy.allLines}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.collectionTitle || group.buttonLabel || group.name}</option>)}</select></label><label><span>{t('collection.filter')}</span><select aria-label={t('collection.filter')} value={packagingId} onChange={event => { setPackaging(event.target.value); setPage(0); track('packaging_filter', event.target.value || 'all'); }}><option value="">{t('packaging.all')}</option>{packaging.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <div className="products-results-heading"><p aria-live="polite">{t(matches.length === 1 ? 'collection.countOne' : 'collection.count', { count: matches.length })}{selectedGroup && <span> · <bdi>{selectedGroup.collectionTitle || selectedGroup.buttonLabel || selectedGroup.name}</bdi></span>}</p>{pageControl}</div>
        {error && <div className="collection-empty" role="alert"><p>{status.refreshFailed}</p><button onClick={() => void refresh()} disabled={loading}>{status.retry}</button></div>}
        {data && result.items.length > 0 ? <div className="products-card-grid">{result.items.map(product => <CatalogCard key={product.variant.id} catalog={data} product={product} onView={item => { setDetail(item.variant.id); track('detail_open', item.variant.id); }} />)}</div> : <div className="collection-empty" role="status"><p>{loading ? status.loading : !products.length ? status.empty : t('collection.emptySearch')}</p>{products.length > 0 && <button type="button" onClick={clear}>{copy.clear}</button>}{!published && !loading && <button type="button" onClick={() => void refresh()}>{status.retry}</button>}</div>}
        {result.items.length > 0 && <div className="products-bottom-pager">{pageControl}</div>}
      </section>
    </div>
    <footer className="products-footer"><strong>VINUT</strong><p>{t('footer.copy')}</p></footer>
    {detail && data && <ProductDialog key={detail.variant.id} catalog={data} product={detail} onClose={() => setDetail('')} />}
  </main>;
}
