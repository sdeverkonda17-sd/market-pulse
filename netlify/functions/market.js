const NSE = 'https://www.nseindia.com';
const TWELVE_DATA = 'https://api.twelvedata.com';
const YAHOO_FINANCE = 'https://query1.finance.yahoo.com';
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const API_TIMEOUT_MS = 7000;
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  Referer: 'https://www.nseindia.com/'
};

// Used only if NSE's public feed is unavailable. NSE remains the primary source.
const FALLBACK_NIFTY_UNIVERSE = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJFINANCE',
  'BEL', 'BHARTIARTL', 'BRITANNIA', 'CIPLA', 'COALINDIA', 'DIVISLAB', 'DRREDDY', 'EICHERMOT', 'GRASIM', 'HCLTECH',
  'HDFCBANK', 'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDUSINDBK', 'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL',
  'KOTAKBANK', 'LT', 'M&M', 'MARUTI', 'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SBIN',
  'SHRIRAMFIN', 'SUNPHARMA', 'TATACONSUM', 'TATASTEEL', 'TATAMOTORS', 'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO'
];

let leadersCache = null;
let leadersCachedAt = 0;
let fallbackLeadersCache = null;
let fallbackLeadersCachedAt = 0;
let yahooLeadersCache = null;
let yahooLeadersCachedAt = 0;

const number = value => Number(String(value ?? 0).replace(/,/g, '')) || 0;
const json = (statusCode, body, cacheControl = 'no-store') => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  body: JSON.stringify(body)
});

async function fetchWithTimeout(url, options = {}, source = 'Market data') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${source} did not respond within 7 seconds`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function nse(path) {
  const warm = await fetchWithTimeout(`${NSE}/`, { headers: { ...headers, Accept: 'text/html,application/xhtml+xml' } }, 'NSE');
  const cookies = typeof warm.headers.getSetCookie === 'function'
    ? warm.headers.getSetCookie().join('; ')
    : (warm.headers.get('set-cookie') || '');
  const response = await fetchWithTimeout(`${NSE}${path}`, { headers: { ...headers, Cookie: cookies } }, 'NSE');
  if (!response.ok) throw new Error(`NSE returned ${response.status}`);
  const payload = await response.json();
  if (payload?.message === 'Resource not found') throw new Error('NSE route is currently unavailable');
  return payload;
}

async function twelve(path) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error('The fallback provider is not configured. Add TWELVE_DATA_API_KEY in Netlify environment variables.');
  }
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetchWithTimeout(
    `${TWELVE_DATA}${path}${separator}apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`,
    { headers: { Accept: 'application/json' } },
    'Fallback provider'
  );
  if (!response.ok) throw new Error(`Fallback provider returned ${response.status}`);
  const payload = await response.json();
  if (payload?.status === 'error') throw new Error(payload.message || 'Fallback provider rejected the request');
  return payload;
}

async function yahooChart(symbol, range = '1y') {
  const ticker = `${symbol}.NS`;
  const response = await fetchWithTimeout(
    `${YAHOO_FINANCE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false`,
    { headers: { Accept: 'application/json', 'User-Agent': headers['User-Agent'] } },
    'Yahoo Finance'
  );
  if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);
  const payload = await response.json();
  if (payload?.chart?.error) throw new Error(payload.chart.error.description || 'Yahoo Finance rejected the request');
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo Finance returned no chart for ${symbol}`);
  return result;
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
    volume: number(item.totalTradedVolume),
    dataSource: 'NSE'
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
    volume: number(quote.securityInfo?.issuedSize),
    dataSource: 'NSE'
  };
}

function historyRows(payload) {
  return (payload.data || [])
    .map(row => ({ date: row.CH_TIMESTAMP || row.mTIMESTAMP || '', close: number(row.CH_CLOSING_PRICE || row.close) }))
    .filter(row => row.close > 0)
    .reverse();
}

function announcementRows(payload, limit = 8) {
  const records = Array.isArray(payload) ? payload : (payload?.data || []);
  return records.slice(0, limit).map(item => {
    const attachment = item.attchmntFile || item.attachment || item.url || '';
    const url = /^https?:\/\//i.test(attachment) ? attachment : (attachment ? `${NSE}${attachment}` : '');
    return {
      symbol: item.symbol || item.sm_name || item.companyName || 'NSE listed company',
      title: item.desc || item.subject || item.purpose || 'NSE corporate announcement',
      date: item.an || item.broadcastDateTime || item.announcementDate || '',
      url
    };
  });
}

