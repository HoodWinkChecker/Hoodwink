// Local server: static files from site/ + the /api/* functions from netlify/functions/ (same code as deployed).
// node serve.mjs [port]. Reads .env for ANTHROPIC_API_KEY / GITHUB_TOKEN.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const here = import.meta.dirname;
const root = path.join(here, 'site');
const port = Number(process.argv[2] || 6912);
process.chdir(here);
if (fs.existsSync(path.join(here, '.env'))) for (const line of fs.readFileSync(path.join(here, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.sol': 'text/plain; charset=utf-8' };
const API = { '/api/reality': 'reality.mjs', '/api/verdict': 'verdict.mjs', '/api/tickers-tail': 'tickers-tail.mjs' };

http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/.netlify/functions/verdict-background') {
    const t = new URL('http://localhost' + req.url).searchParams.get('token');
    import(pathToFileURL(path.join(here, 'netlify', 'lib', 'judge.mjs')).href).then((m) => m.judge(String(t).toLowerCase())).catch(() => {});
    res.writeHead(202); return res.end();
  }
  if (API[pathname]) {
    try {
      const mod = await import(pathToFileURL(path.join(here, 'netlify', 'functions', API[pathname])).href);
      const r = await mod.default(new Request('http://' + (req.headers.host || 'localhost:' + port) + req.url, { method: req.method, headers: req.headers }), {});
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: String(e.message || e) })); }
  }
  let p = path.join(root, pathname);
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404, { 'content-type': types['.html'] }); return fs.createReadStream(path.join(root, '404.html')).pipe(res); }
  const size = fs.statSync(p).size, range = req.headers.range;
  if (range && path.extname(p) === '.mp4') {
    const [a, b] = range.replace('bytes=', '').split('-'); const start = +a, end = b ? +b : size - 1;
    res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'content-length': size, 'cache-control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => {
  console.log(`Hoodwink: http://localhost:${port}  (Ctrl+C pour arreter)`);
  import(pathToFileURL(path.join(here, 'netlify', 'lib', 'judge.mjs')).href).then((m) => console.log(m.hasKey() ? 'Verdict IA: actif' : 'Verdict IA: inactif (pas de cle)'));
  // same hourly job as the deployed site: keeps the ticker index fresh while this window is open
  const tick = async () => {
    try {
      const { updateTail } = await import(pathToFileURL(path.join(here, 'netlify', 'functions', 'tickers-tail.mjs')).href);
      for (let i = 0; i < 20; i++) { const r = await updateTail(); if (!r.added && r.block >= (r.head ?? r.block)) break; if (r.head && r.block >= r.head) break; }
      console.log('Index des tickers: a jour');
    } catch (e) { console.log('Index des tickers: mise a jour impossible (' + e.message + ')'); }
  };
  tick(); setInterval(tick, 3600 * 1000);
});
