const $ = selector => document.querySelector(selector);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const percent = value => `${value >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const LEADERS_CACHE_KEY = 'market-pulse-nse-leaders-v34';
const STOCK_CACHE_PREFIX = 'market-pulse-nse-stock-v34:';
const WATCHLIST_KEY = 'market-pulse-watchlist-v1';
const WATCH_ALERTS_KEY = 'market-pulse-watch-alerts-v1';
const MAX_WATCHLIST_SIZE = 8;
const API_TIMEOUT_MS = 25000;
let reviewRequestId = 0;
const state = { leaders: [], selected: null, universeCount: 0, watchlist: [], watchRows: [], sector: 'banking', sectorLoaded: false, sectorData: null, leaderPage: 0, sectorPage: 0, watchPage: 0 };
const SECTOR_LABELS = { banking: 'Banking', defence: 'Defence', it: 'IT', energy: 'Energy', auto: 'Auto', pharma: 'Pharma', fmcg: 'FMCG', metals: 'Metals', infrastructure: 'Infrastructure' };

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

async function api(type, symbol = '', extra = {}) {
  const endpoint = window.MARKET_PULSE_API_URL || '/api/market';
  const separator = endpoint.includes('?') ? '&' : '?';
  const params = new URLSearchParams({ type, ...extra });
  if (symbol) params.set('symbol', symbol);
  const url = `${endpoint}${separator}${params.toString()}`;
  const controller = new AbortController();
  let timeout;
  const request = fetch(url, { cache: 'no-store', signal: controller.signal });
  const deadline = new Promise((_, reject) => {
    timeout = window.setTimeout(() => {
      controller.abort();
      reject(new Error('The market-data request timed out. Check that Netlify Dev is running and try again.'));
    }, API_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([request, deadline]);
    let payload = null;
    try { payload = await response.json(); } catch { /* Non-JSON responses are handled below. */ }
    if (!response.ok) throw new Error(payload?.detail || payload?.error || `Market-data request failed (${response.status})`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The market-data request timed out. Check that Netlify Dev is running and try again.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
function scoreStock(stock) {
  const move = Number(stock.pChange || 0);
  const range = Math.max(0, Number(stock.dayHigh || stock.lastPrice) - Number(stock.dayLow || stock.lastPrice));
  const rangePct = stock.lastPrice ? range / stock.lastPrice * 100 : 0;
  const nearHigh = stock.yearHigh ? stock.lastPrice / stock.yearHigh : null;
  let score = 50
    + (move >= 2 ? 28 : move >= 1 ? 18 : move > 0 ? 9 : move <= -2 ? -28 : move < 0 ? -14 : 0)
    + (rangePct < 2 ? 8 : rangePct > 5 ? -9 : 0)
    + (nearHigh !== null && nearHigh > .92 ? 7 : nearHigh !== null && nearHigh < .7 ? -7 : 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...stock,
    score,
    signal: score >= 70 ? 'BUY' : score >= 45 ? 'HOLD' : 'REDUCE',
    risk: rangePct > 5 ? 'High' : rangePct > 2.5 ? 'Moderate' : 'Lower',
    rangePct
  };
}

function compactWorkspace() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function visiblePage(items, page) {
  const size = compactWorkspace() ? 3 : 10;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const active = Math.max(0, Math.min(page, pages - 1));
  return { items: items.slice(active * size, active * size + size), page: active, pages, size };
}

function pager(target, page, pages, kind, total = 0, size = 0) {
  const node = $(target);
  if (!node) return;
  const start = total ? page * size + 1 : 0;
  const end = total ? Math.min(total, start + size - 1) : 0;
  node.innerHTML = pages > 1
    ? `<button class="pager-button" data-page-kind="${kind}" data-page="${page - 1}" type="button" ${page === 0 ? 'disabled' : ''}>Previous</button><span class="pager-status"><strong>${start}-${end}</strong> of ${total}</span><button class="pager-button" data-page-kind="${kind}" data-page="${page + 1}" type="button" ${page === pages - 1 ? 'disabled' : ''}>Next</button>`
    : (total ? `<span class="pager-status"><strong>${start}-${end}</strong> of ${total}</span>` : '');
}

function stockCard(stock, index, sector = false) {
  const levels = sector && stock.support ? `<div><span>Levels</span><strong>${money.format(stock.support)} / ${money.format(stock.resistance)}</strong><small>support / resistance</small></div>` : `<div><span>Risk</span><strong>${safe(stock.risk)}</strong><small>daily range ${stock.rangePct.toFixed(2)}%</small></div>`;
  const trend = sector ? `<div><span>3-month trend</span><strong class="${stock.trend3m >= 0 ? 'positive' : 'negative'}">${percent(stock.trend3m)}</strong><small>12M scenario ${percent(stock.scenario12m || 0)}</small></div>` : `<div><span>Signal score</span><strong>${stock.score}/100</strong><small>${safe(stock.signal)} momentum setup</small></div>`;
  return `<article class="stock-card"><div class="stock-card-heading"><div><span class="stock-rank">#${index + 1}</span><strong>${safe(stock.symbol)}</strong><small>${safe(stock.name)}</small></div><span class="signal ${stock.signal}">${stock.signal}</span></div><div class="stock-card-metrics"><div><span>Last price</span><strong>${money.format(stock.lastPrice)}</strong><small class="${stock.pChange >= 0 ? 'positive' : 'negative'}">${percent(stock.pChange)} today</small></div>${trend}${levels}</div><div class="stock-card-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision brief</button>${sector ? '' : `${watchButtonMarkup(stock.symbol)}`}</div></article>`;
}

function renderLeaders() {
  const leaders = state.leaders;
  const view = visiblePage(leaders, state.leaderPage);
  state.leaderPage = view.page;
  $('#stock-table').innerHTML = view.items.map((stock, index) => `
    <tr>
      <td>${view.page * view.size + index + 1}</td>
      <td class="company">${safe(stock.symbol)}<small>${safe(stock.name)}</small></td>
      <td>${money.format(stock.lastPrice)}</td>
      <td class="${stock.pChange >= 0 ? 'positive' : 'negative'}">${percent(stock.pChange)}</td>
      <td><span class="signal ${stock.signal}">${stock.signal}</span></td>
      <td><span class="risk-badge">${stock.risk}</span></td>
      <td class="stock-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision</button>${watchButtonMarkup(stock.symbol)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="connection-note">No market prices are available right now.</td></tr>';
  const cards = $('#stock-cards');
  if (cards) cards.innerHTML = view.items.map((stock, index) => stockCard(stock, view.page * view.size + index)).join('');
  pager('#stock-pager', view.page, view.pages, 'leaders', leaders.length, view.size);
  $('#universe-count').textContent = state.universeCount || '-';
  $('#buy-count').textContent = leaders.filter(stock => stock.signal === 'BUY').length;
  $('#top-mover').textContent = leaders[0] ? `${leaders[0].symbol} ${percent(leaders[0].pChange)}` : '-';
}

function renderSectorLeaders(data) {
  const leaders = (data.leaders || []).map(scoreStock).filter(stock => stock.lastPrice > 0);
  state.sectorData = { ...data, leaders };
  const view = visiblePage(leaders, state.sectorPage);
  state.sectorPage = view.page;
  const table = $('#sector-table');
  if (!table) return;
  table.innerHTML = view.items.map((stock, index) => `
    <tr>
      <td>${view.page * view.size + index + 1}</td>
      <td class="company">${safe(stock.symbol)}<small>${safe(stock.name)}</small></td>
      <td>${money.format(stock.lastPrice)}</td>
      <td class="${stock.pChange >= 0 ? 'positive' : 'negative'}">${percent(stock.pChange)}</td>
      <td class="${stock.trend3m >= 0 ? 'positive' : 'negative'}">${percent(stock.trend3m)}</td>
      <td><span class="signal ${stock.signal}">${stock.signal}</span><small class="table-subtext">${stock.risk} risk</small></td>
      <td class="${stock.scenario12m >= 0 ? 'positive' : 'negative'}">${percent(stock.scenario12m)}<small class="table-subtext">base scenario</small></td>
      <td><strong>${money.format(stock.support)}</strong><small class="table-subtext">S ${money.format(stock.support)} · R ${money.format(stock.resistance)}</small></td>
      <td class="stock-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision</button>${watchButtonMarkup(stock.symbol,true)}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="connection-note">No sector prices are available right now. Try again shortly.</td></tr>';
  const cards = $('#sector-cards');
  if (cards) cards.innerHTML = view.items.map((stock, index) => stockCard(stock, view.page * view.size + index, true)).join('');
  pager('#sector-pager', view.page, view.pages, 'sector', leaders.length, view.size);
  const label = SECTOR_LABELS[data.sector] || 'Sector';
  const note = $('#sector-note');
  if (note) note.textContent = `${label} basket · ${data.universeCount || leaders.length} symbols · ${data.source || 'market data'}`;
  const insight = $('#sector-insight');
  if (insight) insight.textContent = data.providerNotice || 'Signals show short-term momentum; support, resistance, and 12-month figures are research scenarios, not targets.';
}

async function loadSector(sector = state.sector) {
  const normalized = String(sector || '').toLowerCase();
  if (!SECTOR_LABELS[normalized]) return;
  state.sector = normalized;
  state.sectorPage = 0;
  const note = $('#sector-note');
  const table = $('#sector-table');
  document.querySelectorAll('[data-sector]').forEach(button => button.classList.toggle('is-active', button.dataset.sector === normalized));
  if (note) note.textContent = `Loading ${SECTOR_LABELS[normalized]} sector data…`;
  if (table) table.innerHTML = '<tr><td colspan="9" class="connection-note">Loading the sector basket…</td></tr>';
  try {
    renderSectorLeaders(await api('sector', '', { sector: normalized }));
    state.sectorLoaded = true;
  } catch (error) {
    if (note) note.textContent = `${SECTOR_LABELS[normalized]} sector data is temporarily unavailable`;
    if (table) table.innerHTML = `<tr><td colspan="9" class="connection-note">${safe(error.message)}. Retry in a minute.</td></tr>`;
  }
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
    ? updates.slice(0, 3).map(item => `<a class="update-row" href="${safeUrl(item.url)}" target="_blank" rel="noopener"><strong>${safe(item.symbol)}</strong><span>${safe(item.title)}</span><small>${safe(item.date || 'NSE disclosure')}</small></a>`).join('')
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
    state.leaderPage = 0;
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
    void refreshWatchlist();
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
  return `<div class="modal-body"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} - ${source} last price ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Daily movement</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>Momentum score</span><strong>${metrics.score}/100</strong></article><article><span>Trend (20 days)</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article>${riskSummary(metrics)}</div><div class="review-grid"><section class="detail-section"><h3>Why this ${metrics.signal} signal?</h3><ul><li>Today's ${source} move is <b>${percent(metrics.pChange)}</b>; stronger positive momentum adds to the score.</li><li>Current daily range is <b>${metrics.rangePct.toFixed(2)}%</b>; wider ranges increase trading risk.</li><li>The price is ${metrics.yearHigh ? `${(metrics.lastPrice / metrics.yearHigh * 100).toFixed(1)}% of its 52-week high` : 'being evaluated from its current range'}.</li><li>Score 70+ is a BUY momentum setup; 45-69 is HOLD/watch; below 45 is REDUCE.</li></ul><div class="levels"><div><span>Support</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div><div><span>52-week low</span><strong>${money.format(metrics.yearLow || 0)}</strong></div></div></section><section class="detail-section"><h3>Profit / loss scenario</h3><p>Modelled from recent ${source} price trend and volatility. It is not a price target.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units to estimate 6- and 12-month base, bull, and bear outcomes.</div></section></div><section class="detail-section"><h3>Price trend</h3>${chart(metrics)}</section><section class="detail-section announcements"><h3>${safe(metrics.symbol)} company disclosures</h3><div id="announcements">Loading company disclosures...</div></section></div>`;
}

function decisionContent(metrics) {
  const source = safe(metrics.dataSource || 'market data');
  const nearHigh = metrics.yearHigh ? metrics.lastPrice / metrics.yearHigh * 100 : 0;
  const supports = [];
  const cautions = [];
  if (metrics.pChange > 0) supports.push(`Price is up ${percent(metrics.pChange)} today, which supports short-term momentum.`);
  else cautions.push(`Price is down ${percent(metrics.pChange)} today, so momentum is currently weak.`);
  if (metrics.trend > 0) supports.push(`The recent 20-day trend is ${percent(metrics.trend)}, indicating improving price action.`);
  else cautions.push(`The recent 20-day trend is ${percent(metrics.trend)}; wait for price action to stabilise.`);
  if (metrics.rangePct <= 2.5) supports.push(`The current daily range is ${metrics.rangePct.toFixed(2)}%, which is comparatively controlled.`);
  else cautions.push(`The ${metrics.rangePct.toFixed(2)}% daily range means larger possible swings and higher timing risk.`);
  if (nearHigh >= 92) cautions.push(`The price is already ${nearHigh.toFixed(1)}% of its 52-week high, so a pullback remains possible.`);
  else if (nearHigh) supports.push(`The price is ${nearHigh.toFixed(1)}% of its 52-week high, leaving room below the prior peak.`);
  if (!supports.length) supports.push('No strong momentum support is visible in the available price data.');
  if (!cautions.length) cautions.push('No major price-action caution was triggered, but market and company risks still apply.');
  const headline = metrics.signal === 'BUY'
    ? 'Momentum supports a monitored buy setup — not a guaranteed buy.'
    : metrics.signal === 'HOLD'
      ? 'Watch setup — wait for stronger confirmation before increasing exposure.'
      : 'Avoid adding on current momentum — reassess after price action improves.';
  const action = metrics.signal === 'BUY'
    ? `If buying, consider a staggered entry and define an exit level below support (${money.format(metrics.support)}).`
    : metrics.signal === 'HOLD'
      ? `If holding, monitor resistance at ${money.format(metrics.resistance)} and avoid treating this as a fresh-entry signal.`
      : `If not buying, wait for a stronger trend and a signal above HOLD before reassessing.`;
  return `<div class="modal-body"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><section class="decision-hero"><span>TRADE DECISION</span><h3>${headline}</h3><p>${action}</p></section><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>20-day trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article>${riskSummary(metrics)}</div><div class="review-grid"><section class="detail-section"><h3>Why someone may consider buying</h3><ul>${supports.map(reason => `<li>${safe(reason)}</li>`).join('')}</ul><h3 class="decision-subhead">Why someone may wait or avoid buying</h3><ul>${cautions.map(reason => `<li>${safe(reason)}</li>`).join('')}</ul></section><section class="detail-section"><h3>Price plan</h3><div class="levels"><div><span>Current price</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Support / risk line</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance / confirmation</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div></div><p>Use position sizing, your own stop-loss plan, company results, valuation and market conditions. This is research, not investment advice.</p></section></div><section class="detail-section"><h3>Price trend and pointer</h3>${chart(metrics)}</section><section class="detail-section announcements"><h3>${safe(metrics.symbol)} company disclosures</h3><div id="announcements">Loading company disclosures...</div></section></div>`;
}

function decisionEvidence(metrics) {
  const supportGap = metrics.support ? (metrics.lastPrice - metrics.support) / metrics.lastPrice * 100 : 0;
  const resistanceGap = metrics.resistance ? (metrics.resistance - metrics.lastPrice) / metrics.lastPrice * 100 : 0;
  const highPosition = metrics.yearHigh ? metrics.lastPrice / metrics.yearHigh * 100 : 0;
  const positive = [];
  const risks = [];
  if (metrics.pChange > 0) positive.push(`Today’s price is ${percent(metrics.pChange)}, so intraday momentum is positive.`);
  else risks.push(`Today’s price is ${percent(metrics.pChange)}, so the latest session is not confirming momentum.`);
  if (metrics.trend > 0) positive.push(`The 20-day trend is ${percent(metrics.trend)}, which supports the current price direction.`);
  else risks.push(`The 20-day trend is ${percent(metrics.trend)}; the recent direction needs to improve before a fresh entry is stronger.`);
  if (metrics.rangePct <= 2.5) positive.push(`The day’s ${metrics.rangePct.toFixed(2)}% range is controlled relative to the dashboard’s risk threshold.`);
  else risks.push(`The ${metrics.rangePct.toFixed(2)}% intraday range is elevated, so timing and position-size risk are higher.`);
  if (highPosition >= 94) risks.push(`Price is ${highPosition.toFixed(1)}% of its 52-week high. Breakout strength is possible, but so is pullback risk.`);
  else if (highPosition) positive.push(`Price is ${highPosition.toFixed(1)}% of its 52-week high, leaving ${Math.max(0, 100 - highPosition).toFixed(1)}% below that reference point.`);
  return { supportGap, resistanceGap, highPosition, positive, risks };
}

function modalTabs(prefix, items) {
  return `<div class="modal-tabs" role="tablist">${items.map((item, index) => `<button class="modal-tab${index === 0 ? ' is-active' : ''}" data-modal-tab="${prefix}-${item.id}" type="button" role="tab" aria-selected="${index === 0}">${item.label}</button>`).join('')}</div>`;
}

function modalPanel(prefix, id, content, active = false) {
  return `<section class="modal-panel${active ? ' is-active' : ''}" data-modal-panel="${prefix}-${id}" ${active ? '' : 'hidden'}>${content}</section>`;
}

function bindModalTabs() {
  document.querySelectorAll('[data-modal-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.dataset.modalTab;
      document.querySelectorAll('[data-modal-tab]').forEach(tab => {
        const active = tab.dataset.modalTab === target;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('[data-modal-panel]').forEach(panel => {
        const active = panel.dataset.modalPanel === target;
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
      });
    });
  });
}

