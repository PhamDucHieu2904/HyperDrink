# Admin refinement — 3 October 2026

## Artwork compatibility

`can-wrap-v1` identifies an artwork/UV convention. It remains in the data contract and compatibility checks: two models with the same volume can still have different label layouts. This change does not inspect or reconstruct GLB UVs.

Label Library now asks for packaging only when its active models share one layout. The layout is filled automatically. If several layouts exist, the user chooses a model by its human-readable name. Existing custom layout values are retained. New model records inherit the packaging's convention; a new packaging receives a stable convention. A model author can override it in Technical settings when preparing a different GLB layout.

The raw code is removed from ordinary label forms and model list descriptions. The backend still rejects incompatible artwork at publication.

## Display panel

The Create 3D/2D Display button opens a native modal immediately. The previous always-visible editor at the bottom of the list is removed. Clicking a row opens the same panel in edit mode. It has a close button, Escape handling, unsaved-change protection, a preview, and sticky save actions. Keyboard focus starts on the product group.

Saving closes the panel, refreshes the list and announces the saved draft. Clicking Create again starts an empty form with a fresh identity. Existing combinations remain protected from duplicate creation.

## Fruit pools

50 distinct images were generated with the built-in `image_gen` tool, then resized to a maximum edge of 640 px and encoded as alpha WebP. Total project asset size: 4,036,820 bytes, excluding the manifest. The final files and complete prompt set are in [the manifest](../public/assets/demo-fruit-pool/manifest.json).

Subjects cover 24 Juice flavors and one berry set. The four older flavors reuse the appropriate generated orange, berry, peach and lime media. The authenticated local importer added 50 media records and 56 fruit assignments to 28 active flavors, two images per flavor. Existing labels, models, packaging, colors and user configuration were not changed by the importer. Leaf and splash pools were not seeded in this task.

The resolver selects only the current flavor's active ready media, assigns the two fruit images to the existing scene positions and keeps the selection stable for the current seed. The preview Change image set button skips identical draws when alternatives exist.

Assets live in `public/assets/demo-fruit-pool/`. Backend-uploaded copies are stored through the existing media pipeline. Import reruns are idempotent: the second run uploaded zero images and created zero assignments. Credentials were passed in memory and are not saved in source or documentation.

The active public release remains `ede462c0-0398-4195-9157-8f2b32532963`. New pools can be inspected in draft 3D Display previews. Publishing/exporting the updated catalog is a separate admin action. No GitHub push or deployment was performed.

Current draft preflight still reports five issues outside this change: the 320 ml model needs a poster, three existing variants lack compatible displays, and another display lacks media. These records were not edited by this task; the new fruit pools themselves resolve correctly.

## Verification

- Lint and TypeScript checks pass.
- Admin domain/media/API/resolver checks and five new layout inference cases pass. Resolver coverage includes twelve consecutive changes with a two-image pool and the bounded empty-pool fallback.
- Actual browser: creating A then B produced two different display and product IDs. Reopening A opened edit mode with A's data. Both disposable test displays and variants were archived after verification.
- Actual Label Library: the 330 ml compatibility row has no UV text input and preserves the existing compatibility.
- Actual preview: Lime fruit cutouts load through the authenticated media route alongside the existing water/ice scene. Desktop at 1440×1000 and panel sizing at 390×780 were checked; the mobile close control remains visible and no horizontal overflow appears.
- For all 28 draft flavors, twelve seeds resolve exactly two own-flavor images and two different arrangements.
- All 50 generated WebP files have alpha, at least 15% fully transparent pixels, maximum dimensions of 640 px, and recorded SHA-256 checksums. The full contact sheet was visually inspected.

Local QA screenshots are ignored by Git: `docs/screenshots/demo-fruit-pool-2026-10-03.png` and `docs/screenshots/admin-display-panel-fruit-2026-10-03.png`.

## Leaf pool follow-up

18 separate photorealistic leaf cutouts were generated with the built-in `image_gen` tool: six citrus leaves, six mint leaves and six broad tropical leaves. They are decorative demo greenery, not a botanical species guarantee for every flavor. Each family includes different blade shapes, viewpoints, curves and a two-leaf sprig.

Final assets and the complete prompt set are in [`public/assets/demo-leaf-pool/manifest.json`](../public/assets/demo-leaf-pool/manifest.json). They preserve transparent alpha, have a maximum edge of 640 px and total 984,588 bytes. `scripts/prepare-demo-fruits.cjs` now accepts an optional `leaf` role to reuse its WebP optimization and contact-sheet QA. Its default fruit behavior is retained.

The authenticated local `scripts/import-demo-leaves.cjs` importer uploaded 18 shared leaf media and added 168 assignments to 28 active flavors: six distinct images per flavor. Citrus flavors use citrus leaves, berry/strawberry/grape use mint, and the remaining flavors use the broad-leaf demo family. Each flavor's pool can be changed independently in Flavor Data. Re-running the importer creates zero extra media or assignments.