function marketSchedule(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  let label = 'CLOSED';
  let detail = 'Regular equity trading opens at 09:15 IST on the next trading day.';
  if (!weekend && minuteOfDay >= 9 * 60 && minuteOfDay < 9 * 60 + 15) {
    label = 'PRE-OPEN';
    detail = 'Pre-open session is in progress; normal equity trading begins at 09:15 IST.';
  } else if (!weekend && minuteOfDay >= 9 * 60 + 15 && minuteOfDay < 15 * 60 + 30) {
    label = 'OPEN';
    detail = 'Normal equity market session is in progress until 15:30 IST.';
  } else if (!weekend && minuteOfDay >= 15 * 60 + 30 && minuteOfDay < 16 * 60) {
    label = 'CLOSING';
    detail = 'Regular trading is closed; the NSE closing session runs until 16:00 IST.';
  } else if (weekend) {
    detail = 'Weekend — regular NSE equity trading is closed.';
  } else if (minuteOfDay < 9 * 60) {
    detail = 'Pre-open begins at 09:00 IST; normal equity trading begins at 09:15 IST.';
  } else if (minuteOfDay < 15 * 60 + 30) {
    detail = 'The regular equity session is scheduled from 09:15 to 15:30 IST.';
  }
  const asOf = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(now);
  return {
    label,
    detail,
    asOf: `${asOf} IST`,
    source: 'NSE regular-session schedule',
    note: 'Indicative schedule only — NSE holidays and special sessions can differ.'
  };
}

function marketStatusFromNse(payload, scheduled) {
  const rows = payload?.marketState || payload?.data || [];
  const capitalMarket = rows.find(row => /capital|equity/i.test(String(row.market || row.segment || row.marketType || '')));
  if (!capitalMarket) return scheduled;
  const rawStatus = String(capitalMarket.marketStatus || capitalMarket.status || '').toUpperCase();
  const label = rawStatus.includes('OPEN') ? 'OPEN'
    : rawStatus.includes('PRE') ? 'PRE-OPEN'
      : rawStatus.includes('CLOS') || rawStatus.includes('CLOSE') ? 'CLOSED'
        : scheduled.label;
  return {
    ...scheduled,
    label,
    detail: capitalMarket.marketStatusMessage || `NSE reports the Capital Market as ${capitalMarket.marketStatus || capitalMarket.status}.`,
    asOf: capitalMarket.tradeDate ? `NSE: ${capitalMarket.tradeDate}` : scheduled.asOf,
    source: 'NSE live market status',
    note: 'Official live-status response from NSE.'
  };
}

function twelveQuoteEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.symbol) return [payload];
  const records = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return Object.entries(records || {}).flatMap(([key, value]) => {
    const quote = value?.status === 'ok' && value.data ? value.data : value;
    if (!quote || typeof quote !== 'object' || !(quote.close ?? quote.price ?? quote.last_price)) return [];
    return [{ ...quote, symbol: quote.symbol || key }];
  });
}

function fromTwelveQuote(quote) {
  const symbol = String(quote.symbol || '').toUpperCase().replace(/:NSE$/, '');
  const lastPrice = number(quote.close ?? quote.price ?? quote.last_price);
  const previousClose = number(quote.previous_close);
  const pChange = quote.percent_change !== undefined
    ? number(quote.percent_change)
    : (previousClose ? (lastPrice - previousClose) / previousClose * 100 : 0);
  const range = quote.fifty_two_week || quote.fiftyTwoWeek || {};
  return {
    symbol,
    name: quote.name || quote.instrument_name || symbol,
    lastPrice,
    pChange,
    dayHigh: number(quote.high) || lastPrice,
    dayLow: number(quote.low) || lastPrice,
    yearHigh: number(range.high || quote.fifty_two_week_high) || lastPrice,
    yearLow: number(range.low || quote.fifty_two_week_low) || lastPrice,
    volume: number(quote.volume),
    dataSource: 'Twelve Data (NSE fallback)'
  };
}

