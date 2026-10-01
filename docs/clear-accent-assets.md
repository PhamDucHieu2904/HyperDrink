# Clear water and ice artwork

These five WebP textures are derived from the transparent PNGs supplied by the user on 2026-10-01. The source PNGs remain outside the repository. The optimized images preserve the supplied artwork, original white highlights and RGB reflections; they are not shader reconstructions or regenerated pictures.

| Runtime asset | User-supplied source | Canvas |
| --- | --- | --- |
| `/assets/scene/droplet-clear-01.webp` | Giọt nước thủy tinh trong suốt lấp lánh.png | 192 × 192 |
| `/assets/scene/droplet-clear-02.webp` | Vòng nước trong suốt lấp lánh.png | 192 × 192 |
| `/assets/scene/droplet-clear-03.webp` | Giọt nước trong suốt lấp lánh.png | 192 × 192 |
| `/assets/scene/droplet-clear-04.webp` | Vòng nước trong suốt lấp lánh (1).png | 192 × 192 |
| `/assets/scene/ice-clear.webp` | Khối băng trong suốt lấp lánh.png | 384 × 384 |

The script trims only completely transparent outer margins, centers the artwork on a square canvas and adds transparent padding equal to 7% of the final canvas width on each side. The cropped bounds fill approximately 86% of the finished canvas; the visually prominent shape can occupy less where the original artwork contains faint alpha pixels outside it. Its proportions and all interior transparent areas remain intact. Square planes can therefore display the textures without stretching the artwork. Keep clamp-to-edge sampling; do not crop the padding off in the viewer.

Resize uses premultiplied RGBA Lanczos filtering to avoid dark fringes around white highlights. WebP uses quality 94, method 6 and lossless alpha quality 100. Every generated file is decoded and checked for exact alpha equality with the resized baseline, fully transparent sampling borders and low premultiplied RGB compression error. Source/output dimensions, byte counts, hashes, alpha coverage and quality metrics are recorded in `public/assets/scene/clear-accents.manifest.json`.

Reproduce from the supplied originals with Pillow:

```powershell
python scripts/optimize-clear-accents.py --source-dir 'D:/Vinut-TK/Downloads'
```

The four water textures are suitable for roughly 32–56 CSS pixel accents at typical mobile DPR values. The 384px ice texture supports approximately 80–120 CSS pixel accents at DPR 3. More prominent future layouts should use larger exported resolutions through the same pipeline rather than stretching these beyond their useful resolution. Treat texture sizing separately from animation scale and keep the original source artwork available outside the shipped site.
