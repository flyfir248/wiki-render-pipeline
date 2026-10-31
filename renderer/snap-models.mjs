// Side views of models for the orientation check (fyt/assetlib.py `orient`), each turned the way the
// stage would turn it (forward) and, for the second picture, half round (flip). One bundle for all.
//
//   node snap-models.mjs --public dir --out dir models/a.glb:auto:+y models/b.glb:short:+y ...
//     writes <out>/<n>-as.png and <out>/<n>-flip.png for the n-th model (from 0)
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const publicDir = path.resolve(opt("public", path.join(here, "public")));
const out = path.resolve(opt("out", "snaps"));
const models = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
fs.mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir });
for (const [n, m] of models.entries()) {
  const [src, forward = "auto", up = "+y"] = m.split(":");
  for (const flip of [false, true]) {
    const inputProps = { src, forward, up, flip };
    const file = path.join(out, `${n}-${flip ? "flip" : "as"}.png`);
    try {
      const composition = await selectComposition({ serveUrl, id: "ModelSnap", inputProps, browserExecutable });
      await renderStill({ composition, serveUrl, output: file, inputProps, browserExecutable, logLevel: "error", timeoutInMilliseconds: 180000 });
      console.log(JSON.stringify({ n, src, flip, file }));
    } catch (e) {
      console.log(JSON.stringify({ n, src, flip, error: String(e).slice(0, 300) }));
    }
  }
}
