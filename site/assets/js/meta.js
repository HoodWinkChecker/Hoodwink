// What the creator typed when launching on Pons (name, logo, description, socials) is in the launch
// transaction's calldata. Launches go through several routers with different function signatures, so
// instead of one ABI the calldata is scanned for ABI-encoded strings (a length word followed by bytes).
// Shared by the browser engine and the server function.

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const PONS_LAUNCH_TOPIC = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';

/** every ABI-encoded string in a hex blob, in order */
export function abiStrings(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  const out = [];
  const dec = new TextDecoder('utf-8', { fatal: true });
  // routers wrap the factory call in nested bytes, so strings can sit at any offset: scan every byte
  for (let w = 0; w + 32 <= bytes.length; w += 1) {
    // length word: 28 zero bytes then a length below 4096
    let zero = true;
    for (let k = 0; k < 28; k++) if (bytes[w + k]) { zero = false; break; }
    if (!zero) continue;
    const len = (bytes[w + 28] << 24) | (bytes[w + 29] << 16) | (bytes[w + 30] << 8) | bytes[w + 31];
    if (len < 2 || len > 4096 || w + 32 + len > bytes.length) continue;
    const body = bytes.slice(w + 32, w + 32 + len);
    // padding after the string must be zero
    const padEnd = w + 32 + Math.ceil(len / 32) * 32;
    let padOk = true;
    for (let k = w + 32 + len; k < Math.min(padEnd, bytes.length); k++) if (bytes[k]) { padOk = false; break; }
    if (!padOk) continue;
    let s;
    try { s = dec.decode(body); } catch { continue; }
    if (/[\x00-\x08\x0e-\x1f]/.test(s)) continue;
    out.push(s.trim());
    w = padEnd - 1; // skip the string body
  }
  return out.filter(Boolean);
}

const URL_RE = /^(https?:\/\/|ipfs:\/\/|ar:\/\/|www\.)\S+$/i;
/** sort the strings of a launch into fields */
export function classify(strings, { name, symbol } = {}) {
  const meta = { name: null, symbol: null, description: null, logo: null, website: null, x: null, telegram: null, discord: null, farcaster: null, github: null, other: [] };
  for (const s of strings) {
    const u = s.toLowerCase();
    if (URL_RE.test(s)) {
      if (/^ipfs:|^ar:|ipfs|\.(png|jpe?g|gif|webp|svg)(\?|$)|pinata|filebase|nft\.storage|imgur/.test(u) && !meta.logo) meta.logo = s;
      else if (/(^|\/\/|\.)(x|twitter)\.com\//.test(u)) meta.x = meta.x || s;
      else if (/(^|\/\/)(t\.me|telegram\.me)\//.test(u)) meta.telegram = meta.telegram || s;
      else if (/discord\.(gg|com)\//.test(u)) meta.discord = meta.discord || s;
      else if (/warpcast\.com|farcaster/.test(u)) meta.farcaster = meta.farcaster || s;
      else if (/github\.com\//.test(u)) meta.github = meta.github || s;
      else if (!meta.website) meta.website = s;
      else meta.other.push(s);
    } else if (name && s === name) meta.name = s;
    else if (symbol && s === symbol) meta.symbol = s;
    else if (!meta.description || s.length > meta.description.length) {
      if (meta.description && meta.description !== s) meta.other.push(meta.description);
      meta.description = s;
    } else meta.other.push(s);
  }
  if (meta.description && (meta.description === name || meta.description === symbol)) meta.description = null;
  return meta;
}

/** parse an X link: profile or status */
export function parseX(url) {
  if (!url) return null;
  const m = String(url).match(/(?:x|twitter)\.com\/(?:#!\/)?([A-Za-z0-9_]{1,20})(?:\/status(?:es)?\/(\d+))?/i);
  if (!m) return { raw: url, handle: null, status: null };
  if (['i', 'home', 'search', 'intent', 'share'].includes(m[1].toLowerCase())) return { raw: url, handle: null, status: m[2] || null };
  return { raw: url, handle: m[1], status: m[2] || null };
}
export function parseGithub(url) {
  const m = String(url || '').match(/github\.com\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9._-]+))?/i);
  return m ? { owner: m[1], repo: m[2] ? m[2].replace(/\.git$/, '') : null } : null;
}

async function rpc(method, params, url = RPC) {
  for (let i = 0; i < 6; i++) {
    try {
      const j = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
      if (!j.error) return j.result;
      if (!/rate|too many|timeout/i.test(j.error.message)) throw new Error(j.error.message);
    } catch (e) { if (i === 5) throw e; }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
}

/** find the launch event, read its transaction and return the creator's metadata */
export async function launchMetadata(token, { rpcUrl = RPC, name, symbol, head } = {}) {
  const t = token.toLowerCase();
  const H = head || parseInt(await rpc('eth_blockNumber', [], rpcUrl), 16);
  let log = null;
  for (let b = H; b >= 0 && !log; b -= 10_000_000) {
    const r = await rpc('eth_getLogs', [{ address: PONS_FACTORY, topics: [PONS_LAUNCH_TOPIC, '0x' + t.slice(2).padStart(64, '0')], fromBlock: '0x' + Math.max(0, b - 9_999_999).toString(16), toBlock: '0x' + b.toString(16) }], rpcUrl);
    log = r[0] || null;
    if (b - 9_999_999 <= 0) break;
  }
  if (!log) return null;
  const tx = await rpc('eth_getTransactionByHash', [log.transactionHash], rpcUrl);
  const blk = await rpc('eth_getBlockByNumber', [log.blockNumber, false], rpcUrl);
  const strings = abiStrings(tx.input);
  return {
    launchBlock: parseInt(log.blockNumber, 16), launchTx: log.transactionHash, launchedAt: blk ? parseInt(blk.timestamp, 16) : null,
    sender: tx.from, via: tx.to, deployer: '0x' + log.topics[3].slice(26),
    ...classify(strings, { name, symbol }),
  };
}
