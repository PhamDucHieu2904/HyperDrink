# Supplied water splash with Hard Light

The storefront uses the user's `Splash water.png` supplied on 2026-10-01. The source is RGBA, 1000 × 662 pixels and 586,814 bytes. Gray RGB in fully transparent pixels is not a backdrop. No new artwork, recoloring or alpha extraction is applied.

The production asset is `public/assets/scene/water-splash-user.webp`: 768 × 768 pixels, 266,834 bytes, about 55% smaller than the supplied PNG. Export crops only fully transparent outer margins, preserves natural aspect and adds transparent padding. Premultiplied-alpha Lanczos resizing avoids dark edges. WebP quality is 92, alpha quality 100; decoded alpha exactly matches the resized source. The original PNG remains outside the repository.

`public/assets/scene/water-splash.manifest.json` records source/output hashes, dimensions, alpha bounds and compression validation. Re-export with `python scripts/optimize-water-splash.py --source "D:/Vinut-TK/Downloads/Splash water.png"`.

## Composition

The splash node has `blendMode: 'hard-light'` and opacity 1. `lib/viewer/blended-accent.ts` projects its Three world transform and perspective camera into an invertible CSS matrix3d. A decorative image beneath the WebGL canvas applies actual `mix-blend-mode: hard-light` against the live flavor background, using the browser's [Hard Light compositing operation](https://www.w3.org/TR/compositing-1/#blendinghardlight). Its wrapper does not isolate blending; the hero bounds the blend group. The matching WebGL plane remains invisible, preventing duplicate composition. No extra render target, WebGL pass or animation loop is created.

The existing accent controller controls readiness, product-settle gating, reveal, fade and idle. ResizeObserver keeps the clipping rectangle aligned to the viewer. Image loading failures release readiness while keeping the failed image hidden. Replacement/disposal removes obsolete images and listeners. The supplied photo stays behind the can and all other accents. The current preview uses `imageZoom: 1.2` after fitting: its photo is 20% larger around the same center, with overflow clipped to the viewer. Individual droplet nodes are disabled. Upper-left fruit retains its raised position.

Asset, transform, opacity and blend mode remain serializable scene settings for future admin editing. Only `normal` and `hard-light` are accepted blend modes. A standalone viewer without a `.showcase-hero` DOM backdrop retains the normal Three image fallback.
