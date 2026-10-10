# Homepage scene effects

The existing diamond remains the Enhanced graphics/refraction switch. The leaf
button beneath it controls only the fruit, splash, leaves, ice and droplets.
Background icons, product geometry, labels and product controls remain visible.

The selected model and its required label load on demand first. Its ready status
releases a page-wide queue of every enabled homepage model, label and avatar,
including all visible product lines and packaging. The decoration stage begins
only after all of these files finish successfully. It covers all enabled random
pool alternatives, the shared splash and any legacy atlases. Images already used
as avatars are deduplicated across the stages. Admin layout switches still apply.

The queue uses at most two low-priority fetches (one with Data Saver/2G), with idle
gaps and no new work while the page is hidden. It stores compressed Blobs within
32 MiB. Blob URLs are created lazily and leased to GLTF/image loaders, then revoked
on eviction or disposal after the last consumer releases them. Decoded textures
and geometry retain the viewer's existing small pools. Neighbor label decoding
starts after the core stage, instead of competing with the selected product.
HTTP cache keys include the publication ID so future same-path file replacements
cannot reuse a previous release's response. No service worker or localStorage
asset payloads are introduced.

Full decorations are the default. After every planned file finishes, the scene
appears using its existing entrance motion. A one-time nonmodal glass panel
expands from the leaf button; acknowledgment collapses it to the same point.
The panel does not steal focus; closing restores focus before making the panel
inert. Reduced motion uses a fade. The preference and acknowledgment survive
reloads; blocked storage falls back to session-only behavior.

A failed transfer retries automatically up to three times. Failed stages never
announce completion or reveal partial decorations. The button exposes retry;
returning online also retries remaining failures without refetching successes.
The selected product remains usable throughout background loading.

Run `npm run test:scene-resources` for staged ordering, pause/resume, failures,
memory/lease lifetime, public catalog coverage and preferences. Hero and viewer
regression suites additionally cover staging at the actual React/WebGL boundary.
