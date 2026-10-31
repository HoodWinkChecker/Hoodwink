// The instrument: a token's real runtime bytecode drawn as a ring of bars, swept by an ultraviolet beam.
// Where the beam passes, function selectors found in the bytecode light up with their names.
// The inner ring holds the checks, coloured as they settle. Canvas 2D, no dependency.

const COLORS = {
  pass: '#8fdcb9', info: '#9db8ff', concern: '#f2b54f', critical: '#ff6464',
  unchecked: '#5c6068', na: '#2c3038', pending: '#2c3038', uv: '#cdf731', ink: '#ecebe6', mute: '#7d8088', line: '#1f2228',
};
// names the beam can reveal (selector -> signature)
export const KNOWN_SELECTORS = {
  '0xa9059cbb': 'transfer(address,uint256)', '0x095ea7b3': 'approve(address,uint256)', '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0x70a08231': 'balanceOf(address)', '0x18160ddd': 'totalSupply()', '0xdd62ed3e': 'allowance(address,address)', '0x06fdde03': 'name()',
  '0x95d89b41': 'symbol()', '0x313ce567': 'decimals()', '0x8da5cb5b': 'owner()', '0x715018a6': 'renounceOwnership()', '0xf2fde38b': 'transferOwnership(address)',
  '0x40c10f19': 'mint(address,uint256)', '0x8456cb59': 'pause()', '0x3f4ba83a': 'unpause()', '0x5c60da1b': 'implementation()', '0x3659cfe6': 'upgradeTo(address)',
  '0x4f1ef286': 'upgradeToAndCall(address,bytes)', '0x42966c68': 'burn(uint256)', '0x79cc6790': 'burnFrom(address,uint256)', '0xd505accf': 'permit(...)',
  '0x7ecebe00': 'nonces(address)', '0x3644e515': 'DOMAIN_SEPARATOR()', '0xf9f92be4': 'blacklist(address)', '0x8a8c523c': 'enableTrading()', '0xc9567bf9': 'openTrading()',
  '0x437823ec': 'excludeFromFee(address)', '0xec28438a': 'setMaxTxAmount(uint256)', '0x69fe0e2d': 'setFee(uint256)', '0x1e89d545': 'setBots(address[],bool)',
};
const OPN = { 0x00: 'STOP', 0x01: 'ADD', 0x02: 'MUL', 0x03: 'SUB', 0x04: 'DIV', 0x10: 'LT', 0x11: 'GT', 0x14: 'EQ', 0x15: 'ISZERO', 0x16: 'AND', 0x17: 'OR', 0x1b: 'SHL', 0x1c: 'SHR', 0x20: 'KECCAK256', 0x30: 'ADDRESS', 0x31: 'BALANCE', 0x33: 'CALLER', 0x34: 'CALLVALUE', 0x35: 'CALLDATALOAD', 0x36: 'CALLDATASIZE', 0x39: 'CODECOPY', 0x3d: 'RETURNDATASIZE', 0x3e: 'RETURNDATACOPY', 0x50: 'POP', 0x51: 'MLOAD', 0x52: 'MSTORE', 0x54: 'SLOAD', 0x55: 'SSTORE', 0x56: 'JUMP', 0x57: 'JUMPI', 0x5b: 'JUMPDEST', 0x5f: 'PUSH0', 0x80: 'DUP1', 0x81: 'DUP2', 0x90: 'SWAP1', 0x91: 'SWAP2', 0xa1: 'LOG1', 0xa3: 'LOG3', 0xf1: 'CALL', 0xf3: 'RETURN', 0xf4: 'DELEGATECALL', 0xfa: 'STATICCALL', 0xfd: 'REVERT', 0xfe: 'INVALID' };
const opName = (op) => (op >= 0x60 && op <= 0x7f ? 'PUSH' + (op - 0x5f) : op >= 0x80 && op <= 0x8f ? 'DUP' + (op - 0x7f) : op >= 0x90 && op <= 0x9f ? 'SWAP' + (op - 0x8f) : OPN[op] || '0x' + op.toString(16).padStart(2, '0'));

