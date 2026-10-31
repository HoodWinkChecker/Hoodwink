// GET /api/verdict?token=0x…
// Answers immediately: the cached verdict if there is one, otherwise { pending: true } after starting
// verdict-background (no request ever waits on the model, so no function timeout). The page polls.
// The verdict only ever uses evidence gathered server-side by /api/reality, never text from the caller.
import { cacheGet, cacheSet } from '../lib/cache.mjs';
import { TTL, hasKey } from '../lib/judge.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

export default async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) return json({ error: 'token must be a 0x address' }, 400);
  if (!hasKey()) return json({ error: 'verdict disabled: no API key on the server' }, 503);
  const hit = await cacheGet('verdict-' + token);
  if (hit && hit.verdict && Date.now() - hit.at < TTL) return json({ ...hit, cached: true });
  if (hit && hit.failed && Date.now() - hit.at < 120_000) return json({ error: hit.error }, 502);
  const pend = await cacheGet('verdict-pending-' + token);
  if (!pend || Date.now() - pend.at > 90_000) {
    await cacheSet('verdict-pending-' + token, { at: Date.now() });
    const bg = new URL('/.netlify/functions/verdict-background?token=' + token, url.origin);
    fetch(bg, { method: 'POST' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 150)); // let the request leave before this function returns
  }
  return json({ pending: true }, 202);
};
export const config = { path: '/api/verdict' };
