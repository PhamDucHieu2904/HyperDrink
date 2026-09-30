import { publicUrl } from '@/lib/public-url';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import './showcase.css';

export const metadata: Metadata = {
  title: 'Vinut — Taste the extraordinary',
  description: 'Khám phá bộ sưu tập đồ uống Vinut trong không gian 3D tương tác.',
  keywords: ['Vinut', 'đồ uống', 'nước giải khát', '3D showcase'],
  openGraph: {
    title: 'Vinut — Taste the extraordinary',
    description: 'Khám phá hương vị theo cách hoàn toàn mới.',
    type: 'website'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body style={{
        '--hero-atmosphere': `url("${publicUrl('/assets/backgrounds/hero-atmosphere.png')}")`,
        '--hero-splash': `url("${publicUrl('/assets/backgrounds/hero-water-splash.jpg')}")`,
      } as CSSProperties}>{children}</body>
    </html>
  );
}

