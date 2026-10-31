// Lists recent Pons launches with name, symbol and pair: used to pick real example cases.
const { STOCKS } = await import('../site/assets/js/stocks.js');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const rpc = async (m, p) => { for (let i = 0; i < 6; i++) { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (!j.error) return j.result; await new Promise(r => setTimeout(r, 1000 * (i + 1))); } throw new Error(m); };
const F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', L = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const head = parseInt(await rpc('eth_blockNumber', []), 16);
const span = Number(process.argv[2] || 3_000_000);
const logs = [];
for (let b = head; b > head - span; b -= 1_000_000) logs.push(...await rpc('eth_getLogs', [{ address: F, topics: [L], fromBlock: '0x' + Math.max(0, b - 999_999).toString(16), toBlock: '0x' + b.toString(16) }]));
const str = (h) => { try { const b = Buffer.from(h.slice(2), 'hex'); const n = parseInt(b.slice(32, 64).toString('hex'), 16); return b.slice(64, 64 + n).toString(); } catch { return '?'; } };
const out = [];
for (const l of logs) {
  const token = '0x' + l.topics[1].slice(26);
  const d = l.data.slice(2).match(/.{64}/g);
  const pair = '0x' + d[0].slice(24);
  out.push({ token, pair, block: parseInt(l.blockNumber, 16), deployer: '0x' + l.topics[3].slice(26) });
}
console.log('launches', out.length);
const pairs = {}; for (const o of out) pairs[o.pair] = (pairs[o.pair] || 0) + 1; console.log(pairs);
const filt = process.argv[3];
let shown = 0;
for (const o of out.reverse()) {
  if (filt === 'pair' && /^0x0+$/.test(o.pair)) continue;
  const nm = str(await rpc('eth_call', [{ to: o.token, data: '0x06fdde03' }, 'latest']));
  const sy = str(await rpc('eth_call', [{ to: o.token, data: '0x95d89b41' }, 'latest']));
  if (filt === 'brand' && !/robin|hood|nvda|tsla|aapl|stock|nvidia|tesla/i.test(nm + sy)) continue;
  if (filt === 'ticker' && !(STOCKS[sy.toUpperCase()] || /robinhood token/i.test(nm))) continue;
  console.log(o.token, o.block, sy.padEnd(10), nm.slice(0, 30).padEnd(30), 'pair', o.pair.slice(0, 10), 'dep', o.deployer.slice(0, 10));
  if (++shown >= (filt === 'ticker' ? 12 : 25)) break;
}