function twelveHistoryRows(payload) {
  return (payload.values || [])
    .map(row => ({
      date: row.datetime || row.date || '',
      close: number(row.close),
      high: number(row.high),
      low: number(row.low),
      volume: number(row.volume)
    }))
    .filter(row => row.date && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fromTwelveHistory(symbol, payload) {
  const rows = twelveHistoryRows(payload);
  if (rows.length < 2) throw new Error(`Fallback provider returned insufficient history for ${symbol}`);
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const meta = payload.meta || {};
  return {
    stock: {
      symbol,
      name: meta.instrument_name || meta.name || symbol,
      lastPrice: latest.close,
      pChange: previous.close ? (latest.close - previous.close) / previous.close * 100 : 0,
      dayHigh: latest.high || latest.close,
      dayLow: latest.low || latest.close,
      yearHigh: Math.max(...rows.map(row => row.high || row.close)),
      yearLow: Math.min(...rows.map(row => row.low || row.close)),
      volume: latest.volume,
      dataSource: 'Twelve Data (NSE fallback)'
    },
    history: rows.map(({ date, close }) => ({ date, close })),
    announcements: [],
    source: 'Twelve Data (NSE fallback)',
    fallback: true,
    providerNotice: 'Fallback prices can be delayed, depending on the provider plan.'
  };
}

function fromYahooChart(symbol, payload) {
  const meta = payload.meta || {};
  const quote = payload.indicators?.quote?.[0] || {};
  const adjusted = payload.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = (payload.timestamp || [])
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: number(quote.close?.[index] ?? adjusted[index]),
      high: number(quote.high?.[index]),
      low: number(quote.low?.[index]),
      volume: number(quote.volume?.[index])
    }))
    .filter(row => row.close > 0);
  if (rows.length < 2) throw new Error(`Yahoo Finance returned insufficient history for ${symbol}`);
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const lastPrice = number(meta.regularMarketPrice) || latest.close;
  const previousClose = number(meta.regularMarketPreviousClose || meta.chartPreviousClose) || previous.close;
  const prices = rows.map(row => row.close);
  const highs = rows.map(row => row.high || row.close);
  const lows = rows.map(row => row.low || row.close);
  return {
    stock: {
      symbol,
      name: meta.longName || meta.shortName || symbol,
      lastPrice,
      pChange: previousClose ? (lastPrice - previousClose) / previousClose * 100 : 0,
      dayHigh: number(meta.regularMarketDayHigh) || latest.high || lastPrice,
      dayLow: number(meta.regularMarketDayLow) || latest.low || lastPrice,
      yearHigh: number(meta.fiftyTwoWeekHigh) || Math.max(...highs),
      yearLow: number(meta.fiftyTwoWeekLow) || Math.min(...lows),
      volume: number(meta.regularMarketVolume) || latest.volume,
      dataSource: 'Yahoo Finance (free NSE-symbol fallback)'
    },
    history: rows.map(({ date, close }) => ({ date, close })),
    announcements: [],
    source: 'Yahoo Finance (free NSE-symbol fallback)',
    fallback: true,
    freeFallback: true,
    providerNotice: 'Free fallback data is informational, may be delayed, and is not an official NSE feed.'
  };
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

