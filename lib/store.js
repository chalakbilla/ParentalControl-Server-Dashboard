/**
 * Shared persistent store.
 * Supports in-memory caching, disk snapshot persistence (/tmp on serverless or local file).
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
