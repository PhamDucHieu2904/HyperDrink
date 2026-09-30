/** Resolve public assets for both localhost and deployments under a repository path. */
export function publicUrl(url: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  if (!base || !url.startsWith('/') || url.startsWith('//') || url === base || url.startsWith(`${base}/`)) return url;
  return `${base}${url}`;
}
