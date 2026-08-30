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
      index.set(symbol, { symbol, name: item.name || symbol, instrumentKey: item.instrument_key, isin: String(item.isin || item.isin_code || '').toUpperCase() });
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
  const [quotes, history, fundamentals] = await Promise.all([upstoxQuotes([symbol]), upstoxDailyHistory(instrument.instrumentKey), upstoxFundamentals(instrument)]);
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
    yearLow: lows.length ? Math.min(...lows) : 0,
    fundamentals
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
  const ranked = all.sort((a, b) => b.pChange - a.pChange).slice(0, 10);
  const instruments = await upstoxInstruments();
  const leaders = await Promise.all(ranked.map(async stock => {
    const instrument = instruments.get(stock.symbol);
    const fundamentals = instrument ? await upstoxFundamentals(instrument) : { available: false, note: 'No Upstox instrument mapping.' };
    return { ...stock, fundamentals };
  }));
  const result = {
    universeCount: all.length,
    leaders,
    asOf: new Date().toISOString(),
    source: 'Upstox Analytics Token (NSE)',
    providerNotice: 'Upstox tracked NIFTY 50 market snapshots, enriched with annual fundamentals where supplied. Refreshes on request.'
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

const GOOGLE_NEWS = 'https://news.google.com/rss/search';
let newsCachedAt = 0;
let marketNewsCache = null;

function financialNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function valuesFromFundamentalPayload(payload, aliases) {
  const wanted = aliases.map(value => String(value).toLowerCase().replace(/[^a-z]/g, ''));
  const values = [];
  const seen = new WeakSet();
  const walk = item => {
    if (Array.isArray(item)) return item.forEach(walk);
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    const label = String(item.name || item.label || item.metric || item.parameter || item.particular || item.title || '').toLowerCase().replace(/[^a-z]/g, '');
    if (label && wanted.some(alias => label === alias || label.includes(alias))) {
      const value = financialNumber(item.value ?? item.amount ?? item.current ?? item.latest ?? item.company_value ?? item.companyValue);
      if (value !== null) values.push(value);
    }
    Object.values(item).forEach(value => { if (value && typeof value === 'object') walk(value); });
  };
  walk(payload?.data ?? payload);
  return values;
}

function latestPair(payload, aliases) {
  const values = valuesFromFundamentalPayload(payload, aliases);
  return { latest: values[0] ?? null, previous: values[1] ?? null };
}

function growthFromPair(pair) {
  if (pair.latest === null || pair.latest === undefined || pair.previous === null || pair.previous === undefined || Number(pair.previous) === 0) return null;
  return (Number(pair.latest) - Number(pair.previous)) / Math.abs(Number(pair.previous)) * 100;
}

function incomeSeries(payload, categories, particulars = []) {
  const data = payload?.data ?? payload ?? {};
  const normal = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wantedCategories = categories.map(normal);
  const wantedParticulars = particulars.map(normal);
  const summaryRows = Array.isArray(data.income_statement) ? data.income_statement : [];
  let row = summaryRows.find(item => wantedCategories.includes(normal(item.category)));
  if (!row) {
    const fullRows = Array.isArray(data.full_statement) ? data.full_statement : [];
    row = fullRows.find(item => wantedParticulars.includes(normal(item.particular))) || fullRows.find(item => wantedParticulars.some(name => normal(item.particular).includes(name)));
  }
  const history = (Array.isArray(row?.history) ? row.history : []).map(item => ({
    value: financialNumber(item?.value),
    period: String(item?.period || ''),
    change: financialNumber(item?.change)
  })).filter(item => item.value !== null);
  const latest = history[0] || null, previous = history[1] || null;
  const calculated = growthFromPair({ latest: latest?.value, previous: previous?.value });
  return {
    latest: latest?.value ?? null,
    previous: previous?.value ?? null,
    latestPeriod: latest?.period || null,
    previousPeriod: previous?.period || null,
    growth: latest?.change ?? calculated
  };
}
async function upstoxFundamentals(instrument) {
  if (!instrument?.isin) return { available: false, note: 'Fundamental data is unavailable because this instrument has no ISIN mapping.' };
  const base = `/v2/fundamentals/${encodeURIComponent(instrument.isin)}`;
  const [ratiosResult, incomeResult] = await Promise.allSettled([
    upstox(`${base}/key-ratios`),
    upstox(`${base}/income-statement?type=consolidated&time_period=yearly&fs=true`)
  ]);
  const ratios = ratiosResult.status === 'fulfilled' ? ratiosResult.value : null;
  const income = incomeResult.status === 'fulfilled' ? incomeResult.value : null;
  const revenue = incomeSeries(income, ['revenue'], ['total revenue', 'revenue']);
  const profit = incomeSeries(income, ['net_profit'], ['profit after tax', 'net profit']);
  const ratio = aliases => latestPair(ratios, aliases).latest;
  return {
    available: Boolean(ratios || income),
    isin: instrument.isin,
    revenue: revenue.latest,
    netProfit: profit.latest,
    revenueGrowth: revenue.growth,
    revenuePeriod: revenue.latestPeriod,
    revenuePreviousPeriod: revenue.previousPeriod,
    profitGrowth: profit.growth,
    profitPeriod: profit.latestPeriod,
    profitPreviousPeriod: profit.previousPeriod,
    pe: ratio(['price to earnings', 'pe ratio', 'p/e']),
    sectorPe: ratio(['sector pe', 'sector price to earnings']),
    roe: ratio(['return on equity', 'roe']),
    sectorRoe: ratio(['sector roe', 'sector return on equity']),
    roce: ratio(['return on capital employed', 'roce']),
    sectorRoce: ratio(['sector roce', 'sector return on capital employed']),
    note: ratios || income ? 'Upstox fundamentals are annual, consolidated figures where supplied by the provider.' : 'Fundamental data could not be returned for this ticker right now.'
  };
}

function clampScore(value) { return Math.max(0, Math.min(100, Math.round(value))); }

function mlOutlook(history){
  const closes=(history||[]).map(row=>Number(row.close)).filter(value=>value>0);
  if(closes.length<90)return {available:false,note:'At least 90 daily closes are required to train the ML model.'};
  const rows=[];
  for(let i=25;i<closes.length-5;i++){
    const slice=closes.slice(i-20,i+1),returns=slice.slice(1).map((value,j)=>Math.log(value/slice[j]));
    const mean=returns.reduce((a,b)=>a+b,0)/returns.length,vol=Math.sqrt(returns.reduce((sum,value)=>sum+(value-mean)**2,0)/returns.length);
    const r5=closes[i]/closes[i-5]-1,r20=closes[i]/closes[i-20]-1,ma5=closes.slice(i-4,i+1).reduce((a,b)=>a+b,0)/5,ma20=slice.slice(1).reduce((a,b)=>a+b,0)/20;
    const future=closes[i+5]/closes[i]-1,label=future>.015?2:future<-.015?0:1;
    rows.push({x:[r5,r20,vol,ma5/ma20-1],label});
  }
  if(rows.length<55)return {available:false,note:'Not enough chronological training windows were available.'};
  const split=Math.max(40,Math.floor(rows.length*.8)),train=rows.slice(0,split),test=rows.slice(split),means=[0,1,2,3].map(j=>train.reduce((sum,row)=>sum+row.x[j],0)/train.length),stds=means.map((mean,j)=>Math.sqrt(train.reduce((sum,row)=>sum+(row.x[j]-mean)**2,0)/train.length)||1);
  const norm=x=>x.map((value,j)=>(value-means[j])/stds[j]),weights=Array.from({length:3},()=>[0,0,0,0,0]),softmax=scores=>{const peak=Math.max(...scores),exp=scores.map(value=>Math.exp(value-peak)),total=exp.reduce((a,b)=>a+b,0);return exp.map(value=>value/total);};
  for(let epoch=0;epoch<180;epoch++)for(const row of train){const x=[1,...norm(row.x)],p=softmax(weights.map(w=>w.reduce((sum,value,j)=>sum+value*x[j],0)));for(let k=0;k<3;k++)for(let j=0;j<x.length;j++)weights[k][j]-=.035*(p[k]-(row.label===k?1:0))*x[j];}
  const predict=x=>{const nx=[1,...norm(x)];return softmax(weights.map(w=>w.reduce((sum,value,j)=>sum+value*nx[j],0)));};
  const accuracy=test.length?test.filter(row=>{const p=predict(row.x);return p.indexOf(Math.max(...p))===row.label;}).length/test.length:0;
  const i=closes.length-1,slice=closes.slice(-21),returns=slice.slice(1).map((value,j)=>Math.log(value/slice[j])),mean=returns.reduce((a,b)=>a+b,0)/returns.length,vol=Math.sqrt(returns.reduce((sum,value)=>sum+(value-mean)**2,0)/returns.length),ma5=closes.slice(-5).reduce((a,b)=>a+b,0)/5,ma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20,current=[closes[i]/closes[i-5]-1,closes[i]/closes[i-20]-1,vol,ma5/ma20-1],p=predict(current),names=['5-day momentum','20-day momentum','recent volatility','short/long trend gap'],upWeights=weights[2].slice(1),drivers=names.map((name,j)=>({name,impact:upWeights[j]*norm(current)[j]})).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,2).map(item=>`${item.name} ${item.impact>=0?'supports':'reduces'} the upside case`);
  const confidence=accuracy>=.58&&rows.length>=120?'Higher':accuracy>=.48?'Moderate':'Low';
  return {available:true,down:Math.round(p[0]*100),sideways:Math.round(p[1]*100),up:Math.round(p[2]*100),accuracy:Math.round(accuracy*100),samples:rows.length,confidence,drivers,horizon:'Next 5 trading days',method:'Per-stock 3-class logistic regression with an 80/20 chronological validation split'};
}
function researchScore(stock) {
  const pChange = Number(stock.pChange || 0);
  const price = Number(stock.lastPrice || 0);
  const rangePct = price ? Math.max(0, Number(stock.dayHigh || price) - Number(stock.dayLow || price)) / price * 100 : 0;
  const nearHigh = stock.yearHigh && price ? price / Number(stock.yearHigh) : null;
  const technical = clampScore(50 + (pChange >= 2 ? 18 : pChange >= .7 ? 11 : pChange > 0 ? 5 : pChange <= -2 ? -18 : pChange < 0 ? -9 : 0) + (rangePct <= 2.5 ? 6 : rangePct > 5 ? -8 : 0) + (nearHigh !== null && nearHigh >= .88 ? 6 : nearHigh !== null && nearHigh < .7 ? -5 : 0));
  const fundamentals = stock.fundamentals || {};
  if (!fundamentals.available) return { technical, fundamental: null, score: technical, reason: ['Fundamental data was unavailable, so this result uses technical evidence only.'] };
  const reason = [];
  let fundamental = 50;
  const growth = (value, label) => {
    if (value === null || value === undefined) return;
    if (value >= 12) { fundamental += 12; reason.push(`${label} grew ${value.toFixed(1)}% year-on-year.`); }
    else if (value >= 5) { fundamental += 6; reason.push(`${label} grew ${value.toFixed(1)}% year-on-year.`); }
    else if (value < 0) { fundamental -= 12; reason.push(`${label} declined ${Math.abs(value).toFixed(1)}% year-on-year.`); }
  };
  growth(fundamentals.revenueGrowth, 'Revenue');
  growth(fundamentals.profitGrowth, 'Net profit');
  const compare = (company, sector, label) => {
    if (company === null || company === undefined || sector === null || sector === undefined) return;
    if (company - sector >= 1) { fundamental += 7; reason.push(`${label} (${company.toFixed(1)}%) is above the sector reference (${sector.toFixed(1)}%).`); }
    else if (company - sector <= -1) { fundamental -= 6; reason.push(`${label} (${company.toFixed(1)}%) is below the sector reference (${sector.toFixed(1)}%).`); }
  };
  compare(fundamentals.roe, fundamentals.sectorRoe, 'ROE');
  compare(fundamentals.roce, fundamentals.sectorRoce, 'ROCE');
  if (fundamentals.pe && fundamentals.sectorPe) {
    if (fundamentals.pe <= fundamentals.sectorPe) { fundamental += 7; reason.push(`P/E (${fundamentals.pe.toFixed(1)}x) is not above its sector reference (${fundamentals.sectorPe.toFixed(1)}x).`); }
    else if (fundamentals.pe > fundamentals.sectorPe * 1.35) { fundamental -= 8; reason.push(`P/E (${fundamentals.pe.toFixed(1)}x) is materially above its sector reference (${fundamentals.sectorPe.toFixed(1)}x).`); }
  }
  fundamental = clampScore(fundamental);
  return { technical, fundamental, score: clampScore(technical * .45 + fundamental * .55), reason };
}

