# Basil seed · Glass 290 ml · Label Lab High

This file documents the retained Label Lab High reference port. The current default catalog uses the [lightweight web presentation](BASIL_GLASS_290_WEB.md) following the user's later performance request. The complete High GLB, optical data and editable Blender model remain available for reference.

The target is Label Lab's **High** optical renderer for the screw-cap Basil bottle. High is selected by `QualitySettings.GetQualityLevel() == 1` in `Assets/System/Script/Glass290Product.cs`; the shader and data references are read from the real Unity project at `D:/UnityHubData/Unity_3D_Mockup_Project`. The implementation does not select Ultra or the legacy material approximation.

The user subsequently requested **no printed label for now**. The delivered catalog preset therefore uses a blank white sleeve, preserving the original Label mesh and its UVs. There is no fabricated Simply Nature label. The supplied Unity PNG is used only as an explicitly named **Unity High reference preview** while the native model loads; it is not proof of a web-rendered result. Production artwork can be attached later through the normal compatible-label workflow.

The display starts with independent Red Grape water color `#be2838`, calibrated against the supplied reference. The exact runtime color entered in Label Lab was not persisted in the Unity material. The saved `BasilWater.mat` starts cyan, so neither that saved color nor the web preset is presented as a recovered exact Red Grape input.

## Source and derived geometry

The original Blender source is:

`D:/3D model/Model Bottle Can/Blender Model 1/Glass 290ml model (Basil) - web.blend`

The export reads it without saving changes. Source SHA-256 is `18a9016a314f653798dd199601f2744fa81cc4225c054ff698d03dc647a2908b`. The model manifest records the unchanged source hash, evaluated authored objects, source modifier levels, and every generated gel object.

Files produced in the web workspace:

- `public/models/bottles/glass-290-basil.glb`
- `public/models/bottles/glass-290-basil.manifest.json`
- `public/models/bottles/glass-290-basil.validation.json` — decoded geometry and GPU attribute certificate tied to the exact exported hash
- `assets/source-models/glass-290-basil-with-gel.blend` — final editable derived Blender copy with one gel object for every seed

No decimation or subdivision reduction is used. The evaluated authored Body, Base, Neck, Water, Cap, Seeds and Label are retained. The derived scene also carries the accepted continuous High glass boundary because Label Lab replaces the original Body/Base when High is active; an export of the original authored meshes alone cannot reproduce that optical surface.

The passed export certificate reports 84,917 authored triangles, 39,600 gel triangles, 52,992 accepted High body-interface triangles and 8,704 accepted High neck triangles, for **186,213 triangles**. The export is **1,751,988 bytes** with SHA-256 `cc4dddb678d5599f6b0913012bb6c095033f5392094edf9c064ee9775de0dadf`; always use the current manifest's `bytes` and `sha256` after a regenerated export. Its larger size than the user's original test export comes from adding the genuine High body/neck boundary and gel with sufficient position/normal precision, while retaining every authored mesh.

The legacy Base contains 424 zero-area seam triangles in the source. Draco compression removes or changes those degenerate faces, so that one hidden reference primitive is stored uncompressed to preserve all 20,992 authored triangles exactly. All active High glass, neck, seeds and gel remain compressed. The decoded GPU normals match their respective authored/native references within 0.040 degrees across all ten meshes; the geometry certificate passed for this exact asset hash.

The importer reads exact semantic names from the inspected GLB:

| Slot | Material names |
| --- | --- |
| Body | `basil-authored-body`, `basil-authored-base`, `basil-glass-neck`, `basil-high-outer`, `basil-high-inner`, `basil-high-neck` |
| Cap | `basil-gold-cap` |
| Label | `printed-label` |
| Liquid | `basil-liquid` |
| Inclusions | `basil-seeds`, `basil-gel` |

The original wrap has the explicit rendered-node UV contract `glass-290-basil-wrap-v1`, horizontal repeat and vertical clamp. Geometry names alone do not infer this contract. The source front is Blender −Y, exported as glTF +Z.

## Optical data and shared resources

The GLB size does not include the High ray-tracing data or the source environment. These separate resources are required to reproduce High's actual body/base and neck interfaces:

| Resource | Transfer bytes |
| --- | ---: |
| `glass-290-basil.glb` | 1,751,988 |
| `glass-290-basil-high.bin.gz` | 2,019,443 |
| `glass-290-basil-neck.bin.gz` | 797,342 |
| Source `a_6.exr` environment | 6,951,083 |
| Combined model, optical data and environment | **11,519,856** |

The tiny blank sleeve and loading reference poster are additional image assets. The environment and optical data are not embedded in the GLB; transfer figures describe a cold load before browser caching. This fidelity target has a larger complete resource footprint than the original mesh-only export.

