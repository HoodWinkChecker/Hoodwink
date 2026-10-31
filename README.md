# Hoodwink

Real or LARP? Token checks for Robinhood Chain (chain id 4663). Paste a token and get:

- ticker uniqueness against every Pons launch (original or copy #n)
- the website, X and GitHub links typed at launch, each one opened and checked (dead link, shortener, post by someone else, empty repo…)
- an AI verdict written from that evidence: real product, honest meme or LARP
- snipers in the launch block and the first 30 seconds, and whether they still hold
- top 10 holders (exact balances) and linked wallets
- the deployer's track record: earlier Pons launches, how many graduated, how many they dumped and how fast
- liquidity, and one line for the contract (on Pons the template fixes it; verified anyway)

## Run it

Double-click `launch.bat`, or `node serve.mjs 6912`, then open http://localhost:6912.
The AI key lives in `netlify/lib/secrets.mjs` (server-only, git-ignored) and `.env`; it is bundled into the functions when deploying from this folder. Everything else works without a key.
First time only: `npm install` (server dependencies for the AI call and the cache).

## Layout

```
site/                       static site (publish this folder)
  index.html scan.html docs.html token.html 404.html
  config.js                 X account, GitHub link, $WINK address, RPC
  assets/js/engine.js       the investigation engine (browser and Node)
  assets/js/meta.js         launch metadata decoder (shared with the server)
  data/tickers/             ticker index of every Pons launch (tools/build-index.mjs)
  data/devs.json            optional known deployers (label, tone, source)
  data/cases/               saved reports shown on the landing page
netlify/functions/          /api/reality, /api/verdict (AI), /api/tickers-tail + hourly tickers-update
netlify/lib/                safe fetcher (SSRF guard), X and GitHub probes, cache
contracts/src/Probe.sol     simulation contract injected by state override, never deployed
tools/                      scan.mjs (CLI), build-index.mjs, pairs.mjs, find-cases.mjs, export-probe.mjs
promo-src/ promo/ launch/   film sources, rendered film, intro tweet
brand/                      logo pack: avatar, Pons logo, X banner, horizontal logos, SVG mark
```

## Commands

```
node tools/scan.mjs <address> [--json out.json]     # full scan from a terminal (uses .env for the AI)
node tools/build-index.mjs --update                 # fold the hourly tail into the static index (occasionally, then redeploy)
cd contracts && forge build && cd .. && node tools/export-probe.mjs
python promo-src/make-music.py && node promo-src/make-film.mjs
```

## Deploy (Netlify)

`netlify.toml` is ready: publish `site/`, functions in `netlify/functions/`, cache in Netlify Blobs.
Deploy from this folder (Netlify CLI or a linked folder) so `netlify/lib/secrets.mjs` is bundled. If you deploy from a Git repository instead, the secrets file is not in it: set `ANTHROPIC_API_KEY` in the site's environment variables. Optional: `GITHUB_TOKEN`, `VERDICTS_PER_DAY`.

## Before publishing

- `site/config.js`: `$WINK` address once launched. Site: https://www.hoodwink.site · X: https://x.com/CheckHoodWink · Code: https://github.com/HoodWinkChecker/Hoodwink
