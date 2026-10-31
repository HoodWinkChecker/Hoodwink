// After `forge build` in contracts/: writes the probe's runtime bytecode and ABI to site/assets/js/probe-code.js
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(new URL('../contracts/out/Probe.sol/Probe.json', import.meta.url)));
fs.writeFileSync(new URL('../site/assets/js/probe-code.js', import.meta.url),
  "// Runtime bytecode of contracts/src/Probe.sol (forge build, solc 0.8.26, optimizer 200). Injected by eth_call state override, never deployed.\n" +
  `export const PROBE_CODE = '${p.deployedBytecode.object}';\nexport const PROBE_ABI = ${JSON.stringify(p.abi.filter((x) => x.type === 'function'))};\n`);
fs.copyFileSync(new URL('../contracts/src/Probe.sol', import.meta.url), new URL('../site/contracts/Probe.sol', import.meta.url));
console.log('probe exported:', p.deployedBytecode.object.length / 2 - 1, 'bytes');
