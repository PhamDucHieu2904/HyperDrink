'use client';

import Image from 'next/image';
import { ArrowRight, ChevronLeft, ChevronRight, Droplets, Leaf } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CatalogData, MediaAsset } from '@/lib/catalog/contracts';
import type { CollectionSection } from '@/lib/catalog/collection';
import { FEATURED_SLIDE_INTERVAL, featuredBannerSlides, featuredSlideIndex, managedBannerSlides, type FeaturedSlide, type ManagedBannerSlide } from '@/lib/catalog/featured-banner';
import { featuredBannerCopy } from '@/lib/i18n/featured-banner';
import { catalogLandingTitle } from '@/lib/i18n/catalog-landing';
import { collectionCopy } from '@/lib/i18n/collection-copy';
import { mediaUrl } from '@/lib/catalog/resolve';
import { publicUrl } from '@/lib/public-url';
import { useLanguage } from '../LanguageProvider';

function Cutout({ media, className }: { media: MediaAsset; className: string }) {
  const [x0, y0, x1, y1] = media.imageBounds || [0, 0, 1, 1];
  const width = Math.max(0.01, x1 - x0), height = Math.max(0.01, y1 - y0);
  return <span className={`featured-cutout ${className}`} style={{ '--cutout-ratio': ((media.width || 1) * width) / ((media.height || 1) * height) } as CSSProperties}>
    <Image unoptimized src={mediaUrl(media)} alt="" width={media.width || 600} height={media.height || 600} loading="lazy" style={{ width: `${100 / width}%`, height: `${100 / height}%`, left: `${-x0 / width * 100}%`, top: `${-y0 / height * 100}%` }} />
  </span>;
}

function BannerArt({ slide, ready }: { slide: FeaturedSlide; ready: boolean }) {
  return <div className="featured-art" aria-hidden="true">
    {ready && <>
    <span className="featured-art-halo" />
    <Image className="featured-splash" src={publicUrl('/assets/scene/water-splash-user.webp')} width={1100} height={1100} alt="" loading="lazy" unoptimized />
    {slide.leaves[0] && <Cutout className="featured-leaf featured-leaf-back" media={slide.leaves[0]} />}
    {slide.fruit[0] && <Cutout className="featured-fruit featured-fruit-back" media={slide.fruit[0]} />}
    <Image className={`featured-can${slide.cutout ? '' : ' featured-can-flat'}`} src={slide.image} width={604} height={1100} alt="" loading="lazy" unoptimized />
    {slide.fruit[1] && <Cutout className="featured-fruit featured-fruit-right" media={slide.fruit[1]} />}
    {slide.fruit[2] && <Cutout className="featured-fruit featured-fruit-front" media={slide.fruit[2]} />}
    {slide.leaves[1] && <Cutout className="featured-leaf featured-leaf-front" media={slide.leaves[1]} />}
    {slide.ice && <Cutout className="featured-ice" media={slide.ice} />}
    {slide.leaves[0] && <Cutout className="featured-leaf featured-leaf-canopy" media={slide.leaves[0]} />}
    </>}
  </div>;
}

