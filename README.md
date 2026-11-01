# Avatar Studio 🧍✨

**Create and dress up your own 3D avatar in the browser.** Pick a starter character, then change the body, face, hair, clothes and accessories, and watch it wave, dance and jump. No install and no model files: every character is built in code from simple 3D shapes with [three.js](https://threejs.org/).

![Avatar Studio: a 3D avatar in a hoodie and headphones waving, with the customisation panel on the right](docs/screenshot.jpg)

## Features

- **8 starter avatars** to choose from, with live 3D thumbnails, including two in office wear
- **Look:** body type, skin tone, expression, eye colour, 8 hairstyles plus hair colour, facial hair
- **Office formals:** dress shirt (tucked in, with belt), blazer suit with pocket square, necktie or bow tie, formal trousers with crease, pencil skirt, oxfords and loafers
- **Casuals:** t-shirt, polo, checked flannel, hoodie, sweater, jacket, kurta, tank top; jeans, chinos, cargo pants, joggers, shorts, skirt; sneakers, boots, sandals or barefoot
- **Quick outfits:** one click for Office formal, Office skirt suit, Business casual, Black tie, Weekend casual, Flannel & denim or Streetwear. Outfits change only the clothes, so your avatar's face and hair stay the same.
- **Extras:** cap, beanie, sun hat, top hat or headphones; round, square or sunglasses
- **Any colour:** every item has a palette plus a custom colour picker
- **Poses:** idle (breathing and blinking), wave, dance, jump, think, with smooth blending between them
- **Randomize**, **undo** (Ctrl+Z), **share link** (the avatar is stored in the URL) and **Save PNG**
- Remembers your last avatar, works on phones, and follows your light or dark theme

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
js/catalog.js     every option, colour palette and starter avatar, plus random/sanitize helpers
js/avatar.js      builds the character from a config object
js/scene.js       renderer, lights, camera controls, pose animation, thumbnails
js/main.js        editor panel, undo, share links, saving
```

- **The avatar is a rig of nested groups:** hips → torso, head, arms and legs. Clothes are attached to the body part they cover, so sleeves swing with the arms and trousers move with the legs.
- **Body and clothes are lathed shapes:** a radius profile spun around the vertical axis. A shirt is the torso profile made a little wider; a kurta is the same profile continued down past the hips.
- **Poses** set target angles for each joint every frame, and the rig eases towards them, so switching poses or clothes never snaps.
- **Share links** store the avatar config as base64 JSON in the URL. Incoming configs are validated against the catalog, so a link can only select options that exist.

## Adding your own item

1. Add the option to its section in `js/catalog.js`, for example `['scarf', 'Scarf']` under *Headwear*. To add a whole look, add an entry to `OUTFITS`.
2. Build its shape in the matching function in `js/avatar.js` (`addHat`, `addTop`, `addShoe`, …) using the `add()` helper.
3. Reload the page. The editor picks up the new option automatically.

## License

MIT, by [Rohit Biradar](https://github.com/memoriesrohit)
