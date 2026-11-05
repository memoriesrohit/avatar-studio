# Avatar Studio 🧍

**Realistic, rigged 3D people you can dress, animate, give expressions and export, right in the browser.** Pick a person, choose an outfit (office formal, smart casual or casual), recolour it, change their facial expression, play a move, and download them as a GLB ready for Blender, Unity, Unreal or Mixamo.

![Avatar Studio: a realistic man in a dark suit and striped tie, with the customisation panel on the right](docs/screenshot.jpg)

## What you get

- **6 realistic people:** Arjun, Vikram, Daniel, Marcus, Meera and Sarah, each with their own body, face, skin tone and hair
- **3 outfits each:** office formal (suit and tie), smart casual and casual, with fitted shirts, jackets, jeans and shoes
- **Outfit colours:** recolour the clothes while keeping the fabric detail
- **10 facial expressions:** neutral, smile, big laugh, excited, confident, serious, surprised, angry, sad and wink. These are real face shapes, and the eyelids, brows, lashes, teeth and tongue move with them. Characters also blink naturally.
- **11 motion-captured moves:** idle, walk, wave, talk, shrug, happy, laugh, stretch, boxing, salsa and Charleston. These are **real recorded human movement** from the CMU motion-capture library, retargeted onto each character, so weight shifts, arm swing and timing look natural. Each move starts with a fitting expression, such as a laugh for Laugh.
- **Lifelike behaviour:** during calm moves the character turns their head to keep eye contact with you
- **Studio rendering:** lit by a photographed studio environment, with soft shadows, ambient occlusion in folds and contact points, and a gentle sheen on skin and fabric
- **Face close-up**, auto-rotate, randomize and share links

## Export

| Format | What you get | Use it in |
|---|---|---|
| **GLB** | Skinned character on a **Mixamo-compatible skeleton**, all 11 moves as animation clips, all face shapes, with your outfit colour and expression | Blender, Unity, Unreal, Godot, Mixamo |
| **glTF** | Same as GLB, as a readable JSON file | Same as GLB |
| **OBJ** | Shape only, standing pose | Almost any 3D app |
| **STL** | Shape only | 3D printing |
| **USDZ** | Model with materials | AR Quick Look on iPhone and iPad |
| **PNG** | Picture of the current view | Anywhere |

**Need FBX?** Browsers can't write FBX. Export a **GLB**, open it in [Blender](https://www.blender.org/) (*File → Import → glTF 2.0*), then *File → Export → FBX*.

## Run it

It's a static site with no build step. Serve the folder with any web server:

```bash
git clone https://github.com/memoriesrohit/avatar-studio
cd avatar-studio
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block ES modules and model loading on `file://` URLs.

## How it's made

The characters are not drawn in code. They're real human models built with **[MPFB](https://static.makehumancommunity.org/mpfb.html)**, the MakeHuman character creator for Blender, and exported as GLB files in `models/`. The web app (three.js) loads them, plays their animations and drives their face shapes.

```
index.html, css/       the page
js/catalog.js          people, outfits, outfit colours, expression recipes
js/scene.js            loads a character, plays moves, blinks, eye contact, expressions, materials, lighting
js/export.js           GLB / glTF / OBJ / STL / USDZ / PNG export
js/main.js             editor panel, export menu, share links
models/*.glb           one rigged character per person and outfit (about 5–6 MB each)
assets/                studio lighting environment (HDRI)
tools/                 the Blender scripts that build models/, and the motion-capture clips
```

The build script (`tools/build.py`) does this for each person and outfit:

1. Creates a MakeHuman body from macro settings (gender, age, muscle, weight, height, ethnicity).
2. Adds a skin, eyes, eyebrows, eyelashes, teeth, tongue, hair, clothes and shoes, all fitted to that body, and smooths the body and clothes with one level of subdivision.
3. Adds a Mixamo-compatible skeleton.
4. Adds MakeHuman's **34 face units** (eye closure, brow raise, smile, jaw open, …) as shape keys on the face, then refits the brows, lashes, teeth and tongue for each unit so they follow it.
5. Retargets the motion-capture clips listed in `tools/moves.json` (`tools/mocap.py`). It reads CMU's skeleton and motion files, puts the character in the performer's T-pose, then copies every joint's rotation frame by frame, so arm, leg, spine and head movement keep their twist and timing. Hip height is scaled to the character's legs, travel across the floor is removed so moves play in place, and each clip is trimmed and blended so it loops without a jump.
6. Exports a GLB with 2048 px WebP textures and sparse morph targets.

Expressions are recipes of those face units (see `EXPRESSIONS` in `js/catalog.js`), so adding a new one takes no 3D work.

### Rebuilding the characters

You need Blender 4.2 or newer with the MPFB extension, plus the CC0 asset packs `makehuman_system_assets` and `suits01` from the [MakeHuman asset downloads](https://static.makehumancommunity.org/assets/downloadassets.html), saved in `tools/downloads/`. Then, from the `tools` folder:

```bash
blender -b -P build.py -- people.json ../models
blender -b -P thumbs.py -- ../models ../models/thumbs arjun vikram daniel marcus meera sarah
```

Edit `tools/people.json` to change a person's body, skin, hair or outfits, or to add someone new. To add a move, find a clip on [mocap.cs.cmu.edu](http://mocap.cs.cmu.edu/), put its `.amc` file and the subject's `.asf` file in `tools/mocap/`, and add a line to `tools/moves.json`.

## Credits and license

- Code: MIT, by [Rohit Biradar](https://github.com/memoriesrohit)
- Bodies, skins, hair, clothes and face units: [MakeHuman](http://www.makehumancommunity.org/) assets, **CC0** (free for any use)
- Motion: [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu/). The data used in this project was obtained from mocap.cs.cmu.edu; the database was created with funding from NSF EIA-0196217. CMU allows the data to be copied, modified and redistributed.
- Studio lighting: [Studio Small 09](https://polyhaven.com/a/studio_small_09) HDRI from Poly Haven, **CC0**
- Character tooling: [MPFB](https://static.makehumancommunity.org/mpfb.html) (GPL), used only at build time; it isn't part of this repo
- 3D in the browser: [three.js](https://threejs.org/) (MIT)
