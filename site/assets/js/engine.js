// Hoodwink investigation engine. Runs in the browser and in Node (same file).
// Everything is read from the public Robinhood Chain RPC: no indexer, no API key, no server of ours.
// Each check returns evidence (addresses, blocks, transactions, raw values) that anyone can re-read on chain.
import {
  encodeFunctionData, decodeFunctionResult, decodeAbiParameters, encodeAbiParameters,
  parseAbi, keccak256, toFunctionSelector, getAddress, isAddress, formatUnits, hexToString,
} from '../vendor/viem.js';
import { PROBE_CODE, PROBE_ABI } from './probe-code.js';
import { STOCKS } from './stocks.js';
import { launchMetadata, parseX } from './meta.js';
const STOCK_SYMS = new Set(Object.keys(STOCKS).map((x) => x.toUpperCase()));

export const CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  blockTime: 0.1045, // seconds, measured over the last 1,000,000 blocks on 2026-10-31
};

// Known contracts on Robinhood Chain (all verified by reading the chain, see docs/architecture)
export const KNOWN = {
  ponsFactory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  ponsEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
  ponsHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  // Every official Robinhood stock token is the same beacon proxy: identical runtime bytecode,
  // with the issuer's beacon baked in as an immutable. Hash measured on NVDA, TSLA and AAPL.
  stockProxyCodeHash: '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630',
  stockBeacon: '0xe10b6f6b275de231345c20d14ab812db62151b00',
  // A reference Pons token used to fingerprint the Pons token template
  ponsReference: '0x76350e2e9a297ff16d5c60aa1f0dcf9eaa9f8592',
};
const PONS_LAUNCH_TOPIC = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SLOT_1967_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SLOT_1967_ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const SLOT_1967_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582cfb8b33a5';
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = new Set([ZERO, '0x000000000000000000000000000000000000dead', '0xdead000000000000000042069420694206942069']);
const PROBE_AT = '0x4000000000000000000000000000000000000d0d';
const FRESH = '0x000000000000000000000000000000000000beef';
const LOG_WINDOW = 10_000_000; // the RPC caps eth_getLogs at 10M blocks per request
const MAX_LOGS = 60_000;       // above this the browser would choke; distribution is then marked partial

const ERC20 = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)', 'function owner() view returns (address)',
  'function getOwner() view returns (address)', 'function implementation() view returns (address)',
]);
const PONS = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  'function graduated() view returns (bool)',
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function extsload(bytes32) view returns (bytes32)',
]);

// ------------------------------------------------------------------ check catalogue
// The order here is the order of the report. `group` drives the sections of the report page.
export const GROUPS = [
  { id: 'identity', title: 'Identity', q: 'Is this the token it says it is?' },
  { id: 'reality', title: 'Reality', q: 'Is the project real, or a LARP?' },
  { id: 'launch', title: 'Launch', q: 'Was the start fair, and are the snipers still in?' },
  { id: 'holders', title: 'Holders', q: 'Who holds the supply now?' },
  { id: 'dev', title: 'Developer', q: 'Who launched it, and what did they do before?' },
  { id: 'market', title: 'Market and contract', q: 'Where does it trade, and is the contract standard?' },
];
export const CHECKS = [
  { id: 'ticker', group: 'identity', title: 'Ticker uniqueness', q: 'Is this the only token with this ticker, or a copy of an earlier one?' },
  { id: 'stock', group: 'identity', title: 'Stock look-alike', q: 'Does it borrow the ticker or name of a Robinhood stock token?' },
  { id: 'brand', group: 'identity', title: 'Robinhood branding', q: 'Does it lean on the Robinhood name without being Robinhood?' },
  { id: 'pair', group: 'identity', title: 'Pair asset', q: 'What is it priced in, and is that asset genuine?' },
  { id: 'website', group: 'reality', title: 'Website', q: 'Does the website given at launch work, and does it show this contract?' },
  { id: 'social', group: 'reality', title: 'X account', q: 'Is the X link the project\'s own account, or someone else\'s post?' },
  { id: 'code', group: 'reality', title: 'Code', q: 'Is there a real repository behind the claims?' },
  { id: 'larp', group: 'reality', title: 'AI verdict', q: 'Taking all the evidence: real product, honest meme, or LARP?' },
  { id: 'firstblock', group: 'launch', title: 'Snipers', q: 'How much was bought in the launch block and the first 30 seconds, and is it still held?' },
  { id: 'burners', group: 'launch', title: 'Fresh wallets', q: 'Were the first buyers throwaway wallets?' },
  { id: 'distribution', group: 'holders', title: 'Top 10', q: 'How much do the ten largest wallets hold?' },
  { id: 'clusters', group: 'holders', title: 'Linked wallets', q: 'Do holders pass tokens between each other like one owner?' },
  { id: 'dev', group: 'dev', title: 'Deployer on this token', q: 'What did the deployer buy, keep and sell here?' },
  { id: 'devrep', group: 'dev', title: 'Deployer track record', q: 'What happened to the deployer\'s earlier launches?' },
  { id: 'liquidity', group: 'market', title: 'Liquidity', q: 'Where does it trade and how deep is it?' },
  { id: 'contract', group: 'market', title: 'Contract', q: 'Is the contract the standard launchpad template, with nothing hidden?' },
];
// Measured internally and folded into the 'contract' line (on Pons they are fixed by the template).
const INTERNAL = [
  { id: 'deployed', title: 'Deployed token contract' }, { id: 'erc20', title: 'Token interface' }, { id: 'proxy', title: 'Upgradeability' },
  { id: 'owner', title: 'Ownership' }, { id: 'powers', title: 'Privileged functions' }, { id: 'template', title: 'Launchpad template' },
  { id: 'origin', title: 'Origin' }, { id: 'serial', title: 'Deployer history' }, { id: 'burned', title: 'Burned supply' },
  { id: 'roundtrip', title: 'Buy, move, sell' }, { id: 'tax', title: 'Fees and taxes' },
];
const PUBLIC = new Set(CHECKS.map((c) => c.id));

// ------------------------------------------------------------------ RPC
let RPC_URL = CHAIN.rpc;
export const setRpc = (u) => { RPC_URL = u || CHAIN.rpc; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let inflight = 0;
const queue = [];
async function slot() {
  if (inflight < 5) { inflight++; return; }
  await new Promise((r) => queue.push(r));
  inflight++;
}
function release() { inflight--; const n = queue.shift(); if (n) n(); }
export let rpcCount = 0;
export async function rpc(method, params) {
  await slot();
  try {
    for (let i = 0; ; i++) {
      let j;
      try {
        rpcCount++;
        const r = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        if (r.status === 429) throw Object.assign(new Error('rate limited'), { retry: true });
        j = await r.json();
      } catch (e) {
        if (i < 8) { await sleep(600 * (i + 1)); continue; }
        throw e;
      }
      if (!j.error) return j.result;
      if (/too many|rate|limit exceeded|timeout/i.test(j.error.message) && !/block range|10000000|narrow/i.test(j.error.message) && i < 6) { await sleep(900 * (i + 1)); continue; }
      const err = new Error(j.error.message);
      err.data = j.error.data;
      throw err;
    }
  } finally { release(); }
}
const hexn = (n) => '0x' + BigInt(n).toString(16);
const lc = (a) => (a || '').toLowerCase();
const word = (x) => BigInt(x).toString(16).padStart(64, '0');
const topicAddr = (a) => '0x' + lc(a).replace('0x', '').padStart(64, '0');
async function ethCall(to, data, overrides, block = 'latest') {
  const p = [{ to, data, gas: '0x2faf080' }, block];
  if (overrides) p.push(overrides);
  return rpc('eth_call', p);
}
async function read(to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const out = await ethCall(to, data);
  return decodeFunctionResult({ abi, functionName, data: out });
}
async function tryRead(to, abi, fn, args) { try { return await read(to, abi, fn, args); } catch { return undefined; } }
async function readString(to, sel) {
  try {
    const out = await ethCall(to, sel);
    if (!out || out === '0x') return undefined;
    if (out.length === 66) return hexToString(out).replace(/\0+$/, ''); // bytes32 names (old tokens)
    return decodeAbiParameters([{ type: 'string' }], out)[0];
  } catch { return undefined; }
}
const addrFromWord = (w) => (w && w !== '0x' && BigInt(w) !== 0n ? getAddress('0x' + w.slice(-40)) : null);

// ------------------------------------------------------------------ bytecode analysis
/** every PUSH4 value in the bytecode (function selectors sit in the dispatcher as PUSH4) */
export function selectorsOf(code) {
  const out = new Set();
  const b = code.startsWith('0x') ? code.slice(2) : code;
  for (let i = 0; i < b.length; i += 2) {
    const op = parseInt(b.substr(i, 2), 16);
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      if (n === 4) out.add('0x' + b.substr(i + 2, 8));
      i += n * 2;
    }
  }
  return out;
}
// Privileged functions that hurt holders when someone still controls them. Grouped by what they let the controller do.
const POWER_SIGS = {
  mint: ['mint(address,uint256)', 'mint(uint256)', 'mintTo(address,uint256)', 'issue(uint256)', 'increaseSupply(uint256)'],
  blacklist: ['blacklist(address)', 'addToBlacklist(address)', 'setBlacklist(address,bool)', 'blacklistAddress(address,bool)', 'addBot(address)', 'addBots(address[])', 'setBots(address[],bool)', 'setBot(address,bool)', 'blockAddress(address)', 'freeze(address)', 'freezeAccount(address,bool)', 'setBlacklisted(address,bool)', 'isBlacklisted(address)'],
  pause: ['pause()', 'unpause()', 'setPaused(bool)', 'stopTrading()'],
  tax: ['setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxes(uint256,uint256)', 'setBuyTax(uint256)', 'setSellTax(uint256)', 'updateFees(uint256,uint256)', 'setTaxFeePercent(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)', 'updateBuyFees(uint256,uint256,uint256)', 'updateSellFees(uint256,uint256,uint256)', 'setTax(uint256)'],
  limits: ['setMaxTxAmount(uint256)', 'setMaxWalletSize(uint256)', 'setMaxWallet(uint256)', 'setMaxTx(uint256)', 'updateMaxTxnAmount(uint256)', 'updateMaxWalletAmount(uint256)', 'setCooldown(uint256)'],
  exempt: ['excludeFromFee(address)', 'excludeFromFees(address,bool)', 'setExcludeFromFees(address,bool)', 'setIsFeeExempt(address,bool)', 'excludeFromMaxTransaction(address,bool)'],
  trading: ['enableTrading()', 'openTrading()', 'setTradingEnabled(bool)', 'startTrading()', 'setTrading(bool)'],
  upgrade: ['upgradeTo(address)', 'upgradeToAndCall(address,bytes)'],
  ownership: ['transferOwnership(address)', 'renounceOwnership()', 'owner()'],
};
const POWER_LABEL = {
  mint: 'can create new supply', blacklist: 'can block or freeze addresses', pause: 'can halt all transfers',
  tax: 'can change trade taxes', limits: 'can cap transaction or wallet sizes', exempt: 'can exempt chosen wallets from fees',
  trading: 'has a trading on/off switch', upgrade: 'can replace its own code (UUPS)', ownership: 'has an owner role',
};
const POWER_SEL = Object.fromEntries(Object.entries(POWER_SIGS).map(([k, sigs]) => [k, sigs.map((s) => ({ sig: s, sel: toFunctionSelector('function ' + s) }))]));
function powersIn(selectors) {
  const found = {};
  for (const [k, list] of Object.entries(POWER_SEL)) {
    const hits = list.filter((x) => selectors.has(x.sel)).map((x) => x.sig);
    if (hits.length) found[k] = hits;
  }
  return found;
}
/** EIP-1167 minimal proxy target, if the code is one */
function cloneTarget(code) {
  const m = lc(code).match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/);
  return m ? getAddress('0x' + m[1]) : null;
}
/** immutable beacon pattern: PUSH32 <beacon> ... implementation() selector (Robinhood stock tokens use it) */
function immutableBeacon(code) {
  const m = lc(code).match(/7f000000000000000000000000([0-9a-f]{40})[0-9a-f]{0,40}635c60da1b/);
  return m ? getAddress('0x' + m[1]) : null;
}

