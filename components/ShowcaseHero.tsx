'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { publicUrl } from '@/lib/public-url';
import FlavorBackground from './FlavorBackground';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Heart, Leaf, LayoutGrid, Play, Rotate3D, Sparkles, Waves } from 'lucide-react';
import { BackgroundRenderState } from '@/lib/background-render-state';
import { backgroundConfig, normalizeBackgroundConfig } from '@/lib/background-config';
import { canAssets } from '@/lib/product-assets';
import type { ProductAppearance } from '@/lib/viewer-config';
import { showcaseFlavors as flavors } from '@/lib/showcase-flavors';

const ProductViewer = dynamic(() => import('./ProductViewer'), { ssr: false });
const backgroundSettings = normalizeBackgroundConfig(backgroundConfig);
const glassStyle = { backdropFilter: 'blur(28px) saturate(148%) brightness(1.04)', WebkitBackdropFilter: 'blur(28px) saturate(148%) brightness(1.04)' } as React.CSSProperties;
const featureGlassStyle = { backdropFilter: 'blur(32px) saturate(152%) brightness(1.04)', WebkitBackdropFilter: 'blur(32px) saturate(152%) brightness(1.04)' } as React.CSSProperties;

export default function ShowcaseHero({ onExplore }: { onExplore: () => void }) {
  const [index, setIndex] = useState(0);
  const [assetId, setAssetId] = useState('can-330');
  const [backgroundState] = useState(() => new BackgroundRenderState());
  const [liked, setLiked] = useState(false);
  const [detail, setDetail] = useState<'flavor' | 'collection' | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  const productRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const hero = heroRef.current;
    const product = productRef.current;
    if (!hero || !product) return;
    const alignLight = () => {
      const area = hero.getBoundingClientRect();
      const bounds = product.getBoundingClientRect();
      hero.style.setProperty('--backlight-x', `${bounds.left - area.left + bounds.width / 2}px`);
      hero.style.setProperty('--backlight-y', `${bounds.top - area.top + bounds.height / 2}px`);
      hero.style.setProperty('--backlight-w', `${bounds.width * backgroundSettings.productGlowWidth}px`);
      hero.style.setProperty('--backlight-h', `${bounds.height * backgroundSettings.productGlowHeight}px`);
    };
    const observer = new ResizeObserver(alignLight);
    observer.observe(hero); observer.observe(product);
    alignLight();
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (detail) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [detail]);
  const flavor = flavors[index];
  const asset = canAssets.find(item => item.id === assetId) ?? canAssets[0];
  const appearance: ProductAppearance = { id: flavor.id, label: { name: flavor.name, category: 'SPARKLING DRINK', volumeMl: asset.volumeMl, colors: flavor.labelColors } };
  const select = (next: number) => setIndex((next + flavors.length) % flavors.length);
  const renderFlavorSet = (isClone = false) => <div className="flavor-set" aria-hidden={isClone || undefined}>
    {flavors.map((item, i) => <button key={item.short} type="button" tabIndex={isClone ? -1 : undefined} aria-pressed={index === i} onPointerDown={() => select(i)} onClick={() => select(i)}><span><Image src={publicUrl('/assets/flavors/' + item.image)} width={64} height={64} alt="" loading="eager" sizes="64px" /></span>{item.short}</button>)}
    <button type="button" tabIndex={isClone ? -1 : undefined} onClick={onExplore}><span><LayoutGrid /></span>All flavors</button>
  </div>;

  return <section ref={heroRef} className="showcase-hero" aria-labelledby="showcase-title" style={{
    '--flavor-accent': flavor.color,
    '--product-glow-opacity': backgroundSettings.productGlowOpacity,
  } as React.CSSProperties}>
    <FlavorBackground flavorIndex={index} renderState={backgroundState} config={backgroundSettings} />
    <div className="quick-rail glass-surface" style={glassStyle} aria-label="Lối tắt sản phẩm">
      <button aria-label="Khám phá hương vị" onClick={() => setDetail('flavor')} className="is-selected"><Leaf /></button>
      <button aria-label="Xem bộ sưu tập" onClick={onExplore}><Waves /></button>
      <button aria-label="Yêu thích hương vị" aria-pressed={liked} onClick={() => setLiked(!liked)}><Heart fill={liked ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="showcase-copy showcase-intro">
      <p className="eyebrow">Sparkling drink</p>
      <h1 id="showcase-title">SPARK YOUR<br />REFRESHMENT</h1>
      <p className="showcase-tagline">Fresh taste. Bold energy.</p>
      <div className="showcase-actions">
        <button className="btn btn-primary" onClick={onExplore}>Khám phá ngay <ArrowRight size={20} /></button>
        <button className="btn btn-ghost" onClick={() => setDetail('flavor')}><Play size={18} fill="currentColor" /> Hương vị</button>
      </div>
    </div>
    <div ref={productRef} className="showcase-product"><ProductViewer asset={asset} appearance={appearance} /></div>
    <div className="flavor-dock" aria-label="Chọn hương vị">
      <div className="flavor-track">{renderFlavorSet()}{renderFlavorSet(true)}</div>
    </div>
    <div className="model-picker" role="group" aria-label="Chọn kiểu lon">
      <span className="model-picker-label">Kiểu dáng bao bì</span>
      <div className="model-options">{canAssets.map(item => <button type="button" key={item.id} aria-pressed={item.id === asset.id} onClick={() => setAssetId(item.id)}>{item.name.replace('Lon ', '')}</button>)}</div>
    </div>
    <div className="showcase-details">
      <div className="notes-stack">
        <button className="notes-card glass-surface" style={glassStyle} onClick={() => setDetail('flavor')}>
          <Image src={publicUrl('/assets/flavors/' + flavor.image)} width={88} height={88} alt="" priority loading="eager" sizes="88px" />
          <span><strong>Flavor Notes</strong><span>{flavor.note}</span></span><ChevronRight />
        </button>
        <button className="notes-card glass-surface" style={glassStyle} onClick={() => setDetail('collection')}>
          <Image src={publicUrl("/assets/flavors/natural-leaf.jpg")} width={88} height={88} alt="" />
          <span><strong>Made for your moments</strong><span>Nhiều hương vị. Nhiều lựa chọn bao bì. Một cảm hứng tươi mới.</span></span><ChevronRight />
        </button>
      </div>
      <div className="showcase-stats">
        <div className="glass-surface" style={glassStyle}><Sparkles /><span><strong>{asset.volumeMl}<small> ml</small></strong><span>Dung tích lon</span></span></div>
        <div className="glass-surface" style={glassStyle}><Rotate3D /><span><strong>360°</strong><span>Tự do khám phá</span></span></div>
      </div>
    </div>
    <aside className="showcase-feature glass-surface" style={featureGlassStyle} aria-label="Hương vị nổi bật">
      <span className="showcase-badge">NEW</span>
      <div className="flavor-portrait-ring">
        <Image className="flavor-portrait" src={publicUrl('/assets/flavors/' + flavor.image)} width={360} height={360} alt={flavor.name} priority loading="eager" sizes="(max-width: 760px) 65vw, 22vw" />
      </div>
      <h2>{flavor.name}</h2><p className="feature-subtitle">A BRIGHTER KIND OF ENERGY</p>
      <div className="showcase-metrics"><span><strong>{asset.volumeMl}<small>ml</small></strong>Lon nhôm</span><span><strong>04</strong>Hương vị</span><span><strong>360°</strong>Trải nghiệm</span></div>
      <p className="feature-description"><strong>Crisp. Sparkling. Unforgettable.</strong><span>{flavor.note}</span></p>
      <button className="btn btn-primary" onClick={() => setDetail('flavor')}>Khám phá {flavor.short} <ArrowRight size={20} /></button>
    </aside>
    <dialog ref={dialogRef} className="hero-detail glass-surface" style={glassStyle} aria-label="Chi tiết hương vị" onCancel={() => setDetail(null)} onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}><h2>{detail === 'flavor' ? flavor.name : 'Find your refreshment'}</h2><p>{detail === 'flavor' ? flavor.note : 'Khám phá Juice, Sparkling, Coconut milk và Nata de coco với lon, chai PET, thủy tinh, PP và túi.'}</p><button autoFocus className="btn btn-primary" onClick={() => setDetail(null)}>Đóng</button></dialog>  </section>;
}

