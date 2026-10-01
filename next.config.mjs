/** @type {import('next').NextConfig} */
const pages = process.env.GITHUB_PAGES === 'true';
const adminDemo = process.env.ADMIN_DEMO === 'true';
const nextConfig = {
  ...(pages ? { output: 'export', distDir: '.next-pages', trailingSlash: true } : {}),
  ...(!pages && adminDemo ? { distDir: '.next-admin' } : {}),
  ...(!pages ? { async rewrites() {
    const adminApi = (process.env.ADMIN_API_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
    return [
      { source: '/api/admin/:path*', destination: `${adminApi}/api/admin/:path*` },
      { source: '/api/public/:path*', destination: `${adminApi}/api/public/:path*` },
    ];
  } } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  typedRoutes: true
};

export default nextConfig;
