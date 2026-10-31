// node tools/scan.mjs <address> [--json out.json]   Runs the exact engine the site runs.
// Link checks and the AI verdict call the same functions the server runs (reads .env for ANTHROPIC_API_KEY).
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { investigate } = await import('../site/assets/js/engine.js');
const { gather } = await import('../netlify/functions/reality.mjs');
const { judge } = await import('../netlify/lib/judge.mjs');
const tailFn = (await import('../netlify/functions/tickers-tail.mjs')).default;

const addr = process.argv[2];
const out = process.argv.indexOf('--json') > 0 ? process.argv[process.argv.indexOf('--json') + 1] : null;
const ICON = { pass: 'PASS', concern: 'WARN', critical: 'CRIT', info: 'INFO', unchecked: '----', na: ' n/a' };
const rep = await investigate(addr, {
  onStage: (s, p) => process.stderr.write(`\r${s}${p ? ' ' + Math.round(p.p * 100) + '% (' + p.n + ')' : ''}            `),
  reality: (t) => gather(t),
  tickersTail: async (shard) => (await tailFn(new Request('http://local/api/tickers-tail?shard=' + shard))).json(),
  verdict: async (t) => { const j = await judge(t); if (!j.verdict) throw new Error(j.error); return j; },
});
process.stderr.write('\n');
console.log(`${rep.name} (${rep.symbol})  kind=${rep.kind}  coverage=${rep.coverage}%  ${JSON.stringify(rep.counts)}  ${rep.meta.ms}ms ${rep.meta.rpcCalls} calls ${rep.meta.transfers} transfers`);
for (const c of rep.checks) console.log(`${ICON[c.status]}  ${c.id.padEnd(13)} ${c.summary}`);
if (out) fs.writeFileSync(out, JSON.stringify(rep, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
