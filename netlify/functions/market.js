const NSE = 'https://www.nseindia.com';
const TWELVE_DATA = 'https://api.twelvedata.com';
const YAHOO_FINANCE = 'https://query1.finance.yahoo.com';
const UPSTOX = 'https://api.upstox.com';
const UPSTOX_NSE_INSTRUMENTS = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const { gunzipSync } = require('node:zlib');
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const UPSTOX_ANALYTICS_TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN;
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

// Curated liquid NSE symbol baskets. These are research categories, not NSE
// indices and are intentionally labelled as sector baskets in the dashboard.
const SECTOR_UNIVERSES = {
  banking: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB', 'FEDERALBNK', 'IDFCFIRSTB'],
  defence: ['BEL', 'HAL', 'MAZDOCK', 'COCHINSHIP', 'BDL', 'BEML', 'GRSE', 'MTARTECH', 'DATAPATTNS', 'PARAS'],
  it: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'OFSS'],
  energy: ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIGREEN', 'ADANIPOWER', 'GAIL', 'IOC', 'BPCL'],
  auto: ['MARUTI', 'M&M', 'TATAMOTORS', 'BAJAJ-AUTO', 'EICHERMOT', 'TVSMOTOR', 'HEROMOTOCO', 'ASHOKLEY', 'BOSCHLTD', 'MOTHERSON'],
  pharma: ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'BIOCON', 'ALKEM', 'TORNTPHARM', 'GLENMARK'],
  fmcg: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'DABUR', 'GODREJCP', 'MARICO', 'COLPAL', 'VBL'],
  metals: ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'VEDL', 'JINDALSTEL', 'NMDC', 'SAIL', 'HINDZINC', 'NALCO'],
  infrastructure: ['LT', 'ULTRACEMCO', 'ADANIPORTS', 'GRASIM', 'SIEMENS', 'ABB', 'CUMMINSIND', 'IRB', 'NBCC', 'KEI']
};

let leadersCache = null;
let leadersCachedAt = 0;
let fallbackLeadersCache = null;
let fallbackLeadersCachedAt = 0;
let yahooLeadersCache = null;
let yahooLeadersCachedAt = 0;
let upstoxLeadersCache = null;
let upstoxLeadersCachedAt = 0;
let upstoxInstrumentIndex = null;
let upstoxInstrumentIndexedAt = 0;
const upstoxStockCache = new Map();
const sectorCache = new Map();

const number = value => Number(String(value ?? 0).replace(/,/g, '')) || 0;
const json = (statusCode, body, cacheControl = 'no-store') => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  body: JSON.stringify(body)
});

async function fetchWithTimeout(url, options = {}, source = 'Market data', timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${source} did not respond within ${Math.round(timeoutMs / 1000)} seconds`);
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

function requireUpstox() {
  if (!UPSTOX_ANALYTICS_TOKEN) {
    throw new Error('Upstox is not configured. Add UPSTOX_ANALYTICS_TOKEN in Netlify environment variables.');
  }
}

async function upstox(path) {
  requireUpstox();
  const response = await fetchWithTimeout(`${UPSTOX}${path}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${UPSTOX_ANALYTICS_TOKEN}`
    }
  }, 'Upstox');
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 220);
    throw new Error(`Upstox returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  const payload = await response.json();
  if (payload?.status === 'error') throw new Error(payload.errors?.[0]?.message || payload.message || 'Upstox rejected the request');
  return payload;
}

