"""One sheet per move: each row is a sampled moment, front and side view, character + performer."""
import collections
import glob
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
groups = collections.OrderedDict()
for f in sorted(glob.glob(os.path.join(src, "*.png"))):
    parts = os.path.basename(f)[:-4].split("_")
    view, k = parts[-1], int(parts[-2])
    move = "_".join(parts[2:-2])
    groups.setdefault(move, {}).setdefault(k, {})[view] = f
os.makedirs(out, exist_ok=True)
for move, rows in groups.items():
    W, H = 300, 330
    sheet = Image.new("RGB", (W * 2 * len(rows), H + 20), (30, 30, 34))
    d = ImageDraw.Draw(sheet)
    d.text((6, 4), f"{move}: front | side, per moment (left = character, right = performer)", fill=(240, 240, 240))
    for i, k in enumerate(sorted(rows)):
        for j, view in enumerate(("front", "side")):
            if view in rows[k]:
                sheet.paste(Image.open(rows[k][view]).convert("RGB").resize((W, H)), ((i * 2 + j) * W, 20))
    sheet.save(os.path.join(out, f"{move}.jpg"), quality=85)
    print("sheet", move)
