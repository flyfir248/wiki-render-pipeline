// Render a test-scene shot to JPG frames without the laptop (cloud container or any machine with Playwright).
// usage: node render_test.mjs <page.js> <shot> <outdir> <frames: 0-210 or 0,105,209> [w h] [port]
// Needs `three@0.186.1` in ./node_modules (npm i three@0.186.1) and Playwright's Chromium.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const [page, shot, out, spec, W = '720', H = '1280', port = '8151'] = process.argv.slice(2);
const root = path.dirname(fileURLToPath(import.meta.url)); const NM = process.env.THREE_NM || path.join(process.cwd(), 'node_modules');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><script type="module" src="/${page}"></script></body></html>`;
const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/index.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(html); return; }
  const file = p.startsWith('/node_modules') ? path.join(NM, p.slice(13)) : path.join(root, p);
  fs.readFile(file, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); }).listen(+port);
const frames = []; for (const part of spec.split(',')) { if (part.includes('-')) { const [a, b] = part.split('-').map(Number); for (let i = a; i < b; i++) frames.push(i); } else frames.push(+part); }
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: +W, height: +H } });
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('page:', m.text()); }); pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.goto(`http://localhost:${port}/index.html?shot=${shot}&w=${W}&h=${H}`); await pg.waitForFunction('window.ready===true', { timeout: 180000 });
fs.mkdirSync(out, { recursive: true }); const t0 = Date.now();
for (const i of frames) { const f = path.join(out, `f_${String(i + 1).padStart(4, '0')}.jpg`); if (fs.existsSync(f)) continue;
  const d = await pg.evaluate((i) => window.renderFrame(i), i); fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); }
console.log(`${shot}: ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`); await b.close(); srv.close();
