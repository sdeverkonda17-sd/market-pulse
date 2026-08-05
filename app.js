const $ = selector => document.querySelector(selector);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const percent = value => `${value >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const LEADERS_CACHE_KEY = 'market-pulse-nse-leaders-v27';
const STOCK_CACHE_PREFIX = 'market-pulse-nse-stock-v27:';
const state = { leaders: [], selected: null, universeCount: 0 };

function safe(text) {
  return String(text ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? safe(url.href) : '#';
  } catch { return '#'; }
}

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* A full private-mode store is not fatal. */ }
}

async function api(type, symbol = '') {
  const url = `/api/market?type=${encodeURIComponent(type)}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`;
  const response = await fetch(url, { cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch { /* A non-JSON provider response is handled below. */ }
  if (!response.ok) throw new Error(payload?.detail || payload?.error || `Market-data request failed (${response.status})`);
  return payload;
}

function scoreStock(stock) {
  const move = Number(stock.pChange || 0);
  const range = Math.max(0, Number(stock.dayHigh || stock.lastPrice) - Number(stock.dayLow || stock.lastPrice));
  const rangePct = stock.lastPrice ? range / stock.lastPrice * 100 : 0;
  const nearHigh = stock.yearHigh ? stock.lastPrice / stock.yearHigh : 1;
  let score = 50
    + (move >= 2 ? 28 : move >= 1 ? 18 : move > 0 ? 9 : move <= -2 ? -28 : move < 0 ? -14 : 0)
    + (rangePct < 2 ? 8 : rangePct > 5 ? -9 : 0)
    + (nearHigh > .92 ? 7 : nearHigh < .7 ? -7 : 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...stock,
    score,
    signal: score >= 70 ? 'BUY' : score >= 45 ? 'HOLD' : 'REDUCE',
    risk: rangePct > 5 ? 'High' : rangePct > 2.5 ? 'Moderate' : 'Lower',
    rangePct
  };
}

function renderLeaders() {
  const leaders = state.leaders;
  $('#stock-table').innerHTML = leaders.map((stock, index) => `
    <tr>
      <td>${index + 1}</td>
      <td class="company">${safe(stock.symbol)}<small>${safe(stock.name)}</small></td>
      <td>${money.format(stock.lastPrice)}</td>
      <td class="${stock.pChange >= 0 ? 'positive' : 'negative'}">${percent(stock.pChange)}</td>
      <td><span class="signal ${stock.signal}">${stock.signal}</span></td>
      <td><span class="risk-badge">${stock.risk}</span></td>
      <td><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button></td>
    </tr>`).join('');
  $('#universe-count').textContent = state.universeCount || '-';
  $('#buy-count').textContent = leaders.filter(stock => stock.signal === 'BUY').length;
  $('#top-mover').textContent = leaders[0] ? `${leaders[0].symbol} ${percent(leaders[0].pChange)}` : '-';
}

function renderNseUnavailable(detail) {
  $('#stock-table').innerHTML = `<tr><td colspan="7" class="connection-note"><strong>Live market data is temporarily delayed.</strong><br>${safe(detail)}<br><a href="https://www.nseindia.com/market-data/live-equity-market?symbol=NIFTY%2050" target="_blank" rel="noopener">View the official NSE market page</a>, then tap Refresh here in a minute.</td></tr>`;
  $('#market-status').textContent = 'NSE and fallback connection delayed - dashboard remains available';
  $('#data-note').textContent = 'No saved market result is available on this device yet.';
}

function renderMarketStatus(status) {
  const label = $('#trading-status');
  const detail = $('#trading-detail');
  if (!label || !detail) return;
  if (!status) {
    label.textContent = 'Status unavailable';
    detail.textContent = 'Unable to load the market schedule.';
    return;
  }
  label.textContent = status.label;
  label.className = `session-status session-${String(status.label || 'closed').toLowerCase()}`;
  detail.textContent = `${status.detail} ${status.asOf ? `(${status.asOf})` : ''}`;
}

function renderUpdates(data) {
  renderMarketStatus(data.marketStatus);
  const note = $('#updates-note');
  const list = $('#updates-list');
  if (!note || !list) return;
  note.textContent = data.source || 'Market updates';
  const updates = Array.isArray(data.announcements) ? data.announcements : [];
  list.innerHTML = updates.length
    ? updates.map(item => `<a class="update-row" href="${safeUrl(item.url)}" target="_blank" rel="noopener"><strong>${safe(item.symbol)}</strong><span>${safe(item.title)}</span><small>${safe(item.date || 'NSE disclosure')}</small></a>`).join('')
    : `<p class="updates-empty">${safe(data.detail || 'No recent exchange announcements were returned. Try again shortly.')}</p>`;
}

async function loadUpdates() {
  const list = $('#updates-list');
  if (list) list.innerHTML = '<p class="updates-empty">Loading exchange announcements…</p>';
  try {
    renderUpdates(await api('updates'));
  } catch (error) {
    renderUpdates({ source: 'Updates temporarily unavailable', detail: error.message });
  }
}

async function refresh() {
  const button = $('#refresh');
  button.disabled = true;
  button.textContent = 'Loading market data...';
  $('#market-status').textContent = 'Refreshing NSE market data...';
  void loadUpdates();
  try {
    const data = await api('leaders');
    const leaders = (data.leaders || []).map(scoreStock).filter(stock => stock.lastPrice > 0);
    if (!leaders.length) throw new Error('The market-data source returned no usable prices');
    state.universeCount = data.universeCount || leaders.length;
    state.leaders = leaders;
    const sourceLabel = $('#data-source');
    if (sourceLabel) sourceLabel.textContent = data.source || 'NSE';
    writeCache(LEADERS_CACHE_KEY, { leaders: data.leaders, universeCount: state.universeCount, savedAt: data.savedAt || data.asOf || new Date().toISOString(), source: data.source, fallback: Boolean(data.fallback) });
    renderLeaders();
    if (data.fallback) {
      $('#market-status').textContent = `NSE unavailable - using ${data.source}`;
      $('#data-note').textContent = `${data.providerNotice || 'Fallback data is displayed.'} Verify important prices and disclosures on NSE before trading.`;
    } else if (data.delayed) {
      const saved = data.savedAt ? new Date(data.savedAt) : null;
      $('#market-status').textContent = `NSE delayed - showing saved server result${saved ? ` from ${saved.toLocaleString()}` : ''}`;
      $('#data-note').textContent = 'Prices are saved NSE values, not a fresh market snapshot. Refresh again shortly.';
    } else {
      $('#market-status').textContent = `NSE updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      $('#data-note').textContent = `Top daily movers from ${state.universeCount} NIFTY 50 constituents`;
    }
  } catch (error) {
    const cached = readCache(LEADERS_CACHE_KEY);
    if (cached?.leaders?.length) {
      state.universeCount = cached.universeCount || cached.leaders.length;
      state.leaders = cached.leaders.map(scoreStock);
      renderLeaders();
      const saved = cached.savedAt ? new Date(cached.savedAt) : null;
      const source = cached.source || 'NSE';
      const sourceLabel = $('#data-source');
      if (sourceLabel) sourceLabel.textContent = source;
      $('#market-status').textContent = `Market feed delayed - showing this device's saved ${source} result${saved ? ` from ${saved.toLocaleString()}` : ''}`;
      $('#data-note').textContent = cached.fallback ? 'Saved fallback-provider data is displayed. Confirm important decisions on NSE.' : 'Saved NSE data is displayed until the live NSE connection returns.';
    } else {
      renderNseUnavailable(error.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh market data';
  }
}

function historicalMetrics(stock) {
  const history = Array.isArray(stock.history) ? stock.history.filter(point => Number.isFinite(point.close)) : [];
  const closes = history.map(point => point.close);
  const support = closes.length ? Math.min(...closes.slice(-20)) : stock.dayLow;
  const resistance = closes.length ? Math.max(...closes.slice(-20)) : stock.dayHigh;
  const returns = closes.slice(1).map((value, index) => Math.log(value / closes[index]));
  const volatility = returns.length ? Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) * Math.sqrt(252) * 100 : stock.rangePct * 6;
  const trend = closes.length > 20 ? (closes.at(-1) / closes[Math.max(0, closes.length - 20)] - 1) * 100 : stock.pChange;
  const base = Math.max(-35, Math.min(45, trend * 1.4 - volatility * .08));
  return { ...stock, support, resistance, volatility, trend, base, bull: Math.min(80, base + Math.max(12, volatility * .5)), bear: Math.max(-60, base - Math.max(12, volatility * .5)) };
}

