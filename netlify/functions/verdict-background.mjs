// Background function (Netlify runs *-background functions for up to 15 minutes and answers 202 at once).
// Computes the verdict and stores it in the cache, where /api/verdict picks it up.
import { judge } from '../lib/judge.mjs';
export default async (req) => {
  const token = (new URL(req.url).searchParams.get('token') || '').trim().toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(token)) await judge(token);
};
