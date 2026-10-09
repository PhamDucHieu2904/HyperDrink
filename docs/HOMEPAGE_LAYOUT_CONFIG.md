# Homepage layout config

Admin → Tổng quan → Web layout config controls the homepage's decorative splash,
droplets, leaves, fruit and ice. All five switches default to on for existing catalogs.
The product, liquid/cap materials, page layout, flavor buttons and Mockup Studio stay intact.

Use **Test trên trang chính** to open a separate homepage tab with the current choices,
including unsaved choices. A five-bit `layoutTest` URL parameter scopes the preview to
that tab and is preserved when selecting another flavor. Removing it restores the published
configuration. It does not write or publish anything.

**Lưu bản nháp** persists `homepageLayout` through the authenticated API and SQLite;
the usual **Phát hành** workflow applies it to the public website and standalone export.
Writes use an atomic full-draft hash check and an audit entry, so concurrent edits are rejected.

Homepage filtering removes disabled nodes before the viewer creates geometry or starts
image/GLB downloads. No optical backdrop capture is requested when no enabled procedural
ice/droplets remain. Shared catalog assets are retained for Studio, other screens and rollback.
Fruit thumbnails used by buttons/cards still load independently; these switches target the 3D scene.

Validation: `npm run test:homepage-layout`, storefront hero tests and admin API tests.
The tests cover all 32 combinations, invalid inputs, legacy defaults, no-download behavior,
authentication, stale-write rejection, persistence, publication and standalone export.
