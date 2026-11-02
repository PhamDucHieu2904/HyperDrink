# Cloudflare Pages deployment

This project publishes its static storefront on Cloudflare Pages. Cloudflare's GitHub integration builds the `main` branch after each push; no Cloudflare token needs to be committed or stored in GitHub Actions.

## Project settings

| Setting | Value |
| --- | --- |
| Project name | `vinutproducts` |
| GitHub repository | `PhamDucHieu2904/HyperDrink` |
| Production branch | `main` |
| Build command | `npm run build:cloudflare` |
| Build output directory | `.next-cloudflare` |
| Root directory | Repository root |
| Build environment variable | `NODE_VERSION=22` |
| Production URL | `https://vinutproducts.pages.dev` |

The Pages project is linked to this repository, with production deployments and automatic preview deployments enabled. Pushes to `main` update production; other branches receive preview URLs. No GitHub Actions deployment secret or local Wrangler command is needed for normal updates. To recreate the project in another account, use Cloudflare **Workers & Pages → Create → Pages → Connect to Git** and authorize the Cloudflare GitHub App for this repository.

The build runner enables Next.js static export, disables local API rewrites, and clears the GitHub Pages `/HyperDrink` prefix. With this Next.js version, the custom `distDir` is also the final static export directory, so upload `.next-cloudflare`, not `.next` or `out`. `wrangler.jsonc` records the same Pages project and output directory for local tooling.

The `pages.dev` address is supplied by Cloudflare and uses lowercase. A separate custom domain such as `vinutproducts.com` requires ownership and DNS setup; the project name alone does not register a domain.

## Product data updates

1. Run `npm run dev:admin` and edit products locally.
2. Use **Phát hành** in Admin. This exports only the active public release to `public/catalog/current.json` and `public/catalog/media/`.
3. Commit the code, public catalog and new public media, then push to `main`.
4. Cloudflare builds and deploys the pushed revision automatically. Drafts and the private SQLite database remain on the local machine.

Do not run `npm run catalog:export` in Cloudflare's build: the private local database is deliberately absent from GitHub. The committed public snapshot already contains everything needed to display the published products.

## Admin and optional hosted services

The Node.js Admin API uses local SQLite and file uploads. Static Pages hosting does not run this API; continue using the local Admin at `http://localhost:3100/admin`.

Leave `NEXT_PUBLIC_ADMIN_API_URL` unset for the standalone storefront. If a separate HTTPS Admin/public API is deployed later, set its public origin in Cloudflare's build variables and configure that API's allowed origins. Do not put private credentials in any `NEXT_PUBLIC_*` variable.

Telemetry is disabled for a static build unless `NEXT_PUBLIC_TELEMETRY_URL` points to a separately hosted HTTPS collector. The existing GitHub Pages workflow remains available and retains its own build prefix and output directory.

## Verify locally

```powershell
npm ci
npm run test:catalog
npm run build:cloudflare
```

Check the exported homepage, `/products/`, `/mockup/`, `catalog/current.json`, model files and media URLs from a local static server or the Cloudflare preview. The `.bin.gz` model payloads are explicitly decompressed by the browser, so do not add a `Content-Encoding: gzip` response override for them.
