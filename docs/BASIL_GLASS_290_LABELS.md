# Basil seed 290 ml production labels

Imported on 2026-10-09 from `D:/Vinut-TK/Downloads/resized-images (33)`. The ten 1000 × 660 WebP artworks are copied unchanged into `public/assets/labels/basil-seed`, with checksum filenames and a source manifest. Flavor names were checked against the text printed on each artwork.

| Source number | Flavor | Homepage |
| --- | --- | --- |
| 1 | Mango | Enabled |
| 2 | Mixed Fruit | Disabled |
| 3 | Strawberry | Enabled |
| 4 | Pineapple | Disabled |
| 5 | Pomegranate | Disabled |
| 6 | Lychee | Disabled |
| 7 | Blueberry | Enabled |
| 8 | Passion Fruit | Enabled |
| 9 | Peach | Disabled |
| 10 | Red Grape | Enabled |

All ten variants and 3D profiles remain in the admin draft. All ten compatible labels are available in Mockup Studio. Public homepage profiles include only the requested five flavors. Red Grape remains the packaging default and retains its existing `#be2838` liquid color. The authored gold cap, geometry, UV contract, finish settings and presentation settings are preserved. Artist color and horizontal label offset overrides survive a repeated import.

Existing fruit, leaf and ice pools are reused by matching flavor. Blueberry has no dedicated fruit asset in the current library, so it receives leaves and ice only; mixed-berry artwork is not assigned as blueberry. Its printed bottle artwork and blue liquid profile are included.

```powershell
node scripts/import-basil-labels.cjs
node --test scripts/tests/basil-production.test.cjs
node scripts/import-basil-labels.cjs --apply
```

The default command is a read-only preflight. Apply independently merges the active local release and draft, preserving unpublished edits, saves a recovery snapshot, checks concurrent catalog changes, creates a scoped release and exports the public catalog. The importer honors the release limit and is idempotent.

Local release: `2b5b6935-494c-4d86-a4a5-e800e1d1fd07`. Recovery snapshot: `data/admin/basil-production-backups/before-1791540551862.json`. Comparison confirmed that 1,315 unrelated draft records and 884 unrelated published records remained identical. The now-unused blank label media is pruned from the public release but remains in the admin draft.

Five import tests and scoped ESLint passed. A repeated dry run reported zero changes. Browser verification confirmed ten compatible labels in Studio, the Strawberry front label and water color, and exactly five selectable Basil seed flavors on the homepage. Screenshot: `docs/screenshots/basil-290-strawberry-2026-10-09.png`.
