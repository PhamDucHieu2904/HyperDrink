# Collection featured banner

The homepage banner sits above the collection rows. It advances left every 3 seconds, loops seamlessly, and pauses on hover, keyboard focus, hidden tabs, or when outside the viewport. Reduced-motion mode keeps the rotation with a minimal transition. Controls support keyboard arrows and direct slide selection. The pause button, “Find your vibe” intro and row product counts were removed at the user's request; row headings and banner spacing are compact.

The initial five promotions are Guava, Mango, Strawberry, Passion Fruit, and Pineapple. Eligibility comes from the existing homepage collection settings: hidden collections and disabled products are excluded. If a promoted product is removed, another visible collection item fills its slot. Each CTA links to that exact catalog item and detail.

Product portraits in `public/assets/featured` are transparent still renders exported from the existing Mockup Studio (can 330 ml, Telephoto, transparent background) and encoded as WebP. No additional WebGL renderer is created. The registered label hashes prevent stale portraits after a label replacement: the current editorial thumbnail is used instead. To refresh a portrait, export its new label from Studio, update the WebP and the corresponding hash in `lib/catalog/featured-banner.ts`.

Fruit, leaves, and ice use only enabled, ready assets in that flavor’s published pool. The shared splash is reused. Banner artwork is mounted only after the section enters the viewport, leaving the initial hero load priority intact.

## Verification — 13 October 2026

Run `npm run test:featured` for promotion eligibility, artwork revision fallback, asset filtering, slide indexing and all eight locales. Related collection, storefront and homepage-layout checks run alongside it. Browser QA covers the five-slide autoplay loop, focus suspension and arrow-key selection, product detail links, loaded artwork and page overflow on desktop and mobile.

The duplicated first slide at the loop boundary has the same accessible state and working CTA as an ordinary active slide, until the track resets to the original first slide.

Final checks passed: TypeScript, lint for the changed source, 38 related tests, and the static GitHub Pages production build with `/HyperDrink` asset paths. Live QA confirmed the sequence 0 → 1 → 2 → 3 → 4 → 0, the Guava detail drawer, keyboard selection, loaded artwork and no horizontal page overflow at 1440 px and 375 px. Mobile banner controls are 44 × 44 px. Captures are saved in `artifacts/featured-banner/desktop.png` and `artifacts/featured-banner/mobile.png`.
