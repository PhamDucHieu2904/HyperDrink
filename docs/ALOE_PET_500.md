# Aloe Vera PET 500 ml · Short label

## Production labels · 8 October 2026

The production import is `scripts/import-aloe-labels.cjs`. It registers the nine supplied VINUT WebP labels (1200 × 419) from `D:/Vinut-TK/Downloads/resized-images (29)`, stored byte-for-byte under `public/assets/labels/aloe-vera/`. The manifest records each source filename, printed flavor name and SHA-256. The temporary Strawberry demo is no longer selectable in the public Studio.

All nine draft profiles use `registry-pet-500-aloe` and the verified `pet-wrap-v1` geometry. Only **Original, Strawberry, Mango, Pineapple and Passion Fruit** have both their product and display enabled on the homepage. Original is the 500 ml slot's default. Lychee, Coconut, Watermelon and Pomegranate retain complete disabled draft profiles; their compatible real labels are available in Studio.

Original has independent green water (`#119d25`) and a green cap (`#008b28`), calibrated against the supplied sample. The other profiles keep their white cap. Optional `Display3D.capColor` is validated, editable in admin and resolved identically by hero, preview and Studio. Pooled appearance switching retains each cap's color and restores the default when no override is set; no global optical or model geometry adjustment is involved.

Run `node scripts/import-aloe-labels.cjs` for a read-only check, and add `--apply` to import into the draft and a scoped recoverable local release. Unpublished records from other work are preserved. `--source=...` supplies replacement source artwork; without it the importer uses the checked imported manifest. Rerunning does not duplicate profiles or create releases for the four intentionally pruned disabled profiles. Backups are under `data/admin/aloe-production-backups`.

`scripts/tests/aloe-production.test.cjs` covers actual label checksums, all nine compatible labels, the exact five homepage flavors, disabled profiles, matching sales/Studio cap and liquid colors, schema validation, idempotence and preservation of private drafts. Browser QA rendered all nine real profiles sequentially through the actual native Mockup PNG pipeline, without shader/console errors. Proof: `docs/screenshots/aloe-production-profiles-2026-10-08.jpg`.

The remaining sections document the earlier model/optics demo and its reproducible registration workflow.

This profile builds on the form-preserving optimized source in [PET_500_SHORT_LABEL.md](PET_500_SHORT_LABEL.md). The source Blender file is read-only; the derived GLB is `public/models/bottles/pet-500-short-label.glb`.

The complete profiled asset is **1,128,836 bytes** with **246,960 triangles**, including the repaired water top. Surface/material setup adds the Ring texture and metadata without further geometry edits. The original Body/Water subdivision and Label subdivision are retained. The manifest and geometry certificate have matching asset hashes.

## Verified Unity source

The actual short-label prefab is `D:/UnityHubData/Unity_3D_Mockup_Project/Assets/Data/Prefab bottle and can/500 ml Bottle Model Short Label.prefab`. Its FBX GUID `d76f013737b0330499b72a0a9382bec2` resolves to `Assets/Data/3D Model/500 ml Bottle Model Short Label.fbx`. The FBX's mesh/material bindings prove the following assignments; these are the 500 ml materials, not materials inferred from the 320 ml bottle.

| Source material under `Assets/Data/3D Model/Materials/` | Actual Unity setting | Web treatment |
| --- | --- | --- |
| `Body Bottle - Rough_NormalMap.mat` | HDRP Lit, smoothness 0.45, normal scale 1, UV0 tiled **20 × 20**, transparent/specular preserved | Source normal retained in GLB, disabled in the web material following feedback; glossy PET roughness 0.075 and IOR 1.47 like the approved 320 ml bottle |
| `Body Bottle - z Glossy.mat` | HDRP Lit, smoothness 0.934, no normal map | Same clean glossy web finish, preserving the original embossed geometry |
| `Ring.mat` | `Plastic.png` base map, smoothness 0.878, alpha remap | Exact supplied image; Aloe-specific polished finish, roughness 0.085, transmission 0.93, IOR 1.47, 0.8 mm physical thickness and reduced haze |
| `PlasticCap.mat` | Opaque white HDRP Lit, smoothness 0.86 | Visually opaque white; final render queue excludes it from the liquid's refraction capture |
| `Aloe Vera Water.mat` | Custom `Juice.shadergraph` / `Juice.hlsl`, colored absorption/cloudiness and artistic emission | Bounded hue/brightness shaping, real liquid transmission, calibrated path-dependent bulk color |
| `Aloe Pulp - Clear.mat` | Custom `Aloe Vera Pulp.shadergraph` / `Aloe_Vera_Pulp.hlsl`, gel optics, fibres and diffusion profile | Pale gel with subtle fibres, soft face/rim variation, spectral tint and visibility attenuation through the enclosing drink |

