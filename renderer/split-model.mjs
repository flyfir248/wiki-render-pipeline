// One model out of a pack that holds many in one file (a library scene with every animal in it): keep
// only the named node, or one of its children when it holds variants of the same thing (a bear
// standing and on all fours), and drop the rest.
//
//   node split-model.mjs pack.glb out.glb NodeName [--child N|all] [--srgb-colors]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

const [input, output, name, ...rest] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const node = root.listNodes().find((n) => n.getName() === name);
if (!node) {
  console.log(JSON.stringify({ ok: false, error: `no node ${name}` }));
  process.exit(1);
}
const at = rest.indexOf("--child");
const kids = node.listChildren();
// (--child all: the children are parts of one thing, a body and its see-through wings, kept together)
const keep = at >= 0 && kids.length > 1 && rest[at + 1] !== "all" ? kids[Math.min(kids.length - 1, Number(rest[at + 1]))] : node;
// the kept node's world transform, so it stands as it did in the pack's scene
const world = keep.getWorldMatrix();
for (const p of [...keep.listParents()]) if (p.propertyType === "Node") p.removeChild(keep);
keep.setMatrix(world);
for (const scene of root.listScenes()) {
  for (const child of scene.listChildren()) scene.removeChild(child);
  scene.addChild(keep);
}
for (const n of root.listNodes()) {
  let up = n;
  let inside = false;
  while (up) {
    if (up === keep) {
      inside = true;
      break;
    }
    up = up.listParents().find((p) => p.propertyType === "Node");
  }
  if (!inside) n.dispose();
}
// a pack coloured by its vertices tints them with the material's own colour (an FBX's default red,
// often): the vertex colours alone, opaque unless the material is a see-through one. An FBX's vertex
// colours are sRGB, a glTF's linear: decoded once, or every colour comes out pale.
const decoded = new Set();
const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const col = prim.getAttribute("COLOR_0");
    if (col && !decoded.has(col) && rest.includes("--srgb-colors")) {
      decoded.add(col);
      const a = col.getArray();
      const n = col.getElementSize();
      const scale = col.getNormalized() ? (a instanceof Uint8Array ? 255 : a instanceof Uint16Array ? 65535 : 1) : 1;
      for (let i = 0; i < a.length; i++) if (i % n < 3) a[i] = Math.round(linear(a[i] / scale) * scale * (scale > 1 ? 1 : 1e6)) / (scale > 1 ? 1 : 1e6);
    }
    if (!mat || !col) continue;
    mat.setBaseColorFactor([1, 1, 1, mat.getBaseColorFactor()[3]]);
    if (!/transp|particle/i.test(mat.getName())) mat.setAlphaMode("OPAQUE");
  }
await doc.transform(prune());
await io.write(output, doc);
console.log(JSON.stringify({ ok: true, node: keep.getName(), meshes: root.listMeshes().length }));