function reviewContent(metrics) {
  const source = safe(metrics.dataSource || 'market data');
  const evidence = decisionEvidence(metrics);
  const prefix = 'review';
  const scoreText = metrics.score >= 70 ? 'Positive price-action factors outweigh the risk deductions in this momentum screen.' : metrics.score >= 45 ? 'The evidence is mixed: this is a watch / hold screen rather than a clear momentum entry.' : 'Risk deductions outweigh the positive price-action factors in this momentum screen.';
  return `<div class="modal-body modal-body-fixed"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · last price ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>20-day trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article>${riskSummary(metrics)}</div>${modalTabs(prefix, [{ id: 'evidence', label: 'Signal explained' }, { id: 'plan', label: 'Levels & scenarios' }, { id: 'chart', label: 'Price chart' }, { id: 'news', label: 'Company updates' }])}${modalPanel(prefix, 'evidence', `<section class="detail-section research-brief"><p class="research-label">WHAT THE SCORE MEANS</p><h3>${scoreText}</h3><p>Score formula: price change, daily range and distance from the 52-week high. It is a price-action screen, not a valuation or earnings forecast.</p><div class="evidence-columns"><div><h4>Constructive evidence</h4><ul>${evidence.positive.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No positive price-action factor is currently strong enough to add.</li>'}</ul></div><div><h4>Risk or wait signals</h4><ul>${evidence.risks.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No specific price-action warning was triggered; company and market risks still remain.</li>'}</ul></div></div></section>`, true)}${modalPanel(prefix, 'plan', `<div class="review-grid"><section class="detail-section"><p class="research-label">REFERENCE LEVELS</p><h3>Plan the trade before acting</h3><div class="levels"><div><span>Current price</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Support / risk line</span><strong>${money.format(metrics.support)}</strong><small>${evidence.supportGap.toFixed(1)}% below price</small></div><div><span>Resistance / confirmation</span><strong>${money.format(metrics.resistance)}</strong><small>${evidence.resistanceGap.toFixed(1)}% above price</small></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div></div><p>These are recent-price reference levels, not guaranteed entry, stop-loss, or target prices.</p></section><section class="detail-section"><p class="research-label">YOUR SCENARIO</p><h3>Estimate possible outcomes</h3><p>Uses recent trend and volatility. Excludes tax, brokerage and slippage.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units for six- and twelve-month base, bull and bear scenarios.</div></section></div>`)}${modalPanel(prefix, 'chart', `<section class="detail-section chart-section"><p class="research-label">TREND CONTEXT</p><h3>Recent closing-price history</h3><p>Move over or touch the line to inspect the date and close.</p>${chart(metrics)}</section>`)}${modalPanel(prefix, 'news', `<section class="detail-section announcements"><p class="research-label">COMPANY-SPECIFIC DISCLOSURES</p><h3>${safe(metrics.symbol)} announcements</h3><div id="announcements">Loading company disclosures…</div></section>`)}</div>`;
}

