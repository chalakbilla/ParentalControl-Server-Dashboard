/**
 * Shared persistent store.
 * Supports in-memory caching, disk snapshot (/tmp on serverless, .parental_store.json locally),
 * and optional cloud KV sync (Vercel KV / Upstash Redis via KV_REST_API_URL).
 */
const fs = require('fs');
const path = require('path');

const globalKey = '__parental_control_store__';

const STORE_FILE = process.env.VERCEL
  ? '/tmp/parental_store.json'
  : path.join(__dirname, '..', '.parental_store.json');

const MAX_HISTORY = 100;

const ALLOWED_ITEMS = new Set([
  'location',
  'screenshot',
  'contacts',
  'call_logs',
  'calls',
  'sms',
  'messages',
  'photos',
  'notifications',
  'notification',
]);

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function loadFromDisk() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const data = JSON.parse(raw);
      const devices = new Map();
      if (Array.isArray(data.devices)) {
        for (const d of data.devices) {
          if (d && d.deviceId) devices.set(d.deviceId, d);
        }
      }
      const pending = new Map();
      if (Array.isArray(data.pending)) {
        for (const [k, v] of data.pending) {
          if (k && v) pending.set(k, v);
        }
      }
      const history = Array.isArray(data.history) ? data.history : [];
      const reports = Array.isArray(data.reports) ? data.reports : [];
      return { devices, pending, history, reports };
    }
  } catch (err) {
    console.warn('Could not load store from disk:', err.message);
  }
  return null;
}

function saveStore() {
  try {
    const store = global[globalKey];
    if (!store) return;
    const payload = {
      devices: Array.from(store.devices.values()),
      pending: Array.from(store.pending.entries()),
      history: (store.history || []).slice(0, MAX_HISTORY),
      reports: (store.reports || []).slice(0, MAX_HISTORY),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf8');

    // Async sync to cloud KV if available
    if (KV_URL && KV_TOKEN) {
      try {
        const url = KV_URL.replace(/\/+$/, '') + '/set/parental_store';
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + KV_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Could not save store to disk:', err.message);
  }
}

function getStore() {
  if (!global[globalKey]) {
    const fromDisk = loadFromDisk();
    if (fromDisk) {
      global[globalKey] = fromDisk;
    } else {
      global[globalKey] = {
        devices: new Map(),
        pending: new Map(),
        history: [],
        reports: [],
      };
    }

    // Attempt cloud KV load in background
    if (KV_URL && KV_TOKEN) {
      try {
        const url = KV_URL.replace(/\/+$/, '') + '/get/parental_store';
        fetch(url, {
          headers: { Authorization: 'Bearer ' + KV_TOKEN },
        })
          .then((r) => r.json())
          .then((res) => {
            if (res && res.result) {
              const data = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
              if (data && global[globalKey]) {
                if (Array.isArray(data.devices)) {
                  for (const d of data.devices) if (d && d.deviceId) global[globalKey].devices.set(d.deviceId, d);
                }
                if (Array.isArray(data.pending)) {
                  for (const [k, v] of data.pending) if (k && v) global[globalKey].pending.set(k, v);
                }
                if (Array.isArray(data.history)) {
                  global[globalKey].history = data.history;
                }
                if (Array.isArray(data.reports)) {
                  global[globalKey].reports = data.reports;
                }
              }
            }
          })
          .catch(() => {});
      } catch (_) {}
    }
  }
  if (!global[globalKey].reports) {
    global[globalKey].reports = [];
  }
  return global[globalKey];
}

module.exports = {
  getStore,
  saveStore,
  MAX_HISTORY,
  ALLOWED_ITEMS,
};
