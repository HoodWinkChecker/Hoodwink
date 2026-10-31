import { mountInstrument, mountFooter, esc, cfg } from './site.js';
import { createDial } from './dial.js';
import { investigate, CHECKS, GROUPS, CHAIN, short, setRpc, selectorsOf } from './engine.js';
import { glanceHTML } from './glance.js';

setRpc(cfg.rpc);
const canvas = mountInstrument(document.getElementById('inst'));
mountFooter(document.getElementById('foot'));
const $ = (id) => document.getElementById(id);
const EXP = CHAIN.explorer;
const addrLink = (a) => `<a href="${EXP}/address/${a}" target="_blank" rel="noopener">${esc(a)}</a>`;
const txLink = (h, label) => `<a href="${EXP}/tx/${h}" target="_blank" rel="noopener">${esc(label || h)}</a>`;
const ST_LABEL = { pass: 'Pass', info: 'Info', concern: 'Concern', critical: 'Critical', unchecked: 'Unchecked', na: 'N/A', pending: 'Reading' };

const params = new URLSearchParams(location.search);
const target = (params.get('a') || '').trim();
const dial = canvas ? createDial(canvas, { onHover: (h) => { $('roByte').textContent = h ? `0x${h.offset.toString(16).padStart(4, '0')}  ${h.op}` : 'hover the ring'; } }) : null;

// ---------------------------------------------------------------- skeleton
function skeleton() {
  $('groups').innerHTML = GROUPS.map((g, gi) => `
    <section class="rgroup" id="g-${g.id}">
      <div class="rgroup-h"><span class="sec-num">${String(gi + 1).padStart(2, '0')} / ${esc(g.title.toUpperCase())}</span><h2 class="h3" style="font-size:22px">${esc(g.q)}</h2><span class="label" id="gc-${g.id}"></span></div>
      ${CHECKS.filter((c) => c.group === g.id).map((c) => `
        <div class="row" id="r-${c.id}">
          <button type="button" aria-expanded="false" aria-controls="ev-${c.id}">
            <span class="st st-pending" id="st-${c.id}">${ST_LABEL.pending}</span>
            <span><span class="t">${esc(c.title)}</span><span class="s" id="s-${c.id}" style="display:block">${esc(c.q)}</span></span>
            <span class="tog" aria-hidden="true"></span>
          </button>
          <div class="ev" id="ev-${c.id}"></div>
        </div>`).join('')}
    </section>`).join('');
  document.querySelectorAll('.row > button').forEach((b) => b.addEventListener('click', () => {
    const row = b.parentElement; row.classList.toggle('open'); b.setAttribute('aria-expanded', row.classList.contains('open'));
  }));
}

function renderCheck(c) {
  const st = $('st-' + c.id);
  st.className = 'st st-' + c.status; st.textContent = ST_LABEL[c.status] || c.status;
  $('s-' + c.id).textContent = c.summary || '';
  const ev = c.evidence || [];
  $('ev-' + c.id).innerHTML = ev.length ? `<dl>${ev.map((e) => `<dt>${esc(e.k)}</dt><dd>${e.tx ? txLink(e.tx, e.v) : e.addr ? (String(e.v).toLowerCase() === String(e.addr).toLowerCase() ? addrLink(e.addr) : `${esc(e.v)} · ${addrLink(e.addr)}`) : esc(e.v)}</dd>`).join('')}</dl><div class="method">Check: ${esc(c.q)}</div>` : `<div class="method">${esc(c.q)} No evidence attached to this outcome.</div>`;
  dial && dial.setStatus(c.id, c.status);
}

