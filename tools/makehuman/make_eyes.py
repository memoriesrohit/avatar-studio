"""Make natural eye textures from MakeHuman's eye images.

MakeHuman's "brown" iris is a reddish maroon that reads as red eyes on screen. This builds a deep
brown from the amber "brownlight" texture by darkening only the iris, and calms the slightly pink
whites of the eyes (sclera) in every texture used.
Run: python make_eyes.py <eyes/materials dir> <out dir>
"""
import colorsys
import os
import sys

import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def process(name, iris_gain, iris_sat):
    im = Image.open(os.path.join(src, f"{name}_eye.png")).convert("RGBA")
    a = np.asarray(im).astype(np.float32) / 255
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    iris = (sat > 0.22) | (mx < 0.45)  # coloured or dark = iris/pupil; pale = sclera
    sclera = ~iris & (mx > 0.55)
    # whites of the eyes: less pink, a touch brighter
    target = np.array([0.93, 0.92, 0.9])
    rgb[sclera] = rgb[sclera] * 0.55 + target * 0.45
    # iris: darker / richer
    grey = rgb[iris].mean(-1, keepdims=True)
    rgb[iris] = np.clip((grey + (rgb[iris] - grey) * iris_sat) * iris_gain, 0, 1)
    a[..., :3] = rgb
    Image.fromarray((a * 255).astype(np.uint8), "RGBA").save(os.path.join(out, f"{name}_natural_eye.png"))
    print("made", name)


process("brownlight", iris_gain=0.5, iris_sat=0.9)  # deep brown
process("blue", iris_gain=0.95, iris_sat=0.85)
process("green", iris_gain=0.9, iris_sat=0.85)