Unity's normal image `Assets/Data/3D Model/Normal.png` is byte-identical to the Blender-linked normal image: SHA-256 `73d16fb67533015f83a834f80dc260fbc32c4d4d1fdeb71d77f97b5005115189`. HDRP samples this normal through the base UV transform, so the effective **20 × 20** tiling is required even though the normal texture's own serialized scale is 1 × 1. The derived GLB retains that source setup for reversible comparisons. The current web appearance sets `normalMap = null` on both Body regions and does not dispose the asset pool's texture.

The saved Unity pulp material is a custom gel shader with white `PulpColor`/`DensePulpColor`; its legacy green `BaseColor` is not the color connected to that function. The HLSL calculates absorption through each gel fragment's own facing thickness. It does **not** calculate distance from the fragment to the liquid's front surface, which helps explain the uniformly dark chunk silhouettes in the Unity references. Its diffusion profile uses transmission tint `(1, 0.96, 0.72)` and a 0–12 mm thickness range.

The water shader's saved emission intensity is 5.07 with an exposure-relative artistic boost. The web implementation uses a restrained brightness/saturation adjustment rather than copying that large emission term. Rendering remains a calibrated real-time approximation, with one liquid refraction capture and translucent submerged-gel extinction; it is not a full multiple-boundary path tracer.

## Local registration

`scripts/import-aloe-500-demo.cjs` adds the model, the Aloe Vera drink category, a Strawberry flavor, one display preset, and two compatible 500 ml labels. The drink category already exists in the admin draft. Existing Cojo and other models remain unchanged.

- Model: `registry-pet-500-aloe`
- Packaging: `pet-500-short`
- Display: `aloe-pet500-strawberry-3d`
- Printed demo label: `aloe-pet500-strawberry-demo-label`
- Neutral comparison sleeve: `aloe-pet500-unprinted-label`
- Preview: `/mockup?display=aloe-pet500-strawberry-3d`

The printed label is temporary original artwork marked **DEMO LABEL · 500 ml**. It is not a production artwork or a copy of the Cojo 320 ml label. The neutral sleeve allows direct visual comparison with the supplied unprinted Unity renders. No 500 ml production label was found in the current web catalog or the Unity Data image assets during this import.

The Strawberry scene retains its existing pink flavor accent/background while the liquid has its own color. The initial display's `liquidColor` is `#e84a3c`, matching the orange/red direction of the physical product photographs. Admin can independently override that color in Display 3D or clear it to follow the flavor accent. Rerunning the import preserves later admin color, orientation, label and display edits.

## Reproduce the import

First run the source export, pack, decode and geometric validation sequence documented in [PET_500_SHORT_LABEL.md](PET_500_SHORT_LABEL.md). After that checked optimized asset is ready, apply the Unity-derived material profile and register it:

```powershell
node scripts/configure-aloe-500.cjs
node scripts/import-aloe-500-demo.cjs --prepare-art
node scripts/import-aloe-500-demo.cjs
node scripts/import-aloe-500-demo.cjs --apply
node --test scripts/tests/aloe-model-media.test.cjs scripts/tests/aloe-catalog.test.cjs
```

`configure-aloe-500.cjs` verifies the original Blender source hash and compressed-geometry digest before writing the derived GLB. It assigns `aloe-pet-v1`, the five semantic slots, the `pet-wrap-v1` Label UV contract, rough/gloss finish flags, normal tiling, and the supplied Ring base map. It also updates the manifest and geometry certificate hashes. Repacking the base GLB requires rerunning this material setup before catalog import.

The default command is a read-only dry run. It checks the manifest checksum, the GLB's `aloe-pet-v1` optical metadata, explicit UV layout profile, all five semantic material slots, label UV geometry, catalog validity, sales compatibility and Mockup reachability. It refuses to import the earlier optimized GLB before its optical profile is ready.

`--apply` backs up the current draft and active release under `data/admin/aloe-500-backups`, compares both catalog versions inside a SQLite transaction, merges only this import's owned records, activates a recoverable local release, and exports the public snapshot. Unpublished changes from other work stay in the draft.