function decisionContent(metrics) {
  const source = safe(metrics.dataSource || 'market data');
  const evidence = decisionEvidence(metrics);
  const prefix = 'decision';
  const posture = metrics.signal === 'BUY' ? 'Momentum is constructive, but only a planned, risk-defined setup is shown.' : metrics.signal === 'HOLD' ? 'The ticker has mixed evidence. Wait for confirmation instead of treating the signal as a fresh buy.' : 'Current price action does not support adding risk. Revisit only if the evidence changes.';
  const nextStep = metrics.signal === 'BUY' ? `A buyer would still need a position size and an exit plan below ${money.format(metrics.support)}.` : metrics.signal === 'HOLD' ? `A patient investor can monitor ${money.format(metrics.resistance)} for confirmation or ${money.format(metrics.support)} as the risk line.` : `A cautious investor can wait for a positive daily move and improving 20-day trend before reviewing again.`;
  return `<div class="modal-body modal-body-fixed"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><section class="decision-hero"><span>DECISION BRIEF</span><h3>${posture}</h3><p>${nextStep}</p></section><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>Trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article>${riskSummary(metrics)}</div>${modalTabs(prefix, [{ id: 'evidence', label: 'Evidence' }, { id: 'plan', label: 'Decision map' }, { id: 'news', label: 'Company updates' }])}${modalPanel(prefix, 'evidence', `<section class="detail-section research-brief"><p class="research-label">WHY THE DASHBOARD REACHED THIS VIEW</p><div class="evidence-columns"><div><h4>Evidence for strength</h4><ul>${evidence.positive.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No positive price-action support is strong enough to rely on.</li>'}</ul></div><div><h4>Evidence for caution</h4><ul>${evidence.risks.map(item => `<li>${safe(item)}</li>`).join('') || '<li>There is no highlighted technical warning, but price-only analysis has clear limits.</li>'}</ul></div></div><p class="method-note">This brief evaluates price action only. Review earnings, valuation, cash flow, sector conditions and disclosures separately before investing.</p></section>`, true)}${modalPanel(prefix, 'plan', `<section class="detail-section"><p class="research-label">DECISION MAP</p><h3>What would change the view?</h3><div class="decision-map"><div><span>Price now</span><strong>${money.format(metrics.lastPrice)}</strong><small>Current reference</small></div><div><span>Risk increases below</span><strong>${money.format(metrics.support)}</strong><small>${evidence.supportGap.toFixed(1)}% below now</small></div><div><span>Confirmation near</span><strong>${money.format(metrics.resistance)}</strong><small>${evidence.resistanceGap.toFixed(1)}% above now</small></div></div><p>Decision rule: do not rely on a single score. A stronger case needs trend, price behaviour, company fundamentals and a risk limit to agree.</p></section>`)}${modalPanel(prefix, 'news', `<section class="detail-section announcements"><p class="research-label">COMPANY-SPECIFIC DISCLOSURES</p><h3>${safe(metrics.symbol)} announcements</h3><div id="announcements">Loading company disclosures…</div></section>`)}</div>`;
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

function fillReview(raw, symbol, usingSavedData = false, mode = 'review') {
  const fallback = state.leaders.find(item => item.symbol === symbol) || {};
  const metrics = historicalMetrics(scoreStock({ ...fallback, ...raw.stock, history: raw.history || [] }));
  state.selected = metrics;
  $('#modal-kicker').textContent = `${metrics.symbol} - ${usingSavedData ? 'SAVED ' : ''}${mode === 'decision' ? 'TRADE DECISION' : `${metrics.dataSource || 'MARKET DATA'} STOCK REVIEW`}`;
  $('#modal-content').innerHTML = mode === 'decision' ? decisionContent(metrics) : reviewContent(metrics);
  bindModalTabs();
  if (mode === 'review') setCalculator(metrics);
  bindChart(metrics);
  const panel = $('#announcements');
  panel.innerHTML = (raw.announcements || []).slice(0, 4).map(item => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${safe(item.title)}<small>${safe(item.date || 'NSE disclosure')}</small></a>`).join('') || '<p>No recent company disclosures were returned for this ticker.</p>';
}

async function openReview(symbol, mode = 'review') {
  const ticker = String(symbol || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
  if (!ticker) return;
  const requestId = ++reviewRequestId;
  const modal = $('#review-modal');
  $('#modal-kicker').textContent = `${ticker} · LOADING`;
  $('#modal-content').innerHTML = `<div class="modal-body modal-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><div><strong>Loading ${safe(ticker)}</strong><p>Fetching the latest stock ${mode === 'decision' ? 'decision brief' : 'review'}…</p></div></div>`;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
  $('#modal-content').scrollTop = 0;
  try {
    const raw = await api('stock', ticker);
    if (requestId !== reviewRequestId || !modal.open) return;
    if (!raw?.stock?.lastPrice) throw new Error('The market-data source returned no current price for this ticker');
    writeCache(`${STOCK_CACHE_PREFIX}${ticker}`, { raw, savedAt: new Date().toISOString() });
    fillReview(raw, ticker, false, mode);
  } catch (error) {
    if (requestId !== reviewRequestId || !modal.open) return;
    const cached = readCache(`${STOCK_CACHE_PREFIX}${ticker}`);
    const fallback = state.leaders.find(item => item.symbol === ticker);
    if (cached?.raw?.stock) {
      fillReview(cached.raw, ticker, true, mode);
      $('#market-status').textContent = `Market feed delayed - review uses this device's saved ${ticker} result`;
    } else if (fallback?.lastPrice) {
      fillReview({ stock: fallback, history: [], announcements: [] }, ticker, true, mode);
      $('#market-status').textContent = `Market feed delayed - review uses the saved top-10 ${ticker} quote`;
    } else {
      $('#modal-content').innerHTML = `<div class="modal-body"><h2>Stock review is temporarily delayed</h2><p>${safe(error.message)}. The dashboard is still responsive; try this ticker again shortly.</p><p><a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(ticker)}" target="_blank" rel="noopener">Open ${safe(ticker)} on the official NSE website</a></p></div>`;
    }
  }
}

function cleanTicker(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
}

async function loadStockAnalysis(symbol) {
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

function readWatchlist() {
  const list = readCache(WATCHLIST_KEY);
  return Array.isArray(list) ? list.map(item => ({
    symbol: cleanTicker(item.symbol),
    target: Number(item.target) > 0 ? Number(item.target) : null,
    stop: Number(item.stop) > 0 ? Number(item.stop) : null
  })).filter(item => item.symbol).slice(0, MAX_WATCHLIST_SIZE) : [];
}

function saveWatchlist(items) {
  state.watchlist = items.slice(0, MAX_WATCHLIST_SIZE);
  writeCache(WATCHLIST_KEY, state.watchlist);
}

function cachedStockAnalysis(symbol) {
  const cached = readCache(`${STOCK_CACHE_PREFIX}${symbol}`);
  const leader = state.leaders.find(item => item.symbol === symbol) || {};
  if (cached?.raw?.stock) return historicalMetrics(scoreStock({ ...leader, ...cached.raw.stock, history: cached.raw.history || [] }));
  return leader.lastPrice ? historicalMetrics(scoreStock({ ...leader, history: [] })) : null;
}

function alertForWatch(item, metrics) {
  if (!metrics?.lastPrice) return null;
  if (item.target && metrics.lastPrice >= item.target) return { key: `${item.symbol}:target:${item.target}`, message: `${item.symbol} reached your target of ${money.format(item.target)}. Last price: ${money.format(metrics.lastPrice)}.` };
  if (item.stop && metrics.lastPrice <= item.stop) return { key: `${item.symbol}:stop:${item.stop}`, message: `${item.symbol} reached your stop level of ${money.format(item.stop)}. Last price: ${money.format(metrics.lastPrice)}.` };
  return null;
}

function updateAlertButton() {
  const button = $('#enable-device-alerts');
  if (!button) return;
  if (!('Notification' in window)) {
    button.disabled = true;
    button.textContent = 'Notifications unsupported';
  } else if (Notification.permission === 'granted') {
    button.disabled = true;
    button.textContent = 'Device alerts enabled';
  } else if (Notification.permission === 'denied') {
    button.disabled = true;
    button.textContent = 'Notifications blocked';
  }
}

function notifyDevice(message) {
  if ('Notification' in window && Notification.permission === 'granted') new Notification('Market Pulse alert', { body: message, icon: './icon.svg' });
}

function processWatchAlerts(rows) {
  const sent = readCache(WATCH_ALERTS_KEY) || {};
  const activeKeys = new Set();
  const newMessages = [];
  rows.forEach(row => {
    const alert = alertForWatch(row, row.metrics);
    if (!alert) return;
    activeKeys.add(alert.key);
    if (!sent[alert.key]) {
      sent[alert.key] = { at: new Date().toISOString(), price: row.metrics.lastPrice };
      newMessages.push(alert.message);
      notifyDevice(alert.message);
    }
  });
  Object.keys(sent).forEach(key => { if (!activeKeys.has(key)) delete sent[key]; });
  writeCache(WATCH_ALERTS_KEY, sent);
  if (newMessages.length) $('#watchlist-note').textContent = newMessages.join(' ');
}

function paperTrades(){const value=readCache('market-pulse-paper-trades-v1');return value&&typeof value==='object'?value:{};}
function monitorEvents(){const value=readCache('market-pulse-monitor-events-v1');return value&&typeof value==='object'?value:{};}
function savePaperTrades(value){writeCache('market-pulse-paper-trades-v1',value);}
function saveMonitorEvents(value){writeCache('market-pulse-monitor-events-v1',value);}
function nseSessionState(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(part=>[part.type,part.value])),minutes=Number(parts.hour)*60+Number(parts.minute),weekday=parts.weekday,workday=!['Sat','Sun'].includes(weekday),open=workday&&minutes>=555&&minutes<930;return {open,label:open?'NSE market open':'NSE market closed'};}
function monitorStatus(item,metrics,trade){
  if(!metrics?.lastPrice)return {key:'STALE',label:'DATA UNAVAILABLE',tone:'stale',reason:'No current price was returned, so the app cannot confirm the setup or calculate paper profit/loss.'};
  const price=Number(metrics.lastPrice),score=Number(metrics.score||0),ema20=Number(metrics.ema20||0),ema50=Number(metrics.ema50||0),trend=Number(metrics.trend||0),rsi=isDataNumber(metrics.rsi)?Number(metrics.rsi):null,technical=`Composite score ${score}/100 (${metrics.signal}); EMA 20 ${money.format(ema20)} is ${ema20>=ema50?'above':'below'} EMA 50 ${money.format(ema50)}; 20-day move ${percent(trend)}${rsi===null?'':`; RSI ${rsi.toFixed(1)}`}.`;
  if(trade?.status==='closed')return {key:'CLOSED',label:'CLOSED',tone:'closed',reason:`Paper trade closed at ${money.format(trade.closedPrice)}. ${technical} The closed result is a journal record, not evidence that the original entry was correct.`};
  if(trade?.status==='open'){
    if(item.stop&&price<=item.stop)return {key:'STOP_HIT',label:'STOP HIT',tone:'failed',reason:`Price ${money.format(price)} is at or below the saved stop ${money.format(item.stop)}. ${technical} The paper position should be treated as invalidated under its recorded risk plan.`};
    if(item.target&&price>=item.target)return {key:'TARGET_REACHED',label:'TARGET REACHED',tone:'target',reason:`Price ${money.format(price)} reached the saved target ${money.format(item.target)}. ${technical} Reaching a target records the scenario outcome; it does not guarantee the next trade will behave similarly.`};
    const conflict=metrics.signal==='REDUCE'?`Important conflict: the model is REDUCE because the composite evidence is below the 52-point HOLD threshold. The paper trade remains tracked because it was entered manually, not because the model confirmed it.`:metrics.signal==='HOLD'?`The model is still HOLD, so the paper position is being tracked without full BUY confirmation.`:'The model currently supports the direction, but the stop remains the controlling risk condition.';
    return {key:'IN_TRADE',label:'IN PAPER TRADE',tone:'active',reason:`Paper position: ${trade.quantity} shares entered at ${money.format(trade.entryPrice)}; current price ${money.format(price)}. ${technical} ${conflict} ${!item.stop||!item.target?'Risk plan incomplete: add both a stop and a target before judging the trade outcome.':''}`};
  }
  if(item.stop&&price<=item.stop)return {key:'SETUP_FAILED',label:'SETUP FAILED',tone:'failed',reason:`Price ${money.format(price)} is below the saved stop ${money.format(item.stop)}. ${technical} A fresh setup requires price to recover above the stop and rebuild BUY-quality trend confirmation.`};
  if(item.target&&price>=item.target)return {key:'TARGET_REACHED',label:'TARGET REACHED',tone:'target',reason:`The saved target ${money.format(item.target)} was reached before a paper entry was recorded. ${technical} This is an alert, not a claim that a trade captured the move.`};
  if(metrics.signal==='BUY'&&ema20>=ema50)return {key:'ENTRY_CONFIRMED',label:'ENTRY CONFIRMED',tone:'confirmed',reason:`The model has BUY confirmation: score ${score}/100 is at least 72 and EMA 20 ${money.format(ema20)} is above EMA 50 ${money.format(ema50)}. The 20-day move is ${percent(trend)}${rsi===null?'':` and RSI is ${rsi.toFixed(1)}`}. Entry still requires a defined stop, acceptable sizing and current-price confirmation.`};
  const scoreNeed=Math.max(0,72-score),emaNeed=ema20>=ema50?'EMA alignment is already constructive':`EMA 20 must recover above EMA 50 (currently ${money.format(ema20)} versus ${money.format(ema50)})`,riskLine=item.stop?` A close at or below ${money.format(item.stop)} invalidates the saved setup.`:'';
  return {key:'WAITING',label:'WAITING',tone:'waiting',reason:`No entry confirmation yet. ${technical} BUY status requires at least 72/100, so the score needs ${scoreNeed} more point${scoreNeed===1?'':'s'}; ${emaNeed}. Monitor stronger price structure, improving business evidence and a confirmed close rather than entering from the label alone.${riskLine}`};
}
function appendMonitorEvent(symbol,status,price,note){const all=monitorEvents(),rows=Array.isArray(all[symbol])?all[symbol]:[],last=rows[0];if(last?.status===status){last.price=Number(price)||last.price||null;last.note=note||last.note;last.checkedAt=new Date().toISOString();all[symbol]=rows;saveMonitorEvents(all);return;}all[symbol]=[{status,price:Number(price)||null,note,at:new Date().toISOString()},...rows].slice(0,20);saveMonitorEvents(all);}
function updateMonitorStates(rows){const trades=paperTrades();rows.forEach(row=>{if(row.error||!row.metrics?.lastPrice)return;const status=monitorStatus(row,row.metrics,trades[row.symbol]);appendMonitorEvent(row.symbol,status.key,row.metrics.lastPrice,status.reason);});}
function tradePnl(metrics,trade){if(!trade?.entryPrice||!trade.quantity||!metrics?.lastPrice)return null;const exit=trade.status==='closed'?Number(trade.closedPrice):Number(metrics.lastPrice),value=(exit-Number(trade.entryPrice))*Number(trade.quantity);return {value,pct:Number(trade.entryPrice)?(exit/Number(trade.entryPrice)-1)*100:0};}
function enterPaperTrade(symbol){
  const row=state.watchRows.find(item=>item.symbol===symbol),item=state.watchlist.find(value=>value.symbol===symbol)||{},metrics=row?.metrics,price=Number(metrics?.lastPrice||0);if(!price)return;const entry=Number(window.prompt(`Paper entry price for ${symbol}`,price.toFixed(2)));if(!(entry>0))return;const quantity=Math.floor(Number(window.prompt(`Paper quantity for ${symbol}`,'1')));if(!(quantity>0))return;const trades=paperTrades(),trade={status:'open',entryPrice:entry,quantity,enteredAt:new Date().toISOString()};trades[symbol]=trade;savePaperTrades(trades);const model=monitorStatus(item,metrics,trade),levels=`${item.stop?` Stop ${money.format(item.stop)}.`:' No stop is saved yet.'}${item.target?` Target ${money.format(item.target)}.`:' No target is saved yet.'}`;appendMonitorEvent(symbol,'IN_TRADE',entry,`Manual paper entry recorded: ${quantity} shares at ${money.format(entry)}.${levels} ${model.reason}`);renderWatchlist();
}
function closePaperTrade(symbol){const row=state.watchRows.find(item=>item.symbol===symbol),price=Number(row?.metrics?.lastPrice||0),trades=paperTrades(),trade=trades[symbol];if(!trade||trade.status!=='open'||!price)return;trade.status='closed';trade.closedPrice=price;trade.closedAt=new Date().toISOString();savePaperTrades(trades);appendMonitorEvent(symbol,'CLOSED',price,`Paper trade closed at ${money.format(price)}.`);renderWatchlist();}
function resetPaperTrade(symbol){const trades=paperTrades();delete trades[symbol];savePaperTrades(trades);appendMonitorEvent(symbol,'WAITING',null,'Paper trade reset; monitoring continues.');renderWatchlist();}
function setupWatchMonitor(){window.clearInterval(state.watchMonitorTimer);state.watchMonitorTimer=window.setInterval(()=>{if(nseSessionState().open&&state.watchlist.length)void refreshWatchlist();},300000);}
function sessionMoveText(metrics,session){if(!metrics)return 'Price unavailable';const move=Number(metrics.pChange);if(!Number.isFinite(move))return 'Session change unavailable';if(Math.abs(move)<.005)return session.open?'No price change reported':'Market closed · last available price';return `${percent(move)} this session`; }
function paperPnlText(pnl,trade){if(!trade)return 'No paper position';if(!pnl)return 'P/L unavailable';if(Math.abs(pnl.value)<.005)return 'At entry price · no open gain/loss yet';return `${money.format(pnl.value)} (${percent(pnl.pct)})`; }
function coachReviews(){const value=readCache('market-pulse-coach-reviews-v1');return value&&typeof value==='object'?value:{};}
function saveCoachReviews(value){writeCache('market-pulse-coach-reviews-v1',value);}
function beginnerCoach(item,metrics,trade){
  if(!metrics)return {outcome:'WAIT FOR DATA',tone:'waiting',summary:'Current market data is required before the checklist can evaluate this stock.',checks:[]};
  const price=Number(trade?.entryPrice||metrics.lastPrice||0),emaAligned=Number(metrics.ema20)>=Number(metrics.ema50),rsi=isDataNumber(metrics.rsi)?Number(metrics.rsi):null,hasStop=Number(item.stop)>0,hasTarget=Number(item.target)>0,risk=hasStop?price-Number(item.stop):0,reward=hasTarget?Number(item.target)-price:0,rr=risk>0&&reward>0?reward/risk:null,ml=metrics.ml||{},mlSupports=!ml.available||Number(ml.accuracy)<40||Number(ml.up)>=Number(ml.down),stopped=hasStop&&Number(metrics.lastPrice)<=Number(item.stop),checks=[];
  checks.push({label:'Model setup',state:metrics.signal==='BUY'?'pass':metrics.signal==='HOLD'?'warn':'fail',answer:metrics.signal==='BUY'?`BUY evidence is present at ${metrics.score}/100.`:metrics.signal==='HOLD'?`The score is ${metrics.score}/100; wait for the 72-point BUY threshold.`:`The score is ${metrics.score}/100 (REDUCE), so this is not a beginner-quality entry.`});
  checks.push({label:'Trend direction',state:emaAligned?'pass':'fail',answer:emaAligned?`EMA 20 (${money.format(metrics.ema20)}) is above EMA 50 (${money.format(metrics.ema50)}).`:`EMA 20 ${money.format(metrics.ema20)} is below EMA 50 ${money.format(metrics.ema50)}. Buyers have not confirmed control.`});
  checks.push({label:'Momentum',state:rsi===null?'warn':rsi>=45&&rsi<=68?'pass':rsi>75||rsi<35?'fail':'warn',answer:rsi===null?'RSI is unavailable.':rsi>=45&&rsi<=68?`RSI ${rsi.toFixed(1)} is in a balanced momentum area.`:rsi>75?`RSI ${rsi.toFixed(1)} is stretched; chasing raises pullback risk.`:rsi<35?`RSI ${rsi.toFixed(1)} shows weak momentum.`:`RSI ${rsi.toFixed(1)} is not in the preferred balanced range.`});
  checks.push({label:'Stop defined',state:hasStop&&risk>0?'pass':'fail',answer:hasStop&&risk>0?`The idea is invalid below ${money.format(item.stop)}; risk is ${money.format(risk)} per share.`:hasStop?'The saved stop is not below the proposed entry, so the risk plan is invalid.':'No stop is saved. A beginner should not enter without knowing where the idea is wrong.'});
  checks.push({label:'Target and reward',state:rr!==null&&rr>=1.5?'pass':hasTarget?'fail':'warn',answer:rr!==null?`Potential reward/risk is ${rr.toFixed(1)}×; the beginner rule requires at least 1.5×.`:'Add a target above entry to compare possible reward with the stop risk.'});
  checks.push({label:'ML cross-check',state:!ml.available||Number(ml.accuracy)<40?'warn':mlSupports?'pass':'warn',answer:!ml.available?'ML history is unavailable, so it is not used as a positive signal.':Number(ml.accuracy)<40?`ML test accuracy is only ${ml.accuracy}%; do not rely on it.`:mlSupports?`ML rise probability (${ml.up}%) is not below fall probability (${ml.down}%).`:`ML currently challenges the trade: fall ${ml.down}% versus rise ${ml.up}%.`});
  checks.push({label:'Business evidence',state:metrics.fundamentals?.available?'pass':'warn',answer:metrics.fundamentals?.available?'Fundamental data is available for separate review.':'Fundamental data is missing; this is only a price-pattern assessment.'});
  let outcome='WAIT FOR CONFIRMATION',tone='waiting',summary='Some conditions are useful, but the setup is not complete enough for a beginner paper entry.';
  if(stopped){outcome='SETUP INVALID';tone='failed';summary='Price is at or below the saved stop. Do not average automatically; reassess from a fresh setup.';}
  else if(!hasStop||metrics.signal==='REDUCE'||risk<=0){outcome='TOO RISKY FOR A BEGINNER';tone='failed';summary=!hasStop?'There is no defined stop, so the maximum planned loss is unknown.':'The current REDUCE signal or invalid stop conflicts with a beginner entry.';}
  else if(metrics.signal==='BUY'&&emaAligned&&rr!==null&&rr>=1.5&&mlSupports){outcome='READY FOR PAPER TRADE';tone='ready';summary='The main trend, risk and reward checks align. Use paper mode and follow the saved stop; this is not a profit guarantee.';}
  return {outcome,tone,summary,checks,rr};
}
function duringTradeCoach(item,metrics,trade,coach){if(!trade||trade.status!=='open')return '';const price=Number(metrics?.lastPrice||0),stopRisk=item.stop?Math.max(0,(price-Number(item.stop))*Number(trade.quantity)):null,targetState=item.target&&price>=item.target?'Target reached':item.target?`${money.format(Number(item.target)-price)} per share remains to target`:'No target saved',valid=coach.outcome!=='SETUP INVALID';return `<div class="during-coach"><h4>While the paper trade is open</h4><ul><li><strong>Is the setup still valid?</strong> ${valid?'Yes, price remains above the saved invalidation level.':'No—the saved invalidation level has failed.'}</li><li><strong>How much remains at risk?</strong> ${stopRisk===null?'Unknown until a stop is added.':money.format(stopRisk)+' across the paper position.'}</li><li><strong>What changed?</strong> ${safe(targetState)}; current model signal is ${safe(metrics?.signal||'unavailable')}.</li><li><strong>When should I exit early?</strong> If the stop fails, the breakout reverses, or the original reason for entering is no longer true—not merely because of normal price noise.</li></ul></div>`;}
function beginnerCoachPanel(item,metrics,trade){const coach=beginnerCoach(item,metrics,trade);return `<details class="beginner-coach"><summary><span>Beginner trade coach</span><strong class="coach-outcome ${safe(coach.tone)}">${safe(coach.outcome)}</strong></summary><div class="coach-body"><p class="coach-summary">${safe(coach.summary)}</p><div class="coach-checks">${coach.checks.map(check=>`<div class="coach-check ${safe(check.state)}"><span>${check.state==='pass'?'✓':check.state==='fail'?'×':'!'}</span><div><strong>${safe(check.label)}</strong><p>${safe(check.answer)}</p></div></div>`).join('')}</div>${duringTradeCoach(item,metrics,trade,coach)}<details class="coach-terms"><summary>Explain the trading terms</summary><dl><div><dt>EMA</dt><dd>An average that helps show the recent price direction. EMA 20 above EMA 50 usually means the shorter trend is stronger.</dd></div><div><dt>VWAP</dt><dd>The average price paid during the trading day, weighted by volume. Intraday traders use it as a reference—not a guarantee.</dd></div><div><dt>RSI</dt><dd>A momentum gauge. Very high or low readings can warn that price is stretched or weak.</dd></div><div><dt>Support</dt><dd>An area where buyers previously appeared. It can fail.</dd></div><div><dt>Resistance</dt><dd>An area where sellers previously appeared. A completed close above it is stronger than a brief touch.</dd></div><div><dt>Stop-loss</dt><dd>The price where your original idea is considered wrong and the planned loss is limited.</dd></div></dl></details>${trade?.status==='closed'?`<button class="save-coach-review" data-coach-review="${safe(item.symbol)}" type="button">Record what I learned</button>`:''}</div></details>`;}
function recordCoachReview(symbol){const trade=paperTrades()[symbol],row=state.watchRows.find(item=>item.symbol===symbol);if(!trade||trade.status!=='closed')return;const followed=window.confirm('Did you follow your planned entry and stop? Select OK for Yes or Cancel for No.'),emotion=window.confirm('Was the exit based on evidence rather than emotion? Select OK for Yes or Cancel for No.'),lesson=window.prompt('What is the one lesson you would repeat or avoid next time?','');if(lesson===null)return;const all=coachReviews();all[symbol]=[{at:new Date().toISOString(),followedPlan:followed,evidenceBasedExit:emotion,lesson:String(lesson).trim(),entryPrice:trade.entryPrice,exitPrice:trade.closedPrice,quantity:trade.quantity,signalAtReview:row?.metrics?.signal||null},...(all[symbol]||[])].slice(0,20);saveCoachReviews(all);appendMonitorEvent(symbol,'LESSON_RECORDED',trade.closedPrice,`Learning review: ${followed?'followed':'did not follow'} the plan; exit was ${emotion?'evidence-based':'emotion-influenced'}. ${lesson||'No written lesson.'}`);renderWatchlist();}
function marketSellContext(){const rows=(state.leaders||[]).filter(row=>isDataNumber(row.pChange));if(!rows.length)return {available:false,label:'Market data unavailable',advancePct:0,averageMove:0};const advancePct=rows.filter(row=>Number(row.pChange)>0).length/rows.length*100,averageMove=rows.reduce((sum,row)=>sum+Number(row.pChange),0)/rows.length,label=advancePct>=60&&averageMove>0?'Broad market supportive':advancePct<40&&averageMove<0?'Broad market weak':'Broad market mixed';return {available:true,label,advancePct,averageMove};}
function sellHeadlineScan(rows){const negative=['fraud','probe','investigation','penalty','default','downgrade','loss','decline','falls','weak','warning','resigns','resignation','cancelled','lawsuit','ban','tariff','war','conflict'],positive=['order win','wins order','approval','upgrade','profit rises','profit jumps','record profit','expansion','contract awarded'],titles=(rows||[]).map(row=>String(row.title||'').toLowerCase()),negativeHits=titles.filter(title=>negative.some(word=>title.includes(word))).length,positiveHits=titles.filter(title=>positive.some(word=>title.includes(word))).length;return {negativeHits,positiveHits,tone:negativeHits>positiveHits?'caution':positiveHits>negativeHits?'supportive':'neutral'};}
function sellNewsList(rows){return (rows||[]).slice(0,3).map(row=>`<a href="${safeUrl(row.url)}" target="_blank" rel="noopener"><strong>${safe(row.title)}</strong><small>${safe(row.source||'News')} · ${safe(row.date||'')}</small></a>`).join('')||'<p class="news-empty">No headlines were returned. This does not prove there is no relevant news.</p>';}
async function loadSellNewsPanels(symbol){const nodes=[...document.querySelectorAll('[data-sell-news]')].filter(node=>node.dataset.sellNews===symbol);if(!nodes.length)return;try{const data=await api('news',symbol),companyScan=sellHeadlineScan(data.company),globalScan=sellHeadlineScan(data.global),warning=companyScan.tone==='caution'||globalScan.tone==='caution'?'Headline wording contains caution terms. Read the original reports before holding or selling.':'No concentration of obvious caution words was detected in the returned titles. This is not proof that the news is positive.';const html=`<div class="sell-news-summary"><strong>News review: ${safe(warning)}</strong><span>Company titles: ${companyScan.negativeHits} caution / ${companyScan.positiveHits} supportive · World/India titles: ${globalScan.negativeHits} caution / ${globalScan.positiveHits} supportive</span></div><div class="sell-news-columns"><div><h4>${safe(symbol)} company news</h4>${sellNewsList(data.company)}</div><div><h4>World / India market news</h4>${sellNewsList(data.global)}</div></div><p class="method-note">The headline scan only identifies transparent keywords in titles; it does not understand the full article. News can trigger investigation, but never an automatic sell by itself.</p>`;nodes.forEach(node=>node.innerHTML=html);}catch(error){nodes.forEach(node=>node.innerHTML=`<p class="news-empty">News evidence is temporarily unavailable: ${safe(error.message)}. Do not treat missing news as positive evidence.</p>`);}}
function sellAnalysis(metrics,item={},trade=null){
  const history=(metrics?.history||[]).filter(row=>Number(row.close)>0).slice(-90),closes=history.map(row=>Number(row.close)),last=Number(metrics?.lastPrice||closes.at(-1)||0),first=closes[0]||last,high90=closes.length?Math.max(...closes):last,low90=closes.length?Math.min(...closes):last,recent=closes.slice(-20),prior=closes.slice(-40,-20),recentHigh=recent.length?Math.max(...recent):last,priorHigh=prior.length?Math.max(...prior):recentHigh,recentLow=recent.length?Math.min(...recent):last,priorLow=prior.length?Math.min(...prior):recentLow,trend90=first?(last/first-1)*100:0,drawdown=high90?(last/high90-1)*100:0,lowerHigh=prior.length>5&&recentHigh<priorHigh,lowerLow=prior.length>5&&recentLow<priorLow,emaBear=Number(metrics?.ema20)<Number(metrics?.ema50),belowEma20=last<Number(metrics?.ema20),rsi=isDataNumber(metrics?.rsi)?Number(metrics.rsi):null,ml=metrics?.ml||{},mlReliable=ml.available&&Number(ml.accuracy)>=45,mlBearish=mlReliable&&Number(ml.down)>=Number(ml.up)+8,mlBullish=mlReliable&&Number(ml.up)>=Number(ml.down)+8,stop=Number(item?.stop||0),target=Number(item?.target||0),stopHit=stop>0&&last<=stop,targetHit=target>0&&last>=target,bearishReasons=[],supportive=[];
  if(trend90<0)bearishReasons.push(`Price is ${Math.abs(trend90).toFixed(1)}% lower across the available 90-session window.`);else supportive.push(`Price is ${trend90.toFixed(1)}% higher across the available 90-session window.`);
  if(drawdown<=-10)bearishReasons.push(`Price is ${Math.abs(drawdown).toFixed(1)}% below its 90-session high ${money.format(high90)}.`);else supportive.push(`Price is only ${Math.abs(drawdown).toFixed(1)}% below its 90-session high.`);
  if(lowerHigh)bearishReasons.push(`The latest 20-session high ${money.format(recentHigh)} is below the preceding 20-session high ${money.format(priorHigh)}, showing weaker rallies.`);else supportive.push('The latest 20-session high has not formed a clear lower-high warning.');
  if(lowerLow)bearishReasons.push(`The latest 20-session low ${money.format(recentLow)} is below the preceding low ${money.format(priorLow)}, showing weaker support.`);else supportive.push('The recent price window has not formed a clear lower-low warning.');
  if(emaBear)bearishReasons.push(`EMA 20 ${money.format(metrics.ema20)} is below EMA 50 ${money.format(metrics.ema50)}.`);else supportive.push(`EMA 20 ${money.format(metrics.ema20)} remains above EMA 50 ${money.format(metrics.ema50)}.`);
  if(belowEma20)bearishReasons.push(`Price is below EMA 20, so short-term momentum has weakened.`);
  if(mlBearish)bearishReasons.push(`ML adds downside evidence: ${ml.down}% fall versus ${ml.up}% rise over five trading days, with ${ml.accuracy}% historical test accuracy.`);else if(mlBullish)supportive.push(`ML currently challenges an immediate sell: ${ml.up}% rise versus ${ml.down}% fall, with ${ml.accuracy}% historical test accuracy.`);const market=marketSellContext();if(market.available&&market.advancePct<40&&market.averageMove<0)bearishReasons.push(`Broad-market proof is weak: only ${market.advancePct.toFixed(0)}% of screened stocks are advancing and their average move is ${percent(market.averageMove)}.`);else if(market.available&&market.advancePct>=60&&market.averageMove>0)supportive.push(`Broad-market participation is supportive: ${market.advancePct.toFixed(0)}% of screened stocks are advancing with an average move of ${percent(market.averageMove)}.`);
  let action='HOLD AND MONITOR',tone='hold',headline='The 90-session pattern does not show enough aligned evidence for an immediate exit.';
  if(stopHit){action='EXIT CONDITION MET';tone='exit';headline=`Price ${money.format(last)} is at or below the saved stop ${money.format(stop)}. The original risk plan has failed.`;}
  else if(targetHit&&(rsi!==null&&rsi>70||drawdown>-2)){action='PROTECT PROFIT';tone='protect';headline='The saved target is reached while price is near its recent high or momentum is stretched. Consider a planned partial exit or tighter protection.';}
  else if(bearishReasons.length>=5||(metrics?.signal==='REDUCE'&&emaBear&&lowerHigh)){action='REDUCE / REVIEW EXIT NOW';tone='reduce';headline='Multiple 90-session deterioration signals align. Waiting without a risk level exposes the position to further weakness.';}
  else if(bearishReasons.length>=3||mlBearish){action='TIGHTEN RISK';tone='protect';headline='The sell case is developing but not fully confirmed. Define or raise the stop and watch the next daily close.';}
  else if(mlBullish){headline='The 90-session structure is not strongly bearish and ML currently leans upward. Continue monitoring the risk line rather than selling from ML alone.';}
  const patternQuality=history.length>=70?'Full':'Limited',riskLine=stop>0?stop:Number(metrics?.support||recentLow||0),confirmation=emaBear?Number(metrics?.ema20||0):Number(recentLow||metrics?.support||0),nextStep=action==='EXIT CONDITION MET'?`Under the saved plan, a close below ${money.format(riskLine)} is an exit—not a new averaging signal.`:action.startsWith('REDUCE')?`Review position size now. Further confirmation would be a daily close below ${money.format(riskLine)}; improvement requires price to reclaim ${money.format(metrics?.ema20||last)}.`:action==='PROTECT PROFIT'?`Do not let an achieved target turn into an unmanaged loss. Use ${money.format(Math.max(riskLine,Number(metrics?.ema20||0)))} as the nearest evidence-based protection reference.`:`Continue only while daily closes respect ${money.format(riskLine)}. Reassess if EMA 20 falls below EMA 50 or the recent low fails.`;
  return {action,tone,headline,nextStep,bearishReasons,supportive,market,historyCount:history.length,patternQuality,trend90,drawdown,high90,low90,recentHigh,recentLow,riskLine,mlReliable,ml};
}
function sellAnalysisPanel(metrics,item=null,trade=null,compact=false){const watched=item||state.watchlist.find(row=>row.symbol===metrics?.symbol)||{},analysis=sellAnalysis(metrics,watched,trade),ml=analysis.ml||{},content=`<div class="sell-analysis-head"><span class="sell-action ${safe(analysis.tone)}">${safe(analysis.action)}</span><div><h3>${safe(analysis.headline)}</h3><p>${safe(analysis.nextStep)}</p></div></div><div class="sell-pattern-grid"><div><span>90-session move</span><strong class="${analysis.trend90>=0?'positive':'negative'}">${percent(analysis.trend90)}</strong></div><div><span>From 90-session high</span><strong class="${analysis.drawdown>=-5?'positive':'negative'}">${percent(analysis.drawdown)}</strong></div><div><span>Pattern coverage</span><strong>${analysis.historyCount} sessions</strong><small>${safe(analysis.patternQuality)} evidence window</small></div><div><span>ML five-day view</span><strong>${ml.available?`${ml.up}% rise / ${ml.down}% fall`:'Unavailable'}</strong><small>${ml.available?`${ml.accuracy}% historical test accuracy`:'Not used as a sell signal'}</small></div><div><span>Broad market</span><strong>${safe(analysis.market?.label||'Unavailable')}</strong><small>${analysis.market?.available?`${analysis.market.advancePct.toFixed(0)}% advancing · ${percent(analysis.market.averageMove)} average`:'No current breadth evidence'}</small></div></div><div class="sell-evidence"><div><h4>Proof supporting a sell or protection</h4><ul>${analysis.bearishReasons.map(reason=>`<li>${safe(reason)}</li>`).join('')||'<li>No aligned deterioration signal is currently detected.</li>'}</ul></div><div><h4>Proof against rushing the exit</h4><ul>${analysis.supportive.map(reason=>`<li>${safe(reason)}</li>`).join('')||'<li>No strong supportive pattern was detected.</li>'}</ul></div></div><section class="sell-news-context"><h4>Company and world-news evidence</h4><div data-sell-news="${safe(metrics?.symbol||'')}"><p class="news-empty">Loading company and world/India headline evidence…</p></div></section><p class="method-note">The action is a rules-based research prompt, not personalised financial advice. It studies up to 90 recent trading sessions first; ML is only a secondary five-day cross-check. Use completed daily closes and your own risk plan.</p>`;return compact?`<details class="ml-sell-panel"><summary><span>ML sell analysis</span><strong class="sell-action ${safe(analysis.tone)}">${safe(analysis.action)}</strong></summary><div class="ml-sell-body">${content}</div></details>`:`<section class="detail-section ml-sell-panel open"><p class="research-label">90-SESSION SELL ANALYSIS</p>${content}</section>`;}
function currentMonitorSummary(status,item,metrics,trade){const score=Number(metrics?.score||0),emaAligned=Number(metrics?.ema20)>=Number(metrics?.ema50),levelsMissing=!item.stop||!item.target;if(status.key==='IN_TRADE')return `Manual paper position is active, but the model is ${metrics?.signal||'unavailable'} (${score}/100). ${levelsMissing?'Add a stop and target before evaluating the outcome.':'Follow the saved stop and target.'} Full evidence is recorded in the timeline below.`;if(status.key==='WAITING')return `No entry confirmation: score ${score}/100 and EMA alignment is ${emaAligned?'constructive but other BUY gates are missing':'not yet constructive'}. Full evidence and required confirmation are in the timeline.`;if(status.key==='ENTRY_CONFIRMED')return `BUY score and EMA trend are aligned. Confirm price, position size and stop before recording a paper entry; see the timeline for the supporting evidence.`;if(status.key==='STOP_HIT'||status.key==='SETUP_FAILED')return `The saved risk condition has failed. Avoid treating the current price as an automatic re-entry; see the timeline for the exact evidence.`;if(status.key==='TARGET_REACHED')return `The saved target condition was reached. This records an outcome, not a guarantee; see the timeline for context.`;if(status.key==='CLOSED')return 'The paper position is closed. Review the timeline to compare the entry reasoning with the recorded outcome.';return status.reason;}
function renderWatchlistLoading(items=state.watchlist,message='Saved. Loading market data…'){
  const list=$('#watchlist-items'),note=$('#watchlist-note');if(!list)return;
  const view=visiblePage(items,state.watchPage);state.watchPage=view.page;
  list.innerHTML=view.items.map(item=>`<article class="watch-loading-row"><div><strong>${safe(item.symbol)}</strong><small>${safe(message)}</small></div><div class="watch-loading-levels"><span>${item.target?`Target ${money.format(item.target)}`:'No target'}</span><span>${item.stop?`Stop ${money.format(item.stop)}`:'No stop'}</span></div><button class="watch-remove" data-remove-watch="${safe(item.symbol)}" type="button">Remove</button></article>`).join('');
  pager('#watch-pager',view.page,view.pages,'watch',items.length,view.size);if(note)note.textContent=`${items.length} stock${items.length===1?'':'s'} saved on this device · loading analysis…`;
}
function renderWatchlist(rows = state.watchRows){
  const list=$('#watchlist-items'),note=$('#watchlist-note');if(!list||!note)return;const session=nseSessionState();
  if(!state.watchlist.length){list.innerHTML='<p class="watchlist-empty">No stocks watched yet. Add an NSE ticker, a target price, or a stop level.</p>';note.textContent=`${session.label} · saved only on this device · maximum ${MAX_WATCHLIST_SIZE} stocks`;pager('#watch-pager',0,0,'watch');return;}
  const indexed=new Map(rows.map(row=>[row.symbol,row])),trades=paperTrades(),events=monitorEvents(),view=visiblePage(state.watchlist,state.watchPage);state.watchPage=view.page;
  if(!state.expandedWatchInitialized){state.expandedWatchSymbols=new Set(view.items.filter(item=>trades[item.symbol]?.status==='open').slice(0,1).map(item=>item.symbol));state.expandedWatchInitialized=true;}if(!(state.expandedWatchSymbols instanceof Set))state.expandedWatchSymbols=new Set();
  list.innerHTML=view.items.map(item=>{const row=indexed.get(item.symbol)||{...item,metrics:cachedStockAnalysis(item.symbol)},metrics=row.metrics,trade=trades[item.symbol],status=monitorStatus(item,metrics,trade),pnl=tradePnl(metrics,trade),alert=alertForWatch(item,metrics),timeline=(events[item.symbol]||[]).slice(0,5),fresh=row.fetchedAt?new Date(row.fetchedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'saved data',expanded=state.expandedWatchSymbols.has(item.symbol),position=trade?`${trade.quantity} @ ${money.format(trade.entryPrice)}`:'Not entered',pnlText=paperPnlText(pnl,trade);return `<details class="watch-row monitor-row compact-monitor ${alert?'watch-alert-row':''}" data-monitor-symbol="${safe(item.symbol)}" ${expanded?'open':''}><summary class="compact-monitor-summary"><div class="compact-company"><strong>${safe(item.symbol)}</strong><small>${metrics?safe(metrics.name):'Loading market data…'}</small></div><div class="compact-fact"><span>Price</span><strong>${metrics?money.format(metrics.lastPrice):'—'}</strong><small class="${Number(metrics?.pChange)>.005?'positive':Number(metrics?.pChange)<-.005?'negative':'neutral'}">${safe(sessionMoveText(metrics,session))}</small></div><div class="compact-fact"><span>Signal / risk</span><strong>${metrics?`${safe(metrics.signal)} · ${safe(metrics.risk)}`:'—'}</strong><small>${item.target?`Target ${money.format(item.target)}`:'No target'} · ${item.stop?`Stop ${money.format(item.stop)}`:'No stop'}</small></div><div class="compact-fact compact-position"><span>Paper position</span><strong>${position}</strong><small class="${pnl?.value>.005?'positive':pnl?.value<-.005?'negative':'neutral'}">${safe(pnlText)}</small></div><span class="monitor-status ${safe(status.tone)}">${safe(status.label)}</span><span class="compact-chevron" aria-hidden="true"></span></summary><div class="monitor-expanded"><div class="expanded-meta"><span>Checked ${safe(fresh)}</span><span>${safe(metrics?.dataSource||'market data')}</span></div><p class="monitor-reason">${safe(currentMonitorSummary(status,item,metrics,trade))}</p>${sellAnalysisPanel(metrics,item,trade,true)}<div class="watch-actions"><button class="review-button" data-review="${safe(item.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(item.symbol)}" type="button">Decision</button>${!trade?`<button class="paper-enter" data-paper-enter="${safe(item.symbol)}" type="button" ${metrics?.lastPrice?'':'disabled'}>Mark entered</button>`:trade.status==='open'?`<button class="paper-close" data-paper-close="${safe(item.symbol)}" type="button">Close trade</button>`:`<button class="paper-reset" data-paper-reset="${safe(item.symbol)}" type="button">Reset</button>`}<button class="watch-edit" data-edit-watch="${safe(item.symbol)}" type="button">Edit levels</button><button class="watch-remove" data-remove-watch="${safe(item.symbol)}" type="button">Remove</button></div>${beginnerCoachPanel(item,metrics,trade)}<details class="monitor-timeline"><summary>Status timeline (${timeline.length})</summary>${timeline.length?timeline.map(event=>`<div><time>${safe(new Date(event.at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</time><strong>${safe(String(event.status).replaceAll('_',' '))}</strong><span>${safe(event.note||'')} ${event.price?`· ${money.format(event.price)}`:''}</span></div>`).join(''):'<p>No status changes recorded yet.</p>'}</details></div></details>`;}).join('');
  list.querySelectorAll('[data-sell-news]').forEach(node=>void loadSellNewsPanels(node.dataset.sellNews));
  list.querySelectorAll('[data-monitor-symbol]').forEach(card=>card.addEventListener('toggle',()=>{const symbol=card.dataset.monitorSymbol;if(card.open)state.expandedWatchSymbols.add(symbol);else state.expandedWatchSymbols.delete(symbol);}));
  pager('#watch-pager',view.page,view.pages,'watch',state.watchlist.length,view.size);note.textContent=`${session.label} · ${session.open?'automatic checks every 5 minutes':'automatic checks resume during NSE hours'} · paper mode only`;
}
async function refreshWatchlist(){
  if(!state.watchlist.length){state.watchRows=[];renderWatchlist();return;}const items=state.watchlist.map(item=>({...item}));state.watchRows=items.map(item=>({...item,metrics:cachedStockAnalysis(item.symbol)}));
  try{renderWatchlist();}catch(error){console.error('Watchlist initial render failed',error);renderWatchlistLoading(items,'Saved. Loading the detailed analysis…');}
  const rows=await Promise.all(items.map(async item=>{try{return {...item,metrics:await loadStockAnalysis(item.symbol),fetchedAt:new Date().toISOString()};}catch(error){return {...item,metrics:cachedStockAnalysis(item.symbol),error,fetchedAt:null};}}));state.watchRows=rows;updateMonitorStates(rows);
  try{renderWatchlist(rows);}catch(error){console.error('Watchlist detailed render failed',error);renderWatchlistLoading(items,'Saved, but detailed analysis could not be displayed. Refresh to retry.');}
  processWatchAlerts(rows);
}

function editWatch(symbol) {
  const item = state.watchlist.find(entry => entry.symbol === symbol);
  if (!item) return;
  $('#watch-ticker').value = item.symbol;
  $('#watch-target').value = item.target || '';
  $('#watch-stop').value = item.stop || '';
  $('#watch-submit').textContent = 'Update watch';
  $('#watch-ticker').focus();
}

function addOrUpdateWatch(symbol, target = null, stop = null) {
  const ticker = cleanTicker(symbol);
  if (!ticker) return;
  const existingIndex = state.watchlist.findIndex(item => item.symbol === ticker);
  if (existingIndex < 0 && state.watchlist.length >= MAX_WATCHLIST_SIZE) {
    $('#watchlist-note').textContent = `Watchlist limit reached (${MAX_WATCHLIST_SIZE}). Remove a stock before adding another.`;
    return;
  }
  const existing = existingIndex >= 0 ? state.watchlist[existingIndex] : null;
  const preserveLevels = target === null && stop === null;
  const item = {
    symbol: ticker,
    target: preserveLevels ? existing?.target || null : (Number(target) > 0 ? Number(target) : null),
    stop: preserveLevels ? existing?.stop || null : (Number(stop) > 0 ? Number(stop) : null)
  };
  const next = [...state.watchlist];
  if (existingIndex >= 0) next[existingIndex] = item;
  else next.push(item);
  saveWatchlist(next);
  state.watchPage = Math.floor(Math.max(0, next.findIndex(value => value.symbol === ticker)) / (compactWorkspace() ? 3 : 10));
  renderWatchlistLoading(next, existingIndex >= 0 ? 'Watch settings updated. Refreshing analysis…' : 'Added to your watchlist. Loading analysis…');
  syncWatchButtons();
  const sent = readCache(WATCH_ALERTS_KEY) || {};
  Object.keys(sent).filter(key => key.startsWith(`${ticker}:`)).forEach(key => delete sent[key]);
  writeCache(WATCH_ALERTS_KEY, sent);
  $('#watch-submit').textContent = 'Add to watchlist';
  $('#watch-ticker').value = '';
  $('#watch-target').value = '';
  $('#watch-stop').value = '';
  void refreshWatchlist();
}

function activateWorkspaceTab(name) {
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const active = panel.id === `panel-${name}`;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  if (name === 'sectors' && !state.sectorLoaded) void loadSector();
  if (name === 'updates') void loadUpdates();
  if (name === 'watchlist') void refreshWatchlist();
}

function setupWorkspace() {
  const main = document.querySelector('main');
  const hero = main?.querySelector('.hero');
  if (!main || !hero || document.querySelector('.workspace-tabs')) return;
  main.classList.add('app-shell');
  hero.classList.add('workspace-header');
  const heroEyebrow = hero.querySelector('.eyebrow');
  const heroTitle = hero.querySelector('h1');
  const heroDescription = hero.querySelector('p:not(.eyebrow)');
  const refreshButton = hero.querySelector('#refresh');
  if (heroEyebrow) heroEyebrow.textContent = 'NSE MARKET WORKSPACE';
  if (heroTitle) heroTitle.textContent = 'Simple research, one view at a time.';
  if (heroDescription) heroDescription.textContent = 'Top 10, sector momentum, ticker analysis, alerts, and exchange updates—kept in focused tabs.';
  if (refreshButton) refreshButton.textContent = 'Refresh data';
  const tabs = document.createElement('nav');
  tabs.className = 'workspace-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Market Pulse sections');
  tabs.innerHTML = [
    ['market', 'Top 10'], ['sectors', 'Sectors'], ['research', 'Research'], ['updates', 'Updates'], ['watchlist', 'Watchlist']
  ].map(([key, label], index) => `<button class="workspace-tab${index === 0 ? ' is-active' : ''}" id="tab-${key}" role="tab" aria-selected="${index === 0}" aria-controls="panel-${key}" data-tab="${key}" type="button">${label}</button>`).join('');
  const panels = document.createElement('div');
  panels.className = 'tab-panels';
  const createPanel = (key, label) => {
    const panel = document.createElement('section');
    panel.className = `tab-panel${key === 'market' ? ' is-active' : ''}`;
    panel.id = `panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${key}`);
    panel.hidden = key !== 'market';
    panel.dataset.label = label;
    panels.append(panel);
    return panel;
  };
  const market = createPanel('market', 'Top 10');
  const sectors = createPanel('sectors', 'Sectors');
  const research = createPanel('research', 'Research');
  const updates = createPanel('updates', 'Updates');
  const watchlist = createPanel('watchlist', 'Watchlist');
  ['.disclaimer', '.metric-grid', '.screening'].forEach(selector => { const node = main.querySelector(selector); if (node) market.append(node); });
  const marketTable = market.querySelector('.table-wrap');
  if (marketTable) {
    marketTable.insertAdjacentHTML('beforebegin', '<div id="stock-pager" class="data-pager" aria-label="Top 10 pages"></div>');
    marketTable.insertAdjacentHTML('afterend', '<div id="stock-cards" class="stock-card-list" aria-live="polite"></div>');
  }
  ['.lookup-card', '.investment-card'].forEach(selector => { const node = main.querySelector(selector); if (node) research.append(node); });
  const lookupPane = research.querySelector('.lookup-card');
  const calculatorPane = research.querySelector('.investment-card');
  if (lookupPane && calculatorPane) {
    lookupPane.classList.add('research-pane', 'is-active');
    calculatorPane.classList.add('research-pane');
    calculatorPane.hidden = true;
    const researchTabs = document.createElement('div');
    researchTabs.className = 'research-tabs';
    researchTabs.innerHTML = '<button class="research-tab is-active" data-research-pane="lookup" type="button">Ticker analysis</button><button class="research-tab" data-research-pane="calculator" type="button">Return calculator</button>';
    research.prepend(researchTabs);
    researchTabs.addEventListener('click', event => {
      const button = event.target.closest('[data-research-pane]');
      if (!button) return;
      const showCalculator = button.dataset.researchPane === 'calculator';
      lookupPane.hidden = showCalculator;
      calculatorPane.hidden = !showCalculator;
      researchTabs.querySelectorAll('button').forEach(tab => tab.classList.toggle('is-active', tab === button));
    });
  }
  const sectorContent = document.createElement('div');
  sectorContent.className = 'sector-workspace';
  sectorContent.innerHTML = `<div class="section-title sector-heading"><div><p class="eyebrow">SECTOR MOMENTUM</p><h2>Top 10 stocks by sector</h2></div><span id="sector-note">Choose a sector to load the latest ranking.</span></div><div class="sector-tabs" role="tablist" aria-label="NSE sector ranking">${Object.entries(SECTOR_LABELS).map(([key, label], index) => `<button class="sector-tab${index === 0 ? ' is-active' : ''}" data-sector="${key}" type="button">${label}</button>`).join('')}</div><div class="sector-insight" id="sector-insight" aria-live="polite">Sector analysis uses daily NSE-symbol data. It is research, not a price target.</div><div class="table-wrap sector-table-wrap"><table><thead><tr><th>#</th><th>Company</th><th>Last price</th><th>Today</th><th>3M trend</th><th>Signal</th><th>12M scenario</th><th>Trade levels</th><th>Actions</th></tr></thead><tbody id="sector-table"></tbody></table></div>`;
  sectors.append(sectorContent);
  const sectorTable = sectors.querySelector('.sector-table-wrap');
  if (sectorTable) {
    sectorTable.insertAdjacentHTML('beforebegin', '<div id="sector-pager" class="data-pager" aria-label="Sector ranking pages"></div>');
    sectorTable.insertAdjacentHTML('afterend', '<div id="sector-cards" class="stock-card-list" aria-live="polite"></div>');
  }
  const updatesCard = main.querySelector('.updates-card'); if (updatesCard) updates.append(updatesCard);
  const watchlistCard = main.querySelector('.watchlist-card'); if (watchlistCard) { watchlist.append(watchlistCard); watchlistCard.querySelector('#watchlist-items')?.insertAdjacentHTML('afterend', '<div id="watch-pager" class="data-pager" aria-label="Watchlist pages"></div>'); }
  hero.after(tabs, panels);
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (button) activateWorkspaceTab(button.dataset.tab);
  });
}

document.addEventListener('click', event => {
  const pageButton = event.target.closest('[data-page-kind]');
  if (pageButton && !pageButton.disabled) {
    const next = Math.max(0, Number(pageButton.dataset.page) || 0);
    if (pageButton.dataset.pageKind === 'leaders') { state.leaderPage = next; renderLeaders(); }
    if (pageButton.dataset.pageKind === 'sector' && state.sectorData) { state.sectorPage = next; renderSectorLeaders(state.sectorData); }
    if (pageButton.dataset.pageKind === 'watch') { state.watchPage = next; renderWatchlist(); }
    return;
  }
  const sector = event.target.closest('[data-sector]');
  if (sector) return void loadSector(sector.dataset.sector);
  const review = event.target.closest('[data-review]');
  if (review) return openReview(review.dataset.review);
  const decision = event.target.closest('[data-decision]');
  if (decision) return openReview(decision.dataset.decision, 'decision');
  const watch = event.target.closest('[data-watch]');
  if (watch) return addOrUpdateWatch(watch.dataset.watch);
  const enter=event.target.closest('[data-paper-enter]');if(enter)return enterPaperTrade(enter.dataset.paperEnter);
  const closeTrade=event.target.closest('[data-paper-close]');if(closeTrade)return closePaperTrade(closeTrade.dataset.paperClose);
  const resetTrade=event.target.closest('[data-paper-reset]');if(resetTrade)return resetPaperTrade(resetTrade.dataset.paperReset);
  const coachReview=event.target.closest('[data-coach-review]');if(coachReview)return recordCoachReview(coachReview.dataset.coachReview);
  const edit = event.target.closest('[data-edit-watch]');
  if (edit) return editWatch(edit.dataset.editWatch);
  const remove = event.target.closest('[data-remove-watch]');
  if (remove) {
    const ticker = remove.dataset.removeWatch;
    saveWatchlist(state.watchlist.filter(item => item.symbol !== ticker));
    const trades=paperTrades();delete trades[ticker];savePaperTrades(trades);
    const history=monitorEvents();delete history[ticker];saveMonitorEvents(history);
    syncWatchButtons();
    const sent = readCache(WATCH_ALERTS_KEY) || {};
    Object.keys(sent).filter(key => key.startsWith(`${ticker}:`)).forEach(key => delete sent[key]);
    writeCache(WATCH_ALERTS_KEY, sent);
    void refreshWatchlist();
  }
});

/* v39 wheel routing: legacy nested overflow rules must not trap vertical navigation. */
document.addEventListener('wheel', event => {
  if (!event.deltaY || event.ctrlKey) return;
  const modal = $('#review-modal');
  const target = modal?.open ? $('#modal-content') : document.scrollingElement;
  if (!target) return;
  event.preventDefault();
  if (modal?.open) target.scrollTop += event.deltaY;
  else window.scrollBy(0, event.deltaY);
}, { passive: false });
let resizeTimer;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.leaders.length) renderLeaders();
    if (state.sectorData) renderSectorLeaders(state.sectorData);
    if (state.watchlist.length) renderWatchlist();
  }, 120);
});

