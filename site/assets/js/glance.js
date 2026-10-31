// "At a glance": the whole report in one card. Turns the settled checks into eight tiles and one sentence.
// Pure function of the checks, so it can be redrawn each time a check settles.
import { esc } from './site.js';

const P = (s) => ({ pass: 0, info: 1, unchecked: 1, na: 1, concern: 2, critical: 3 }[s] ?? 1);
const tone = (s) => (s === 'critical' ? 'critical' : s === 'concern' ? 'concern' : s === 'pass' ? 'pass' : s === 'pending' ? 'pending' : 'info');

/** each tile: label, value, tone, and the phrase used in the sentence when it is a risk */
function tiles(get) {
  const out = [];
  const t = get('ticker');
  if (t) {
    let v = 'Reading…', risk = null;
    if (t.status === 'critical') { v = 'Copycat of a winner'; risk = "the ticker copies a token that already graduated"; }
    else if (t.status === 'concern') { v = t.rank ? `Copy #${t.rank}` : 'Copy'; risk = 'the ticker is a copy'; }
    else if (t.status === 'pass') v = 'Unique';
    else if (t.status === 'info') v = t.rank === 1 ? 'Original' : 'Common ticker';
    else if (t.status === 'unchecked') v = 'Not checked';
    out.push({ k: 'Ticker', v, s: t.status, risk });
  }
  const w = get('website');
  if (w) {
    let v = 'Reading…', risk = null;
    const sum = w.summary || '';
    if (w.status === 'pass') v = 'Live, shows the CA';
    else if (w.status === 'concern') { v = /does not work/.test(sum) ? 'Dead link' : 'Suspicious'; risk = /does not work/.test(sum) ? 'the website is dead' : 'the website has red flags'; }
    else if (w.status === 'info') v = /^No website/.test(sum) ? 'None' : 'Live, no CA on it';
    else if (w.status === 'unchecked') v = 'Not checked';
    out.push({ k: 'Website', v, s: w.status, risk });
  }
  const x = get('social');
  if (x) {
    let v = 'Reading…', risk = null;
    const sum = x.summary || '';
    const who = (sum.match(/@([A-Za-z0-9_]+)/) || [])[1];
    if (x.status === 'critical' || /Borrowed/.test(sum)) { v = who ? `Borrowed from @${who}` : 'Borrowed'; risk = who ? `the X link is someone else's (@${who})` : "the X link is someone else's"; }
    else if (x.status === 'concern') { v = 'Mismatch'; risk = 'the X account does not match the site'; }
    else if (x.status === 'pass') v = 'Matches the site';
    else if (x.status === 'info') v = /^No X/.test(sum) ? 'None' : who ? `@${who}, unverified` : 'Unverified';
    else if (x.status === 'unchecked') v = 'Not checked';
    out.push({ k: 'X account', v, s: x.status === 'info' ? 'info' : x.status, risk });
  }
  const l = get('larp');
  if (l) {
    let v = 'Reading…', risk = null;
    const V = l.verdict?.verdict;
    if (V === 'larp') { v = 'LARP'; risk = 'the AI rates the project a LARP'; }
    else if (V === 'real_product') v = 'Real product';
    else if (V === 'honest_meme') v = 'Honest meme';
    else if (V === 'unclear') { v = 'Unclear'; risk = 'the claims could not be verified'; }
    else if (l.status === 'unchecked' || l.status === 'na') v = 'No AI verdict';
    out.push({ k: 'Tech / claims', v, s: l.status, risk });
  }
  const f = get('firstblock');
  if (f) {
    let v = 'Reading…', risk = null;
    const e = f.early;
    if (e) {
      const heavy = e.winBuy + e.blockBuy;
      v = heavy < 3 ? 'Clean start' : `${heavy.toFixed(0)}% sniped · ${e.still.toFixed(0)}% still held`;
      if (f.status === 'critical') risk = `snipers took ${heavy.toFixed(0)}% at launch${e.still >= 1 ? ` and still hold ${e.still.toFixed(0)}%` : ''}`;
      else if (f.status === 'concern') risk = e.still >= 1 ? `snipers still hold ${e.still.toFixed(0)}%` : `bots sniped ${heavy.toFixed(0)}% at launch (since sold)`;
    } else if (f.status !== 'pending') v = f.status === 'na' ? 'N/A' : 'Not measured';
    out.push({ k: 'Snipers', v, s: f.status, risk });
  }
  const d = get('distribution');
  if (d) {
    let v = 'Reading…', risk = null;
    if (d.holdersTop) {
      const top = d.holdersTop.reduce((a, h) => a + h.pct, 0);
      v = top < 0.1 ? 'Nobody yet' : `${top.toFixed(1)}% in 10 wallets`;
      if (d.status !== 'pass') risk = `the top 10 hold ${top.toFixed(0)}%`;
    } else if (d.status !== 'pending') v = d.status === 'na' ? 'N/A' : 'Not measured';
    out.push({ k: 'Top 10', v, s: d.status, risk });
  }
  const r = get('devrep'), dv = get('dev');
  if (r) {
    let v = 'Reading…', risk = null;
    const R = r.devrep;
    const sum = r.summary || '';
    if (/^Serial dumper/.test(sum)) { v = `Serial dumper (${R?.dumped} dumps)`; risk = `the deployer dumped ${R?.dumped} earlier launches`; }
    else if (/^Serial launcher/.test(sum)) { v = `Serial launcher (${R?.launches})`; risk = `the deployer has launched ${R?.launches} tokens`; }
    else if (r.status === 'concern') { v = `${R?.dumped ?? '?'} dumps before`; risk = 'the deployer dumped earlier launches'; }
    else if (r.status === 'pass') v = 'Good track record';
    else if (/^First Pons launch/.test(sum)) v = 'First launch';
    else if (r.status === 'info') v = R ? `${R.earlier} earlier, ${R.graduated} graduated` : 'Known';
    else if (r.status !== 'pending') v = 'Not checked';
    let s = r.status;
    if (dv && dv.status === 'concern' && P(s) < 2) { s = 'concern'; v += ' · sold here'; risk = risk || 'the deployer already sold on this token'; }
    out.push({ k: 'Developer', v, s, risk });
  }
  const c = get('contract');
  if (c) {
    let v = 'Reading…', risk = null;
    if (c.status === 'pass') v = 'Standard Pons';
    else if (c.status === 'info') v = 'Issuer controlled';
    else if (c.status === 'critical' || c.status === 'concern') { v = 'Non-standard'; risk = 'the contract is not the standard template'; }
    else if (c.status !== 'pending') v = 'Not checked';
    out.push({ k: 'Contract', v, s: c.status, risk });
  }
  return out;
}

