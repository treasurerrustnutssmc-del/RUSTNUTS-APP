#!/usr/bin/env python3
"""Render the website's tab and home-screen icons from the app's own icon.

Source: assets/icon.png (the skull mascot on black, the app's store icon).
Output: assets/site-icons/{favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png},
which `npm run build:site` copies into the website clone. Sizes mirror src/domain/siteIcons.ts.
Needs Pillow (pip install pillow). Run again after assets/icon.png changes.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
OUT = ROOT / "assets" / "site-icons"
PNGS = {"favicon-16x16.png": 16, "favicon-32x32.png": 32, "apple-touch-icon.png": 180}
ICO_SIZES = [16, 32, 48]


def square(size: int) -> Image.Image:
    return Image.open(SRC).convert("RGBA").resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in PNGS.items():
        square(size).save(OUT / name, optimize=True)
    base = square(max(ICO_SIZES))
    base.save(OUT / "favicon.ico", sizes=[(s, s) for s in ICO_SIZES])
    print(f"Wrote {len(PNGS) + 1} icons into {OUT}")


if __name__ == "__main__":
    main()
