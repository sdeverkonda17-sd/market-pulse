/*
 * Market Pulse gateway
 *
 * This small Node service runs only on the fixed-IP Lightsail instance. It
 * reuses the hardened market-data handler used by the Netlify deployment and
 * exposes a narrow, read-only API. No broker key, order route, password, or
 * token is ever sent to the browser.
 */
const http = require('node:http');
const { URL } = require('node:url');
const { handler: marketHandler } = require('../netlify/functions/market');

const PORT = Number(process.env.PORT || 8787);
const allowedOrigins = new Set(
  String(process.env.DASHBOARD_ORIGINS || 'https://market-pulse-sd.netlify.app')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const recentRequests = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 90;

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

function withinRateLimit(request) {
  const key = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const entry = recentRequests.get(key) || { started: now, count: 0 };
  if (now - entry.started >= RATE_WINDOW_MS) {
    entry.started = now;
    entry.count = 0;
  }
  entry.count += 1;
  recentRequests.set(key, entry);
  if (recentRequests.size > 2_000) {
    for (const [ip, row] of recentRequests) if (now - row.started >= RATE_WINDOW_MS) recentRequests.delete(ip);
  }
  return entry.count <= RATE_LIMIT;
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  setSecurityHeaders(response, origin);
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Only read-only GET requests are supported.' });
    return;
  }
  if (url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'Market Pulse secure market gateway', asOf: new Date().toISOString() });
    return;
  }
  if (url.pathname !== '/api/market') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  if (!withinRateLimit(request)) {
    sendJson(response, 429, { error: 'Too many requests. Please retry in a minute.' });
    return;
  }

  try {
    const queryStringParameters = Object.fromEntries(url.searchParams.entries());
    const result = await marketHandler({ queryStringParameters });
    const headers = result.headers || {};
    response.writeHead(result.statusCode || 200, {
      'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8',
      'Cache-Control': headers['Cache-Control'] || 'no-store'
    });
    response.end(result.body || '{}');
  } catch (error) {
    console.error('Market gateway error:', error);
    sendJson(response, 503, { error: 'Market gateway is temporarily unavailable. Please retry shortly.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Market Pulse gateway listening on 127.0.0.1:${PORT}`);
});
