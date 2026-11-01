# Avatar Studio 🧍✨

**Create, dress up and animate your own 3D character in the browser, then export it for Blender, Unity, Unreal or AR.** Pick a starter character, change the body, face, hair, clothes and accessories, and make them walk, flex or jump for joy. No install and no model files: every character is built in code with [three.js](https://threejs.org/).

![Avatar Studio: a man in a navy suit and tie giving a thumbs up, with the customisation panel on the right](docs/screenshot.jpg)

## Features

- **Human proportions:** about 1.76 m tall, with shoulders, elbows, wrists, hands with fingers and a thumb, knees and feet, and a slightly larger-than-life head like an animated film character
- **8 starter avatars** to choose from, with live 3D thumbnails
- **Body:** slim, regular, **athletic** (broad chest and shoulders, V-shaped torso) or sturdy
- **Face:** soft or **strong jaw** (square jaw, firm chin, heavier brows), skin tone, eye colour
- **Expressions:** smile, grin, **excited** (open-mouthed laugh, raised brows), **confident** (half smile, one brow up), calm, wow
- **Hair:** buzz, short, **quiff**, **side part**, spiky, long, bun, ponytail, curly, plus any hair colour; moustache or beard
- **Office formals:** dress shirt (tucked in, with belt), blazer suit with pocket square, necktie or bow tie, formal trousers with crease, pencil skirt, oxfords and loafers
- **Casuals:** t-shirt, polo, checked flannel, hoodie, sweater, jacket, kurta, tank top; jeans, chinos, cargo pants, joggers, shorts, skirt; sneakers, boots, sandals or barefoot
- **Quick outfits:** one click for Office formal, Office skirt suit, Business casual, Black tie, Weekend casual, Flannel & denim or Streetwear. Outfits change only the clothes, so the face and hair stay the same.
- **Extras:** cap, beanie, sun hat, top hat or headphones; round, square or sunglasses
- **Moves:** idle (weight shift, breathing, blinking), walk, wave, thumbs up, flex, celebrate (jump with both thumbs up), dance and think, with smooth blending between them
- **Face close-up** button, auto-rotate, randomize, undo (Ctrl+Z) and share links

## Export

Click **Export** and choose a format:

| Format | What you get | Use it in |
|---|---|---|
| **GLB** | The 3D model with materials **and every move as an animation clip** (Idle, Walk, Wave, Thumbs up, Flex, Celebrate, Dance, Think) | Blender, Unity, Unreal, Godot, web viewers |
| **glTF** | Same as GLB, as a readable JSON file | Same as GLB |
| **OBJ** | Shape only, no colours | Almost any 3D app |
| **STL** | Shape only | 3D printing |
| **USDZ** | Model with materials | AR Quick Look on iPhone and iPad |
| **PNG** | A picture of the current view | Anywhere |

**Need FBX?** Browsers can't write FBX, so export a **GLB**, open it in [Blender](https://www.blender.org/) (*File → Import → glTF 2.0*), then *File → Export → FBX*. The animations come across too.

In exported files the character is a hierarchy of named parts (`Hips`, `Chest`, `Head`, `Arm_L`, `Elbow_L`, `Fingers_L`, `Thumb_L`, `Leg_L`, `Knee_L`, …) and the animations move those parts. It isn't a skinned mesh, so retargeting tools like Mixamo won't pick it up as a skeleton.

## Run it

It's a static site with no build step. Serve the folder with any web server:

```bash
git clone https://github.com/memoriesrohit/avatar-studio
cd avatar-studio
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://` URLs.

## How it works

```
index.html        page layout + import map for three.js (loaded from a CDN)
css/style.css     UI styles, light/dark themes, phone layout
js/catalog.js     every option, colour palette, outfit and starter avatar
js/avatar.js      builds the character from a config object
js/poses.js       every move as joint angles over time, plus baking them into animation clips
js/scene.js       renderer, lights, camera, thumbnails
js/export.js      GLB / glTF / OBJ / STL / USDZ / PNG export
js/main.js        editor panel, export menu, undo, share links
```

- **The character is a rig of nested groups:** hips → chest → head and arms (→ elbows → hands → fingers and thumb), and hips → legs (→ knees → feet). Clothes ride on the part they cover, so sleeves bend with the elbows and trousers bend with the knees.
- **Bodies and clothes are lathed profiles:** real-world radius-by-height measurements spun around an axis. A garment is the same body profile pushed out by the fabric's thickness and cut to its length; an athletic build widens the chest part of the profile.
- **The head** is a sphere reshaped vertex by vertex into a skull, jaw and chin, with the jaw shape as a parameter.
- **Moves are functions of time** that return joint angles. The live view eases towards them every frame; the exporter samples them at 30 fps into keyframed clips.
- **Share links** store the avatar config as base64 JSON in the URL. Incoming configs are validated against the catalog, so a link can only select options that exist.

## Adding your own item or move

1. Add the option to its section in `js/catalog.js`, for example `['scarf', 'Scarf']` under *Headwear*. For a whole look, add an entry to `OUTFITS`.
2. Build its shape in the matching function in `js/avatar.js` (`addHat`, `addTop`, `addShoe`, …) using the `add()` helper.
3. For a new move, add it to `POSES` in `js/poses.js` and give it joint angles in `poseAt()`. It appears in the pose bar and in GLB exports automatically.

## License

MIT, by [Rohit Biradar](https://github.com/memoriesrohit)
