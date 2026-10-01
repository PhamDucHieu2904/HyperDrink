# Transparent water splash

Created using the built-in `image_gen` tool, with actual transparent RGBA output. The user-supplied stock image was a visual reference only; the new artwork is original and contains no text or watermark.

The production asset is `public/assets/scene/water-splash-clear.webp`: 768 × 768 pixels, 152,216 bytes. It preserves the original neutral white reflections and alpha, including the empty central opening. Export uses premultiplied-alpha Lanczos resizing and WebP quality 92; decoded alpha equals the resized source exactly. The original generated PNG stays in the local image library and is not shipped to the browser.

`public/assets/scene/water-splash.manifest.json` records dimensions, hashes, alpha statistics and compression validation. Re-export with `python scripts/optimize-water-splash.py --source /path/to/generated.png`.

The splash is a separately configurable accent node behind the product and all other accents, sharing their reveal/fade lifecycle. Its image, transform and idle settings can be replaced through the existing serialized accent-scene configuration.

## Final generation prompt

```text
Use case: ads-marketing. Asset type: transparent water splash cutout for a premium beverage website, layered behind a separate 3D can and fruit. Create a new original high-speed macro photograph of one thin clear-water splash, viewed nearly front-on: an irregular asymmetrical annular burst around a large completely empty transparent central opening. Overall upright oval composition, about 1:1.15, with fine fluid sheets, curved ripples, elegant branching jets reaching outward, several suspended small drops connected compositionally. The splash should look naturally wet and lightweight, not a thick glass ring or a solid cylinder. Cool-neutral clear water, bright restrained white specular reflections and a few soft gray shadow edges, translucent interiors revealing the background, no colored tint, no opaque gray fill. Carefully controlled broad studio light, realistic surface tension and crisp natural detail. Leave approximately the central 45% width and 60% height empty so a product can covers the center, with the visible water mainly extending around its sides. All splash extremities and stray drops fully inside the square canvas with 8% transparent margin. Real transparent RGBA background and transparent center, no black or white backdrop, no environment, no can, no fruit, no leaves, no ice cubes, no text, no watermark. Visually clean composition, readable at 500-800 pixels, avoid a dense fog of tiny dots.
```
