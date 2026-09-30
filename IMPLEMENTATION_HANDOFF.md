# Vinut 3D Showcase — Implementation Handoff

Updated: 30/09/2026. Workspace: `D:/program project/3d display product website`.

## Current implementation

The hero uses the generic `ProductViewer`, six actual Blender-derived GLB variants, shared flavor appearances and reusable studio presentation settings. The retired can-specific component is removed. Historical OBJ assets/converter are retained as source history and are not used by this viewer.

- All six requested sources are exported. Final GLBs are 115,308–167,516 bytes with 25,992–30,928 triangles. Source `.blend` hashes are unchanged. Stable material slots, dimensions, hashes and round-trip checks are in `public/models/cans/`.
- Imported PBR is preserved; the exposed metal uses repaired UVs and smooth satin reflections. A real EXR HDRI is converted through PMREM. Demo label artwork is applied to the explicit `label` slot.
- Geometry, appearance and presentation are separate serializable contracts. Future glass/PET/pouch models use their own GLBs/material slots through the same viewer. No bottle/pouch models or working admin are claimed by this release.
- Header navigation is left-aligned. Ten beverage category chips occupy the center and step left about every three seconds with a critically damped spring. Selection filters the catalog; demo groups with no data show an empty state.
- Flavor changes use a 0.66s full turn and 0.46s settling (2.5× faster). Packaging changes have a separate 0.3s canonical cap-facing aim (no inherited idle yaw/roll) → 0.12s anticipation to 1.06× scale → 0.4s accelerating spin/shrink to 1/100 → 0.2s hidden swap → 0.5s decelerating spin/growth to idle → 0.48s visible scale bounce. Entry and bounce use one scale timeline with matching positive velocity/acceleration at full scale; there is no stop/restart at the phase boundary. Bounce holds the idle pose and peaks at 1.15× before about 5% recoil, a smaller final crest and settling. Its amount/duration/damping are configurable; amount 0 skips bounce. Camera fitting reserves anticipation/rebound headroom and refits while hidden. Rapid choices retain the visible trajectory and latest asset wins; failed loads restore the previous model. The hand overlay is removed; scoped drag/arrow-key rotation and R reset remain.
- Background movement has one configured speed (24 CSS px/s by default). Pointer radius does not change speed. Direction and entry/exit speed are damped separately; the legacy `deadZone` field is retained for saved data but ignored.
- On mobile, actual DOM order is intro → product → flavors → package variants → notes/stats → feature card. The product appears in the first viewport. Controls have mobile touch target sizes, and no horizontal page overflow is introduced.
- The backdrop halo uses Overlay blending with the flavor background. Water/ellipse effects remain removed. Glass panels and the avatar light ring are retained.

## Validation

TypeScript, ESLint, `npm run test:viewer` and production build pass. Browser QA covers desktop 1440×900 and 1920×900, mobile 390×844 and 375×667, model switching, flavor selection, category filtering and keyboard operation. One canvas is retained during model changes, and the fresh QA tab reports no console errors/warnings. The retained tests in `scripts/tests/product-viewer.test.cjs` cover constant background speed, latest appearance during load, pending HDRI status, paused model changes, stale completion after disposal, packaging phase timing/scale, hidden camera refitting, rapid packaging choices, slow loads and failure recovery. Camera projection tests cover varied dimensions/aspects and continuous yaw/rocking/lid-facing rotations.

Model export QA additionally verifies source hashes, Draco round-trip topology/material slots, quantization error, normals, valid metal UVs and positive label/body clearance. See `docs/model-pipeline.md` for exact measurements and rebuild commands. These checks establish asset correctness, not measured mobile performance on every physical device.

The continuous zoom-to-bounce motion was checked on the live preview at 1440×900 (330 ml → 500 ml) and 390×844 (330 ml → 250 ml short). Entry carries forward momentum through scale 1 into the crest; the pose stays upright during the subsequent recoil and settling. The model remains within its viewport and mobile has no horizontal overflow. There are no console warnings/errors. Local `docs/screenshots/product-package-continuous-bounce.gif` is assembled from actual desktop screenshot frames with their captured timing; `product-package-continuous-bounce-mobile.png` captures the mobile crest. QA captures are excluded from Git, alongside dependencies, build caches and the retired OBJ archive. Eleven tests pass, including positive matching velocity/acceleration at the scale crossing, 324 configuration/recovery combinations, reselection during entry/bounce, reduced-motion interruption, zero-bounce behavior and 384,000 projected corners at maximum anticipation/rebound scale. Typecheck, lint and production build pass.

## Next integration boundary

Use `docs/product-viewer.md` for the asset/appearance/presentation contracts and `docs/background-system.md` for background fields. A future admin still needs authentication, server validation, persistent storage, upload processing, draft/publish history and CDN ingestion. Approved artwork/copy and real catalog assets remain separate content work. The current catalog contains eight demo records; the six can variants are selected in the hero.
