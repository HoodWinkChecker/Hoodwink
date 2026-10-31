// Shared shell: instrument panel (brand, dial slot, readout, channels), mobile bar, footer, reveal-on-scroll.
const CFG = window.HOODWINK || {};
export const cfg = CFG;
export const TICKER = '$' + ((CFG.token && CFG.token.ticker) || 'WINK');
export const X_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.73H5.58L16.67 19.2Z"/></svg>`;
export const MARK = `<svg viewBox="190.2 171.2 873.6 873.6" aria-hidden="true"><path fill="#f4f2ec" fill-rule="evenodd" d="M574.8 1016.6C520.7 938.2 473.3 879.5 434.5 842.9C396.9 807.4 348.6 772.7 278.5 730.7C264.2 722.2 250.6 713.8 248.3 712.1C238.8 705.2 235.3 692.4 240.2 683.2C242.3 679.4 252.6 668.1 316.5 599.0C359.4 552.7 380.4 529.0 399.6 505.5C417.2 483.8 423.8 475.2 421.5 477.0C418.2 479.5 371.7 520.3 348.6 540.9C322.0 564.7 318.4 567.8 319.2 566.5C319.5 566.0 329.2 549.8 340.7 530.5C352.2 511.2 364.9 489.6 369.0 482.5C387.8 449.1 395.1 437.9 410.4 418.0C429.9 392.7 445.0 376.5 575.9 241.2L627.5 187.8L642.5 203.2C650.8 211.7 667.2 228.7 678.9 241.0C690.7 253.4 706.3 269.6 713.5 277.0C762.5 327.6 815.9 384.4 829.3 400.5C851.2 426.6 863.1 444.0 883.2 479.4C896.0 501.7 909.3 524.1 925.8 550.8C931.3 559.7 935.6 567.0 935.3 567.0C935.1 567.0 930.0 562.5 924.2 557.1C908.2 542.2 833.5 476.1 833.2 476.5C832.9 476.8 834.8 479.3 855.0 504.8C871.2 525.3 908.3 567.1 946.5 608.0C976.2 639.8 1011.0 678.9 1013.2 683.1C1015.1 686.5 1016.0 689.7 1016.0 692.6C1016.0 703.6 1010.1 709.9 987.5 723.2C939.0 751.9 904.1 774.5 874.0 796.8C808.5 845.3 756.6 903.3 680.6 1012.9C674.8 1021.3 670.0 1028.0 670.0 1027.7C670.0 1027.5 675.1 1014.7 681.4 999.4C733.4 872.1 754.6 827.1 785.7 778.1C790.5 770.6 804.2 749.4 816.3 731.0C828.3 712.6 841.6 692.2 845.8 685.8L853.5 674.1L909.9 673.8L966.4 673.5L944.9 660.4C921.2 645.9 805.7 575.0 788.8 564.7C761.7 548.0 729.3 527.0 680.3 494.3L627.1 458.8L605.3 473.6C514.2 535.3 486.7 553.2 432.5 586.3C424.8 590.9 405.7 602.6 390.0 612.2C374.3 621.8 349.6 636.9 335.0 645.7C320.4 654.5 304.1 664.3 298.7 667.6L288.9 673.5L344.8 673.8L400.7 674.0L413.5 694.3C420.6 705.4 435.1 728.0 445.8 744.5C476.6 792.0 492.4 818.9 505.3 846.0C514.3 865.0 528.4 896.1 535.5 913.0C538.7 920.4 543.2 931.0 545.5 936.5C549.4 945.5 554.7 958.3 566.0 986.0C578.4 1016.3 582.9 1027.4 582.7 1027.6C582.6 1027.7 579.0 1022.8 574.8 1016.6Z"/><rect x="573" y="616" width="109" height="107" fill="#cdf731"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.73H5.58L16.67 19.2Z"/></svg>`;

const page = document.body.dataset.page || '';
const CHANNELS = [
  { ch: 'CH 01', nm: 'Scan', href: 'index.html', id: 'home' },
  { ch: 'CH 02', nm: 'Method', href: 'index.html#method', id: 'method' },
  { ch: 'CH 03', nm: 'Docs', href: 'docs.html', id: 'docs' },
  { ch: 'CH 04', nm: TICKER, href: 'token.html', id: 'token' },
  { ch: 'CH 05', nm: 'X', href: CFG.x || '#', id: 'x', ext: true },
];

