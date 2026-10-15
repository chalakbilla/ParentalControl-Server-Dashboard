/**
 * Shared in-memory store.
 * Works for local `node index.js` and warm Vercel serverless instances.
 * For production on Vercel, swap this for Redis / Vercel KV / a database.
 */

const globalKey = '__parental_control_store__';

function getStore() {
  if (!global[globalKey]) {
    global[globalKey] = {
      devices: new Map(),
      pending: new Map(),
      history: [],
    };
  }
  return global[globalKey];
}

const MAX_HISTORY = 100;

const ALLOWED_ITEMS = new Set([
  'location',
  'screenshot',
  'contacts',
  'call_logs',
  'sms',
  'photos',
]);

module.exports = {
  getStore,
  MAX_HISTORY,
  ALLOWED_ITEMS,
};
