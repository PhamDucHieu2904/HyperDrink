# Basil seed 290 ml · Web renderer

This document tracks the lightweight web presentation requested after the Label Lab High port. The original [High source implementation](BASIL_GLASS_290.md), its full optical data, and the editable per-seed-gel Blender file remain available as references. The web presentation deliberately uses a cheaper rendering method; it does not claim the full High ray algorithm or pixel parity with the Unity capture.

## Why the High port was expensive

The High body shader shades every covered bottle pixel with up to eight optical boundaries. Each boundary can traverse the residual mesh/profile BVHs, and liquid segments can also traverse the 330 seed ellipsoids and gel envelopes. Those traversals fetch node/triangle data from Float32 GPU textures, solve intersections, apply Fresnel/Beer absorption, and sample environment reflections. Non-default water roughness can expand one trace into five weighted traces. The default water smoothness of 1 already used a single trace; disabling decorative background refraction cannot remove this internal work.

The measured High data resources contain 23,552 residual body triangles with 65,528 directional BVH nodes, 48 body profiles, and 330 seed fits. The neck has 18,207 residual triangles and 8,191 nodes. Twelve RGBA32F textures occupy **7,700,480 bytes** of data storage in one GPU context, with corresponding Float32 arrays retained on the CPU. Shared leases prevent duplicate allocation for appearances; they do not remove the fragment traversal of the visible bottle.

The existing appearance pool already shares geometry, retains up to three material sets on mobile or five on desktop, warms selected textures/program variants without the background idle delay, and defers neighbor GPU work during motion. Its mobile/desktop label budgets are 20/32 MiB estimates rather than total renderer memory limits. These working optimizations remain in place.

## Checked web model

`public/models/bottles/glass-290-basil-web.glb` is **424,312 bytes**, SHA-256 `4cc5032f0f40d48de156af9d50962d65b329883f7ed44df1e1bdba4a69547502`, with **62,725 retained triangles**. The accompanying `.manifest.json` and `.validation.json` certify the exact shipped asset.

The outer glass, neck, cap, label and closed water geometry are copied from the validated High GLB. Their compressed geometry streams are byte-identical; no retained positions, normals, UVs, triangle topology or subdivision levels are changed. The runtime asset omits hidden legacy reference meshes and the inner ray-only surface. The complete High reference GLB and the original Blender source remain unchanged.

All **330** fitted source seed ellipsoids are carried in `basilWebSeeds` metadata, using the original High Float32 fits and native-to-GLB frame. The certified maximum coordinate difference is zero. The full-precision gel envelope offset is **0.00008321520913910748 native units**; the earlier High notes round this to 0.0000832. The runtime generates one instanced hydrated-seed layer from this metadata, instead of shipping duplicate core/gel meshes or tracing their BVH for every liquid pixel. This representation preserves the source seed placement/envelope recipe while changing the rendering method.

| Basil-specific resource | High reference | Web presentation |
| --- | ---: | ---: |
| Selected GLB | 1,751,988 bytes | 424,312 bytes |
| Body/neck BVH downloads | 2,816,785 bytes | 0 |
| Separate Label Lab HDRI download | 6,951,083 bytes | 0 |
| Selected asset plus dedicated optical/environment files | 11,519,856 bytes | 424,312 bytes |
| High RGBA32F data textures | 12 | 0 |
| Per-pixel optical boundary traversal | Up to 8, with BVH intersections | Removed |
| Native transparent neck compositor | Separate radiance/visibility passes | Removed |

These are Basil-specific cold-load resources. The web renderer still uses the normal shared viewer environment, Draco decoder, shader/material resources and images, which have their own costs. A smaller GLB or zero High data requests does not by itself establish an FPS figure.

## Web optical presentation

`lib/viewer/basil-web-materials.ts` uses the standard shared `/environments/studio-softbox.exr` and existing viewer lights, tone mapping, DPR and frame cap. The glass is neutral polished PBR with the retained outer/base normals; the gold cap and blank sleeve keep independent finish controls and are excluded from internal transmission capture.

The back-facing authored Water surface supplies a white-lit Beer reservoir. Eight conservative circular cone sections calculate optical depth at vertices, making narrower liquid paths lighter without fragment ray marching. The 330 hydrated ellipsoids use one 77-vertex/100-triangle sphere template and certified per-axis core/gel ratios. Their fragment response uses one bounded quadratic for the black seed core and a tinted translucent gel halo. The shared softbox presentation uses gel haze 0.18 to reduce pale rings; the reference helper retains the source 0.28. Runtime geometry totals **95,725 triangles**, with **25,080 bytes** of instance transforms/core ratios.

One ordinary Three transmission capture contains the back water and seed/gel layer. Both default and offscreen beauty draws suppress these interior layers and restore their draw ranges, including exceptions and pooled A → B → A material switches. The cap and sleeve are solid two-sided opaque beauty draws, so their inside faces write depth before transmitting glass. Their mesh capture hooks suppress them only inside the transmission target; this prevents cap/print refraction without erasing interior faces with glass depth. The glass samples the internal water capture through its actual molded normals. No Basil-specific background image capture, Float32 optical data texture, multi-boundary BVH traversal or native-neck export targets run on this path. The existing Aloe optimizations remain in place.

