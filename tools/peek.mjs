// node tools/peek.mjs <address>: PUSH4 selectors of a contract, resolved with 4byte where possible
import { selectorsOf } from '../site/assets/js/engine.js';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [process.argv[2], 'latest'] }) })).json();
const sels = [...selectorsOf(r.result)];
const names = await Promise.all(sels.map(async (s) => { try { const j = await (await fetch('https://www.4byte.directory/api/v1/signatures/?hex_signature=' + s)).json(); return s + ' ' + (j.results?.map((x) => x.text_signature).slice(-1)[0] || '?'); } catch { return s + ' ?'; } }));
console.log(names.join('\n'));
