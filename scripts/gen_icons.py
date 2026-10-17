#!/usr/bin/env python3
"""Regenerates every raster icon for arc from the geometry in assets/*.svg.

Outputs:
  src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png, icon.ico, icon.icns
  flatpak/icons/{16,32,48,64,128,256,512}/com.arc.cad.png
  frontend/public/{favicon.svg (copied from assets/logo.svg), icon-192.png,
                   icon-512.png, apple-touch-icon.png}
  site/assets/{logo.svg, logo-dark.svg, icon.svg, favicon.svg, favicon-32.png,
               icon-192.png, icon-512.png, og.png}

Run from the repo root:  ./scripts/gen_icons.py  (optional args: output filters)
Requires: python3 with Pillow. No SVG rasterizer needed: the ring geometry is
reproduced here from the same constants as the SVG sources in the assets
directory.
"""

from __future__ import annotations

import io
import math
import shutil
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
S = 4  # supersampling factor for raster drawing

# shared geometry, must mirror assets/logo.svg
V = 512.0
C = 256.0
R1, W1 = 168.0, 48.0  # outer ring: centerline radius + stroke width
R2, W2 = 84.0, 48.0   # inner ring
RX = 95.0             # app-icon background corner radius
# outer ring: PIL angles sweep from east (0) clockwise to north (270)
# inner ring: from west (180) clockwise to south (450)
RINGS = (
    {"r": R1, "w": W1, "bbox_l": C - R1, "bbox_r": C + R1, "a0": 0.0, "a1": 270.0, "flip": False},
    {"r": R2, "w": W2, "bbox_l": C - R2, "bbox_r": C + R2, "a0": 180.0, "a1": 450.0, "flip": True},
)

# ---- palette ---------------------------------------------------------------
BLUE = (0x58, 0xA9, 0xFF)
VIOLET = (0x9E, 0x6B, 0xFA)
BG_HI = (0x17, 0x1A, 0x23)
BG_LO = (0x0B, 0x0E, 0x14)
BANNER_BG = (0x0B, 0x0E, 0x14)
BANNER_FG = (0xE8, 0xEC, 0xF6)
BANNER_SUB = (0x9A, 0xA3, 0xB4)


def lerp(a, b, t):
    return tuple(round(fa + (fb - fa) * t) for fa, fb in zip(a, b))


def ring_color(t, flip):
    return lerp(VIOLET, BLUE, t) if flip else lerp(BLUE, VIOLET, t)


def draw_mark(size: int) -> Image.Image:
    """The two-ring mark on a transparent canvas."""
    px = size * S
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    steps = 160
    for ring in RINGS:
        r, w = ring["r"], ring["w"]
        bbox = [(C - r - w / 2), (C - r - w / 2), (C + r + w / 2), (C + r + w / 2)]
        bbox = [v * (size / V) * S for v in bbox]
        a0, a1 = ring["a0"], ring["a1"]
        for k in range(steps):
            start = a0 + (a1 - a0) * k / steps
            end = a0 + (a1 - a0) * (k + 1) / steps
            mid = math.radians((start + end) / 2.0)
            x = C + r * math.cos(mid)
            t = (x - ring["bbox_l"]) / (ring["bbox_r"] - ring["bbox_l"])
            draw.arc(bbox, start, end + 1.0, fill=ring_color(t, ring["flip"]),
                     width=round(w * (size / V) * S))
        # round line caps at both endpoints
        for a in {a0 % 360.0, a1 % 360.0}:
            rad = math.radians(a)
            ex = (C + r * math.cos(rad)) * (size / V) * S
            ey = (C + r * math.sin(rad)) * (size / V) * S
            cap_r = (w / 2) * (size / V) * S
            t = ((C + r * math.cos(rad)) - ring["bbox_l"]) / (ring["bbox_r"] - ring["bbox_l"])
            col = ring_color(t, ring["flip"])
            draw.ellipse([ex - cap_r, ey - cap_r, ex + cap_r, ey + cap_r], fill=col)
    return canvas.resize((size, size), Image.LANCZOS)


def draw_icon(size: int) -> Image.Image:
    """App icon: rounded-square radial background + the mark."""
    px = size * S
    grad = Image.radial_gradient("L").resize((px, px), Image.BILINEAR)
    grad = grad.point(lambda v: min(255, int(v * 255.0 / 179.0)))
    hi, lo = BG_HI, BG_LO
    bg = Image.merge("RGB", tuple(grad.point(lambda v, a=lo[i], b=hi[i]: int(a + (b - a) * v / 255.0))
                                  for i in range(3)))
    bg = bg.convert("RGBA")
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, px - 1, px - 1], radius=RX * (size / V) * S, fill=255)
    # hairline inner border for a slight turn of depth, only at large sizes
    if size >= 128:
        b = ImageDraw.Draw(bg)
        b.rounded_rectangle([1 * S, 1 * S, px - 1 - S, px - 1 - S],
                            radius=(RX - 1) * (size / V) * S,
                            outline=(255, 255, 255, 14), width=S)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    out = Image.alpha_composite(out, draw_mark(size * S).resize((px, px), Image.LANCZOS))
    return out.resize((size, size), Image.LANCZOS)


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)}")


