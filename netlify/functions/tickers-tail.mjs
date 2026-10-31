// Keeps the ticker index fresh between static rebuilds.
// tickers-update.mjs runs updateTail() every hour: it reads Pons launches after the last block it has seen (starting from the static
// index in site/data/tickers/meta.json), reads their ticker and name, and stores them in the cache.
// GET /api/tickers-tail?shard=RE returns { block, entries } for one shard, used by the scan before it
// reads the remaining few blocks live.
import fs from 'node:fs';
import path from 'node:path';
import { cacheGet, cacheSet } from '../lib/cache.mjs';

const RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const STEP = 150_000; // blocks per run (about 4 hours of chain): one run stays well under the 30 s limit
const KEY = 'tickers-tail';
const norm = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9]/g, '');
const shardOf = (s) => { const n = norm(s); return (n.slice(0, 2) || '__').padEnd(2, '_'); };

async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    try {
      const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      if (!j.error) return j.result;
      if (/exceeds|10000/.test(j.error.message)) { const e = new Error(j.error.message); e.split = true; throw e; }
    } catch (e) { if (e.split) throw e; }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  throw new Error(method + ' failed');
}
async function logs(a, b) {
  try { return await rpc('eth_getLogs', [{ address: FACTORY, topics: [LAUNCH], fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }]); }
  catch (e) { if (!e.split || b <= a) throw e; const m = (a + b) >> 1; return (await logs(a, m)).concat(await logs(m + 1, b)); }
}
// minimal ABI helpers (no dependency): aggregate3 of symbol() and name()
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
function encodeAggregate(tokens) {
  const calls = tokens.flatMap((t) => [[t, '95d89b41'], [t, '06fdde03']]);
  // aggregate3((address,bool,bytes)[]) selector 0x82ad56cb
  const heads = [], tails = [];
  let offset = calls.length * 32;
  for (const [t, sel] of calls) {
    const tuple = w(t) + w(1) + w(96) + w(4) + sel.padEnd(64, '0');
    heads.push(w(offset)); tails.push(tuple); offset += tuple.length / 2;
  }
  return '0x82ad56cb' + w(32) + w(calls.length) + heads.join('') + tails.join('');
}
function decodeAggregate(hex, n) {
  const b = hex.slice(2);
  const word = (i) => b.slice(i * 2, i * 2 + 64);
  const base = parseInt(word(0), 16); // offset to array
  const len = parseInt(word(base), 16);
  const out = [];
  for (let k = 0; k < Math.min(len, n); k++) {
    const off = base + 32 + parseInt(word(base + 32 + k * 32), 16);
    const ok = parseInt(word(off), 16) === 1;
    const dOff = off + parseInt(word(off + 32), 16);
    const dLen = parseInt(word(dOff), 16);
    const data = b.slice((dOff + 32) * 2, (dOff + 32 + dLen) * 2);
    out.push(ok ? data : '');
  }
  return out;
}
function str(data) {
  if (!data) return '';
  try {
    if (data.length === 64) return Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '');
    const len = parseInt(data.slice(64, 128), 16);
    return Buffer.from(data.slice(128, 128 + len * 2), 'hex').toString('utf8');
  } catch { return ''; }
}
function staticMeta() {
  for (const p of [path.join(process.cwd(), 'site', 'data', 'tickers', 'meta.json'), path.join(process.cwd(), 'data', 'tickers', 'meta.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* next */ }
  }
  return null;
}

export async function updateTail() {
  const meta = staticMeta();
  const tail = (await cacheGet(KEY)) || { from: meta?.block || 0, block: meta?.block || 0, entries: [] };
  if (meta && tail.from < meta.block) { tail.from = meta.block; tail.block = Math.max(tail.block, meta.block); tail.entries = tail.entries.filter((e) => e[1] > meta.block); } // static index rebuilt: drop what it now covers
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  const a = tail.block + 1, b = Math.min(head, tail.block + STEP);
  if (a > b) return { block: tail.block, added: 0 };
  const found = (await logs(a, b)).map((l) => ({ token: '0x' + l.topics[1].slice(26), block: parseInt(l.blockNumber, 16), deployer: '0x' + l.topics[3].slice(26) }));
  for (let i = 0; i < found.length; i += 200) {
    const chunk = found.slice(i, i + 200);
    const res = decodeAggregate(await rpc('eth_call', [{ to: MC, data: encodeAggregate(chunk.map((x) => x.token)), gas: '0x5f5e100' }, 'latest']), chunk.length * 2);
    chunk.forEach((x, k) => { tail.entries.push([x.token, x.block, str(res[2 * k]).slice(0, 40), str(res[2 * k + 1]).slice(0, 80), x.deployer]); });
  }
  tail.block = b;
  if (tail.entries.length > 200_000) tail.entries = tail.entries.slice(-200_000);
  await cacheSet(KEY, tail);
  return { block: b, added: found.length, head };
}

export default async (req) => {
  const url = new URL(req.url);
  const shard = url.searchParams.get('shard');
  if (shard && /^[A-Z0-9_]{2}$/.test(shard)) {
    const tail = (await cacheGet(KEY)) || { block: 0, entries: [] };
    return new Response(JSON.stringify({ block: tail.block, entries: tail.entries.filter((e) => shardOf(e[2]) === shard) }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' } });
  }
  return new Response(JSON.stringify({ error: 'shard must be two characters, for example RE' }), { status: 400, headers: { 'content-type': 'application/json' } });
};
export const config = { path: '/api/tickers-tail' };
