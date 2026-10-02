# Product model pipeline

The runtime uses product assets independently of the viewer and beverage category. A can is an asset variant, not the viewer's fixed geometry. The six initial can variants are derived from the user's actual Blender files; no replacement mesh was generated.

## Source and build boundary

Source directory: `D:/3D model/Model Bottle Can/Blender Model 1`.

The pipeline opens those files with scripts disabled, evaluates their authored geometry, and writes derived files only into this project. It never calls `save_mainfile` and never saves a `.blend`. The manifest records each original SHA-256, and round-trip validation checks that the original is unchanged after export.

`scripts/export-web-cans.py` performs these steps:

1. Select exactly the authored `Can`, `Cap` and `Label` meshes, excluding other scene objects.
2. Evaluate the existing subdivision modifiers at level 1. This retains lid, pull-tab, shoulders, base and wrap silhouette while producing 25,992–30,928 triangles instead of the approximately fourfold level-2 geometry.
3. Apply the source transforms to derived meshes and use a uniform scale of 0.1. The source can diameters are approximately 0.53–0.66 scene units; interpreting them as 53–66 mm yields plausible packaging dimensions. These dimensions are derived from the source, not certified manufacturing specifications.
4. Give the exterior label a 0.08 mm radial clearance above its authored position to prevent coplanar body/label flicker after geometry quantization, including between vertices. Center the complete model, retain each product's original proportions, and export glTF 2.0 Y-up with the presentation front at +Z.
5. Assign stable semantic nodes, mesh names and PBR material names. No artist artwork is present in these six source files, so the exported label is a neutral satin coating. Demo artwork is applied independently by the viewer.
6. Standardize the label wrap UV: front U=0.5; top V=0 in glTF; seam at the rear. UV crossings remain continuous across the wrap seam. Replace the metal surfaces' collapsed UV charts with nondegenerate dominant-plane charts so later normal maps/material editing have valid tangents.
7. Export GLB and compress geometry using Blender's bundled Draco encoder, level 6, position 14 bits, normals 10 bits, UVs 12 bits and generic attributes 12 bits. There is no texture or external dependency embedded in the model.
8. Record dimensions, triangle count, byte count, compression, source/output hashes and complete material metadata in `public/models/cans/assets.manifest.json`.

## Current assets

| ID | Actual source | Derived dimensions (diameter × height) | Triangles | GLB bytes |
|---|---|---:|---:|---:|
| `can-330` | `330ml Can Model.blend` | 65.82 × 114.88 mm | 29,000 | 126,500 |
| `can-180` | `Can 180ml.blend` | 53.37 × 109.77 mm | 25,992 | 115,308 |
| `can-250-short` | `Can 250ml short Model.blend` | 65.95 × 90.96 mm | 28,008 | 125,964 |
| `can-250` | `Can 250ml.blend` | 54.35 × 132.96 mm | 29,040 | 132,184 |
| `can-320` | `Can 320ml.blend` | 57.91 × 145.92 mm | 30,928 | 167,516 |
| `can-500` | `Can 500ml.blend` | 66.05 × 167.86 mm | 30,216 | 127,588 |

The manifest is authoritative for exact sizes and hashes. The compressed assets are approximately 84–87% smaller than the same level-1 meshes exported without Draco (0.87–1.07 MB).

## Stable editing slots

| Role / mesh | Material name | Purpose | Defaults |
|---|---|---|---|
| `body` | `aluminum-body` | Authored can shell, lid and bottom | Metallic 1, roughness 0.22, isotropic satin reflection |
| `tab` | `aluminum-tab` | Authored pull-tab | Metallic 1, roughness 0.24, isotropic satin reflection |
| `label` | `printed-label` | Authored exterior wrap shell | Metallic 0.18, roughness 0.28, clearcoat 0.35, coat roughness 0.15 |

`materialSlots` uses arrays of names so later assets can expose several materials per role without changing the viewer contract. The GLB stores `materialSlot` and `assetId` extras on nodes. The label's clearcoat uses the standard `KHR_materials_clearcoat` extension.

The original 330 ml body's metal UV map has 954 collapsed triangles, and its pull-tab has 120. Initial anisotropic material testing exposed jagged base reflections through these invalid tangents. The derived assets have zero collapsed UV triangles and default to isotropic aluminum. A future deliberate directional brush material can build on valid UVs; a global directional field is unsuitable for every lid/rim/base at once.

Imported materials are the baseline. Product/admin overrides should target a stable role explicitly, rather than replacing every model material. Changing label artwork or a color must not destroy imported normals, UVs, roughness, metalness or coating settings.

All materials are single-sided. Source QA confirms the body and pull-tab are closed manifold meshes with outward orientation. The label has intentionally open end boundaries but every radial face is outward; its reverse side is concealed by the opaque can shell. Future transparent bottle or pouch assets require their own thickness and sidedness decisions.

HDRI belongs to a reusable presentation configuration. It is not baked into or repeated inside every model. The viewer needs the studio environment to produce the metal reflections; a CSS product halo does not replace environment lighting.

## Label seam audit — 2026-10-02

