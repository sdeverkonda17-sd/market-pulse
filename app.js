const $ = selector => document.querySelector(selector);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const percent = value => `${value >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const LEADERS_CACHE_KEY = 'market-pulse-nse-leaders-v34';
const STOCK_CACHE_PREFIX = 'market-pulse-nse-stock-v34:';
const WATCHLIST_KEY = 'market-pulse-watchlist-v1';
const WATCH_ALERTS_KEY = 'market-pulse-watch-alerts-v1';
const MAX_WATCHLIST_SIZE = 8;
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
  return `<article class="stock-card"><div class="stock-card-heading"><div><span class="stock-rank">#${index + 1}</span><strong>${safe(stock.symbol)}</strong><small>${safe(stock.name)}</small></div><span class="signal ${stock.signal}">${stock.signal}</span></div><div class="stock-card-metrics"><div><span>Last price</span><strong>${money.format(stock.lastPrice)}</strong><small class="${stock.pChange >= 0 ? 'positive' : 'negative'}">${percent(stock.pChange)} today</small></div>${trend}${levels}</div><div class="stock-card-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision brief</button>${sector ? '' : `<button class="watch-button" data-watch="${safe(stock.symbol)}" type="button">Watch</button>`}</div></article>`;
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
      <td class="stock-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision</button><button class="watch-button" data-watch="${safe(stock.symbol)}" type="button">Watch</button></td>
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
      <td class="stock-actions"><button class="review-button" data-review="${safe(stock.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(stock.symbol)}" type="button">Decision</button></td>
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
  return `<div class="modal-body"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} - ${source} last price ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Daily movement</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>Momentum score</span><strong>${metrics.score}/100</strong></article><article><span>Trend (20 days)</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article><article><span>Risk</span><strong>${metrics.risk}</strong></article></div><div class="review-grid"><section class="detail-section"><h3>Why this ${metrics.signal} signal?</h3><ul><li>Today's ${source} move is <b>${percent(metrics.pChange)}</b>; stronger positive momentum adds to the score.</li><li>Current daily range is <b>${metrics.rangePct.toFixed(2)}%</b>; wider ranges increase trading risk.</li><li>The price is ${metrics.yearHigh ? `${(metrics.lastPrice / metrics.yearHigh * 100).toFixed(1)}% of its 52-week high` : 'being evaluated from its current range'}.</li><li>Score 70+ is a BUY momentum setup; 45-69 is HOLD/watch; below 45 is REDUCE.</li></ul><div class="levels"><div><span>Support</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div><div><span>52-week low</span><strong>${money.format(metrics.yearLow || 0)}</strong></div></div></section><section class="detail-section"><h3>Profit / loss scenario</h3><p>Modelled from recent ${source} price trend and volatility. It is not a price target.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units to estimate 6- and 12-month base, bull, and bear outcomes.</div></section></div><section class="detail-section"><h3>Price trend</h3>${chart(metrics)}</section><section class="detail-section announcements"><h3>${safe(metrics.symbol)} company disclosures</h3><div id="announcements">Loading company disclosures...</div></section></div>`;
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
  return `<div class="modal-body"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><section class="decision-hero"><span>TRADE DECISION</span><h3>${headline}</h3><p>${action}</p></section><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>20-day trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article><article><span>Risk</span><strong>${metrics.risk}</strong></article></div><div class="review-grid"><section class="detail-section"><h3>Why someone may consider buying</h3><ul>${supports.map(reason => `<li>${safe(reason)}</li>`).join('')}</ul><h3 class="decision-subhead">Why someone may wait or avoid buying</h3><ul>${cautions.map(reason => `<li>${safe(reason)}</li>`).join('')}</ul></section><section class="detail-section"><h3>Price plan</h3><div class="levels"><div><span>Current price</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Support / risk line</span><strong>${money.format(metrics.support)}</strong></div><div><span>Resistance / confirmation</span><strong>${money.format(metrics.resistance)}</strong></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div></div><p>Use position sizing, your own stop-loss plan, company results, valuation and market conditions. This is research, not investment advice.</p></section></div><section class="detail-section"><h3>Price trend and pointer</h3>${chart(metrics)}</section><section class="detail-section announcements"><h3>${safe(metrics.symbol)} company disclosures</h3><div id="announcements">Loading company disclosures...</div></section></div>`;
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
  return `<div class="modal-body modal-body-fixed"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · last price ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>20-day trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article><article><span>Risk</span><strong>${metrics.risk}</strong></article></div>${modalTabs(prefix, [{ id: 'evidence', label: 'Signal explained' }, { id: 'plan', label: 'Levels & scenarios' }, { id: 'chart', label: 'Price chart' }, { id: 'news', label: 'Company updates' }])}${modalPanel(prefix, 'evidence', `<section class="detail-section research-brief"><p class="research-label">WHAT THE SCORE MEANS</p><h3>${scoreText}</h3><p>Score formula: price change, daily range and distance from the 52-week high. It is a price-action screen, not a valuation or earnings forecast.</p><div class="evidence-columns"><div><h4>Constructive evidence</h4><ul>${evidence.positive.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No positive price-action factor is currently strong enough to add.</li>'}</ul></div><div><h4>Risk or wait signals</h4><ul>${evidence.risks.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No specific price-action warning was triggered; company and market risks still remain.</li>'}</ul></div></div></section>`, true)}${modalPanel(prefix, 'plan', `<div class="review-grid"><section class="detail-section"><p class="research-label">REFERENCE LEVELS</p><h3>Plan the trade before acting</h3><div class="levels"><div><span>Current price</span><strong>${money.format(metrics.lastPrice)}</strong></div><div><span>Support / risk line</span><strong>${money.format(metrics.support)}</strong><small>${evidence.supportGap.toFixed(1)}% below price</small></div><div><span>Resistance / confirmation</span><strong>${money.format(metrics.resistance)}</strong><small>${evidence.resistanceGap.toFixed(1)}% above price</small></div><div><span>52-week high</span><strong>${money.format(metrics.yearHigh || 0)}</strong></div></div><p>These are recent-price reference levels, not guaranteed entry, stop-loss, or target prices.</p></section><section class="detail-section"><p class="research-label">YOUR SCENARIO</p><h3>Estimate possible outcomes</h3><p>Uses recent trend and volatility. Excludes tax, brokerage and slippage.</p><div class="calculator"><label>Units<input id="units-input" type="number" value="1" min="1" step="1"></label><button class="primary-button" id="calculate-return" type="button">Calculate</button></div><div class="calc-result" id="calc-result">Enter units for six- and twelve-month base, bull and bear scenarios.</div></section></div>`)}${modalPanel(prefix, 'chart', `<section class="detail-section chart-section"><p class="research-label">TREND CONTEXT</p><h3>Recent closing-price history</h3><p>Move over or touch the line to inspect the date and close.</p>${chart(metrics)}</section>`)}${modalPanel(prefix, 'news', `<section class="detail-section announcements"><p class="research-label">COMPANY-SPECIFIC DISCLOSURES</p><h3>${safe(metrics.symbol)} announcements</h3><div id="announcements">Loading company disclosures…</div></section>`)}</div>`;
}

