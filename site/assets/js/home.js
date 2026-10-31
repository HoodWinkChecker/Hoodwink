import { mountInstrument, mountFooter, reveal, esc, cfg } from './site.js';
import { createDial } from './dial.js';
import { CHECKS, GROUPS, CHAIN, fmtAmount, short } from './engine.js';
import { STOCKS, PAIR_STATS } from './stocks.js';
import { attachTickerSearch } from './ticker-search.js';

const canvas = mountInstrument(document.getElementById('inst'));
mountFooter(document.getElementById('foot'));

// ---------------------------------------------------------------- scan form
const form = document.getElementById('scanForm');
const input = document.getElementById('addr');
const err = document.getElementById('err');
const ts = attachTickerSearch(input, document.getElementById('tsBox'), { rpc: cfg.rpc || CHAIN.rpc });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = input.value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) { location.href = 'scan.html?a=' + a; return; }
  if (/^0x/i.test(a)) { err.textContent = 'That address is incomplete: expected 0x followed by 40 hex characters.'; input.focus(); return; }
  if (a) { await ts.run(); const f = ts.first(); if (f) { location.href = f; return; } }
  err.textContent = 'Paste a contract address (0x…) or type a ticker like $REX.'; input.focus();
});
input.addEventListener('input', () => { err.textContent = ''; });
document.querySelectorAll('.chip[data-a]').forEach((b) => b.addEventListener('click', () => { location.href = 'scan.html?a=' + b.dataset.a; }));
fetch('data/tickers/meta.json').then((r) => r.json()).then((m) => { document.getElementById('mLaunch').textContent = m.count.toLocaleString('en-US'); }).catch(() => {});

// ---------------------------------------------------------------- comparison
const ROWS = [
  ['Is this the original ticker, or copy number seven?', 'no', 'yes', 'Index of every Pons launch; the first one with the ticker is named'],
  ['Does the website work, and does it show this contract?', 'no', 'yes', 'Visited server-side; redirects, shorteners and builders reported'],
  ['Is the X link the project, or a post by Robinhood or Elon?', 'no', 'yes', 'The post is read: author, date, text'],
  ['Is there real code behind "AI agent" or "protocol"?', 'no', 'yes', 'Repository age, commits, fork or not, created before or after launch'],
  ['Real product, honest meme, or LARP?', 'part', 'yes', 'An AI reads only the evidence above and must cite it'],
  ["What happened to the deployer's earlier launches?", 'part', 'yes', 'Every Pons launch by the wallet: graduated, dumped, how fast'],
  ['Did snipers buy the first 30 seconds, and are they still in?', 'part', 'yes', 'Launch event, every transfer after it, balances read now'],
  ['How much do the top 10 wallets hold?', 'yes', 'yes', 'Exact balances; pools and contracts set aside, smart wallets counted'],
  ['Wallets passing tokens between themselves', 'part', 'yes', 'Token-flow graph; exchanges set aside'],
  ['Is it priced in a real stock, or a copy?', 'no', 'yes', "Byte-for-byte fingerprint of Robinhood's stock-token proxy"],
  ['Is the contract the standard template?', 'yes', 'yes', 'One line: template diff plus a simulated buy, transfer and sell'],
];
const cell = (v) => `<span class="${v}">${v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Partly'}</span>`;
document.getElementById('cmpBody').closest('table').classList.add('stackable');
document.getElementById('cmpBody').innerHTML = ROWS.map(([q, a, b, how]) => `<tr><td>${esc(q)}</td><td data-l="Typical scanner">${cell(a)}</td><td class="us" data-l="Hoodwink">${cell(b)}<div class="dim" style="font-size:13px;margin-top:6px">${esc(how)}</div></td></tr>`).join('');

// ---------------------------------------------------------------- groups
let n = 0;
const order = GROUPS.map((g) => g.id);
document.getElementById('groups').innerHTML = order.map((gid) => {
  const g = GROUPS.find((x) => x.id === gid);
  const list = CHECKS.filter((c) => c.group === gid);
  return `<div class="group">
    <div class="gh"><h3 class="h3">${esc(g.title)}</h3><span class="label">${list.length} checks</span></div>
    <p class="gq">${esc(g.q)}</p>
    <ol>${list.map((c) => `<li><span class="ci">${String(++n).padStart(2, '0')}</span><div><div class="ct">${esc(c.title)}</div><div class="cq">${esc(c.q)}</div></div></li>`).join('')}</ol>
  </div>`;
}).join('');

// ---------------------------------------------------------------- stock section
const tickers = Object.entries(STOCKS).sort((a, b) => a[0].localeCompare(b[0]));
document.getElementById('tickers').innerHTML = tickers.map(([s, a]) => `<a href="scan.html?a=${a}" title="${a}">${esc(s)}</a>`).join('');
const total = PAIR_STATS.launches;
const top = PAIR_STATS.pairs.slice(0, 8);
const maxN = top[0].n;
document.getElementById('pairBars').innerHTML = top.map((p) => `<div class="bar"><span>${esc(p.sym)}</span><span class="t"><i class="${p.sym === 'ETH' ? 'eth' : ''}" style="transform:scaleX(${(p.n / maxN).toFixed(4)})"></i></span><span class="n">${p.n.toLocaleString('en-US')}</span></div>`).join('');
const nonEth = total - (PAIR_STATS.pairs.find((p) => p.sym === 'ETH')?.n || 0);
const copies = PAIR_STATS.pairs.filter((p) => p.kind !== 'stock' && p.sym !== 'ETH' && p.sym !== 'USDG');
document.getElementById('pairNote').innerHTML = `${(nonEth / total * 100).toFixed(1)}% of ${total.toLocaleString('en-US')} launches read on chain are priced in something other than ETH. ${copies.length} pair assets are neither ETH, USDG nor an official stock. Read at block ${PAIR_STATS.block.toLocaleString('en-US')}.`;