All 28 flavors were checked across twelve seeds (336 scenes). Every scene resolves six different own-pool leaf images, two fruit images and no enabled individual droplets. Leaf position, rotation, size, blur and idle motion match the existing preset. The other catalog configuration and all 56 fruit assignments remain unchanged. The active public release is still `ede462c0-0398-4195-9157-8f2b32532963`.

Admin media tests (10), resolver tests (12), and lint of the touched scripts pass. The full leaf contact sheet and actual admin preview were visually checked. New local QA screenshots: `docs/screenshots/demo-leaf-pool-2026-10-03.png` and `docs/screenshots/admin-leaf-pools-2026-10-03.png`. These changes remain in the local draft; no publication or GitHub push was performed.

## Find and repair publication errors

Preflight findings now have direct repair buttons. They open a modal over the existing publication checklist, so closing an editor returns to the same findings. Saving a change invalidates the previous check and asks the user to run preflight again. No correction is saved automatically.

Missing displays have no list row. Their repair action opens a new 3D/2D form with the existing product group, packaging, flavor, name, code and description already filled. The relevant model/image selector receives focus. If a configuration exists but is disabled, the action opens that existing configuration instead of preparing a duplicate.

Poster findings open the actual model record and focus the poster picker, with an inline error and the model name in the sticky dialog header. Compatibility validation identifies poster dependencies as `modelId.posterId`, rather than mislabeling them as a missing model. The UI also understands the old running API's missing-poster finding. Ordinary user-facing errors display readable instructions and action names instead of raw database field names.

Browser verification used all five current findings: Alu can 320 ml and Peach both opened the 320 ml poster field; Lychee, Mango and Strawberry opened distinct prefilled creation forms. All modals were closed without saving or creating records. Lint, TypeScript and all 72 admin checks pass, including six navigation/compatibility regression cases. The existing draft still needs its poster and three display configurations before it can be published. Local QA screenshots are saved under `docs/screenshots/admin-issue-*.png`.

## Delete the data behind a publication finding

Each record-backed finding now has a separate **Xóa dữ liệu** button. It opens a confirmation listing the actual draft records to be permanently removed. Product combination deletion also removes its owned 3D/2D display records, including archived configurations, while retaining shared flavor, artwork, model and media libraries. This is actual removal from the draft graph, distinct from the existing recoverable archive action.

If the combination is a slot's default, the confirmation previews its replacement. A sibling with a compatible enabled display is preferred. In the current draft, deleting Lychee would change Boba 320 ml's default to Peach. Deletion is blocked when shared references remain or it would introduce new publication errors, such as leaving a visible slot without any product. It does not silently disable the remaining catalog to bypass validation.

The authenticated delete endpoint validates the record revision and the complete reviewed draft hash inside one SQLite transaction. Record deletion, owned display deletion, default changes and audit entries commit together. A stale confirmation returns HTTP 409 without writing anything. The response contains the updated catalog and a fresh file-aware preflight result so the UI immediately shows the remaining findings. Releases and media files retained by published snapshots are preserved.

Seven new domain/API regression tests cover real record removal, owned/archived display scope, ready default selection, shared/nested references, the last visible product, stale confirmation, authentication/origin enforcement, audit actor identity, database reopen and unchanged published content. All 79 admin checks, lint and TypeScript pass.

Actual browser checks opened each of the three current Boba confirmations and verified Cancel, X, Escape and focus restoration. At 390×780 the dialog and buttons fit without horizontal overflow. No existing user records were deleted during verification. Screenshots: `docs/screenshots/admin-issue-delete-confirm.png`, `admin-issue-delete-mobile.png` and `admin-issue-delete.png`. The admin local server was restarted to load the new endpoint. No publication or GitHub push was performed.

## Repair display creation and publication panel

The existing Peach display had previously been created as Lychee, then renamed and reassigned while retaining its stable Lychee slug. Creating the missing Lychee configuration generated that same slug and failed even though no active Lychee display appeared in the list. The old multi-request save had already updated the product variant before failing on the display, leaving a partially saved draft.

Display creation now allocates an available internal slug inside the repository transaction; editing retains the existing identity and slug. Product variant, display, optional packaging-slot changes and audit entries commit together through an authenticated display-save endpoint. A duplicate product/display combination still receives a readable error. Revision conflicts or late validation failures write nothing and retain the form input.

The publication repair panel rendered outside the admin workspace and inherited the storefront's white text and accent tokens. The display dialog now establishes its own workspace context. Its body alone scrolls, keeping the header and close control visible after a field is focused. Failed submissions focus and reveal the inline error.

The actual missing Boba 320 ml Lychee configuration was saved successfully from the publication finding using Alu can 320 ml and its compatible Lychee label. It reused the existing partially created Lychee product variant and added one distinct display. A comparison against the pre-repair draft confirms that every previous display, including Peach, is unchanged; product count and slot settings are unchanged. File-aware publication preflight now reports **0 errors and 0 warnings**. The active public release remains unchanged.

