// Scheduled every hour: appends new Pons launches to the ticker tail (see tickers-tail.mjs).
import { updateTail } from './tickers-tail.mjs';
export default async () => {
  try { const r = await updateTail(); console.log('tickers tail', JSON.stringify(r)); }
  catch (e) { console.error('tickers tail failed', e.message); }
};
export const config = { schedule: '@hourly' };
