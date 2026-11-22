"""Generates HammelArt Atelier desktop .ico and preview PNG from src/theme.js Crest."""

from __future__ import annotations

import os
import re
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_JS = os.path.join(ROOT, "src", "theme.js")
ASSETS_DIR = os.path.join(ROOT, "assets")


def load_crest_points() -> list[tuple[float, float]]:
    with open(THEME_JS, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r'HAMMELART_CREST_PATH\s*=\s*"([^"]+)"', text)
    if not m:
        raise RuntimeError("HAMMELART_CREST_PATH not found in src/theme.js")
    nums = [float(v) for v in re.findall(r"[-+]?\d*\.?\d+", m.group(1))]
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]


def generate_icons() -> tuple[str, str]:
    os.makedirs(ASSETS_DIR, exist_ok=True)
    pts = load_crest_points()

    S = 1024
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Subtle outer purple ambient glow under badge
    glow_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    pad = 72
    r = 220
    gd.rounded_rectangle([pad, pad, S - pad, S - pad], radius=r, outline=(168, 85, 247, 210), width=42)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(28))
    img = Image.alpha_composite(img, glow_layer)

    # Dark obsidian studio badge base + crisp neon-violet rim
    badge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.rounded_rectangle(
        [pad, pad, S - pad, S - pad],
        radius=r,
        fill=(14, 12, 24, 255),
        outline=(168, 85, 247, 255),
        width=28,
    )
    # Inner lavender specular hairline
    bd.rounded_rectangle(
        [pad + 18, pad + 18, S - pad - 18, S - pad - 18],
        radius=r - 18,
        outline=(216, 166, 255, 110),
        width=6,
    )
    img = Image.alpha_composite(img, badge)

    # Scale Crest (1024 x 960 source box) neatly centered inside badge
    scale = 0.58
    off_x = (S - 1024 * scale) * 0.5
    off_y = (S - 960 * scale) * 0.5 + 10
    scaled = [(x * scale + off_x, y * scale + off_y) for x, y in pts]

    crest_glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cgd = ImageDraw.Draw(crest_glow)
    cgd.polygon(scaled, fill=(168, 85, 247, 175))
    crest_glow = crest_glow.filter(ImageFilter.GaussianBlur(20))
    img = Image.alpha_composite(img, crest_glow)

    crest = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(crest)
    cd.polygon(scaled, fill=(238, 224, 255, 255))
    img = Image.alpha_composite(img, crest)

    png_path = os.path.join(ASSETS_DIR, "hammelart_icon.png")
    ico_path = os.path.join(ASSETS_DIR, "hammelart_gallery.ico")
    img.resize((256, 256), Image.Resampling.LANCZOS).save(png_path, format="PNG")
    img.save(
        ico_path,
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    return ico_path, png_path


if __name__ == "__main__":
    ico, png = generate_icons()
    print("Generated:", ico, png)
