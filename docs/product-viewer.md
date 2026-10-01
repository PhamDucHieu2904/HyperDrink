# ProductViewer and future admin integration

The storefront no longer assumes one can mesh. `ProductViewer` receives independent, serializable inputs: `ProductAsset`, `ProductAppearance`, `ViewerPresentationInput` and optional `ProductAccentSceneInput`. The same viewer can load can, PET, glass, pouch, or other GLB assets. Bottle and pouch assets still need their own export QA; changing a packaging enum does not manufacture a new model.

## Boundaries

- `lib/beverage-lines.ts`: stable beverage category IDs and labels, used by the header and catalog filter.
- `lib/products.ts`: catalog records and packaging taxonomy.
- `lib/product-assets.ts`: runtime model registry derived from the generated manifest. SHA-based URLs invalidate browser caches after re-export.
- `lib/showcase-flavors.ts`: flavor artwork, label palette, copy and background color.
- `lib/viewer-config.ts`: asset, appearance, light, camera, motion and quality contracts with bounded values.
- `lib/viewer/appearance.ts`: explicit material-slot overrides and temporary label artwork.
- `lib/viewer/runtime.ts`: Three.js loading, lighting, motion, fitting and resource ownership.
- `lib/viewer/package-motion.ts`: canonical cap pose, accelerating launch and damped scale rebound curves.
- `lib/viewer/accent-config.ts`, `accent-motion.ts`, `accent-layout.ts`, `accent-layer.ts`: serializable surrounding composition, product-gated choreography, adaptive spacing and scene-local assets.
- `components/ProductViewer.tsx`: React mount, loading/error presentation and controller lifecycle.
- `components/ShowcaseHero.tsx`: storefront composition and current flavor/model selection.

Geometry is reused across flavors. HDRI is a presentation resource, rather than embedded in every model. New artwork changes a material slot instead of downloading another copy of the geometry. Preserve imported PBR properties unless a particular slot has an explicit override. Printed cans are opaque; transmission/refraction is reserved for appropriate bottle/liquid materials.

## Environment lighting

The storefront default uses `environment.mode: 'hdri'` with Poly Haven's CC0 [Studio Small 08](https://polyhaven.com/a/studio_small_08), stored locally as `public/environments/studio-softbox.exr`. Its intensity is 0.85 and rotation is `[0, 0.75, 0]`. The original white key (0.45), cool fill (0.25) and hemisphere fill (0.12) are retained. HDRI attribution is in `public/environments/LICENSE.txt`; aluminum retains its imported material.

Procedural lighting remains available for future admin presets by explicitly choosing `environment.mode: 'procedural'`. `lib/viewer/environment.ts` generates a 512 × 256 equirectangular environment in linear HDR radiance and HalfFloat format. Broad sky illumination, neutral ground bounce, sky openings and seeded canopy patches supply its reflections. This optional resource is not a visible background or an LDR panorama and uses no stock/reference image.

`environment.procedural` persists the preset, seed, sky radiance, ground radiance and canopy strength, independently of overall intensity and rotation. PMREM generation is cached by radiance configuration, so changing intensity/rotation, product shape or flavor reuses its GPU texture. Source textures are disposed after PMREM creation; all targets belong to the viewer and are disposed with it. HDRI mode accepts an uploaded/local EXR or HDR via `environment.src`; older records that provide `src` without `mode` retain HDRI mode.

`toneMapping` is a validated, serializable choice of `neutral`, `agx`, or `aces`, independent of `exposure`. The storefront uses Neutral at exposure 0.95 to preserve label colors while compressing bright reflections. Older records without this field receive the default. The admin can later change this choice, procedural/HDRI selection, sky/ground balance, seed, canopy strength, environment rotation/intensity and lights through `configure()` without reloading geometry or restarting motion. Renderer output and color textures remain sRGB; HDRI and PBR calculations remain linear.

The storefront's demo overrides only a can's explicit `label` slot: metalness 0, roughness 0.15, clearcoat 0.2 and clearcoat roughness 0.3. These remain independent appearance data for future admin controls. Aluminum/tab materials stay as exported, and the generic viewer does not replace bottle or pouch materials. The older `studio.exr` remains an optional environment rather than the default.

Temporary print artwork retains the original three-color horizontal gradient from its flavor palette. Approved label maps bypass this demo gradient entirely.

## Surrounding objects

The default accent composition contains 2 fruit, 6 leaves, 2 ice cubes and 12 droplets. The lower-right fruit is 10% larger; a small sixth leaf peeks from behind the left edge of the can. Droplet scales range from 0.062 to 0.12 product units; the tiny scattered points have been removed. Water floats gently on independent 9–12 second cycles. Saved positions use relative product units; runtime spacing considers both height and width, giving short and wide packaging a broader composition. All objects, including the blurred leaf, sit behind the product's full rotation envelope with room for its maximum anticipation/rebound scale. Perspective compensation retains their visible size and spacing at that greater distance. Rotated object extents are constrained inside the local viewer on narrow screens. The accent layer does not expand the product's camera-fitting envelope or cover UI controls.