// ---------------------------------------------------------------- run
async function run() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
    $('repTitle').textContent = 'Paste a token address';
    $('progress').style.display = 'none';
    $('scanForm').style.display = '';
    $('repSummary').innerHTML = target ? `<div class="err">"${esc(target.slice(0, 80))}" is not an address. Expected 0x followed by 40 hex characters.</div>` : '';
    dial && (dial.setChecks(CHECKS, GROUPS), dial.setCenter('—', 'no target'));
    return;
  }
  document.title = `Scan ${short(target)} · Hoodwink`;
  skeleton();
  $('repSub').innerHTML = `<span>${addrLink(target)}</span><span>Robinhood Chain · ${CHAIN.id}</span>`;
  $('roTarget').textContent = short(target);
  $('led').className = 'led busy';
  if (dial) { dial.setChecks(CHECKS, GROUPS); dial.setMode('scan'); dial.setCenter('0', 'checks settled'); }
  // draw the bytecode straight away
  fetch(cfg.rpc || CHAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [target, 'latest'] }) })
    .then((r) => r.json()).then((j) => { if (j.result && dial) { dial.setCode(j.result, flaggedSelectors(j.result)); $('roSize').textContent = `${((j.result.length - 2) / 2).toLocaleString('en-US')} bytes`; } }).catch(() => {});
  let settled = 0;
  const live = CHECKS.map((c) => ({ ...c, status: 'pending' }));
  $('glance').innerHTML = glanceHTML(live, {});
  const t0 = performance.now();
  try {
    const rep = await investigate(target, {
      onCheck: (c) => {
        renderCheck(c);
        live[live.findIndex((x) => x.id === c.id)] = c;
        $('glance').innerHTML = glanceHTML(live, {});
        settled = CHECKS.filter((x) => !['pending'].includes($('st-' + x.id).className.replace('st st-', ''))).length;
        dial && dial.setCenter(String(settled), `of ${CHECKS.length} settled`);
        $('pbar').style.transform = `scaleX(${settled / CHECKS.length})`;
        $('stageN').textContent = `${settled}/${CHECKS.length}`;
      },
      onStage: (s, p) => {
        $('stageText').textContent = s + (p && p.n ? ` · ${p.n.toLocaleString('en-US')} ${s.includes('balances') ? 'wallets' : 'events'}` : '') + '…';
      },
    });
    finish(rep, performance.now() - t0);
  } catch (e) {
    $('led').className = 'led off';
    $('repTitle').textContent = 'The scan could not run';
    $('progress').style.display = 'none';
    $('repSummary').innerHTML = `<div class="verdict v-critical">${esc(e.message || e)}</div><div class="rep-actions"><button class="btn" onclick="location.reload()">Try again</button></div>`;
    dial && dial.setMode('idle');
  }
}

// selectors that deserve a red label on the ring
function flaggedSelectors(code) {
  const S = { '0x40c10f19': 'mint(address,uint256)', '0x8456cb59': 'pause()', '0xf9f92be4': 'blacklist(address)', '0x3659cfe6': 'upgradeTo(address)', '0x4f1ef286': 'upgradeToAndCall(address,bytes)', '0x1e89d545': 'setBots(address[],bool)', '0x69fe0e2d': 'setFee(uint256)', '0xec28438a': 'setMaxTxAmount(uint256)', '0x437823ec': 'excludeFromFee(address)' };
  const have = selectorsOf(code);
  return Object.entries(S).filter(([s]) => have.has(s)).map(([sel, label]) => ({ sel, label, sev: 'critical' }));
}

