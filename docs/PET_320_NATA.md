# PET 320 ml — Nata De Coco

## Source and derived assets

Source: `D:/3D model/Model Bottle Can/Blender Model 1/Pet 320ml Model - for web.blend`.
The export opens the file with automatic scripts disabled and never saves it.
`public/models/bottles/assets.manifest.json` records the original and output SHA-256.

The authored Body, PlasticCap, Label, Water and Nata de coco meshes remain the basis
of the model. The revised web derivative contains 22 authored jelly pieces and
113,758 triangles. It preserves the saved viewport subdivision level 1 (render
level 2 stays recorded in the source), authored corner normals, cap flat shading
and original Water coordinates. No decimation is applied. Water has 35,640 authored
triangles plus 94 triangles that close its open top. Two jelly placements are
corrected to fit inside. The current Draco GLB is 1,240,124 bytes, including the
supplied 1,676-byte RGBA Ring texture.

Export scale is 0.1, consistent with the earlier can exports. Derived bounds are
approximately 63.45 × 63.45 × 149.81 mm; these are model dimensions, not certified
manufacturing measurements. The model is centered, Y-up in glTF, front at +Z.
The sleeve UV has front U=0.5, top V=0, rear seam and repeat-S/clamp-T addressing.

| Semantic slot | Exported material |
|---|---|
| body | pet-shell, pet-ring (`nataRing=true` on the Ring material) |
| cap | pet-cap |
| label | printed-label |
| liquid | nata-liquid |
| inclusions | nata-jelly |

All roles explicitly carry `bottleProfile=nata-pet-v1`. The print profile is
`pet-wrap-v1`. Admin GLB inspection recognizes these explicit metadata declarations.

## Appearance and administration

The web viewer uses the same `studio-softbox.exr`, rotation, exposure and lights as
the cans. No HDRI is embedded in the model.

The revised optics were informed by the existing Unity project's
`Assets/System/Shader graph/Nata_de_coco.hlsl` and its Nata materials. That shader
uses opaque jelly depth, blurred captured scene color, spectral absorption and
vivid colored scattering, rather than plain transparent color.

The web liquid uses Three's physical transmission with IOR 1.335, restrained
rough refraction and a colored scattering layer on the rear side
of the same liquid geometry. This opaque rear layer blocks the exterior background
and opposite PET wall. Opaque jelly enters the transmission capture; an optical
depth fade merges distant pieces into the liquid while nearby pieces retain soft
ivory contrast. The front liquid has alpha 1: its translucency comes from the refracted
interior capture. PET highlights remain glossy under the same HDRI as the cans.

The front transmission tint is neutral; the selected drink color lives in the
bulk scattering. Coconut gel therefore retains ivory color instead of being
dyed like mango pieces. The rear volume and unrevealed jelly use the exact same
linear scattering radiance so distant jelly cannot leave colored silhouettes.
Near-distance reveal fades between 10 and 24 mm with 120/m extinction; fragments
at least 24 mm away disappear from the interior capture. This is an approximation
using a finite-cylinder chord in authored metre coordinates, which changes with
the view. The HDRP source jelly is Lit in subsurface-scattering mode with a Nata
diffusion profile; the web uses a dedicated ivory gel shader approximation.

`NATA_PET_OPTICS` separates bulk brightness/saturation from near jelly visibility
and depth fade. Native refraction roughness is 0.14 so nearby cubes retain a soft
box silhouette. Unity's HDRP exposure gain is not copied directly into this
project's neutral tone mapping. This is a real-time scattering approximation,
with one shared-geometry rear draw and Three's native transmission render target,
rather than a full volumetric multiple-scattering simulation. Mockup PNG captures
reuse one camera so repeated exports retain a bounded transmission target count.

`Display3D.liquidColor` is optional. Null/absent follows the selected flavor's
`accentColor`; a hex override changes the drink independently of the background.
The shared resolver applies it to `appearance.slots.liquid.color` only for models
with a declared liquid slot. The same color reaches admin previews, hero displays
and Mockup Studio. A bare Studio bottle uses the embedded default Mango color.

Registered local IDs:

- Packaging: `pet-320`
- Model: `registry-pet-320-nata`
- Display: `nata-pet320-mango-demo-3d`
- Temporary label: `nata-pet320-mango-demo-label`
- Dedicated demo flavor: `nata-mango-demo`
- Watermelon display: `nata-pet320-watermelon-demo-3d`
- Watermelon demo flavor: `nata-watermelon-demo`
- Neutral comparison sleeve: `nata-pet320-watermelon-demo-label`

