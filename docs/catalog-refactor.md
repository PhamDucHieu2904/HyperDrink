# Catalog layout — 13 October 2026

The catalog follows the supplied wide beverage-grid reference while retaining the existing mint palette and product data. The 1480px container and sidebar were replaced with full-width content and proportional gutters. The hero spans both edges without a border or rounded corners and uses the shared five-slide banner, advancing left every 3000ms. Header, beverage chips, search, product-line filter, packaging filter and pagination follow the reference hierarchy.

The grid uses six columns from 1400px, five below 1400px, four below 1100px, three below 850px and two below 600px. Ultra-wide screens above 2000px use seven columns. The existing 12-item pagination, original-language search, translated catalog, product eligibility and detail links remain unchanged. Banner eligibility uses all catalog products, independent of active filters.

The fixed mint background reuses `backgroundTileUrl`, `BackgroundAutodrift` and `backgroundPointerVelocity` from the homepage system. Green strokes use 0.12 line opacity and 0.23 leaf opacity with a soft wash. Motion keeps a maximum 9px/s speed, gently changes heading every 8–16 seconds and steers with fine mouse input. Hidden tabs and reduced-motion settings suspend its RAF. Listeners and observers clean up on unmount.

Catalog cards use the original compact collection UI at the user's request: white rounded cards, inset product portraits, product names/specifications and the simple italic “See all” action. Added fruit/leaf decorations and the pill CTA were removed. Catalog-only spacing matches the homepage collection cards; the wide grid, banner and moving leaf background remain. Product portraits and labels are unchanged.

UI/UX Pro Max guidance was applied to wrapping filters, touch targets, keyboard focus, contrast, image loading and responsive overflow. The existing Space Grotesk and Be Vietnam Pro fonts are retained. Controls are at least 44px high. Mobile artwork follows the text in normal flow to accommodate translated headings; the language popover is layered above the grid.

Validation covers TypeScript, targeted ESLint, the 41 featured-banner/collection/storefront/background tests, desktop/tablet/mobile browser interaction and the static Pages production build. Browser checks include search plus packaging, empty-state clearing, beverage types, pagination, product details, exact banner CTA, English/German layouts, moving background and autoplay. Screenshots are saved in `artifacts/catalog-refactor/`.
