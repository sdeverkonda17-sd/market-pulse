/*
 * Market Pulse gateway
 *
 * A read-only AWS service. Sharekhan credentials, request tokens and access
 * tokens stay on this server; they are never returned to the dashboard.
 */
const http = require('node:http');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { handler: marketHandler } = require('../netlify/functions/market');

const PORT = Number(process.env.PORT || 8787);
const SHAREKHAN_API = 'https://api.sharekhan.com/skapi';
const SHAREKHAN_LOGIN = `${SHAREKHAN_API}/auth/login.html`;
const SHAREKHAN_SESSION_FILE = process.env.SHAREKHAN_SESSION_FILE || path.join(__dirname, '..', 'runtime', 'sharekhan-session.json');
const NIFTY50 = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJFINANCE',
  'BEL', 'BHARTIARTL', 'BRITANNIA', 'CIPLA', 'COALINDIA', 'DIVISLAB', 'DRREDDY', 'EICHERMOT', 'GRASIM', 'HCLTECH',
  'HDFCBANK', 'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDUSINDBK', 'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL',
  'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SBIN',
  'SHRIRAMFIN', 'SUNPHARMA', 'TATACONSUM', 'TATASTEEL', 'TATAMOTORS', 'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO'
];
const allowedOrigins = new Set(
  String(process.env.DASHBOARD_ORIGINS || 'https://market-pulse-sd.netlify.app')
    .split(',').map(value => value.trim()).filter(Boolean)
);
const recentRequests = new Map();
const pendingStates = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 90;
let sessionCache = null;
let scripMasterCache = null;
let scripMasterCachedAt = 0;
let leadersCache = null;
let leadersCachedAt = 0;
const stockCache = new Map();

function configured() {
  return Boolean(process.env.SHAREKHAN_API_KEY && process.env.SHAREKHAN_SECURE_KEY);
}

function setSecurityHeaders(response, origin) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendPage(response, statusCode, title, message) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><main><h1>${escape(title)}</h1><p>${escape(message)}</p><p>You can close this page and return to Market Pulse.</p></main><style>body{margin:0;background:#f4f7f5;color:#14241e;font:16px system-ui,sans-serif}main{max-width:560px;margin:14vh auto;padding:28px;background:#fff;border:1px solid #dbe5df;border-radius:14px}h1{margin-top:0;color:#13795b}</style>`);
}

function withinRateLimit(request) {
  const key = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const entry = recentRequests.get(key) || { started: now, count: 0 };
  if (now - entry.started >= RATE_WINDOW_MS) { entry.started = now; entry.count = 0; }
  entry.count += 1;
  recentRequests.set(key, entry);
  if (recentRequests.size > 2_000) for (const [ip, row] of recentRequests) if (now - row.started >= RATE_WINDOW_MS) recentRequests.delete(ip);
  return entry.count <= RATE_LIMIT;
}

function readSession() {
  if (sessionCache) return sessionCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(SHAREKHAN_SESSION_FILE, 'utf8'));
    if (parsed?.accessToken) sessionCache = parsed;
  } catch { /* A Sharekhan session is optional until its owner connects it. */ }
  return sessionCache;
}

