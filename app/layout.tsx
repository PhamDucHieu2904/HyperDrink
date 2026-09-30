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
      <body>{children}</body>
    </html>
  );
}