// ---------------------------------------------------------------- cases + dial
const CASES = ['0x4f7bf61d52d56086a29aa028f414042933d79218', '0x07ebb29a38fbcb41563817e5e19f2cec619c90d2', '0x7c90fad0331ce02855539c0661d0eaa829c40907', '0x77681d23c6d2302321ccc367b632e39d794ea77e', '0x66742771b79a61f19cc307218d6afb6ed835000e'];
const KIND = { pons: 'Pons token', stock: 'Robinhood stock token', other: 'Token' };
const reports = (await Promise.all(CASES.map((a) => fetch(`data/cases/${a}.json`).then((r) => r.json()).catch(() => null)))).filter(Boolean);

function verdictLine(r) {
  const crit = r.checks.filter((c) => c.status === 'critical');
  const con = r.checks.filter((c) => c.status === 'concern');
  if (crit.length) return crit[0].summary;
  if (con.length) return con.map((c) => c.title).join(' · ');
  return 'No issue found in what was checked.';
}
document.getElementById('caseList').innerHTML = `<div class="cmp-wrap"><table class="cmp"><thead><tr><th>Token</th><th>Findings</th><th>Coverage</th></tr></thead><tbody>${reports.map((r) => `
  <tr style="cursor:pointer" data-href="scan.html?a=${r.token}">
    <td><a href="scan.html?a=${r.token}" style="text-decoration:none"><span style="font-weight:650;font-size:17px;font-stretch:110%">${esc(r.symbol)}</span> <span class="dim">· ${esc(r.name)}</span></a><div class="label" style="margin-top:6px">${KIND[r.kind]} · ${short(r.token)} · block ${r.block.toLocaleString('en-US')}</div></td>
    <td><div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px">${['critical', 'concern', 'pass', 'info'].map((s) => r.counts[s] ? `<span class="st st-${s}">${r.counts[s]} ${s}</span>` : '').join('')}</div><div class="dim" style="font-size:13.5px">${esc(verdictLine(r))}</div></td>
    <td><span class="big" style="font-size:30px">${r.coverage}%</span></td>
  </tr>`).join('')}</tbody></table></div>`;
document.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.href = tr.dataset.href; }));

// the instrument idles through the case files, drawing each token's real bytecode
const dial = canvas ? createDial(canvas, { onHover: (h) => { document.getElementById('roByte').textContent = h ? `0x${h.offset.toString(16).padStart(4, '0')}  ${h.op}` : 'hover the ring'; } }) : null;
async function code(a) {
  try {
    const r = await fetch(cfg.rpc || CHAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [a, 'latest'] }) });
    return (await r.json()).result || '';
  } catch { return ''; }
}
if (dial && reports.length) {
  dial.setChecks(CHECKS, GROUPS);
  dial.setCenter(String(CHECKS.length), 'checks');
  let i = 0;
  const codes = {};
  const show = async () => {
    const r = reports[i % reports.length];
    codes[r.token] = codes[r.token] || await code(r.token);
    dial.setCode(codes[r.token]);
    dial.setChecks(r.checks, GROUPS);
    dial.setCenter(r.coverage + '%', `${r.symbol} · coverage`);
    dial.setMode('done');
    document.getElementById('roTarget').textContent = `${r.symbol} · ${short(r.token)}`;
    document.getElementById('roSize').textContent = codes[r.token] ? `${((codes[r.token].length - 2) / 2).toLocaleString('en-US')} bytes` : 'offline';
    i++;
  };
  await show();
  setInterval(show, 9000);
}

// ---------------------------------------------------------------- case file: the reality checks on a real token
{
  const r = reports.find((x) => x.token === '0x4f7bf61d52d56086a29aa028f414042933d79218') || reports[0];
  const el = document.getElementById('caseFile');
  if (r && el) {
    const m = r.metadata || {};
    const pick = (id) => r.checks.find((c) => c.id === id);
    const rows = ['website', 'social', 'code', 'larp', 'ticker', 'firstblock', 'devrep'].map(pick).filter(Boolean);
    el.innerHTML = `<div class="receipt" style="padding:26px 28px">
      <div class="rh"><span>Case file · ${esc(r.symbol)} · ${esc(r.name)}</span><span>block ${r.block.toLocaleString('en-US')}</span></div>
      <div class="rl"><span>Typed at launch · website</span><span>${esc(m.website || 'none')}</span></div>
      <div class="rl"><span>Typed at launch · X</span><span style="word-break:break-all">${esc(m.x || 'none')}</span></div>
      <div class="rl"><span>Typed at launch · description</span><span>${esc(m.description || 'none')}</span></div>
      ${rows.map((c) => `<div class="rl" style="align-items:flex-start"><span><span class="st st-${c.status}">${esc(c.title)}</span></span><span style="font-family:var(--display);font-size:14px;max-width:70%;text-align:right">${esc(c.summary)}</span></div>`).join('')}
      <div class="rf">Real token, scanned with the engine on this site. <a href="scan.html?a=${r.token}" style="color:var(--uv)">Open the full report →</a></div>
    </div>`;
  }
}

reveal();