function saveSession(accessToken) {
  const directory = path.dirname(SHAREKHAN_SESSION_FILE);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const data = JSON.stringify({ accessToken, connectedAt: new Date().toISOString() });
  const temporary = `${SHAREKHAN_SESSION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, SHAREKHAN_SESSION_FILE);
  sessionCache = JSON.parse(data);
}

function sharekhanSession() {
  return configured() ? readSession() : null;
}

function tokenKey() {
  const key = Buffer.from(String(process.env.SHAREKHAN_SECURE_KEY || ''), 'utf8');
  if (key.length !== 32) throw new Error('Sharekhan Secure Key must contain exactly 32 UTF-8 bytes.');
  return key;
}

function decryptRequestToken(value) {
  const encoded = decodeURIComponent(String(value || '')).replace(/-/g, '+').replace(/_/g, '/');
  const encrypted = Buffer.from(encoded, 'base64');
  if (encrypted.length <= 16) throw new Error('Sharekhan returned an invalid request token.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.alloc(16));
  decipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8');
}

function encryptRequestToken(value) {
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), Buffer.alloc(16));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return encrypted.toString('base64');
}

function findAccessToken(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['accessToken', 'access_token', 'token']) {
    if (typeof value[key] === 'string' && value[key].length > 20) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const token = findAccessToken(child);
      if (token) return token;
    }
  }
  return null;
}

async function exchangeForAccessToken(requestToken, state) {
  const unpacked = decryptRequestToken(requestToken).split('|');
  if (unpacked.length < 2) throw new Error('The Sharekhan request token did not contain a valid session pair.');
  const response = await fetch(`${SHAREKHAN_API}/services/access/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.SHAREKHAN_API_KEY,
      requestToken: encryptRequestToken(`${unpacked[1]}|${unpacked[0]}`),
      vendorKey: process.env.SHAREKHAN_VENDOR_KEY || null,
      state
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Sharekhan access-token request returned ${response.status}.`);
  const accessToken = findAccessToken(payload);
  if (!accessToken) throw new Error('Sharekhan did not return an access token.');
  saveSession(accessToken);
}

async function sharekhanFetch(pathname) {
  const session = sharekhanSession();
  if (!session?.accessToken) throw new Error('Sharekhan is not connected.');
  const response = await fetch(`${SHAREKHAN_API}${pathname}`, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.SHAREKHAN_API_KEY,
      'access-token': session.accessToken,
      ...(process.env.SHAREKHAN_VENDOR_KEY ? { 'vendor-key': process.env.SHAREKHAN_VENDOR_KEY } : {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Sharekhan returned ${response.status}.`);
  if (Number(payload?.status) >= 400) throw new Error(payload?.message || 'Sharekhan rejected the request.');
  return payload;
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === 'number') return new Date(value < 20_000_000_000 ? value * 1000 : value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function itemValue(item, keys) {
  for (const key of keys) if (item?.[key] != null) return item[key];
  return undefined;
}

function historicalRows(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.data?.candles) ? payload.data.candles : []);
  const rows = entries.map(item => {
    const array = Array.isArray(item) ? item : null;
    const date = toDate(array ? array[0] : itemValue(item, ['date', 'time', 'timestamp', 'tradeDate', 'datetime']));
    const open = number(array ? array[1] : itemValue(item, ['open', 'openPrice', 'o']));
    const high = number(array ? array[2] : itemValue(item, ['high', 'highPrice', 'h']));
    const low = number(array ? array[3] : itemValue(item, ['low', 'lowPrice', 'l']));
    const close = number(array ? array[4] : itemValue(item, ['close', 'closePrice', 'ltp', 'lastPrice', 'c']));
    const volume = number(array ? array[5] : itemValue(item, ['volume', 'totalTradedVolume', 'v']));
    return date && close > 0 ? { date: date.toISOString().slice(0, 10), open, high: high || close, low: low || close, close, volume } : null;
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) throw new Error('Sharekhan returned insufficient daily price history.');
  return rows;
}

async function scripMaster() {
  if (scripMasterCache && Date.now() - scripMasterCachedAt < 15 * 60 * 1000) return scripMasterCache;
  const payload = await sharekhanFetch('/services/master/NC');
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (!rows.length) throw new Error('Sharekhan ScripMaster returned no active NSE cash scripts.');
  scripMasterCache = rows;
  scripMasterCachedAt = Date.now();
  return rows;
}

async function sharekhanStock(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  const master = await scripMaster();
  const script = master.find(item => String(item.tradingSymbol || '').toUpperCase() === normalized);
  if (!script?.scripCode) throw new Error(`${normalized} was not found in Sharekhan's active NSE ScripMaster.`);
  const cached = stockCache.get(normalized);
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;
  const history = historicalRows(await sharekhanFetch(`/services/historical/NC/${encodeURIComponent(script.scripCode)}/daily`));
  const latest = history.at(-1);
  const previous = history.at(-2);
  const prices = history.map(row => row.close);
  const data = {
    stock: {
      symbol: normalized,
      name: script.companyName || script.tradingSymbol || normalized,
      lastPrice: latest.close,
      pChange: previous.close ? (latest.close - previous.close) / previous.close * 100 : 0,
      dayHigh: latest.high,
      dayLow: latest.low,
      yearHigh: Math.max(...prices),
      yearLow: Math.min(...prices),
      volume: latest.volume,
      dataSource: 'Sharekhan authorised API'
    },
    history: history.map(({ date, close }) => ({ date, close })),
    announcements: [],
    source: 'Sharekhan authorised API',
    providerNotice: 'Daily Sharekhan historical data. Intraday live streaming is not enabled in this read-only dashboard.'
  };
  stockCache.set(normalized, { at: Date.now(), data });
  return data;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (index < items.length) {
      const current = index++;
      try { results[current] = await mapper(items[current]); } catch { results[current] = null; }
    }
  }));
  return results;
}

