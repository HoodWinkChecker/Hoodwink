// Deployers with the most Pons launches over the last N blocks (default 3M): node tools/top-deployers.mjs [blocks]
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const rpc = async (m, p) => { for (let i = 0; i < 6; i++) { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (!j.error) return j.result; if (/exceeds|10000/.test(j.error.message)) throw Object.assign(new Error(j.error.message), { split: true }); await new Promise((r) => setTimeout(r, 900 * (i + 1))); } };
const F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', L = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const head = parseInt(await rpc('eth_blockNumber', []), 16), span = Number(process.argv[2] || 3_000_000);
async function logs(a, b) { try { return await rpc('eth_getLogs', [{ address: F, topics: [L], fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }]); } catch (e) { if (!e.split) throw e; const m = (a + b) >> 1; return (await logs(a, m)).concat(await logs(m + 1, b)); } }
const all = await logs(head - span, head);
const by = {};
for (const l of all) { const d = '0x' + l.topics[3].slice(26); (by[d] ||= []).push('0x' + l.topics[1].slice(26)); }
const top = Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
for (const [d, t] of top) console.log(d, t.length, 'latest', t[t.length - 1]);
