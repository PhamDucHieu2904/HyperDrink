"""Export the supplied RGBA water splash as a web-ready transparent WebP.

Usage: python scripts/optimize-water-splash.py --source /path/to/Splash-water.png
The source remains outside the repository. No recoloring or alpha extraction.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("clear_accents", project / "scripts/optimize-clear-accents.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    with Image.open(args.source) as original:
        source = original.convert("RGBA")
    if source.getchannel("A").getextrema()[0] == 255:
        raise ValueError("Supplied splash must have real alpha transparency.")
    image, bounds = helper.prepare(source, 768)
    output = project / "public/assets/scene/water-splash-user.webp"
    image.save(output, "WEBP", quality=92, alpha_quality=100, method=6, exact=True)
    with Image.open(output) as encoded:
        decoded = encoded.convert("RGBA")
    error = helper.compression_error(image, decoded)
    if not error["alphaExact"]:
        raise ValueError("WebP encoder altered transparency.")
    manifest = {
        "schemaVersion": 1,
        "source": "User-supplied Splash water.png, 2026-10-01; artwork and alpha preserved",
        "promptDocument": "docs/water-splash-asset.md",
        "processing": {
            "crop": "Only fully transparent outer margins",
            "resize": "768px square, premultiplied RGBA Lanczos, natural aspect preserved, 7% transparent padding",
            "webp": {"quality": 92, "alphaQuality": 100, "method": 6, "exact": True},
            "colorChanges": "None",
        },
        "asset": {
            "src": "/assets/scene/" + output.name,
            "width": decoded.width, "height": decoded.height,
            "bytes": output.stat().st_size, "sha256": helper.sha256(output),
            "alpha": helper.alpha_stats(decoded), "qualityCheck": error,
        },
        "original": {
            "width": source.width, "height": source.height,
            "bytes": args.source.stat().st_size, "sha256": helper.sha256(args.source),
            "cropBounds": list(bounds),
        },
    }
    (output.parent / "water-splash.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["asset"], indent=2))


if __name__ == "__main__":
    main()
