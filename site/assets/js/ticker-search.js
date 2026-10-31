// Search by ticker: "$REX" or "rex" lists every Pons token with that ticker, oldest first, the first one
// marked as the original. Reads the static index shard plus the server's hourly tail.
import { esc } from './site.js';

const norm = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9]/g, '');
const shardOf = (n) => (n.slice(0, 2) || '__').padEnd(2, '_');
const cache = new Map();
async function shard(k) {
  if (cache.has(k)) return cache.get(k);
  const p = (async () => {
    const [base, tail] = await Promise.all([
      fetch(`data/tickers/${k}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/tickers-tail?shard=${k}`).then((r) => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] })),
    ]);
    const seen = new Set();
    return base.concat(tail.entries || []).filter((e) => { const t = e[0].toLowerCase(); if (seen.has(t)) return false; seen.add(t); return true; }).sort((a, b) => a[1] - b[1]);
  })();
  cache.set(k, p);
  return p;
}
let headBlock = null;
const BLOCK_S = 0.1045;
const ago = (b) => {
  if (!headBlock) return '';
  const s = (headBlock - b) * BLOCK_S;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function attachTickerSearch(input, box, { rpc } = {}) {
  if (rpc) fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) }).then((r) => r.json()).then((j) => { headBlock = parseInt(j.result, 16); }).catch(() => {});
  let timer = null, last = '';
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  async function run() {
    const raw = input.value.trim();
    if (/^0x/i.test(raw) || !/^\$?[A-Za-z0-9 ._-]{1,24}$/.test(raw)) return close();
    const q = norm(raw);
    if (!q) return close();
    last = q;
    box.hidden = false;
    box.innerHTML = '<div class="ts-row dim">Searching every Pons launch…</div>';
    const list = await shard(shardOf(q));
    if (last !== q) return;
    const exact = list.filter((e) => norm(e[2]) === q);
    const near = exact.length ? [] : list.filter((e) => norm(e[2]).startsWith(q)).slice(-12).reverse();
    if (!exact.length && !near.length) { box.innerHTML = `<div class="ts-row dim">No Pons token uses $${esc(q)}.</div>`; return; }
    const head = exact.length
      ? `<div class="ts-head"><span>${exact.length} token${exact.length > 1 ? 's' : ''} use $${esc(q)}</span><span>${exact.length > 1 ? 'the first one is the original' : 'unique ticker'}</span></div>`
      : `<div class="ts-head"><span>No exact $${esc(q)} · tickers starting with it</span><span></span></div>`;
    const rows = exact.length ? [exact[0], ...exact.slice(1).reverse()].slice(0, 30) : near;
    box.innerHTML = head + rows.map((e) => {
      const orig = exact.length > 1 && e === exact[0];
      return `<a class="ts-row" href="scan.html?a=${e[0]}">
        <span class="ts-sym">$${esc(e[2])}${orig ? ' <i>original</i>' : exact.length > 1 ? ` <i class="cp">copy #${exact.indexOf(e) + 1}</i>` : ''}</span>
        <span class="ts-name">${esc(e[3] || '')}</span>
        <span class="ts-meta">${e[0].slice(0, 6)}…${e[0].slice(-4)} · ${ago(e[1])}</span></a>`;
    }).join('') + (exact.length > 30 ? `<div class="ts-row dim">Showing the original and the 29 most recent of ${exact.length}.</div>` : '');
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  input.addEventListener('focus', () => { if (input.value.trim() && !/^0x/i.test(input.value.trim())) run(); });
  document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== input) close(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { first: () => box.querySelector('a.ts-row')?.getAttribute('href') || null, run };
}