// ------------------------------------------------------------------ helpers on chain state
const MC = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
/** exact balances through Multicall3, 400 per call */
async function balancesOf(token, addrs, onProgress) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < addrs.length; i += 400) chunks.push(addrs.slice(i, i + 400));
  let done = 0;
  await Promise.all(chunks.map(async (c) => {
    const calls = c.map((a) => ({ target: token, allowFailure: true, callData: encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [a] }) }));
    const res = await read(KNOWN.multicall3, MC, 'aggregate3', [calls]);
    res.forEach((r, i) => { if (r.success && r.returnData.length >= 66) out.set(lc(c[i]), BigInt(r.returnData.slice(0, 66))); });
    done++; onProgress && onProgress(done / chunks.length);
  }));
  return out;
}
/**
 * Which of these addresses are contracts that are NOT personal wallets: one eth_call per 1500 addresses
 * through the probe's codeSizes(). An account counts as a person when it is an EIP-7702 delegation
 * (23-byte 0xef0100 code) or when its code, or the code it forwards to, exposes an account interface:
 * validateUserOp (ERC-4337), isValidSignature (ERC-1271) or execute(address,uint256,bytes).
 */
const ACCOUNT_SELECTORS = ['0x19822f7c', '0x1626ba7e', '0xb61d27f6', '0x34fcd5be', '0x51945447'];
async function contractsAmong(addrs) {
  const info = [];
  const chunks = [];
  for (let i = 0; i < addrs.length; i += 1500) chunks.push(addrs.slice(i, i + 1500));
  await Promise.all(chunks.map(async (c) => {
    const data = encodeFunctionData({ abi: PROBE_ABI, functionName: 'codeSizes', args: [c] });
    const [sizes, hashes] = decodeFunctionResult({ abi: PROBE_ABI, functionName: 'codeSizes', data: await ethCall(PROBE_AT, data, { [PROBE_AT]: { code: PROBE_CODE } }) });
    sizes.forEach((n, i) => { if (n > 0n) info.push({ a: lc(c[i]), n: Number(n), h: hashes[i] }); });
  }));
  // one representative per distinct code
  const fams = new Map();
  for (const x of info) { if (!fams.has(x.h)) fams.set(x.h, { rep: x.a, n: x.n, members: [] }); fams.get(x.h).members.push(x.a); }
  const isAccount = new Map();
  const famList = [...fams.entries()].sort((a, b) => b[1].members.length - a[1].members.length);
  await Promise.all(famList.map(async ([h, f], idx) => {
    if (f.n === 23) { isAccount.set(h, true); return; }
    if (idx >= 80) { isAccount.set(h, true); return; } // not inspected: counted as people, which can only raise concentration
    try {
      let code = await rpc('eth_getCode', [f.rep, 'latest']);
      const sels = selectorsOf(code);
      let target = cloneTarget(code);
      if (!target) target = addrFromWord(await rpc('eth_getStorageAt', [f.rep, SLOT_1967_IMPL, 'latest']));
      if (target) for (const s of selectorsOf(await rpc('eth_getCode', [target, 'latest']))) sels.add(s);
      isAccount.set(h, ACCOUNT_SELECTORS.some((s) => sels.has(s)));
    } catch { isAccount.set(h, true); }
  }));
  const contracts = new Set(), smart = new Set();
  for (const x of info) (isAccount.get(x.h) ? smart : contracts).add(x.a);
  return { contracts, smart };
}
async function head() { return parseInt(await rpc('eth_blockNumber', []), 16); }
async function blockTs(n) { const b = await rpc('eth_getBlockByNumber', [hexn(n), false]); return b ? parseInt(b.timestamp, 16) : null; }

/** logs over [from, to] in windows the RPC accepts, splitting on "too many results" */
async function getLogsRange(filter, from, to, onProgress, cap = MAX_LOGS) {
  const all = [];
  let truncated = false;
  const windows = [];
  for (let a = from; a <= to; a += LOG_WINDOW) windows.push([a, Math.min(to, a + LOG_WINDOW - 1)]);
  let done = 0;
  let got = 0;
  async function one(a, b, depth = 0) {
    if (got > cap) { truncated = true; return []; } // enough read: stop splitting
    try {
      const r = await rpc('eth_getLogs', [{ ...filter, fromBlock: hexn(a), toBlock: hexn(b) }]);
      got += r.length;
      return r;
    } catch (e) {
      if (depth < 18 && b > a && /result|response|limit|too many|exceed|size|timeout/i.test(e.message)) {
        const m = Math.floor((a + b) / 2);
        const x = await one(a, m, depth + 1);
        const y = await one(m + 1, b, depth + 1);
        return x.concat(y);
      }
      throw e;
    }
  }
  // windows in order, oldest first, so the cap always keeps the beginning (the launch) and cuts the same way every run
  for (let i = 0; i < windows.length; i += 1) {
    if (all.length > cap) { truncated = true; break; }
    const batch = [await one(...windows[i])];
    for (const r of batch) for (const l of r) all.push(l);
    done += batch.length;
    onProgress && onProgress(done / windows.length, all.length);
  }
  if (all.length > cap) truncated = true;
  return { logs: all, truncated };
}
/** search backwards for the first window holding a matching log (launch events are unique) */
async function findLog(filter, top) {
  for (let b = top; b >= 0; b -= LOG_WINDOW) {
    const a = Math.max(0, b - LOG_WINDOW + 1);
    const r = await rpc('eth_getLogs', [{ ...filter, fromBlock: hexn(a), toBlock: hexn(b) }]);
    if (r.length) return r[0];
    if (a === 0) break;
  }
  return null;
}
/** storage slot of `balanceOf` for a token: tries solidity mapping slots and the OpenZeppelin v5 namespace */
async function findBalanceSlot(token, who) {
  const amount = 123456789n;
  const ozBase = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
  const candidates = [];
  for (let s = 0; s < 12; s++) candidates.push({ key: (w) => keccak256('0x' + word(w) + word(s)), label: 'slot ' + s });
  candidates.push({ key: (w) => keccak256('0x' + word(w) + word(ozBase)), label: 'ERC-7201 namespace' });
  for (const c of candidates) {
    const k = c.key(who);
    try {
      const out = await ethCall(token, encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [who] }), { [token]: { stateDiff: { [k]: '0x' + word(amount) } } });
      if (BigInt(out) === amount) return { slotKey: k, label: c.label };
      if (BigInt(out) !== 0n && BigInt(out) % amount === 0n) return { slotKey: k, label: c.label + ' (scaled)' };
    } catch { /* next */ }
  }
  return null;
}

// ------------------------------------------------------------------ the investigation
/**
 * investigate(address, { onCheck, onStage }) -> report
 * onCheck(check) fires as each check settles, so a UI can fill the report live.
 */