export function mountInstrument(el) {
  if (!el) return null;
  const cur = page === 'scan' ? 'home' : page;
  el.innerHTML = `
    <div class="inst-head">
      <a class="brand" href="index.html" aria-label="Hoodwink home">${MARK}<span class="word">Hoodwink</span></a>
      <div class="inst-right">
        <div class="inst-status"><span class="led" id="led"></span><span class="label" id="ledText"><span class="rh">RH Chain </span><b id="blk">…</b></span></div>
        <a class="xbtn" href="${CFG.x || '#'}" target="_blank" rel="noopener" aria-label="Hoodwink on X">${X_ICON}<span>Follow</span></a>
      </div>
    </div>
    <div class="dial-wrap"><canvas id="dial" aria-label="Bytecode of the token under inspection, swept by the scanner" role="img"></canvas></div>
    <div class="readout">
      <div><div class="label">Target</div><div class="v" id="roTarget">Pons · stocks · any ERC-20</div></div>
      <div><div class="label">Byte under cursor</div><div class="v" id="roByte">hover the ring</div></div>
      <div><div class="label">Bytecode</div><div class="v" id="roSize">—</div></div>
    </div>
    <nav class="channels" aria-label="Main">
      ${CHANNELS.map((c) => `<a href="${c.href}"${c.ext ? ' target="_blank" rel="noopener"' : ''}${c.id === cur ? ' aria-current="page"' : ''}><span class="ch">${c.ch}</span><span class="nm">${c.id === 'x' ? X_ICON.replace('<svg', '<svg style="width:15px;height:15px"') : c.nm}</span></a>`).join('')}
    </nav>`;
  // mobile bar
  const mb = document.createElement('nav');
  mb.className = 'mbar'; mb.setAttribute('aria-label', 'Main');
  mb.innerHTML = CHANNELS.map((c) => `<a href="${c.href}"${c.ext ? ' target="_blank" rel="noopener"' : ''}${c.id === cur ? ' aria-current="page"' : ''}>${c.id === 'x' ? 'X' : c.nm}</a>`).join('');
  document.body.appendChild(mb);
  liveBlock();
  return el.querySelector('#dial');
}

async function liveBlock() {
  const blk = document.getElementById('blk');
  if (!blk) return;
  const tick = async () => {
    try {
      const r = await fetch(CFG.rpc || 'https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
      const j = await r.json();
      blk.textContent = '#' + parseInt(j.result, 16).toLocaleString('en-US');
      document.getElementById('led')?.classList.remove('off');
    } catch { blk.textContent = 'offline'; document.getElementById('led')?.classList.add('off'); }
  };
  tick();
  setInterval(tick, 6000);
}

export function mountFooter(el) {
  if (!el) return;
  const gh = CFG.github ? `<li><a href="${CFG.github}" target="_blank" rel="noopener">GitHub</a></li>` : '';
  el.innerHTML = `
    <div>
      <a class="brand" href="index.html">${MARK}<span class="word">Hoodwink</span></a>
      <p class="fine">Real or LARP? Token checks for Robinhood Chain: copied tickers, borrowed links, deployer track records, snipers and holders, and an AI verdict on the evidence. A report explains a token; it cannot promise that it is safe or that it will go up. Not affiliated with Robinhood Markets.</p>
    </div>
    <div><div class="label">Product</div><ul><li><a href="index.html#scan">Scan a token</a></li><li><a href="index.html#method">Method</a></li><li><a href="docs.html">Docs</a></li><li><a href="docs.html#checks">The 16 checks</a></li></ul></div>
    <div><div class="label">Project</div><ul><li><a href="token.html">${TICKER}</a></li><li><a href="${CFG.x || '#'}" target="_blank" rel="noopener">X / Twitter</a></li>${gh}<li><a href="docs.html#changelog">Changelog</a></li></ul></div>`;
}

export function reveal() {
  const els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