For a new registration, `--liquid-color=#rrggbb` sets the initial display's independent liquid color, `--front-yaw=number` sets the Mockup front correction in radians, and `--panel-centers=256,1280` controls the generated demo's artwork centers. The verified native wrap places the front panel at U=0.125 and the back panel at U=0.625. Existing admin settings are preserved. An explicit user-requested retint uses `--set-liquid-color=#rrggbb --apply`; it changes only this display's water color and leaves its orientation, label, background and unrelated drafts intact.

The delivered poster `public/models/bottles/pet-500-aloe-poster.webp` is a 640 × 640 WebP derived from the actual 2048 × 2048 transparent PNG exported by Mockup Studio. The full native export is saved at `docs/screenshots/aloe-500-final-export.png`. The import refreshes derived media checksums when the poster is replaced; the temporary bootstrap illustration has been replaced.

## Current display: v14 white liquid reservoir

The selected low-cost display renders Aloe water as in the approved white Studio view. Internal Three transmission, isotropic 12.74 mm capture thickness, glossy PET/Ring, clear same-hue pulp and path-dependent neck turbidity stay calibrated. Cap and Label remain excluded from the native refraction capture. No model, color preset or 320 ml material changes are required.

The liquid composes white into its remaining coverage after tone mapping and output-color conversion. This gives the white Studio appearance while hiding rear grid, fruit, leaves and splash through the liquid. The hero does not request the optional backdrop painter/capture pass for Aloe, including configurations with native water decorations. External Snell-ray scanning, five artwork texture taps, borrowed texture bindings and their matrix inversions are removed from the liquid shader. Pulp retains its fitted near/far depth calculation.

Transparent Studio preview uses the same default-framebuffer white fill as the hero. It has no live decorative painter or refresh loop; Still schedules frames only for real changes or interactions. White Studio beauty and native PNG continue through the existing MSAA/linear/output pipeline. Offscreen renders disable the display fill, preserving reusable transparent PNG alpha. Preview fill resumes on the next drawn frame, without texture allocation or shader recompilation.

This removes identifiable additional GPU/CPU work; low-spec hardware FPS has not been measured on the user's other machine. The v11–v13 external-refraction notes below describe the superseded implementation, not the current display.

Browser review covered the real Strawberry hero with splash/leaves, matching white and transparent Studio views, and a native 2048 × 2048 transparent PNG. Still render diagnostics stayed at 334 frames across the idle checks; the PNG contains 3,145,258 fully transparent and 545,909 partially transparent pixels, and preview resumes after export. No shader/console errors were observed. Proofs: `docs/screenshots/aloe-500-v14-white-reservoir-hero.png`, `docs/screenshots/aloe-500-v14-white-reservoir-studio.png`, `docs/screenshots/aloe-500-v14-white-studio.png`, and `docs/screenshots/aloe-500-v14-transparent-export.png`.

## Optical implementation and validation history

The source Water had one unfilled top at the neck: 96 boundary edges before subdivision, 192 at the saved export subdivision. `bottle_500_liquid.py` seals that evaluated ring with one center vertex and 192 outward-facing triangles. All existing Water vertices, faces and corner normals remain unchanged before Draco compression. The additional surface prevents a bright open center when viewing through the molded bottom. The other four mesh streams (Body, Cap, Label and Aloe Pulp) remain byte-identical to the preceding GLB; no shader calibration changes accompany this repair. The resulting asset is only 1,260 bytes larger.

Blender round-trip fidelity checks pass against the source with this explicit top closure. A separate regression decodes the shipped Draco Water, welds its normal-split vertices and verifies every edge has exactly two opposite face uses, with Euler characteristic 2 and no collapsed triangle. The boundary is closed after actual compression, rather than hidden by double-sided rendering. The import refreshes only the model media checksum in draft/published catalogs. Bottom-view proof: `docs/screenshots/aloe-500-water-top-closed.png`.

The implementation lives in `lib/viewer/aloe-bottle-materials.ts`, dispatched by the shared bottle material wrapper only for `aloe-pet-v1`. It retains the existing project HDRI/lighting configuration. Following visual feedback, both shell regions use the clean glossy 320 ml finish without the normal map, and the Aloe Ring uses less haze and actual polished PET refraction while the approved 320 ml Ring remains unchanged. Its native transmission samples retain opaque basemap markings and remove Three's white/alpha-0.5 clear sentinel, preventing empty captured pixels from whitening the neck. Both Label and Cap render after the liquid transmission pass, preserving their visible opacity while preventing white imagery from entering that capture.

