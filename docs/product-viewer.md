# ProductViewer and future admin integration

The storefront no longer assumes one can mesh. `ProductViewer` receives three independent, serializable inputs: `ProductAsset`, `ProductAppearance`, and `ViewerPresentationInput`. The same viewer can load can, PET, glass, pouch, or other GLB assets. Bottle and pouch assets still need their own export QA; changing a packaging enum does not manufacture a new model.

## Boundaries

- `lib/beverage-lines.ts`: stable beverage category IDs and labels, used by the header and catalog filter.
- `lib/products.ts`: catalog records and packaging taxonomy.
- `lib/product-assets.ts`: runtime model registry derived from the generated manifest. SHA-based URLs invalidate browser caches after re-export.
- `lib/showcase-flavors.ts`: flavor artwork, label palette, copy and background color.
- `lib/viewer-config.ts`: asset, appearance, light, camera, motion and quality contracts with bounded values.
- `lib/viewer/appearance.ts`: explicit material-slot overrides and temporary label artwork.
- `lib/viewer/runtime.ts`: Three.js loading, lighting, motion, fitting and resource ownership.
- `lib/viewer/package-motion.ts`: canonical cap pose, accelerating launch and damped scale rebound curves.
- `components/ProductViewer.tsx`: React mount, loading/error presentation and controller lifecycle.
- `components/ShowcaseHero.tsx`: storefront composition and current flavor/model selection.

Geometry is reused across flavors. HDRI is a presentation resource, rather than embedded in every model. New artwork changes a material slot instead of downloading another copy of the geometry. Preserve imported PBR properties unless a particular slot has an explicit override. Printed cans are opaque; transmission/refraction is reserved for appropriate bottle/liquid materials.

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
    packageBounceSeconds: 0.48, packageBounceAmount: 0.15,
  },
};
```

These example bottle paths/materials are illustrative, not bundled assets. The current six cans use the real meshes described in `model-pipeline.md`; their artwork is explicitly temporary.

The imported GLB must have correctly oriented normals, UVs, sensible physical dimensions and material names. Viewer fitting uses centered bounds without forcing all packaging to can proportions. Single renderer/context per viewer; stale loads and owned GPU resources are disposed. HDRI uses PMREM. Models can use local Draco; Meshopt is supported. Embedded GLB KTX2 textures require adding the Basis transcoder files before using that optional format. External slot texture overrides currently accept ordinary browser images (WebP/PNG/JPEG); external KTX2 overrides need a loader extension before use.

## Admin scope

A later admin should persist versioned records for assets, appearances, presentation presets and background settings. It can expose HDRI selection/rotation/intensity, light color/intensity/position, exposure, material color/roughness/metalness/clearcoat/transmission/IOR, artwork maps, pose and animation controls. Validate these records both at the API boundary and through the runtime normalizers. Use explicit material-slot mappings and preview a draft before publishing it.

Do not store frame-by-frame motion or Three.js objects in the database. Asset ingestion/export runs separately from a page request. Store derived GLB, posters, texture maps and manifests in versioned object storage/CDN when the project moves beyond this local prototype. Keep source `.blend` files outside the public asset namespace. Add authentication, authorization, upload validation, draft/publish history and storage lifecycle when building the admin. None of that server/admin UI is implemented by this refactor.

## Interaction

Category chips step left about every three seconds using a critically damped spring, with hover/keyboard pause. Flavor buttons retain a continuous loop on desktop and a stable touch layout on mobile. Flavor changes turn with acceleration and rocking in 0.66s, then settle in 0.46s (2.5× the previous speed). Rapid flavor changes continue from the visible pose. The former hand overlay is removed; drag and arrow keys remain scoped to the canvas and `R` resets its pose.

Different asset definitions use a separate packaging choreography, independent of flavor rotation:

| Phase | Duration | Behavior |
| --- | --- | --- |
| Aim | 0.3s | Turn to the canonical lid view without idle yaw/roll, retaining the current scale |
| Anticipate | 0.12s | Grow to 1.06× with a small reverse twist to establish momentum |
| Exit | 0.4s | Accelerate one full local-axis turn while shrinking to 0.01× scale |
| Hold | 0.2s minimum | Hide the product and activate the latest loaded asset; refit the camera here |
| Enter | 0.5s | Grow through full scale with forward momentum while the spin decelerates to the idle pose |
| Bounce | 0.48s | Continue the same scale trajectory to a 15% crest, about 5% recoil and a smaller final crest before settling |

Aim and anticipation use minimum-jerk curves. Exit uses cubic acceleration and entrance spin decelerates. Entrance scale and rebound share one elapsed timeline: quintic Hermite paths have matching positive velocity and zero acceleration at full scale, so zoom continues directly into the crest instead of stopping and restarting. The pose reaches idle at that crossing and stays there during rebound. Subsequent smaller extrema use damped amplitude ratios and smooth interpolation, ending at exactly scale 1 with zero velocity. `packageBounceAmount` controls the actual overshoot, `packageBounceSeconds` its duration and `packageSpringDamping` its decay. Setting the amount to 0 skips rebound. Anticipation targets a fixed scale instead of compounding growth during rapid selections. `packageTilt` is an absolute local X rotation (1.3 radians by default), independent of idle yaw/roll.

Model decoding starts concurrently with the choreography. The hidden gap extends if the latest asset is not ready; stale loads cannot replace a later selection. A load failure grows the previous product back. Rapid choices during exit retain its trajectory; a choice during entry or bounce starts from its visible pose and scale. Camera fitting includes the canonical cap view, full turn envelope and maximum anticipation/rebound scale, so it does not change during exit/entry/bounce or clip the cap. Durations, anticipation scale, bounce amount, tilt and damping are validated, serializable presentation fields for later admin controls.

Reduced motion and paused viewers switch assets directly. Hidden/offscreen states suspend animation scheduling. The mobile DOM puts the product and flavor selector before secondary notes and stats.

The backdrop halo is a radial layer blended with `mix-blend-mode: overlay` inside the background. It affects the color/pattern behind the product, independently of HDRI lighting on the mesh. No water ripple or ellipse stage remains.