function chart(metrics) {
  const data = (metrics.history || []).slice(-120);
  if (data.length < 2) return '<p class="detail-section">Historical chart data is delayed for this symbol. Current support and resistance are still shown.</p>';
  const values = data.map(point => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 640, h = 230, p = 18;
  const coordinate = (value, index) => [p + index * (w - p * 2) / (values.length - 1), h - p - (value - min) * (h - p * 2) / (max - min || 1)];
  const points = values.map((value, index) => coordinate(value, index).join(',')).join(' ');
  const area = `${p},${h - p} ${points} ${w - p},${h - p}`;
  return `<div class="chart-shell"><svg class="price-chart" viewBox="0 0 ${w} ${h}" data-chart="${safe(metrics.symbol)}"><defs><linearGradient id="fill-${safe(metrics.symbol)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13795b" stop-opacity=".3"/><stop offset="1" stop-color="#13795b" stop-opacity="0"/></linearGradient></defs><path d="M ${area} Z" fill="url(#fill-${safe(metrics.symbol)})"/><line x1="${p}" x2="${w - p}" y1="${p}" y2="${p}" stroke="currentColor" opacity=".12"/><line x1="${p}" x2="${w - p}" y1="${h / 2}" y2="${h / 2}" stroke="currentColor" opacity=".12"/><line x1="${p}" x2="${w - p}" y1="${h - p}" y2="${h - p}" stroke="currentColor" opacity=".12"/><polyline points="${points}" fill="none" stroke="#13795b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><line class="crosshair" x1="0" x2="0" y1="${p}" y2="${h - p}" stroke="#a76610" stroke-width="1.5" visibility="hidden"/><circle class="point" r="5" fill="#a76610" visibility="hidden"/><text x="${p}" y="${p + 12}" fill="currentColor" font-size="11">High ${money.format(max)}</text><text x="${p}" y="${h - p - 3}" fill="currentColor" font-size="11">Low ${money.format(min)}</text></svg><div class="chart-tip"></div></div>`;
}

function reviewContent(metrics) {
  const source = safe(metrics.dataSource || 'NSE');
  return `<div class="modal-body"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} - ${source} last price ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Daily movement</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>Momentum score</span><strong>${metrics.score}/100</strong></article><article><span>Trend (20 days)</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article><article><span>Risk</span><strong>${metrics.risk}</strong></article></div><div class="review-grid"><section class="detail-section"><h3>Why this ${metrics.signal} signal?</h3><ul><li>Today's ${source} move is <b>${percent(metrics.pChange)}</b>; stronger positive momentum adds to the score.</li><li>Current daily range is <b>${metrics.rangePct.toFixed(2)}%</b>; wider ranges increase trading risk.</li><li>The price is ${metrics.yearHigh ? `${(metrics.lastPrice / metrics.yearHigh * 100).toFixed(1)}% of its 52-week high` : 'being evaluated from its current range'}.</li><li>Score 70+ is a BUY momentum setup; 45-69 is HOLD/watch; below 45 is REDUCE.</li></ul><div class="levels"><div><span>Support</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div><div><span>52-week low</span><strong>${money.format(metrics.yearLow || 0)}</strong></div></div></section><section class="detail-section"><h3>Profit / loss scenario</h3><p>Modelled from recent ${source} price trend and volatility. It is not a price target.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units to estimate 6- and 12-month base, bull, and bear outcomes.</div></section></div><section class="detail-section"><h3>Price trend</h3>${chart(metrics)}</section><section class="detail-section announcements"><h3>${safe(metrics.symbol)} company disclosures</h3><div id="announcements">Loading company disclosures...</div></section></div>`;
}

function setCalculator(metrics) {
  const button = $('#calculate-return');
  if (!button) return;
  button.addEventListener('click', () => {
    const units = Math.max(1, Number($('#units-input').value) || 1);
    const investment = metrics.lastPrice * units;
    const scenario = (label, annual) => {
      const six = (Math.pow(1 + annual / 100, .5) - 1) * 100;
      return `${label}: ${percent(six)} - ${money.format(investment * (1 + six / 100))} after 6 months`;
    };
    $('#calc-result').innerHTML = `<strong>Current investment: ${money.format(investment)}</strong><br>${scenario('Base', metrics.base)}<br>${scenario('Bull', metrics.bull)}<br>${scenario('Bear', metrics.bear)}<br><small>12-month base scenario: ${percent(metrics.base)}. Outcomes can differ materially.</small>`;
  });
}

function compoundedReturn(annualReturn, months) {
  return (Math.pow(1 + annualReturn / 100, months / 12) - 1) * 100;
}

function renderInvestmentScenario(metrics, units) {
  const investment = metrics.lastPrice * units;
  const periods = [1, 3, 6, 12];
  const outcome = (annualReturn, months) => {
    const growth = compoundedReturn(annualReturn, months);
    return { growth, value: investment * (1 + growth / 100) };
  };
  const row = months => {
    const base = outcome(metrics.base, months);
    const bull = outcome(metrics.bull, months);
    const bear = outcome(metrics.bear, months);
    return `<tr><td>${months} month${months === 1 ? '' : 's'}</td><td class="${base.growth >= 0 ? 'positive' : 'negative'}">${percent(base.growth)}<small>${money.format(base.value)}</small></td><td class="positive">${percent(bull.growth)}<small>${money.format(bull.value)}</small></td><td class="negative">${percent(bear.growth)}<small>${money.format(bear.value)}</small></td></tr>`;
  };
  $('#investment-result').innerHTML = `<div class="investment-summary"><div><span>Current price per unit</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Units</span><strong>${units}</strong></div><div><span>Initial investment</span><strong>${money.format(investment)}</strong></div><div><span>Signal / risk</span><strong>${safe(metrics.signal)} · ${safe(metrics.risk)}</strong></div></div><table class="scenario-table"><thead><tr><th>Period</th><th>Base estimate</th><th>Bull case</th><th>Bear case</th></tr></thead><tbody>${periods.map(row).join('')}</tbody></table><p>Based on ${safe(metrics.dataSource || 'market')} price trend and volatility. Values are estimates, exclude brokerage/taxes, and are not guaranteed returns.</p>`;
}

function bindChart(metrics) {
  const svg = $('.price-chart');
  if (!svg || !metrics.history?.length) return;
  const tip = $('.chart-tip');
  const cross = svg.querySelector('.crosshair');
  const point = svg.querySelector('.point');
  const data = metrics.history.slice(-120);
  const w = 640, p = 18, h = 230;
  const values = data.map(item => item.close);
  const min = Math.min(...values), max = Math.max(...values);
  const move = event => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX; pt.y = event.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const index = Math.max(0, Math.min(data.length - 1, Math.round((loc.x - p) * (data.length - 1) / (w - p * 2))));
    const x = p + index * (w - p * 2) / (data.length - 1);
    const y = h - p - (data[index].close - min) * (h - p * 2) / (max - min || 1);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    point.setAttribute('cx', x); point.setAttribute('cy', y); point.setAttribute('visibility', 'visible');
    tip.style.left = `${event.offsetX}px`; tip.style.top = `${event.offsetY}px`; tip.style.opacity = '1';
    tip.textContent = `${data[index].date} - ${money.format(data[index].close)}`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.style.opacity = '0'; cross.setAttribute('visibility', 'hidden'); point.setAttribute('visibility', 'hidden'); });
}