export async function investigate(input, opts = {}) {
  const t0 = Date.now();
  const startCount = rpcCount;
  const emit = (c) => opts.onCheck && opts.onCheck(c);
  const stage = (s, p) => opts.onStage && opts.onStage(s, p);
  if (!isAddress(input)) throw new Error('Not an address. Paste a 0x token address on Robinhood Chain.');
  const token = getAddress(input);
  const results = Object.fromEntries(CHECKS.concat(INTERNAL).map((c) => [c.id, { group: 'internal', q: '', ...c, status: 'pending', evidence: [] }]));
  const set = (id, status, summary, evidence = [], extra = {}) => {
    Object.assign(results[id], { status, summary, evidence, ...extra });
    if (PUBLIC.has(id)) emit(results[id]);
  };
  const ctx = { token };

  stage('Reading the contract');
  const H = await head();
  ctx.head = H;
  const code = await rpc('eth_getCode', [token, 'latest']);
  if (!code || code === '0x') {
    set('contract', 'critical', 'No contract at this address on Robinhood Chain. It is a wallet, or the token lives on another chain.', [{ k: 'Bytecode', v: 'empty at block ' + H }]);
    for (const c of CHECKS) if (results[c.id].status === 'pending') set(c.id, 'na', 'Nothing to check without a contract.');
    return finish();
  }
  const codeHash = keccak256(code);
  set('deployed', 'pass', `Contract found: ${((code.length - 2) / 2).toLocaleString('en-US')} bytes of runtime code.`, [
    { k: 'Address', v: token, addr: token }, { k: 'Code hash', v: codeHash }, { k: 'Read at block', v: H.toLocaleString('en-US') },
  ]);

  // ---------------------------------------------------- identity
  const [name, symbol, decRaw, supplyRaw] = await Promise.all([
    readString(token, '0x06fdde03'), readString(token, '0x95d89b41'),
    tryRead(token, ERC20, 'decimals'), tryRead(token, ERC20, 'totalSupply'),
  ]);
  const decimals = decRaw === undefined ? 18 : Number(decRaw);
  Object.assign(ctx, { name, symbol, decimals, totalSupply: supplyRaw });
  const fmt = (v, d = decimals) => fmtAmount(v, d);
  if (supplyRaw === undefined || symbol === undefined) {
    set('erc20', 'critical', 'The contract does not answer the basic ERC-20 calls (symbol or totalSupply). It is not a normal token.', [
      { k: 'symbol()', v: symbol ?? 'reverted' }, { k: 'totalSupply()', v: supplyRaw === undefined ? 'reverted' : String(supplyRaw) },
    ]);
  } else {
    set('erc20', 'pass', `${name || '(no name)'} (${symbol}), ${decimals} decimals, ${fmt(supplyRaw)} total supply.`, [
      { k: 'name()', v: name ?? 'none' }, { k: 'symbol()', v: symbol }, { k: 'decimals()', v: String(decimals) }, { k: 'totalSupply()', v: supplyRaw.toString() },
    ]);
  }

  // proxy resolution (needed by several checks)
  stage('Resolving proxies');
  const [implW, adminW, beaconW] = await Promise.all([
    rpc('eth_getStorageAt', [token, SLOT_1967_IMPL, 'latest']),
    rpc('eth_getStorageAt', [token, SLOT_1967_ADMIN, 'latest']),
    rpc('eth_getStorageAt', [token, SLOT_1967_BEACON, 'latest']),
  ]);
  let impl = addrFromWord(implW);
  const admin = addrFromWord(adminW);
  let beacon = addrFromWord(beaconW) || immutableBeacon(code);
  const clone = cloneTarget(code);
  if (beacon && !impl) impl = await tryRead(beacon, ERC20, 'implementation');
  if (clone && !impl) impl = clone;
  let implCode = null;
  if (impl) implCode = await rpc('eth_getCode', [impl, 'latest']);
  Object.assign(ctx, { impl, admin, beacon, clone });

  const isOfficialStock = lc(codeHash) === KNOWN.stockProxyCodeHash && lc(beacon) === KNOWN.stockBeacon;
  ctx.isOfficialStock = isOfficialStock;
  const stockClaim = /robinhood token/i.test(name || '') || /•\s*robinhood/i.test(name || '') || STOCK_SYMS.has((symbol || '').toUpperCase());
  if (isOfficialStock) {
    set('stock', 'pass', `Genuine Robinhood stock token. The bytecode matches the official stock-token proxy byte for byte and points to the issuer's beacon.`, [
      { k: 'Code hash', v: codeHash }, { k: 'Official hash', v: KNOWN.stockProxyCodeHash }, { k: 'Issuer beacon', v: KNOWN.stockBeacon, addr: KNOWN.stockBeacon },
    ]);
  } else if (stockClaim) {
    const real = STOCKS[(symbol || '').toUpperCase()];
    const nameClaim = /robinhood token/i.test(name || '') || /•\s*robinhood/i.test(name || '');
    const ev = [
      { k: 'name()', v: name }, { k: 'symbol()', v: symbol }, { k: 'Code hash', v: codeHash }, { k: 'Official stock-token hash', v: KNOWN.stockProxyCodeHash },
      ...(real ? [{ k: `Genuine ${symbol.toUpperCase()}`, v: real, addr: real }] : []),
    ];
    if (nameClaim) set('stock', 'critical', `Impostor. It calls itself a Robinhood stock token, but its code is not the official stock-token proxy.${real ? ` The real ${symbol} is ${short(real)}.` : ''}`, ev);
    else set('stock', 'concern', `Look-alike ticker. ${symbol} is also the ticker of an official Robinhood stock token, and this is not it. Fine for a memecoin, dangerous if you meant to buy the stock: the real ${symbol.toUpperCase()} is ${short(real)}.`, ev);
  } else {
    set('stock', 'na', 'Does not present itself as a Robinhood stock token.');
  }
  const brandRe = /robin\s*hood|robinhood\s*chain|\bhood\s*chain\b/i;
  if (isOfficialStock) set('brand', 'pass', 'Uses the Robinhood name legitimately: it is an official stock token.', []);
  else if (brandRe.test(name || '') || /^(RH|HOOD|RHC|ROBINHOOD)$/i.test(symbol || '')) {
    set('brand', 'concern', `The name or ticker leans on Robinhood ("${name}" / ${symbol}). Robinhood Chain has no native token: gas is paid in ETH. Any token presented as "the Robinhood Chain token" is not official.`, [
      { k: 'name()', v: name }, { k: 'symbol()', v: symbol },
    ]);
  } else set('brand', 'pass', 'No Robinhood branding in the name or ticker.', [{ k: 'name()', v: name ?? '' }, { k: 'symbol()', v: symbol ?? '' }]);

  // ---------------------------------------------------- control
  if (impl || admin || beacon) {
    const ev = [];
    if (impl) ev.push({ k: 'Implementation', v: impl, addr: impl });
    if (admin) ev.push({ k: 'Proxy admin (EIP-1967)', v: admin, addr: admin });
    if (beacon) ev.push({ k: 'Beacon', v: beacon, addr: beacon });
    if (clone) {
      set('proxy', 'pass', 'Minimal clone (EIP-1167): it forwards to a fixed implementation that cannot be changed.', ev);
    } else if (isOfficialStock) {
      set('proxy', 'info', 'Upgradeable by the issuer through its beacon. That is expected for a regulated tokenized stock, and it means the issuer can change the rules.', ev);
    } else {
      set('proxy', 'concern', 'Upgradeable proxy: whoever controls the ' + (beacon ? 'beacon' : 'admin slot') + ' can replace the code behind this address, including the transfer rules.', ev);
    }
  } else {
    set('proxy', 'pass', 'Not a proxy. The code at this address is final and cannot be replaced.', [
      { k: 'EIP-1967 implementation slot', v: 'empty' }, { k: 'EIP-1967 beacon slot', v: 'empty' }, { k: 'EIP-1167 clone', v: 'no' },
    ]);
  }

  const selectors = selectorsOf(code);
  if (implCode) for (const s of selectorsOf(implCode)) selectors.add(s);
  const powers = powersIn(selectors);
  const owner = (await tryRead(token, ERC20, 'owner')) || (await tryRead(token, ERC20, 'getOwner'));
  ctx.owner = owner;
  const ownerLive = owner && !DEAD.has(lc(owner));
  let ownerIsContract = false;
  if (ownerLive) ownerIsContract = (await rpc('eth_getCode', [owner, 'latest'])) !== '0x';
  if (owner === undefined) {
    set('owner', isOfficialStock ? 'info' : 'pass', isOfficialStock ? 'No owner() function; control sits with the issuer through the beacon.' : 'No owner() or getOwner() function.', [{ k: 'owner()', v: 'not present' }]);
  } else if (!ownerLive) {
    set('owner', 'pass', 'Ownership renounced: the owner is the zero or dead address.', [{ k: 'owner()', v: owner, addr: owner }]);
  } else {
    set('owner', 'concern', `An owner still exists (${ownerIsContract ? 'a contract, possibly a multisig or timelock' : 'a single wallet'}). What it can do is listed under privileged functions.`, [{ k: 'owner()', v: owner, addr: owner }, { k: 'Owner type', v: ownerIsContract ? 'contract' : 'wallet (EOA)' }]);
  }

  // Pons record (needed for template/origin)
  stage('Checking launchpads');
  let pons = await tryRead(KNOWN.ponsFactory, PONS, 'getLaunchedToken', [token]);
  if (pons && !pons.exists) pons = null;
  ctx.pons = pons;

  const dangerous = Object.keys(powers).filter((k) => k !== 'ownership' && k !== 'trading');
  const pEv = Object.entries(powers).map(([k, sigs]) => ({ k: POWER_LABEL[k], v: sigs.join(', ') }));
  pEv.push({ k: 'Selectors scanned', v: `${selectors.size} in ${implCode ? 'proxy + implementation' : 'contract'} bytecode` });
  if (!dangerous.length) {
    set('powers', 'pass', 'No mint, blacklist, pause, tax-change or limit functions in the bytecode.' + (powers.trading ? ' A trading switch exists.' : ''), pEv);
  } else {
    const controlled = ownerLive || impl || isOfficialStock || owner === undefined;
    const words = dangerous.map((k) => POWER_LABEL[k]).join('; ');
    if (isOfficialStock) set('powers', 'info', `Issuer controls typical of a regulated asset: ${words}.`, pEv);
    else if (!ownerLive && owner !== undefined && !impl) set('powers', 'info', `The code ${words}, but ownership is renounced, so nobody can call these functions any more (unless they use a role other than owner).`, pEv);
    else set('powers', controlled && (powers.mint || powers.blacklist || powers.pause) ? 'critical' : 'concern', `The code ${words}.`, pEv);
  }

  if (pons) {
    const ref = KNOWN.ponsReference;
    let same = false;
    if (lc(token) === lc(ref)) same = true;
    else {
      const refRec = await tryRead(KNOWN.ponsFactory, PONS, 'getLaunchedToken', [ref]);
      const refCode = await rpc('eth_getCode', [ref, 'latest']);
      const norm = (c, rec, t) => {
        let x = lc(c);
        for (const a of [t, rec.curve, rec.deployer, rec.creatorFeeRecipient, rec.pairToken]) if (a && lc(a) !== ZERO) x = x.split(lc(a).slice(2)).join('_'.repeat(40));
        return x;
      };
      same = refRec && norm(code, pons, token) === norm(refCode, refRec, ref);
      ctx.templateDiff = !same;
    }
    if (same) set('template', 'pass', 'Byte-identical to the Pons token template once its own addresses are masked. No custom code was slipped in.', [{ k: 'Compared with', v: ref, addr: ref }, { k: 'Masked fields', v: 'token, curve, deployer, fee recipient, pair' }]);
    else set('template', 'concern', 'Registered by the Pons factory but the bytecode differs from the template. Inspect before trusting.', [{ k: 'Code hash', v: codeHash }]);
  } else if (isOfficialStock) {
    set('template', 'pass', 'Official stock-token proxy (fingerprint matched under identity).', []);
  } else if (clone) {
    set('template', 'info', 'Clone of ' + clone + '. Not a launchpad Hoodwink recognises; the clone target was scanned for privileged functions.', [{ k: 'Clone target', v: clone, addr: clone }]);
  } else {
    set('template', 'unchecked', 'Not from a launchpad Hoodwink fingerprints (Pons). Custom code: only the privileged-function scan applies.', []);
  }

  // ---------------------------------------------------- launch
  stage('Finding the launch');
  let launchBlock = null, launchTx = null;
  if (pons) {
    const l = await findLog({ address: KNOWN.ponsFactory, topics: [PONS_LAUNCH_TOPIC, topicAddr(token)] }, H);
    if (l) { launchBlock = parseInt(l.blockNumber, 16); launchTx = l.transactionHash; }
    const phase = Number(pons.phase);
    let graduated = phase > 0;
    const g = await tryRead(pons.curve, PONS, 'graduated');
    if (g !== undefined) graduated = g;
    ctx.graduated = graduated;
    const ev = [
      { k: 'Launchpad', v: 'Pons (factory ' + short(KNOWN.ponsFactory) + ')', addr: KNOWN.ponsFactory },
      { k: 'Deployer', v: pons.deployer, addr: pons.deployer },
      { k: 'Bonding curve', v: pons.curve, addr: pons.curve },
      { k: 'Creator fee recipient', v: pons.creatorFeeRecipient, addr: pons.creatorFeeRecipient },
      { k: 'Creator tax', v: (Number(pons.creatorTaxBps) / 100).toFixed(2) + '%' },
      { k: 'Buyback', v: pons.buybackEnabled ? 'enabled' : 'off' },
      { k: 'Phase', v: graduated ? 'graduated to Uniswap v4' : 'on the bonding curve' },
    ];
    if (launchBlock) ev.push({ k: 'Launch block', v: launchBlock.toLocaleString('en-US') }, { k: 'Launch transaction', v: launchTx, tx: launchTx });
    set('origin', 'info', `Launched on Pons by ${short(pons.deployer)}, ${graduated ? 'now graduated to a Uniswap v4 pool' : 'still trading on its bonding curve'}.`, ev);
  } else if (isOfficialStock) {
    set('origin', 'info', 'Issued by Robinhood as a tokenized stock.', [{ k: 'Issuer beacon', v: KNOWN.stockBeacon, addr: KNOWN.stockBeacon }]);
  } else {
    set('origin', 'unchecked', 'Not found in the Pons factory. Origin unknown: deployed directly or through a launchpad Hoodwink does not index yet.', [{ k: 'Pons getLaunchedToken', v: 'exists = false' }]);
  }

  // pair asset
  let pair = pons ? getAddress(pons.pairToken) : null;
  ctx.pair = pair;
  if (pons) {
    if (lc(pair) === ZERO) set('pair', 'pass', 'Paired against native ETH.', [{ k: 'Pair', v: 'ETH (native)' }]);
    else {
      const pcode = await rpc('eth_getCode', [pair, 'latest']);
      const pOfficial = lc(keccak256(pcode)) === KNOWN.stockProxyCodeHash;
      const pSym = await readString(pair, '0x95d89b41');
      const pName = await readString(pair, '0x06fdde03');
      ctx.pairSymbol = pSym; ctx.pairDecimals = Number((await tryRead(pair, ERC20, 'decimals')) ?? 18);
      if (lc(pair) === lc(KNOWN.usdg)) set('pair', 'pass', 'Paired against USDG (Global Dollar), the dollar token Robinhood stock pools use.', [{ k: 'Pair', v: pair, addr: pair }]);
      else if (pOfficial) set('pair', 'pass', `Stock-paired: trades against ${pSym}, and that ${pSym} is the genuine Robinhood stock token (code fingerprint matched).`, [{ k: 'Pair', v: `${pName} (${pSym})`, addr: pair }, { k: 'Pair code hash', v: keccak256(pcode) }]);
      else {
        const pairIsPons = (await tryRead(KNOWN.ponsFactory, PONS, 'getLaunchedToken', [pair]))?.exists;
        const fakeStock = STOCK_SYMS.has((pSym || '').toUpperCase()) || /robinhood token/i.test(pName || '');
        const ev = [{ k: 'Pair', v: `${pName || '?'} (${pSym || '?'})`, addr: pair }, { k: 'Pair code hash', v: keccak256(pcode) }, { k: 'Pair launched on Pons', v: pairIsPons ? 'yes' : 'no' }];
        if (fakeStock) set('pair', 'critical', `Paired against a FAKE ${pSym}: it uses a stock ticker but is not the official Robinhood stock token. Buyers pay in a worthless copy.`, ev.concat(STOCKS[(pSym || '').toUpperCase()] ? [{ k: `Genuine ${pSym}`, v: STOCKS[pSym.toUpperCase()], addr: STOCKS[pSym.toUpperCase()] }] : []));
        else set('pair', 'concern', `Paired against ${pSym || 'an unknown token'}${pairIsPons ? ', itself a Pons memecoin' : ', which is neither ETH, USDG nor a Robinhood stock token'}. Your exit is priced in that token, so its risk stacks on top of this one. Scan it too.`, ev);
      }
    }
  } else set('pair', isOfficialStock ? 'na' : 'unchecked', isOfficialStock ? 'A stock token is the pair asset itself.' : 'No launchpad record, so the intended pair is unknown. Pools are listed under liquidity when found.');

  const realityP = pons ? realityChecks(ctx, opts, H).catch((e) => ({ error: shortErr(e) })) : null;

  // ---------------------------------------------------- transfers: launch block, holders, clusters
  // Strategy: (1) the launch window is always read in full; (2) full history when it fits, otherwise the
  // most recent 20k transfers; (3) current balances are read with balanceOf (Multicall3) for every wallet
  // seen, so holder figures are exact for the wallets covered, never reconstructed.
  stage('Rebuilding every transfer');
  const venues = new Set([lc(token), ZERO, lc(KNOWN.poolManager), lc(KNOWN.ponsFactory), lc(KNOWN.ponsEscrow)]);
  if (pons) venues.add(lc(pons.curve));
  for (const d of DEAD) venues.add(d);
  const supply = supplyRaw || 0n;
  const pct = (v) => (supply > 0n ? Number((v * 1000000n) / supply) / 10000 : 0);
  const toT = (l) => ({
    from: lc('0x' + l.topics[1].slice(26)), to: lc('0x' + l.topics[2].slice(26)), v: BigInt(l.data === '0x' ? 0 : l.data.slice(0, 66)),
    b: parseInt(l.blockNumber, 16), tx: l.transactionHash, i: parseInt(l.logIndex, 16),
  });
  const byOrder = (a, b) => a.b - b.b || a.i - b.i;
  let transfers = [], full = false, transferErr = null, launchT = [];
  const windowBlocks = Math.round(30 / CHAIN.blockTime); // first 30 seconds
  if (!isOfficialStock) {
    try {
      const r = await getLogsRange({ address: token, topics: [TRANSFER_TOPIC] }, launchBlock ?? 0, H, (p, n) => stage('Rebuilding every transfer', { p, n }));
      transfers = r.logs.filter((l) => l.topics.length === 3).map(toT).sort(byOrder);
      full = !r.truncated;
      if (!launchBlock && transfers.length) { launchBlock = transfers[0].b; launchTx = transfers[0].tx; }
      if (!full) {
        // the launch window, read on its own so it is complete whatever the size of the token
        if (launchBlock !== null) {
          const lw = await getLogsRange({ address: token, topics: [TRANSFER_TOPIC] }, launchBlock, Math.min(H, launchBlock + windowBlocks * 4), null, 20000);
          launchT = lw.logs.filter((l) => l.topics.length === 3).map(toT).sort(byOrder);
        }
        // and the most recent activity
        stage('Reading recent activity');
        const recent = [];
        for (let b = H; b > (launchBlock ?? 0) && recent.length < 20000; b -= 200_000) {
          const a = Math.max(launchBlock ?? 0, b - 199_999);
          const part = await getLogsRange({ address: token, topics: [TRANSFER_TOPIC] }, a, b, null, 20000);
          for (const l of part.logs) if (l.topics.length === 3) recent.push(toT(l));
        }
        const seen = new Set();
        transfers = transfers.concat(launchT, recent).filter((t) => { const k = t.tx + ':' + t.i; if (seen.has(k)) return false; seen.add(k); return true; }).sort(byOrder);
      } else launchT = transfers;
    } catch (e) { transferErr = shortErr(e); }
  }
  ctx.launchBlock = launchBlock;
  ctx.transferCount = transfers.length;
  ctx.historyFull = full;
  const sampleNote = full ? `all ${transfers.length.toLocaleString('en-US')} Transfer events since launch` : `the launch window plus the latest ${transfers.length.toLocaleString('en-US')} Transfer events (history too long to read whole)`;

  // exact balances for every wallet seen
  const wallets = new Set();
  for (const t of transfers) { wallets.add(t.from); wallets.add(t.to); }
  if (pons) wallets.add(lc(pons.deployer));
  for (const v of venues) wallets.delete(v);
  let bal = new Map();
  if (!transferErr && !isOfficialStock) {
    stage('Reading balances', { p: 0, n: wallets.size });
    try { bal = await balancesOf(token, [...wallets].slice(0, 12000).concat([...DEAD]), (p) => stage('Reading balances', { p, n: wallets.size })); }
    catch (e) { transferErr = shortErr(e); }
  }
  const buySources = new Set([lc(pons?.curve), lc(KNOWN.poolManager)].filter(Boolean));
  const sum = (arr) => arr.reduce((a, t) => a + t.v, 0n);
  // contracts (pools, routers, lockers, vaults) are not people: they are kept out of concentration and clusters
  let contracts = new Set(), smartWallets = new Set();
  if (!transferErr && !isOfficialStock) {
    const edgeAddrs = new Set();
    for (const t of transfers) if (!venues.has(t.from) && !venues.has(t.to)) { edgeAddrs.add(t.from); edgeAddrs.add(t.to); }
    const holdersByBal = [...bal.entries()].filter(([, v]) => v > 0n).sort((x, y) => (y[1] > x[1] ? 1 : -1)).slice(0, 400).map(([a]) => a);
    try { ({ contracts, smart: smartWallets } = await contractsAmong([...new Set([...holdersByBal, ...[...edgeAddrs].slice(0, 9000)])])); } catch { /* treated as wallets */ }
  }
  ctx.contracts = contracts;

  if (transferErr) {
    for (const id of ['firstblock', 'burners', 'dev', 'distribution', 'clusters', 'burned']) set(id, 'unchecked', 'Transfer history could not be read: ' + transferErr);
  } else if (!isOfficialStock) {
    // ---- launch window
    const early = launchT.filter((t) => launchBlock !== null && t.b <= launchBlock + windowBlocks && !venues.has(t.to) && (pons ? buySources.has(t.from) : true));
    const earlyBuyers = [...new Set(early.map((t) => t.to))];
    if (!pons) {
      const mints = launchT.filter((t) => t.from === ZERO);
      set('firstblock', 'info', `Supply was minted to ${new Set(mints.map((m) => m.to)).size} address(es) at block ${launchBlock?.toLocaleString('en-US')}. Without a launchpad record Hoodwink cannot tell buys from distribution.`, mints.slice(0, 5).map((m) => ({ k: 'Minted to ' + short(m.to), v: fmt(m.v) + ' (' + pct(m.v).toFixed(2) + '%)', addr: m.to, tx: m.tx })));
    } else {
      const sameTx = early.filter((t) => t.tx === launchTx);
      const sameBlock = early.filter((t) => t.b === launchBlock && t.tx !== launchTx);
      const devBuy = sum(sameTx), blockBuy = sum(sameBlock), winBuy = sum(early) - devBuy;
      const ev = [
        { k: 'Window', v: `launch block ${launchBlock?.toLocaleString('en-US')} + ${windowBlocks} blocks (≈30 s)` },
        { k: 'Bought inside the launch transaction', v: `${fmt(devBuy)} (${pct(devBuy).toFixed(2)}%)`, tx: launchTx },
        { k: 'Other transactions in the launch block', v: `${fmt(blockBuy)} (${pct(blockBuy).toFixed(2)}%) by ${new Set(sameBlock.map((t) => t.to)).size} wallets` },
        { k: 'Bought by others in the first 30 s', v: `${fmt(winBuy)} (${pct(winBuy).toFixed(2)}%) by ${earlyBuyers.length} wallets` },
      ];
      const still = earlyBuyers.filter((a) => a !== lc(pons.deployer)).reduce((s2, a) => s2 + (bal.get(a) || 0n), 0n);
      ev.push({ k: 'Still held by those early buyers now', v: `${fmt(still)} (${pct(still).toFixed(2)}%), read with balanceOf` });
      const status = pct(blockBuy) > 10 || pct(still) > 20 ? 'critical' : pct(blockBuy) > 3 || pct(winBuy) > 12 || pct(still) > 8 ? 'concern' : 'pass';
      const tail = pct(winBuy) > 1 ? ` Those early buyers still hold ${pct(still).toFixed(1)}%.` : '';
      const msg = status === 'pass'
        ? `Clean start: ${pct(winBuy).toFixed(1)}% of supply went to other wallets in the first 30 seconds.${tail}`
        : `${pct(blockBuy).toFixed(1)}% bought by other transactions in the launch block and ${pct(winBuy).toFixed(1)}% in the first 30 seconds: ${pct(blockBuy) > 10 ? 'a bundled launch' : 'bots sniped the start'}.${tail}`;
      set('firstblock', status, msg, ev, { early: { devBuy: pct(devBuy), blockBuy: pct(blockBuy), winBuy: pct(winBuy), still: pct(still), buyers: earlyBuyers.length } });
    }

    // ---- fresh wallets among early buyers
    const sample = earlyBuyers.slice(0, 40);
    if (!sample.length) set('burners', pons ? 'pass' : 'na', pons ? 'No other wallet bought in the first 30 seconds.' : 'No launchpad record: early buyers cannot be isolated.');
    else {
      const nonces = await Promise.all(sample.map((a) => rpc('eth_getTransactionCount', [a, 'latest']).then((n) => parseInt(n, 16)).catch(() => null)));
      const codes = await Promise.all(sample.map((a) => rpc('eth_getCode', [a, 'latest']).catch(() => '0x')));
      const fresh = sample.filter((a, i) => codes[i] === '0x' && nonces[i] !== null && nonces[i] <= 3);
      const share = fresh.length / sample.length;
      const status = share > 0.5 && fresh.length >= 4 ? 'critical' : share > 0.3 && fresh.length >= 3 ? 'concern' : 'pass';
      set('burners', status, `${fresh.length} of ${sample.length} early buyers have sent 3 transactions or fewer in their whole life${status === 'pass' ? '.' : ': throwaway wallets, typical of one person splitting a snipe.'}`,
        fresh.slice(0, 8).map((a) => ({ k: 'Fresh wallet', v: a, addr: a })).concat([{ k: 'Measured', v: 'lifetime nonce at block ' + H.toLocaleString('en-US') }]));
    }

    // ---- deployer
    if (pons) {
      const dep = lc(pons.deployer);
      const got = transfers.filter((t) => t.to === dep).reduce((a, t) => a + t.v, 0n);
      // a sell is any transfer out of the deployer in a transaction that also pays the curve or the pool (routers included)
      const payTx = new Set(transfers.filter((t) => buySources.has(t.to)).map((t) => t.tx));
      const sold = transfers.filter((t) => t.from === dep && payTx.has(t.tx)).reduce((a, t) => a + t.v, 0n);
      const moved = transfers.filter((t) => t.from === dep && !payTx.has(t.tx) && !venues.has(t.to));
      const movedSum = sum(moved);
      const now = bal.get(dep) || 0n;
      ctx.devMoved = moved.map((t) => t.to);
      const ev = [
        { k: 'Deployer', v: pons.deployer, addr: pons.deployer },
        { k: 'Received' + (full ? '' : ' (covered events)'), v: `${fmt(got)} (${pct(got).toFixed(2)}%)` },
        { k: 'Sold back to the market', v: `${fmt(sold)} (${pct(sold).toFixed(2)}%)` },
        { k: 'Sent to other wallets', v: `${moved.length} transfers, ${fmt(movedSum)} (${pct(movedSum).toFixed(2)}%)` },
        { k: 'Holds now (balanceOf)', v: `${fmt(now)} (${pct(now).toFixed(2)}%)` },
      ];
      let status = 'pass', msg;
      if (got === 0n && now === 0n) msg = 'The deployer never held the token' + (full ? '.' : ' in the events covered.');
      else if (got > 0n && sold * 10n >= got * 8n && pct(got) > 1) { status = 'concern'; msg = `The deployer took ${pct(got).toFixed(1)}% and has sold ${pct(sold).toFixed(1)}% back.`; }
      else if (pct(movedSum) > 2) { status = 'concern'; msg = `The deployer spread ${pct(movedSum).toFixed(1)}% of supply to other wallets (see linked wallets).`; }
      else if (pct(now) > 10) { status = 'concern'; msg = `The deployer still holds ${pct(now).toFixed(1)}% of supply.`; }
      else msg = `The deployer holds ${pct(now).toFixed(2)}% and sold ${pct(sold).toFixed(2)}%.`;
      set('dev', status, msg, ev);
    } else set('dev', 'unchecked', 'Deployer unknown without a launchpad record (no indexer is used to look up creation transactions).');

    // ---- distribution (exact balances)
    const allHeld = [...bal.entries()].filter(([a, v]) => v > 0n && !venues.has(a)).sort((x, y) => (y[1] > x[1] ? 1 : -1));
    const real = allHeld.filter(([a]) => !contracts.has(a));
    const byContracts = allHeld.filter(([a]) => contracts.has(a));
    const inContracts = byContracts.reduce((a, [, v]) => a + v, 0n);
    const top10 = real.slice(0, 10);
    const top10Sum = top10.reduce((a, [, v]) => a + v, 0n);
    const inCurve = pons ? (await tryRead(token, ERC20, 'balanceOf', [pons.curve])) || 0n : 0n;
    const inPM = (await tryRead(token, ERC20, 'balanceOf', [KNOWN.poolManager])) || 0n;
    ctx.holders = real;
    const t10 = pct(top10Sum), t1 = real.length ? pct(real[0][1]) : 0;
    const status = t1 > 15 || t10 > 50 ? 'critical' : t1 > 6 || t10 > 30 ? 'concern' : 'pass';
    set('distribution', status, `${real.length.toLocaleString('en-US')} ${full ? '' : 'covered '}wallet holders. The 10 largest wallets hold ${t10.toFixed(1)}% (largest ${t1.toFixed(1)}%). ${pct(inCurve + inPM).toFixed(1)}% sits in the curve or the v4 pool manager${byContracts.length ? `, ${pct(inContracts).toFixed(1)}% in ${byContracts.length} other contracts` : ''}.`,
      [{ k: 'Wallets from', v: sampleNote }, { k: 'Balances', v: 'read with balanceOf at block ' + H.toLocaleString('en-US') + ' (exact)' }, { k: 'Smart-account wallets counted as people', v: String([...smartWallets].filter((a) => bal.get(a) > 0n).length) }]
        .concat(top10.map(([a, v], i) => ({ k: `#${i + 1}`, v: `${pct(v).toFixed(2)}%  ${fmt(v)}`, addr: a })))
        .concat(byContracts.slice(0, 4).map(([a, v]) => ({ k: 'Contract holder', v: `${pct(v).toFixed(2)}%  ${fmt(v)}`, addr: a }))),
      { holdersTop: top10.map(([a, v]) => ({ a, pct: pct(v) })), contractsTop: byContracts.slice(0, 6).map(([a, v]) => ({ a, pct: pct(v) })), venuesPct: pct(inCurve + inPM), contractsPct: pct(inContracts), partial: !full });

    // ---- clusters: wallet-to-wallet token moves link holders
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
    const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    // hubs (exchanges, distributors, airdrop senders) touch everyone; linking through them would merge strangers
    const w2w = transfers.filter((t) => !(venues.has(t.from) || venues.has(t.to) || t.from === t.to || contracts.has(t.from) || contracts.has(t.to)));
    const peers = new Map();
    for (const t of w2w) {
      if (!peers.has(t.from)) peers.set(t.from, new Set()); if (!peers.has(t.to)) peers.set(t.to, new Set());
      peers.get(t.from).add(t.to); peers.get(t.to).add(t.from);
    }
    const hubs = new Set([...peers.entries()].filter(([, p]) => p.size > 20).map(([a]) => a));
    let links = 0;
    for (const t of w2w) {
      if (hubs.has(t.from) || hubs.has(t.to)) continue;
      union(t.from, t.to); links++;
    }
    const groups = new Map();
    for (const a of parent.keys()) { const r = find(a); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(a); }
    const clusters = [...groups.values()].filter((g) => g.length >= 2)
      .map((g) => ({ members: g, held: g.reduce((s, a) => s + (bal.get(a) || 0n), 0n) }))
      .sort((a, b) => (b.held > a.held ? 1 : -1));
    ctx.clusters = clusters.slice(0, 6).map((c) => ({ size: c.members.length, pct: pct(c.held), members: c.members.slice(0, 12), hasDev: pons ? c.members.includes(lc(pons.deployer)) : false }));
    const big = clusters[0];
    const cov = full ? '' : ' (in the events covered)';
    const hubEv = { k: 'Hubs set aside (more than 20 counterparties)', v: String(hubs.size) };
    if (!pons && big && pct(big.held) >= 0.5) set('clusters', 'info', `${big.members.length} wallets that passed the token to each other hold ${pct(big.held).toFixed(1)}%. Without a launchpad record this is context, not a finding: tokens used as money are naturally passed between wallets.`, [{ k: 'Wallet-to-wallet transfers', v: String(links) }, hubEv], { clusters: ctx.clusters });
    else if (!big || pct(big.held) < 0.5) set('clusters', 'pass', `No meaningful linked group${cov}: ${links} wallet-to-wallet moves, no group holds more than 0.5%.`, [{ k: 'Wallet-to-wallet transfers', v: String(links) }, hubEv], { clusters: ctx.clusters });
    else {
      const devIn = pons && big.members.includes(lc(pons.deployer));
      const s = pct(big.held) > 15 || (devIn && pct(big.held) > 5) ? 'critical' : pct(big.held) > 5 ? 'concern' : 'pass';
      set('clusters', s, `The largest linked group${cov} is ${big.members.length} wallets holding ${pct(big.held).toFixed(1)}% together${devIn ? ', and it includes the deployer' : ''}. They passed tokens to each other directly.`,
        [{ k: 'Wallet-to-wallet transfers', v: String(links) }, { k: 'Groups of 2+ wallets', v: String(clusters.length) }, hubEv].concat(big.members.slice(0, 8).map((a) => ({ k: devIn && a === lc(pons.deployer) ? 'Member (deployer)' : 'Member', v: a, addr: a }))),
        { clusters: ctx.clusters });
    }

    // ---- burned
    const burnedAmt = [...DEAD].reduce((a, d) => a + (bal.get(d) || 0n), 0n);
    const minted = full ? transfers.filter((t) => t.from === ZERO).reduce((a, t) => a + t.v, 0n) : null;
    const toZero = full ? transfers.filter((t) => t.to === ZERO).reduce((a, t) => a + t.v, 0n) : 0n;
    set('burned', 'info', `${fmt(burnedAmt + toZero)} provably burned (${pct(burnedAmt + toZero).toFixed(2)}% of current supply).`, [
      { k: 'Held by dead addresses (balanceOf)', v: fmt(burnedAmt) }, { k: 'Destroyed (sent to zero)', v: full ? fmt(toZero) : 'not totalled: history sampled' }, ...(minted !== null ? [{ k: 'Minted in total', v: fmt(minted) }] : []),
    ]);
  }
  if (isOfficialStock) {
    for (const id of ['firstblock', 'burners', 'dev', 'clusters', 'distribution', 'burned']) if (results[id].status === 'pending') set(id, 'na', 'Not relevant to an issuer-minted stock token: supply follows issuance and redemption, most of it held in custody.');
  }
  // deployer track record
  if (pons) {
    stage('Reading the deployer\'s earlier launches');
    try { const r = await devReputation(ctx, H); set('devrep', r.status, r.summary, r.evidence, r.extra || {}); }
    catch (e) { set('devrep', 'unchecked', 'Could not read the deployer history: ' + shortErr(e)); }
  } else set('devrep', isOfficialStock ? 'na' : 'unchecked', isOfficialStock ? 'Issued by Robinhood.' : 'Deployer unknown without a launchpad record.');

  // ticker uniqueness
  stage('Comparing the ticker with every Pons launch');
  try { ctx.apiBase = opts.apiBase; ctx.tickersTail = opts.tickersTail; const r = await tickerCheck(ctx, H); set('ticker', r.status, r.summary, r.evidence || [], r.extra || {}); }
  catch (e) { set('ticker', 'unchecked', 'Ticker index unavailable: ' + shortErr(e)); }

  // ---------------------------------------------------- market
  stage('Measuring liquidity');
  let venue = null;
  if (pons && !ctx.graduated) {
    const r = await tryRead(pons.curve, PONS, 'getReserves');
    if (r) {
      const [q, t] = r;
      const qd = lc(pair) === ZERO ? 18 : ctx.pairDecimals;
      const qs = lc(pair) === ZERO ? 'ETH' : ctx.pairSymbol;
      const realQ = await rpc(lc(pair) === ZERO ? 'eth_getBalance' : 'eth_call', lc(pair) === ZERO ? [pons.curve, 'latest'] : [{ to: pair, data: encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [pons.curve] }) }, 'latest']).then(BigInt).catch(() => null);
      venue = { kind: 'curve', quote: qs };
      set('liquidity', 'info', `Still on the bonding curve: ${realQ !== null ? fmtAmount(realQ, qd) + ' ' + qs + ' actually held by the curve' : 'curve balance unreadable'}, ${fmt(t)} tokens left on it. It graduates to Uniswap v4 at the threshold set by the factory.`, [
        { k: 'Curve', v: pons.curve, addr: pons.curve },
        { k: 'Curve reserves (getReserves)', v: `${fmtAmount(q, qd)} ${qs} incl. virtual part, ${fmt(t)} tokens` },
        { k: `${qs} balance of the curve`, v: realQ !== null ? `${fmtAmount(realQ, qd)} ${qs}` : 'unreadable' },
        { k: 'Graduation threshold', v: `${fmtAmount(pons.graduationThreshold, qd)} ${qs}` },
      ], { curveQuote: realQ?.toString(), threshold: pons.graduationThreshold.toString() });
    } else set('liquidity', 'unchecked', 'The curve did not return reserves.');
  } else if (pons && ctx.graduated) {
    const c0 = lc(pair) < lc(token) ? pair : token, c1 = lc(pair) < lc(token) ? token : pair;
    const key = { c0, c1, fee: Number(pons.poolFee), tickSpacing: Number(pons.tickSpacing), hooks: KNOWN.ponsHook };
    const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [key.c0, key.c1, key.fee, key.tickSpacing, key.hooks]));
    const slot0 = BigInt(keccak256('0x' + word(poolId) + word(6)));
    const s0 = await read(KNOWN.poolManager, PONS, 'extsload', ['0x' + word(slot0)]);
    const lq = await read(KNOWN.poolManager, PONS, 'extsload', ['0x' + word(slot0 + 3n)]);
    const sqrtP = BigInt(s0) & ((1n << 160n) - 1n);
    const L = BigInt(lq) & ((1n << 128n) - 1n);
    venue = { kind: 'v4', key, quote: lc(pair) === ZERO ? 'ETH' : ctx.pairSymbol };
    if (sqrtP === 0n) set('liquidity', 'concern', 'Graduated, but the expected Uniswap v4 pool is not initialised.', [{ k: 'Pool id', v: poolId }]);
    else {
      const Q96 = 1n << 96n;
      const tokenIs1 = lc(c1) === lc(token);
      const quoteDepth = tokenIs1 ? (L * Q96) / sqrtP : (L * sqrtP) / Q96; // virtual reserve of the quote side (currency0 = L/sqrtP, currency1 = L*sqrtP)
      const qd = lc(pair) === ZERO ? 18 : ctx.pairDecimals;
      ctx.v4 = { key, poolId };
      set('liquidity', quoteDepth > 10n ** BigInt(qd) ? 'info' : 'concern', `Uniswap v4 pool (Pons hook) with about ${fmtAmount(quoteDepth, qd)} ${venue.quote} of depth around the current price. Pons liquidity sits in the pool manager; no wallet can pull it.`, [
        { k: 'Pool manager', v: KNOWN.poolManager, addr: KNOWN.poolManager }, { k: 'Pool id', v: poolId }, { k: 'Hook', v: KNOWN.ponsHook, addr: KNOWN.ponsHook },
        { k: 'Active liquidity (L)', v: L.toString() }, { k: 'sqrtPriceX96', v: sqrtP.toString() },
      ]);
    }
  } else if (isOfficialStock) {
    const pool = await tryRead(KNOWN.v3Factory, parseAbi(['function getPool(address,address,uint24) view returns (address)']), 'getPool', [token, KNOWN.usdg, 500]);
    const pool2 = await tryRead(KNOWN.v3Factory, parseAbi(['function getPool(address,address,uint24) view returns (address)']), 'getPool', [token, KNOWN.usdg, 3000]);
    const ev = [];
    for (const [p, f] of [[pool, '0.05%'], [pool2, '0.30%']]) if (p && lc(p) !== ZERO) {
      const b = await tryRead(token, ERC20, 'balanceOf', [p]);
      const u = await tryRead(KNOWN.usdg, ERC20, 'balanceOf', [p]);
      ev.push({ k: `Uniswap v3 ${symbol}/USDG ${f}`, v: `${fmt(b ?? 0n)} ${symbol} + ${fmtAmount(u ?? 0n, 6)} USDG`, addr: p });
    }
    set('liquidity', ev.length ? 'info' : 'unchecked', ev.length ? 'Uniswap v3 pools against USDG found.' : 'No Uniswap v3 USDG pool at the usual fee tiers.', ev);
  } else {
    set('liquidity', 'unchecked', 'No Pons curve or Pons pool. Hoodwink does not price unknown venues; it would rather say so than guess.');
  }

  // round trip
  stage('Simulating a buy, a transfer and a sell');
  try {
    const rt = await roundTrip(ctx, venue);
    ctx.roundTrip = rt;
    if (rt) set('roundtrip', rt.status, rt.summary, rt.evidence, { sim: rt.sim });
    else set('roundtrip', 'unchecked', 'No venue Hoodwink can simulate against, and no wallet holder to impersonate.');
  } catch (e) { set('roundtrip', 'unchecked', 'Simulation could not run: ' + shortErr(e)); }

  // taxes
  const rt = ctx.roundTrip;
  if (pons) {
    const tax = Number(pons.creatorTaxBps) / 100;
    const ev = [{ k: 'Creator tax (factory record)', v: tax.toFixed(2) + '% on each trade' }];
    if (rt?.sim) {
      ev.push({ k: 'Received vs quoted on the buy', v: rt.sim.buyGapPct.toFixed(3) + '% missing' });
      ev.push({ k: 'Wallet-to-wallet transfer', v: rt.sim.moveGapPct.toFixed(3) + '% missing' });
      ev.push({ k: 'Round-trip cost (buy + sell)', v: rt.sim.lossPct.toFixed(2) + '%' });
    }
    const hidden = rt?.sim && (rt.sim.buyGapPct > 0.01 || rt.sim.moveGapPct > 0.01);
    const status = hidden ? 'critical' : tax > 5 ? 'concern' : 'pass';
    set('tax', status, hidden ? 'A hidden fee: tokens disappear between what the curve sends and what arrives.' : `${tax.toFixed(2)}% creator tax, set at launch and fixed by the template. ${rt?.sim ? 'Transfers between wallets arrive in full.' : ''}`, ev);
  } else if (rt?.sim) {
    const status = rt.sim.moveGapPct > 0.01 ? 'concern' : 'pass';
    set('tax', status, status === 'pass' ? 'Wallet-to-wallet transfers arrive in full: no transfer tax.' : `${rt.sim.moveGapPct.toFixed(2)}% of each transfer disappears: a transfer tax.`, [{ k: 'Wallet-to-wallet transfer', v: rt.sim.moveGapPct.toFixed(3) + '% missing' }]);
  } else if (isOfficialStock) set('tax', 'pass', 'Stock tokens carry no transfer tax in their code; Uniswap pool fees apply when trading.', []);
  else set('tax', 'unchecked', 'No simulation was possible, so taxes were not measured.');

  // reality checks (started earlier, server side)
  stage('Checking the website, X and code');
  if (realityP) {
    const r = await realityP;
    for (const id of ['website', 'social', 'code', 'larp']) {
      const c = r?.[id];
      if (c) set(id, c.status, c.summary, c.evidence || [], c.extra || {});
      else set(id, 'unchecked', r?.error ? 'Reality checks failed: ' + r.error : 'Not reached.');
    }
  } else for (const id of ['website', 'social', 'code', 'larp']) set(id, isOfficialStock ? 'na' : 'unchecked', isOfficialStock ? 'An official stock token: Robinhood is the issuer.' : 'Only Pons launches carry link metadata on chain.');

  // the contract line: everything that the Pons template fixes, folded into one verdict
  {
    const parts = ['deployed', 'erc20', 'proxy', 'owner', 'powers', 'template', 'origin', 'roundtrip', 'tax'].map((id) => results[id]).filter((c) => c.status !== 'pending' && c.status !== 'na');
    const rank = { critical: 4, concern: 3, unchecked: 2, info: 1, pass: 0 };
    const worst = parts.reduce((w, c) => (rank[c.status] > rank[w] ? c.status : w), 'pass');
    const ev = parts.map((c) => ({ k: `${c.title} · ${c.status}`, v: c.summary }));
    const rt = results.roundtrip;
    if (isOfficialStock) set('contract', 'info', 'Official Robinhood stock token: the issuer can upgrade, mint and pause it, as expected for a regulated asset.', ev);
    else if (pons && results.template.status === 'pass' && ['pass', 'info'].includes(worst)) {
      set('contract', 'pass', `Standard Pons contract, byte-identical to the template: fixed supply, no mint, blacklist or pause, nothing upgradeable.${rt.status === 'pass' && rt.sim ? ` A simulated buy, transfer and sell went through (round trip ${rt.sim.lossPct.toFixed(2)}%).` : ''} Creator tax ${(Number(pons.creatorTaxBps) / 100).toFixed(2)}%.`, ev, { sim: rt.sim });
    } else {
      const bad = parts.filter((c) => c.status === worst && worst !== 'pass').map((c) => c.summary);
      set('contract', worst === 'unchecked' ? 'concern' : worst, bad.length ? bad.join(' ') : 'Contract checks passed.', ev, { sim: rt.sim });
    }
  }

  return finish();

  function finish() {
    const list = CHECKS.map((c) => results[c.id]);
    const internal = INTERNAL.map((c) => results[c.id]);
    for (const c of list) if (c.status === 'pending') { c.status = 'unchecked'; c.summary = c.summary || 'Not reached.'; emit(c); }
    const applicable = list.filter((c) => c.status !== 'na');
    const done = applicable.filter((c) => c.status !== 'unchecked');
    const count = (s) => list.filter((c) => c.status === s).length;
    return {
      version: 1,
      chain: CHAIN.id,
      token,
      name: ctx.name, symbol: ctx.symbol, decimals: ctx.decimals,
      totalSupply: ctx.totalSupply?.toString(),
      block: ctx.head,
      at: new Date().toISOString(),
      kind: ctx.isOfficialStock ? 'stock' : ctx.pons ? 'pons' : 'other',
      coverage: applicable.length ? Math.round((done.length / applicable.length) * 100) : 0,
      counts: { critical: count('critical'), concern: count('concern'), pass: count('pass'), info: count('info'), unchecked: count('unchecked'), na: count('na') },
      checks: list,
      internal,
      metadata: ctx.meta || null,
      meta: { ms: Date.now() - t0, rpcCalls: rpcCount - startCount, transfers: ctx.transferCount || 0 },
    };
  }
}

