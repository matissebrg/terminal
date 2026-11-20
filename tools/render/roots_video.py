"""Turn the roots renders into the site's videos, their poster and the still picture.

Run, after mangrove_scene.py has written into <dir>:
    f_0001.png ..  growth frames    GROW_FRAMES=92 mangrove_scene.py <dir>/f_ 1920 1200 24 grow
    s_0001.png ..  sway frames      mangrove_scene.py <dir>/s_ 1920 1200 24 sway
    big_*.png      last frame, big  GROW_FRAMES=92 GROW_FIRST=92 GROW_LAST=92 mangrove_scene.py <dir>/big_ 2400 1500 48 grow
    python3 tools/render/roots_video.py <dir> docs/assets

Writes
  video/roots-grow-{1920,960}.mp4   the growth, played once when the section comes into view
  video/roots-sway-{1920,960}.mp4   the grown roots swept by a current and back (forward + reverse): a seamless loop
                                    whose first frame is the growth's last, played right after it
  img/roots-start.webp              first frame of the growth: the poster
  img/roots-{2000,1200,760}.webp    last frame: the still shown without motion (and as fallback)

Every frame gets the same treatment: the hard line where the bright surface meets the dark water is softened (found
per frame, since the camera sinks during the growth), faint light shafts, and a fade to --abysse at the sides, the top
and the bottom, baked in, so the picture has no edge on the dark page and needs no CSS mask. A faint static dither
keeps the dark glows from banding. Needs Pillow, numpy and ffmpeg.
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


def treat(img, hy, dither=None):
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
    sm = lambda x: x * x * (3 - 2 * x)
    vt = sm(np.clip(yy / (H * .14), 0, 1)) * sm(np.clip((H * .97 - yy) / (H * .37), 0, 1))     # top and bottom
    a = a * vt[..., None] + ABYSS * (1 - vt[..., None])
    if dither is not None:          # the same faint noise on every frame: breaks the banding of dark glows, adds no flicker
        a = a + dither[..., None]
    return Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), "RGB")


def encode(tmp, pattern, dst, w, crf):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "24", "-i", f"{tmp}/{pattern}",
                    "-vf", f"scale={w}:-2:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-tune", "film",
                    "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(dst)], check=True)
    print(dst, f"{dst.stat().st_size / 1024:.0f} KB")


def main(src, out):
    src, out = Path(src), Path(out)
    frames = sorted(src.glob("f_*.png"))
    sways = sorted(src.glob("s_*.png"))
    if not frames:
        sys.exit("no frames f_*.png in " + str(src))
    imgs = [Image.open(f) for f in frames]
    rows = np.array([horizon_row(np.asarray(i.convert("RGB"), float)) for i in imgs], float)
    rows = np.convolve(np.pad(rows, 4, mode="edge"), np.ones(9) / 9, mode="valid")   # no jitter between frames
    (out / "video").mkdir(parents=True, exist_ok=True)
    W, H = imgs[0].size
    dither = np.random.default_rng(3).uniform(-1.2, 1.2, (H, W))
    sizes = ((1920, 18), (960, 21))
    with tempfile.TemporaryDirectory() as tmp:
        for n, (im, hy) in enumerate(zip(imgs, rows), 1):
            t = treat(im, hy, dither)
            t.save(f"{tmp}/g_{n:04d}.png")
            if n == 1:
                t.save(out / "img" / "roots-start.webp", "WEBP", quality=86, method=6)
        for w, crf in sizes:
            encode(tmp, "g_%04d.png", out / "video" / f"roots-grow-{w}.mp4", w, crf)
        if sways:
            hy = rows[-1]                                    # same treatment as the growth's last frame: no seam
            done = [treat(Image.open(f), hy, dither) for f in sways]
            seq = done + done[-2:0:-1]                        # forward, then back: loops with no jump
            for n, t in enumerate(seq, 1):
                t.save(f"{tmp}/s_{n:04d}.png")
            for w, crf in sizes:
                encode(tmp, "s_%04d.png", out / "video" / f"roots-sway-{w}.mp4", w, crf)
    bigs = sorted(src.glob("big_*.png"))
    last = Image.open(bigs[-1]) if bigs else imgs[-1]
    hy = horizon_row(np.asarray(last.convert("RGB"), float))
    still = treat(last, hy)
    for w in (2000, 1200, 760):
        im = still.resize((w, round(still.height * w / still.width)), Image.LANCZOS)
        p = out / "img" / f"roots-{w}.webp"
        im.save(p, "WEBP", quality=84, method=6)
        print(p, f"{p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