async function upstoxInstruments() {
  if (upstoxInstrumentIndex && Date.now() - upstoxInstrumentIndexedAt < 18 * 60 * 60 * 1000) return upstoxInstrumentIndex;
  const response = await fetchWithTimeout(UPSTOX_NSE_INSTRUMENTS, { headers: { Accept: 'application/gzip, application/json' } }, 'Upstox instrument list', 15000);
  if (!response.ok) throw new Error(`Upstox instrument list returned ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  let text;
  try { text = gunzipSync(buffer).toString('utf8'); }
  catch { text = buffer.toString('utf8'); }
  const rows = JSON.parse(text);
  const index = new Map();
  for (const item of rows) {
    const symbol = String(item.trading_symbol || '').toUpperCase();
    if (item.segment === 'NSE_EQ' && symbol && item.instrument_key && ['EQ', 'BE'].includes(String(item.instrument_type || ''))) {
      index.set(symbol, { symbol, name: item.name || symbol, instrumentKey: item.instrument_key });
    }
  }
  if (index.size < 100) throw new Error('Upstox instrument list did not contain enough NSE equities');
  upstoxInstrumentIndex = index;
  upstoxInstrumentIndexedAt = Date.now();
  return index;
}

function fromUpstoxQuote(symbol, instrument, quote) {
  const live = quote.live_ohlc || quote.ohlc || {};
  const previous = quote.prev_ohlc || {};
  const lastPrice = number(quote.last_price || live.close);
  const previousClose = number(previous.close);
  return {
    symbol,
    name: instrument.name || symbol,
    lastPrice,
    pChange: previousClose ? (lastPrice - previousClose) / previousClose * 100 : 0,
    dayHigh: number(live.high) || lastPrice,
    dayLow: number(live.low) || lastPrice,
    yearHigh: 0,
    yearLow: 0,
    volume: number(live.volume),
    dataSource: 'Upstox Analytics Token (NSE)'
  };
}

async function upstoxQuotes(symbols) {
  const instruments = await upstoxInstruments();
  const requested = symbols.map(symbol => ({ symbol, instrument: instruments.get(symbol) })).filter(item => item.instrument);
  if (!requested.length) throw new Error('No requested NSE symbols were found in the Upstox instrument list');
  const keys = requested.map(item => item.instrument.instrumentKey).join(',');
  const payload = await upstox(`/v3/market-quote/ohlc?instrument_key=${encodeURIComponent(keys)}&interval=1d`);
  const byInstrument = new Map(Object.values(payload.data || {}).map(quote => [quote.instrument_token, quote]));
  return requested.flatMap(({ symbol, instrument }) => {
    const quote = byInstrument.get(instrument.instrumentKey);
    const stock = quote ? fromUpstoxQuote(symbol, instrument, quote) : null;
    return stock?.lastPrice > 0 ? [stock] : [];
  });
}

async function upstoxDailyHistory(instrumentKey) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  const date = value => value.toISOString().slice(0, 10);
  const payload = await upstox(`/v3/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/${date(end)}/${date(start)}`);
  return (payload.data?.candles || [])
    .map(candle => ({
      date: String(candle[0] || '').slice(0, 10),
      open: number(candle[1]), high: number(candle[2]), low: number(candle[3]), close: number(candle[4]), volume: number(candle[5])
    }))
    .filter(row => row.date && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function upstoxStock(symbol) {
  const cached = upstoxStockCache.get(symbol);
  if (cached && Date.now() - cached.at < 3 * 60 * 1000) return cached.value;
  const instruments = await upstoxInstruments();
  const instrument = instruments.get(symbol);
  if (!instrument) throw new Error(`${symbol} was not found in the Upstox NSE instrument list`);
  const [quotes, history] = await Promise.all([upstoxQuotes([symbol]), upstoxDailyHistory(instrument.instrumentKey)]);
  const quote = quotes[0];
  if (!quote) throw new Error(`Upstox returned no current quote for ${symbol}`);
  const closes = history.map(row => row.close);
  const highs = history.map(row => row.high || row.close);
  const lows = history.map(row => row.low || row.close);
  const latestHistory = history.at(-1);
  const previousHistory = history.at(-2);
  const stock = {
    ...quote,
    lastPrice: quote.lastPrice || latestHistory?.close || 0,
    pChange: quote.pChange || (previousHistory?.close ? (latestHistory.close - previousHistory.close) / previousHistory.close * 100 : 0),
    yearHigh: highs.length ? Math.max(...highs) : 0,
    yearLow: lows.length ? Math.min(...lows) : 0
  };
  const value = {
    stock,
    history: history.map(({ date, close }) => ({ date, close })),
    announcements: [],
    source: 'Upstox Analytics Token (NSE)',
    providerNotice: 'Read-only Upstox market data. Corporate disclosures continue to use NSE when available.'
  };
  upstoxStockCache.set(symbol, { at: Date.now(), value });
  return value;
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

async function upstoxLeaders() {
  if (upstoxLeadersCache && Date.now() - upstoxLeadersCachedAt < 45 * 1000) return upstoxLeadersCache;
  const all = await upstoxQuotes(FALLBACK_NIFTY_UNIVERSE);
  if (all.length < 45) throw new Error(`Upstox returned only ${all.length} of the 50 tracked NIFTY symbols`);
  const result = {
    universeCount: all.length,
    leaders: all.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: 'Upstox Analytics Token (NSE)',
    providerNotice: 'Read-only Upstox market snapshots. Rankings use the tracked NIFTY 50 universe and are refreshed on request.'
  };
  upstoxLeadersCache = result;
  upstoxLeadersCachedAt = Date.now();
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

// Upstox is the preferred authenticated source when the read-only Analytics
// token is present. NSE is retained as the next option because it also supplies
// corporate disclosures and avoids making the dashboard dependent on one API.
async function resilientLeaders() {
  const failures = [];
  if (UPSTOX_ANALYTICS_TOKEN) {
    try { return await upstoxLeaders(); }
    catch (error) { failures.push(`Upstox: ${error.message}`); }
  }
  try { return await leaders(); }
  catch (error) { failures.push(`NSE: ${error.message}`); }
  try { return await fallbackLeaders(); }
  catch (error) {
    failures.push(`Fallback: ${error.message}`);
    throw new Error(failures.join('. '));
  }
}

async function resilientStock(symbol) {
  const failures = [];
  if (UPSTOX_ANALYTICS_TOKEN) {
    try { return await upstoxStock(symbol); }
    catch (error) { failures.push(`Upstox: ${error.message}`); }
  }
  try { return await nseStock(symbol); }
  catch (error) { failures.push(`NSE: ${error.message}`); }
  try { return await fallbackStock(symbol); }
  catch (error) {
    failures.push(`Fallback: ${error.message}`);
    throw new Error(failures.join('. '));
  }
}

function sectorSnapshot(analysis) {
  const history = (analysis.history || []).filter(point => Number(point.close) > 0);
  const closes = history.map(point => Number(point.close));
  const latest = closes.at(-1) || Number(analysis.stock.lastPrice) || 0;
  const threeMonthBase = closes.at(Math.max(0, closes.length - 64)) || latest;
  const trend3m = threeMonthBase ? (latest - threeMonthBase) / threeMonthBase * 100 : 0;
  const support = Math.min(...(closes.slice(-20).length ? closes.slice(-20) : [latest]));
  const resistance = Math.max(...(closes.slice(-20).length ? closes.slice(-20) : [latest]));
  const returns = closes.slice(1).map((value, index) => Math.log(value / closes[index])).filter(Number.isFinite);
  const volatility = returns.length
    ? Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) * Math.sqrt(252) * 100
    : 0;
  // A bounded scenario, not a target or guaranteed forecast. It combines
  // recent trend with volatility so that extreme moves are not extrapolated.
  const scenario12m = Math.max(-45, Math.min(60, trend3m * 1.7 - volatility * 0.12));
  return { ...analysis.stock, trend3m, support, resistance, volatility, scenario12m };
}

async function sectorLeaders(sector) {
  const key = String(sector || '').toLowerCase();
  const universe = SECTOR_UNIVERSES[key];
  if (!universe) throw new Error('Unknown sector');
  const cached = sectorCache.get(key);
  if (cached && Date.now() - cached.at < 3 * 60 * 1000) return cached.value;
  const results = await mapWithConcurrency(universe, 6, async symbol => sectorSnapshot(await resilientStock(symbol)));
  const leaders = results.flatMap(result => result.value ? [result.value] : []);
  if (leaders.length < 7) throw new Error(`Only ${leaders.length} of ${universe.length} sector symbols returned usable market data.`);
  const sources = [...new Set(leaders.map(stock => stock.dataSource).filter(Boolean))];
  const value = {
    sector: key,
    universeCount: leaders.length,
    leaders: leaders.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: sources.length === 1 ? sources[0] : 'Mixed market-data sources',
    fallback: leaders.some(stock => /fallback/i.test(String(stock.dataSource || ''))),
    providerNotice: UPSTOX_ANALYTICS_TOKEN
      ? 'Sector baskets use Upstox read-only NSE market data first, with NSE and free fallbacks if needed. Trend and 12-month figures are bounded scenarios, not price targets.'
      : 'Sector baskets use NSE public data first and daily NSE-symbol fallback data when it is unavailable. Trend and 12-month figures are bounded scenarios, not price targets.'
  };
  sectorCache.set(key, { at: Date.now(), value });
  return value;
}

function unavailable(error) {
  return json(503, {
    error: 'Market data is temporarily unavailable',
    detail: error.message,
    retryAfterSeconds: 60,
    upstoxConfigured: Boolean(UPSTOX_ANALYTICS_TOKEN),
    fallbackConfigured: Boolean(TWELVE_DATA_API_KEY)
  });
}

exports.handler = async event => {
  const type = event.queryStringParameters?.type || 'leaders';
  const symbol = String(event.queryStringParameters?.symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  const sector = String(event.queryStringParameters?.sector || '').toLowerCase().replace(/[^a-z]/g, '');
  if (type === 'updates') return json(200, await marketUpdates(), 'public, max-age=60');
  if (type === 'sector') {
    try { return json(200, await sectorLeaders(sector), 'public, max-age=60'); }
    catch (error) { return json(503, { error: 'Sector data is temporarily unavailable', detail: error.message, retryAfterSeconds: 60 }); }
  }
  if (type !== 'leaders' && (type !== 'stock' || !symbol)) return json(400, { error: 'Invalid request' });
  try {
    if (type === 'leaders') return json(200, await resilientLeaders(), 'public, max-age=45');
    return json(200, await resilientStock(symbol), 'public, max-age=60');
  } catch (error) {
    const saved = upstoxLeadersCache || leadersCache || fallbackLeadersCache || yahooLeadersCache;
    if (type === 'leaders' && saved) {
      return json(200, { ...saved, source: `${saved.source || 'Market data'} saved result`, savedAt: new Date(upstoxLeadersCachedAt || leadersCachedAt || fallbackLeadersCachedAt || yahooLeadersCachedAt).toISOString(), delayed: true }, 'public, max-age=30');
    }
    return unavailable(error);
  }
};
