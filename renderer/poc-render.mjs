import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
const out = process.argv[2]; const frames = process.argv[3];
const chromiumOptions = { gl: "swangle" }; const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
const serveUrl = await bundle({ entryPoint: path.resolve("src/poc/index.ts") });
const composition = await selectComposition({ serveUrl, id: "Poc", browserExecutable });
if (frames) { for (const f of frames.split(",")) await renderStill({ serveUrl, composition, frame: +f, browserExecutable, output: `${out}/f${f}.png`, chromiumOptions }); }
else await renderMedia({ serveUrl, composition, codec: "h264", outputLocation: out, browserExecutable, chromiumOptions, concurrency: 4 });
