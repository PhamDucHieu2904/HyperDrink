# Label alignment and Studio material controls

`Display3D.labelOffset` is an optional horizontal offset in percent, from -50 to 50. Missing values mean zero. One percentage point is 0.01 UV turns; the label texture repeats horizontally while its vertical UV, image orientation and model pose stay unchanged. Storefront and Studio resolve the same saved value.

The admin editor places the compatible label and offset in equal columns. Its live preview applies a UV transform without loading the artwork again. Saving uses the existing draft API and publishing flow.

Studio edits are local to the selected model/label/preset and apply to both the preview and native PNG. Switching selection restores that selection's profile; Reset materials restores every original material separately, including mixed materials in one semantic slot.

The right column contains Model controls followed by Export image. Lid, body and label finishes expand individually. Export settings expand beneath the current aspect/resolution summary; Download PNG stays outside that disclosure. The column scrolls independently when controls are expanded on shorter screens. The header contains Back to website, Mockup Studio, background options and language.

Smoothness is exposed as 0–100%, mapped to Three.js `roughness = 1 - smoothness / 100`. Metallic maps to `metalness`. Water edits update existing volume/scattering uniforms for Nata and Aloe without tinting their neutral transmission surface again. Interactive changes retain textures, geometry, optical shader programs, pose and camera framing.

Controls follow the model's semantic material slots. PET models expose a separate cap. The current can assets combine the lid with the aluminum body and expose the pull tab separately; the separate Lid controls are unavailable on those models. Body finish still adjusts their aluminum material. No artificial lid material is inferred from the pull tab.

Validation: `npm run test:mockup`, appearance ownership/pooling, Nata/Aloe optics, ProductViewer transitions, typecheck, targeted lint, and the admin API persistence/restart test. Browser QA covers real Studio controls, reset, native PNG, and the actual editor mounted with public data and memory-only save callbacks. That editor fixture is removed after QA.