async function sharekhanLeaders() {
  if (leadersCache && Date.now() - leadersCachedAt < 60 * 1000) return leadersCache;
  const results = await mapWithConcurrency(NIFTY50, 6, async symbol => (await sharekhanStock(symbol)).stock);
  const stocks = results.filter(Boolean);
  if (stocks.length < 45) throw new Error(`Sharekhan returned usable daily history for only ${stocks.length} of 50 NIFTY symbols.`);
  leadersCache = {
    universeCount: stocks.length,
    leaders: stocks.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: 'Sharekhan authorised API',
    providerNotice: 'Ranked using Sharekhan daily historical data. Intraday live streaming is not enabled in this read-only dashboard.'
  };
  leadersCachedAt = Date.now();
  return leadersCache;
}

function sharekhanInfo() {
  const session = sharekhanSession();
  return {
    configured: configured(),
    connected: Boolean(session?.accessToken),
    connectedAt: session?.connectedAt || null,
    mode: 'read-only daily data'
  };
}

async function sendMarketResponse(response, queryStringParameters) {
  const type = queryStringParameters.type || 'leaders';
  const symbol = String(queryStringParameters.symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (sharekhanSession() && (type === 'leaders' || (type === 'stock' && symbol))) {
    try {
      const payload = type === 'leaders' ? await sharekhanLeaders() : await sharekhanStock(symbol);
      sendJson(response, 200, payload);
      return;
    } catch (error) {
      console.warn('Sharekhan data unavailable; using the declared fallback:', error.message);
    }
  }
  const result = await marketHandler({ queryStringParameters });
  const headers = result.headers || {};
  response.writeHead(result.statusCode || 200, {
    'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
    'Cache-Control': headers['Cache-Control'] || 'no-store'
  });
  response.end(result.body || '{}');
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  setSecurityHeaders(response, origin);
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method !== 'GET') { sendJson(response, 405, { error: 'Only read-only GET requests are supported.' }); return; }

  if (url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'Market Pulse secure market gateway', sharekhan: sharekhanInfo(), asOf: new Date().toISOString() });
    return;
  }
  if (url.pathname === '/sharekhan/status') { sendJson(response, 200, sharekhanInfo()); return; }
  if (url.pathname === '/sharekhan/connect') {
    if (!configured()) { sendPage(response, 503, 'Sharekhan setup required', 'The server owner must add the Sharekhan API Key and Secure Key to its private server configuration first.'); return; }
    const state = crypto.randomBytes(24).toString('hex');
    pendingStates.set(state, Date.now());
    const login = new URL(SHAREKHAN_LOGIN);
    login.searchParams.set('api_key', process.env.SHAREKHAN_API_KEY);
    login.searchParams.set('state', state);
    if (process.env.SHAREKHAN_VENDOR_KEY) login.searchParams.set('vendor_key', process.env.SHAREKHAN_VENDOR_KEY);
    response.writeHead(302, { Location: login.toString() });
    response.end();
    return;
  }
  if (url.pathname === '/sharekhan/callback') {
    const state = url.searchParams.get('state') || '';
    const requestToken = url.searchParams.get('request_token') || url.searchParams.get('requestToken') || url.searchParams.get('token');
    const valid = pendingStates.has(state) && Date.now() - pendingStates.get(state) < 10 * 60 * 1000;
    pendingStates.delete(state);
    if (!valid || !requestToken) { sendPage(response, 400, 'Sharekhan connection not completed', 'The login return did not include a valid connection state or request token. Start again from the secure Sharekhan connect link.'); return; }
    try {
      await exchangeForAccessToken(requestToken, state);
      sendPage(response, 200, 'Sharekhan connected', 'Your encrypted session was stored only on the server. Market Pulse will now prefer Sharekhan daily data when available.');
    } catch (error) {
      console.error('Sharekhan login exchange failed:', error.message);
      sendPage(response, 502, 'Sharekhan connection failed', 'Sharekhan did not complete the secure session exchange. Check the server logs for a non-sensitive error message and retry.');
    }
    return;
  }
  if (url.pathname !== '/api/market') { sendJson(response, 404, { error: 'Not found' }); return; }
  if (!withinRateLimit(request)) { sendJson(response, 429, { error: 'Too many requests. Please retry in a minute.' }); return; }
  try {
    await sendMarketResponse(response, Object.fromEntries(url.searchParams.entries()));
  } catch (error) {
    console.error('Market gateway error:', error.message);
    sendJson(response, 503, { error: 'Market gateway is temporarily unavailable. Please retry shortly.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Market Pulse gateway listening on 127.0.0.1:${PORT}`);
});