The temporary Mango label is original demo artwork, clearly marked DEMO LABEL.
Replace it with approved PET artwork in admin and retain the `pet-wrap-v1`
compatibility. The demo does not change existing Juice/Boba flavors or their labels.
The Watermelon demo uses an unprinted light-gray sleeve to compare with the Unity
reference. Its `#ff4430` input is a visual choice from that render, not a claimed
saved Unity Watermelon preset. `--watermelon` makes it the Nata hero default while
retaining the Mango demo and both independent display colors.

## Ring and neck review (2026-10-07)

The authored Body's Ring faces retain a dedicated `pet-ring` material instead of
being assigned the opaque cap material. Its exact `Plastic.png` from the Unity
project is embedded in the GLB with a matching SHA-256. RGB is solid white; alpha
is almost entirely zero (mean 0.4685/255), with a small soft ring-shaped mark.
The viewer keeps that RGBA basemap and adds neutral, slightly warm molded-PET
haze calibrated against the user's real neck photograph. `NATA_PET_RING` sets
roughness 0.19, 0.9 mm effective optical thickness and 240/m haze extinction.
Clear-map regions have approximately 19% diffuse coverage face-on and 66% at
grazing views before dielectric highlights. This gives the brim a visible frosted
edge without turning the Ring into opaque white cap plastic. The cap stays separate.
No geometry, drink brightness/color, or coconut-gel calibration changes.

The supplied rotation video showed a white band at the bottom of the exposed
neck. Three's native transmission color capture previously included the opaque
printed label. At grazing views the refracted screen coordinate could hit that
white print, introducing an artificial white band into the liquid. The user approved
the demonstrated correction: print now uses the transparent render queue at
opacity 1, transmission 0, depthWrite/depthTest true and renderOrder 30. It still
looks solid and occludes the bottle correctly, while staying out of Three's opaque
transmission capture. The band disappears while HDRI highlights remain. This avoids
an additional render target and preserves the accepted liquid/jelly optics.

The 2026-10-08 cap review applies the same exclusion to `pet-cap`: opacity 1,
transmission 0, depthWrite/depthTest true and renderOrder 30 in the final
transparent queue. The cap retains its solid `#f6f5ed` plastic and roughness 0.29,
but its white radiance cannot be refracted into the exposed neck. This is scoped
to the explicit Nata profile and also survives pooled flavor switches.

## Reproduce the export

```powershell
& 'C:/Users/thietke06.VINUT/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' --background --factory-startup --disable-autoexec --python 'D:/program project/3d display product website/scripts/export-web-pet.py'
& 'C:/Users/thietke06.VINUT/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' --background --factory-startup --disable-autoexec --python 'D:/program project/3d display product website/scripts/audit-web-pet.py'
node scripts/create-pet-demo-art.cjs
node scripts/import-pet-demo.cjs
node scripts/import-pet-demo.cjs --apply
node scripts/import-pet-demo.cjs --apply --watermelon
```

The launcher can return before Blender finishes; inspect `export-status.json` for
`state=complete`. The independent audit is written under `.tmp/pet-320` and the
verified report is retained at `public/models/bottles/surface-audit.json`.
The import without `--apply` only validates. Applying imports records into the
local draft, creates a recoverable local release containing only the PET additions
on top of the previous active release, and exports the static catalog. Unpublished
changes from other work stay in draft. Backups are under `data/admin/pet-320-backups`.
Reruns preserve admin edits and refresh only changed derived media checksums.

## Geometry verification

The independent audit reimports the actual compressed GLB into Blender. It checks
source/output hashes, normals, triangle and UV areas, surface winding and nesting.
The current asset has no degenerate triangles or UV triangles. The liquid is closed
after welding decoded vertices. Dense surface checks cover 72,000 sleeve points,
536,010 liquid points and 37,320 jelly points, with no intersections/protrusions.
Minimum sleeve clearance is 140 µm; the authored liquid has approximately 20 µm
minimum clearance and sampled jelly inset is at least 561 µm. Ray parity is used
for concave liquid containment instead of nearest-face normal sign. The sleeve and PET mouth retain intended open
boundaries. WebGL visual checks complement geometry QA; physical-device performance
still needs measurement on the target phones.