function fillReview(raw, symbol, usingSavedData = false) {
  const fallback = state.leaders.find(item => item.symbol === symbol) || {};
  const metrics = historicalMetrics(scoreStock({ ...fallback, ...raw.stock, history: raw.history || [] }));
  state.selected = metrics;
  $('#modal-kicker').textContent = `${metrics.symbol} - ${usingSavedData ? 'SAVED ' : ''}${metrics.dataSource || 'MARKET DATA'} STOCK REVIEW`;
  $('#modal-content').innerHTML = reviewContent(metrics);
  setCalculator(metrics);
  bindChart(metrics);
  const panel = $('#announcements');
  panel.innerHTML = (raw.announcements || []).slice(0, 4).map(item => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${safe(item.title)}<small>${safe(item.date || 'NSE disclosure')}</small></a>`).join('') || '<p>No recent company disclosures were returned for this ticker.</p>';
}

async function openReview(symbol) {
  const ticker = String(symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (!ticker) return;
  const modal = $('#review-modal');
  $('#modal-content').innerHTML = '<div class="modal-body">Loading stock review...</div>';
  if (!modal.open) modal.showModal();
  try {
    const raw = await api('stock', ticker);
    if (!raw?.stock?.lastPrice) throw new Error('The market-data source returned no current price for this ticker');
    writeCache(`${STOCK_CACHE_PREFIX}${ticker}`, { raw, savedAt: new Date().toISOString() });
    fillReview(raw, ticker);
  } catch (error) {
    const cached = readCache(`${STOCK_CACHE_PREFIX}${ticker}`);
    const fallback = state.leaders.find(item => item.symbol === ticker);
    if (cached?.raw?.stock) {
      fillReview(cached.raw, ticker, true);
      $('#market-status').textContent = `Market feed delayed - review uses this device's saved ${ticker} result`;
    } else if (fallback?.lastPrice) {
      fillReview({ stock: fallback, history: [], announcements: [] }, ticker, true);
      $('#market-status').textContent = `Market feed delayed - review uses the saved top-10 ${ticker} quote`;
    } else {
      $('#modal-content').innerHTML = `<div class="modal-body"><h2>Stock review is temporarily delayed</h2><p>${safe(error.message)}. The dashboard is still responsive; try this ticker again shortly.</p><p><a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(ticker)}" target="_blank" rel="noopener">Open ${safe(ticker)} on the official NSE website</a></p></div>`;
    }
  }
}

