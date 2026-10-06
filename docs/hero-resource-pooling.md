# Homepage resource loading

The homepage passes an optional `resourceWindow` to `ProductViewer`. Admin previews and other viewers continue loading only their selected product.

- **Geometry:** the visible model plus one previous model are retained. Variants sharing the same model, slot bindings, samplers and orientation reuse its geometry. A third model evicts the unused one. Detached models restore imported materials and release their label pools.
- **Ready labels:** current variant plus nearby neighbors, at most five material sets on desktop and three on mobile for the active model. Owned label textures have an estimated RGBA/mip admission budget of 32 MiB desktop / 20 MiB mobile; large labels can therefore retain fewer neighbors. Shared imported model textures are excluded from that estimate. The visible and selected labels stay pinned and can temporarily exceed the budget during a replacement. Lightweight preparation clones share geometry. Texture upload and shader binding finish before a set becomes ready; committing an already-ready set does not reload its image.
- **Compressed files:** current variant plus ten neighbors in each direction, wrapping the carousel without duplicates. Files download in nearest-first order, one background request at a time, with idle gaps. The compressed Blob cache is bounded at 32 MiB and 60 distinct URLs across at most 21 variants. This does not decode 21 images or allocate 21 GPU textures.
- **Decoration sources:** keep up to 16 recent source textures, protecting the current composition and its outgoing fade. A custom composition requiring more than 16 distinct sources temporarily raises that limit to preserve all required objects.

Selected appearances bypass idle scheduling. Selecting a neighbor already preparing promotes that exact entry and wakes its pending background yield, without repeating image loading. Neighbor GPU work waits for the current flavor/package animation and dragging to settle. Shader preparation uses Three's program cache through synchronous `compile`, without a `compileAsync` polling promise that could survive disposal.

Completed selected model/map URLs are marked loaded so background downloads do not fetch them again merely to produce Blob URLs. Background requests use low network priority. Failed/oversize attempts survive pure window reorder unless their priority improves.

The render limiter retains its clock phase across jittered RAF timestamps; it no longer restarts the interval after every draw and accidentally skips alternating 60 Hz frames.

Background queues pause when the hero leaves the viewport, the document is hidden, or the viewer is paused. Save-Data and 2G connections skip neighbor preparation and downloads. Started image decodes may finish after cancellation; obsolete results are disposed rather than applied. Blob leases prevent eviction/disposal from revoking a URL while an image/model loader is still reading it.

No label files, image dimensions, scene positions, lighting or motion timings are changed. A first visit, an uncached selection, and a newly selected model still need loading; this is not a guarantee of a particular FPS on physical phones.

## Verification

`npm run test:viewer` covers window order/deduplication, cache limits, preparation versus visible commitment, fast cached swaps, stale completions, failed/retryable labels, shader warmup, disposal, geometry reuse and compressed-file leases. `npm run test:accents` covers decoration eviction and fading-source ownership. Existing catalog and viewer interaction tests remain included.

Read-only diagnostics are attached to `.product-viewer`: `modelLoads`, `modelPoolSize`, `appearanceId`, `labelPoolReady`, `labelPoolPending`, `labelTextureBytes`, `labelCacheHit`, `labelSwitchMs`, `shaderPrograms`, `viewerFps`, `viewerFrameGapMs`, `prefetchFiles`, `prefetchBytes`, and `accentSource*`. `labelSwitchMs` measures material application, not full animation duration. FPS/gap reflect the last completed visible drawing sample, not a physical-phone benchmark. Typical settled bounds are modelPoolSize ≤ 2, labelPoolReady + labelPoolPending ≤ 5 (mobile ≤ 3), prefetchBytes ≤ 33554432, accentSourceCount ≤ accentSourceLimit. The texture estimate is not a total GPU-memory measurement. Old network requests and retiring ownership can briefly exceed retained-resource counts while completing and being released.

See [the regression investigation](PERFORMANCE_FIX_2026-10-06.md) for the measured corrections and remaining limitations.
