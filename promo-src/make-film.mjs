// node promo-src/make-film.mjs preview [t1,t2,...] -> _shots/film/*.png   |   node promo-src/make-film.mjs -> promo/hoodwink-film.mp4 (1920x1080, 30 fps, soundtrack from make-music.py)
// Needs only node + Edge + ffmpeg; puppeteer-core is borrowed from a sibling project (nothing is installed).
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { pathToFileURL } from 'node:url';
const BORROW = process.env.BORROW || 'D:/WEB SITE/NON FINI/Cricket/node_modules';
const puppeteer = (await import(pathToFileURL(path.join(BORROW, 'puppeteer-core/lib/puppeteer/puppeteer-core.js')).href)).default;
const root = path.resolve(import.meta.dirname, '..');
const FFMPEG = process.env.FFMPEG || 'C:/Users/yamwe/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe';
const FPS = 30, preview = process.argv[2] === 'preview';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(5911);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { Element.prototype.requestPointerLock = function () {}; });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto('http://127.0.0.1:5911/promo-src/film.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.ready === true', { timeout: 40000 });
  const DUR = await page.evaluate('window.DUR');
  if (preview) {
    const out = path.join(root, '_shots', 'film'); fs.mkdirSync(out, { recursive: true });
    const times = (process.argv[3] || '2,3.6,6,8,10.5,13.5,16.8,19.8,22.5,26.5,28.5,32').split(',').map(Number);
    for (const t of times) { await page.evaluate((x) => window.render(x), t); await new Promise((r) => setTimeout(r, 120)); await page.screenshot({ path: path.join(out, `t${String(t).replace('.', '_')}.png`) }); }
    console.log('previews in', out);
  } else {
    const out = path.join(root, 'promo', 'hoodwink-film.mp4'); fs.mkdirSync(path.dirname(out), { recursive: true });
    const audio = path.join(root, 'promo-src', 'film-music.wav');
    const args = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', ...(fs.existsSync(audio) ? ['-i', audio, '-c:a', 'aac', '-b:a', '192k'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-shortest', out];
    const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'inherit'] });
    const total = Math.round(DUR * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((x) => window.render(x), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log(`frame ${i}/${total}`);
    }
    ff.stdin.end(); await new Promise((r) => ff.on('close', r));
    console.log('wrote', out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
  }
} finally { await browser.close(); srv.close(); }
