// Builds the ticker index of every Pons launch: site/data/tickers/<shard>.json + site/data/tickers/meta.json
// node tools/build-index.mjs            full rebuild
// node tools/build-index.mjs --update   only launches after the last indexed block
// Entry: [token, launchBlock, symbol, name, deployer]. Shard = first 2 chars of the normalised symbol.
import fs from 'node:fs';
import { encodeFunctionData, decodeFunctionResult, decodeAbiParameters, parseAbi, hexToString } from '../site/assets/vendor/viem.js';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const F = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const L = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const MC = '0xcA11bde05977b3631167028862bE2a173976CA11';
const OUT = new URL('../site/data/tickers/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(m, p) {
  for (let i = 0; ; i++) {
    try {
      const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json();
      if (!j.error) return j.result;
      if (/10000|limit|exceed|too many results/i.test(j.error.message) && !/rate/i.test(j.error.message)) { const e = new Error(j.error.message); e.split = true; throw e; }
      if (i > 8) throw new Error(j.error.message);
    } catch (e) { if (e.split || i > 8) { console.error('rpc failed:', m, e.message); throw e; } }
    await sleep(800 * (i + 1));
  }
}
const hex = (n) => '0x' + n.toString(16);
async function logs(a, b) {
  try { return await rpc('eth_getLogs', [{ address: F, topics: [L], fromBlock: hex(a), toBlock: hex(b) }]); }
  catch (e) { if (!e.split || b <= a) throw e; const m = Math.floor((a + b) / 2); return (await logs(a, m)).concat(await logs(m + 1, b)); }
}
export const norm = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9]/g, '');
export const shardOf = (s) => { const n = norm(s); return (n.slice(0, 2) || '__').padEnd(2, '_'); };

const update = process.argv.includes('--update');
fs.mkdirSync(OUT, { recursive: true });
const metaPath = new URL('meta.json', OUT);
const meta = update && fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : { block: 0, count: 0 };
const head = parseInt(await rpc('eth_blockNumber', []), 16);
const from = update ? meta.block + 1 : 0;
console.log(`launch logs ${from} → ${head}`);
const W = 2_000_000;
const launches = [];
const jobs = [];
for (let a = from; a <= head; a += W) jobs.push([a, Math.min(head, a + W - 1)]);
for (let i = 0; i < jobs.length; i += 4) {
  const r = await Promise.all(jobs.slice(i, i + 4).map(([a, b]) => logs(a, b)));
  for (const x of r) for (const l of x) launches.push({ token: '0x' + l.topics[1].slice(26), deployer: '0x' + l.topics[3].slice(26), block: parseInt(l.blockNumber, 16) });
  process.stdout.write(`\r  windows ${Math.min(i + 4, jobs.length)}/${jobs.length}  launches ${launches.length}   `);
}
console.log();

// symbol + name through Multicall3
const ERC = parseAbi(['function symbol() view returns (string)', 'function name() view returns (string)']);
const AG = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
const SYM = encodeFunctionData({ abi: ERC, functionName: 'symbol' }), NAME = encodeFunctionData({ abi: ERC, functionName: 'name' });
const str = (d) => { try { if (d.length === 66) return hexToString(d).replace(/\0+$/, ''); return decodeAbiParameters([{ type: 'string' }], d)[0]; } catch { return ''; } };
const B = 250;
let done = 0;
async function batch(list) {
  const calls = list.flatMap((x) => [{ target: x.token, allowFailure: true, callData: SYM }, { target: x.token, allowFailure: true, callData: NAME }]);
  const data = encodeFunctionData({ abi: AG, functionName: 'aggregate3', args: [calls] });
  const out = decodeFunctionResult({ abi: AG, functionName: 'aggregate3', data: await rpc('eth_call', [{ to: MC, data, gas: '0x5f5e100' }, 'latest']) });
  list.forEach((x, i) => { x.symbol = out[2 * i].success ? str(out[2 * i].returnData) : ''; x.name = out[2 * i + 1].success ? str(out[2 * i + 1].returnData) : ''; });
}
const chunks = [];
for (let i = 0; i < launches.length; i += B) chunks.push(launches.slice(i, i + B));
for (let i = 0; i < chunks.length; i += 6) {
  await Promise.all(chunks.slice(i, i + 6).map(batch));
  done += chunks.slice(i, i + 6).length;
  process.stdout.write(`\r  names ${done}/${chunks.length}   `);
}
console.log();

// merge into shards
const shards = {};
const load = (k) => { if (!shards[k]) { const p = new URL(k + '.json', OUT); shards[k] = update && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : []; } return shards[k]; };
for (const x of launches) load(shardOf(x.symbol)).push([x.token, x.block, x.symbol.slice(0, 40), x.name.slice(0, 80), x.deployer]);
if (!update) for (const f of fs.readdirSync(OUT)) if (/^[A-Z0-9_]{2}\.json$/.test(f)) fs.unlinkSync(new URL(f, OUT));
for (const [k, v] of Object.entries(shards)) { v.sort((a, b) => a[1] - b[1]); fs.writeFileSync(new URL(k + '.json', OUT), JSON.stringify(v)); }
const count = (update ? meta.count : 0) + launches.length;
fs.writeFileSync(metaPath, JSON.stringify({ block: head, count, built: new Date().toISOString() }));
console.log(`index: ${count} launches up to block ${head}, ${Object.keys(shards).length} shards touched`);
