"""Turn the growing-roots frames into the site's video, its poster and the still picture.

Run (after `mangrove_scene.py <dir>/f_ 1040 650 24 grow` has written f_0001.png .. f_0072.png, and
`GROW_FIRST=72 GROW_LAST=72 mangrove_scene.py <dir>/big_ 2000 1250 48 grow` the last frame large):
    python3 tools/render/roots_video.py <dir> docs/assets

Writes
  video/roots-grow-1040.mp4, video/roots-grow-640.mp4   H.264, 24 fps, plays once when the section comes into view
  img/roots-start-1200.webp                             first frame: the poster, so nothing jumps before it plays
  img/roots-{2000,1200,760}.webp                        last frame: the still shown without motion (and as fallback)

Each frame gets the same treatment as the old still: the hard line where the bright surface meets the dark water is
softened (found per frame, since the camera sinks), faint light shafts, and an elliptical fade to --abysse so the
picture has no edge on the dark page. Needs Pillow, numpy and ffmpeg.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ABYSS = np.array([0x04, 0x11, 0x0F], float)
MINT = np.array([63, 227, 166], float)


def horizon_row(a):
    """Row where the bright surface ends: the steepest fall of brightness down the middle of the frame."""
    H, W = a.shape[:2]
    lum = a[:, int(W * .2):int(W * .8)].mean(axis=(1, 2))
    lum = np.convolve(lum, np.ones(9) / 9, mode="same")
    d = np.diff(lum)
    lo, hi = int(H * .15), int(H * .7)
    return lo + int(np.argmin(d[lo:hi]))


def treat(img, hy):
    W, H = img.size
    a = np.asarray(img.convert("RGB"), float)
    yy, xx = np.mgrid[0:H, 0:W]
    blur = np.asarray(img.convert("RGB").filter(ImageFilter.GaussianBlur(H * 0.03)), float)
    band = np.exp(-((yy - hy) / (H * 0.07)) ** 2)[..., None]
    a = a * (1 - band) + blur * band
    rng = np.random.default_rng(7)
    shafts = np.zeros((H, W))
    for _ in range(9):
        cx, wid, k = rng.uniform(.32, .68) * W, rng.uniform(.01, .03) * W, rng.uniform(.03, .07)
        shafts += k * np.exp(-((xx - cx) / wid) ** 2)
    shafts *= np.clip((yy - hy) / (H * .05), 0, 1) * np.exp(-np.clip(yy - hy, 0, None) / (H * .35))
    a = a + shafts[..., None] * MINT
    ex, ey = (xx - W / 2) / (W * .5), (yy - H * .42) / (H * .58)
    r = np.sqrt(ex ** 2 + ey ** 2)
    v = np.clip((r - .45) / .55, 0, 1)
    v = (v * v * (3 - 2 * v))[..., None]
    a = a * (1 - v) + ABYSS * v
    return Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), "RGB")


def main(src, out):
    src, out = Path(src), Path(out)
    frames = sorted(src.glob("f_*.png"))
    if not frames:
        sys.exit("no frames f_*.png in " + str(src))
    imgs = [Image.open(f) for f in frames]
    rows = np.array([horizon_row(np.asarray(i.convert("RGB"), float)) for i in imgs], float)
    rows = np.convolve(np.pad(rows, 4, mode="edge"), np.ones(9) / 9, mode="valid")   # no jitter between frames
    (out / "video").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for n, (im, hy) in enumerate(zip(imgs, rows), 1):
            t = treat(im, hy)
            t.save(f"{tmp}/p_{n:04d}.png")
            if n == 1:
                t.save(out / "img" / "roots-start-1200.webp", "WEBP", quality=70, method=6)
        for w in (1040, 640):
            dst = out / "video" / f"roots-grow-{w}.mp4"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "24", "-i", f"{tmp}/p_%04d.png",
                            "-vf", f"scale={w}:-2:flags=lanczos", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(dst)], check=True)
            print(dst, f"{dst.stat().st_size / 1024:.0f} KB")
    big = src / "big_0072.png"
    last = Image.open(big) if big.exists() else imgs[-1]
    hy = horizon_row(np.asarray(last.convert("RGB"), float))
    still = treat(last, hy)
    for w in (2000, 1200, 760):
        im = still.resize((w, round(still.height * w / still.width)), Image.LANCZOS)
        p = out / "img" / f"roots-{w}.webp"
        im.save(p, "WEBP", quality=72, method=6)
        print(p, f"{p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
