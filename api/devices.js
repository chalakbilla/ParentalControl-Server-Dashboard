const { getStore } = require('../lib/store');

function checkAuth(req) {
  const token = process.env.API_TOKEN || '';
  if (!token) return true;
  const header = req.headers.authorization || '';
  const t = header.startsWith('Bearer ') ? header.slice(7) : '';
  return t === token;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  if (!checkAuth(req)) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const store = getStore();
  const list = Array.from(store.devices.values()).sort((a, b) => {
    const ta = a.lastSeen || a.createdAt || '';
    const tb = b.lastSeen || b.createdAt || '';
    return tb.localeCompare(ta);
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(list));
};