/** html of the card; `done` switches the headline from "reading" to the verdict */
export function glanceHTML(checks, { symbol, done, waiting } = {}) {
  const get = (id) => checks.find((c) => c.id === id);
  const T = tiles(get).map((t) => (waiting ? { ...t, v: '—', s: 'info', risk: null } : t));
  const settled = checks.filter((c) => c.status !== 'pending');
  const crit = settled.filter((c) => c.status === 'critical').length;
  const con = settled.filter((c) => c.status === 'concern').length;
  const level = crit ? 'high' : con >= 3 ? 'caution' : con ? 'caution' : 'low';
  const LEVEL = { high: ['High risk', 'critical'], caution: ['Caution', 'concern'], low: ['Low risk', 'pass'] };
  const risks = T.filter((t) => t.risk && P(t.s) >= 2).sort((a, b) => P(b.s) - P(a.s)).map((t) => t.risk);
  const good = T.filter((t) => t.s === 'pass').map((t) => (t.k.startsWith('X ') ? t.k : t.k.toLowerCase()));
  let sentence;
  if (waiting) sentence = waiting;
  else if (!done) sentence = risks.length ? `So far: ${risks.slice(0, 3).join('; ')}.` : 'Reading the chain and the links…';
  else if (risks.length) sentence = `${risks[0][0].toUpperCase() + risks[0].slice(1)}${risks.length > 1 ? `; ${risks.slice(1, 4).join('; ')}` : ''}.${good.length ? ` Clean: ${good.join(', ')}.` : ''}`;
  else sentence = `Nothing alarming in what was checked${good.length ? `: ${good.join(', ')} look clean` : ''}. That is not a promise; read the details below.`;
  const lv = LEVEL[level];
  return `<div class="glance">
    <div class="glance-head">
      <div class="glance-badge ${waiting ? '' : done ? 'g-' + lv[1] : 'g-pending'}"><span class="label">At a glance${symbol ? ' · $' + esc(symbol) : ''}</span><b>${waiting ? 'Not launched' : done ? lv[0] : 'Reading…'}</b></div>
      <p class="glance-text">${esc(sentence)}</p>
    </div>
    <div class="glance-grid">${T.map((t) => `<div class="gt gt-${tone(t.s)}"><span class="label">${esc(t.k)}</span><b>${esc(t.v)}</b></div>`).join('')}</div>
  </div>`;
}