Every node has a stable ID, kind, position, rotation, scale, depth, blur, enabled state, optional tint, independent floating amplitude/period/phase and flavor variants. `assetUrl` can assign an approved GLB or image to any node. GLBs are centered and normalized once, preserve their materials and share the viewer's HDR environment; imported lights/cameras are removed. Draft scene records can be edited through `controller.accents()` without reloading the primary model. `normalizeAccentScene()` bounds motion/transforms, limits the count to 48 and validates asset protocols/colors.

Fruit and leaves use photographic alpha cutouts on planes positioned in 3D, with subject-specific UV crops to exclude adjacent fruit fragments from leaf cells. A 25-tap Gaussian convolution operates in subject UVs and clamps samples to the crop; alpha-weighted color prevents dark fringes. The distant left leaf uses blur 5.5. Default ice uses `ice-material.ts`: its photographic silhouette and luminance detail define three clear refracting faces (IOR 1.31), bright fractures and dark reflections derived from the actual backdrop. Its photo RGB never paints the cube blue/gray. Default droplets use `droplet-material.ts`: a transparent analytic water lens (IOR 1.333), crisp screen-anchored white glints, a readable dark crescent and a clear center sampling the live backdrop. These remain lightweight plane-based lenses rather than volumetric meshes; assigned GLBs provide actual geometry. Per-node focus blur applies to image cutouts and water lenses; volumetric GLB depth-of-field would require a later render-pass extension. Demo atlases were generated with the built-in ImageGen tool; see [scene asset provenance](scene-assets.md).

`ProductViewer` optionally receives `backdrop: { state, config }`. `backdrop-texture.ts` paints only the authored CSS color/pattern/light layers into a viewer-sized canvas, sharing actual theme weights and pattern offsets. It never captures page content. Canvas updates are limited to 30/s and a maximum long side of 512 pixels on mobile or 768 on desktop. `water-backdrop-pass.ts` composites the actual fruit/leaf and assigned non-sampling accents over that canvas into one linear render target at the same limited resolution. The product and native water/ice sampler materials are excluded from this pass to prevent GPU feedback. Both ice and water share the resulting linear sampler, refracting the cutouts behind them as well as the grid. This reuses the viewer's renderer, camera and lifecycle. The shader uses actual drawing-buffer dimensions, so refraction stays aligned at different DPRs. The optional backdrop is independent of the can HDRI/materials; an absent sampler uses a subtle clear reflection fallback. Replacing a source or disposing the viewer releases its textures, callbacks and observers without reloading the product.

Accents watch actual viewer state: after both the product/appearance and accent assets are ready, and the packaging rebound is complete, they fan out from behind the product on a 0.95s decelerating path with slight staggering. Flavor changes fade the old composition in 0.18s during the product turn; the new composition then repeats its entrance. At rest, each object floats and rocks slowly with its own phase. Rapid changes retain the outgoing transforms while fading and reveal only the latest selection. Paused/reduced-motion viewers use a static settled composition. Hidden/offscreen states share the viewer's suspended render loop. Late asset loads and scene resources are disposed safely.

## Example data

```ts
const asset = {
  id: 'bottle-350', src: '/models/bottle-350.glb', name: 'Chai 350 ml',
  packaging: 'pet', volumeMl: 350,
  materialSlots: { body: ['pet-shell'], label: ['printed-label'], liquid: ['juice'] },
};
const appearance = {
  id: 'mango',
  slots: {
    label: { baseColorMap: '/labels/mango.webp' },
    liquid: { color: '#f1a528', transmission: 0.7, ior: 1.33, thickness: 0.006 },
  },
};
const presentation = {
  environment: { src: '/environments/studio.exr', intensity: 1.15 },
  exposure: 1.05,
  motion: {
    transitionSeconds: 0.66, settleSeconds: 0.46, turns: 1, rocking: 0.075,
    packageAimSeconds: 0.3, packageAnticipationSeconds: 0.12, packageAnticipationScale: 1.06,
    packageOutSeconds: 0.4, packageHoldSeconds: 0.2, packageInSeconds: 0.5,
    packageTilt: 1.3, packageSpringDamping: 0.66,
    packageBounceSeconds: 0.7, packageBounceAmount: 0.2,
  },
};
```

These example bottle paths/materials are illustrative, not bundled assets. The current six cans use the real meshes described in `model-pipeline.md`; their artwork is explicitly temporary.

The imported GLB must have correctly oriented normals, UVs, sensible physical dimensions and material names. Viewer fitting uses centered bounds without forcing all packaging to can proportions. Single renderer/context per viewer; stale loads and owned GPU resources are disposed. HDRI uses PMREM. Models can use local Draco; Meshopt is supported. Embedded GLB KTX2 textures require adding the Basis transcoder files before using that optional format. External slot texture overrides currently accept ordinary browser images (WebP/PNG/JPEG); external KTX2 overrides need a loader extension before use.

