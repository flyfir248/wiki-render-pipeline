// What a prepared model is made of, for the asset catalogue (fyt/catalog.py): its size, triangles,
// skeleton and clips, whether it was rigged here (rig-model.mjs) and how its gaits cover ground, and the
// parts a renderer can move on their own: wheels, propellers and rotors, found by their names.
//
//   node inspect-model.mjs a.glb b.glb ...     one JSON line per file
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { statSync } from "node:fs";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
export const WHEEL = /wheel|tire|tyre/i;
export const SPINNER = /propel|rotor|(^|[^a-z])prop([^a-z]|$)|blade|fan/i;
for (const f of process.argv.slice(2)) {
  try {
    const doc = await io.read(f);
    const root = doc.getRoot();
    const scene = root.listScenes()[0];
    const b = getBounds(scene);
    let tris = 0;
    for (const m of root.listMeshes())
      for (const p of m.listPrimitives()) {
        const idx = p.getIndices();
        tris += Math.round((idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3);
      }
    const names = root.listNodes().map((n) => n.getName());
    const extras = scene.getExtras() ?? {};
    console.log(JSON.stringify({
      file: f, ok: true, bytes: statSync(f).size,
      size: [0, 1, 2].map((k) => Number((b.max[k] - b.min[k]).toFixed(3))),
      triangles: tris, meshes: root.listMeshes().length,
      bones: root.listSkins().reduce((s, k) => s + k.listJoints().length, 0),
      clips: root.listAnimations().map((a) => a.getName()),
      rig: root.listSkins().length ? (extras.rig === "auto" ? "auto" : "native") : "none",
      rigType: extras.type ?? "", gait: extras.gait ?? {},
      wheels: names.filter((n) => WHEEL.test(n)).length,
      spinners: names.filter((n) => SPINNER.test(n)).length,
      textures: root.listTextures().length,
    }));
  } catch (e) {
    console.log(JSON.stringify({ file: f, ok: false, reason: String(e).slice(0, 200) }));
  }
}
