# Homepage performance regression — 06/10/2026

## What the user recording showed

The supplied 58-second GitHub Pages recording includes an initial “Loading the collection…” wait exceeding 12 seconds, then delayed changes/reveals while selecting flavors. These are separate stages: the resource pool is created only after the catalog is available.

## Confirmed problems and corrections

1. **Foreground requests were using background priority.** Every new texture on a selected appearance awaited a 40 ms timer and an idle callback with an 800 ms timeout. Selecting an already-preparing neighbor inherited that same promise. Selected work now bypasses idle, and pending neighbors are promoted in place without a second image load.
2. **Shader polling was on the visible switching path.** Each clone waited on `compileAsync`. Polling could also outlive shared material disposal. Preparation now binds through Three's actual program cache with `compile`; there is no asynchronous polling promise holding a selection/teardown. This does not eliminate the real cost of first-time GPU upload or compilation.
3. **The frame limiter lost its timing phase.** Assigning `lastDrawTime = now` after each draw could skip alternating 60 Hz RAF callbacks with small timestamp jitter. Keeping the interval remainder preserves near-60 Hz drawing without changing motion curves or timings.
4. **The fixed pool did not account for image dimensions.** It now admits at most 5 material sets / estimated 32 MiB on desktop, 3 / 20 MiB on mobile. Large Boba labels result in fewer prepared neighbors. Current and replacing labels remain pinned; the budget governs background admission, not total renderer memory.
5. **Demand-loaded media could be fetched again by prefetch.** Successful model/map sources are marked loaded within the bounded window. Background fetches are low priority; pure reordering does not retry every rejected file.
6. **Static catalog started after hydration and bypassed the browser cache.** Pages HTML now preloads the snapshot before hydration, with matching fetch credentials. Static requests revalidate cached data (`no-cache`); public API requests retain `no-store` / omitted credentials. New release validation, authoritative errors and fallback rules remain covered by tests.

Neighbor GPU work is deferred until the foreground transition and drag have settled. Geometry reuse, compressed ±10 neighbor window, material ownership, stale-response protection and original label image files remain in place.

## Measurements and limits

| Check | Observation |
| --- | --- |
| Deterministic 60 Hz / small-jitter regression | Before: 60 draws / 120 callbacks in about 2 seconds. After: at least 119 / 120. This is a scheduling test, not a hardware benchmark. |
| Local dev cold-pool switch to Watermelon | One observed before/after sample: 76 → 39 ms for material application. Network/file cache was available; this does not represent a first Internet download. |
| Production build, desktop browser | Settled diagnostic: 60 FPS, maximum sampled draw gap 17 ms. |
| Production label selections | Prepared Watermelon: 1 ms; uncached material sets Pomegranate and Orange: approximately 20 ms, using compressed files already downloaded. |
| Production mobile viewport, Boba Mango | Selected material applied in 56 ms; retained label pool 1, estimated owned texture bytes 16,536,918 (~15.8 MiB). Mobile viewport still runs on desktop hardware. |
| Static startup request order | Snapshot request began ~36 ms after HTML request, before the first JS chunk request (~49 ms); one snapshot response served the initial navigation. |
| Browser errors | No error/warning entries in the checked production session. |

The currently deployed Pages snapshot was approximately 205 KB and responded in 141–235 ms across three direct HTTP checks. Its client already uses static catalog mode, so an API fallback timeout was **not** the cause found in the deployed code. JSON validation took about 4–10 ms locally. The recording's 12+ second startup wait was not reproduced by those requests; CDN/network/hydration timing from that particular session remains unknown. Preloading removes the known catalog-after-hydration waterfall but does not prove every Internet visit will finish within a fixed time.

Physical Android/iPhone and low-end office hardware have not been measured in this session. First downloads, texture decoding/upload and large image sizes still have a real cost. Do not treat the local FPS or switching numbers as guarantees for all devices.

## Verification

- Lint and TypeScript checks passed.
- Viewer tests cover selected work with an idle callback that never fires, promotion of genuinely parked neighbor uploads, latest selection wins, byte-budget admission/disposal and jittered frame pacing.
- Catalog/prefetch tests cover preload credentials/base path, release revalidation, errors/fallback, successful-source markers, lease ownership, cancellation and window priorities.
- Framing, background, accents, environment, water and Mockup regression suites passed.
- Production static build succeeded with `GITHUB_PAGES=true` and `/HyperDrink`; browser verification used that exported build at a local loopback server.

The fixes are local source changes. No catalog publication, image replacement or GitHub deployment was performed.