$('#refresh').addEventListener('click', refresh);
$('#theme-toggle').addEventListener('click', () => document.body.classList.toggle('night'));
function setupTickerAutocomplete(){
  const input=$('#ticker-input'),form=$('#ticker-form');if(!input||!form||form.querySelector('.ticker-suggestions'))return;const box=document.createElement('div');box.className='ticker-suggestions';box.id='ticker-suggestions';box.setAttribute('role','listbox');box.hidden=true;form.append(box);input.setAttribute('role','combobox');input.setAttribute('aria-controls',box.id);input.setAttribute('aria-expanded','false');let timer=0,request=0,active=-1,matches=[];
  const close=()=>{box.hidden=true;box.innerHTML='';input.setAttribute('aria-expanded','false');active=-1;};
  const choose=item=>{input.value=item.symbol;input.dataset.selectedSymbol=item.symbol;close();input.focus();};
  const paint=()=>{box.querySelectorAll('button').forEach((button,index)=>{button.classList.toggle('is-active',index===active);button.setAttribute('aria-selected',String(index===active));});};
  const search=async()=>{const query=input.value.trim();delete input.dataset.selectedSymbol;if(query.length<2){close();return;}const id=++request;box.hidden=false;box.innerHTML='<p>Finding NSE stocks…</p>';input.setAttribute('aria-expanded','true');try{const data=await api('symbols','',{q:query});if(id!==request)return;matches=data.matches||[];active=-1;box.innerHTML=matches.length?matches.map((item,index)=>`<button type="button" role="option" data-suggestion-index="${index}" aria-selected="false"><strong>${safe(item.symbol)}</strong><span>${safe(item.name)}</span></button>`).join(''):'<p>No matching NSE equity found. Try more letters from the company name or its exchange symbol.</p>';}catch(error){if(id!==request)return;matches=[];box.innerHTML=`<p>Suggestions are temporarily unavailable. You can still enter an exact NSE symbol.</p>`;}};
  input.addEventListener('input',()=>{window.clearTimeout(timer);timer=window.setTimeout(search,180);});
  input.addEventListener('keydown',event=>{if(box.hidden||!matches.length)return;if(event.key==='ArrowDown'){event.preventDefault();active=(active+1)%matches.length;paint();}else if(event.key==='ArrowUp'){event.preventDefault();active=(active-1+matches.length)%matches.length;paint();}else if(event.key==='Enter'){event.preventDefault();choose(matches[active>=0?active:0]);form.requestSubmit();}else if(event.key==='Escape')close();});
  box.addEventListener('click',event=>{const button=event.target.closest('[data-suggestion-index]');if(button)choose(matches[Number(button.dataset.suggestionIndex)]);});
  document.addEventListener('click',event=>{if(!form.contains(event.target))close();});
  form.addEventListener('submit',event=>{if(input.dataset.selectedSymbol||!matches.length)return;const typed=input.value.trim().toUpperCase(),choice=matches.find(item=>item.symbol===typed)||matches[0];event.preventDefault();event.stopImmediatePropagation();choose(choice);window.queueMicrotask(()=>form.requestSubmit());},true);
}
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
  loadStockAnalysis(ticker)
    .then(stock => renderInvestmentScenario(stock, units))
    .catch(error => { $('#investment-result').textContent = `Could not calculate ${ticker}: ${error.message}. Try again shortly.`; })
    .finally(() => { button.disabled = false; button.textContent = 'Calculate returns'; });
});
function closeReview() { reviewRequestId += 1; $('#review-modal').close(); }
$('#modal-close').addEventListener('click', closeReview);
$('#review-modal').addEventListener('click', event => { if (event.target === $('#review-modal')) closeReview(); });
$('#watchlist-form').addEventListener('submit', event => {
  event.preventDefault();
  addOrUpdateWatch($('#watch-ticker').value, $('#watch-target').value, $('#watch-stop').value);
});
$('#enable-device-alerts').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  await Notification.requestPermission();
  updateAlertButton();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
