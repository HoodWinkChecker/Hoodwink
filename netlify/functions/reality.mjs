// GET /api/reality?token=0x…
// Gathers the off-chain evidence of a Pons token from its on-chain launch metadata: website, X post or
// profile, GitHub. Cached per token for 6 hours. The browser never supplies the evidence itself, so the
// verdict endpoint can trust what is cached here.
import { launchMetadata, parseX, parseGithub } from '../../site/assets/js/meta.js';
import { probeWebsite, probeTweet, probeGithub } from '../lib/probe.mjs';
import { cacheGet, cacheSet } from '../lib/cache.mjs';

const RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const TTL = 6 * 3600 * 1000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });

async function call(to, data) {
  for (let i = 0; i < 5; i++) {
    try {
      const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json();
      if (j.result) return j.result;
      if (j.error && !/rate|too many|timeout/i.test(j.error.message)) return null;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  return null;
}
const str = (h) => { try { const b = Buffer.from(h.slice(2), 'hex'); if (b.length === 32) return b.toString('utf8').replace(/\0+$/, ''); const n = Number(BigInt('0x' + b.slice(32, 64).toString('hex'))); return b.slice(64, 64 + n).toString('utf8'); } catch { return null; } };

export async function gather(token) {
  const key = 'reality-' + token;
  const hit = await cacheGet(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit, cached: true };
  const [nameH, symH] = await Promise.all([call(token, '0x06fdde03'), call(token, '0x95d89b41')]);
  const name = nameH ? str(nameH) : null, symbol = symH ? str(symH) : null;
  const meta = await launchMetadata(token, { rpcUrl: RPC, name, symbol });
  const out = { token, name, symbol, at: Date.now(), pons: !!meta, meta };
  if (meta) {
    const x = parseX(meta.x);
    const gh = parseGithub(meta.github);
    const [site, tweet] = await Promise.all([
      meta.website ? probeWebsite(meta.website, token) : null,
      x?.status ? probeTweet(x.status) : null,
    ]);
    out.site = site;
    out.x = x ? { ...x, tweet } : null;
    // GitHub: from the metadata, else the first repo linked on the website
    const repoRef = gh || (site?.links?.github?.[0] ? parseGithub('github.com/' + site.links.github[0]) : null);
    out.github = repoRef ? { ...(await probeGithub(repoRef.owner, repoRef.repo)), source: gh ? 'launch metadata' : 'website link' } : null;
  }
  await cacheSet(key, out);
  return out;
}

export default async (req) => {
  const token = (new URL(req.url).searchParams.get('token') || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return json({ error: 'token must be a 0x address' }, 400);
  try { return json(await gather(token)); }
  catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 502); }
};
export const config = { path: '/api/reality' };