`lib/viewer/basil-high-data.ts` retains the original Float32 optical values, with no additional quantization. It creates six RGBA32F data textures for the body and six for the neck. A reference-counted cache shares each loaded data set across appearances of this bottle; creating another appearance does not create another set of these textures. The last release disposes the corresponding textures. These shared resources still consume GPU memory and the active High shader still performs its optical traversal per visible bottle.

## Seed gel from the actual Unity builder

`Assets/System/Shader graph/Editor/BasilSeedGelAssetBuilder.cs` and `Assets/Data/3D Model/Generated/Basil Seed Gel Shell Nap Van.asset` define the gel. The exported seed core matches the source used for the accepted Unity shell. The manifest records maximum source-core error `1.2293457984924316e-7` and minimum normal dot `0.9999998211860657` for the initial export.

There are **330 seeds and 330 gel objects**. The normal offset is the source builder's **0.0000832 native units**, converted to **0.00832 Blender source units** and **0.000832 meters** in the web scene. Each gel uses its seed's actual geometry, location and orientation. No random shell generation or guessed percentage expansion replaces the source recipe.

The gel mesh is exported for an editable, complete model. In Label Lab **High**, the visual gel is instead integrated into the same refracted ray as the seed core: `Glass290Product` disables the separate authored core and gel renderers. The High web renderer follows that source distinction to avoid rendering the same seed/halo twice.

## High optical source

The verified source chain is `Glass290Product.cs` → `Resources/Glass290/BasilVan` and `Resources/Glass290High/BasilVan.asset` → `Glass290HighRenderer` and its High shader. It aligns the accepted closed glass to the authored bottle width and base, hides the original Body/Base/Water/Seeds, and shades the outer front surface once. The inner wet surface is used by ray traversal, not rasterized as a second transparent bottle.

The source High model uses:

- Up to eight optical boundaries, IOR 1.0 air / 1.52 glass / 1.333 water, Fresnel and total internal reflection.
- Profile intersections plus the residual triangle BVH for the molded bottom. The bottom keeps its actual normal triangles; it is not replaced by a flat disk, gradient or fake texture.
- World-scale Beer absorption proportional to `7.5 * (1 - waterColorSrgb)`, multiplied by turbidity and opacity relative to the initial material. This coefficient uses the source sRGB input channels, matching Unity's High algorithm; it is not recomputed from linearized water color. The source's local-space scale and the web meter conversion are handled separately.
- The source's 330 fitted seed ellipsoids, depth awareness, and distance veiling. Core color comes from the actual sRGB source `(0.012, 0.018, 0.008)`.
- A normal-offset expanded seed envelope for the gel. A gel-only ray receives the source's weak liquid-tinted haze and continues through water/glass. It does not become an opaque pale ring.
- Smoothness-dependent angular spread, with one center ray at the initial water smoothness of 1. Five Gaussian-weighted rays are used only when the source spread exceeds its threshold.

Initial source material controls are liquid smoothness 1, absorption/turbidity 0.859, opacity 0.158, depth awareness 0.606 and seed fade 0.6. The source lighting default is `a_6.exr`, rotation 0, exposure EV15 and ACES. Separate Unity diagnostics that override exposure for a smoke test are not treated as the user's reference lighting.

The editable body's actual baseline binding is `Body.mat`, with smoothness 0.958 (roughness 0.042). High reads that roughness; its serialized metallic 0.371 is not an added metallic glass reflection term. The separate serialized `OuterOptical` smoothness 0.975 is not the runtime body binding. The gold cap is metallic 1, smoothness 0.612 (roughness 0.388) and sRGB color `(0.9528302, 0.8926178, 0.3460751)`. PaperLabel is smoothness 0.5, metallic 0; the original Neck material is smoothness 0.85. These exact material bindings take precedence over similarly named unused source materials.

`GlassNeckExportScope` adds its own optical neck pass to native exports using `Resources/Glass290High/NeckVan.asset` and the opaque cap collider. The real-time Unity neck otherwise uses its regular HDRP material. The web asset therefore also carries the genuine `NeckVanMesh.asset` and its own native frame so the target export neck does not have to be guessed from the body cylinder.

For native transparent Mockup output, `lib/mockup/basil-neck-export.ts` and the output stage in `lib/mockup/runtime.ts` render neck radiance and visibility separately, then compose the neck after tone mapping, following `GlassNeckExportScope`'s alpha-carrier behavior. The two additional passes are limited to native transparent Mockup output; they do not add passes to the main page.

