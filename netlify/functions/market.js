const NSE = 'https://www.nseindia.com';
const API_TIMEOUT_MS = 7000;
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: 'https://www.nseindia.com/'
};

let leadersCache = null;
let leadersCachedAt = 0;

const number = value => Number(String(value ?? 0).replace(/,/g, '')) || 0;
const json = (statusCode, body, cacheControl = 'no-store') => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  body: JSON.stringify(body)
});

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('NSE did not respond within 7 seconds');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function nse(path) {
  const warm = await fetchWithTimeout(`${NSE}/`, { headers: { ...headers, Accept: 'text/html,application/xhtml+xml' } });
  const cookies = typeof warm.headers.getSetCookie === 'function'
    ? warm.headers.getSetCookie().join('; ')
    : (warm.headers.get('set-cookie') || '');
  const response = await fetchWithTimeout(`${NSE}${path}`, { headers: { ...headers, Cookie: cookies } });
  if (!response.ok) throw new Error(`NSE returned ${response.status}`);
  const payload = await response.json();
  if (payload?.message === 'Resource not found') throw new Error('NSE route is currently unavailable');
  return payload;
}

function fromIndex(item) {
  return {
    symbol: item.symbol,
    name: item.meta?.companyName || item.symbol,
    lastPrice: number(item.lastPrice),
    pChange: number(item.pChange),
    dayHigh: number(item.dayHigh),
    dayLow: number(item.dayLow),
    yearHigh: number(item.yearHigh),
    yearLow: number(item.yearLow),
    volume: number(item.totalTradedVolume)
  };
}

function fromQuote(symbol, quote) {
  const price = quote.priceInfo || {};
  const meta = quote.info || {};
  return {
    symbol,
    name: meta.companyName || symbol,
    lastPrice: number(price.lastPrice),
    pChange: number(price.pChange),
    dayHigh: number(price.intraDayHighLow?.max || price.dayHigh),
    dayLow: number(price.intraDayHighLow?.min || price.dayLow),
    yearHigh: number(price.weekHighLow?.max),
    yearLow: number(price.weekHighLow?.min),
    volume: number(quote.securityInfo?.issuedSize)
  };
}

function historyRows(payload) {
  return (payload.data || [])
    .map(row => ({ date: row.CH_TIMESTAMP || row.mTIMESTAMP || '', close: number(row.CH_CLOSING_PRICE || row.close) }))
    .filter(row => row.close > 0)
    .reverse();
}

async function leaders() {
  const payload = await nse('/api/equity-stockIndices?index=NIFTY%2050');
  const all = (payload.data || [])
    .filter(item => item.symbol && item.symbol !== 'NIFTY 50')
    .map(fromIndex)
    .filter(item => item.lastPrice > 0);
  if (!all.length) throw new Error('NSE returned no NIFTY 50 constituents');
  const result = { universeCount: all.length, leaders: all.sort((a, b) => b.pChange - a.pChange).slice(0, 10), asOf: new Date().toISOString(), source: 'NSE' };
  leadersCache = result;
  leadersCachedAt = Date.now();
  return result;
}

exports.handler = async event => {
  const type = event.queryStringParameters?.type || 'leaders';
  const symbol = String(event.queryStringParameters?.symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  try {
    if (type === 'leaders') return json(200, await leaders(), 'public, max-age=45');
    if (type !== 'stock' || !symbol) return json(400, { error: 'Invalid request' });

    const quote = await nse(`/api/quote-equity?symbol=${encodeURIComponent(symbol)}`);
    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - 1);
    const formatDate = value => value.toLocaleDateString('en-GB').replace(/\//g, '-');
    let historical = { data: [] };
    let announcements = [];
    try {
      historical = await nse(`/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series=[%22EQ%22]&from=${formatDate(start)}&to=${formatDate(end)}`);
    } catch { /* The quote remains useful when NSE historical data is delayed. */ }
    try {
      const raw = await nse(`/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`);
      announcements = (raw || []).map(item => ({
        title: item.desc || item.subject || 'NSE corporate announcement',
        date: item.an || item.broadcastDateTime || '',
        url: item.attchmntFile || '#'
      }));
    } catch { /* Announcements are optional to the stock review. */ }
    return json(200, { stock: fromQuote(symbol, quote), history: historyRows(historical), announcements, source: 'NSE' }, 'public, max-age=60');
  } catch (error) {
    if (type === 'leaders' && leadersCache) {
      return json(200, { ...leadersCache, source: 'NSE saved result', savedAt: new Date(leadersCachedAt).toISOString(), delayed: true }, 'public, max-age=30');
    }
    return json(503, {
      error: 'NSE data is temporarily unavailable',
      detail: error.message,
      retryAfterSeconds: 60
    });
  }
};