The liquid's scattering coverage follows Beer–Lambert extinction over the camera chord, with a modest reduction at the tapered neck/top. The opaque capture queue uses continuous custom blending, preserving partial coverage without noisy cutout patterns. Studio retains that coverage in the final RGBA output, so a short neck path is paler and more transparent while the broader body remains turbid. The Strawberry preset uses `#e84a3c`, replacing the earlier orange calibration.

The hero now explicitly requests the existing external backdrop pass for the registered `Aloe Vera Water` material, including scenes where all decorative water accents are images. Three's native opaque transmission capture cannot see a CSS background or transparent fruit/leaf sprites. `runtime.ts` therefore lends the product-free backdrop texture to the liquid through nonserialized WeakMap bindings. The capture includes the live grid/icons/glow, fruit/leaf objects, and a hidden counterpart of the DOM splash that evaluates CSS Hard Light in sRGB before returning linear radiance. The proxy shares geometry/map/pose/zoom/fade and appears only during the capture; a `finally` restores its state even on render failure. The product, native water and ice are excluded, preventing cap/label contamination or sampling a target while writing it. Existing nonrefractive can scenes do not allocate this optional pass.

External refraction uses a separate Snell ray through the fitted liquid's full first-exit chord, transformed metric → world → camera projection. A straight body path is approximately 58 mm; the shorter 12.74 mm internal ray remains calibrated for the water/gel capture. Camera rotation, pooled viewer scale, the tapered shoulder, concave bottom and orthographic direction are handled explicitly. Five texture taps soften the refracted scene. Native water/gel RGB and alpha pass through their usual exposure/tone mapping unchanged; the borrowed backdrop is composited afterward in output color space, so a white backdrop exactly reproduces white Studio appearance.

The user's white-Mockup art direction is retained as a hybrid rather than exposing unbent rear images: the refracted backdrop receives a bounded neutral fill, 20% for thin paths and 75% for full body paths. This mutes rear artwork through the turbid body while allowing stronger environment refraction at the clearer neck. It is an artistic calibration, not an additional pigment or a new admin water color. `externalBackdropNeutralFill` can disable that contribution for a direct optical comparison. White/solid Studio and native transparent PNG modes have no borrowed decorative backdrop.

Pulp is a clear, lightly cloudy Aloe gel filter over the surrounding drink, with no ivory/coconut diffuse pigment. Absorption through each piece and stable cloud/fibre variation create slightly darker cợn, capped at 19% extinction per piece after the visibility feedback. A typical gel face 5 mm behind the wall has about 15% contrast, versus roughly 4.6% at 20 mm; far pieces vanish at 36 mm. Depth contrast fades over 12–36 mm, with extinction 60 per metre; a zero-reveal filter is exactly neutral and preserves the captured alpha. The shared back-liquid surface draws first and the gel filters it next, before the real liquid refraction pass. Destination-alpha compensation preserves Three's white clear sentinel exactly, preventing low-coverage neck/base pixels from turning gel into dark blocks. Optical regressions include clear, partial and opaque capture mixtures.

The v12 front-water filter projects darker internal capture contrast onto the local water color using luminance, then reduces all RGB channels by the same ratio. The earlier per-channel second absorption treatment reduced red contrast more than green/blue, which made neutral Aloe gel look grey-green despite having no independent green pigment. Negative capture contrast now keeps the current admin water hue, and cumulative overlapping gel is bounded to 19% linear-radiance darkening. Brighter capture treatment, liquid coverage, external backdrop refraction, depth fading and PET/Ring settings remain as calibrated. Regression coverage includes saturated red, pink, cyan and neutral water colors, chromatically biased dark capture and overlapping pieces. The white-background native 2K proof is `docs/screenshots/aloe-500-pulp-water-hue.png`.

### v13: shared hero/Studio capture decoding and live preview refraction

Both pages use the same registered GLB, `aloe-pet-v1` material profile and independent liquid color. Their WebGL contexts differ: the hero uses premultiplied alpha, while Studio explicitly uses straight alpha for PNG capture. In Three r180, `WebGLBackground` passes that context flag into `WebGLState` when clearing the native transmission target. The white/alpha-0.5 sentinel therefore contains RGB **0.5** on the hero and RGB **1** in Studio. Subtracting 1 on both pages erased part of the hero's captured water radiance and caused the bounded pulp contrast to flatten.

