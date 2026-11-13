#!/usr/bin/env python3
"""Convertit les captures (build/shots/*.png) en images du site (docs/assets).

    node scripts/site-screenshots.mjs && python3 scripts/site-images.py
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = root / "build" / "shots"
dst = root / "docs" / "assets"
dst.mkdir(parents=True, exist_ok=True)

# nom → largeur maximale en pixels (images en 2x)
SIZES = {"hero": 2200, "ai-menu": 1520, "equations": 1800, "recovery": 1100, "report": 1200, "broken": 1100, "docx-folio": 1100, "docx-other": 1100}

for name, width in SIZES.items():
    img = Image.open(src / f"{name}.png").convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.save(dst / f"{name}.webp", "WEBP", quality=84, method=6)
    print(f"{name}.webp {img.width}×{img.height} {(dst / f'{name}.webp').stat().st_size // 1024} Ko")

social = Image.open(src / "social.png").convert("RGB")
social.save(dst / "social.jpg", "JPEG", quality=86, optimize=True, progressive=True)
print(f"social.jpg {social.width}×{social.height} {(dst / 'social.jpg').stat().st_size // 1024} Ko")
