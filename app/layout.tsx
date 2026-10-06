import { publicUrl } from '@/lib/public-url';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './showcase.css';
import './catalog-showcase.css';
import './flavor-carousel.css';
import './storefront-catalog.css';
import './catalog-collection.css';
import './contact.css';

export const metadata: Metadata = {
  title: 'Vinut — Taste the extraordinary',
  description: 'Discover Vinut beverages, real fruit flavors and refreshing drinks from Vietnam.',
  keywords: ['Vinut', 'beverages', 'refreshments', 'fruit drinks', 'Vietnam'],
  openGraph: {
    title: 'Vinut — Taste the extraordinary',
    description: 'Discover flavors in a whole new way.',
    type: 'website'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body style={{
        '--hero-atmosphere': `url("${publicUrl('/assets/backgrounds/hero-atmosphere.png')}")`,
        '--hero-splash': `url("${publicUrl('/assets/backgrounds/hero-water-splash.jpg')}")`,
      } as CSSProperties}>{children}</body>
    </html>
  );
}

