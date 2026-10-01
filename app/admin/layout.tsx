import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'VINUT Admin · Quản lý sản phẩm',
  description: 'Quản lý dữ liệu, tài nguyên và cấu hình trưng bày sản phẩm VINUT.',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
