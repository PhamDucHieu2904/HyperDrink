# Product Detail panel

The featured flavor’s **Explore** button opens a responsive product panel. Desktop uses a large poster on the left and editorial information on the right; mobile stacks the poster above the content. The three keyboard-accessible tabs contain the introduction, ingredients and nutrition table. Manufacturer, origin, net content, storage and shelf-life information remain below the tabs. Escape, the close button and clicking outside close the dialog and return focus to its opener.

## Editing

Open **Admin → Product Detail**. Create a record and select its **Nhãn liên kết**. Each active label can have one active detail record; edit that record to change its content. The panel follows the label actually applied by the 3D display, so switching flavors cannot display another label’s ingredients. A product without linked detail still has a basic panel; it does not invent ingredients or nutritional values. Currently the link uses the label applied in a 3D display. Standalone 2D displays without an applied label show the basic panel.

- Select a poster from any image category, or upload a new one. The poster preserves the image’s aspect ratio. Without a poster, the panel composes an illustration from the matching can thumbnail and fruit.
- Enter editorial text and nutrition values as printed on the approved label. Empty values display a dash; an empty nutrition table shows that the information has not been provided.
- Add or remove nutrition rows and extra titled sections using the form controls.
- **Xem trước panel** displays unsaved form changes with a matching valid catalog product. Saving remains a draft; **Phát hành** updates the public website.
- Turn off the detail to return to the basic panel. Delete removes the current draft record; existing release snapshots keep their original data.

The `productDetails` catalog collection is optional when reading older schema-v1 snapshots. Newly saved drafts and releases include it. A detail and its poster are exported only when the linked label is reachable from an enabled public product. Existing validation, revision checks, deletion, audit, release backups and standalone Pages media export apply to this collection.

UI labels have curated translations for all eight website languages. Editorial text, nutrient names and extra sections use the existing optional browser translation adapter; numbers, IDs, artwork and recorded quantities remain intact.

## Local prototype

`docs/samples/product-detail-mangosteen.json` contains the editable prototype. Ingredients, manufacturer/address, net content and nutrition were transcribed from the existing 330 ml Mangosteen label (`juice30-can330-mangosteen-label`, artwork media `b1ddfac4-d1d9-4bc5-b26a-3f7962d984f7`). The introduction and subtitle are sample editorial copy. No allergen claims have been added. The poster is a code composition until a dedicated poster is selected in admin.

The prototype was added to the local draft and a new local release after checking that all other reachable records matched the existing release. No GitHub push or external deployment was performed.
