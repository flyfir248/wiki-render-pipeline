// Motion QA for a video's story-world scenes (src/scenes/world/storyworld/motion-qa.ts): plays each
// through frame by frame without drawing it and prints what would look jerky, as JSON lines
// {scene, frame, what, detail}, then {"checked": n, "found": m}. Used by fyt/render.py `motion_check`.
//
//   node motion-check.mjs --props props.json
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const props = JSON.parse(fs.readFileSync(args[args.indexOf("--props") + 1], "utf8"));
// bundled beside node_modules so three resolves; React and the canvas are never drawn
const file = path.join(here, `.motion-qa-${process.pid}.mjs`);
try {
  await build({
    entryPoints: [path.join(here, "src/scenes/world/storyworld/motion-qa.ts")],
    bundle: true, platform: "node", format: "esm", outfile: file, logLevel: "error", jsx: "automatic",
    external: ["three", "react", "react-dom", "remotion", "@remotion/*", "@react-three/*"],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });
  const { checkProps } = await import(pathToFileURL(file).href);
  const found = checkProps(props);
  for (const f of found) console.log(JSON.stringify(f));
  console.log(JSON.stringify({ checked: props.scenes.filter((s) => s.type === "world" && s.world).length, found: found.length }));
} finally {
  fs.rmSync(file, { force: true });
}