function finish(rep, ms) {
  window.__report = rep;
  $('led').className = 'led';
  $('progress').style.display = 'none';
  const kind = rep.kind === 'stock' ? 'Robinhood stock token' : rep.kind === 'pons' ? 'Pons token' : 'Token';
  $('repKicker').textContent = `${kind} · investigation`;
  $('repTitle').textContent = `${rep.symbol || '?'} · ${rep.name || 'unnamed'}`;
  document.title = `${rep.symbol || short(rep.token)} · Hoodwink scan`;
  $('repSub').innerHTML = `<span>${addrLink(rep.token)}</span><span>Block ${rep.block?.toLocaleString('en-US')}</span><span>${(ms / 1000).toFixed(1)} s · ${rep.meta.rpcCalls} RPC calls · ${rep.meta.transfers.toLocaleString('en-US')} transfers read</span>`;
  $('glance').innerHTML = glanceHTML(rep.checks, { symbol: rep.symbol, done: true });
  const c = rep.counts;
  const crit = rep.checks.filter((x) => x.status === 'critical');
  const con = rep.checks.filter((x) => x.status === 'concern');
  let v, cls;
  if (crit.length) { v = `${crit.length} critical finding${crit.length > 1 ? 's' : ''}. ${crit[0].summary}`; cls = 'v-critical'; }
  else if (con.length) { v = `${con.length} point${con.length > 1 ? 's' : ''} worth reading: ${con.map((x) => x.title.toLowerCase()).join(', ')}. No critical finding in what was checked.`; cls = 'v-concern'; }
  else { v = 'No issue found in what was checked. That covers the checks listed below, nothing more.'; cls = 'v-pass'; }
  $('repSummary').innerHTML = `
    <div class="tally">
      <div><div class="label">Coverage</div><div class="n">${rep.coverage}%</div></div>
      <div><div class="label">Critical</div><div class="n c-critical">${c.critical}</div></div>
      <div><div class="label">Concern</div><div class="n c-concern">${c.concern}</div></div>
      <div><div class="label">Pass</div><div class="n c-pass">${c.pass}</div></div>
      <div><div class="label">Info</div><div class="n c-info">${c.info}</div></div>
      <div><div class="label">Unchecked</div><div class="n c-unchecked">${c.unchecked}</div></div>
    </div>
    <p class="label" style="margin-top:12px">Coverage is how much of the investigation completed, not a safety score. ${c.na} check${c.na === 1 ? '' : 's'} did not apply to this token.</p>
    <div class="rep-actions">
      <button class="btn primary" id="aCopy">Copy report link</button>
      <button class="btn" id="aJson">Download evidence (JSON)</button>
      <button class="btn" id="aRerun">Run again</button>
      <a class="btn ghost" href="docs.html#checks">How each check decides →</a>
    </div>`;
  $('aCopy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('aCopy').textContent = 'Link copied'; } catch { prompt('Copy this link', location.href); } };
  $('aJson').onclick = () => {
    const blob = new Blob([JSON.stringify(rep, (k, val) => (typeof val === 'bigint' ? val.toString() : val), 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hoodwink-${rep.symbol || 'token'}-${rep.block}.json`; a.click();
  };
  $('aRerun').onclick = () => location.reload();
  for (const g of GROUPS) {
    const list = rep.checks.filter((x) => x.group === g.id);
    const bad = list.filter((x) => x.status === 'critical' || x.status === 'concern').length;
    $('gc-' + g.id).textContent = bad ? `${bad} to read` : `${list.filter((x) => x.status !== 'na').length} checked`;
  }
  // open the rows that matter
  for (const x of rep.checks) if (x.status === 'critical' || x.status === 'concern') { $('r-' + x.id).classList.add('open'); $('r-' + x.id).querySelector('button').setAttribute('aria-expanded', 'true'); }
  dial && (dial.setMode('done'), dial.setCenter(rep.coverage + '%', `${rep.symbol} · coverage`));
  $('roTarget').textContent = `${rep.symbol} · ${short(rep.token)}`;
  widgets(rep);
}

// ---------------------------------------------------------------- widgets
function widgets(rep) {
  const get = (id) => rep.checks.find((x) => x.id === id);
  const out = [];
  const lv = get('larp');
  if (lv && lv.verdict) {
    const V = lv.verdict;
    const LABEL = { real_product: 'Real product', honest_meme: 'Honest meme', larp: 'LARP', unclear: 'Unclear' };
    const col = V.verdict === 'larp' ? 'var(--critical)' : V.verdict === 'unclear' ? 'var(--concern)' : 'var(--pass)';
    out.push(`<div class="widget" style="grid-column:1/-1;border-right:0"><h4><span>AI verdict</span><span>${esc(V.confidence)} confidence · evidence gathered by the scanner</span></h4>
      <div style="display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin-bottom:14px"><span class="big" style="color:${col};text-transform:uppercase">${LABEL[V.verdict]}</span><span style="font-size:18px;color:var(--ink)">${esc(V.headline)}</span></div>
      ${(V.claims || []).length ? `<div class="hbars">${V.claims.map((c) => `<div class="hbar" style="grid-template-columns:110px 1fr"><span class="st st-${c.status === 'supported' ? 'pass' : c.status === 'contradicted' ? 'critical' : 'concern'}">${esc(c.status)}</span><span style="font-family:var(--display);font-size:14px;color:var(--ink-2)"><b style="color:var(--ink);font-weight:600">${esc(c.claim)}</b> · ${esc(c.evidence)}</span></div>`).join('')}</div>` : ''}</div>`);
  }
  const tk = get('ticker');
  if (tk && tk.rank) {
    out.push(`<div class="widget"><h4><span>Ticker</span><span>$${esc(rep.symbol)}</span></h4>
      <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:12px"><span class="big" style="color:${tk.rank === 1 ? 'var(--pass)' : 'var(--concern)'}">${tk.rank === 1 ? (tk.copies ? 'Original' : 'Unique') : 'Copy #' + tk.rank}</span><span class="dim">${tk.copies ? `${tk.copies + 1} tokens share this ticker` : 'no other Pons token uses it'}</span></div>
      ${tk.original ? `<div class="label">The first one · <a href="scan.html?a=${tk.original}" style="color:var(--uv)">${short(tk.original)}</a></div>` : ''}</div>`);
  }
  const dr = get('devrep');
  if (dr && dr.devrep && dr.devrep.earlier) {
    const R = dr.devrep;
    out.push(`<div class="widget"><h4><span>Deployer track record</span><span>${R.launches} Pons launches</span></h4>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div><div class="big" style="font-size:34px">${R.earlier}</div><div class="label">earlier launches</div></div>
        <div><div class="big" style="font-size:34px;color:var(--pass)">${R.graduated}</div><div class="label">graduated</div></div>
        <div><div class="big" style="font-size:34px;color:${R.dumped ? 'var(--critical)' : 'var(--ink)'}">${R.dumped}</div><div class="label">dumped by the dev${R.median !== null ? ` · median ${R.median.toFixed(1)} min` : ''}</div></div>
      </div></div>`);
  }
  const d = get('distribution');
  if (d && d.holdersTop && d.status !== 'unchecked' && d.status !== 'na') {
    const topSum = d.holdersTop.reduce((s, h) => s + h.pct, 0);
    const rest = Math.max(0, 100 - topSum - (d.venuesPct || 0) - (d.contractsPct || 0));
    const seg = (w, c, title) => (w > 0 ? `<i title="${esc(title)} ${w.toFixed(2)}%" style="width:${w}%;background:${c}"></i>` : '');
    out.push(`<div class="widget"><h4><span>Who holds the supply</span><span>${d.partial ? 'covered wallets' : 'all wallets'}</span></h4>
      <div class="stack">${seg(topSum, 'var(--uv)', 'Top 10 wallets')}${seg(rest, '#3a3e47', 'Other wallets')}${seg(d.venuesPct || 0, 'var(--ink-2)', 'Curve / pool')}${seg(d.contractsPct || 0, 'repeating-linear-gradient(135deg,#7d8088 0 2px,transparent 2px 4px)', 'Other contracts')}</div>
      <div class="legend" style="margin-bottom:18px"><span style="--c:var(--uv)">Top 10 wallets ${topSum.toFixed(1)}%</span><span style="--c:#3a3e47">Other wallets ${rest.toFixed(1)}%</span><span style="--c:var(--ink-2)">Curve / pool ${(d.venuesPct || 0).toFixed(1)}%</span>${d.contractsPct ? `<span style="--c:#7d8088">Contracts ${d.contractsPct.toFixed(1)}%</span>` : ''}</div>
      <div class="hbars">${topSum < 0.01 ? `<div class="dim" style="font-size:14px">No wallet holds a meaningful share yet: ${(d.venuesPct || 0).toFixed(1)}% of the supply is still in the curve or the pool.</div>` : d.holdersTop.slice(0, 10).map((h) => `<div class="hbar"><a href="${EXP}/address/${h.a}" target="_blank" rel="noopener">${short(h.a)}</a><span class="t"><i class="uvb" style="width:${Math.min(100, h.pct / Math.max(d.holdersTop[0]?.pct || 1, 0.0001) * 100)}%"></i></span><span class="n">${h.pct.toFixed(2)}%</span></div>`).join('')}</div></div>`);
  }
  const f = get('firstblock');
  if (f && f.early) {
    const e = f.early, mx = Math.max(e.devBuy, e.blockBuy, e.winBuy, e.still, 1);
    const row = (k, v, c) => `<div class="hbar" style="grid-template-columns:150px 1fr 56px"><span class="dim">${k}</span><span class="t"><i style="width:${v / mx * 100}%;background:${c}"></i></span><span class="n">${v.toFixed(2)}%</span></div>`;
    out.push(`<div class="widget"><h4><span>The first 30 seconds</span><span>${e.buyers} early buyers</span></h4>
      <div class="hbars">${row('Deployer, launch tx', e.devBuy, 'var(--ink-2)')}${row('Others, launch block', e.blockBuy, e.blockBuy > 3 ? 'var(--critical)' : 'var(--uv)')}${row('Others, first 30 s', e.winBuy, e.winBuy > 12 ? 'var(--concern)' : 'var(--uv)')}${row('Still held by them', e.still, e.still > 8 ? 'var(--concern)' : 'var(--pass)')}</div>
      <p class="label" style="margin-top:16px">Share of total supply. Source: launch event and every transfer in the window.</p></div>`);
  }
  const cl = get('clusters');
  if (cl && cl.clusters && cl.clusters.length) {
    const mx = Math.max(...cl.clusters.map((c) => c.pct), 0.01);
    out.push(`<div class="widget"><h4><span>Linked wallet groups</span><span>token flow, hubs set aside</span></h4>
      <div class="hbars">${cl.clusters.map((c, i) => `<div class="hbar" style="grid-template-columns:150px 1fr 56px"><span class="dim">Group ${i + 1} · ${c.size} wallets${c.hasDev ? ' · deployer' : ''}</span><span class="t"><i style="width:${c.pct / mx * 100}%;background:${c.hasDev ? 'var(--critical)' : 'var(--uv)'}"></i></span><span class="n">${c.pct.toFixed(2)}%</span></div>`).join('')}</div>
      <p class="label" style="margin-top:16px">Wallets that sent the token directly to each other, joined into groups.</p></div>`);
  }
  if (out.length) { $('widgets').innerHTML = out.join(''); $('widgets').hidden = false; }
}

$('scanForm').addEventListener('submit', (e) => { e.preventDefault(); const a = $('addr').value.trim(); if (a) location.href = 'scan.html?a=' + a; });
run();
