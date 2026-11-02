# Cloudflare Pages deployment

This project publishes its static storefront on Cloudflare Pages. A push to `main` starts `.github/workflows/cloudflare.yml`, which calls a Cloudflare Pages deploy hook. Cloudflare pulls the GitHub repository, builds the latest `main`, and deploys it to `https://vinutproducts.pages.dev`.

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

The Pages project's Git source remains linked to this repository. Automatic Git-triggered builds in Cloudflare are disabled to prevent duplicate deployments; GitHub Actions triggers the production deploy hook instead. Other branches are not automatically deployed by this workflow. You can also run the workflow manually from GitHub Actions.

The deploy hook is named `github-main` and targets `main`. Its private URL is stored only in the encrypted GitHub repository secret `CLOUDFLARE_DEPLOY_HOOK_URL`. The workflow sends a POST request without printing the URL or response body. A successful workflow means Cloudflare accepted the build request; check the Pages deployment status to confirm the subsequent build and release succeeded.

To recreate the connection, link the repository through Cloudflare **Workers & Pages → Create → Pages → Connect to Git**, create a `main` deploy hook in the Pages project's settings, and save its URL as the GitHub Actions repository secret above. Keep Cloudflare's automatic production and preview Git deployments disabled when using this workflow. No Cloudflare account-wide API token or local Wrangler command is needed for routine pushes.

The build runner enables Next.js static export, disables local API rewrites, and clears the GitHub Pages `/HyperDrink` prefix. With this Next.js version, the custom `distDir` is also the final static export directory, so upload `.next-cloudflare`, not `.next` or `out`. `wrangler.jsonc` records the same Pages project and output directory for local tooling.

The `pages.dev` address is supplied by Cloudflare and uses lowercase. A separate custom domain such as `vinutproducts.com` requires ownership and DNS setup; the project name alone does not register a domain.

## Product data updates

1. Run `npm run dev:admin` and edit products locally.
2. Use **Phát hành** in Admin. This exports only the active public release to `public/catalog/current.json` and `public/catalog/media/`.
3. Commit the code, public catalog and new public media, then push to `main`.
4. GitHub Actions requests a Cloudflare build through the deploy hook. Cloudflare builds and deploys the latest `main`. Drafts and the private SQLite database remain on the local machine.

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
