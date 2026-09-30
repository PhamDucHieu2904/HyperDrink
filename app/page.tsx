'use client';

import ShowcaseHero from '@/components/ShowcaseHero';
import BeverageCategoryRail from '@/components/BeverageCategoryRail';
import { beverageLines, type BeverageLineId } from '@/lib/beverage-lines';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Menu, Search, ShoppingBag, X } from 'lucide-react';
import { filterProducts, packagingClass, packagingFilters, type PackagingFilter } from '@/lib/products';


function BrandMark() {
  return (
    <a className="brand-mark" href="#top" aria-label="Vinut — về đầu trang">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 28.8C12.1 12.3 22.3 7.8 33.8 7.3c-1.7 10.7-7.5 19.2-19.2 21.3 3.4-4.4 6.6-7.4 12.4-10.9" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="brand-word">VINUT</span>
    </a>
  );
}

export default function HomePage() {
  const [filter, setFilter] = useState<PackagingFilter>('Tất cả');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState<BeverageLineId | null>(null);

  const visibleProducts = useMemo(() => {
    const line = beverageLines.find(item => item.id === lineFilter);
    const byPacking = filterProducts(filter).filter(product => !line || product.line === line.label);
    const query = searchQuery.trim().toLocaleLowerCase('vi');
    if (!query) return byPacking;
    return byPacking.filter((product) => [product.name, product.line, product.packaging, product.flavor, product.volume].join(' ').toLocaleLowerCase('vi').includes(query));
  }, [filter, searchQuery, lineFilter]);

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
    <main id="main-content" className="site-shell">
      <a className="skip-link" href="#collection">Bỏ qua phần mở đầu, đến bộ sưu tập</a>
      <header id="top" className="site-header">
        <BrandMark />
        <nav id="primary-navigation" className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Điều hướng chính">
          <a className="nav-link" aria-current="page" href="#top" onClick={() => setMenuOpen(false)}>Trang chủ</a>
          <a className="nav-link" href="#collection" onClick={() => setMenuOpen(false)}>Hương vị</a>
          <a className="nav-link" href="#collection" onClick={() => setMenuOpen(false)}>Sản phẩm</a>
          <a className="nav-link" href="#story" onClick={() => setMenuOpen(false)}>Câu chuyện</a>
        </nav>
        <BeverageCategoryRail selected={lineFilter} onSelect={id => { setLineFilter(id); scrollTo('collection'); }} />
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label={searchOpen ? 'Đóng tìm kiếm' : 'Mở tìm kiếm'} aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>{searchOpen ? <X /> : <Search />}</button>
          <button type="button" className="icon-btn" aria-label="Mở bộ sưu tập sản phẩm" onClick={() => scrollTo('collection')}><ShoppingBag /></button>
          <button type="button" className="icon-btn menu-toggle" aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X /> : <Menu />}</button>
        </div>
        {searchOpen && (
          <form className="search-popover" role="search" onSubmit={(event) => { event.preventDefault(); scrollTo('collection'); }}>
            <Search size={17} aria-hidden="true" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus placeholder="Tìm hương vị hoặc bao bì…" aria-label="Tìm sản phẩm" />
            <kbd>ESC</kbd>
          </form>
        )}
      </header>

      <ShowcaseHero onExplore={() => scrollTo('collection')} />

      <section id="collection" className="section" aria-labelledby="collection-title">
        <div className="section-heading">
          <div><p className="section-kicker">The collection</p><h2 id="collection-title" className="section-title">Chọn vibe của bạn</h2></div>
          <p className="section-description">Từ lon sủi bọt đến túi nước trái cây tiện lợi — mỗi thiết kế giữ trọn cá tính của hương vị bên trong.</p>
        </div>
        <div className="catalog-controls">
          <div className="filter-group" role="group" aria-label="Lọc theo loại bao bì">
            {packagingFilters.map((item) => <button type="button" key={item} className="filter-btn" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
          </div>
          <span className="catalog-count" aria-live="polite">{visibleProducts.length} sản phẩm</span>
        </div>
        {lineFilter && <div className="category-filter-summary"><span>{beverageLines.find(item => item.id === lineFilter)?.label}</span><button type="button" onClick={() => setLineFilter(null)}>Xem tất cả nhóm <X size={14} aria-hidden="true" /></button></div>}
        <div className="product-grid" aria-live="polite">
          {visibleProducts.length > 0 ? visibleProducts.map((product) => (
            <article key={product.id} className="product-card">
              <div className="product-art" style={{ '--pack-label': product.accent } as React.CSSProperties}>
                <div className={`mini-pack ${packagingClass[product.packaging]}`} aria-hidden="true" />
              </div>
              <h3>{product.name}</h3>
              <p className="product-meta">{product.flavor} · {product.volume}</p>
              <div className="product-footer"><span className="product-tag">{product.line}</span><span className="product-arrow" aria-hidden="true"><ArrowRight size={15} /></span></div>
            </article>
          )) : <p className="empty-state">{lineFilter && !searchQuery.trim() ? 'Nhóm này chưa có sản phẩm trong bộ sưu tập demo. Bạn có thể xem tất cả nhóm.' : 'Chưa tìm thấy sản phẩm phù hợp. Thử một từ khóa khác.'}</p>}
        </div>
      </section>

      <section id="story" className="section" aria-labelledby="story-title">
        <div className="experience-strip">
          <div className="experience-visual"><div className="can-fallback" aria-hidden="true" /></div>
          <div className="experience-copy">
            <p className="section-kicker">Made to move you</p>
            <h2 id="story-title">Hương vị thật.<br />Khoảnh khắc thật.</h2>
            <p>Khám phá bộ sưu tập Vinut qua những thiết kế bao bì có chủ đích, màu sắc giàu năng lượng và từng hương vị được kể theo cách riêng.</p>
            <ul className="bullet-list">
              <li><Check size={16} aria-hidden="true" /> Nhiều lựa chọn bao bì</li>
              <li><Check size={16} aria-hidden="true" /> Dữ liệu sản phẩm rõ ràng</li>
              <li><Check size={16} aria-hidden="true" /> Trải nghiệm 3D tương tác</li>
            </ul>
            <button type="button" className="btn btn-ghost" onClick={() => scrollTo('collection')}>Xem toàn bộ bộ sưu tập <ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      <footer className="site-footer"><span className="footer-brand">VINUT</span><span>© 2026 Vinut. Taste the extraordinary.</span><div className="footer-links"><a href="#collection">Sản phẩm</a><a href="#story">Câu chuyện</a><a href="mailto:hello@vinut.com">Liên hệ</a></div></footer>
    </main>
  );
}

