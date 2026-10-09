'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Heart, Layers3, Leaf, Play, Rotate3D, Sparkles, Waves, X } from 'lucide-react';
import FlavorBackground from './FlavorBackground';
import { BackgroundRenderState } from '@/lib/background-render-state';
import { backgroundConfig, normalizeBackgroundConfig } from '@/lib/background-config';
import type { CatalogData } from '@/lib/catalog/contracts';
import { catalogProducts, resolveStorefrontSelection, type StorefrontSelectionRequest } from '@/lib/catalog/storefront';
import { mediaUrl, resolveFlavorFruitImage, resolveFlavorIcon } from '@/lib/catalog/resolve';
import { useLanguage } from './LanguageProvider';
import CatalogImage from './catalog-hero/CatalogImage';
import FlavorCarousel from './catalog-hero/FlavorCarousel';
import ProductVisual from './catalog-hero/ProductVisual';
import { heroCopy } from './catalog-hero/copy';
import { localizedHeroMessages } from '@/lib/i18n/storefront-marketing';
import { trackUsage } from '@/lib/operations/client';
import ProductDetailPanel from './product-detail/ProductDetailPanel';
import { publicUrl } from '@/lib/public-url';
import { mockupCopy } from '@/lib/i18n/mockup';
import GraphicsToggle, { useGraphicsMode } from './GraphicsToggle';

const backgroundSettings = normalizeBackgroundConfig(backgroundConfig);
const glassStyle = { backdropFilter: 'blur(28px) saturate(148%) brightness(1.04)', WebkitBackdropFilter: 'blur(28px) saturate(148%) brightness(1.04)' } as React.CSSProperties;
const featureGlassStyle = { backdropFilter: 'blur(32px) saturate(152%) brightness(1.04)', WebkitBackdropFilter: 'blur(32px) saturate(152%) brightness(1.04)' } as React.CSSProperties;

export interface ShowcaseHeroProps {
  catalog: CatalogData;
  releaseId: string;
  selection: StorefrontSelectionRequest;
  onSelectGroup: (id: string) => void;
  onSelectVariant: (id: string) => void;
  onExplore?: () => void;
}

