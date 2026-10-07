'use client';

import Image from 'next/image';
import { ArrowUpRight, Leaf, MapPin, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CatalogData, ProductDetail } from '@/lib/catalog/contracts';
import type { StorefrontProduct } from '@/lib/catalog/storefront';
import { mediaUrl, resolveFlavorFruitImage } from '@/lib/catalog/resolve';
import { productDetailPoster, resolveProductDetail } from '@/lib/catalog/product-detail';
import { productDetailCopy } from '@/lib/i18n/product-detail-copy';
import { useLanguage } from '../LanguageProvider';
import CatalogProductImage from '../collection/CatalogProductImage';
import InspectableProductImage from '../collection/InspectableProductImage';
import styles from './product-detail.module.css';

type DetailTab = 'story' | 'ingredients' | 'nutrition';
const tabs: DetailTab[] = ['story', 'ingredients', 'nutrition'];

export default function ProductDetailPanel({ catalog, product, onClose, preview, catalogImage = false }: { catalog: CatalogData; product: StorefrontProduct; onClose: () => void; preview?: ProductDetail; catalogImage?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  const { locale } = useLanguage();
  const copy = productDetailCopy(locale);
  const detail = preview ?? resolveProductDetail(catalog, product);
  const poster = productDetailPoster(catalog, detail);
  const fruit = resolveFlavorFruitImage(catalog, product.flavor.id);
  const [tab, setTab] = useState<DetailTab>('story');
  const [failedPoster, setFailedPoster] = useState('');
  const [fruitFailed, setFruitFailed] = useState(false);
  const title = detail?.headline || (catalogImage ? product.variant.name : product.flavor.name);
  const volume = detail?.netContent || (product.packaging.volumeMl ? `${product.packaging.volumeMl} ml` : product.packaging.name);
  const rows = detail?.nutrition.filter(row => row.label.trim()) ?? [];

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);

  function chooseTab(next: DetailTab) { setTab(next); }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
    const rtl = locale === 'ar';
    const direction = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
    chooseTab(next);
    dialog.current?.querySelector<HTMLButtonElement>(`[data-detail-tab="${next}"]`)?.focus();
  }

  return <dialog ref={dialog} className={styles.panel} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <button type="button" autoFocus className={styles.close} aria-label={copy.close} onClick={onClose}><X size={22} strokeWidth={1.6} /></button>
    <div className={styles.layout}>
      <div className={`${styles.poster} ${catalogImage ? styles.catalogPoster : ''}`} style={{ '--detail-color': product.flavor.backgroundColor, '--detail-accent': product.flavor.accentColor } as CSSProperties}>
        {catalogImage ? product.image2d ? <InspectableProductImage image={product.image2d} name={product.variant.name} /> : <CatalogProductImage catalog={catalog} product={product} /> : poster && mediaUrl(poster) !== failedPoster ? <Image unoptimized className={styles.posterImage} src={mediaUrl(poster)} alt={title} width={poster.width || 900} height={poster.height || 1200} sizes="(max-width:760px) 100vw, 45vw" onError={() => setFailedPoster(mediaUrl(poster))} /> : <div className={styles.composedPoster}>
          <div className={styles.posterBrand} dir="ltr"><Leaf size={23} strokeWidth={1.5} /><span>VINUT</span></div>
          <p className={styles.posterEyebrow}>{detail?.eyebrow || copy.collection}</p>
          <div className={styles.posterHeadline}><bdi>{product.flavor.shortName || product.flavor.name}</bdi><span>{product.group.collectionTitle || product.group.name}</span></div>
          <div className={styles.posterHalo} aria-hidden="true" />
          <div className={styles.can}><CatalogProductImage catalog={catalog} product={product} /></div>
          {fruit && !fruitFailed && <Image unoptimized className={styles.fruit} src={mediaUrl(fruit)} alt="" width={300} height={300} onError={() => setFruitFailed(true)} />}
          <div className={styles.posterFooter}><span>{volume}</span><ArrowUpRight size={25} strokeWidth={1} /></div>
        </div>}
      </div>
      <div ref={content} className={styles.content}>
        <header className={styles.header}>
          <p className={styles.eyebrow}><span aria-hidden="true" />{detail?.eyebrow || product.group.collectionTitle || product.group.name}</p>
          <h2 id={`${id}-title`}><bdi>{title}</bdi><span className={styles.titleDot} aria-hidden="true">.</span></h2>
          {detail?.subtitle && <p className={styles.subtitle}>{detail.subtitle}</p>}
          <div className={styles.meta}><span><bdi>{product.group.buttonLabel || product.group.name}</bdi></span><span dir="auto">{volume}</span>{detail?.countryOfOrigin && <span><MapPin size={13} />{detail.countryOfOrigin}</span>}</div>
        </header>
        <div role="tablist" aria-label={copy.productInfo} className={styles.tabs}>{tabs.map(item => <button type="button" role="tab" key={item} data-detail-tab={item} id={`${id}-${item}`} aria-controls={`${id}-${item}-panel`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onKeyDown={tabKeys} onClick={() => chooseTab(item)}>{copy[item]}</button>)}</div>
        <div className={styles.tabContent} id={`${id}-${tab}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
          {tab === 'story' && <><p className={styles.sectionIndex} dir="ltr">01 / {copy.story}</p><p className={styles.story}>{detail?.introduction || (!catalogImage && (product.flavor.description || product.variant.description)) || copy.notProvided}</p>{detail?.sections.filter(section => section.title.trim() || section.body.trim()).map((section, index) => <section className={styles.extraSection} key={index}>{section.title && <h3>{section.title}</h3>}<p>{section.body}</p></section>)}</>}
          {tab === 'ingredients' && <><p className={styles.sectionIndex} dir="ltr">02 / {copy.ingredients}</p><h3>{copy.ingredients}</h3><p className={styles.paragraph}>{detail?.ingredients || copy.notProvided}</p>{detail?.allergens && <div className={styles.callout}><h4>{copy.allergens}</h4><p>{detail.allergens}</p></div>}</>}
          {tab === 'nutrition' && <><p className={styles.sectionIndex} dir="ltr">03 / {copy.nutrition}</p>{rows.length ? <table className={styles.nutrition}><caption><strong>{copy.nutrition}</strong>{detail?.servingSize && <span>{detail.servingSize}</span>}</caption><thead><tr><th scope="col">{copy.nutrient}</th><th scope="col">{copy.amount}</th><th scope="col">{copy.daily}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{row.label}</th><td><bdi>{row.amount || '—'}</bdi></td><td><bdi>{row.dailyValue || '—'}</bdi></td></tr>)}</tbody></table> : <><h3>{copy.nutrition}</h3><p className={styles.paragraph}>{copy.notProvided}</p></>}</>}
        </div>
        <section className={styles.productInfo} aria-labelledby={`${id}-info`}>
          <h3 id={`${id}-info`}>{copy.productInfo}</h3>
          <dl className={styles.facts}><div><dt>{copy.volume}</dt><dd dir="auto">{volume}</dd></div>{detail?.countryOfOrigin && <div><dt>{copy.origin}</dt><dd>{detail.countryOfOrigin}</dd></div>}{detail?.storage && <div className={styles.wideFact}><dt>{copy.storage}</dt><dd>{detail.storage}</dd></div>}{detail?.shelfLife && <div className={styles.wideFact}><dt>{copy.shelfLife}</dt><dd>{detail.shelfLife}</dd></div>}</dl>
          {(detail?.companyName || detail?.companyAddress) && <div className={styles.company}><MapPin size={20} strokeWidth={1.4} aria-hidden="true" /><div><p>{copy.manufacturer}</p>{detail.companyName && <strong>{detail.companyName}</strong>}{detail.companyAddress && <address>{detail.companyAddress}</address>}</div></div>}
        </section>
        <footer className={styles.footer}><span dir="ltr">VINUT</span><span>{product.category.name} <span aria-hidden="true">/</span> {volume}</span></footer>
      </div>
    </div>
  </dialog>;
}