The two wide black rectangles at the rear of the Juice 30% 330 ml label were caused by texture addressing, not intersecting meshes or broken normals. Some seam triangles intentionally interpolate U past 1, while the appearance loader previously used TextureLoader's clamp-to-edge default. The Rambutan source PNG has a one-pixel opaque black last column; clamping stretches it across these triangles. WebP preserves that border rather than introducing it.

A controlled Blender render used the actual compressed `can-330.glb`, published Rambutan WebP and an emissive label to remove lighting from the comparison. Changing only image extension from EXTEND to REPEAT reproduced and then removed both wide marks. At the top and bottom sample positions, RGB changed from approximately (0, 5, 4) to the intended (0, 115, 103). The middle of the label stayed unchanged. The 38 affected triangles lie near the shoulder and bottom fold, explaining their fixed positions across flavors. The artwork's thin original border remains a thin seam.

The viewer now carries a per-slot `textureSamplers` contract. The six manifest assets use their declared `labelUv.wrapS`; admin models with `can-wrap-v1` use repeat S and clamp T. The setting applies to color, normal and roughness maps and generated demo labels. Texture deduplication includes the sampler, so another material sharing the same image can retain its own UV addressing. Unknown layout profiles keep the existing clamp default. Sampler changes also invalidate the viewer's cached asset definition.

The audit decoded all six GLBs through Blender's glTF/Draco importer, checked triangle winding, UV area, split normals, tangents and sampled 15 barycentric points per label triangle against the body (439,200 samples total). No sampled intersections or gaps below 25 µm were found; decoded labels have zero degenerate triangles, UV degeneracies, inward faces, abnormal face/corner normal disagreements or seam normal splits over one degree. All source and GLB hashes still match the manifest.

| Model | Maximum label U | Minimum sampled clearance | Dense samples |
|---|---:|---:|---:|
| 330 ml | 1.015625 | 55.88 µm | 76,800 |
| 180 ml | 1.015625 | 72.80 µm | 57,600 |
| 250 ml short | 1.015625 | 46.12 µm | 57,600 |
| 250 ml sleek | 1.005474 | 57.36 µm | 57,600 |
| 320 ml | 1.015625 | 45.15 µm | 107,520 |
| 500 ml | 1.013889 | 99.00 µm | 82,080 |

Rerun `scripts/audit-can-surfaces.py` using the Blender alias below. It opens source files with scripts disabled, writes only `.tmp/can-surface-audit.json` and `.tmp/can-surface-audit-status.json`, and never saves models or artwork. A completed status must report six assets and `passed: true`. This controlled render and CPU geometry inspection do not constitute live browser/WebGL visual QA.

## Rebuild on this workstation

Microsoft Store Blender 5.2.2 is installed. Its direct binary path has package-specific execution permissions; use its registered execution alias:

```powershell
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\blender-launcher.exe" --background --factory-startup --disable-autoexec --python "D:\program project\3d display product website\scripts\export-web-cans.py"
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\blender-launcher.exe" --background --factory-startup --disable-autoexec --python "D:\program project\3d display product website\scripts\validate-web-cans.py"
```

For a diagnostic uncompressed export, append `-- --no-draco` to the export invocation. Rebuild Draco assets before publishing. `KHR_draco_mesh_compression` is required by the default output, so the viewer must configure a matching locally hosted Draco decoder.

Because the Store launcher does not forward console output, inspect `public/models/cans/export-status.json`; a successful run reports `state: "complete"` and `count: 6`. A launcher exit alone does not prove export success.

`scripts/inspect-web-cans.py` is a separate read-only source inspection helper. It records authored objects, dimensions, material nodes, modifiers and UV layers in `source-inspection.json`.

## Validation and limits

`scripts/validate-web-cans.py` imports every compressed GLB back through Blender's actual glTF/Draco importer and compares decoded vertex positions against the evaluated original. It checks file hashes, source hashes, triangle counts, all material roles, valid UV triangle areas, and outward label faces. All six assets pass. The worst measured position error is 8.54 micrometers; each source's topology count is unchanged by compression. Results live in `public/models/cans/validation.json`.

`scripts/check-can-clearance.py` measures decoded label vertices and triangle centers against the actual body using radial ray casts; results live in `clearance.json`. The minimum sampled gap across all six is 44.17 micrometers; no samples intersect or fall below the 25-micrometer clearance threshold. The round-trip comparison includes the explicit 0.08 mm shell offset, so it does not mistake this intentional clearance for compression error.

This validation establishes asset integrity. Browser visual QA still checks environment lighting, correct label orientation, cap/base reflections, model switching, mobile framing and animated transitions. Blender Cycles and a real-time web renderer are different rendering systems; exported PBR values are the controlled common contract.

These assets contain no droplet geometry, baked water refraction or brand artwork supplied by the artist. Such features should be added as explicitly authored materials/textures or separate configured assets, not faked by silently changing every object's shader.

Future bottle and pouch exports follow the same manifest and role contract, with additional semantic roles for liquid, transparent shell, cap, film or seal. Transparent products need transmission/IOR/thickness settings and geometry validated for the actual optical construction.