async function twelveLeaders() {
  if (fallbackLeadersCache && Date.now() - fallbackLeadersCachedAt < 60 * 1000) return fallbackLeadersCache;
  const requested = FALLBACK_NIFTY_UNIVERSE.map(symbol => `${symbol}:NSE`).join(',');
  const payload = await twelve(`/quote?symbol=${encodeURIComponent(requested)}`);
  const all = twelveQuoteEntries(payload)
    .map(fromTwelveQuote)
    .filter(stock => FALLBACK_NIFTY_UNIVERSE.includes(stock.symbol) && stock.lastPrice > 0);
  if (all.length < 45) {
    throw new Error(`Fallback provider returned only ${all.length} of the 50 tracked NSE symbols. Check the provider's NSE coverage and API-credit allowance.`);
  }
  const result = {
    universeCount: all.length,
    leaders: all.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: 'Twelve Data (NSE fallback)',
    fallback: true,
    providerNotice: 'Fallback prices can be delayed, depending on the provider plan.'
  };
  fallbackLeadersCache = result;
  fallbackLeadersCachedAt = Date.now();
  return result;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { value: await mapper(items[index]) }; }
      catch (error) { results[index] = { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function yahooLeaders() {
  if (yahooLeadersCache && Date.now() - yahooLeadersCachedAt < 5 * 60 * 1000) return yahooLeadersCache;
  const results = await mapWithConcurrency(FALLBACK_NIFTY_UNIVERSE, 20, async symbol => {
    const chart = await yahooChart(symbol, '1y');
    return fromYahooChart(symbol, chart).stock;
  });
  const all = results.flatMap(result => result.value ? [result.value] : []);
  if (all.length < 45) {
    throw new Error(`Yahoo Finance returned only ${all.length} of the 50 tracked NSE symbols. Try again later or configure Twelve Data.`);
  }
  const result = {
    universeCount: all.length,
    leaders: all.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: 'Yahoo Finance (free NSE-symbol fallback)',
    fallback: true,
    freeFallback: true,
    providerNotice: 'Free fallback data is informational, may be delayed, and is not an official NSE feed.'
  };
  yahooLeadersCache = result;
  yahooLeadersCachedAt = Date.now();
  return result;
}

async function nseStock(symbol) {
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
    announcements = announcementRows(raw, 8);
  } catch { /* Announcements are optional to the stock review. */ }
  return { stock: fromQuote(symbol, quote), history: historyRows(historical), announcements, source: 'NSE' };
}

async function marketUpdates() {
  const scheduled = marketSchedule();
  const [statusResponse, announcementResponse] = await Promise.allSettled([
    nse('/api/marketStatus'),
    nse('/api/corporate-announcements?index=equities')
  ]);
  const status = statusResponse.status === 'fulfilled' ? marketStatusFromNse(statusResponse.value, scheduled) : scheduled;
  if (announcementResponse.status === 'fulfilled') {
    return {
      marketStatus: status,
      announcements: announcementRows(announcementResponse.value, 8),
      source: 'NSE corporate disclosures',
      asOf: new Date().toISOString()
    };
  }
  return {
    marketStatus: status,
    announcements: [],
    source: 'NSE announcements temporarily unavailable',
    detail: announcementResponse.reason?.message || 'NSE announcements could not be reached.',
    asOf: new Date().toISOString()
  };
}

async function twelveStock(symbol) {
  const payload = await twelve(`/time_series?symbol=${encodeURIComponent(`${symbol}:NSE`)}&interval=1day&outputsize=260`);
  return fromTwelveHistory(symbol, payload);
}

async function yahooStock(symbol) {
  return fromYahooChart(symbol, await yahooChart(symbol, '1y'));
}

async function fallbackLeaders() {
  try { return await twelveLeaders(); }
  catch (twelveError) {
    try { return await yahooLeaders(); }
    catch (yahooError) { throw new Error(`Twelve Data: ${twelveError.message}. Yahoo Finance: ${yahooError.message}`); }
  }
}

async function fallbackStock(symbol) {
  try { return await twelveStock(symbol); }
  catch (twelveError) {
    try { return await yahooStock(symbol); }
    catch (yahooError) { throw new Error(`Twelve Data: ${twelveError.message}. Yahoo Finance: ${yahooError.message}`); }
  }
}

function unavailable(error, fallbackError) {
  return json(503, {
    error: 'NSE data is temporarily unavailable',
    detail: fallbackError ? `${error.message}. Fallback provider: ${fallbackError.message}` : error.message,
    retryAfterSeconds: 60,
    fallbackConfigured: Boolean(TWELVE_DATA_API_KEY)
  });
}

exports.handler = async event => {
  const type = event.queryStringParameters?.type || 'leaders';
  const symbol = String(event.queryStringParameters?.symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (type === 'updates') return json(200, await marketUpdates(), 'public, max-age=60');
  if (type !== 'leaders' && (type !== 'stock' || !symbol)) return json(400, { error: 'Invalid request' });
  try {
    if (type === 'leaders') return json(200, await leaders(), 'public, max-age=45');
    return json(200, await nseStock(symbol), 'public, max-age=60');
  } catch (nseError) {
    try {
      if (type === 'leaders') return json(200, await fallbackLeaders(), 'public, max-age=45');
      return json(200, await fallbackStock(symbol), 'public, max-age=60');
    } catch (fallbackError) {
      if (type === 'leaders' && leadersCache) {
        return json(200, { ...leadersCache, source: 'NSE saved result', savedAt: new Date(leadersCachedAt).toISOString(), delayed: true }, 'public, max-age=30');
      }
      return unavailable(nseError, fallbackError);
    }
  }
};