Five added domain/API cases cover the legacy renamed-slug collision, separate identical display names, stable editing, duplicate combinations, authentication/origin checks, persistence, audit actor identity and rollback of late slot conflicts. All **84 admin checks**, full lint and TypeScript pass. Actual browser verification covered both creation entry points, successful preflight repair, duplicate-submit recovery and a 390×780 clean edit with a visible close control and no horizontal overflow. The local API was restarted to load the new endpoint. No publication or GitHub push was performed.

Local QA screenshots: `docs/screenshots/admin-display-repair-panel.png`, `admin-display-repair-list.png`, `admin-display-repair-preflight.png` and `admin-display-repair-mobile.png`.

## Remove old release history

Old release cards now offer **Xóa bản này** beside rollback. A confirmation identifies the timestamp, note, publisher and ID, and explains that the snapshot is permanently removed and can no longer be restored. Cancel receives initial focus; Cancel, X and Escape close without writing. The active release has no delete control. Only the owner can delete history.

The authenticated release-delete endpoint checks the reviewed active release ID inside the SQLite transaction. It blocks active, missing and stale targets before writing, then removes the actual release snapshot and its publish-request references with an audit entry. Deleted request keys are retained as tombstones so delayed publication retries cannot recreate a deliberately removed release. Published media metadata remains reachable for previously opened pages; draft-only uploads remain private and no media files or draft records are removed. The current public catalog stays unchanged.

All **23 API integration checks**, targeted lint and TypeScript pass. Three added cases cover durable removal/database reopen, media privacy and availability, unchanged draft/public data, remaining rollback history, delayed retries, owner/authentication/origin requirements, active/stale/invalid confirmations, and complete transaction rollback after a late audit failure. Browser checks verified Cancel, X, Escape, focus restoration, the active card without destructive controls and a 390×780 confirmation without horizontal overflow. The local admin server was restarted to load the endpoint.

All 19 existing user releases were preserved during QA; before/after hashes of the draft and release rows matched, with the same active release. Screenshots: `docs/screenshots/admin-release-delete-confirm.png`, `admin-release-delete-mobile.png` and `admin-release-history-delete.png`. No publication or GitHub push was performed.

## Preserve decorative image proportions

Imported fruit and leaf WebPs already retained their original canvas ratio (for example Mango is 640×427), but the accent renderer mapped every standalone image onto a square plane. This stretched landscape artwork vertically and portrait artwork horizontally. The file conversion and pool selection were not responsible.

Standalone images now use their decoded width/height ratio, with the longest canvas edge fitted to the existing slot scale. Alpha-bound framing and the conservative clearance radius use the actual rectangular geometry. CSS Hard Light splash images use matching rectangular dimensions and projection. Legacy atlas cells keep their authored geometry; GLB normalization is unaffected. The shared renderer applies to admin previews and storefront scenes without changing catalog data or image files.

All 36 accent checks, targeted lint and TypeScript pass. Regression coverage verifies wide/tall/square bitmap proportions after rotation, visible alpha bounds within mobile/desktop frames, product clearance, rectangular Hard Light projection and unchanged atlas-cell sizing. Actual browser previews were compared with original Mango, Mangosteen, Pomegranate and Pineapple images, including the narrow Mobile preview. QA screenshots: `docs/screenshots/admin-fruit-aspect-before.png`, `admin-fruit-aspect-after.png`, `admin-fruit-aspect-mobile.png`, `admin-fruit-aspect-mangosteen.png`, `admin-fruit-aspect-pomegranate.png` and `admin-fruit-aspect-pineapple.png`. No publication or GitHub push was performed.

## Fruit icons in the flavor rail

The lower flavor rail now uses the first ready active image from each flavor's enabled fruit pool, ordered by assignment position with a stable identity tie-breaker. It no longer uses the general flavor thumbnail, which currently contains label artwork for some products. Scene randomization does not change button identity. Disabled, archived, missing, unready and wrong-role assets are skipped; a missing usable pool retains the readable flavor name and existing placeholder. The flavor dialog shares these fruit images.

The All flavors button and its callback are removed from every rail copy. The carousel measures only real flavor buttons and retains its selection, dragging, looping and keyboard behavior. Fruit cutouts fit within the existing glass circles with `object-fit: contain`, preserving their canvas ratio and complete silhouette.

All 59 catalog/carousel checks, targeted lint and TypeScript pass. Browser verification on the current published local website at 390×850 confirmed four Boba buttons (Lychee, Mango, Peach and Strawberry), four loaded fruit images, no All flavors button, no horizontal overflow and successful Mango selection. Desktop viewport was restored afterward. Screenshots: `docs/screenshots/flavor-fruit-buttons-mobile.png`, `flavor-fruit-buttons-mobile-full.png` and `flavor-fruit-buttons-desktop.png`. No catalog records, publication or GitHub push were changed by this task.
