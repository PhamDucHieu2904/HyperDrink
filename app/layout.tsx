import { publicUrl } from '@/lib/public-url';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './showcase.css';
import './catalog-showcase.css';
import './flavor-carousel.css';
import './desktop-showcase.css';
import './storefront-catalog.css';
import './catalog-collection.css';
import './featured-banner.css';
import './catalog-background.css';
import './catalog-product-cards.css';
import './catalog-page.css';
import './contact.css';
import './why-choose.css';
import './favorites.css';
import './mobile-storefront.css';

export const metadata: Metadata = {
  title: 'Vinut — We make your trust',
  description: 'Discover Vinut beverages, real fruit flavors and refreshing drinks from Vietnam.',
  keywords: ['Vinut', 'beverages', 'refreshments', 'fruit drinks', 'Vietnam'],
  icons: {
    icon: { url: publicUrl('/vinut-icon.svg'), type: 'image/svg+xml' },
    apple: { url: publicUrl('/vinut-apple-icon.png'), sizes: '180x180', type: 'image/png' },
  },
  openGraph: {
    title: 'Vinut — We make your trust',
    description: 'Discover flavors in a whole new way.',
    type: 'website'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preloadStaticCatalog = process.env.GITHUB_PAGES === 'true' && !process.env.NEXT_PUBLIC_ADMIN_API_URL;
  return (
    <html lang="en" dir="ltr">
      <head>{preloadStaticCatalog && <link rel="preload" as="fetch" href={publicUrl('/catalog/current.json')} crossOrigin="anonymous" />}</head>
      <body style={{
        '--hero-atmosphere': `url("${publicUrl('/assets/backgrounds/hero-atmosphere.png')}")`,
        '--hero-splash': `url("${publicUrl('/assets/backgrounds/hero-water-splash.jpg')}")`,
      } as CSSProperties}>{children}</body>
    </html>
  );
}

