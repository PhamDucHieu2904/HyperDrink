/** @type {import('next').NextConfig} */
const pages = process.env.GITHUB_PAGES === 'true';
const cloudflare = process.env.CLOUDFLARE_PAGES === 'true';
const staticExport = pages || cloudflare;
const adminDemo = process.env.ADMIN_DEMO === 'true';
const nextConfig = {
  ...(staticExport ? { output: 'export', distDir: cloudflare ? '.next-cloudflare' : '.next-pages', trailingSlash: true } : {}),
  ...(!staticExport && adminDemo ? { distDir: '.next-admin' } : {}),
  ...(!staticExport ? { async rewrites() {
    const adminApi = (process.env.ADMIN_API_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
    return [
      { source: '/api/admin/:path*', destination: `${adminApi}/api/admin/:path*` },
      { source: '/api/public/:path*', destination: `${adminApi}/api/public/:path*` },
    ];
  } } : {}),
  basePath: cloudflare ? '' : process.env.NEXT_PUBLIC_BASE_PATH || '',
  // The public storefront works independently of the local admin process.
  // Publishing synchronizes this snapshot; an explicit hosted API can override it.
  env: { NEXT_PUBLIC_CATALOG_MODE: process.env.NEXT_PUBLIC_ADMIN_API_URL ? 'api' : 'static', NEXT_PUBLIC_TELEMETRY_MODE: staticExport && !process.env.NEXT_PUBLIC_TELEMETRY_URL ? 'disabled' : 'enabled' },
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  typedRoutes: true
};

export default nextConfig;
