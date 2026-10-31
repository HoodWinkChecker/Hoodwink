// Classifies every pair asset used by recent Pons launches: official stock token, USDG, or something else.
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const { keccak256 } = await import('../site/assets/vendor/viem.js');
const rpc = async (m, p) => { for (let i = 0; i < 6; i++) { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (!j.error) return j.result; await new Promise(r => setTimeout(r, 1000 * (i + 1))); } throw new Error(m); };
const F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', L = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const head = parseInt(await rpc('eth_blockNumber', []), 16);
const logs = [];
const W = 400_000; const jobs = []; for (let b = head; b > 0; b -= W) jobs.push([Math.max(0, b - W + 1), b]);
for (let i = 0; i < jobs.length; i += 8) { const r = await Promise.all(jobs.slice(i, i + 8).map(([a, b]) => rpc("eth_getLogs", [{ address: F, topics: [L], fromBlock: "0x" + a.toString(16), toBlock: "0x" + b.toString(16) }]).catch(e => { console.error("fail", a, e.message); return []; }))); for (const x of r) logs.push(...x); }
const str = (h) => { try { const b = Buffer.from(h.slice(2), 'hex'); const n = parseInt(b.slice(32, 64).toString('hex'), 16); return b.slice(64, 64 + n).toString(); } catch { return '?'; } };
const count = {};
for (const l of logs) { const p = '0x' + l.data.slice(26, 66); count[p] = (count[p] || 0) + 1; }
console.log('total launches', logs.length);
const rows = [];
for (const [p, n] of Object.entries(count)) {
  if (/^0x0+$/.test(p)) { rows.push([n, 'ETH', '', 'native']); continue; }
  const code = await rpc('eth_getCode', [p, 'latest']);
  const sy = str(await rpc('eth_call', [{ to: p, data: '0x95d89b41' }, 'latest']).catch(() => '0x'));
  const nm = str(await rpc('eth_call', [{ to: p, data: '0x06fdde03' }, 'latest']).catch(() => '0x'));
  const official = keccak256(code) === '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630';
  rows.push([n, sy, p, official ? 'OFFICIAL STOCK' : p.toLowerCase() === '0x5fc5360d0400a0fd4f2af552add042d716f1d168' ? 'USDG' : 'other: ' + nm]);
}
rows.sort((a, b) => b[0] - a[0]);
for (const r of rows) console.log(String(r[0]).padStart(6), r[1].padEnd(8), r[2], r[3]);
const fs = await import('node:fs');
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../data/pairs.json', import.meta.url), JSON.stringify({ head, launches: logs.length, rows: rows.map(([n, sym, addr, kind]) => ({ n, sym, addr, kind })) }, null, 1));
