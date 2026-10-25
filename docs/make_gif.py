#!/usr/bin/env python3
"""Build a looping GIF from the three showcase PNGs.

No cropping: frames of slightly different sizes are padded (centered on black)
onto a common canvas = the max width/height across the inputs. 1 s per frame,
infinite loop.
"""
import sys
from PIL import Image

SRC = ["hero.png", "cloud-3d.png", "pcd-pgm-side-by-side.png"]
OUT = "showcase.gif"
DELAY_MS = 1000

imgs = [Image.open(p).convert("RGB") for p in SRC]
W = max(im.width for im in imgs)
H = max(im.height for im in imgs)

frames = []
for im in imgs:
    if im.size == (W, H):
        canvas = im
    else:
        canvas = Image.new("RGB", (W, H), (0, 0, 0))  # pad, never crop
        canvas.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    # Per-frame adaptive palette keeps the colourful point clouds from banding.
    frames.append(canvas.convert("P", palette=Image.ADAPTIVE, colors=256))

frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=DELAY_MS,
    loop=0,            # 0 = loop forever
    disposal=2,        # clear each frame so padding never ghosts
    optimize=True,
)

import os
print(f"wrote {OUT}: {W}x{H}, {len(frames)} frames, {DELAY_MS} ms each, "
      f"{os.path.getsize(OUT)/1e6:.1f} MB")