`aloeTransmissionClearRadiance` now reads the actual drawn renderer. Every pooled liquid, back-water and pulp draw updates a shared uniform; Aloe Ring uses the same correction. Native capture decoding subtracts the renderer's sentinel, and the gel blend compensates it without changing captured alpha. Tests exercise both real context flags and clear/partial/opaque coverage. The calibrated water color, gel extinction, depth fading and approved 320 ml profile are preserved.

Previously Studio placed the live decorative CSS grid behind the completed canvas. Native transmission could not refract that background. Transparent Aloe preview now borrows the existing `FlavorBackground` painter, cropped to the Studio surface through `data-refraction-backdrop`, and uses the same full-chord external refraction as the hero. This output-space composition renders directly to the preview framebuffer to avoid applying tone mapping twice to the already authored background. The optional painter and its refresh loop are used only by the transparent Aloe preview; ordinary cans and other PET profiles retain their stationary render path. Model switching and disposal detach borrowed samplers before releasing their owner.

Native PNG export explicitly detaches the decorative backdrop and uses the existing MSAA/linear/output capture pipeline. A transparent PNG keeps reusable alpha instead of baking the pink Studio grid into its water. The next preview frame restores the live binding. Solid/white Studio views likewise retain their established beauty output. A uniform white background has no grid or imagery whose refraction could be visibly compared.

Browser review covered the registered hero, transparent and white Studio views, rotated viewpoints and a native **2048 × 2048** transparent PNG with successful preview restoration. The v13 proofs are `docs/screenshots/aloe-500-final-hero.png`, `docs/screenshots/aloe-500-final-studio.png`, `docs/screenshots/aloe-500-parity-white.png` and `docs/screenshots/aloe-500-parity-export.png`. No new shader/console warnings or errors were observed. Viewer, Mockup and water/backdrop regressions, TypeScript and targeted lint checks passed.

Depth is measured in metres against a fitted 16-level section profile derived from the actual rectangular/tapered Water geometry, including corner supports and a sampled lower surface for the concave molded base. The camera and drawn mesh hierarchy are respected when rotating the bottle or cloning it into viewer pools. This fitted profile avoids treating the 500 ml square bottle as a large cylinder, but it still approximates the exact liquid boundary. Bulk-water color receives a small path-dependent Beer correction so thinner shoulder/neck paths differ from the broad body without tinting the pulp twice.

The final profile was compared with ray/triangle intersections against the actual liquid mesh at 925 interior camera rays. Mean entry-distance error is **1.10 mm**, with an **8.19 mm** worst sample; the base-region mean is **2.44 mm**. This measures the fitted optical boundary, independently of the 0.01069 mm exported geometry fidelity. An inward 16 × 16 floor map and denser first-exit scan at the molded base avoid extending the liquid through its raised bottom. Refraction thickness is isotropic in physical metres, compensating for the source Water node's nonuniform Blender scale.

Catalog checks run against the actual standalone public snapshot and physical media. `scripts/tests/aloe-catalog.test.cjs` covers public sales/Mockup reachability, retained Cojo presets, label UV/material/media links, independent liquid tint and clear-to-follow-flavor behavior, preservation of unrelated draft records, idempotent imports that retain artist edits, and explicit retint of only the owned display. The six integration regressions passed. The initial import also compared all **1,115 existing draft records** against its backup; none changed.

Final browser review covered the real registered Strawberry hero with its pink grid/splash, the printed Studio display, rotated views and the native transparent 2048 px PNG export. The profile has clean glossy PET, recognizable softly darker Aloe gel, a paler neck, full-volume external refraction and the neutral white-Studio contribution. No new shader/console errors were observed; the live mobile hero reported 60 FPS during the v11.1 review on this machine. The hero proof is `docs/screenshots/aloe-500-final-hero.png`, the Studio proof is `docs/screenshots/aloe-500-final-studio.png`, and the native export is `docs/screenshots/aloe-500-final-export.png`. The v12 hue correction was additionally checked in the printed white Studio, rotated views and both transparent/white native 2K PNGs. Viewer, water/backdrop, accent, catalog, PET media and Mockup regressions, TypeScript and targeted lint checks passed. Catalog regressions cover the actual registered liquid material name, preventing a synthetic fixture from masking a missing backdrop binding. The 640 px poster was refreshed from the v12 transparent Studio PNG.