// ------------------------------------------------------------------ data files (ticker index, known devs)
let DATA_BASE = null;
export const setDataBase = (b) => { DATA_BASE = b; };
async function loadData(rel) {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const base = DATA_BASE || new URL('../../data/', import.meta.url).href;
      const r = await fetch(base + rel);
      return r.ok ? await r.json() : null;
    }
    const fs = await import('node:fs');
    const p = new URL('../../data/' + rel, import.meta.url);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}
export const normTicker = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9]/g, '');
const shardOf = (s) => { const n = normTicker(s); return (n.slice(0, 2) || '__').padEnd(2, '_'); };
const SYM_SEL = '0x95d89b41';
const NAME_SEL = '0x06fdde03';
function strResult(d) {
  try { if (!d || d === '0x') return ''; if (d.length === 66) return hexToString(d).replace(/\0+$/, ''); return decodeAbiParameters([{ type: 'string' }], d)[0]; } catch { return ''; }
}
async function symbolsOf(tokens) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 250) chunks.push(tokens.slice(i, i + 250));
  await Promise.all(chunks.map(async (c) => {
    const calls = c.flatMap((t) => [{ target: t, allowFailure: true, callData: SYM_SEL }, { target: t, allowFailure: true, callData: NAME_SEL }]);
    const res = await read(KNOWN.multicall3, MC, 'aggregate3', [calls]);
    c.forEach((t, i) => out.set(lc(t), { symbol: res[2 * i].success ? strResult(res[2 * i].returnData) : '', name: res[2 * i + 1].success ? strResult(res[2 * i + 1].returnData) : '' }));
  }));
  return out;
}

