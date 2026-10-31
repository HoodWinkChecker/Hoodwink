// Server-side evidence gathering for the reality checks: website, X post, GitHub repository.
// Everything fetched here is untrusted third-party content: it is measured and summarised, never executed.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (compatible; HoodwinkScanner/1.0; +https://www.hoodwink.site)';
const MAX_BYTES = 1_500_000;
const SHORTENERS = /^(bit\.ly|t\.co|tinyurl\.com|j7m\.io|cutt\.ly|rebrand\.ly|is\.gd|ow\.ly|buff\.ly|shorturl\.at|tiny\.cc|lnkd\.in|rb\.gy|s\.id)$/i;
const BUILDERS = [
  [/linktr\.ee|linktree/i, 'Linktree page'], [/carrd\.co|\.carrd\./i, 'Carrd one-pager'], [/notion\.site|notion\.so/i, 'Notion page'],
  [/framer\.(app|website|com)|framerusercontent/i, 'Framer site'], [/webflow\.(io|com)/i, 'Webflow site'], [/wixsite|wix\.com|parastorage/i, 'Wix site'],
  [/gitbook\.io/i, 'GitBook docs'], [/vercel\.app/i, 'Vercel deployment'], [/netlify\.app/i, 'Netlify deployment'], [/github\.io/i, 'GitHub Pages'],
  [/pages\.dev/i, 'Cloudflare Pages'], [/bio\.link|beacons\.ai|lnk\.bio/i, 'link-in-bio page'],
];

/** refuse anything that resolves to a private, loopback, link-local or metadata address */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https links are followed');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('non-standard port refused');
  if (u.username || u.password) throw new Error('credentials in URL refused');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('local host refused');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('resolves to a private address');
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BYTES) { reader.cancel(); break; }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/** GET with manual redirects (each hop re-checked), 8 s timeout, size cap */
export async function safeGet(url, { accept = 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5', json = false } = {}) {
  let u = new URL(url.startsWith('http') ? url : 'https://' + url);
  const hops = [];
  for (let i = 0; i < 5; i++) {
    await assertPublic(u);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let res;
    try { res = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept } }); }
    finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      hops.push({ from: u.href, status: res.status });
      u = new URL(res.headers.get('location'), u);
      continue;
    }
    const type = res.headers.get('content-type') || '';
    const body = json || /text|html|json|xml/.test(type) ? await readCapped(res) : '';
    return { url: u.href, status: res.status, type, body, hops };
  }
  throw new Error('too many redirects');
}

const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

/** visit the project's website and measure it */
export async function probeWebsite(url, token) {
  const out = { url, ok: false };
  if (!url) return { ...out, error: 'no website in the launch metadata' };
  try {
    const first = new URL(url.startsWith('http') ? url : 'https://' + url);
    out.shortener = SHORTENERS.test(first.hostname);
    const r = await safeGet(url);
    out.status = r.status; out.finalUrl = r.url; out.redirects = r.hops.length;
    out.ok = r.status >= 200 && r.status < 300;
    const html = r.body || '';
    out.bytes = html.length;
    out.title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim().slice(0, 200);
    out.metaDescription = decodeEntities((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i) || [])[1] || '').slice(0, 300);
    const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.text = text.slice(0, 6000);
    out.textLength = text.length;
    out.scripts = (html.match(/<script/gi) || []).length;
    out.jsOnly = text.length < 200 && out.scripts > 0;
    const low = html.toLowerCase();
    out.mentionsContract = token ? low.includes(token.toLowerCase()) : false;
    out.mentionsRobinhood = /robinhood/i.test(text);
    const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
    const handles = new Set(), repos = new Set(), tgs = new Set();
    for (const h of hrefs) {
      const x = h.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})(?:[/?]|$)/i);
      if (x && !['intent', 'share', 'home', 'i', 'search'].includes(x[1].toLowerCase())) handles.add(x[1].toLowerCase());
      const g = h.match(/github\.com\/([A-Za-z0-9-]+(?:\/[A-Za-z0-9._-]+)?)/i);
      if (g) repos.add(g[1].replace(/\.git$/, ''));
      const t = h.match(/t\.me\/([A-Za-z0-9_]+)/i);
      if (t) tgs.add(t[1].toLowerCase());
    }
    out.links = { x: [...handles].slice(0, 8), github: [...repos].slice(0, 8), telegram: [...tgs].slice(0, 8), total: hrefs.length };
    out.builder = (BUILDERS.find(([re]) => re.test(r.url) || re.test(html.slice(0, 200000))) || [])[1] || null;
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
  }
  return out;
}

/** read a post through X's public embed endpoint (no key) */
export async function probeTweet(id) {
  try {
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`, { headers: { 'user-agent': UA } });
    if (!r.ok) return { id, exists: false, status: r.status };
    const j = await r.json();
    if (!j || !j.user) return { id, exists: false };
    return {
      id, exists: true, author: j.user.screen_name, authorName: j.user.name, verified: !!(j.user.is_blue_verified || j.user.verified), verifiedType: j.user.verified_type || null,
      createdAt: j.created_at, text: String(j.text || '').slice(0, 500), likes: j.favorite_count ?? null, replies: j.conversation_count ?? null,
      quoted: j.quoted_tweet ? { author: j.quoted_tweet.user?.screen_name, text: String(j.quoted_tweet.text || '').slice(0, 300) } : null,
    };
  } catch (e) { return { id, exists: null, error: String(e.message || e).slice(0, 160) }; }
}

/** GitHub repository (or account) facts */
export async function probeGithub(owner, repo) {
  const h = { 'user-agent': UA, accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  try {
    if (!repo) {
      const r = await fetch(`https://api.github.com/users/${owner}`, { headers: h });
      if (r.status === 404) return { owner, exists: false };
      const j = await r.json();
      return { owner, exists: true, kind: 'account', createdAt: j.created_at, publicRepos: j.public_repos, followers: j.followers };
    }
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: h });
    if (r.status === 404) return { owner, repo, exists: false };
    if (!r.ok) return { owner, repo, exists: null, status: r.status };
    const j = await r.json();
    let commits = null;
    const c = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers: h });
    if (c.ok) {
      const link = c.headers.get('link') || '';
      const m = link.match(/[?&]page=(\d+)>; rel="last"/);
      commits = m ? Number(m[1]) : (await c.json()).length;
    }
    return {
      owner, repo, exists: true, kind: 'repo', fork: j.fork, parent: j.parent?.full_name || null, createdAt: j.created_at, pushedAt: j.pushed_at,
      stars: j.stargazers_count, forks: j.forks_count, sizeKb: j.size, language: j.language, description: j.description, commits, archived: j.archived,
    };
  } catch (e) { return { owner, repo, exists: null, error: String(e.message || e).slice(0, 160) }; }
}