function cleanTicker(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
}

function extractTicker(question) {
  const blocked = new Set(['A', 'ADVICE', 'AN', 'AND', 'ANY', 'ARE', 'ASK', 'AT', 'ABOUT', 'ANALYSE', 'ANALYSIS', 'ANNOUNCEMENT', 'ANNOUNCEMENTS', 'BAD', 'BE', 'BEST', 'BUY', 'CAN', 'COMPANY', 'COULD', 'CURRENT', 'DETAILS', 'DID', 'DO', 'DOES', 'EARNINGS', 'EQUITY', 'EXPLAIN', 'FOR', 'FORECAST', 'FROM', 'FUNDAMENTAL', 'GIVE', 'GOOD', 'HIGH', 'HOLD', 'HOW', 'I', 'IN', 'INVEST', 'INVESTING', 'IS', 'IT', 'LOSS', 'LOW', 'MARKET', 'MAY', 'ME', 'MONTH', 'MY', 'NEWS', 'NSE', 'OF', 'ON', 'PLEASE', 'PREDICTION', 'PRICE', 'PROFIT', 'RESISTANCE', 'RETURN', 'RETURNS', 'RISK', 'SCENARIO', 'SCORE', 'SHOULD', 'SHOW', 'SIGNAL', 'STOCK', 'SUPPORT', 'THE', 'THIS', 'TELL', 'TICKER', 'TODAY', 'TO', 'TREND', 'WE', 'WHAT', 'WHICH', 'WHY', 'WILL', 'WITH', 'WOULD', 'YOUR']);
  const words = String(question || '').toUpperCase().match(/[A-Z][A-Z0-9&-]{1,29}/g) || [];
  return [...words].reverse().find(word => !blocked.has(word)) || '';
}

