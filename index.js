/**
 * Local dev server (Express).
 * On Vercel, serverless handlers in /api are used instead.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getStore, saveStore, MAX_HISTORY, ALLOWED_ITEMS } = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function checkAuth(req, res, next) {
  if (!API_TOKEN) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== API_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function handleGetCommands(req, res) {
  const store = getStore();
  const deviceId = (req.query.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

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
    return res.status(204).end();
  }

  store.pending.delete(deviceId);
  cmd.deliveredAt = new Date().toISOString();
  cmd.status = 'delivered';
  saveStore();

  res.json({ id: cmd.id, items: cmd.items, emailTo: cmd.emailTo });
}

function handleAckCommand(req, res) {
  const store = getStore();
  const { id } = req.params;
  const { status = 'done', message = '' } = req.body || {};
  const entry = store.history.find((h) => h.id === id);
  if (entry) {
    entry.status = status;
    entry.ackMessage = message;
    entry.ackedAt = new Date().toISOString();
    saveStore();
  }
  res.json({ ok: true });
}

function handleCreateCommand(req, res) {
  const store = getStore();
  const { deviceId, items, emailTo } = req.body || {};
  const to = (emailTo || 'ankitraj01567@gmail.com').trim();

  if (!deviceId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'deviceId and non-empty items[] required' });
  }

  const cleanItems = items
    .map((i) => String(i).toLowerCase().trim())
    .filter((i) => ALLOWED_ITEMS.has(i));

  if (!cleanItems.length) {
    return res.status(400).json({ error: 'No valid items' });
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

  res.status(201).json(command);
}

function handleGetDevices(req, res) {
  const store = getStore();
  const list = Array.from(store.devices.values()).sort((a, b) => {
    const ta = a.lastSeen || a.createdAt || '';
    const tb = b.lastSeen || b.createdAt || '';
    return tb.localeCompare(ta);
  });
  res.json(list);
}

// Support both /api/v1 and /api routes
app.get('/api/v1/commands', checkAuth, handleGetCommands);
app.get('/api/commands', checkAuth, handleGetCommands);

app.post('/api/v1/commands/:id/ack', checkAuth, handleAckCommand);
app.post('/api/commands/:id/ack', checkAuth, handleAckCommand);

app.post('/api/v1/commands', checkAuth, handleCreateCommand);
app.post('/api/commands', checkAuth, handleCreateCommand);

app.get('/api/v1/devices', checkAuth, handleGetDevices);
app.get('/api/devices', checkAuth, handleGetDevices);

app.get('/api/v1/commands/history', checkAuth, (req, res) => {
  res.json(getStore().history.slice(0, 50));
});
app.get('/api/commands/history', checkAuth, (req, res) => {
  res.json(getStore().history.slice(0, 50));
});

app.get('/api/v1/commands/pending', checkAuth, (req, res) => {
  res.json(Array.from(getStore().pending.values()));
});
app.get('/api/commands/pending', checkAuth, (req, res) => {
  res.json(Array.from(getStore().pending.values()));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Dashboard  http://localhost:' + PORT);
  console.log('API        http://localhost:' + PORT + '/api/v1');
});