The shared web shader port is `lib/viewer/basil-high-optics.ts`. Texture-packed High geometry supplies the optical data; the renderer ports the source glass/seed/material algorithm without recreating HDRP's full rendering pipeline. Browser checks have compiled and rendered both body and neck on the actual GPU and produced native PNG output. Source parity checks also cover the molded thick base, closed liquid volume, seed/gel placement and neck/cap boundary traversal. Those results establish that the port runs and follows the inspected source; they do not establish visual pixel parity with Unity. Web PMREM environment filtering differs from Unity's cubemap LOD sampling, and the reference's manually selected color, environment and exposure were not persisted. The delivered blank sleeve is also deliberately different from the printed reference.

## Catalog registration

The importer owns only this Basil bottle's records:

- Model: `registry-glass-290-basil`
- Packaging: `glass-290-basil`
- Product group / drink type: `basil-seed`
- Flavor: `basil-red-grape`
- Display: `basil-glass290-red-grape-3d`
- Blank sleeve: `basil-glass290-unprinted-label`
- Preview: `/mockup?display=basil-glass290-red-grape-3d`

It reuses the already approved Red Grape fruit/icon/leaf media references as separate Basil flavor-pool links. The independent water color does not borrow the purple page background. The gold cap retains the actual model material; no catalog cap-color override is added.

`scripts/import-basil-290.cjs` defaults to a read-only dry run. It requires a passed geometry/normal certificate for the exact asset hash, then checks the asset manifest/hash, High profile metadata, both core and gel slots, authored wrap profile, label geometry, catalog compatibility, and public Mockup reachability. A 16 × 16 lossless solid-white texture represents the requested unprinted sleeve. The loading poster is a 640 × 640 transparent WebP derived from the user's genuine Unity reference PNG.

```powershell
node scripts/import-basil-290.cjs
node --test scripts/import-basil-290-check.cjs
node scripts/import-basil-290.cjs --apply
```

`--apply` backs up the full draft and previous active release under `data/admin/basil-290-backups`, locks a SQLite transaction, rechecks that neither source version changed, updates only owned records, and exports a scoped recoverable **local** release. It does not deploy the site. Unrelated private drafts are excluded from that release.

Rerunning is idempotent and preserves artist changes to display colors, cap overrides, names, model orientation, sleeve selection and visibility. After the web migration, a guard also retains the web model URL and its generated-inclusion semantic slots; this original importer does not switch the display back to High. An explicit `--set-liquid-color=#rrggbb --apply` changes only the Basil display's water. `--liquid-color=#rrggbb` and `--front-yaw=number` set initial values only. `--poster-source=absolute-path` accepts a real replacement render; `--prepare-assets` writes the blank texture/poster without changing a catalog.

The six local checks in `scripts/import-basil-290-check.cjs` cover source and derived integrity, glass 290 ml resolution, blank-sleeve reachability, idempotence, preservation of artist/private edits, and independent scoped publication. These checks do not measure phone performance or certify GPU shader compilation.

The initial local registration created release `6fc9e013-b4f9-4e56-8ad4-7e039dede736`. It added 20 draft records and 22 scoped active records, reusing the draft's existing Glass packaging category and Basil seed drink type. The complete pre-import recovery snapshot is `data/admin/basil-290-backups/before-1791531951187-d9395679-dcd4-40ee-b99e-53b4b887828c.json`.

The final local release `9c7e6e88-0699-4684-abd1-317986f175e4` replaces only the original autogenerated engineering notes on the Basil flavor and variant with storefront descriptions. Artist descriptions remain untouched. Its recovery snapshot is `data/admin/basil-290-backups/before-1791534681481-5ebb43ed-ca02-4968-9c72-41c335f52db1.json`; a deep comparison verified all 2,206 other draft/active records unchanged.

## Final validation and renders

`npm run test:basil` passes 28 checks for optics, actual shipped ray paths, material/data ownership, native neck capture and scoped catalog registration. Viewer and Mockup regressions, environment/backdrop checks, TypeScript, scoped ESLint and the production build pass. The browser reached ready on both the homepage and Mockup and exported real GPU-rendered PNGs. The initial production build hit a generated-directory permission error; preparing that exact workspace cache directory allowed the build to finish without deleting the running development cache.

- `artifacts/basil-290/web-high-transparent.png`: actual native transparent web export, slightly low viewing angle.
- `artifacts/basil-290/web-high-white.png`: actual web export with white studio background, standard viewing angle.

These are web renders with the requested unprinted sleeve, not copies of the Unity poster. Performance on a physical phone has not been measured. The High ray kernel prioritizes the requested optical fidelity; asset transfer size alone does not determine its rendering cost.