async function loadAssistantStock(symbol) {
  const ticker = cleanTicker(symbol);
  if (!ticker) return null;
  try {
    const raw = await api('stock', ticker);
    if (!raw?.stock?.lastPrice) throw new Error('The market-data source returned no current price');
    writeCache(`${STOCK_CACHE_PREFIX}${ticker}`, { raw, savedAt: new Date().toISOString() });
    const fallback = state.leaders.find(item => item.symbol === ticker) || {};
    state.selected = historicalMetrics(scoreStock({ ...fallback, ...raw.stock, history: raw.history || [] }));
    return state.selected;
  } catch (error) {
    const cached = readCache(`${STOCK_CACHE_PREFIX}${ticker}`);
    const fallback = state.leaders.find(item => item.symbol === ticker);
    if (cached?.raw?.stock) {
      state.selected = historicalMetrics(scoreStock({ ...cached.raw.stock, history: cached.raw.history || [] }));
      return state.selected;
    }
    if (fallback?.lastPrice) {
      state.selected = historicalMetrics(scoreStock({ ...fallback, history: [] }));
      return state.selected;
    }
    throw error;
  }
}

function assistantReply(question, stock = state.selected) {
  const q = question.toLowerCase();
  if (!stock) {
    if (q.includes('support') || q.includes('resistance')) return 'Support is a price zone where buying has recently appeared; resistance is a zone where selling has appeared. Enter an NSE ticker to calculate its current levels.';
    if (q.includes('risk') || q.includes('volatility')) return 'Risk describes how widely a stock price can move. This dashboard marks a wider daily price range as higher trading risk. Enter a ticker for its current risk reading.';
    if (q.includes('score') || q.includes('signal') || q.includes('buy') || q.includes('hold')) return 'The signal score starts at 50, then adds or subtracts points for today\'s price move, the width of today\'s trading range, and the distance from the 52-week high. 70+ is BUY, 45-69 is HOLD, and below 45 is REDUCE. Enter a ticker for a live score.';
    if (q.includes('profit') || q.includes('return') || q.includes('scenario') || q.includes('month')) return 'A scenario is an estimate, not a promise. The dashboard uses recent trend and volatility to show base, bull, and bear 6- and 12-month outcomes after you enter a ticker and units.';
    return 'I can help with any NSE ticker or a general market question. Enter a ticker above, or write it in your question, for example: "MTARTECH - explain risk".';
  }
  const source = stock.dataSource || 'NSE';
  if (q.includes('support') || q.includes('resistance')) return `${stock.symbol}: support is ${money.format(stock.support)} and resistance is ${money.format(stock.resistance)}. These are recent ${source} price levels, not guarantees.`;
  if (q.includes('risk') || q.includes('volatility')) return `${stock.symbol} is marked ${stock.risk} risk because its current daily range is ${stock.rangePct.toFixed(2)}%. Wider ranges mean larger potential daily swings.`;
  if (q.includes('profit') || q.includes('return') || q.includes('scenario') || q.includes('month')) return `${stock.symbol}'s 12-month base scenario is ${percent(stock.base)}. Open Review to use the calculator with your units for base, bull, and bear outcomes.`;
  if (q.includes('score') || q.includes('signal') || q.includes('why') || q.includes('buy') || q.includes('hold')) return `${stock.symbol} is ${stock.signal} at ${stock.score}/100. Today's ${source} move is ${percent(stock.pChange)}, its daily range is ${stock.rangePct.toFixed(2)}%, and it is ${stock.yearHigh ? `${(stock.lastPrice / stock.yearHigh * 100).toFixed(1)}% of its 52-week high` : 'being evaluated from its current range'}.`;
  if (q.includes('trend') || q.includes('price')) return `${stock.symbol} last price is ${money.format(stock.lastPrice)}. Its recent trend is ${percent(stock.trend)} and today it moved ${percent(stock.pChange)}.`;
  if (q.includes('news') || q.includes('announcement')) return `Open Review for ${stock.symbol} to see company announcements when NSE returns them, and verify material information in the disclosure itself.`;
  return `For ${stock.symbol}, ask about its signal, score, trend, price, support/resistance, risk, NSE announcements, or scenario.`;
}

