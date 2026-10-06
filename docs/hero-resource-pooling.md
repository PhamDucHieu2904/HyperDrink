# Homepage resource loading

The homepage passes an optional `resourceWindow` to `ProductViewer`. Admin previews and other viewers continue loading only their selected product.

- **Geometry:** the visible model plus one previous model are retained. Variants sharing the same model, slot bindings, samplers and orientation reuse its geometry. A third model evicts the unused one. Detached models restore imported materials and release their label pools.
- **Ready labels:** current variant plus two neighbors in each carousel direction, at most five material sets for the active model. Lightweight preparation clones share geometry. Texture upload and shader compilation finish before a set becomes ready; committing an already-ready set does not reload its image. The visible label stays pinned until its replacement commits.
- **Compressed files:** current variant plus ten neighbors in each direction, wrapping the carousel without duplicates. Files download in nearest-first order, one background request at a time, with idle gaps. The compressed Blob cache is bounded at 32 MiB and 60 distinct URLs across at most 21 variants. This does not decode 21 images or allocate 21 GPU textures.
- **Decoration sources:** keep up to 16 recent source textures, protecting the current composition and its outgoing fade. A custom composition requiring more than 16 distinct sources temporarily raises that limit to preserve all required objects.

Background queues pause when the hero leaves the viewport, the document is hidden, or the viewer is paused. Save-Data and 2G connections skip neighbor preparation and downloads. Started image decodes may finish after cancellation; obsolete results are disposed rather than applied. Blob leases prevent eviction/disposal from revoking a URL while an image/model loader is still reading it.

No label files, image dimensions, scene positions, lighting or motion timings are changed. A first visit, an uncached selection, and a newly selected model still need loading; this is not a guarantee of a particular FPS on physical phones.

## Verification

`npm run test:viewer` covers window order/deduplication, cache limits, preparation versus visible commitment, fast cached swaps, stale completions, failed/retryable labels, shader warmup, disposal, geometry reuse and compressed-file leases. `npm run test:accents` covers decoration eviction and fading-source ownership. Existing catalog and viewer interaction tests remain included.

Read-only diagnostics are attached to `.product-viewer`: `modelLoads`, `modelPoolSize`, `labelPoolReady`, `labelPoolPending`, `labelCacheHit`, `labelSwitchMs`, `prefetchFiles`, `prefetchBytes`, and `accentSource*`. `labelSwitchMs` measures material application, not full animation duration or FPS. Typical settled bounds are modelPoolSize ≤ 2, labelPoolReady + labelPoolPending ≤ 5, prefetchBytes ≤ 33554432, accentSourceCount ≤ accentSourceLimit. Old network requests can briefly exceed the retained-resource counts while completing and being released.
