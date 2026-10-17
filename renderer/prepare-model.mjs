// Prepare a downloaded 3D model for the renderer: convert old material extensions three.js no longer
// reads, merge duplicates, simplify the meshes to a triangle budget and shrink the textures, then write
// one .glb and print what it holds (triangles, size, animation clips) as JSON for fyt/assetlib.py.
//
//   node prepare-model.mjs in.glb out.glb --triangles 60000 --texture 1024
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, getBounds, metalRough, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import fs from "node:fs";
import sharp from "sharp";

const [input, output, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : fallback;
};
const budget = opt("triangles", 60000);
const texture = opt("texture", 1024);

const triangles = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const idx = p.getIndices();
      const pos = p.getAttribute("POSITION");
      n += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  return n;
};

try {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  if (used.includes("KHR_draco_mesh_compression")) throw new Error("draco-compressed meshes are not supported");
  const before = triangles(doc);
  await MeshoptSimplifier.ready;
  const steps = [metalRough(), dedup(), prune(), weld()];
  if (before > budget) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error: 0.01 }));
  steps.push(textureCompress({ encoder: sharp, resize: [texture, texture] }));
  await doc.transform(...steps);
  await io.write(output, doc);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = getBounds(scene);
  console.log(
    JSON.stringify({
      ok: true,
      triangles_before: before,
      triangles: triangles(doc),
      bytes: fs.statSync(output).size,
      size: b.max.map((v, i) => +(v - b.min[i]).toFixed(4)),
      clips: root.listAnimations().map((a) => a.getName() || "clip"),
      skinned: root.listSkins().length > 0,
      morphs: root.listMeshes().some((m) => m.listPrimitives().some((p) => p.listTargets().length > 0)),
      meshes: root.listMeshes().length,
      textures: root.listTextures().length,
    }),
  );
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) }));
  process.exit(1);
}