## Admin scope

A later admin should persist versioned records for assets, appearances, presentation presets and background settings. It can expose HDRI selection/rotation/intensity, light color/intensity/position, exposure, material color/roughness/metalness/clearcoat/transmission/IOR, artwork maps, pose and animation controls. Validate these records both at the API boundary and through the runtime normalizers. Use explicit material-slot mappings and preview a draft before publishing it.

Do not store frame-by-frame motion or Three.js objects in the database. Asset ingestion/export runs separately from a page request. Store derived GLB, posters, texture maps and manifests in versioned object storage/CDN when the project moves beyond this local prototype. Keep source `.blend` files outside the public asset namespace. Add authentication, authorization, upload validation, draft/publish history and storage lifecycle when building the admin. None of that server/admin UI is implemented by this refactor.

## Interaction

Category chips step left about every three seconds using a critically damped spring, with hover/keyboard pause. Flavor buttons retain a continuous loop on desktop and mobile. Flavor changes turn with acceleration and rocking in 0.66s, then settle in 0.46s (2.5× the previous speed). Rapid flavor changes continue from the visible pose. The former hand overlay is removed; drag and arrow keys remain scoped to the canvas and `R` resets its pose.

Different asset definitions use a separate packaging choreography, independent of flavor rotation:

| Phase | Duration | Behavior |
| --- | --- | --- |
| Aim | 0.3s | Turn to the canonical lid view without idle yaw/roll, retaining the current scale |
| Anticipate | 0.12s | Grow to 1.06× with a small reverse twist to establish momentum |
| Exit | 0.4s | Accelerate one full local-axis turn while shrinking to 0.01× scale |
| Hold | 0.2s minimum | Hide the product and activate the latest loaded asset; refit the camera here |
| Enter | 0.5s | Start nearly still and accelerate into full scale while the spin decelerates to the idle pose |
| Bounce | 0.7s | Continue directly into a 20% crest, then 5% and 1.25% crests with two shrinking contractions before settling |

Aim and anticipation use minimum-jerk curves. Exit uses cubic acceleration and entrance spin decelerates. Entrance scale and rebound share one elapsed timeline: quintic Hermite paths have matching positive velocity and zero acceleration at full scale, so zoom continues directly into the crest instead of stopping and restarting. The default entrance follows `t^4 × (2.5 − 1.5t)`, keeping most growth late and increasing crossing velocity to 4.95 scale units/second. Tangents remain bounded for persisted/admin timings and amplitudes. The pose reaches idle at that crossing and stays there during rebound. Three progressively smaller crests use damped amplitude ratios and smooth interpolation, ending at exactly scale 1 with zero velocity. `packageBounceAmount` controls the actual overshoot, `packageBounceSeconds` its duration and `packageSpringDamping` its decay. Setting the amount to 0 skips rebound. Anticipation targets a fixed scale instead of compounding growth during rapid selections. `packageTilt` is an absolute local X rotation (1.3 radians by default), independent of idle yaw/roll.

Model decoding starts concurrently with the choreography. The hidden gap extends if the latest asset is not ready; stale loads cannot replace a later selection. A load failure grows the previous product back. Rapid choices during exit retain its trajectory; a choice during entry or bounce starts from its visible pose and scale. Camera fitting includes the canonical cap view, full turn envelope and maximum anticipation/rebound scale, so it does not change during exit/entry/bounce or clip the cap. Durations, anticipation scale, bounce amount, tilt and damping are validated, serializable presentation fields for later admin controls.

Reduced motion and paused viewers switch assets directly. Hidden/offscreen states suspend animation scheduling.

## Responsive product stage

On desktop the canvas is 15% wider and taller than the previous stage, around the same center. Camera fitting uses a conservative radial envelope derived from actual can vertices and reserves each visible pose at its real scale. Other packaging and animated meshes retain the generic box envelope. `camera.productScale` and `camera.mobileProductScale` are normalized size requests; the motion envelope limits them before clipping. The default mobile request is 1.55× the old camera silhouette.

Mobile shows the selected flavor name in a compact 36px heading row beneath the header. The full-width product stage follows, then a single 36px packaging-button row before the flavor dock. Package choices scroll horizontally without wrapping or increasing the row height. The hero stage reserves room for these controls in the initial viewport; notes, stats and feature details follow. Introductory marketing copy/actions stay hidden on mobile. DOM order matches this control order for keyboard navigation. The flavor dock uses the same seamless loop as desktop, including functional duplicated buttons; reduced motion uses a static scrollable list instead.

The backdrop halo is a radial layer blended with `mix-blend-mode: overlay` inside the background. Its demo opacity is 0.96, with a brighter, broader core that retains the flavor's saturated color. It affects the color/pattern behind the product, independently of HDRI lighting on the mesh. No water ripple or ellipse stage remains.