function decisionContent(metrics) {
  const source = safe(metrics.dataSource || 'market data');
  const evidence = decisionEvidence(metrics);
  const prefix = 'decision';
  const posture = metrics.signal === 'BUY' ? 'Momentum is constructive, but only a planned, risk-defined setup is shown.' : metrics.signal === 'HOLD' ? 'The ticker has mixed evidence. Wait for confirmation instead of treating the signal as a fresh buy.' : 'Current price action does not support adding risk. Revisit only if the evidence changes.';
  const nextStep = metrics.signal === 'BUY' ? `A buyer would still need a position size and an exit plan below ${money.format(metrics.support)}.` : metrics.signal === 'HOLD' ? `A patient investor can monitor ${money.format(metrics.resistance)} for confirmation or ${money.format(metrics.support)} as the risk line.` : `A cautious investor can wait for a positive daily move and improving 20-day trend before reviewing again.`;
  return `<div class="modal-body modal-body-fixed"><div class="modal-title"><div><h2>${safe(metrics.name)}</h2><p>${safe(metrics.symbol)} · ${source} · ${money.format(metrics.lastPrice)}</p></div><span class="signal ${metrics.signal}">${metrics.signal}</span></div><section class="decision-hero"><span>DECISION BRIEF</span><h3>${posture}</h3><p>${nextStep}</p></section><div class="summary-cards"><article><span>Signal score</span><strong>${metrics.score}/100</strong></article><article><span>Today</span><strong class="${metrics.pChange >= 0 ? 'positive' : 'negative'}">${percent(metrics.pChange)}</strong></article><article><span>Trend</span><strong class="${metrics.trend >= 0 ? 'positive' : 'negative'}">${percent(metrics.trend)}</strong></article><article><span>Risk</span><strong>${metrics.risk}</strong></article></div>${modalTabs(prefix, [{ id: 'evidence', label: 'Evidence' }, { id: 'plan', label: 'Decision map' }, { id: 'news', label: 'Company updates' }])}${modalPanel(prefix, 'evidence', `<section class="detail-section research-brief"><p class="research-label">WHY THE DASHBOARD REACHED THIS VIEW</p><div class="evidence-columns"><div><h4>Evidence for strength</h4><ul>${evidence.positive.map(item => `<li>${safe(item)}</li>`).join('') || '<li>No positive price-action support is strong enough to rely on.</li>'}</ul></div><div><h4>Evidence for caution</h4><ul>${evidence.risks.map(item => `<li>${safe(item)}</li>`).join('') || '<li>There is no highlighted technical warning, but price-only analysis has clear limits.</li>'}</ul></div></div><p class="method-note">This brief evaluates price action only. Review earnings, valuation, cash flow, sector conditions and disclosures separately before investing.</p></section>`, true)}${modalPanel(prefix, 'plan', `<section class="detail-section"><p class="research-label">DECISION MAP</p><h3>What would change the view?</h3><div class="decision-map"><div><span>Price now</span><strong>${money.format(metrics.lastPrice)}</strong><small>Current reference</small></div><div><span>Risk increases below</span><strong>${money.format(metrics.support)}</strong><small>${evidence.supportGap.toFixed(1)}% below now</small></div><div><span>Confirmation near</span><strong>${money.format(metrics.resistance)}</strong><small>${evidence.resistanceGap.toFixed(1)}% above now</small></div></div><p>Decision rule: do not rely on a single score. A stronger case needs trend, price behaviour, company fundamentals and a risk limit to agree.</p></section>`)}${modalPanel(prefix, 'news', `<section class="detail-section announcements"><p class="research-label">COMPANY-SPECIFIC DISCLOSURES</p><h3>${safe(metrics.symbol)} announcements</h3><div id="announcements">Loading company disclosures…</div></section>`)}</div>`;
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
  const modal = $('#review-modal');
  $('#modal-content').innerHTML = `<div class="modal-body">Loading stock ${mode === 'decision' ? 'decision' : 'review'}...</div>`;
  if (!modal.open) modal.showModal();
  try {
    const raw = await api('stock', ticker);
    if (!raw?.stock?.lastPrice) throw new Error('The market-data source returned no current price for this ticker');
    writeCache(`${STOCK_CACHE_PREFIX}${ticker}`, { raw, savedAt: new Date().toISOString() });
    fillReview(raw, ticker, false, mode);
  } catch (error) {
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

function renderWatchlist(rows = state.watchRows) {
  const list = $('#watchlist-items');
  const note = $('#watchlist-note');
  if (!list || !note) return;
  if (!state.watchlist.length) {
    list.innerHTML = '<p class="watchlist-empty">No stocks watched yet. Add an NSE ticker, a target price, or a stop level.</p>';
    note.textContent = `Saved only on this device · maximum ${MAX_WATCHLIST_SIZE} stocks`;
    pager('#watch-pager', 0, 0, 'watch');
    return;
  }
  const indexed = new Map(rows.map(row => [row.symbol, row]));
  const view = visiblePage(state.watchlist, state.watchPage);
  state.watchPage = view.page;
  list.innerHTML = view.items.map(item => {
    const row = indexed.get(item.symbol) || { ...item, metrics: cachedStockAnalysis(item.symbol) };
    const metrics = row.metrics;
    const alert = alertForWatch(item, metrics);
    const levels = `${item.target ? `Target ${money.format(item.target)}` : 'No target'} · ${item.stop ? `Stop ${money.format(item.stop)}` : 'No stop'}`;
    return `<article class="watch-row ${alert ? 'watch-alert-row' : ''}"><div><strong>${safe(item.symbol)}</strong><small>${metrics ? `${safe(metrics.name)} · ${safe(metrics.dataSource || 'market data')}` : 'Loading market data…'}</small></div><div><span>Last price</span><strong>${metrics ? money.format(metrics.lastPrice) : '—'}</strong><small class="${metrics?.pChange >= 0 ? 'positive' : 'negative'}">${metrics ? percent(metrics.pChange) : '—'}</small></div><div><span>Signal / risk</span><strong>${metrics ? `${safe(metrics.signal)} · ${safe(metrics.risk)}` : '—'}</strong><small>${levels}</small></div><div class="watch-actions"><button class="review-button" data-review="${safe(item.symbol)}" type="button">Review</button><button class="decision-button" data-decision="${safe(item.symbol)}" type="button">Decision</button><button class="watch-edit" data-edit-watch="${safe(item.symbol)}" type="button">Edit</button><button class="watch-remove" data-remove-watch="${safe(item.symbol)}" type="button">Remove</button></div></article>`;
  }).join('');
  pager('#watch-pager', view.page, view.pages, 'watch', state.watchlist.length, view.size);
  note.textContent = 'Alerts are checked while this dashboard is open or refreshed.';
}

async function refreshWatchlist() {
  if (!state.watchlist.length) { state.watchRows = []; renderWatchlist(); return; }
  const items = state.watchlist.map(item => ({ ...item }));
  state.watchRows = items.map(item => ({ ...item, metrics: cachedStockAnalysis(item.symbol) }));
  renderWatchlist();
  const rows = await Promise.all(items.map(async item => {
    try { return { ...item, metrics: await loadStockAnalysis(item.symbol) }; }
    catch (error) { return { ...item, metrics: cachedStockAnalysis(item.symbol), error }; }
  }));
  state.watchRows = rows;
  renderWatchlist(rows);
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
  const sent = readCache(WATCH_ALERTS_KEY) || {};
  Object.keys(sent).filter(key => key.startsWith(`${ticker}:`)).forEach(key => delete sent[key]);
  writeCache(WATCH_ALERTS_KEY, sent);
  $('#watch-submit').textContent = 'Add to watchlist';
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
  const edit = event.target.closest('[data-edit-watch]');
  if (edit) return editWatch(edit.dataset.editWatch);
  const remove = event.target.closest('[data-remove-watch]');
  if (remove) {
    const ticker = remove.dataset.removeWatch;
    saveWatchlist(state.watchlist.filter(item => item.symbol !== ticker));
    const sent = readCache(WATCH_ALERTS_KEY) || {};
    Object.keys(sent).filter(key => key.startsWith(`${ticker}:`)).forEach(key => delete sent[key]);
    writeCache(WATCH_ALERTS_KEY, sent);
    void refreshWatchlist();
  }
});

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
$('#modal-close').addEventListener('click', () => $('#review-modal').close());
$('#review-modal').addEventListener('click', event => { if (event.target === $('#review-modal')) $('#review-modal').close(); });
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
state.watchlist = readWatchlist();
renderWatchlist();
updateAlertButton();
refresh();
