// Download the character as a 3D file (or a picture). Exporters load only when first used.

const ADDONS = 'three/addons/exporters/';

// [id, label, what it's for]
export const FORMATS = [
  ['glb', 'GLB', 'Rigged character + all moves + face expressions. Blender, Unity, Unreal, Godot, Mixamo.'],
  ['gltf', 'glTF', 'Same as GLB, as a readable JSON file.'],
  ['obj', 'OBJ', 'Shape only (standing pose). Works almost everywhere.'],
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

// three.js drops the ':' from bone names when it loads a model; Mixamo, Unity and Blender's
// Mixamo tools expect "mixamorig:Hips", so the exported file gets the original names back.
const restoreBoneNames = (json) => {
  for (const node of json.nodes ?? []) {
    if (/^mixamorig[A-Z]/.test(node.name ?? '')) node.name = node.name.replace(/^mixamorig/, 'mixamorig:');
  }
  return json;
};

function patchGlb(buffer) {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = restoreBoneNames(JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))));
  let text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  text = padded;
  const rest = new Uint8Array(buffer, 20 + jsonLength); // binary chunk(s), unchanged
  const out = new Uint8Array(12 + 8 + text.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(new Uint8Array(buffer, 0, 12));
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, text.length, true);
  ov.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return out.buffer;
}

export async function exportAvatar(stage, format, name = 'my-avatar') {
  // the soft hair-edge pass is a display-only copy of the hair: leave it out of files
  const extras = [];
  stage.character?.traverse((o) => o.name === 'HairTips' && extras.push([o, o.parent]));
  for (const [o, parent] of extras) parent.remove(o);
  try {
    return await exportFile(stage, format, name);
  } finally {
    for (const [o, parent] of extras) parent.add(o);
  }
}

async function exportFile(stage, format, name) {
  if (format === 'png') {
    const res = await fetch(stage.snapshot());
    return download(await res.blob(), `${name}.png`);
  }
  const root = stage.character;
  if (!root) throw new Error('No character loaded yet');
  root.updateMatrixWorld(true);

  if (format === 'glb' || format === 'gltf') {
    // exported with the current outfit colour and expression; every move comes along as a clip
    const { GLTFExporter } = await import(`${ADDONS}GLTFExporter.js`);
    const binary = format === 'glb';
    const result = await new GLTFExporter().parseAsync(root, { binary, animations: stage.gltf.animations });
    return binary
      ? download(patchGlb(result), `${name}.glb`, 'model/gltf-binary')
      : download(JSON.stringify(restoreBoneNames(result)), `${name}.gltf`, 'model/gltf+json');
  }

  // static formats: export the standing (rest) pose
  const mixer = stage.mixer;
  mixer.stopAllAction();
  root.traverse((o) => o.isSkinnedMesh && o.skeleton.pose());
  try {
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
  } finally {
    stage.playMove(stage.move, 0);
  }
  throw new Error(`Unknown format ${format}`);
}
