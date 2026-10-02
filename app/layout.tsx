import { publicUrl } from '@/lib/public-url';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './showcase.css';
import './catalog-showcase.css';
import './flavor-carousel.css';
import './storefront-catalog.css';

export const metadata: Metadata = {
  title: 'Vinut — Taste the extraordinary',
  description: 'Explore the Vinut beverage collection in an interactive 3D experience.',
  keywords: ['Vinut', 'beverages', 'refreshments', '3D showcase'],
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

