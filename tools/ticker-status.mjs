// node tools/ticker-status.mjs WINK : every Pons token with this ticker, graduated or not
import fs from 'node:fs';
const T = process.argv[2].toUpperCase();
const n = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9]/g, '');
const j = JSON.parse(fs.readFileSync(new URL(`../site/data/tickers/${n(T).slice(0, 2)}.json`, import.meta.url)));
const list = j.filter((e) => n(e[2]) === n(T));
const RPC = 'https://rpc.mainnet.chain.robinhood.com', F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const call = async (to, data) => { for (let i = 0; i < 5; i++) { try { const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json(); if (r.result) return r.result; } catch {} await new Promise((r) => setTimeout(r, 500 * (i + 1))); } return null; };
let grads = 0;
for (const e of list) {
  const sel = '0x3cf28b5a'; // getLaunchedToken(address): a static tuple, word 1 is the curve
  const out = await call(F, sel + e[0].slice(2).padStart(64, '0'));
  let graduated = false, curve = null;
  if (out && out.length >= 2 + 64 * 15) { curve = '0x' + out.slice(2 + 64 + 24, 2 + 64 * 2); const g = await call(curve, '0xe7c2b772'); graduated = g ? BigInt(g) === 1n : false; }
  if (graduated) grads++;
  if (graduated || /hood/i.test(e[3])) console.log(e[0], e[1], JSON.stringify(e[3]), graduated ? 'GRADUATED' : '');
}
console.log(`${list.length} tokens with $${T}, ${grads} graduated`);