This is a visual approximation: the cone reservoir and single precomposed gel layer replace High's exact multi-interface transport and can hide a distant core behind a nearer gel envelope. The molded glass geometry is exact, but the old thick-base ray transport is not reproduced exactly. A numerical 90% beauty score is not established; the actual GPU exports are retained for visual review.

## Registration and preservation

`scripts/import-basil-web.cjs` defaults to a read-only preflight. It requires the passed web geometry certificate, exact High source reference hash, unchanged original Blender source, all 330 seed fits and the original `glass-290-basil-wrap-v1` label contract. It updates only model media `model-glass-290-basil` and the semantic slots of model `registry-glass-290-basil`.

The packaging, flavor, display `basil-glass290-red-grape-3d`, label, loading reference poster, product copy, orientation, visibility and independent water color remain unchanged. The present tint is `#be2838`; it is not replaced by the GLB's serialized fallback tint. The registry's inclusions slot explicitly names runtime material `basil-web-seed-gel`, so shared appearance binding configures the generated layer even though the static GLB contains no inclusion mesh. An artist-replaced model URL or altered slot mapping causes a refusal instead of being silently overwritten.

```powershell
node scripts/import-basil-web.cjs
node --test scripts/import-basil-web-check.cjs
node scripts/import-basil-web.cjs --apply
```

Apply saves the complete previous draft and active release under `data/admin/basil-web-backups`, checks both versions and asset hashes inside a SQLite transaction, publishes only the scoped local model change, and exports the current static snapshot. This is a recoverable local catalog release; it does not deploy the website. Repeated apply is idempotent. The original High importer has a guard to retain the web model URL and slots after migration.

The migration's active local release is `2bcd63fc-c8c6-4418-a604-7c1c20559c95`. Its pre-web recovery snapshot is `data/admin/basil-web-backups/before-1791536504272-7feaf6cc-3c70-4163-a14e-3e04aebb37e2.json`. A read-only comparison against that snapshot confirmed all **1,318 unrelated draft records** and **888 unrelated active records** remained deeply identical; collection counts also stayed unchanged. The two owned records changed only the model URL/byte facts, material slots and corresponding revision timestamps.

Six import regressions cover exact-asset/source certification, scope preservation, artist edits, refusal of replaced sources, idempotence, private-draft isolation and the High-importer guard. Four host regressions use the actual exported seed metadata to verify one 330-instance layer after repeated preparation, all positive transforms and original centers/core ratios, no High fetch during shared appearance binding, shared live water color without recompilation, and restoration of capture-only draw ranges after successful or failed draws on both default and offscreen beauty targets. A real two-entry appearance-pool test checks the visible target meshes after A → B → A material swaps, rather than only the preparation clones. The ten checks and scoped ESLint passed. These deterministic checks do not measure FPS.

## Performance verification protocol

Before the change, the local in-app browser's existing viewer diagnostics reported **13 FPS** and a **133 ms** sampled maximum draw gap in a mobile viewport. This is one observation on the desktop host, without a verified CPU slowdown; it is not a result from the user's physical phone or a formal 4× benchmark.

Compare High and web runs on the same browser, viewport, device pixel ratio, background accents, bottle size, lighting, camera motion and rendering settings. Keep the existing frame cap and DPR unchanged. Measure a warm 20-second continuous motion segment separately from cold loading and first shader compilation. Record frame-time distribution or dropped frames, sampled viewer FPS/draw gaps, label-switch latency and long tasks. Run at least three repetitions; allow the device to cool between physical-phone runs.

For a requested 4× CPU comparison, set Performance → Capture settings → CPU to **4× slowdown** and keep Network at **No throttling** when isolating runtime motion. DevTools slowdown is relative to the host CPU and does not recreate a phone's CPU architecture. A mobile viewport alone is not CPU throttling. [Chrome's performance reference](https://developer.chrome.com/docs/devtools/performance/reference) documents these limits.

Check Network in a fresh page session: selecting the web Basil model must not request `glass-290-basil-high.bin.gz`, `glass-290-basil-neck.bin.gz` or `label-lab-basil-high.exr`. Check both homepage and Mockup, including transparent native output. Shared decorative water/ice captures may remain enabled by other accents; those are separate from Basil's removed High pipeline. Validate actual WebGL compilation and native PNG output as well as the deterministic asset/migration tests.

The available browser-control tool metadata in this session exposes no CPU-throttle or Chrome DevTools Protocol control. Node tests can verify geometry, source/mapping integrity and absence of High loading in the configured path; Node timings cannot certify GPU frame performance or a 4× browser trace. Hardware performance claims require the measurements above.

## Final validation

- Typecheck, scoped ESLint, the 47 High/web Basil checks, complete viewer tests and complete Mockup tests passed. Production build passed.
- Both homepage and Mockup reached ready with the web asset; WebGL compiled with no reported shader errors. White and transparent PNGs exported successfully.
- Final GPU exports: `artifacts/basil-290/web-optimized-white.png` and `artifacts/basil-290/web-optimized-transparent.png`. High reference exports remain beside them.
- A comparable post-change FPS or 4× CPU result was not established in this session. The in-app browser's later live diagnostics sampled about one draw per second with approximately 1,000 ms gaps for Basil and for the existing Juice can control (1 FPS, 1,017 ms gap). Those observations are not used to claim an improvement factor against the earlier High sample or infer a Basil-only bottleneck. The requested foreground DevTools 4× run remains for device testing.