function decodeXml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function tag(xml, name) { const match = String(xml || '').match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i')); return decodeXml(match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '') || ''); }
function googleNewsRows(xml, limit = 4) {
  return String(xml || '').match(/<item>[\s\S]*?<\/item>/gi)?.slice(0, limit).map(item => ({ title: tag(item, 'title'), url: tag(item, 'link'), date: tag(item, 'pubDate'), source: tag(item, 'source') || 'Google News' })).filter(item => item.title && item.url) || [];
}
async function googleNews(query) {
  const response = await fetchWithTimeout(`${GOOGLE_NEWS}?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }, 'News context', 6500);
  if (!response.ok) throw new Error(`News context returned ${response.status}`);
  return googleNewsRows(await response.text());
}
async function newsContext(symbol = '') {
  const now = Date.now();
  if (!symbol && marketNewsCache && now - newsCachedAt < 10 * 60 * 1000) return marketNewsCache;
  const [globalResult, companyResult] = await Promise.allSettled([
    googleNews('India stock market global markets RBI crude oil earnings'),
    symbol ? googleNews(`${symbol} NSE company news earnings`) : Promise.resolve([])
  ]);
  const value = {
    global: globalResult.status === 'fulfilled' ? globalResult.value : [],
    company: companyResult.status === 'fulfilled' ? companyResult.value : [],
    source: 'Google News headline context',
    note: 'Headlines are context for human review, not an automated sentiment score or a price forecast.',
    asOf: new Date().toISOString()
  };
  if (!symbol) { marketNewsCache = value; newsCachedAt = now; }
  return value;
}

async function upstoxIntradayHistory(instrumentKey){
  const payload=await upstox(`/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/minutes/5`);
  return (payload.data?.candles||[]).map(candle=>({time:String(candle[0]||''),open:number(candle[1]),high:number(candle[2]),low:number(candle[3]),close:number(candle[4]),volume:number(candle[5])})).filter(row=>row.close>0).sort((a,b)=>a.time.localeCompare(b.time));
}
async function upstoxHistoricalIntraday(instrumentKey){
  const to=new Date(),from=new Date(to);from.setDate(from.getDate()-21);
  const date=value=>value.toISOString().slice(0,10);
  const payload=await upstox("/v3/historical-candle/"+encodeURIComponent(instrumentKey)+"/minutes/5/"+date(to)+"/"+date(from));
  return (payload.data?.candles||[]).map(candle=>({time:String(candle[0]||''),open:number(candle[1]),high:number(candle[2]),low:number(candle[3]),close:number(candle[4]),volume:number(candle[5])})).filter(row=>row.close>0).sort((a,b)=>a.time.localeCompare(b.time));
}
function intradayBacktest(candles){
  const days=new Map();for(const candle of candles){const key=String(candle.time).slice(0,10);if(!days.has(key))days.set(key,[]);days.get(key).push(candle);}
  const trades=[];
  for(const [date,rows] of days){if(rows.length<14)continue;for(let index=7;index<rows.length-6;index++){const setup=intradaySetup({symbol:'BACKTEST',lastPrice:rows[index].close},rows.slice(0,index+1),{regime:'Mixed',advancePct:50,averageMove:0,sampleSize:0});if(!setup.qualifies)continue;const x=setup.intraday,forward=rows.slice(index+1,index+7);let entered=false,outcome='flat',exit=forward.at(-1)?.close||x.entry,maxAdverse=0;for(const bar of forward){if(!entered&&bar.high>=x.entry)entered=true;if(!entered)continue;maxAdverse=Math.max(maxAdverse,(x.entry-bar.low)/x.entry*100);if(bar.low<=x.stop&&bar.high>=x.target){outcome='loss';exit=x.stop;break;}if(bar.low<=x.stop){outcome='loss';exit=x.stop;break;}if(bar.high>=x.target){outcome='win';exit=x.target;break;}}if(!entered)continue;if(outcome==='flat')outcome=exit>x.entry?'win':exit<x.entry?'loss':'flat';trades.push({date,outcome,returnPct:(exit/x.entry-1)*100,maxAdverse});break;}}
  const samples=trades.length,wins=trades.filter(row=>row.outcome==='win').length,losses=trades.filter(row=>row.outcome==='loss').length,winRate=samples?wins/samples*100:0,averageReturn=samples?trades.reduce((sum,row)=>sum+row.returnPct,0)/samples:0,averageWin=wins?trades.filter(row=>row.outcome==='win').reduce((sum,row)=>sum+row.returnPct,0)/wins:0,averageLoss=losses?trades.filter(row=>row.outcome==='loss').reduce((sum,row)=>sum+row.returnPct,0)/losses:0,maxAdverse=samples?Math.max(...trades.map(row=>row.maxAdverse)):0;
  const label=samples<10?'INSUFFICIENT SAMPLE':winRate>=55&&averageReturn>0?'HISTORICALLY STRONG':winRate<45||averageReturn<=0?'HISTORICALLY POOR':'UNCERTAIN';
  return {available:samples>0,label,samples,wins,losses,winRate:Number(winRate.toFixed(1)),averageReturn:Number(averageReturn.toFixed(2)),averageWin:Number(averageWin.toFixed(2)),averageLoss:Number(averageLoss.toFixed(2)),maxAdverse:Number(maxAdverse.toFixed(2)),lookahead:'next 6 five-minute candles',note:'Walk-forward replay of the same completed-candle rules over up to 21 calendar days. Market-breadth history, brokerage and slippage are unavailable; same-candle stop/target conflicts are counted as losses.'};
}
function intradaySetup(stock,candles,marketContext={}){
  if(candles.length<8)return {...stock,qualifies:false,intraday:{available:false,status:'NOT READY',note:'At least eight completed 5-minute candles are required.',rejectionReasons:['Insufficient completed 5-minute candles.']}};
  const ema=(values,period)=>{const alpha=2/(period+1);return values.reduce((current,value,index)=>index?value*alpha+current*(1-alpha):value,values[0]);},closes=candles.map(row=>row.close),last=candles.at(-1),prior=candles.at(-2),opening=candles.slice(0,3),openingHigh=Math.max(...opening.map(row=>row.high)),openingLow=Math.min(...opening.map(row=>row.low)),sessionHigh=Math.max(...candles.map(row=>row.high)),ema9=ema(closes,9),ema21=ema(closes,21),volumeBase=candles.slice(-11,-1),averageVolume=volumeBase.reduce((sum,row)=>sum+row.volume,0)/(volumeBase.length||1),volumeRatio=averageVolume?last.volume/averageVolume:0,totalVolume=candles.reduce((sum,row)=>sum+row.volume,0),vwap=totalVolume?candles.reduce((sum,row)=>sum+((row.high+row.low+row.close)/3)*row.volume,0)/totalVolume:last.close,momentum=closes.length>=4?(last.close/closes.at(-4)-1)*100:0,aboveVwap=last.close>vwap,emaBullish=ema9>ema21,green=last.close>last.open,red=last.close<last.open,priorRed=prior.close<prior.open,body=Math.abs(last.close-last.open),upperWick=last.high-Math.max(last.open,last.close),nearHigh=(sessionHigh-last.close)/last.close<=.008,profitBookingSignal=red&&nearHigh&&upperWick>body*.7,profitBookingConfirmed=profitBookingSignal&&priorRed&&last.close<ema9,breakout=last.close>openingHigh&&green,pullbackLevel=Math.max(vwap,ema21),pullbackBounce=emaBullish&&aboveVwap&&last.low<=pullbackLevel*1.004&&last.close>pullbackLevel&&green,volumeConfirmed=volumeRatio>=1.10,notExtended=last.close<=vwap*1.035,marketSupportive=marketContext.regime!=='Weak',structure=emaBullish&&aboveVwap?'Bullish':emaBullish||aboveVwap?'Mixed':'Weak',setupType=breakout?'Closing-price breakout':pullbackBounce?'Pullback held and bounced':'No confirmed entry pattern';
  let score=18+(aboveVwap?15:0)+(emaBullish?15:0)+(breakout?20:0)+(pullbackBounce?18:0)+(volumeConfirmed?12:0)+(momentum>=.2?8:momentum>0?4:0)+(notExtended?7:-10)+(marketContext.regime==='Supportive'?6:marketContext.regime==='Weak'?-10:0)-(profitBookingSignal?8:0)-(profitBookingConfirmed?18:0);score=Math.max(0,Math.min(100,Math.round(score)));
  const entry=breakout?Math.max(last.high,openingHigh):last.high,holdLow=Math.min(vwap,ema21),holdHigh=Math.max(vwap,ema21),recentLow=Math.min(...candles.slice(-4).map(row=>row.low)),stop=Math.min(entry*.993,Math.min(recentLow,holdLow)),risk=Math.max(.01,entry-stop),target=entry+risk*1.8,rewardRisk=(target-entry)/risk,riskBudget=500,capitalCap=10000,quantity=Math.max(0,Math.min(Math.floor(riskBudget/risk),Math.floor(capitalCap/entry))),riskAtStop=quantity*risk,notional=quantity*entry;
  const gates={bullishStructure:structure==='Bullish',entryPattern:breakout||pullbackBounce,volume:volumeConfirmed,notExtended,profitBookingClear:!profitBookingConfirmed,rewardRisk:rewardRisk>=1.5,marketSupport:marketSupportive,positionSize:quantity>0},gateLabels={bullishStructure:'EMA 9, EMA 21 and VWAP are not fully bullish',entryPattern:'No completed breakout or pullback-bounce candle',volume:'Latest volume is below 1.10× recent average',notExtended:'Price is more than 3.5% above VWAP and may be stretched',profitBookingClear:'Selling follow-through invalidated the long setup',rewardRisk:'Reward/risk is below 1.5×',marketSupport:'Broad-market breadth is weak',positionSize:'Risk is too large for the illustrative ₹500 risk budget'},rejectionReasons=Object.entries(gates).filter(([,passed])=>!passed).map(([key])=>gateLabels[key]),qualifies=score>=72&&Object.values(gates).every(Boolean),status=qualifies?'ENTRY CONFIRMED':profitBookingConfirmed||structure==='Weak'?'SETUP FAILED':breakout||pullbackBounce||score>=60?'WATCHING':'NOT READY';
  const reasons=[`Overall intraday structure is ${structure.toLowerCase()}.`,breakout?`A completed 5-minute candle closed above the opening-range high (${openingHigh.toFixed(2)}).`:pullbackBounce?'Price tested the VWAP/EMA hold area and closed back above it.':'No completed breakout or bounce candle yet.',volumeConfirmed?`Latest volume is ${volumeRatio.toFixed(1)}× its recent average.`:'Volume has not confirmed the move.',`Broad-market breadth is ${marketContext.regime?.toLowerCase()||'unavailable'} (${Number(marketContext.advancePct||0).toFixed(0)}% of screened stocks advancing).`,profitBookingSignal?'The latest candle shows an early profit-booking warning near the session high.':'No strong profit-booking candle is confirmed.',profitBookingConfirmed?'Two-candle selling follow-through invalidates the long setup.':`The ${holdLow.toFixed(2)}–${holdHigh.toFixed(2)} area is the must-hold zone.`];
  const decision=qualifies?`${setupType} is confirmed only above ${entry.toFixed(2)} while VWAP, EMA and market breadth remain supportive.`:profitBookingConfirmed?'The setup failed. Avoid a long entry until price reclaims EMA 9 and VWAP.':status==='WATCHING'?`The pattern is developing, but ${rejectionReasons[0]?.toLowerCase()||'one or more confirmation gates are missing'}.`:`Wait for a completed green candle above ${openingHigh.toFixed(2)} or a confirmed bounce from the hold zone.`;
  return {...stock,qualifies,intraday:{available:true,status,score,setupType,structure,decision,entry,stop,target,rewardRisk,quantity,riskBudget,riskAtStop,notional,exitRule:'Close the position before the NSE cash-session close; this setup is not carried overnight.',openingHigh,openingLow,vwap,ema9,ema21,holdLow,holdHigh,volumeRatio,momentum,profitBookingSignal,profitBookingConfirmed,lastTime:last.time,reasons,rejectionReasons,gates,marketContext}};
}async function intradayRecommendations(){
  if(!UPSTOX_ANALYTICS_TOKEN)throw new Error('Intraday setups require the configured Upstox token.');
  const [quotes,instruments]=await Promise.all([upstoxQuotes(FALLBACK_NIFTY_UNIVERSE),upstoxInstruments()]);
  const usable=quotes.filter(stock=>Number.isFinite(Number(stock.pChange))),advancePct=usable.length?usable.filter(stock=>Number(stock.pChange)>0).length/usable.length*100:0,averageMove=usable.length?usable.reduce((sum,stock)=>sum+Number(stock.pChange||0),0)/usable.length:0,regime=advancePct>=58&&averageMove>0?'Supportive':advancePct<42&&averageMove<0?'Weak':'Mixed',marketContext={regime,advancePct,averageMove,sampleSize:usable.length};
  const candidates=quotes.sort((a,b)=>Math.abs(Number(b.pChange||0))-Math.abs(Number(a.pChange||0))).slice(0,18);
  const evaluated=await Promise.all(candidates.map(async stock=>{const instrument=instruments.get(stock.symbol);if(!instrument)return intradaySetup(stock,[],marketContext);try{return intradaySetup(stock,await upstoxIntradayHistory(instrument.instrumentKey),marketContext);}catch(error){return {...stock,qualifies:false,intraday:{available:false,status:'NOT READY',note:error.message,rejectionReasons:[error.message]}};}}));
  let ranked=evaluated.filter(stock=>stock.intraday?.available).sort((a,b)=>b.intraday.score-a.intraday.score);const replayed=await mapWithConcurrency(ranked.slice(0,8),3,async stock=>{const instrument=instruments.get(stock.symbol);if(!instrument)return stock;try{return {...stock,intraday:{...stock.intraday,backtest:intradayBacktest(await upstoxHistoricalIntraday(instrument.instrumentKey))}};}catch(error){return {...stock,intraday:{...stock.intraday,backtest:{available:false,label:'BACKTEST UNAVAILABLE',samples:0,note:error.message}}};}});const replayMap=new Map(replayed.flatMap(result=>result.value?[[result.value.symbol,result.value]]:[]));ranked=ranked.map(stock=>replayMap.get(stock.symbol)||stock);const setups=ranked.filter(stock=>stock.qualifies).slice(0,3),nearMisses=ranked.filter(stock=>!stock.qualifies).slice(0,5).map((stock,index)=>({...stock,rank:index+1,rankExplanation:index===0?'Closest setup to confirmation among rejected candidates.':`${ranked[0].symbol} ranks higher because it has a stronger combination of structure, volume, pattern and market support.`}));
  return {setups,nearMisses,marketContext,screenedCount:quotes.length,deepScreenedCount:evaluated.length,qualifiedCount:evaluated.filter(stock=>stock.qualifies).length,asOf:new Date().toISOString(),method:'Same-day 5-minute screen. A Top 3 place requires bullish EMA/VWAP structure, a completed breakout or pullback bounce, volume of at least 1.10× recent average, acceptable extension, no confirmed profit-booking reversal, reward/risk of at least 1.5×, supportive or mixed market breadth, and a viable risk-sized quantity. No setup means no trade.'};
}async function researchRecommendations() {
  if (!UPSTOX_ANALYTICS_TOKEN) throw new Error('Research candidates require the configured Upstox Analytics Token.');
  const [quotes, news, instruments] = await Promise.all([upstoxQuotes(FALLBACK_NIFTY_UNIVERSE), newsContext(), upstoxInstruments()]);
  const candidates = quotes
    .map(stock => ({ ...stock, preliminaryTechnical: researchScore(stock).technical }))
    .sort((a, b) => b.preliminaryTechnical - a.preliminaryTechnical || Number(b.pChange || 0) - Number(a.pChange || 0))
    .slice(0, 15);
  const enriched = await Promise.all(candidates.map(async base => {
    const instrument = instruments.get(base.symbol);
    let history = [], fundamentals = { available: false, note: 'Fundamental data was unavailable.' };
    if (instrument) {
      const results = await Promise.allSettled([upstoxDailyHistory(instrument.instrumentKey), upstoxFundamentals(instrument)]);
      if (results[0].status === 'fulfilled') history = results[0].value;
      if (results[1].status === 'fulfilled') fundamentals = results[1].value;
    }
    const recent=history.slice(-20).map(row=>Number(row.close)).filter(value=>value>0),last=Number(base.lastPrice||recent.at(-1)||0),marketThesis=recent.length?{support:Math.min(...recent),resistance:Math.max(...recent),trend:recent[0]?(last/recent[0]-1)*100:0}:null;
    const stock = { ...base, fundamentals, ml: mlOutlook(history), marketThesis };
    const model = researchScore(stock);
    const reasons = [...model.reason, Number(stock.pChange || 0) >= 0 ? `Latest session change is ${Number(stock.pChange || 0).toFixed(2)}%, supporting near-term momentum.` : `Latest session change is ${Number(stock.pChange || 0).toFixed(2)}%, so timing risk remains.`].slice(0, 4);
    const quantity = stock.lastPrice ? Math.max(1, Math.floor(10000 / stock.lastPrice)) : 0;
    const mlUsable=!stock.ml.available||stock.ml.accuracy<40||stock.ml.up>=stock.ml.down;
    const qualification={score:model.score>=72,technical:model.technical>=60,fundamental:model.fundamental!==null&&model.fundamental>=60,constructiveTrend:Number(marketThesis?.trend||0)>0,mlNotBearish:mlUsable};
    const qualifies=Object.values(qualification).every(Boolean);
    const failed=Object.entries(qualification).filter(([,passed])=>!passed).map(([name])=>name);
    return { ...stock, model, quantity, notional: quantity * Number(stock.lastPrice || 0), reasons, qualifies, failed };
  }));
  return {
    recommendations: enriched.filter(stock => stock.qualifies).sort((a, b) => b.model.score - a.model.score).slice(0, 3),
    screenedCount: quotes.length,
    deepScreenedCount: enriched.length,
    qualifiedCount: enriched.filter(stock => stock.qualifies).length,
    source: 'Upstox full-universe NSE screening',
    asOf: new Date().toISOString(),
    newsContext: news,
    allocationNote: 'Illustrative quantity uses a fixed ₹10,000 research budget per idea. It is not a personal investment recommendation.',
    method: 'Strict BUY qualification: composite score 72+, technical score 60+, fundamental score 60+, constructive 20-day structure, and no bearish ML veto when validation is usable. Fewer than three stocks are shown when fewer qualify.'
  };
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
  const results = await mapWithConcurrency(universe, 8, async symbol => sectorSnapshot(await resilientStock(symbol)));
  const leaders = results.flatMap(result => result.value ? [result.value] : []);
  if (!leaders.length) {
    if (cached?.value) return { ...cached.value, delayed: true, providerNotice: 'Saved sector data is shown because no live symbol completed successfully. Refresh later for a current ranking.' };
    throw new Error(`None of the ${universe.length} sector symbols returned usable market data.`);
  }
  const sources = [...new Set(leaders.map(stock => stock.dataSource).filter(Boolean))];
  const partial = leaders.length < universe.length;
  const value = {
    sector: key,
    universeCount: leaders.length,
    requestedCount: universe.length,
    leaders: leaders.sort((a, b) => b.pChange - a.pChange).slice(0, 10),
    asOf: new Date().toISOString(),
    source: sources.length === 1 ? sources[0] : 'Mixed market-data sources',
    fallback: leaders.some(stock => /fallback/i.test(String(stock.dataSource || ''))),
    partial,
    providerNotice: `${partial?`Partial live basket: ${leaders.length} of ${universe.length} symbols returned usable data. `:''}${UPSTOX_ANALYTICS_TOKEN
      ? 'Sector baskets use Upstox read-only NSE market data first, with NSE and free fallbacks if needed. Trend and 12-month figures are bounded scenarios, not price targets.'
      : 'Sector baskets use NSE public data first and daily NSE-symbol fallback data when it is unavailable. Trend and 12-month figures are bounded scenarios, not price targets.'}`
  };
  sectorCache.set(key, { at: Date.now(), value });
  return value;
}
async function symbolSuggestions(query){const term=String(query||'').toUpperCase().replace(/[^A-Z0-9& -]/g,' ').trim();if(term.length<2)return {matches:[]};let directory,source='Upstox NSE equity instrument directory';try{directory=[...(await upstoxInstruments()).values()];}catch{const symbols=[...new Set([...FALLBACK_NIFTY_UNIVERSE,...Object.values(SECTOR_UNIVERSES).flat()])];directory=symbols.map(symbol=>({symbol,name:symbol}));source='Configured NSE fallback universe';}const rows=directory.map(item=>({...item,symbolText:item.symbol.toUpperCase(),nameText:String(item.name||'').toUpperCase()})),rank=item=>item.symbolText===term?0:item.symbolText.startsWith(term)?1:item.nameText.startsWith(term)?2:item.symbolText.includes(term)?3:item.nameText.includes(term)?4:99,matches=rows.map(item=>({item,rank:rank(item)})).filter(row=>row.rank<99).sort((a,b)=>a.rank-b.rank||a.item.symbol.localeCompare(b.item.symbol)).slice(0,10).map(row=>({symbol:row.item.symbol,name:row.item.name}));return {matches,query:term,source};}

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
  const query = String(event.queryStringParameters?.q || '').slice(0, 60);
  if (type === 'symbols') { try { return json(200, await symbolSuggestions(query), 'public, max-age=3600'); } catch (error) { return json(503, { error: 'Ticker suggestions are temporarily unavailable', detail: error.message }); } }
  if (type === 'updates') return json(200, await marketUpdates(), 'public, max-age=60');
  if (type === 'news') {
    try { return json(200, await newsContext(symbol), 'public, max-age=300'); }
    catch (error) { return json(200, { global: [], company: [], source: 'News context temporarily unavailable', note: error.message, asOf: new Date().toISOString() }, 'public, max-age=60'); }
  }
  if (type === 'intraday') {
    try { return json(200, await intradayRecommendations(), 'public, max-age=20'); }
    catch (error) { return json(503, { error: 'Intraday setups are temporarily unavailable', detail: error.message }); }
  }
  if (type === 'recommendations') {
    try { return json(200, await researchRecommendations(), 'public, max-age=90'); }
    catch (error) { return json(503, { error: 'Research candidates are temporarily unavailable', detail: error.message, retryAfterSeconds: 90 }); }
  }
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




