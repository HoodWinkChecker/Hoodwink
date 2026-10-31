// Renders the logo pack into brand/ from site/_brand.html (Edge headless via puppeteer-core borrowed from a sibling project).
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const BORROW = process.env.BORROW || 'D:/WEB SITE/NON FINI/Cricket/node_modules';
const puppeteer = (await import(pathToFileURL(path.join(BORROW, 'puppeteer-core/lib/puppeteer/puppeteer-core.js')).href)).default;
const root = path.resolve(import.meta.dirname, '..', 'site');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(5921);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
const out = path.resolve(import.meta.dirname, '..', 'brand');
for (const [k, w, h, scale] of [['avatar', 400, 400, 2], ['pons', 1000, 1000, 1], ['banner', 1500, 500, 2], ['lockup', 1600, 500, 1], ['lockup-light', 1600, 500, 1]]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await p.goto(`http://127.0.0.1:5921/_brand.html?k=${k}`, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, `hoodwink-${k}.png`) });
  await p.close();
}
await b.close(); srv.close();
// SVG marks are written by tools/trace-logo.py from brand/source/hoodwink-logo-original.png
console.log(fs.readdirSync(out).join('\n'));
