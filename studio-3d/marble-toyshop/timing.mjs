import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.cwd();
const html = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><script type="module" src="/marble_toyshop.js"></script></body></html>`;
const srv = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); if (p === '/index.html') { r.end(html); return; } fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); }).listen(8199);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const pg = await b.newPage({ viewport: { width: 180, height: 320 } });
await pg.goto('http://localhost:8199/index.html?w=180&h=320'); await pg.waitForFunction('window.ready===true', { timeout: 120000 });
fs.writeFileSync('timing.json', JSON.stringify(await pg.evaluate(() => window.MARBLE_TIMING), null, 1)); await b.close(); srv.close();
