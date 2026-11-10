#!/usr/bin/env python3
"""Build runtime UI assets from the approved cuts.

The patience face in ui-elements-v1 bakes the needle, the hub, and the word
ТЕРПЕНИЕ into one picture. There is no approved empty-gauge layer. This
script paints those pixels out of a copy and writes assets/ui/gauge-face-empty.png.
The game draws the word in the project font and draws the needle itself.

The pedal is the approved 0° frame. The bracket stays fixed. The lever and
the pad are one layer that the game rotates about the top axle (rig.py:
y = 242, perspective focal 1800). The pad is not scaled on its own.

Usage:
  python3 tools/build-ui-assets.py /path/to/ui-pedal-pack
"""

import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "ui"


def build_gauge(src_png: Path) -> None:
    g = cv2.imread(str(src_png), cv2.IMREAD_UNCHANGED)
    bgr = g[:, :, :3].astype(np.float32)
    hsv = cv2.cvtColor(g[:, :, :3], cv2.COLOR_BGR2HSV)
    lum = bgr.mean(2)
    alpha = g[:, :, 3]
    very = (lum < 80) & (alpha > 128)
    count, lab, stats, _ = cv2.connectedComponentsWithStats(very.astype(np.uint8), 8)
    needle = np.zeros(lab.shape, bool)
    for k in range(1, count):
        x, y, w, h, area = stats[k]
        if 4000 < area < 20000 and y > 250:
            needle |= lab == k
    fringe = cv2.dilate(needle.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~very
    needle_m = needle | fringe
    cx, cy = 431.5, 453.5
    cream = np.array([203.0, 235.0, 254.0])
    green = np.array([112.0, 167.0, 128.0])

    def is_green(x, y):
        hue, sat, val = hsv[y, x]
        return 40 <= hue <= 90 and sat > 40 and val > 80

    bounds = {}
    for ang in range(120, 176):
        rad = np.radians(ang)
        found = None
        blocked = False
        for radius in range(140, 200):
            x = int(round(cx + np.cos(rad) * radius))
            y = int(round(cy - np.sin(rad) * radius))
            if needle_m[y, x]:
                blocked = True
                break
            if is_green(x, y):
                found = radius
                break
        bounds[ang] = None if blocked else found
    known = [ang for ang, found in bounds.items() if found]
    for ang, found in list(bounds.items()):
        if found is None:
            left = max(item for item in known if item < ang)
            right = min(item for item in known if item > ang)
            mix = (ang - left) / (right - left)
            bounds[ang] = bounds[left] * (1 - mix) + bounds[right] * mix

    out = bgr.copy()
    ys, xs = np.nonzero(needle_m)
    for y, x in zip(ys, xs):
        dx, dy = x - cx, -(y - cy)
        radius = float(np.hypot(dx, dy))
        ang = int(round(np.degrees(np.arctan2(dy, dx)) % 360))
        if ang not in bounds or radius < 80:
            out[y, x] = cream
            continue
        edge = bounds[ang]
        if radius < edge - 1:
            out[y, x] = cream
        elif radius > edge + 2:
            out[y, x] = green
        else:
            mix = float(np.clip((radius - (edge - 1)) / 3, 0, 1))
            out[y, x] = cream * (1 - mix) + green * mix
    # The baked word sits in the cream band above the arc. It is not a separate layer.
    out[104:156, 318:572] = cream
    rgba = np.dstack([np.clip(out, 0, 255).astype(np.uint8), alpha])
    cv2.imwrite(str(OUT / "gauge-face-empty.png"), rgba)


def cut_pedal(idle_png: Path) -> None:
    im = cv2.imread(str(idle_png), cv2.IMREAD_COLOR).astype(np.float32)
    bg = np.median(im[:40, :40].reshape(-1, 3), 0)
    dist = np.linalg.norm(im - bg, axis=2)
    alpha = np.clip((dist - 16) / (42 - 16), 0, 1)
    color = (im - (1 - alpha)[..., None] * bg) / np.maximum(alpha, 1e-3)[..., None]
    color = np.clip(color, 0, 255)
    height = im.shape[0]
    rows = np.arange(height)[:, None]
    mount = alpha * (rows < 258)
    lever = alpha * (rows >= 216)
    for name, mask in (("pedal-mount.png", mount), ("pedal-lever.png", lever)):
        rgba = np.dstack([color, np.clip(mask * 255, 0, 255)])
        cv2.imwrite(str(OUT / name), rgba.astype(np.uint8))


def copy_parts(pack: Path) -> None:
    ui = pack / "art" / "ui-elements-v1"
    mapping = {
        "nine-slice/card-frame.png": "card-frame.png",
        "nine-slice/btn-teal.png": "btn-teal.png",
        "nine-slice/btn-orange.png": "btn-orange.png",
        "nine-slice/btn-cream.png": "btn-cream.png",
        "parts/garage-car-illustration.png": "garage-car.png",
        "parts/success-anton-medallion.png": "success-anton.png",
        "parts/failure-anton-medallion.png": "failure-anton.png",
        "parts/glyph-tile-circle.png": "glyph-circle.png",
        "parts/glyph-tile-square.png": "glyph-square.png",
        "parts/glyph-tile-triangle.png": "glyph-triangle.png",
        "parts/warning-triangle.png": "warning-triangle.png",
        "parts/hint-arrow.png": "hint-arrow.png",
    }
    for src, dest in mapping.items():
        shutil.copyfile(ui / src, OUT / dest)


def main() -> None:
    pack = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui-pedal-pack")
    OUT.mkdir(parents=True, exist_ok=True)
    copy_parts(pack)
    build_gauge(pack / "art" / "ui-elements-v1" / "parts" / "gauge-patience-static.png")
    cut_pedal(pack / "art" / "approved-art-pack" / "originals" / "pedal-demo" / "59_pedal-demo-pedal-00deg.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
