// Reads the launch transaction of a Pons token and decodes the metadata the creator typed (name, description, socials).

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const rpc = async (m, p) => { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
const tok = process.argv[2].toLowerCase();
const F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', L = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const head = parseInt(await rpc('eth_blockNumber', []), 16);
let log;
for (let b = head; b > 0 && !log; b -= 10_000_000) { const r = await rpc('eth_getLogs', [{ address: F, topics: [L, '0x' + tok.slice(2).padStart(64, '0')], fromBlock: '0x' + Math.max(0, b - 9_999_999).toString(16), toBlock: '0x' + b.toString(16) }]); log = r[0]; }
const tx = await rpc('eth_getTransactionByHash', [log.transactionHash]);
console.log('to', tx.to, 'selector', tx.input.slice(0, 10), 'len', tx.input.length);
const rcpt = await rpc('eth_getTransactionReceipt', [log.transactionHash]);
console.log('logs in receipt', rcpt.logs.length, rcpt.logs.map((l) => l.address.slice(0, 10) + ':' + l.topics[0].slice(0, 10)).join(' '));
// printable strings in the calldata
const buf = Buffer.from(tx.input.slice(10), 'hex');
const strs = buf.toString('latin1').match(/[\x20-\x7e]{4,}/g) || [];
console.log('strings in calldata:', strs.slice(0, 30));
for (const l of rcpt.logs) { const s = Buffer.from(l.data.slice(2), 'hex').toString('latin1').match(/[\x20-\x7e]{6,}/g); if (s) console.log('strings in log', l.address.slice(0, 10), s.slice(0, 12)); }
