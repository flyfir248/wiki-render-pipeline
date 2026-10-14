// Render a video or thumbnail from a props JSON file.
//
//   node render.mjs --props job/props.json --public job/public --out job/video.mp4
//   node render.mjs --still --props job/thumb.json --public job/public --out job/thumb.png
//   node render.mjs --frame 120 --props job/props.json --public job/public --out preview.png
//   node render.mjs --frames 0,30,60 --props job/props.json --public job/public --out frames/
//
// The Python pipeline calls this; you can also run it by hand.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const propsPath = opt("props");
const publicDir = path.resolve(opt("public", path.join(here, "public")));
const out = path.resolve(opt("out", "out.mp4"));
const still = flag("still");
const frame = opt("frame");
const frames = opt("frames");
if (!propsPath) {
  console.error("--props is required");
  process.exit(2);
}
const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;

const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir });
const composition = await selectComposition({
  serveUrl,
  id: still ? "Thumbnail" : "Video",
  inputProps,
  browserExecutable,
});

if (frames !== undefined) {
  // --frames renders several frames as stills (frame-00030.png ...) from one bundle, for a contact sheet.
  fs.mkdirSync(out, { recursive: true });
  for (const f of frames.split(",").map(Number)) {
    const file = path.join(out, `frame-${String(f).padStart(5, "0")}.png`);
    await renderStill({ composition, serveUrl, output: file, inputProps, browserExecutable, frame: f, logLevel: "error" });
  }
} else if (still || frame !== undefined) {
  // --frame previews one frame of the video without rendering all of it.
  await renderStill({ composition, serveUrl, output: out, inputProps, browserExecutable, frame: Number(frame ?? 0) });
} else {
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 20,
    audioCodec: "aac",
    outputLocation: out,
    inputProps,
    browserExecutable,
    // Remotion rejects a concurrency above the machine's core count, so clamp it.
    concurrency: Math.min(os.cpus().length, Number(process.env.REMOTION_CONCURRENCY) || os.cpus().length),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct % 10 === 0 && pct !== last) {
        last = pct;
        console.log(`render ${pct}%`);
      }
    },
  });
}
console.log(`wrote ${out}`);