export function createDial(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BINS = 540;
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0;
  let bytes = new Uint8Array(0);
  let bins = new Float32Array(BINS);     // average byte value per bin
  let kind = new Uint8Array(BINS);       // 0 code, 1 selector, 2 flagged selector, 3 metadata
  let labels = [];                       // { bin, text, sev }
  const phos = new Float32Array(BINS);   // phosphor glow per bin
  let checks = [];                       // { id, group, status }
  let groups = [];
  let center = { big: '', small: '' };
  let mode = 'idle';
  let angle = -Math.PI / 2;
  let hover = null;
  let codeLen = 0;
  let alive = true;
  let lastT = performance.now();
  const shown = new Map(); // label -> alpha

  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    cx = W / 2; cy = H / 2;
    R = Math.min(W, H) * (Math.min(W, H) < 480 ? 0.38 : 0.44);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  function setCode(hex, flagged = []) {
    const h = (hex || '').replace(/^0x/, '');
    bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
    codeLen = bytes.length;
    bins = new Float32Array(BINS); kind = new Uint8Array(BINS); labels = []; shown.clear();
    if (!codeLen) return;
    const per = codeLen / BINS;
    for (let b = 0; b < BINS; b++) {
      let s = 0, n = 0;
      for (let i = Math.floor(b * per); i < Math.max(Math.floor(b * per) + 1, Math.floor((b + 1) * per)) && i < codeLen; i++) { s += bytes[i]; n++; }
      bins[b] = n ? s / n / 255 : 0;
    }
    // walk opcodes, find PUSH4 selectors
    const flag = new Map(flagged.map((f) => [f.sel, f]));
    const seen = new Set();
    for (let i = 0; i < codeLen; i++) {
      const op = bytes[i];
      if (op === 0x63 && i + 4 < codeLen) {
        const sel = '0x' + [...bytes.slice(i + 1, i + 5)].map((x) => x.toString(16).padStart(2, '0')).join('');
        const b = Math.min(BINS - 1, Math.floor(i / per));
        const f = flag.get(sel);
        if (f) { kind[b] = 2; if (!seen.has(sel)) labels.push({ bin: b, text: f.label || KNOWN_SELECTORS[sel] || sel, sev: f.sev || 'critical' }); }
        else if (KNOWN_SELECTORS[sel]) { if (kind[b] < 1) kind[b] = 1; if (!seen.has(sel)) labels.push({ bin: b, text: KNOWN_SELECTORS[sel], sev: 'uv' }); }
        seen.add(sel);
      }
      if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
    }
    // solidity metadata tail (a264...) marked dim
    const tail = h.lastIndexOf('a264');
    if (tail > 0) for (let b = Math.floor(tail / 2 / per); b < BINS; b++) kind[b] = Math.max(kind[b], 3) === 3 ? 3 : kind[b];
    // keep labels spread out: drop a label too close to the previous one
    labels.sort((a, b) => a.bin - b.bin);
    const spaced = [];
    for (const l of labels) if (!spaced.length || l.bin - spaced[spaced.length - 1].bin > 18 || l.sev !== 'uv') spaced.push(l);
    labels = spaced;
  }
  function setChecks(list, groupList) { checks = list.map((c) => ({ id: c.id, group: c.group, status: c.status || 'pending' })); groups = groupList || groups; }
  function setStatus(id, status) { const c = checks.find((x) => x.id === id); if (c) { c.status = status; c.flash = 1; } }
  function setCenter(big, small) { center = { big: String(big), small: small || '' }; }
  function setMode(m) { mode = m; }

  // pointer: hovering the byte ring reads the byte under it
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left - cx, y = e.clientY - r.top - cy;
    const d = Math.hypot(x, y);
    if (d > R * 0.64 && d < R * 0.95 && codeLen) {
      let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
      const b = Math.floor((a / (Math.PI * 2)) * BINS) % BINS;
      const off = Math.floor((b / BINS) * codeLen);
      hover = { b, off, x: e.clientX - r.left, y: e.clientY - r.top };
      opts.onHover && opts.onHover({ offset: off, op: opName(bytes[off]), byte: bytes[off] });
    } else if (hover) { hover = null; opts.onHover && opts.onHover(null); }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; opts.onHover && opts.onHover(null); });

  function frame(t) {
    if (!alive) return;
    const dt = Math.min(64, t - lastT); lastT = t;
    const speed = mode === 'scan' ? 2.6 : mode === 'done' ? 0.55 : 0.9; // radians per second
    if (!reduced) angle += speed * dt / 1000;
    draw(t, dt);
    requestAnimationFrame(frame);
  }

  function draw(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const TAU = Math.PI * 2;
    const beamA = ((angle + Math.PI / 2) % TAU + TAU) % TAU; // 0 at top, clockwise
    const r1 = R * 0.66, r2 = R * 0.93;

    // ---- outer graduation
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.0, 0, TAU); ctx.stroke();
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * TAU - Math.PI / 2;
      const major = i % 15 === 0;
      const l = major ? 9 : 4;
      ctx.strokeStyle = major ? '#3a3e47' : '#23262d';
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 1.0, Math.sin(a) * R * 1.0); ctx.lineTo(Math.cos(a) * (R * 1.0 + l), Math.sin(a) * (R * 1.0 + l)); ctx.stroke();
    }
    ctx.font = `9px Martian, monospace`; ctx.fillStyle = '#4b4f57'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU - Math.PI / 2;
      const off = codeLen ? '0x' + Math.floor((i / 12) * codeLen).toString(16).padStart(4, '0') : String(i * 30).padStart(3, '0');
      ctx.fillText(off, Math.cos(a) * (R * 1.0 + 22), Math.sin(a) * (R * 1.0 + 22));
    }

    // ---- beam (soft wedge trailing behind the leading edge)
    const trail = 0.9;
    const g = ctx.createConicGradient ? ctx.createConicGradient(angle - trail, 0, 0) : null;
    if (g) {
      const f = trail / TAU;
      g.addColorStop(0, 'rgba(205,247,49,0)');
      g.addColorStop(f * 0.85, 'rgba(205,247,49,0.10)');
      g.addColorStop(f, 'rgba(226,255,122,0.30)');
      g.addColorStop(Math.min(1, f + 0.002), 'rgba(205,247,49,0)');
      g.addColorStop(1, 'rgba(205,247,49,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r2 + 4, 0, TAU); ctx.arc(0, 0, R * 0.5, 0, TAU, true); ctx.fill('evenodd');
    }
    // leading edge line
    ctx.strokeStyle = 'rgba(226,255,122,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.cos(angle) * R * 0.5, Math.sin(angle) * R * 0.5); ctx.lineTo(Math.cos(angle) * (R * 1.0), Math.sin(angle) * (R * 1.0)); ctx.stroke();

    // ---- bytecode ring
    const decay = Math.pow(0.4, dt / 1000);
    const lead = Math.floor((beamA / TAU) * BINS);
    for (let k = -3; k <= 0; k++) { const b = (lead + k + BINS) % BINS; phos[b] = 1; }
    const bw = (TAU / BINS) * 0.62;
    for (let b = 0; b < BINS; b++) {
      phos[b] *= decay;
      const a = (b / BINS) * TAU - Math.PI / 2;
      const v = codeLen ? bins[b] : 0.08 + 0.05 * Math.sin(b * 0.7 + t / 900);
      const len = (r2 - r1) * (0.1 + 0.9 * v);
      const p = reduced ? 0.4 : phos[b];
      let col;
      if (kind[b] === 2) col = `rgba(255,100,100,${0.55 + 0.45 * p})`;
      else if (kind[b] === 1) col = `rgba(205,247,49,${0.35 + 0.65 * p})`;
      else if (kind[b] === 3) col = `rgba(125,128,136,${0.10 + 0.25 * p})`;
      else col = `rgba(236,235,230,${0.10 + 0.62 * p})`;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, r1 * bw);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * (r1 + len), Math.sin(a) * (r1 + len)); ctx.stroke();
    }
    ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r1 - 3, 0, TAU); ctx.stroke();

    // ---- revealed selector labels
    ctx.font = `10px Martian, monospace`;
    for (const l of (R < 170 ? labels.filter((x) => x.sev !== 'uv') : labels)) {
      const p = reduced ? 1 : phos[l.bin];
      const prev = shown.get(l) || 0;
      const alpha = Math.max(p, prev * Math.pow(0.55, dt / 1000));
      shown.set(l, alpha);
      if (alpha < 0.03) continue;
      const a = (l.bin / BINS) * TAU - Math.PI / 2;
      const x0 = Math.cos(a) * (r2 + 2), y0 = Math.sin(a) * (r2 + 2);
      const x1 = Math.cos(a) * (R * 1.06), y1 = Math.sin(a) * (R * 1.06);
      const right = Math.cos(a) >= 0;
      const x2 = x1 + (right ? 16 : -16);
      const c = l.sev === 'uv' ? '205,247,49' : l.sev === 'concern' ? '242,181,79' : '255,100,100';
      ctx.strokeStyle = `rgba(${c},${alpha * 0.8})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
      ctx.fillStyle = `rgba(${c},${alpha})`;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillText(l.text, x2 + (right ? 5 : -5), y1);
    }

    // ---- check ring
    const rc = R * 0.555, th = Math.max(6, R * 0.035);
    if (checks.length) {
      const gIds = [...new Set(checks.map((c) => c.group))];
      const gap = 0.07; // radians between groups
      const per = (TAU - gap * gIds.length) / checks.length;
      let a = -Math.PI / 2 + gap / 2;
      let gi = -1, lastG = null;
      for (const c of checks) {
        if (c.group !== lastG) { if (lastG !== null) a += gap; lastG = c.group; gi++; }
        const a0 = a + 0.012, a1 = a + per - 0.012;
        let col = COLORS[c.status] || COLORS.pending;
        let alpha = 1;
        if (c.status === 'pending') { col = mode === 'scan' ? COLORS.uv : '#2c3038'; alpha = mode === 'scan' ? 0.35 + 0.35 * Math.sin(t / 160 + gi) : 1; }
        if (c.flash) { c.flash = Math.max(0, c.flash - dt / 600); }
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = col; ctx.lineWidth = th + (c.flash || 0) * 4;
        if (c.status === 'unchecked' || c.status === 'na') { ctx.setLineDash([2, 3]); ctx.lineWidth = th * 0.6; }
        ctx.beginPath(); ctx.arc(0, 0, rc, a0, a1); ctx.stroke();
        ctx.setLineDash([]);
        if (c.status === 'critical') { ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t / 300); ctx.lineWidth = th + 8; ctx.beginPath(); ctx.arc(0, 0, rc, a0, a1); ctx.stroke(); }
        ctx.globalAlpha = 1;
        a += per;
      }
      // group labels just inside the ring
      ctx.font = `8.5px Martian, monospace`; ctx.fillStyle = '#5c6068'; ctx.textAlign = 'center';
      let aa = -Math.PI / 2 + gap / 2, idx = 0;
      for (const gid of (R < 170 ? [] : gIds)) {
        const n = checks.filter((c) => c.group === gid).length;
        const mid = aa + (per * n) / 2;
        const SHORT = { identity: 'IDENTITY', reality: 'REALITY', launch: 'LAUNCH', holders: 'HOLDERS', dev: 'DEV', market: 'MARKET', control: 'CONTROL' };
        const name = SHORT[gid] || gid.toUpperCase();
        ctx.textBaseline = 'middle';
        ctx.fillText(name, Math.cos(mid) * (rc - th - 30), Math.sin(mid) * (rc - th - 30));
        aa += per * n + gap; idx++;
      }
    }

    // ---- core
    ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#16181c';
    ctx.beginPath(); ctx.moveTo(-R * 0.42, 0); ctx.lineTo(R * 0.42, 0); ctx.moveTo(0, -R * 0.42); ctx.lineTo(0, R * 0.42); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const bigSize = Math.round(R * (center.big.length > 4 ? 0.17 : 0.24));
    ctx.font = `800 ${bigSize}px Mona, sans-serif`;
    try { ctx.fontStretch = 'expanded'; } catch { /* older canvases */ }
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(center.big, 0, bigSize * 0.32);
    ctx.font = `9.5px Martian, monospace`; ctx.fillStyle = COLORS.mute;
    ctx.fillText(center.small.toUpperCase(), 0, bigSize * 0.32 + 22);
    ctx.restore();

    // ---- hover readout
    if (hover && codeLen) {
      const a = (hover.b / BINS) * TAU - Math.PI / 2;
      ctx.save(); ctx.translate(cx, cy);
      ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke();
      ctx.restore();
    }
  }
  if (!opts.manual) requestAnimationFrame(frame);
  // manual mode (video rendering): draw the state at time t seconds, beam at a given speed
  let lastManual = null;
  function renderAt(tSec, spd = 1.6) {
    const dt = lastManual === null ? 33 : Math.max(1, (tSec - lastManual) * 1000);
    lastManual = tSec;
    angle = -Math.PI / 2 + spd * tSec;
    draw(tSec * 1000, dt);
  }
  return { renderAt, setCode, setChecks, setStatus, setCenter, setMode, destroy() { alive = false; ro.disconnect(); }, get codeLen() { return codeLen; } };
}
