const { getStore, saveStore, MAX_HISTORY } = require('../lib/store');
const { v4: uuidv4 } = require('uuid');

function checkAuth(req) {
  const token = process.env.API_TOKEN || '';
  if (!token) return true;
  const header = req.headers.authorization || '';
  const t = header.startsWith('Bearer ') ? header.slice(7) : '';
  return t === token;
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (!checkAuth(req)) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  const store = getStore();
  if (!store.reports) store.reports = [];

  const url = new URL(req.url, 'http://localhost');

  // GET /api/reports or /api/v1/reports
  if (req.method === 'GET') {
    const deviceId = (url.searchParams.get('deviceId') || '').trim();
    if (deviceId) {
      return send(res, 200, store.reports.filter((r) => r.deviceId === deviceId).slice(0, 50));
    }
    return send(res, 200, store.reports.slice(0, 50));
  }

  // POST /api/reports or /api/v1/reports
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    }
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
    }

    const { deviceId, subject, body: reportText, items, screenshotPath } = body || {};
    const reportEntry = {
      id: 'rep_' + uuidv4().replace(/-/g, '').slice(0, 10),
      deviceId: (deviceId || 'unknown').trim(),
      subject: subject || 'Parental Control Report',
      body: reportText || '',
      items: items || [],
      screenshotPath: screenshotPath || '',
      receivedAt: new Date().toISOString(),
    };

    store.reports.unshift(reportEntry);
    if (store.reports.length > MAX_HISTORY) store.reports.pop();

    const dev = store.devices.get(reportEntry.deviceId) || {};
    store.devices.set(reportEntry.deviceId, {
      ...dev,
      deviceId: reportEntry.deviceId,
      lastSeen: new Date().toISOString(),
      latestReport: reportEntry,
    });

    saveStore();
    return send(res, 201, { ok: true, reportId: reportEntry.id });
  }

  return send(res, 405, { error: 'Method not allowed' });
};
