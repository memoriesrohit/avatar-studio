// Download the avatar as a 3D file (or a picture). Exporters load only when first used.

import { bakeClips } from './poses.js';

const ADDONS = 'three/addons/exporters/';

// [id, label, what it's for]
export const FORMATS = [
  ['glb', 'GLB', '3D + every move as an animation. Blender, Unity, Unreal, Godot, web.'],
  ['gltf', 'glTF', 'Same as GLB, as a readable JSON file.'],
  ['obj', 'OBJ', 'Shape only, no colours. Works almost everywhere.'],
  ['stl', 'STL', 'Shape only, for 3D printing.'],
  ['usdz', 'USDZ', 'Apple AR Quick Look on iPhone and iPad.'],
  ['png', 'PNG', 'A picture of the current view.'],
];

function download(data, filename, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportAvatar(stage, format) {
  const root = stage.rig.root;
  root.updateMatrixWorld(true);
  const name = 'my-avatar';

  if (format === 'png') {
    const res = await fetch(stage.snapshot());
    return download(await res.blob(), `${name}.png`);
  }
  if (format === 'glb' || format === 'gltf') {
    const { GLTFExporter } = await import(`${ADDONS}GLTFExporter.js`);
    const binary = format === 'glb';
    const result = await new GLTFExporter().parseAsync(root, { binary, animations: bakeClips(stage.rig) });
    return binary
      ? download(result, `${name}.glb`, 'model/gltf-binary')
      : download(JSON.stringify(result), `${name}.gltf`, 'model/gltf+json');
  }
  if (format === 'obj') {
    const { OBJExporter } = await import(`${ADDONS}OBJExporter.js`);
    return download(new OBJExporter().parse(root), `${name}.obj`, 'text/plain');
  }
  if (format === 'stl') {
    const { STLExporter } = await import(`${ADDONS}STLExporter.js`);
    return download(new STLExporter().parse(root, { binary: true }), `${name}.stl`, 'model/stl');
  }
  if (format === 'usdz') {
    const { USDZExporter } = await import(`${ADDONS}USDZExporter.js`);
    const exporter = new USDZExporter();
    const data = exporter.parseAsync
      ? await exporter.parseAsync(root)
      : await new Promise((resolve, reject) => exporter.parse(root, resolve, reject));
    return download(data, `${name}.usdz`, 'model/vnd.usdz+zip');
  }
  throw new Error(`Unknown format ${format}`);
}
