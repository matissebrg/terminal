"""Turn the two Blender renders into the site's WebP images.

Run (after rendering with mangrove_scene.py):
    python3 tools/render/postprocess.py hero  hero_final.png  docs/assets/img
    python3 tools/render/postprocess.py roots roots_final.png docs/assets/img

hero  : the render's background is exactly the page colour (--brume), so the tree is cut out by
        colour distance to that colour, with the colour un-mixed so that compositing the WebP back
        over --brume gives the render again. Cropped to the tree, saved at 1600 / 1040 / 680 px.
roots : the underwater shot. Softens the hard surface line, adds faint light shafts, and fades
        everything to --abysse with an elliptical vignette so the image has no visible edges on the
        dark page. Saved at 2000 / 1200 / 760 px.
Needs Pillow and numpy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PAPER = np.array([0xED, 0xF0, 0xEC], float)   # --brume
ABYSS = np.array([0x04, 0x11, 0x0F], float)   # --abysse

# Hero crop, in render pixels (2400 x 1500 render): x, y, width, height.
HERO_CROP = (292, 134, 1816, 1286)   # down to where the reflection has faded out
HERO_WIDTHS = (1600, 1040, 680)
ROOTS_WIDTHS = (2000, 1200, 760)


def cutout(rgb, bg, full_at=68.0, floor=3.0):
    """Colour-to-alpha against a flat background colour.

    alpha grows with the RGB distance to bg (0 below `floor`, 1 from `full_at`); the colour is
    then un-mixed so that alpha * colour + (1 - alpha) * bg == rgb wherever alpha > 0.
    """
    d = np.sqrt(((rgb - bg) ** 2).sum(-1))
    a = np.clip((d - floor) / (full_at - floor), 0.0, 1.0)
    safe = np.where(a > 0, a, 1.0)[..., None]
    fg = np.clip(bg + (rgb - bg) / safe, 0, 255)
    fg[a == 0] = bg
    return np.dstack([fg, a * 255]).round().astype(np.uint8)


def save_widths(img, out_dir, stem, widths, quality):
    w0, h0 = img.size
    for w in widths:
        h = round(h0 * w / w0)
        im = img.resize((w, h), Image.LANCZOS)
        path = Path(out_dir) / f"{stem}-{w}.webp"
        im.save(path, "WEBP", quality=quality, method=6, exact=im.mode == "RGBA")
        print(f"{path}  {w}x{h}  {path.stat().st_size / 1024:.0f} KB")


def hero(src, out_dir):
    rgb = np.asarray(Image.open(src).convert("RGB"), float)
    x, y, w, h = HERO_CROP
    rgba = cutout(rgb[y:y + h, x:x + w], PAPER)
    rgba[:2, :, 3] = rgba[-2:, :, 3] = rgba[:, :2, 3] = rgba[:, -2:, 3] = 0   # no stray border pixels
    img = Image.fromarray(rgba, "RGBA")   # 1600 x 1133 once resized: keep .stage's aspect-ratio in step
    save_widths(img, out_dir, "hero-tree", HERO_WIDTHS, quality=86)


def roots(src, out_dir, horizon=0.45):
    img = Image.open(src).convert("RGB")
    W, H = img.size
    a = np.asarray(img, float)
    yy, xx = np.mgrid[0:H, 0:W]
    hy = horizon * H

    # 1. Soften the surface line: blend in a blurred copy around the horizon.
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(H * 0.03)), float)
    band = np.exp(-((yy - hy) / (H * 0.06)) ** 2)[..., None]
    a = a * (1 - band) + blur * band

    # 2. Light shafts: a few soft vertical bands below the surface, brightest near it.
    rng = np.random.default_rng(7)
    shafts = np.zeros((H, W))
    for _ in range(9):
        cx, wid, k = rng.uniform(.32, .68) * W, rng.uniform(.01, .03) * W, rng.uniform(.03, .07)
        shafts += k * np.exp(-((xx - cx) / wid) ** 2)
    shafts *= np.clip((yy - hy) / (H * .05), 0, 1) * np.exp(-np.clip(yy - hy, 0, None) / (H * .35))
    a = a + shafts[..., None] * np.array([63, 227, 166], float)

    # 3. Elliptical vignette to the abyss colour, so the picture melts into the page.
    ex, ey = (xx - W / 2) / (W * .5), (yy - H * .42) / (H * .58)
    r = np.sqrt(ex ** 2 + ey ** 2)
    v = np.clip((r - .45) / .55, 0, 1)
    v = (v * v * (3 - 2 * v))[..., None]                      # smoothstep
    a = a * (1 - v) + ABYSS * v

    out = Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), "RGB")
    save_widths(out, out_dir, "roots", ROOTS_WIDTHS, quality=72)


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("hero", "roots"):
        sys.exit(__doc__)
    {"hero": hero, "roots": roots}[sys.argv[1]](sys.argv[2], sys.argv[3])