setupWorkspace();
setupTickerAutocomplete();
state.watchlist = readWatchlist();
renderWatchlist();
syncWatchButtons();
updateAlertButton();
setupWatchMonitor();
refresh();

/* v38: research-led scoring and analytical indicators */
const RECOMMENDATIONS_CACHE_KEY_V38='market-pulse-recommendations-v39.6-buy-qualified';
function bounded(value,min=0,max=100){return Math.max(min,Math.min(max,Math.round(Number(value)||0)));}
function average(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}
function emaSeries(values,period){if(!values.length)return [];const alpha=2/(period+1);let current=values[0];return values.map((value,index)=>{current=index?value*alpha+current*(1-alpha):value;return current;});}
function rsiValue(values,period=14){if(values.length<period+1)return null;const base=values.slice(-period-1);const changes=base.slice(1).map((value,index)=>value-base[index]);const gains=average(changes.map(value=>Math.max(value,0)));const losses=average(changes.map(value=>Math.max(-value,0)));if(!losses)return 100;return 100-100/(1+gains/losses);}
function isDataNumber(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));}
function valueOrDash(value,suffix=''){return isDataNumber(value)?`${Number(value).toFixed(1)}${suffix}`:'—';}
function growthDescription(value,label){if(!isDataNumber(value))return `${label} data was not returned.`;return Number(value)>=0?`${label} grew ${Number(value).toFixed(1)}% year-on-year.`:`${label} declined ${Math.abs(Number(value)).toFixed(1)}% year-on-year.`;}
function scoreStock(stock){const price=Number(stock.lastPrice||0),move=Number(stock.pChange||0),range=Math.max(0,Number(stock.dayHigh||price)-Number(stock.dayLow||price)),rangePct=price?range/price*100:0,nearHigh=stock.yearHigh&&price?price/Number(stock.yearHigh):null;let technical=50+(move>=2?15:move>=.75?9:move>0?4:move<=-2?-15:move<0?-7:0)+(rangePct<=2.5?5:rangePct>5?-7:0)+(nearHigh!==null&&nearHigh>=.88?5:nearHigh!==null&&nearHigh<.7?-5:0);if(isDataNumber(stock.ema20)&&isDataNumber(stock.ema50))technical+=stock.ema20>=stock.ema50?9:-9;if(isDataNumber(stock.trend))technical+=stock.trend>0?7:stock.trend<0?-7:0;if(isDataNumber(stock.rsi))technical+=stock.rsi>=45&&stock.rsi<=68?5:stock.rsi>75?-5:stock.rsi<35?-5:0;technical=bounded(technical);const f=stock.fundamentals||{},factorNotes=[];let fundamental=null;if(f.available){fundamental=50;const addGrowth=(value,label)=>{if(!isDataNumber(value))return;if(Number(value)>=12){fundamental+=12;factorNotes.push(`${label} growth is strong (${Number(value).toFixed(1)}% YoY).`);}else if(Number(value)>=5){fundamental+=6;factorNotes.push(`${label} is growing (${Number(value).toFixed(1)}% YoY).`);}else if(Number(value)<0){fundamental-=12;factorNotes.push(`${label} contracted (${Math.abs(Number(value)).toFixed(1)}% YoY).`);}};addGrowth(f.revenueGrowth,'Revenue');addGrowth(f.profitGrowth,'Net profit');const compare=(company,sector,label)=>{if(!isDataNumber(company)||!isDataNumber(sector))return;if(Number(company)-Number(sector)>=1){fundamental+=7;factorNotes.push(`${label} is above the sector reference.`);}else if(Number(company)-Number(sector)<=-1){fundamental-=6;factorNotes.push(`${label} is below the sector reference.`);}};compare(f.roe,f.sectorRoe,'ROE');compare(f.roce,f.sectorRoce,'ROCE');if(isDataNumber(f.pe)&&isDataNumber(f.sectorPe)){if(Number(f.pe)<=Number(f.sectorPe)){fundamental+=7;factorNotes.push('P/E is not above the sector reference.');}else if(Number(f.pe)>Number(f.sectorPe)*1.35){fundamental-=8;factorNotes.push('P/E is materially above the sector reference.');}}fundamental=bounded(fundamental);}else factorNotes.push('Fundamental inputs were not available from the current provider, so this score is technical-only.');const score=fundamental===null?technical:bounded(technical*.45+fundamental*.55);return {...stock,technicalScore:technical,fundamentalScore:fundamental,score,signal:score>=72?'BUY':score>=52?'HOLD':'REDUCE',risk:Number(stock.volatility||0)>38||rangePct>5?'High':Number(stock.volatility||0)>24||rangePct>2.5?'Moderate':'Lower',rangePct,factorNotes};}
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
function historicalMetrics(stock){const history=(stock.history||[]).filter(point=>Number(point.close)>0).map(point=>({date:point.date,close:Number(point.close)})),closes=history.map(point=>point.close),lastPrice=Number(stock.lastPrice||closes.at(-1)||0),values=closes.length?closes:[lastPrice],ema20Series=emaSeries(values,20),ema50Series=emaSeries(values,50),ema20=ema20Series.at(-1)||lastPrice,ema50=ema50Series.at(-1)||lastPrice,reference=values.at(Math.max(0,values.length-21))||lastPrice,trend=reference?(lastPrice-reference)/reference*100:Number(stock.pChange||0),recent=values.slice(-20),support=recent.length?Math.min(...recent):Number(stock.dayLow||lastPrice),resistance=recent.length?Math.max(...recent):Number(stock.dayHigh||lastPrice),returns=values.slice(1).map((value,index)=>Math.log(value/values[index])).filter(Number.isFinite),volatility=returns.length?Math.sqrt(average(returns.map(value=>value*value)))*Math.sqrt(252)*100:0,rsi=rsiValue(values),base=Math.max(-35,Math.min(45,trend*1.8-volatility*.12));const scored=scoreStock({...stock,history,lastPrice,support,resistance,trend,volatility,rsi,ema20,ema50,ema20Series,ema50Series,base,bull:Math.min(65,base+14),bear:Math.max(-55,base-21)});return {...scored,ml:mlOutlook(history)};}
function visiblePage(items,page){const size=10,pages=Math.max(1,Math.ceil(items.length/size)),active=Math.max(0,Math.min(page,pages-1));return {items:items.slice(active*size,active*size+size),page:active,pages,size};}
function pager(target,page,pages,kind,total=0,size=0){const node=$(target);if(!node)return;if(pages<=1){node.innerHTML='';return;}const start=total?page*size+1:0,end=total?Math.min(total,start+size-1):0;node.innerHTML=`<button class="pager-button" data-page-kind="${kind}" data-page="${page-1}" type="button" ${page===0?'disabled':''}>Previous</button><span class="pager-status"><strong>${start}-${end}</strong> of ${total}</span><button class="pager-button" data-page-kind="${kind}" data-page="${page+1}" type="button" ${page===pages-1?'disabled':''}>Next</button>`;}
function isWatched(symbol){const ticker=cleanTicker(symbol);return state.watchlist.some(item=>item.symbol===ticker);}
function watchButtonMarkup(symbol,compact=false){const ticker=cleanTicker(symbol),watched=isWatched(ticker),label=watched?'Already watching':'Add to watchlist';return `<button class="watch-button${compact?' watch-icon-button':''}${watched?' is-watching':''}" data-watch="${safe(ticker)}" type="button" aria-pressed="${watched}" aria-label="${label} ${safe(ticker)}" title="${label}" ${watched?'disabled':''}>${compact?(watched?'★':'☆'):(watched?'✓ Watching':'Watch')}</button>`;}
function syncWatchButtons(){document.querySelectorAll('[data-watch]').forEach(button=>{const watched=isWatched(button.dataset.watch),compact=button.classList.contains('watch-icon-button'),label=watched?'Already watching':'Add to watchlist';button.classList.toggle('is-watching',watched);button.textContent=compact?(watched?'★':'☆'):(watched?'✓ Watching':'Watch');button.disabled=watched;button.setAttribute('aria-pressed',String(watched));button.setAttribute('aria-label',`${label} ${button.dataset.watch}`);button.title=label;});}
function stockCard(stock,index,sector=false){const scoreNote=stock.fundamentalScore===null?'technical context':'fundamentals + technicals',levelOrRisk=sector&&stock.support?`<div><span>Levels</span><strong>${money.format(stock.support)} / ${money.format(stock.resistance)}</strong><small>support / resistance</small></div>`:`<div><span>Risk</span><strong>${safe(stock.risk)}</strong><small>daily range ${stock.rangePct.toFixed(2)}%</small></div>`;return `<article class="stock-card"><div class="stock-card-heading"><div><span class="stock-rank">#${index+1}</span><strong>${safe(stock.symbol)}</strong><small>${safe(stock.name)}</small></div><span class="signal ${stock.signal}">${stock.signal}</span></div><div class="stock-card-metrics"><div><span>Last price</span><strong>${money.format(stock.lastPrice)}</strong><small class="${stock.pChange>=0?'positive':'negative'}">${percent(stock.pChange)} today</small></div><div><span>Signal score</span><strong>${stock.score}/100</strong><small>${scoreNote}</small></div>${levelOrRisk}</div><div class="stock-card-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision brief</button>${watchButtonMarkup(stock.symbol,sector)}</div></article>`;}function chart(metrics){const data=(metrics.history||[]).slice(-140);if(data.length<2)return '<p class="chart-empty">Historical data was not returned by the current source, so EMA and RSI cannot be calculated yet.</p>';const width=700,height=290,pad=34,prices=data.map(row=>row.close),ema20=(metrics.ema20Series||[]).slice(-data.length),ema50=(metrics.ema50Series||[]).slice(-data.length),allValues=[...prices,...ema20,...ema50].filter(Number.isFinite),low=Math.min(...allValues),high=Math.max(...allValues),range=high-low||1,x=index=>pad+index*(width-pad*2)/(data.length-1),y=value=>height-pad-(value-low)*(height-pad*2)/range,points=values=>values.map((value,index)=>`${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' '),grid=[0,.25,.5,.75,1].map(step=>{const value=high-range*step,yy=y(value);return `<g><line x1="${pad}" y1="${yy}" x2="${width-pad}" y2="${yy}" class="chart-grid"/><text x="3" y="${yy+4}" class="chart-axis">${money.format(value)}</text></g>`;}).join(''),dates=[0,Math.floor((data.length-1)/3),Math.floor((data.length-1)*2/3),data.length-1].map(index=>`<text x="${x(index)}" y="${height-7}" text-anchor="middle" class="chart-axis">${safe(String(data[index].date||'').slice(5))}</text>`).join('');return `<div class="advanced-chart"><div class="chart-legend"><span class="legend-price">Close</span><span class="legend-ema20">EMA 20</span><span class="legend-ema50">EMA 50</span><span class="legend-rsi">RSI 14: ${valueOrDash(metrics.rsi)}</span></div><div class="chart-shell"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Price chart with EMA 20 and EMA 50">${grid}<polyline points="${points(prices)}" class="price-line"/><polyline points="${points(ema20)}" class="ema-line ema20-line"/><polyline points="${points(ema50)}" class="ema-line ema50-line"/><line class="crosshair" y1="${pad}" y2="${height-pad}" visibility="hidden"/><circle class="point" r="5" visibility="hidden"/>${dates}</svg><div class="chart-tip" aria-live="polite"></div></div><p class="indicator-help"><strong>EMA 20</strong> shows the short trend; <strong>EMA 50</strong> shows the broader trend. EMA 20 above EMA 50 is constructive; below is cautionary. <strong>RSI</strong> is a momentum gauge: roughly 45–68 is balanced, while extremes can mean elevated reversal risk.</p></div>`;}
function bindChart(metrics){const svg=$('.price-chart');if(!svg||!metrics.history?.length)return;const tip=$('.chart-tip'),cross=svg.querySelector('.crosshair'),point=svg.querySelector('.point'),data=metrics.history.slice(-140),width=700,height=290,pad=34,values=data.map(row=>row.close),all=[...values,...(metrics.ema20Series||[]).slice(-data.length),...(metrics.ema50Series||[]).slice(-data.length)].filter(Number.isFinite),low=Math.min(...all),high=Math.max(...all),range=high-low||1;const move=event=>{const bounds=svg.getBoundingClientRect(),localX=(event.clientX-bounds.left)/bounds.width*width,index=Math.max(0,Math.min(data.length-1,Math.round((localX-pad)*(data.length-1)/(width-pad*2)))),row=data[index],x=pad+index*(width-pad*2)/(data.length-1),y=height-pad-(row.close-low)*(height-pad*2)/range;cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('visibility','visible');point.setAttribute('cx',x);point.setAttribute('cy',y);point.setAttribute('visibility','visible');tip.style.left=`${Math.max(8,Math.min(bounds.width-190,event.clientX-bounds.left+10))}px`;tip.style.top=`${Math.max(8,event.clientY-bounds.top-72)}px`;tip.style.opacity='1';tip.innerHTML=`<strong>${safe(row.date)}</strong><br>Close ${money.format(row.close)}<br>EMA 20 ${money.format((metrics.ema20Series||[]).slice(-data.length)[index]||row.close)} · EMA 50 ${money.format((metrics.ema50Series||[]).slice(-data.length)[index]||row.close)}`;};svg.addEventListener('pointermove',move);svg.addEventListener('pointerdown',move);svg.addEventListener('pointerleave',()=>{tip.style.opacity='0';cross.setAttribute('visibility','hidden');point.setAttribute('visibility','hidden');});}
function riskSummary(metrics){const volatility=Number(metrics.volatility||0),range=Number(metrics.rangePct||0),trend=Number(metrics.trend||0),level=safe(metrics.risk||'Unknown'),direction=trend>2?'positive':trend<-2?'negative':'mostly sideways',triggers=[];if(volatility>38)triggers.push(`annualized volatility is ${volatility.toFixed(1)}%, above the 38% high-risk threshold`);else if(volatility>24)triggers.push(`annualized volatility is ${volatility.toFixed(1)}%, above the 24% moderate-risk threshold`);if(range>5)triggers.push(`the current daily range is ${range.toFixed(1)}%, above the 5% high-risk threshold`);else if(range>2.5)triggers.push(`the current daily range is ${range.toFixed(1)}%, above the 2.5% moderate-risk threshold`);if(!triggers.length)triggers.push(`volatility (${volatility.toFixed(1)}%) and daily range (${range.toFixed(1)}%) are below the elevated-risk thresholds`);const meaning=trend>0&&level==='High'?'The price trend is positive, but swings have been unusually large. Momentum may continue, while pullbacks and stop-loss movements can also be larger than normal.':trend<0&&level==='High'?'The trend is negative and price swings are large, combining directional weakness with elevated volatility.':level==='Moderate'?'Price movement is neither calm nor extreme. Use measured position sizing and allow for normal fluctuations.':'Recent movement is comparatively contained, but lower measured risk never means no risk.';return `<details class="risk-summary"><summary><span>Risk — click for explanation</span><strong>${level}</strong></summary><div class="risk-detail"><p><strong>${level} volatility risk with a ${direction} 20-day trend (${percent(trend)}).</strong></p><ul>${triggers.map(item=>`<li>${safe(item)}.</li>`).join('')}</ul><p>${safe(meaning)}</p><small>Risk measures the size and instability of price movements; it does not say whether the trend points up or down.</small></div></details>`;}
function marketThesis(metrics){
  const price=Number(metrics.lastPrice||0),support=Number(metrics.support||price),resistance=Number(metrics.resistance||price),ema20=Number(metrics.ema20||price),ema50=Number(metrics.ema50||price),trend=Number(metrics.trend||0),rsi=Number(metrics.rsi),holdLow=Math.min(support,ema20),holdHigh=Math.max(support,ema20),buyLow=support,buyHigh=support*1.03,nearResistance=resistance>0&&(resistance-price)/price<=.035,extended=Number.isFinite(rsi)&&rsi>=68;
  const structure=ema20>=ema50&&trend>0?'Bullish':ema20<ema50&&trend<0?'Weak':'Mixed';
  const headline=structure==='Bullish'?'Overall structure is constructive, but the closing levels still matter.':structure==='Weak'?'Structure is weak; wait for evidence of recovery before adding risk.':'Structure is mixed; confirmation is more important than prediction.';
  const profitBooking=nearResistance||extended?`Profit-booking risk is elevated near ${money.format(resistance)}${extended?` with RSI at ${rsi.toFixed(1)}`:''}. A weak daily close below ${money.format(ema20)} would increase that risk.`:`There is no strong profit-booking warning from the current distance to resistance, but a close below ${money.format(ema20)} would weaken momentum.`;
  const hold=`As long as daily closes hold the ${money.format(holdLow)}–${money.format(holdHigh)} area, a bounce remains possible.`;
  const confirmation=`A daily close above ${money.format(resistance)} would be stronger confirmation that the next upward leg may be starting.`;
  const pullback=`If the hold zone fails, ${money.format(buyLow)}–${money.format(buyHigh)} becomes a pullback research zone—not an automatic buy zone. Wait for price stabilisation and fresh evidence.`;
  const invalidation=`The constructive view is weakened by repeated closes below ${money.format(support)}; the weak view improves only after price reclaims ${money.format(ema20)} and then ${money.format(resistance)}.`;
  return {structure,headline,profitBooking,hold,confirmation,pullback,invalidation,support,resistance,ema20};
}
function marketThesisPanel(metrics){const t=marketThesis(metrics);return `<section class="detail-section market-thesis"><p class="research-label">CONDITIONAL MARKET VIEW</p><h3>${safe(t.headline)}</h3><div class="thesis-callout ${t.structure.toLowerCase()}"><strong>${safe(t.structure)} structure</strong><p>${safe(t.profitBooking)}</p></div><ul class="thesis-steps"><li><strong>Must-hold area:</strong> ${safe(t.hold)}</li><li><strong>Confirmation:</strong> ${safe(t.confirmation)}</li><li><strong>If price pulls back:</strong> ${safe(t.pullback)}</li><li><strong>What changes the view:</strong> ${safe(t.invalidation)}</li></ul><p class="method-note">These are conditional closing-price scenarios from recent history, not personalised entries, targets or guarantees.</p></section>`;}
function marketThesisSummary(stock){const t=stock.marketThesis;if(!t)return '<div class="recommendation-thesis"><strong>Open the full review for closing-price thesis levels.</strong></div>';const structure=Number(t.trend)>=0?'Constructive':'Mixed / weak';return `<div class="recommendation-thesis"><strong>${structure} short-term structure</strong><small>Must hold around ${money.format(t.support)}. A close above ${money.format(t.resistance)} would strengthen confirmation.</small><small>If support fails, wait for stabilisation instead of treating the level as an automatic buy.</small></div>`;}function mlThesisView(metrics){
  const ml=metrics.ml||{},signal=metrics.signal||(Number(metrics.model?.score)>=72?'BUY':Number(metrics.model?.score)>=52?'HOLD':'REDUCE');
  if(!ml.available)return {label:'ML cannot test the market view yet',tone:'neutral',explanation:'There is not enough price history. Judge the market view from business quality, valuation, technical evidence and risk.'};
  const leader=ml.up>=ml.down&&ml.up>=ml.sideways?'up':ml.down>=ml.up&&ml.down>=ml.sideways?'down':'sideways';
  if((signal==='BUY'&&leader==='up')||(signal==='REDUCE'&&leader==='down')||(signal==='HOLD'&&leader==='sideways'))return {label:'ML supports the current market view',tone:'support',explanation:`The rules-based view is ${signal}, and the largest ML probability points in the same direction. This is confirmation, not proof.`};
  if((signal==='BUY'&&leader==='down')||(signal==='REDUCE'&&leader==='up'))return {label:'ML challenges the current market view',tone:'challenge',explanation:`The rules-based view is ${signal}, but the strongest short-term price pattern points the other way. Treat this disagreement as a reason to wait, investigate and manage risk.`};
  return {label:'ML is neutral toward the current market view',tone:'neutral',explanation:`The rules-based view is ${signal}, while ML sees a mixed or sideways short-term pattern. The model neither clearly confirms nor rejects the market view.`};
}
function mlResearchSummary(stock){const ml=stock.ml||{},thesis=mlThesisView({...stock,signal:Number(stock.model?.score)>=72?'BUY':Number(stock.model?.score)>=52?'HOLD':'REDUCE'});if(!ml.available)return `<div class="recommendation-ml"><strong>${safe(thesis.label)}</strong><small>${safe(ml.note||thesis.explanation)}</small></div>`;return `<div class="recommendation-ml ${safe(thesis.tone)}"><strong>${safe(thesis.label)}</strong><small>${ml.up}% may rise · ${ml.sideways}% may stay similar · ${ml.down}% may fall</small><small>${safe(thesis.explanation)}</small><small>Correct group in ${ml.accuracy}% of unseen history.</small></div>`;}
function mlPanel(metrics){
  const ml=metrics.ml||{},thesis=mlThesisView(metrics);
  if(!ml.available)return `<section class="detail-section ml-panel"><p class="research-label">ML MARKET-VIEW CHECK</p><h3>${safe(thesis.label)}</h3><p>${safe(ml.note||thesis.explanation)}</p><p class="ml-guidance">Use the fundamental, valuation, technical and risk evidence instead. Missing ML data is not a positive or negative signal.</p></section>`;
  const outcomes=[{key:'down',label:'May fall',help:'more than 1.5% lower'},{key:'sideways',label:'May stay similar',help:'within about ±1.5%'},{key:'up',label:'May rise',help:'more than 1.5% higher'}],winner=outcomes.reduce((best,item)=>ml[item.key]>ml[best.key]?item:best,outcomes[0]),reliability=ml.accuracy>=55?'The model found a useful pattern in unseen history.':ml.accuracy>=40?'The historical result is mixed. Use this only as a secondary clue.':'The model performed poorly on unseen history. Do not rely on it for a decision.',plainConfidence=ml.accuracy>=55?'More reliable':ml.accuracy>=40?'Use cautiously':'Do not rely on this model';
  return `<section class="detail-section ml-panel"><p class="research-label">ML MARKET-VIEW CHECK</p><div class="ml-thesis ${safe(thesis.tone)}"><span>${safe(thesis.label)}</span><p>${safe(thesis.explanation)}</p></div><h3>What the model sees: ${safe(winner.label)} (${ml[winner.key]}%)</h3><p>It compared today’s momentum, volatility and trend with patterns from this stock’s own history, then estimated where price may be after five trading days.</p><div class="ml-probabilities">${outcomes.map(item=>`<div class="${item.key===winner.key?'is-likely':''}"><span>${item.label}</span><strong>${ml[item.key]}%</strong><small>${item.help}</small></div>`).join('')}</div><div class="ml-reliability"><strong>${plainConfidence}</strong><p>${reliability}</p><small>Correct movement group in ${ml.accuracy}% of ${Math.max(1,Math.round(ml.samples*.2))} later, unseen historical examples; trained on ${ml.samples} total examples.</small></div><h4>Why did ML lean this way?</h4><ul>${(ml.drivers||[]).map(item=>`<li>${safe(item)}.</li>`).join('')}</ul><p class="ml-guidance"><strong>How to use it:</strong> Start with the business and valuation view. Then use ML only to check whether short-term price behaviour agrees. If ML challenges the market view—or its accuracy is low—wait for stronger evidence rather than forcing a decision.</p><details class="ml-details"><summary>How was this calculated?</summary><p>${safe(ml.method)}. Down means below −1.5%, similar means between −1.5% and +1.5%, and up means above +1.5% after five trading days.</p></details></section>`;
}function evidenceFor(metrics){const f=metrics.fundamentals||{},positive=[],caution=[];if(metrics.ema20>=metrics.ema50)positive.push(`Short trend is constructive: EMA 20 (${money.format(metrics.ema20)}) is above EMA 50 (${money.format(metrics.ema50)}).`);else caution.push(`Short trend is weak: EMA 20 (${money.format(metrics.ema20)}) is below EMA 50 (${money.format(metrics.ema50)}).`);if(metrics.trend>0)positive.push(`The 20-trading-day return is ${percent(metrics.trend)}.`);else caution.push(`The 20-trading-day return is ${percent(metrics.trend)}.`);if(isDataNumber(metrics.rsi)){if(metrics.rsi>=45&&metrics.rsi<=68)positive.push(`RSI 14 is ${metrics.rsi.toFixed(1)}, a balanced momentum zone.`);else if(metrics.rsi>75)caution.push(`RSI 14 is ${metrics.rsi.toFixed(1)}, an extended level with pullback risk.`);else if(metrics.rsi<35)caution.push(`RSI 14 is ${metrics.rsi.toFixed(1)}, showing weak momentum.`);}if(f.available){if(Number(f.revenueGrowth)>0)positive.push(growthDescription(f.revenueGrowth,'Revenue'));else if(isDataNumber(f.revenueGrowth))caution.push(growthDescription(f.revenueGrowth,'Revenue'));if(Number(f.profitGrowth)>0)positive.push(growthDescription(f.profitGrowth,'Net profit'));else if(isDataNumber(f.profitGrowth))caution.push(growthDescription(f.profitGrowth,'Net profit'));if(isDataNumber(f.pe)&&isDataNumber(f.sectorPe))(f.pe<=f.sectorPe?positive:caution).push(`P/E is ${Number(f.pe).toFixed(1)}x versus sector ${Number(f.sectorPe).toFixed(1)}x.`);}else caution.push('Fundamental data is unavailable; do not treat a technical signal as a complete buy case.');if(metrics.volatility>34)caution.push(`Annualised historical volatility is ${metrics.volatility.toFixed(1)}%, so smaller sizing is prudent.`);return {positive,caution};}
function fundamentalGrid(metrics){const f=metrics.fundamentals||{},source=f.available?'Upstox annual fundamentals':'Not available from current provider';return `<section class="detail-section"><p class="research-label">FUNDAMENTAL CHECK</p><h3>Business quality and valuation context</h3><p class="method-note">${safe(source)}. “—” means the provider did not return that metric; it is not treated as good news.</p><div class="fundamental-grid"><div><span>Revenue growth</span><strong>${valueOrDash(f.revenueGrowth,'%')}</strong><small>annual YoY</small></div><div><span>Profit growth</span><strong>${valueOrDash(f.profitGrowth,'%')}</strong><small>annual YoY</small></div><div><span>P/E</span><strong>${valueOrDash(f.pe,'x')}</strong><small>sector ${valueOrDash(f.sectorPe,'x')}</small></div><div><span>ROE</span><strong>${valueOrDash(f.roe,'%')}</strong><small>sector ${valueOrDash(f.sectorRoe,'%')}</small></div><div><span>ROCE</span><strong>${valueOrDash(f.roce,'%')}</strong><small>sector ${valueOrDash(f.sectorRoce,'%')}</small></div><div><span>Score inputs</span><strong>${metrics.fundamentalScore===null?'Technical only':`${metrics.fundamentalScore}/100`}</strong><small>${metrics.fundamentalScore===null?'check results manually':'fundamental component'}</small></div></div></section>`;}
function scoreExplanation(metrics){return `<section class="detail-section score-explanation"><p class="research-label">HOW THE SIGNAL IS BUILT</p><h3>${metrics.score}/100 composite research score</h3><div class="score-breakdown"><div><span>Fundamentals</span><strong>${metrics.fundamentalScore===null?'Not available':`${metrics.fundamentalScore}/100`}</strong><small>55% when available: revenue, profit, P/E, ROE and ROCE relative to sector.</small></div><div><span>Technicals</span><strong>${metrics.technicalScore}/100</strong><small>45%: price move, range, 52-week position, EMA trend and RSI.</small></div></div><p class="method-note">If fundamental data is unavailable, the dashboard marks the result as technical-only instead of pretending it is a full company assessment.</p></section>`;}
function newsMarkup(label,rows){return rows?.length?`<div class="news-list">${rows.map(item=>`<a href="${safeUrl(item.url)}" target="_blank" rel="noopener"><strong>${safe(item.title)}</strong><small>${safe(item.source||'News')} · ${safe(item.date||'')}</small></a>`).join('')}</div>`:`<p class="news-empty">No ${safe(label)} headlines were returned. This does not mean there is no news—check the exchange and company filings too.</p>`;}
async function loadNewsContext(symbol){const node=$('#news-context');if(!node)return;try{const data=await api('news',symbol);node.innerHTML=`<p class="method-note">${safe(data.note||'Headlines are supplied as context, not a price forecast.')}</p><div class="news-columns"><section><h4>${safe(symbol)} news</h4>${newsMarkup('company',data.company)}</section><section><h4>World / India market context</h4>${newsMarkup('market',data.global)}</section></div>`;}catch(error){node.innerHTML=`<p class="news-empty">News context is temporarily unavailable: ${safe(error.message)}</p>`;}}function reviewContent(metrics){const evidence=evidenceFor(metrics);return `<div class="modal-body modal-body-rich"><div class="modal-title"><div><p class="research-label">ANALYTICAL STOCK REVIEW</p><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${safe(metrics.dataSource||'market data')} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Research score</span><strong>${metrics.score}/100</strong></article><article><span>Technical</span><strong>${metrics.technicalScore}/100</strong></article><article><span>Fundamental</span><strong>${metrics.fundamentalScore===null?'—':`${metrics.fundamentalScore}/100`}</strong></article>${riskSummary(metrics)}</div>${marketThesisPanel(metrics)}${scoreExplanation(metrics)}${mlPanel(metrics)}${fundamentalGrid(metrics)}<section class="detail-section"><p class="research-label">TECHNICAL DASHBOARD</p><h3>Price trend, EMA and momentum</h3><div class="technical-grid"><div><span>EMA 20</span><strong>${money.format(metrics.ema20)}</strong><small>${metrics.ema20>=metrics.ema50?'above EMA 50':'below EMA 50'}</small></div><div><span>EMA 50</span><strong>${money.format(metrics.ema50)}</strong><small>broader trend line</small></div><div><span>RSI 14</span><strong>${valueOrDash(metrics.rsi)}</strong><small>momentum gauge</small></div><div><span>20-day trend</span><strong class="${metrics.trend>=0?'positive':'negative'}">${percent(metrics.trend)}</strong><small>recent return</small></div><div><span>Support</span><strong>${money.format(metrics.support)}</strong><small>recent 20-day low</small></div><div><span>Resistance</span><strong>${money.format(metrics.resistance)}</strong><small>recent 20-day high</small></div></div>${chart(metrics)}</section><section class="detail-section evidence-section"><p class="research-label">WHAT SUPPORTS OR CHALLENGES A BUY</p><div class="evidence-columns"><div><h4>Reasons to consider</h4><ul>${evidence.positive.map(item=>`<li>${safe(item)}</li>`).join('')||'<li>No strong supportive evidence was detected.</li>'}</ul></div><div><h4>Reasons to wait / avoid</h4><ul>${evidence.caution.map(item=>`<li>${safe(item)}</li>`).join('')||'<li>No specific caution was detected, but all investments carry risk.</li>'}</ul></div></div></section><div class="review-grid"><section class="detail-section"><p class="research-label">YOUR SCENARIO</p><h3>Estimate possible outcomes</h3><p>Uses trend and historical volatility only. It excludes tax, brokerage and slippage.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units for six- and twelve-month base, bull and bear scenarios.</div></section><section class="detail-section"><p class="research-label">PRICE PLAN</p><h3>Reference levels, not targets</h3><div class="levels"><div><span>Current price</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Support / risk line</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance / confirmation</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh||0)}</strong></div></div></section></div><section class="detail-section"><p class="research-label">LATEST HEADLINE CONTEXT</p><h3>Company and world-market news</h3><div id="news-context">Loading headline context…</div></section><section class="detail-section announcements"><p class="research-label">EXCHANGE DISCLOSURES</p><h3>${safe(metrics.symbol)} announcements</h3><div id="announcements">Loading company disclosures…</div></section></div>`;}
function dynamicDecisionNarrative(metrics){
  const f=metrics.fundamentals||{},ml=metrics.ml||{},ticker=String(metrics.symbol||metrics.name||'This stock'),trend=Number(metrics.trend||0),rsi=Number(metrics.rsi),volatility=Number(metrics.volatility||0),range=Number(metrics.rangePct||0),technicalPositive=metrics.ema20>=metrics.ema50&&trend>0,technicalWeak=metrics.ema20<metrics.ema50&&trend<0,hasFundamentals=Boolean(f.available),revenue=Number(f.revenueGrowth),profit=Number(f.profitGrowth),growthPositive=hasFundamentals&&((Number.isFinite(revenue)&&revenue>5)||(Number.isFinite(profit)&&profit>5)),growthWeak=hasFundamentals&&((Number.isFinite(revenue)&&revenue<0)||(Number.isFinite(profit)&&profit<0)),valuationHigh=hasFundamentals&&isDataNumber(f.pe)&&isDataNumber(f.sectorPe)&&Number(f.pe)>Number(f.sectorPe)*1.35,extended=Number.isFinite(rsi)&&rsi>70,highRisk=metrics.risk==='High'||volatility>38||range>5;
  const outcomes=[['up','rise'],['sideways','stay broadly similar'],['down','fall']],leader=ml.available?outcomes.reduce((best,item)=>Number(ml[item[0]])>Number(ml[best[0]])?item:best,outcomes[0]):null,mlStrong=leader&&Number(ml.accuracy)>=55&&Number(ml[leader[0]])>=45;
  const evidence=[];
  evidence.push(technicalPositive?`EMA 20 is above EMA 50 and the 20-day move is ${percent(trend)}: buyers currently control the short-term trend.`:technicalWeak?`EMA 20 is below EMA 50 and the 20-day move is ${percent(trend)}: price has not confirmed a recovery.`:`EMA alignment and the 20-day move of ${percent(trend)} do not point clearly in the same direction.`);
  if(hasFundamentals)evidence.push(growthPositive?`Business growth is supportive: revenue growth is ${valueOrDash(f.revenueGrowth,'%')} and profit growth is ${valueOrDash(f.profitGrowth,'%')}.`:growthWeak?`Business momentum needs caution: revenue growth is ${valueOrDash(f.revenueGrowth,'%')} and profit growth is ${valueOrDash(f.profitGrowth,'%')}.`:`Reported growth is not strong enough by itself to settle the decision: revenue ${valueOrDash(f.revenueGrowth,'%')}, profit ${valueOrDash(f.profitGrowth,'%')}.`);else evidence.push('Fundamental figures are unavailable, so this is a price-pattern view—not a full assessment of the company.');
  if(valuationHigh)evidence.push(`Valuation leaves less room for disappointment: P/E is ${Number(f.pe).toFixed(1)}x versus the sector's ${Number(f.sectorPe).toFixed(1)}x.`);
  if(leader)evidence.push(`ML leans toward a ${leader[1]} outcome over five trading days (${Number(ml[leader[0]])}%), with ${Number(ml.accuracy)}% historical test accuracy. This is a supporting clue, not a promise.`);else evidence.push('ML does not have enough usable history, so it is excluded from the conclusion.');
  if(highRisk)evidence.push(`Risk is elevated because historical volatility is ${volatility.toFixed(1)}% and today's range is ${range.toFixed(1)}%; a positive trend can still have sharp falls.`);else if(extended)evidence.push(`RSI is ${rsi.toFixed(1)}, so momentum is positive but stretched and profit-booking risk is higher.`);
  let label,headline,action;
  if(metrics.signal==='BUY'&&technicalPositive&&growthPositive&&!valuationHigh&&!highRisk){label='CONSTRUCTIVE — WAIT FOR A CONTROLLED ENTRY';headline=`${ticker} has aligned price and business evidence, but the entry price still determines the risk.`;action=`A close above ${money.format(metrics.resistance)} would confirm strength. A pullback that holds near ${money.format(metrics.ema20)} offers a more controlled setup; a close below ${money.format(metrics.support)} weakens the case.`;}
  else if(metrics.signal==='BUY'&&technicalPositive&&!hasFundamentals){label='TECHNICAL BUY CASE — FUNDAMENTALS UNVERIFIED';headline=`${ticker}'s trend is positive, but the dashboard cannot verify the underlying business numbers.`;action=`Use ${money.format(metrics.ema20)} as the first trend check and ${money.format(metrics.support)} as the invalidation reference. Do not treat an ML rise probability as a substitute for results and disclosures.`;}
  else if(technicalPositive&&(highRisk||extended)){label='POSITIVE TREND, ELEVATED ENTRY RISK';headline=`${ticker} is trending upward, but fast movement makes a fresh entry vulnerable to profit booking.`;action=`Avoid chasing near ${money.format(metrics.resistance)}. The setup stays constructive while daily closes hold near ${money.format(metrics.ema20)}; below ${money.format(metrics.support)}, reassess instead of averaging automatically.`;}
  else if(growthPositive&&!technicalPositive){label='GOOD BUSINESS, PRICE CONFIRMATION MISSING';headline=`${ticker}'s business evidence is more encouraging than its current price structure.`;action=`Wait for EMA 20 to move above EMA 50 and for price to close above ${money.format(metrics.resistance)}. Until then, ${money.format(metrics.support)} is a risk reference—not an automatic buying level.`;}
  else if(technicalPositive&&growthWeak){label='PRICE STRONG, BUSINESS EVIDENCE WEAK';headline=`${ticker}'s positive chart is not yet supported by improving revenue and profit evidence.`;action=`Treat the move as tactical rather than a high-conviction investment case. Review the next result; a close below ${money.format(metrics.ema20)} would remove short-term confirmation.`;}
  else if(valuationHigh){label='WAIT FOR A BETTER RISK–REWARD';headline=`${ticker}'s valuation is demanding relative to its sector, so even decent growth may already be reflected in price.`;action=`Require either stronger earnings evidence or a controlled pullback that holds above ${money.format(metrics.support)}. A breakout above ${money.format(metrics.resistance)} without fresh business evidence may be vulnerable to reversal.`;}
  else if(metrics.signal==='REDUCE'||technicalWeak){label='AVOID FRESH RISK UNTIL RECOVERY';headline=`${ticker}'s current price structure does not yet show dependable buyer control.`;action=`Recovery first requires EMA 20 to reclaim EMA 50, followed by a close above ${money.format(metrics.resistance)}. Repeated closes below ${money.format(metrics.support)} would keep the downside case active.`;}
  else {label=mlStrong&&leader[0]==='up'?'WATCH — ML POSITIVE, FULL CONFIRMATION MISSING':'WAIT FOR STOCK-SPECIFIC CONFIRMATION';headline=`${ticker} has mixed evidence: neither the buy case nor the avoid case is strong enough yet.`;action=`The next useful signal is a close above ${money.format(metrics.resistance)} with improving EMA alignment. A close below ${money.format(metrics.support)} would favour caution; between those levels, waiting is a decision—not inaction.`;}
  return {label,headline,action,evidence};
}
function decisionContent(metrics){const evidence=evidenceFor(metrics),f=metrics.fundamentals||{},decision=dynamicDecisionNarrative(metrics),buyCase=decision.headline,action=decision.action;return `<div class="modal-body modal-body-rich"><div class="modal-title"><div><p class="research-label">EVIDENCE-BASED DECISION BRIEF</p><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><section class="decision-hero"><span>${safe(decision.label)}</span><h3>${buyCase}</h3><p>${action}</p></section><section class="detail-section decision-explanation"><p class="research-label">PLAIN-LANGUAGE MODEL CONCLUSION</p><h3>Why this decision is different for this stock</h3><ul>${decision.evidence.map(item=>`<li>${safe(item)}</li>`).join('')}</ul><p class="method-note">The rules and ML use historical data. They explain the evidence and possible conditions; they cannot guarantee a profitable trade.</p></section><div class="summary-cards"><article><span>Research score</span><strong>${metrics.score}/100</strong></article><article><span>Fundamental</span><strong>${metrics.fundamentalScore===null?'—':`${metrics.fundamentalScore}/100`}</strong></article><article><span>EMA state</span><strong>${metrics.ema20>=metrics.ema50?'Positive':'Weak'}</strong></article><article><span>RSI 14</span><strong>${valueOrDash(metrics.rsi)}</strong></article></div>${marketThesisPanel(metrics)}${sellAnalysisPanel(metrics)}<section class="detail-section evidence-section"><p class="research-label">WHY THE VIEW IS NOT GENERIC</p><div class="evidence-columns"><div><h4>Specific evidence supporting a buy / hold</h4><ul>${evidence.positive.map(item=>`<li>${safe(item)}</li>`).join('')||'<li>There is not enough positive evidence for a buy case.</li>'}</ul></div><div><h4>Specific reasons not to buy now</h4><ul>${evidence.caution.map(item=>`<li>${safe(item)}</li>`).join('')||'<li>No extra caution flag is highlighted; company and market risks still apply.</li>'}</ul></div></div></section>${mlPanel(metrics)}${fundamentalGrid(metrics)}<section class="detail-section"><p class="research-label">NEWS CHECK BEFORE ACTING</p><h3>Does the latest context change the thesis?</h3><div id="news-context">Loading company and world-market headline context…</div><p class="method-note">Headlines are deliberately not converted into a buy score. Read the original source and decide whether it changes the revenue, profit, valuation or risk case.</p></section><section class="detail-section announcements"><p class="research-label">OFFICIAL EXCHANGE DISCLOSURES</p><div id="announcements">Loading company disclosures…</div></section></div>`;}
function fillReview(raw,symbol,usingSavedData=false,mode='review'){
  try {
    const fallback=state.leaders.find(item=>item.symbol===symbol)||{};
    const metrics=historicalMetrics({...fallback,...raw.stock,history:raw.history||[]});
    state.selected=metrics;
    $('#modal-kicker').textContent=`${metrics.symbol} · ${usingSavedData?'SAVED ':''}${mode==='decision'?'DECISION BRIEF':'RESEARCH REVIEW'}`;
    $('#modal-content').innerHTML=mode==='decision'?decisionContent(metrics):reviewContent(metrics);
    if(mode==='decision')void loadSellNewsPanels(metrics.symbol);
    if(mode==='review')setCalculator(metrics);
    bindChart(metrics);
    void loadNewsContext(metrics.symbol);
    const panel=$('#announcements');
    if(panel)panel.innerHTML=(raw.announcements||[]).slice(0,5).map(item=>`<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${safe(item.title)}<small>${safe(item.date||'Exchange disclosure')}</small></a>`).join('')||'<p>No recent exchange disclosures were returned for this ticker.</p>';
    return true;
  } catch(error) {
    $('#modal-kicker').textContent=`${symbol} · DISPLAY ERROR`;
    $('#modal-content').innerHTML=`<div class="modal-body"><h2>Could not display this stock analysis</h2><p>${safe(error.message)}</p><button class="primary-button" data-review="${safe(symbol)}" type="button">Retry ${safe(symbol)}</button></div>`;
    console.error('Stock analysis render failed',error);
    return false;
  }
}function renderRecommendations(data){const node=$('#recommendation-list');if(!node)return;const rows=(data.recommendations||[]).filter(stock=>stock.qualifies===true);$('#recommendations-note').textContent=data.method||'';node.innerHTML=rows.length?rows.map((stock,index)=>`<article class="recommendation-card"><div class="recommendation-header"><div><span class="stock-rank">#${index+1} RESEARCH CANDIDATE</span><h3>${safe(stock.symbol)}</h3><p>${safe(stock.name)}</p></div><span class="signal ${stock.model?.score>=72?'BUY':stock.model?.score>=52?'HOLD':'REDUCE'}">${stock.model?.score||0}/100</span></div><div class="recommendation-metrics"><div><span>Last price</span><strong>${money.format(stock.lastPrice)}</strong></div><div><span>Illustrative quantity</span><strong>${stock.quantity||'—'}</strong><small>about ${money.format(stock.notional||0)}</small></div><div><span>Technical</span><strong>${stock.model?.technical??'—'}/100</strong></div><div><span>Fundamental</span><strong>${stock.model?.fundamental??'—'}/100</strong></div></div>${marketThesisSummary(stock)}${mlResearchSummary(stock)}<h4>Why this made the shortlist</h4><ul>${(stock.reasons||[]).map(reason=>`<li>${safe(reason)}</li>`).join('')||'<li>Latest composite model evidence.</li>'}</ul><div class="stock-card-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Open full analysis</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision brief</button></div></article>`).join(''):`<p class="card-message buy-gate-empty"><strong>No stock currently passes every BUY-quality gate.</strong><br>The dashboard screened ${data.screenedCount||0} current leaders and refused to fill the list with HOLD, weak-structure, or low-quality names. This is a valid result—wait for stronger evidence or review individual stocks.</p>`;const allocation=$('#recommendations-allocation');if(allocation)allocation.textContent=data.allocationNote||'';}
async function loadRecommendations(){const node=$('#recommendation-list');if(!node)return;node.innerHTML='<p class="card-message">Building a research shortlist from current market and fundamental data…</p>';try{const data=await api('recommendations');writeCache(RECOMMENDATIONS_CACHE_KEY_V38,{data,savedAt:new Date().toISOString()});renderRecommendations(data);}catch(error){const cached=readCache(RECOMMENDATIONS_CACHE_KEY_V38);if(cached?.data){renderRecommendations(cached.data);$('#recommendations-note').textContent=`Saved research shortlist shown because live data is delayed: ${error.message}`;}else node.innerHTML=`<p class="card-message">Research candidates are temporarily unavailable: ${safe(error.message)}.</p>`;}}
function activateWorkspaceTab(name){document.querySelectorAll('[data-tab]').forEach(button=>{const active=button.dataset.tab===name;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));});document.querySelectorAll('.tab-panel').forEach(panel=>{const active=panel.id===`panel-${name}`;panel.classList.toggle('is-active',active);panel.hidden=!active;});if(name==='recommended'){void loadRecommendations();void loadIntradaySetups();}if(name==='sectors'&&!state.sectorLoaded)void loadSector();if(name==='updates')void loadUpdates();if(name==='watchlist')void refreshWatchlist();}function setupWorkspace(){const main=document.querySelector('main'),hero=main?.querySelector('.hero');if(!main||!hero||document.querySelector('.workspace-tabs'))return;main.classList.add('app-shell');hero.classList.add('workspace-header');const eyebrow=hero.querySelector('.eyebrow'),title=hero.querySelector('h1'),description=hero.querySelector('p:not(.eyebrow)'),refreshButton=hero.querySelector('#refresh');if(eyebrow)eyebrow.textContent='INDIAN MARKET RESEARCH';if(title)title.textContent='Market Pulse research dashboard';if(description)description.textContent='Multi-factor signals, focused decisions, live market context and practical research tools.';if(refreshButton)refreshButton.textContent='Refresh data';const tabs=document.createElement('nav');tabs.className='workspace-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Market Pulse sections');const definitions=[['market','Top 10'],['recommended','Recommended'],['sectors','Sectors'],['research','Research'],['updates','Updates'],['watchlist','Watchlist']];tabs.innerHTML=definitions.map(([key,label],index)=>`<button class="workspace-tab${index===0?' is-active':''}" id="tab-${key}" role="tab" aria-selected="${index===0}" aria-controls="panel-${key}" data-tab="${key}" type="button">${label}</button>`).join('');const panels=document.createElement('div');panels.className='tab-panels';const makePanel=(key,label)=>{const panel=document.createElement('section');panel.className=`tab-panel${key==='market'?' is-active':''}`;panel.id=`panel-${key}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`tab-${key}`);panel.hidden=key!=='market';panel.dataset.label=label;panels.append(panel);return panel;};const market=makePanel('market','Top 10'),recommended=makePanel('recommended','Recommended'),sectors=makePanel('sectors','Sectors'),research=makePanel('research','Research'),updates=makePanel('updates','Updates'),watchlist=makePanel('watchlist','Watchlist');['.disclaimer','.metric-grid','.screening'].forEach(selector=>{const node=main.querySelector(selector);if(node)market.append(node);});const marketTable=market.querySelector('.table-wrap');if(marketTable){marketTable.insertAdjacentHTML('beforebegin','<div id="stock-pager" class="data-pager" aria-label="Top 10 pages"></div>');marketTable.insertAdjacentHTML('afterend','<div id="stock-cards" class="stock-card-list" aria-live="polite"></div>');}recommended.innerHTML='<section class="recommendations-card"><div class="section-title"><div><p class="eyebrow">RECOMMENDED BY MARKET PULSE</p><h2>Up to 3 buy-qualified candidates</h2></div><span>Updated from current market data</span></div><p id="recommendations-note" class="recommendations-note">Only stocks that pass every BUY-quality gate are shown. Fewer than three appear when current evidence is not strong enough.</p><div id="recommendation-list" class="recommendation-list"><p class="card-message">Open this tab to build the latest shortlist.</p></div><p id="recommendations-allocation" class="method-note"></p></section><section class="recommendations-card intraday-section"><div class="section-title"><div><p class="eyebrow">SAME-DAY PATTERN SCREEN</p><h2>Up to 3 intraday setups</h2></div><span>Live 5-minute candles</span></div><p id="intraday-note" class="recommendations-note">Only confirmed VWAP, EMA, opening-range, volume and reward/risk setups appear. No setup means no trade.</p><div id="intraday-list" class="recommendation-list"><p class="card-message">Open this tab to check current intraday patterns.</p></div></section>';['.lookup-card','.investment-card'].forEach(selector=>{const node=main.querySelector(selector);if(node)research.append(node);});const lookupPane=research.querySelector('.lookup-card'),calculatorPane=research.querySelector('.investment-card');if(lookupPane&&calculatorPane){lookupPane.classList.add('research-pane','is-active');calculatorPane.classList.add('research-pane');calculatorPane.hidden=true;const researchTabs=document.createElement('div');researchTabs.className='research-tabs';researchTabs.innerHTML='<button class="research-tab is-active" data-research-pane="lookup" type="button">Ticker analysis</button><button class="research-tab" data-research-pane="calculator" type="button">Return calculator</button>';research.prepend(researchTabs);researchTabs.addEventListener('click',event=>{const button=event.target.closest('[data-research-pane]');if(!button)return;const calculator=button.dataset.researchPane==='calculator';lookupPane.hidden=calculator;calculatorPane.hidden=!calculator;researchTabs.querySelectorAll('button').forEach(tab=>tab.classList.toggle('is-active',tab===button));});}const sectorContent=document.createElement('div');sectorContent.className='sector-workspace';sectorContent.innerHTML=`<div class="section-title sector-heading"><div><p class="eyebrow">SECTOR MOMENTUM</p><h2>Top 10 stocks by sector</h2></div><span id="sector-note">Choose a sector to load the latest ranking.</span></div><div class="sector-tabs" role="tablist" aria-label="NSE sector ranking">${Object.entries(SECTOR_LABELS).map(([key,label],index)=>`<button class="sector-tab${index===0?' is-active':''}" data-sector="${key}" type="button">${label}</button>`).join('')}</div><div class="sector-insight" id="sector-insight" aria-live="polite">Sector analysis uses current NSE-symbol data. It is research, not a price target.</div><div class="table-wrap sector-table-wrap"><table><thead><tr><th>#</th><th>Company</th><th>Last price</th><th>Today</th><th>3M trend</th><th>Signal</th><th>12M scenario</th><th>Trade levels</th><th>Actions</th></tr></thead><tbody id="sector-table"></tbody></table></div>`;sectors.append(sectorContent);const sectorTable=sectors.querySelector('.sector-table-wrap');if(sectorTable){sectorTable.insertAdjacentHTML('beforebegin','<div id="sector-pager" class="data-pager" aria-label="Sector ranking pages"></div>');sectorTable.insertAdjacentHTML('afterend','<div id="sector-cards" class="stock-card-list" aria-live="polite"></div>');}const updatesCard=main.querySelector('.updates-card');if(updatesCard)updates.append(updatesCard);const watchlistCard=main.querySelector('.watchlist-card');if(watchlistCard){watchlist.append(watchlistCard);watchlistCard.querySelector('#watchlist-items')?.insertAdjacentHTML('afterend','<div id="watch-pager" class="data-pager" aria-label="Watchlist pages"></div>');}hero.after(tabs,panels);tabs.addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)activateWorkspaceTab(button.dataset.tab);});}
function loadRecommendationNews(data){document.querySelector('.recommendation-news-v38')?.remove();const rows=data?.newsContext?.global||[];if(!rows.length)return;const list=$('#recommendation-list');if(list)list.insertAdjacentHTML('afterend',`<section class="recommendation-news-v38"><p class="research-label">WORLD / INDIA MARKET CONTEXT</p><h3>Headlines to weigh before acting</h3><p class="method-note">These current headlines provide context for the shortlist; they do not create an automatic buy score.</p>${newsMarkup('market',rows)}</section>`);}
function renderIntradaySetups(data){
  const node=$('#intraday-list'),note=$('#intraday-note');if(!node)return;const savedCapital=Math.max(1000,Number(localStorage.getItem('market-pulse-capital')||10000)),savedRisk=Math.max(50,Number(localStorage.getItem('market-pulse-risk')||500));const rows=(data.setups||[]).filter(stock=>stock.qualifies===true),market=data.marketContext||{},marketBanner=`<div class="market-filter ${String(market.regime||'Mixed').toLowerCase()}"><strong>Broad market: ${safe(market.regime||'Unavailable')}</strong><span>${Number(market.advancePct||0).toFixed(0)}% advancing · average move ${percent(Number(market.averageMove||0))} · ${Number(market.sampleSize||0)} stocks checked</span><small>${market.regime==='Weak'?'New long setups are blocked because participation is weak.':market.regime==='Supportive'?'Broad participation supports long setups, but every stock must still pass its own gates.':'Market participation is mixed, so stock-specific confirmation matters more.'}</small></div>`;if(note)note.textContent=data.method||'';
  const controls=`<div class="risk-controls"><label>Trading capital (₹)<input id="trade-capital" type="number" min="1000" step="1000" value="${savedCapital}"></label><label>Maximum risk per trade (₹)<input id="trade-risk" type="number" min="50" step="50" value="${savedRisk}"></label><button id="apply-trade-risk" type="button" class="primary-button">Apply</button><small>Quantity is limited by both capital and maximum loss at the displayed stop.</small></div>`;const cards=rows.length?rows.map((stock,index)=>{const x=stock.intraday,riskPerShare=Math.max(.01,x.entry-x.stop),quantity=Math.max(0,Math.min(Math.floor(savedRisk/riskPerShare),Math.floor(savedCapital/x.entry))),riskAtStop=quantity*riskPerShare,notional=quantity*x.entry,b=x.backtest||{};return `<article class="recommendation-card intraday-card"><div class="recommendation-header"><div><span class="stock-rank">#${index+1} SAME-DAY SETUP</span><h3>${safe(stock.symbol)}</h3><p>${safe(stock.name)}</p></div><span class="setup-status confirmed">${safe(x.status)}</span></div><div class="rank-explanation"><strong>Why ranked #${index+1}</strong><span>${index===0?'Highest fully confirmed score across pattern, volume, structure, risk and market breadth.':`Ranked below #1 because its combined confirmation score is ${x.score}/100.`}</span></div><div class="recommendation-metrics intraday-metrics"><div><span>Entry trigger</span><strong>Above ${money.format(x.entry)}</strong></div><div><span>Stop / invalidation</span><strong>${money.format(x.stop)}</strong></div><div><span>Scenario target</span><strong>${money.format(x.target)}</strong></div><div><span>Reward / risk</span><strong>${Number(x.rewardRisk).toFixed(1)}×</strong></div><div><span>Illustrative quantity</span><strong>${quantity||'—'}</strong><small>${money.format(notional||0)} position</small></div><div><span>Risk at stop</span><strong>${money.format(riskAtStop||0)}</strong><small>₹${savedRisk} selected maximum</small></div></div><div class="intraday-pattern-view"><strong>${safe(x.setupType)}</strong><p>${safe(x.decision)}</p><small>Must-hold zone: ${money.format(x.holdLow)}–${money.format(x.holdHigh)}</small><small><strong>Time exit:</strong> ${safe(x.exitRule)}</small>${x.profitBookingSignal?'<small class="negative">Early profit-booking warning is active.</small>':'<small>No confirmed profit-booking candle.</small>'}</div><div class="backtest-card ${safe(String(b.label||'').toLowerCase().replace(/[^a-z]+/g,'-'))}"><strong>${safe(b.label||'BACKTEST UNAVAILABLE')}</strong>${b.available?`<span>${b.winRate}% wins from ${b.samples} historical signals</span><small>Average result ${percent(b.averageReturn)} · average win ${percent(b.averageWin)} · average loss ${percent(b.averageLoss)} · worst adverse move ${percent(-Math.abs(b.maxAdverse))}</small>`:`<span>${safe(b.note||'No usable historical signals were returned.')}</span>`}<small>${safe(b.lookahead||'')} ${b.available?'· Conservative replay; not a forecast.':''}</small></div><h4>Why every gate passed</h4><ul>${(x.reasons||[]).map(reason=>`<li>${safe(reason)}</li>`).join('')}</ul><p class="intraday-warning"><strong>Conditional setup:</strong> enter only after the trigger and while VWAP/EMA conditions remain valid. The target is a scenario, not a promise.</p><div class="stock-card-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Full review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision brief</button></div></article>`;}).join(''):`<p class="card-message buy-gate-empty"><strong>No valid same-day setup right now.</strong><br>${data.deepScreenedCount||0} active stocks were checked, but none passed every pattern, volume, market and risk rule. Do not force a trade.</p>`;
  const rejected=(data.nearMisses||[]).length?`<details class="rejected-setups"><summary>Why other leading candidates were rejected (${data.nearMisses.length})</summary>${data.nearMisses.map(stock=>{const x=stock.intraday||{};return `<article><div><strong>${safe(stock.symbol)} · ${safe(x.status||'NOT READY')}</strong><span>${x.score||0}/100</span></div><p>${safe(stock.rankExplanation||'Did not pass every confirmation gate.')}</p><ul>${(x.rejectionReasons||[]).slice(0,4).map(reason=>`<li>${safe(reason)}</li>`).join('')}</ul></article>`;}).join('')}</details>`:'';
  node.innerHTML=marketBanner+controls+cards+rejected;$('#apply-trade-risk')?.addEventListener('click',()=>{const capital=Math.max(1000,Number($('#trade-capital')?.value||10000)),risk=Math.max(50,Number($('#trade-risk')?.value||500));localStorage.setItem('market-pulse-capital',String(capital));localStorage.setItem('market-pulse-risk',String(risk));renderIntradaySetups(data);});
}async function loadIntradaySetups(){const node=$('#intraday-list');if(!node)return;node.innerHTML='<p class="card-message">Checking live 5-minute patterns…</p>';try{renderIntradaySetups(await api('intraday'));}catch(error){node.innerHTML=`<p class="card-message">Intraday setups are unavailable: ${safe(error.message)}</p>`;}}
async function loadRecommendations(){const node=$('#recommendation-list');if(!node)return;node.innerHTML='<p class="card-message">Building a research shortlist from current market, fundamental and headline context…</p>';try{const data=await api('recommendations');writeCache(RECOMMENDATIONS_CACHE_KEY_V38,{data,savedAt:new Date().toISOString()});renderRecommendations(data);loadRecommendationNews(data);}catch(error){const cached=readCache(RECOMMENDATIONS_CACHE_KEY_V38);if(cached?.data){renderRecommendations(cached.data);loadRecommendationNews(cached.data);$('#recommendations-note').textContent=`Saved research shortlist shown because live data is delayed: ${error.message}`;}else node.innerHTML=`<p class="card-message">Research candidates are temporarily unavailable: ${safe(error.message)}.</p>`;}}