export default function ShowcaseHero({ catalog, releaseId, selection, onSelectGroup, onSelectVariant, onExplore }: ShowcaseHeroProps) {
  const { locale, t } = useLanguage();
  const copy = heroCopy(locale);
  const graphicsMode = useGraphicsMode();
  const resolved = useMemo(() => resolveStorefrontSelection(catalog, selection), [catalog, selection]);
  const products = useMemo(() => catalogProducts(catalog), [catalog]);
  const { groups, group, slot, variants, variant, flavor, packaging } = resolved;
  const product = products.find(item => item.variant.id === variant?.id && item.slot.id === slot?.id);
  const resourceDisplays = useMemo(() => {
    if (!slot || slot.mode === '2d') return [];
    const productsByVariant = new Map(products.filter(item => item.slot.id === slot.id).map(item => [item.variant.id, item]));
    return variants.map(item => productsByVariant.get(item.id)?.display3d ?? null);
  }, [products, slot, variants]);
  const drink = catalog.drinkTypes.find(item => item.id === group?.drinkTypeId);
  const themes = useMemo(() => resolved.variants.map(item => {
    const itemFlavor = catalog.flavors.find(flavor => flavor.id === item.flavorId)!;
    const icon = resolveFlavorIcon(catalog, itemFlavor);
    return { id: item.id, color: itemFlavor.backgroundColor, icon: itemFlavor.icon, ...(icon ? { iconUrl: mediaUrl(icon) } : {}) };
  }), [catalog, resolved.variants]);
  const flavorIndex = Math.max(0, variants.findIndex(item => item.id === variant?.id));
  const [backgroundState] = useState(() => {
    const state = new BackgroundRenderState(backgroundSettings, themes);
    state.setFlavor(flavorIndex, 0, true);
    return state;
  });
  const [sessionSeed, setSessionSeed] = useState('public');
  const [likedVariant, setLikedVariant] = useState<string | null>(null);
  const [failedVisual, setFailedVisual] = useState('');
  const [detail, setDetail] = useState<'flavor' | 'collection' | null>(null);
  const [productDetailOpen, setProductDetailOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const productRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasProduct = Boolean(variant && flavor && packaging && slot && group);
  const renderKey = `${releaseId}:${variant?.id}:${product?.display3d?.revision ?? 0}`;
  const mode = slot?.mode === '2d' || !product?.display3d || failedVisual === renderKey ? '2D' : '3D';
  const carouselItems = variants.map(item => {
    const itemFlavor = catalog.flavors.find(flavor => flavor.id === item.flavorId)!;
    return { variantId: item.id, flavor: itemFlavor, fruitImage: resolveFlavorFruitImage(catalog, itemFlavor.id) };
  });
  const openDetail = (value:'flavor'|'collection') => {trackUsage('detail_open',value==='flavor'?variant?.id:group?.id);setDetail(value);};
  const explore = () => { trackUsage('collection_open'); if (onExplore) onExplore(); else openDetail('collection'); };

  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) setSessionSeed(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const hero = heroRef.current;
    const product = productRef.current;
    if (!hero || !product) return;
    const feature = hero.querySelector<HTMLElement>('.showcase-feature');
    const alignLight = () => {
      const area = hero.getBoundingClientRect();
      const bounds = product.getBoundingClientRect();
      hero.style.setProperty('--backlight-x', `${bounds.left - area.left + bounds.width / 2}px`);
      hero.style.setProperty('--backlight-y', `${bounds.top - area.top + bounds.height / 2}px`);
      hero.style.setProperty('--backlight-w', `${bounds.width * backgroundSettings.productGlowWidth}px`);
      hero.style.setProperty('--backlight-h', `${bounds.height * backgroundSettings.productGlowHeight}px`);
      // The featured card caps its width on wide desktops. Align the control
      // with its real left edge, using the existing resize-only layout read.
      if (feature) product.style.setProperty('--graphics-control-right', `${bounds.right - feature.getBoundingClientRect().left + 12}px`);
    };
    const observer = new ResizeObserver(alignLight);
    observer.observe(hero); observer.observe(product);
    if (feature) observer.observe(feature);
    alignLight();
    return () => observer.disconnect();
  }, [hasProduct]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (detail && !dialog?.open) dialog?.showModal();
    else if (!detail) dialog?.close();
  }, [detail, hasProduct]);

  const productPicker = <div className="model-picker" role="group" aria-label={t('nav.products')}>
    <span className="model-picker-label">{copy.bestSeller}</span>
    <div className="model-options">{groups.map(item => <button type="button" key={item.id} aria-pressed={item.id === group?.id} onClick={() => onSelectGroup(item.id)}><bdi>{item.buttonLabel || item.name}</bdi></button>)}</div>
  </div>;

  if (!group || !slot || !variant || !flavor || !packaging) return <section ref={heroRef} className="showcase-hero catalog-showcase catalog-showcase-empty" aria-labelledby="showcase-title">
    <div className="catalog-selection-empty" role="status"><Leaf size={48} strokeWidth={1} /><h1 id="showcase-title"><bdi>{group?.name || t('nav.products')}</bdi></h1><p>{copy.empty}</p></div>
    {groups.length > 0 && productPicker}
  </section>;

  const liked = likedVariant === variant.id;
  const productMessages = localizedHeroMessages(group, locale);
  return <section ref={heroRef} className="showcase-hero catalog-showcase" data-flavor={flavor.id} data-variant={variant.id} data-release={releaseId} aria-labelledby="showcase-title" style={{
    '--flavor-accent': flavor.accentColor,
    '--catalog-text': flavor.textColor,
    '--catalog-background': flavor.backgroundColor,
    '--product-glow-opacity': backgroundSettings.productGlowOpacity,
  } as React.CSSProperties}>
    <FlavorBackground flavorIndex={flavorIndex} themes={themes} renderState={backgroundState} config={backgroundSettings} />
    <div className="quick-rail glass-surface" style={glassStyle} aria-label={t('hero.shortcuts')}>
      <button type="button" aria-label={t('hero.discoverFlavor')} onClick={() => openDetail('flavor')} className="is-selected"><Leaf /></button>
      <button type="button" aria-label={t('hero.viewCollection')} onClick={explore}><Waves /></button>
      <button type="button" aria-label={t('hero.likeFlavor')} aria-pressed={liked} onClick={() => { if(!liked)trackUsage('favorite',variant.id); setLikedVariant(liked ? null : variant.id); }}><Heart fill={liked ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="showcase-copy showcase-intro">
      <p className="eyebrow"><bdi>{drink?.name || group.name}</bdi></p>
      <h1 id="showcase-title"><span className="showcase-title-desktop"><bdi>{group.name}</bdi></span><span className="showcase-title-mobile"><bdi>{variant.name}</bdi></span></h1>
      {group.description && <p className="showcase-tagline">{group.description}</p>}
      <div className="showcase-actions">
        <button type="button" className="btn btn-primary" onClick={explore}>{t('hero.explore')} <ArrowRight size={20} /></button>
        <button type="button" className="btn btn-ghost" onClick={() => openDetail('flavor')}><Play size={18} fill="currentColor" /> {t('nav.flavors')}</button>
      </div>
    </div>
    <div ref={productRef} className="showcase-product"><ProductVisual catalog={catalog} releaseId={releaseId} seed={sessionSeed} slot={slot} variant={variant} display3d={product?.display3d} display2d={product?.display2d} image2d={product?.image2d} model={product?.model} resourceDisplays={resourceDisplays} backgroundState={backgroundState} backgroundConfig={backgroundSettings} graphicsMode={graphicsMode} onViewerUnavailable={() => setFailedVisual(renderKey)} /><GraphicsToggle /></div>
    {productPicker}
    <FlavorCarousel items={carouselItems} selectedId={variant.id} onSelect={onSelectVariant} />
    <div className="showcase-details">
      <div className="notes-stack">
        <button type="button" className="notes-card glass-surface" style={glassStyle} onClick={() => openDetail('flavor')}>
          <CatalogImage media={product?.thumbnail} size={88} priority />
          <span><strong>{t('hero.notes')}</strong><span>{flavor.description || flavor.name}</span></span><ChevronRight />
        </button>
        <button type="button" className="notes-card glass-surface" style={glassStyle} onClick={() => openDetail('collection')}>
          <span className="catalog-notes-symbol" aria-hidden="true"><Layers3 size={38} strokeWidth={1.2} /></span>
          <span><strong><bdi>{group.name}</bdi></strong><span>{group.description || drink?.description || drink?.name}</span></span><ChevronRight />
        </button>
      </div>
      <div className="showcase-stats">
        <div className="glass-surface" style={glassStyle}><Sparkles /><span><strong dir="ltr">{packaging.volumeMl ?? '—'}<small> ml</small></strong><span>{copy.volume}</span></span></div>
        <a className="glass-surface showcase-mockup-link" style={glassStyle} href={publicUrl(`/mockup/${product?.display3d ? `?display=${encodeURIComponent(product.display3d.id)}` : ''}`)} aria-label={mockupCopy[locale].open}><Rotate3D aria-hidden="true" /><span><strong dir="ltr">{mode === '3D' ? '360°' : '2D'}</strong><span>{mode === '3D' ? t('hero.freeExplore') : copy.image}</span></span><ChevronRight className="showcase-mockup-arrow" size={16} aria-hidden="true" /></a>
      </div>
    </div>
    <aside className="showcase-feature glass-surface" style={featureGlassStyle} aria-label={t('hero.featured')}>
      <span className="showcase-badge" dir={locale === 'ar' ? 'rtl' : 'ltr'}>{copy.hot}</span>
      <div className="flavor-portrait-ring"><CatalogImage className="flavor-portrait" media={product?.thumbnail} alt={flavor.name} size={360} priority /></div>
      <h2><bdi>{flavor.name}</bdi></h2><p className="feature-subtitle"><bdi>{drink?.name}</bdi></p>
      <div className="showcase-metrics showcase-product-messages">
        <span><strong dir="ltr">{packaging.volumeMl ?? '—'}<small>ml</small></strong><bdi>{productMessages.volume}</bdi></span>
        <span className="showcase-product-message"><Sparkles size={22} strokeWidth={1.4} aria-hidden="true" /><bdi>{productMessages.flavors}</bdi></span>
        <span className="showcase-product-message"><Leaf size={22} strokeWidth={1.4} aria-hidden="true" /><bdi>{productMessages.origin}</bdi></span>
      </div>
      <p className="feature-description"><strong><bdi>{variant.name}</bdi></strong><span>{variant.description || flavor.description}</span></p>
      <button type="button" className="btn btn-primary" onClick={() => { trackUsage('detail_open', variant.id); setProductDetailOpen(true); }}>{t('hero.exploreFlavor', { flavor: flavor.shortName || flavor.name })} <ArrowRight size={20} /></button>
    </aside>
    {productDetailOpen && product && <ProductDetailPanel catalog={catalog} product={product} onClose={() => setProductDetailOpen(false)} />}
    <dialog ref={dialogRef} className="hero-detail glass-surface catalog-hero-detail" style={glassStyle} aria-label={t('hero.details')} onCancel={() => setDetail(null)} onClick={event => { if (event.target === event.currentTarget) setDetail(null); }}>
      <div className="catalog-hero-detail-header"><h2><bdi>{detail === 'flavor' ? flavor.name : group.name}</bdi></h2><button type="button" autoFocus className="catalog-detail-close" aria-label={t('common.close')} onClick={() => setDetail(null)}><X size={20} /></button></div>
      <div className="catalog-hero-detail-scroll">
      {(detail === 'flavor' ? flavor.description : group.description) && <p>{detail === 'flavor' ? flavor.description : group.description}</p>}
      <p className="catalog-detail-facts"><bdi>{drink?.name}</bdi><span aria-hidden="true"> · </span><bdi>{packaging.name}</bdi></p>
      <div className="catalog-dialog-flavors" role="group" aria-label={t('hero.chooseFlavor')}>{carouselItems.map(item => <button type="button" key={item.variantId} aria-pressed={item.variantId === variant.id} onClick={() => onSelectVariant(item.variantId)}><CatalogImage media={item.fruitImage} size={48} /><span><strong><bdi>{item.flavor.shortName || item.flavor.name}</bdi></strong>{item.flavor.description && <span>{item.flavor.description}</span>}</span></button>)}</div>
      <button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>{t('common.close')}</button>
      </div>
    </dialog>
  </section>;
}
