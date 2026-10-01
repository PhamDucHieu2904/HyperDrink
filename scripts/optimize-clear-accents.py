"""Optimize user-supplied RGBA accent artwork without changing its design.

Usage: python scripts/optimize-clear-accents.py --source-dir "D:/Vinut-TK/Downloads"
Source PNGs stay outside the repository. Pillow and WebP support are required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

ASSETS = [
    ("Giọt nước thủy tinh trong suốt lấp lánh.png", "droplet-clear-01.webp", "droplet", 192),
    ("Vòng nước trong suốt lấp lánh.png", "droplet-clear-02.webp", "droplet", 192),
    ("Giọt nước trong suốt lấp lánh.png", "droplet-clear-03.webp", "droplet", 192),
    ("Vòng nước trong suốt lấp lánh (1).png", "droplet-clear-04.webp", "droplet", 192),
    ("Khối băng trong suốt lấp lánh.png", "ice-clear.webp", "ice", 384),
]
PADDING_FRACTION = 0.07


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alpha_stats(image: Image.Image) -> dict:
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    total = image.width * image.height
    return {
        "minimum": min(value for value, count in enumerate(histogram) if count),
        "maximum": max(value for value, count in enumerate(histogram) if count),
        "transparentPixels": histogram[0],
        "partialPixels": sum(histogram[1:255]),
        "opaquePixels": histogram[255],
        "coverageFraction": round(sum(value * count for value, count in enumerate(histogram)) / (255 * total), 6),
        "contentBounds": list(alpha.getbbox()) if alpha.getbbox() else None,
    }


def prepare(image: Image.Image, long_side: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("Artwork is fully transparent.")
    cropped = image.crop(bounds)
    # Padding is added outside the alpha bounding box only. Transparent areas
    # inside the subject are preserved and never interpreted as removable space.
    padding = math.ceil(max(cropped.size) * PADDING_FRACTION / (1 - 2 * PADDING_FRACTION))
    side = max(cropped.size) + padding * 2
    padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    padded.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    scale = min(1, long_side / max(padded.size))
    dimensions = (max(1, round(padded.width * scale)), max(1, round(padded.height * scale)))
    # Premultiplied-alpha filtering keeps the bright subject edge free of black
    # halos when opaque highlights border transparent pixels.
    resized = padded.convert("RGBa").resize(dimensions, Image.Resampling.LANCZOS).convert("RGBA")
    return resized, bounds


def compression_error(reference: Image.Image, decoded: Image.Image) -> dict:
    expected = reference.convert("RGBa").tobytes()
    actual = decoded.convert("RGBa").tobytes()
    errors = [a - b for index, (a, b) in enumerate(zip(expected, actual)) if index % 4 != 3]
    mse = sum(error * error for error in errors) / len(errors)
    return {
        "premultipliedRgbRmse": round(math.sqrt(mse), 4),
        "premultipliedRgbPsnrDb": round(10 * math.log10(255 * 255 / mse), 3) if mse else None,
        "alphaExact": reference.getchannel("A").tobytes() == decoded.getchannel("A").tobytes(),
    }


def generate(source_dir: Path, output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for source_name, output_name, kind, long_side in ASSETS:
        source_path, output_path = source_dir / source_name, output_dir / output_name
        with Image.open(source_path) as original:
            source_mode = original.mode
            source = original.convert("RGBA")
        if source.getchannel("A").getextrema()[0] == 255:
            raise ValueError(f"{source_name}: source has no alpha transparency.")
        optimized, bounds = prepare(source, long_side)
        optimized.save(output_path, "WEBP", quality=94, alpha_quality=100, method=6, exact=True)
        with Image.open(output_path) as encoded:
            decoded = encoded.convert("RGBA")
        error = compression_error(optimized, decoded)
        if not error["alphaExact"]:
            raise ValueError(f"{output_name}: WebP encoder altered alpha.")
        if error["premultipliedRgbRmse"] > 5:
            raise ValueError(f"{output_name}: premultiplied RGB compression error is unexpectedly high.")
        alpha = decoded.getchannel("A")
        if any(alpha.getpixel((x, y)) for x, y in (
            *[(x, 0) for x in range(decoded.width)], *[(x, decoded.height - 1) for x in range(decoded.width)],
            *[(0, y) for y in range(decoded.height)], *[(decoded.width - 1, y) for y in range(decoded.height)],
        )):
            raise ValueError(f"{output_name}: padding did not preserve clear sampling borders.")
        entries.append({
            "id": Path(output_name).stem,
            "kind": kind,
            "src": "/assets/scene/" + output_name,
            "width": decoded.width, "height": decoded.height,
            "bytes": output_path.stat().st_size, "sha256": sha256(output_path),
            "alpha": alpha_stats(decoded), "qualityCheck": error,
            "source": {
                "filename": source_name, "width": source.width, "height": source.height,
                "mode": source_mode, "bytes": source_path.stat().st_size, "sha256": sha256(source_path),
                "alpha": alpha_stats(source), "cropBounds": list(bounds),
            },
        })
    manifest = {
        "schemaVersion": 1,
        "source": "User-provided transparent PNG artwork, 2026-10-01",
        "processing": {
            "crop": "Only the outer bounds where alpha is exactly zero; interior transparency retained",
            "outerPaddingFraction": PADDING_FRACTION,
            "resize": "Premultiplied RGBA Lanczos; artwork aspect preserved inside a centered square canvas",
            "webp": {"quality": 94, "alphaQuality": 100, "method": 6, "exact": True},
            "colorChanges": "None; original white highlights and RGB reflections retained",
        },
        "assets": entries,
        "totalSourceBytes": sum(entry["source"]["bytes"] for entry in entries),
        "totalOutputBytes": sum(entry["bytes"] for entry in entries),
    }
    manifest_path = output_dir / "clear-accents.manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent.parent / "public/assets/scene")
    args = parser.parse_args()
    manifest = generate(args.source_dir, args.output_dir)
    print(json.dumps({
        "totalSourceBytes": manifest["totalSourceBytes"], "totalOutputBytes": manifest["totalOutputBytes"],
        "assets": [{key: entry[key] for key in ("id", "width", "height", "bytes", "qualityCheck")} for entry in manifest["assets"]],
    }, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
