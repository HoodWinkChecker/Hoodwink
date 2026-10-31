// Tiny key/value cache: Netlify Blobs when deployed, a local folder when run by serve.mjs.
import fs from 'node:fs';
import path from 'node:path';

let store = null;
async function netlifyStore() {
  if (store !== null) return store;
  try {
    const { getStore } = await import('@netlify/blobs');
    store = getStore('hoodwink');
    await store.get('__probe__'); // throws outside a Netlify runtime
  } catch { store = false; }
  return store;
}
const DIR = path.join(process.cwd(), '.cache');

export async function cacheGet(key) {
  const s = await netlifyStore();
  try {
    if (s) { const v = await s.get(key, { type: 'json' }); return v ?? null; }
    const f = path.join(DIR, key.replace(/[^a-z0-9_.-]/gi, '_') + '.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  } catch { return null; }
}
export async function cacheSet(key, value) {
  const s = await netlifyStore();
  try {
    if (s) return await s.setJSON(key, value);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, key.replace(/[^a-z0-9_.-]/gi, '_') + '.json'), JSON.stringify(value));
  } catch { /* cache is best effort */ }
}
/** counts calls per UTC day; returns the new count */
export async function bumpDaily(name) {
  const key = `count-${name}-${new Date().toISOString().slice(0, 10)}`;
  const n = ((await cacheGet(key))?.n || 0) + 1;
  await cacheSet(key, { n });
  return n;
}