function addChat(text, kind) {
  const message = document.createElement('p');
  message.className = kind === 'user' ? 'user-message' : 'assistant-message';
  message.textContent = text;
  $('#chat-history').append(message);
  $('#chat-history').scrollTop = $('#chat-history').scrollHeight;
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-review]');
  if (button) openReview(button.dataset.review);
});

$('#refresh').addEventListener('click', refresh);
$('#theme-toggle').addEventListener('click', () => document.body.classList.toggle('night'));
$('#ticker-form').addEventListener('submit', event => { event.preventDefault(); openReview($('#ticker-input').value.trim()); });
$('#investment-form').addEventListener('submit', event => {
  event.preventDefault();
  const ticker = cleanTicker($('#investment-ticker').value);
  const units = Math.max(1, Math.floor(Number($('#investment-units').value) || 1));
  const button = $('#investment-submit');
  if (!ticker) return;
  button.disabled = true;
  button.textContent = 'Calculating…';
  $('#investment-result').textContent = `Loading ${ticker} market data…`;
  loadAssistantStock(ticker)
    .then(stock => renderInvestmentScenario(stock, units))
    .catch(error => { $('#investment-result').textContent = `Could not calculate ${ticker}: ${error.message}. Try again shortly.`; })
    .finally(() => { button.disabled = false; button.textContent = 'Calculate returns'; });
});
$('#modal-close').addEventListener('click', () => $('#review-modal').close());
$('#review-modal').addEventListener('click', event => { if (event.target === $('#review-modal')) $('#review-modal').close(); });
$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#chat-input');
  const question = input.value.trim();
  if (!question) return;
  addChat(question, 'user');
  const tickerInput = $('#assistant-ticker');
  const requestedTicker = cleanTicker(tickerInput.value) || extractTicker(question);
  const submit = $('#chat-submit');
  if (requestedTicker && state.selected?.symbol !== requestedTicker) {
    submit.disabled = true;
    submit.textContent = 'Checking data...';
    addChat(`Looking up ${requestedTicker}...`, 'assistant');
    loadAssistantStock(requestedTicker)
      .then(stock => addChat(assistantReply(question, stock), 'assistant'))
      .catch(error => addChat(`I could not load ${requestedTicker} right now: ${error.message}. You can still ask general questions, or try again shortly.`, 'assistant'))
      .finally(() => { submit.disabled = false; submit.textContent = 'Ask'; });
  } else {
    addChat(assistantReply(question), 'assistant');
  }
  input.value = '';
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
refresh();