// ------------------------------------------------------------------ ticker uniqueness
async function tickerCheck(ctx, H) {
  const sym = ctx.symbol;
  if (!sym) return { status: 'unchecked', summary: 'The token has no ticker to compare.' };
  const meta = await loadData('tickers/meta.json');
  if (!meta) return { status: 'unchecked', summary: 'The ticker index is not available on this deployment.' };
  const key = normTicker(sym);
  const shard = (await loadData(`tickers/${shardOf(sym)}.json`)) || [];
  const same = shard.filter((e) => normTicker(e[2]) === key).map((e) => ({ token: lc(e[0]), block: e[1], symbol: e[2], name: e[3], deployer: lc(e[4]) }));
  // launches after the static index: first the server's hourly tail, then the last blocks live (capped to 8,000 launches)
  let tailNote = '';
  let liveFrom = meta.block;
  try {
    const api = ctx.apiBase ?? '';
    const tailRes = ctx.tickersTail ? await ctx.tickersTail(shardOf(sym)) : await fetchJSON(`${api}/api/tickers-tail?shard=${shardOf(sym)}`);
    if (tailRes && tailRes.block > liveFrom) {
      for (const e of tailRes.entries || []) if (normTicker(e[2]) === key) same.push({ token: lc(e[0]), block: e[1], symbol: e[2], name: e[3], deployer: lc(e[4]) });
      liveFrom = tailRes.block;
    }
  } catch { /* no server: read everything since the static index live */ }
  if (liveFrom < H) {
    const { logs } = await getLogsRange({ address: KNOWN.ponsFactory, topics: [PONS_LAUNCH_TOPIC] }, liveFrom + 1, H, null, 40000);
    const tail = logs.slice(-8000).map((l) => ({ token: lc('0x' + l.topics[1].slice(26)), block: parseInt(l.blockNumber, 16), deployer: lc('0x' + l.topics[3].slice(26)) }));
    if (logs.length > 8000) tailNote = ` (index ${(H - liveFrom).toLocaleString('en-US')} blocks old: only the latest 8,000 launches since then were read)`;
    const syms = await symbolsOf(tail.map((t) => t.token));
    for (const t of tail) { const s = syms.get(t.token); if (s && normTicker(s.symbol) === key) same.push({ ...t, symbol: s.symbol, name: s.name }); }
  }
  const me = lc(ctx.token);
  if (!same.find((e) => e.token === me)) same.push({ token: me, block: ctx.launchBlock ?? H, symbol: sym, name: ctx.name || '', deployer: lc(ctx.pons?.deployer || '') });
  same.sort((a, b) => a.block - b.block);
  const idx = same.findIndex((e) => e.token === me);
  const n = same.length;
  const ev = [{ k: 'Tokens launched on Pons with this ticker', v: `${n} (index of ${meta.count.toLocaleString('en-US')} launches${tailNote})` }];
  const hours = (a, b) => Math.abs(b - a) * CHAIN.blockTime / 3600;
  const ago = (h) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(0)} days`);
  for (const e of same.slice(0, 6)) ev.push({ k: e.token === me ? `#${same.indexOf(e) + 1} (this token)` : `#${same.indexOf(e) + 1}${same.indexOf(e) === 0 ? ' (first)' : ''}`, v: `${e.name || e.symbol} · block ${e.block.toLocaleString('en-US')}`, addr: e.token });
  if (n === 1) return { status: 'pass', summary: `Unique ticker: no other Pons launch uses $${sym}.`, evidence: ev, extra: { copies: 0, rank: 1 } };
  if (idx === 0) return { status: 'info', summary: `The original $${sym}. ${n - 1} later token${n > 2 ? 's' : ''} reused the ticker; make sure you hold this address.`, evidence: ev, extra: { copies: n - 1, rank: 1 } };
  // which earlier tokens with this ticker matter: graduated ones, and recent ones with the same name (hype copies)
  const earlier = same.slice(0, idx);
  const probe = [earlier[0], ...earlier.slice(-24)].filter((e, i, a) => e && a.indexOf(e) === i);
  const grads = await Promise.all(probe.map(async (e) => {
    const r = await tryRead(KNOWN.ponsFactory, PONS, 'getLaunchedToken', [e.token]);
    if (!r?.exists) return false;
    const g = await tryRead(r.curve, PONS, 'graduated');
    return g !== undefined ? g : Number(r.phase) > 0;
  }));
  probe.forEach((e, i) => { e.graduated = grads[i]; });
  const myBlock = same[idx].block;
  const myDev = lc(ctx.pons?.deployer || '');
  const nameKey = String(ctx.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const winner = probe.filter((e) => e.graduated && e.deployer !== myDev).pop();
  const hype = earlier.filter((e) => e.deployer !== myDev && hours(e.block, myBlock) < 24 * 7 && String(e.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === nameKey);
  const first = same[0];
  ev.push({ k: 'Earlier tokens with this ticker that graduated', v: probe.filter((e) => e.graduated).map((e) => e.token).join(', ') || 'none among those checked' });
  if (hype.length) ev.push({ k: 'Same name launched in the 7 days before', v: `${hype.length} token(s), first ${hype[0].token}`, addr: hype[0].token });
  if (winner && hours(winner.block, myBlock) < 24 * 14) {
    return { status: 'critical', summary: `Copycat: $${sym} launched ${ago(hours(winner.block, myBlock))} after a $${sym} that graduated (${short(winner.token)}), by another wallet. Check you are buying the one you mean.`, evidence: ev, extra: { copies: n - 1, rank: idx + 1, original: winner.token } };
  }
  if (winner || hype.length) {
    const ref = winner || hype[0];
    return { status: 'concern', summary: winner ? `$${sym} was already used by a token that graduated (${short(winner.token)}, ${ago(hours(winner.block, myBlock))} earlier). This is copy #${idx + 1} of ${n}.` : `${hype.length} token(s) with the same name and ticker were launched in the week before this one: this looks like a copy riding the same narrative.`, evidence: ev, extra: { copies: n - 1, rank: idx + 1, original: ref.token } };
  }
  return { status: 'info', summary: `Common ticker: ${n - 1} other Pons token${n > 2 ? 's' : ''} use $${sym}, none of the earlier ones graduated and none copied this name in the week before. First one: ${short(first.token)}.`, evidence: ev, extra: { copies: n - 1, rank: idx + 1, original: first.token } };
}

// ------------------------------------------------------------------ deployer reputation
async function devReputation(ctx, H) {
  const dep = lc(ctx.pons.deployer);
  const known = ((await loadData('devs.json')) || {})[dep];
  const { logs } = await getLogsRange({ address: KNOWN.ponsFactory, topics: [PONS_LAUNCH_TOPIC, null, null, topicAddr(dep)] }, 0, H, null, 5000);
  const launches = logs.map((l) => ({ token: lc('0x' + l.topics[1].slice(26)), curve: lc('0x' + l.topics[2].slice(26)), block: parseInt(l.blockNumber, 16) }));
  const others = launches.filter((l) => l.token !== lc(ctx.token)).slice(-20);
  const ev = [{ k: 'Deployer', v: ctx.pons.deployer, addr: ctx.pons.deployer }, { k: 'Pons launches by this wallet', v: String(launches.length) }];
  if (known) ev.push({ k: 'Known as', v: `${known.label}${known.source ? ' · ' + known.source : ''}` });
  if (!others.length) {
    if (known) return { status: known.tone === 'bad' ? 'critical' : known.tone === 'good' ? 'pass' : 'info', summary: `${known.label}. ${known.note || ''} First Pons launch from this wallet.`.trim(), evidence: ev };
    return { status: 'info', summary: 'First Pons launch from this wallet: no track record. Fresh wallets cost nothing, so this proves neither good nor bad.', evidence: ev, extra: { launches: launches.length } };
  }
  // the RPC refuses address-less log queries over 30,000 blocks, so each earlier token is read on its own
  const outL = { logs: [] }, inL = { logs: [] };
  await Promise.all(others.map(async (o) => {
    const [a, b] = await Promise.all([
      getLogsRange({ address: o.token, topics: [TRANSFER_TOPIC, topicAddr(dep)] }, o.block, H, null, 5000),
      getLogsRange({ address: o.token, topics: [TRANSFER_TOPIC, null, topicAddr(dep)] }, o.block, H, null, 5000),
    ]);
    outL.logs.push(...a.logs); inL.logs.push(...b.logs);
  }));
  const recs = await Promise.all(others.map(async (o) => {
    const r = await tryRead(KNOWN.ponsFactory, PONS, 'getLaunchedToken', [o.token]);
    let grad = r ? Number(r.phase) > 0 : false;
    if (r) { const g = await tryRead(r.curve, PONS, 'graduated'); if (g !== undefined) grad = g; }
    return { ...o, graduated: grad, curve: r ? lc(r.curve) : o.curve };
  }));
  const pm = lc(KNOWN.poolManager);
  let dumped = 0, withBag = 0, graduated = 0;
  const delays = [];
  const rows = [];
  for (const r of recs) {
    const mine = (l) => lc(l.address) === r.token;
    const got = inL.logs.filter(mine).reduce((s, l) => s + BigInt(l.data === '0x' ? 0 : l.data.slice(0, 66)), 0n);
    const sells = outL.logs.filter((l) => mine(l) && [r.curve, pm].includes(lc('0x' + l.topics[2].slice(26))));
    const sold = sells.reduce((s, l) => s + BigInt(l.data === '0x' ? 0 : l.data.slice(0, 66)), 0n);
    if (r.graduated) graduated++;
    let tag = r.graduated ? 'graduated' : 'did not graduate';
    if (got > 0n) {
      withBag++;
      const pctSold = Number((sold * 1000n) / got) / 10;
      if (sold * 10n >= got * 8n) {
        dumped++;
        const first = Math.min(...sells.map((l) => parseInt(l.blockNumber, 16)));
        const min = ((first - r.block) * CHAIN.blockTime) / 60;
        delays.push(min);
        tag += ` · dev sold ${pctSold.toFixed(0)}% ${min < 60 ? Math.max(0, min).toFixed(1) + ' min' : (min / 60).toFixed(1) + ' h'} after launch`;
      } else tag += ` · dev sold ${pctSold.toFixed(0)}%`;
    } else tag += ' · dev never held it';
    rows.push({ token: r.token, tag });
  }
  delays.sort((a, b) => a - b);
  const median = delays.length ? delays[Math.floor(delays.length / 2)] : null;
  const capNote = launches.length - 1 > others.length ? ` (latest ${others.length} of ${launches.length - 1} read)` : '';
  ev.push({ k: 'Earlier launches graduated', v: `${graduated} of ${others.length}${capNote}` }, { k: 'Earlier launches the deployer dumped (sold 80%+ of its bag)', v: `${dumped} of ${withBag} where it held tokens${median !== null ? ` · median ${median.toFixed(1)} min after launch` : ''}` });
  for (const r of rows.slice(-8).reverse()) ev.push({ k: 'Earlier launch', v: `${r.token} · ${r.tag}`, addr: r.token });
  const rate = withBag ? dumped / withBag : 0;
  let status, summary;
  const base = `${others.length} earlier Pons launch${others.length > 1 ? 'es' : ''}${capNote}: ${graduated} graduated, ${dumped} dumped by the deployer${median !== null ? ` (median ${median.toFixed(1)} min after launch)` : ''}.`;
  if (known) { status = known.tone === 'bad' ? 'critical' : known.tone === 'good' ? 'pass' : 'info'; summary = `${known.label}. ${base}`; }
  else if (dumped >= 3 && rate >= 0.6) { status = 'critical'; summary = `Serial dumper. ${base}`; }
  else if (others.length >= 10 || dumped >= 2) { status = 'concern'; summary = `${others.length >= 10 ? 'Serial launcher. ' : ''}${base}`; }
  else if (graduated >= 1 && rate < 0.5) { status = 'pass'; summary = `Track record holds up. ${base}`; }
  else { status = 'info'; summary = base; }
  return { status, summary, evidence: ev, extra: { devrep: { launches: launches.length, earlier: others.length, graduated, dumped, withBag, median } } };
}

// ------------------------------------------------------------------ reality: links, X, code, AI verdict
async function fetchJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
const BIG_ACCOUNTS = /^(robinhoodapp|robinhood|vladtenev|elonmusk|cz_binance|binance|vitalikbuterin|ethereum|coinbase|base|jessepollak|brian_armstrong|solana|aeyakovenko|nvidia|tesla|apple|google|googleai|microsoft|amazon|meta|openai|anthropicai|claudeai|sama|x|xai|grok|whitehouse|realdonaldtrump|potus|spacex|blackrock|cnbc|bloomberg|wsj|nasdaq|nyse)$/i;
async function realityChecks(ctx, opts, H) {
  const out = {};
  const api = opts.apiBase ?? '';
  let ev = null, apiErr = null;
  try { ev = opts.reality ? await opts.reality(lc(ctx.token)) : await fetchJSON(`${api}/api/reality?token=${lc(ctx.token)}`); }
  catch (e) { apiErr = shortErr(e); }
  let meta = ev?.meta;
  if (!ev) { try { meta = await launchMetadata(ctx.token, { rpcUrl: RPC_URL, name: ctx.name, symbol: ctx.symbol, head: H }); } catch { meta = null; } }
  ctx.meta = meta;
  const noServer = `Link checks run on the Hoodwink server, which did not answer (${apiErr}).`;
  const linksEv = meta ? [
    { k: 'Description typed at launch', v: meta.description || 'none' },
    { k: 'Website', v: meta.website || 'none' }, { k: 'X', v: meta.x || 'none' }, { k: 'Telegram', v: meta.telegram || 'none' },
    ...(meta.github ? [{ k: 'GitHub', v: meta.github }] : []),
    { k: 'Read from', v: 'launch transaction calldata', tx: meta.launchTx },
  ] : [];
  // website
  const s = ev?.site;
  if (!meta) out.website = { status: 'unchecked', summary: 'No launch metadata found (not a Pons launch, or the launch transaction could not be read).' };
  else if (!meta.website) out.website = { status: 'info', summary: 'No website given at launch. Normal for a pure meme; a token that claims a product without a site is a red flag.', evidence: linksEv };
  else if (!ev) out.website = { status: 'unchecked', summary: noServer, evidence: linksEv };
  else if (s.error || !s.ok) out.website = { status: 'concern', summary: `The website does not work: ${s.error || 'HTTP ' + s.status}${s.shortener ? ', behind a link shortener' : ''}.`, evidence: linksEv.concat([{ k: 'Checked URL', v: s.finalUrl || s.url }]) };
  else {
    const flags = [];
    if (s.shortener) flags.push('hidden behind a link shortener');
    if (s.jsOnly) flags.push('page text only renders with JavaScript');
    const siteX = s.links?.x || [];
    const metaHandle = (parseX(meta.x)?.handle || '').toLowerCase();
    const xMismatch = metaHandle && siteX.length && !siteX.includes(metaHandle);
    if (xMismatch) flags.push(`links to X @${siteX[0]}, not @${metaHandle} given at launch`);
    const e2 = linksEv.concat([
      { k: 'Status', v: `HTTP ${s.status}${s.redirects ? `, ${s.redirects} redirect(s) to ${s.finalUrl}` : ''}` },
      { k: 'Title', v: s.title || '(none)' }, { k: 'Built with', v: s.builder || 'custom' },
      { k: 'Shows this contract address', v: s.mentionsContract ? 'yes' : 'no' },
      { k: 'Links found on the site', v: `X ${siteX.map((h) => '@' + h).join(', ') || 'none'} · GitHub ${(s.links?.github || []).join(', ') || 'none'} · Telegram ${(s.links?.telegram || []).length}` },
    ]);
    if (s.mentionsContract && !flags.length) out.website = { status: 'pass', summary: `Website live (${s.title || new URL(s.finalUrl).hostname}) and it shows this exact contract address.`, evidence: e2 };
    else out.website = { status: flags.length ? 'concern' : 'info', summary: `Website live${s.title ? ` ("${s.title.slice(0, 60)}")` : ''}${s.mentionsContract ? ' and shows this contract' : ', but it does not show this contract address: any token can point to any site'}${flags.length ? '; ' + flags.join('; ') : ''}.`, evidence: e2 };
  }
  // X
  const x = ev?.x || (meta?.x ? parseX(meta.x) : null);
  if (!meta) out.social = { status: 'unchecked', summary: 'No launch metadata.' };
  else if (!meta.x) out.social = { status: 'info', summary: 'No X account given at launch.', evidence: linksEv };
  else if (x?.status) {
    const t = x.tweet;
    if (!ev) out.social = { status: 'unchecked', summary: noServer, evidence: linksEv };
    else if (!t || t.exists === false) out.social = { status: 'concern', summary: 'The X link is a post that no longer exists or cannot be read.', evidence: linksEv };
    else {
      const siteX = s?.links?.x || [];
      const own = siteX.includes(String(t.author).toLowerCase());
      const big = BIG_ACCOUNTS.test(t.author) || t.verifiedType === 'Business';
      const e2 = linksEv.concat([{ k: 'Post author', v: `@${t.author} (${t.authorName})${t.verifiedType ? ' · ' + t.verifiedType : ''}` }, { k: 'Posted', v: t.createdAt }, { k: 'Post text', v: t.text }]);
      if (own) out.social = { status: 'pass', summary: `The X link is a post by @${t.author}, the same account the website links to.`, evidence: e2 };
      else out.social = { status: big ? 'critical' : 'concern', summary: `Borrowed narrative: the X link is a post by @${t.author}${big ? ', a major account' : ''}, not an account of this project. Linking someone else's post proves no affiliation.`, evidence: e2 };
    }
  } else {
    const handle = x?.handle;
    const siteX = s?.links?.x || [];
    const e2 = linksEv.concat([{ k: 'Handle', v: handle ? '@' + handle : meta.x }]);
    if (!handle) out.social = { status: 'concern', summary: 'The X link is not an account or a post.', evidence: e2 };
    else if (BIG_ACCOUNTS.test(handle)) out.social = { status: 'critical', summary: `The X link points to @${handle}, a major account that is not this project.`, evidence: e2 };
    else if (siteX.includes(handle.toLowerCase())) out.social = { status: 'pass', summary: `X @${handle}, and the project's website links to the same account.`, evidence: e2 };
    else if (siteX.length) out.social = { status: 'concern', summary: `X @${handle} given at launch, but the website links to @${siteX[0]}.`, evidence: e2 };
    else out.social = { status: 'info', summary: `X @${handle}. Not cross-checked: the website does not link an X account${s ? '' : ' (no website)'}.`, evidence: e2 };
  }
  // code
  const g = ev?.github;
  if (!meta) out.code = { status: 'unchecked', summary: 'No launch metadata.' };
  else if (!g) out.code = { status: 'info', summary: !ev && meta.github ? noServer : 'No code linked, at launch or on the website. Fine for a meme; a product claim without code is a red flag (see the verdict).', evidence: linksEv };
  else if (g.exists === false) out.code = { status: 'concern', summary: `The GitHub link (${g.owner}${g.repo ? '/' + g.repo : ''}) does not exist.`, evidence: [{ k: 'Source', v: g.source }] };
  else if (g.exists === null) out.code = { status: 'unchecked', summary: 'GitHub did not answer.', evidence: [{ k: 'Source', v: g.source }] };
  else if (g.kind === 'account') out.code = { status: 'info', summary: `GitHub account ${g.owner}: ${g.publicRepos} public repos, created ${g.createdAt?.slice(0, 10)}. No specific repository linked.`, evidence: [{ k: 'Source', v: g.source }] };
  else {
    const launched = meta.launchedAt ? meta.launchedAt * 1000 : null;
    const created = Date.parse(g.createdAt);
    const after = launched && created > launched;
    const thin = (g.commits ?? 0) < 5;
    const e2 = [{ k: 'Repository', v: `github.com/${g.owner}/${g.repo}` }, { k: 'Found via', v: g.source }, { k: 'Created', v: `${g.createdAt?.slice(0, 10)}${launched ? (after ? ' (after the token launched)' : ' (before the token launched)') : ''}` }, { k: 'Commits', v: String(g.commits ?? '?') }, { k: 'Last push', v: g.pushedAt?.slice(0, 10) }, { k: 'Stars / forks', v: `${g.stars} / ${g.forks}` }, { k: 'Fork of another repo', v: g.fork ? 'yes: ' + g.parent : 'no' }];
    if (g.fork && thin) out.code = { status: 'concern', summary: `The repository is a fork of ${g.parent} with ${g.commits} commit(s) of its own work at most: borrowed code.`, evidence: e2 };
    else if (thin) out.code = { status: 'concern', summary: `The repository is nearly empty (${g.commits} commit${g.commits === 1 ? '' : 's'})${after ? ' and was created after the token' : ''}.`, evidence: e2 };
    else if (after) out.code = { status: 'info', summary: `Real repository (${g.commits} commits) but created after the token launched.`, evidence: e2 };
    else out.code = { status: 'pass', summary: `Real repository: ${g.commits} commits, created before the launch, last push ${g.pushedAt?.slice(0, 10)}.`, evidence: e2 };
  }
  // AI verdict
  if (!meta) out.larp = { status: 'unchecked', summary: 'No launch metadata to judge.' };
  else if (!ev) out.larp = { status: 'unchecked', summary: noServer };
  else {
    let v = null, vErr = null;
    try {
      if (opts.verdict) v = await opts.verdict(lc(ctx.token));
      else {
        // the server answers at once; while the model works it says { pending: true }: poll for up to 60 s
        for (let i = 0; i < 30; i++) {
          const r = await fetch(`${api}/api/verdict?token=${lc(ctx.token)}`);
          const j = await r.json().catch(() => ({}));
          if (j.verdict) { v = j; break; }
          if (!j.pending) throw new Error(j.error || 'HTTP ' + r.status);
          opts.onStage && opts.onStage('Waiting for the AI verdict');
          await sleep(2000);
        }
        if (!v) throw new Error('the verdict is taking longer than usual, run the scan again in a minute');
      }
    }
    catch (e) { vErr = shortErr(e); }
    if (!v?.verdict) out.larp = { status: 'unchecked', summary: `AI verdict unavailable: ${vErr || 'no answer'}.` };
    else {
      const V = v.verdict;
      const LABEL = { real_product: 'Real product', honest_meme: 'Honest meme', larp: 'LARP', unclear: 'Unclear' };
      const status = V.verdict === 'larp' ? 'critical' : V.verdict === 'unclear' ? 'concern' : 'pass';
      const e2 = [{ k: 'Verdict', v: `${LABEL[V.verdict]} · ${V.confidence} confidence` }]
        .concat((V.claims || []).map((c) => ({ k: `Claim (${c.status})`, v: `${c.claim} — ${c.evidence}` })))
        .concat((V.red_flags || []).map((f) => ({ k: 'Red flag', v: f })))
        .concat((V.green_flags || []).map((f) => ({ k: 'Green flag', v: f })))
        .concat([{ k: 'Judged by', v: `${v.model} on the evidence above${v.cached ? ' (cached)' : ''}` }]);
      out.larp = { status, summary: `${LABEL[V.verdict]}: ${V.headline}`, evidence: e2, extra: { verdict: V } };
    }
  }
  return out;
}

// ------------------------------------------------------------------ simulation
const probeAbi = PROBE_ABI;
const RESULT_FIELDS = ['stage', 'quoteIn', 'quoted', 'received', 'sent', 'arrived', 'sold', 'quoteBack', 'revertData'];
async function runProbe(at, fn, args, overrides) {
  const data = encodeFunctionData({ abi: probeAbi, functionName: fn, args });
  const out = await ethCall(at, data, overrides);
  const r = decodeFunctionResult({ abi: probeAbi, functionName: fn, data: out });
  return Object.fromEntries(RESULT_FIELDS.map((k) => [k, r[k]]));
}
async function roundTrip(ctx, venue) {
  const { token, pons, decimals } = ctx;
  const fmt = (v) => fmtAmount(v, decimals);
  let r, quoteSym, quoteDec, method;
  if (pons && venue) {
    const pair = ctx.pair;
    const native = lc(pair) === ZERO;
    quoteDec = native ? 18 : ctx.pairDecimals;
    quoteSym = native ? 'ETH' : ctx.pairSymbol;
    // 0.01 ETH, 5 USDG, or 0.05 of a stock share: small enough to barely move the price
    const quoteIn = native ? 10n ** 16n : lc(pair) === lc(KNOWN.usdg) ? 5n * 10n ** BigInt(quoteDec) : 10n ** BigInt(quoteDec) / 20n;
    const overrides = { [PROBE_AT]: { code: PROBE_CODE, balance: '0x' + (10n ** 20n).toString(16) } };
    if (!native) {
      const s = await findBalanceSlot(pair, PROBE_AT);
      if (!s) return { status: 'unchecked', summary: `Could not fund the simulation with ${quoteSym} (balance slot not found).`, evidence: [] };
      overrides[pair] = { stateDiff: { [s.slotKey]: '0x' + word(quoteIn * 10n) } };
    }
    if (venue.kind === 'curve') {
      method = 'Pons bonding curve: buy(), transfer(), sell()';
      r = await runProbe(PROBE_AT, 'curveRoundTrip', [pons.curve, token, pair, quoteIn], overrides);
    } else {
      method = 'Uniswap v4 pool via PoolManager.unlock(): swap in, transfer(), swap out';
      r = await runProbe(PROBE_AT, 'v4RoundTrip', [venue.key, token, quoteIn], overrides);
    }
  } else if (ctx.isOfficialStock || !ctx.pons) {
    const s = await findBalanceSlot(token, PROBE_AT);
    if (s) {
      method = `Fresh probe wallet funded through the token's balance storage (${s.label}), then transfer() of a quarter to another fresh address`;
      r = await runProbe(PROBE_AT, 'holderMove', [token], { [PROBE_AT]: { code: PROBE_CODE }, [token]: { stateDiff: { [s.slotKey]: '0x' + word(10n ** BigInt(decimals) * 4n) } } });
      quoteSym = null;
    }
  }
  if (r) { /* simulated above */ } else if (ctx.holders && ctx.holders.length) {
    // impersonate the largest wallet holder: put the probe code on its address for the length of one eth_call
    for (const [addr] of ctx.holders.slice(0, 6)) {
      const c = await rpc('eth_getCode', [addr, 'latest']);
      if (c !== '0x') continue;
      method = `Impersonated holder ${short(addr)}: transfer() of a quarter of its balance to a fresh address`;
      r = await runProbe(addr, 'holderMove', [token], { [addr]: { code: PROBE_CODE } });
      break;
    }
    if (!r) return null;
    quoteSym = null;
  } else return null;

  const stage = Number(r.stage);
  const why = r.revertData && r.revertData !== '0x' ? decodeRevert(r.revertData) : 'no reason given';
  const ev = [{ k: 'Method', v: method }, { k: 'State', v: 'latest block, eth_call with state override (nothing broadcast)' }];
  if (quoteSym) ev.push({ k: 'Spent', v: `${fmtAmount(r.quoteIn, quoteDec)} ${quoteSym}` });
  if (stage === 1) return { status: 'concern', summary: `The buy reverted (${why}). Buying may be restricted right now.`, evidence: ev.concat([{ k: 'Revert', v: why }]) };
  const buyGap = r.quoted > 0n && r.received < r.quoted ? Number(((r.quoted - r.received) * 1000000n) / r.quoted) / 10000 : 0;
  const moveGap = r.sent > 0n ? Number(((r.sent - r.arrived) * 1000000n) / r.sent) / 10000 : 0;
  if (quoteSym) ev.push({ k: 'Tokens received', v: `${fmt(r.received)}${r.quoted !== r.received ? ` (venue said ${fmt(r.quoted)})` : ''}` });
  ev.push({ k: 'Moved to a fresh wallet', v: `${fmt(r.sent)} sent, ${fmt(r.arrived)} arrived` });
  if (stage === 2) return { status: 'critical', summary: `Tokens cannot be moved between wallets: the transfer reverted (${why}).`, evidence: ev.concat([{ k: 'Revert', v: why }]), sim: { buyGapPct: buyGap, moveGapPct: 100, lossPct: 100 } };
  if (!quoteSym) {
    const status = moveGap > 0.01 ? 'concern' : 'pass';
    return { status, summary: status === 'pass' ? 'Tokens moved to a fresh wallet arrive in full. (No sell venue Hoodwink can simulate for this token.)' : `Transfers lose ${moveGap.toFixed(2)}% on the way.`, evidence: ev, sim: { buyGapPct: 0, moveGapPct: moveGap, lossPct: 0, partial: true } };
  }
  ev.push({ k: 'Sold back', v: fmt(r.sold) });
  if (stage === 3) return { status: 'critical', summary: `Honeypot behaviour: buying works, selling reverts (${why}).`, evidence: ev.concat([{ k: 'Revert', v: why }]), sim: { buyGapPct: buyGap, moveGapPct: moveGap, lossPct: 100 } };
  // value comparison: what fraction of the quote came back for the share that was sold
  const soldShare = r.received > 0n ? Number((r.sold * 1000000n) / r.received) / 1000000 : 0;
  const backFor = Number(r.quoteBack) / (Number(r.quoteIn) * soldShare || 1);
  const lossPct = Math.max(0, (1 - backFor) * 100);
  ev.push({ k: 'Came back', v: `${fmtAmount(r.quoteBack, quoteDec)} ${quoteSym}` }, { k: 'Round-trip cost', v: lossPct.toFixed(2) + '% (fees, tax and price impact on the sold share)' });
  const status = buyGap > 0.01 || moveGap > 0.01 ? 'critical' : lossPct > 25 ? 'concern' : 'pass';
  const summary = status === 'pass'
    ? `Bought, moved and sold back on the live state. The round trip cost ${lossPct.toFixed(2)}%, in line with fees and tax.`
    : lossPct > 25 ? `The trade goes through, but a round trip costs ${lossPct.toFixed(1)}%: far above normal fees.` : `Tokens vanish in transit: ${buyGap.toFixed(2)}% missing on the buy, ${moveGap.toFixed(2)}% on a transfer.`;
  return { status, summary, evidence: ev, sim: { buyGapPct: buyGap, moveGapPct: moveGap, lossPct, quoteIn: r.quoteIn.toString(), quoteBack: r.quoteBack.toString(), quoteSym, quoteDec } };
}

// ------------------------------------------------------------------ formatting
export function fmtAmount(v, d = 18) {
  if (v === undefined || v === null) return '?';
  const n = Number(formatUnits(BigInt(v), d));
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toPrecision(3);
}
export const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
function shortErr(e) { return (e?.shortMessage || e?.message || String(e)).split('\n')[0].slice(0, 160); }
function decodeRevert(data) {
  try {
    if (data.startsWith('0x08c379a0')) return '"' + decodeAbiParameters([{ type: 'string' }], '0x' + data.slice(10))[0] + '"';
    if (data.startsWith('0x4e487b71')) return 'panic ' + BigInt('0x' + data.slice(10)).toString();
    return 'custom error ' + data.slice(0, 10);
  } catch { return data.slice(0, 10); }
}
