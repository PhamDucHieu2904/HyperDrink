# Vinut 3D Beverage Showcase

Next.js App Router, TypeScript and Three.js storefront prototype. The hero uses six real Blender-derived can models, a reusable ProductViewer, HDRI/PBR lighting, category navigation and a mobile layout that shows the product before secondary information.

## Quick start

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`.

The storefront reads the committed public catalog and images, so it works without running or signing in to admin. Run `npm run dev:admin` for the local product studio at `http://localhost:3100/admin`. Publishing or restoring a release synchronizes the standalone catalog automatically; draft edits remain private.

## GitHub Pages

Live website: https://phamduchieu2904.github.io/HyperDrink/

The Pages workflow builds and deploys automatically when `main` changes. In repository Settings → Pages, use **GitHub Actions** as the source.
Include `public/catalog/current.json` and every new file in `public/catalog/media/` in the commit after publishing. The private SQLite database is excluded from Git. Use `npm run catalog:export` to regenerate the public files manually if needed. A push of application code alone cannot include new images or pool assignments stored only in the local database.
`GITHUB_PAGES=true` enables static export to `.next-pages/`; `NEXT_PUBLIC_BASE_PATH=/HyperDrink` prefixes application and public asset URLs. Local development keeps its root URL and a separate build directory.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm run test:viewer
npm run test:background
npm run test:framing
npm run build
```

## Project map

- `app/page.tsx` — accessible page shell, navigation, hero, search, filters, catalog and story section.
- `app/globals.css` — design tokens, glass surfaces, responsive composition, focus states and reduced-motion rules.
- `components/ProductViewer.tsx`, `lib/viewer/` — generic GLB runtime, appearance handling, smooth motion, fallback and cleanup.
- `lib/viewer-config.ts` — normalized asset/material/light/camera/motion contracts.
- `lib/product-assets.ts` — six model variants from the generated manifest, with versioned URLs.
- `lib/showcase-flavors.ts` — shared flavor artwork, palette and background data.
- `lib/beverage-lines.ts`, `components/BeverageCategoryRail.tsx` — ten categories and damped three-second stepping.
- `lib/products.ts` — typed product catalog and packaging filters; add products here without changing UI components.
- `scripts/export-web-cans.py` — six real Blender models to compressed web GLBs. Rebuild instructions: `docs/model-pipeline.md`.
- `public/models/cans/assets.manifest.json` — authoritative runtime asset facts and source/output hashes.
- `docs/product-viewer.md`, `docs/background-system.md` — integration contracts and background configuration.
- `MASTER_PLAN.md` — full design, architecture, accessibility, motion, performance and QA plan.
- `IMPLEMENTATION_HANDOFF.md` — implemented behavior, test evidence and production content gates.

## Add a new product

1. Add a typed record in `lib/products.ts` with `packaging`, `line`, `flavor`, `volume` and accent color.
2. Add the approved GLB/poster and its manifest under `public/models/` or the future CDN asset namespace.
3. Keep product claims and label artwork sourced from approved content; do not copy demo claims into published SKU data.
4. Run typecheck, lint, build and browser smoke QA before merging.

## Asset note

Model geometry, flavor artwork and presentation settings are separate. Future bottles/pouches use the same viewer with their own geometry/material slots; those assets are not bundled yet. The six source `.blend` files remain unchanged outside this project. Their current printed artwork is demo artwork and can be replaced independently.

The local admin includes authentication, SQLite persistence, upload processing and draft/publish workflows; its public catalog is exported for the standalone storefront. See `docs/ADMIN_RUNBOOK.md` for operation and backup details. `npm run convert:model` is the historical OBJ demo converter and does not rebuild the new model registry. Its source/output archive lives locally in `source-assets/legacy-can` and is excluded from Git.

The admin also includes traffic charts, interaction rankings, API security alerts and operational logs. See [Website operations](docs/WEBSITE_OPERATIONS.md) for local usage, retention, monitoring coverage and future online collector configuration.

## Repository size

Git includes the application source, lockfile, documentation and optimized web assets, including all six can GLBs and the studio HDRI. Installed dependencies (`node_modules`), Next.js output (`.next`), package-manager caches, temporary files and local QA captures are excluded by `.gitignore`. Recreate dependencies with `npm ci`; the development/build commands recreate their output. Original Blender authoring files remain in the external source library described in `docs/model-pipeline.md`.