def write_icns(icon: Image.Image, path: Path) -> None:
    """Minimal valid .icns: modern PNG-based chunks."""
    spec = [
        ("icp4", 16), ("icp5", 32), ("icp6", 64),
        ("ic11", 32), ("ic12", 64),
        ("ic07", 128), ("ic08", 256), ("ic09", 512),
        ("ic13", 256), ("ic14", 512),
    ]
    chunks = b""
    for ctype, sz in spec:
        if sz > 512:
            continue
        data = png_bytes(icon.resize((sz, sz), Image.LANCZOS))
        chunks += ctype.encode() + struct.pack(">I", 8 + len(data)) + data
    blob = b"icns" + struct.pack(">I", 8 + len(chunks)) + chunks
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)
    print(f"  wrote {path.relative_to(ROOT)}")


def write_ico(icon: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    src = icon.resize((256, 256), Image.LANCZOS)
    src.save(path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"  wrote {path.relative_to(ROOT)}")


def draw_banner(width: int, height: int, path: Path) -> None:
    """Social preview banner: dark backdrop, centered mark + wordmark."""
    img = Image.new("RGBA", (width, height), BANNER_BG + (255,))
    mark = draw_mark(340)
    img.alpha_composite(mark, (width // 2 - 170, 58))
    fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 104)
    fs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
    d = ImageDraw.Draw(img)

    def text_center(y, text, font, fill):
        w = d.textlength(text, font=font)
        d.text(((width - w) / 2, y), text, font=font, fill=fill)

    text_center(404, "arc", fb, BANNER_FG)
    text_center(548, "Open-source 3D modeling in three rings", fs, BANNER_SUB)
    save_png(img, path)


def main() -> None:
    print("arc icon generation")

    mark = draw_mark(512)
    icon = draw_icon(512)

    # Tauri bundle icons
    save_png(mark.resize((32, 32), Image.LANCZOS), ROOT / "src-tauri/icons/32x32.png")
    save_png(icon.resize((128, 128), Image.LANCZOS), ROOT / "src-tauri/icons/128x128.png")
    save_png(icon.resize((256, 256), Image.LANCZOS), ROOT / "src-tauri/icons/128x128@2x.png")
    save_png(icon, ROOT / "src-tauri/icons/icon.png")
    write_ico(icon, ROOT / "src-tauri/icons/icon.ico")
    write_icns(icon, ROOT / "src-tauri/icons/icon.icns")

    # Flatpak hicolor icons
    for size in (16, 32, 48, 64, 128, 256, 512):
        save_png(icon.resize((size, size), Image.LANCZOS),
                 ROOT / f"flatpak/icons/{size}x{size}/com.arc.cad.png")

    # Frontend assets
    save_png(icon.resize((192, 192), Image.LANCZOS), ROOT / "frontend/public/icon-192.png")
    save_png(icon.resize((512, 512), Image.LANCZOS), ROOT / "frontend/public/icon-512.png")
    save_png(icon.resize((180, 180), Image.LANCZOS), ROOT / "frontend/public/apple-touch-icon.png")
    shutil.copyfile(ROOT / "assets/logo.svg", ROOT / "frontend/public/favicon.svg")
    print("  wrote frontend/public/favicon.svg")

    # Website assets
    shutil.copyfile(ROOT / "assets/logo.svg", ROOT / "site/assets/logo.svg")
    shutil.copyfile(ROOT / "assets/logo-dark.svg", ROOT / "site/assets/logo-dark.svg")
    shutil.copyfile(ROOT / "assets/icon.svg", ROOT / "site/assets/icon.svg")
    print("  wrote site/assets/{logo.svg, logo-dark.svg, icon.svg}")
    save_png(icon.resize((192, 192), Image.LANCZOS), ROOT / "site/assets/icon-192.png")
    save_png(icon.resize((512, 512), Image.LANCZOS), ROOT / "site/assets/icon-512.png")
    save_png(icon.resize((32, 32), Image.LANCZOS), ROOT / "site/assets/favicon-32.png")
    shutil.copyfile(ROOT / "assets/logo.svg", ROOT / "site/assets/favicon.svg")
    save_png(icon.resize((180, 180), Image.LANCZOS), ROOT / "site/assets/apple-touch-icon.png")
    draw_banner(1200, 630, ROOT / "site/assets/og.png")
    shutil.copyfile(ROOT / "site/assets/og.png", ROOT / "assets/og.png")
    print("  wrote site/assets/og.png (+ copy in assets/)")


if __name__ == "__main__":
    main()