function Carousel({ slides, surface }: { slides: FeaturedSlide[]; surface: 'home' | 'catalog' }) {
  const { locale, t } = useLanguage();
  const copy = featuredBannerCopy(locale), navigation = collectionCopy(locale);
  const [titleFirst, titleSecond] = catalogLandingTitle(locale);
  const root = useRef<HTMLElement>(null);
  const [cursor, setCursor] = useState(0);
  const [snap, setSnap] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = slides.length;
  const active = featuredSlideIndex(cursor, count);
  const playing = count > 1 && visible && documentVisible && !hovered && !focused;

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    // Below-fold artwork only starts fetching when the customer reaches this section.
    const prepare = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { setNearby(true); prepare.disconnect(); } });
    const observe = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { threshold: 0.25 });
    prepare.observe(node); observe.observe(node);
    const onVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    onVisibility(); document.addEventListener('visibilitychange', onVisibility);
    return () => { prepare.disconnect(); observe.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setCursor(position => position >= count ? 1 : position + 1), FEATURED_SLIDE_INTERVAL);
    return () => window.clearInterval(timer);
  }, [playing, count]);

  useEffect(() => {
    if (!snap) return;
    const frame = requestAnimationFrame(() => { const next = requestAnimationFrame(() => setSnap(false)); pending.current = next; });
    const pending = { current: frame };
    return () => cancelAnimationFrame(pending.current);
  }, [snap]);

  // A duplicate first slide lets the final slide travel left before resetting invisibly.
  const track = count > 1 ? [...slides, slides[0]] : slides;
  const select = (index: number) => { setSnap(false); setCursor(featuredSlideIndex(index, count)); };
  return <section ref={root} className={`featured-banner${surface === 'catalog' ? ' featured-banner-catalog' : ''}`} aria-label={copy.label} aria-roledescription="carousel" dir="ltr"
    data-slide={active} data-playing={playing} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); select(active + (event.key === 'ArrowRight' ? 1 : -1)); } }}>
    <div className="featured-viewport">
      <div className={`featured-track${snap ? ' featured-track-snap' : ''}`} style={{ transform: `translate3d(${-cursor * 100}%,0,0)` }}
        onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform' && cursor === count) { setSnap(true); setCursor(0); } }}>
        {track.map((slide, index) => {
          const name = slide.product.flavor.shortName || slide.product.variant.name;
          const current = index === cursor;
          const title = slide.product.group.drinkTypeId === 'juice' ? copy.title.replace('{flavor}', name) : name;
          return <article key={`${slide.product.variant.id}:${index}`} className="featured-slide" style={{ '--featured-color': slide.color } as CSSProperties}
            role="group" aria-roledescription="slide" aria-label={`${index % count + 1} / ${count}: ${name}`} aria-hidden={!current} inert={!current}>
            <div className="featured-copy" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
              <p className="featured-eyebrow">{surface === 'catalog' ? t('collection.kicker') : copy.featured}<span aria-hidden="true" /></p>
              {surface === 'catalog' ? <h1 className="catalog-banner-title"><span>{titleFirst}</span><span>{titleSecond}</span></h1> : <h2><bdi>{title}</bdi></h2>}
              <p className="featured-tagline">{copy.tagline}</p>
              <p className="featured-description">{copy.description.replace('{flavor}', name).replace('{collection}', slide.product.group.buttonLabel || slide.product.group.name)}</p>
              <a className="featured-cta" href={slide.href} tabIndex={current ? 0 : -1}>{copy.discover.replace('{flavor}', name)}<ArrowRight size={20} aria-hidden="true" /></a>
              <div className="featured-benefits"><span><i><Leaf size={21} aria-hidden="true" /></i>{copy.flavor}</span><span><i><Droplets size={21} aria-hidden="true" /></i>{copy.ready}</span><span className="featured-volume"><i>{slide.product.packaging.volumeMl || '✓'}</i>{navigation.netContent}{slide.product.packaging.volumeMl ? ' · ml' : ''}</span></div>
            </div>
            <BannerArt slide={slide} ready={nearby} />
          </article>;
        })}
      </div>
    </div>
    {count > 1 && <>
      <button className="featured-arrow featured-previous" type="button" aria-label={`${navigation.previous}: ${copy.label}`} onClick={() => select(active - 1)}><ChevronLeft size={23} aria-hidden="true" /></button>
      <button className="featured-arrow featured-next" type="button" aria-label={`${navigation.next}: ${copy.label}`} onClick={() => select(active + 1)}><ChevronRight size={23} aria-hidden="true" /></button>
      <div className="featured-controls"><div className="featured-dots" aria-label={copy.label}>{slides.map((slide, index) => <button type="button" key={slide.product.variant.id} aria-label={copy.slide.replace('{flavor}', slide.product.flavor.shortName || slide.product.variant.name)} aria-current={active === index ? 'true' : undefined} onClick={() => select(index)}><span /></button>)}</div></div>
    </>}
  </section>;
}

function ManagedCarousel({ slides }: { slides: ManagedBannerSlide[] }) {
  const root = useRef<HTMLElement>(null);
  const [cursor, setCursor] = useState(0);
  const [snap, setSnap] = useState(false);
  const count = slides.length;
  useEffect(() => { if (count < 2) return; const timer = window.setInterval(() => setCursor(value => value >= count ? 1 : value + 1), FEATURED_SLIDE_INTERVAL); return () => window.clearInterval(timer); }, [count]);
  if (!count) return null;
  const track = count > 1 ? [...slides, slides[0]] : slides;
  const active = cursor % count;
  return <section ref={root} className="featured-banner featured-banner-managed" aria-label="Banner" aria-roledescription="carousel" data-slide={active}>
    <div className="featured-viewport"><div className={`featured-track${snap ? ' featured-track-snap' : ''}`} style={{ transform: `translate3d(${-cursor * 100}%,0,0)` }} onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform' && cursor === count) { setSnap(true); requestAnimationFrame(() => requestAnimationFrame(() => { setCursor(0); setSnap(false); })); } }}>
      {track.map((slide, index) => <article className="featured-slide featured-slide-image" key={`${slide.id}-${index}`} aria-hidden={index !== cursor} inert={index !== cursor}><Image src={slide.image} alt={slide.alt} fill sizes="100vw" priority={index === 0} unoptimized /></article>)}
    </div></div>
  </section>;
}

export default function FeaturedBanner({ catalog, sections, surface = 'home' }: { catalog: CatalogData; sections: CollectionSection[]; surface?: 'home' | 'catalog' }) {
  const managed = useMemo(() => managedBannerSlides(catalog), [catalog]);
  const slides = useMemo(() => featuredBannerSlides(catalog, sections), [catalog, sections]);
  if (managed.length) return <ManagedCarousel key={managed.map(slide => slide.id).join('|')} slides={managed} />;
  return slides.length ? <Carousel key={slides.map(slide => slide.product.variant.id).join('|')} slides={slides} surface={surface} /> : null;
}
