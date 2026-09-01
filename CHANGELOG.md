# Market Pulse changelog

Created by **Suman Devarakonda**.

## v39.36 — 2 September 2026

- Added a prominent explicit Lot count card to every algorithm result.
- Added Shares / units in one lot: one share for cash equity and the entered verified contract size for derivatives.
- Clarified that lot count becomes available after the stop-loss and risk limits are supplied.

## v39.35 — 2 September 2026

- Added a compact bold algorithm-logic note at the bottom of the Lot Planner.
- Explained the smallest-of-three quantity rule, complete-lot rounding and research-signal gate.
- Clarified that ML and technical patterns cannot override hard capital, exposure or stop-loss limits.

## v39.34 — 2 September 2026

- Added current Top 10 market movers to the Lot Planner with Plan lot and Decision actions.
- Added hover and keyboard-focus explanations for stop-loss, maximum loss, capital and exposure.
- Added units per lot, one-lot value, one-lot risk and detailed binding-rule proof.
- Rebuilt results around stock-specific price, EMA, RSI, support/resistance, ML, ORB, triangle and risk evidence.

## v39.33 — 2 September 2026

- Added a dedicated algorithmic Lot Planner tab for equities, futures and options.
- Added capital affordability, portfolio exposure, stop-loss risk and complete-lot sizing rules.
- Added a strict No affordable lot result instead of rounding risk upward.
- Integrated Upstox ticker/price loading, ML and pattern context, Review, Decision and equity paper entry.
- Added plain-language proof and responsive mobile styling.

## v39.32 — 2 September 2026

- Finalized the Mark entered dialog and protected sell analysis while watchlist market data is loading.
- Browser-verified entry price, quantity, saved paper position and Close trade transition.
- Removed the remaining null-data startup exception found during end-to-end testing.

## v39.31 — 2 September 2026

- Replaced browser-native paper-entry prompts with an in-dashboard price and quantity dialog.
- Added input validation, Cancel, and explicit paper-only wording to Mark entered.
- Added a fresh asset cache version so the repaired interaction loads immediately.

## v39.30 — 2 September 2026

- Restored the complete shared runtime used by Refresh, watchlists, paper trades, calculators and news panels.
- Retained the ORB, triangle and full-OHLC implementation as the final active analysis layer.
- Added another cache-version change so browsers cannot reuse the incomplete v39.29 JavaScript.
- Browser-tested startup and refresh behavior against the local Netlify server.

## v39.29 — 2 September 2026

- Restored the Refresh button click action and dashboard-wide delegated controls.
- Removed the duplicated legacy analysis block that was overriding the v39.28 ORB, triangle and OHLC implementation.
- Preserved the response-level Upstox provider name in every stock Review.
- Bumped asset and service-worker cache versions so the browser downloads the corrected code.

## v39.28 — 2 September 2026

- Added ORB state analysis using the first three completed five-minute candles as the 15-minute opening range.
- Added conservative ascending, descending and symmetrical triangle detection with convergence, touch and volume checks.
- Added ORB and triangle evidence to the ML and decision explanations without allowing patterns to override fundamentals or risk.
- Added one switchable chart with Trend, Candles, Volume, Triangle and ORB views.
- Preserved full Upstox daily OHLCV history and optional current-session intraday candles.
## v39.27 — 31 August 2026

- Fixed Market Movers remaining on Loading by starting its request after the workspace is attached to the document.
- Excluded Netlify function responses from service-worker caching to prevent stale market API results.
- Verified the rendered panel in a headless browser against the local Netlify server.
## v39.26 — 31 August 2026

- Added an official NSE broad-market movers endpoint, using NIFTY 500 when available and NIFTY 50 as a labelled fallback.
- Separated **NSE top gainers**, **broad ±5% movers**, and **Trade candidates** so a sharp price rise is not mistaken for a buy recommendation.
- Added practical liquidity, session-high, volatility, and chase-risk gates with plain-language proof for every candidate.
- Added direct NSE and Screener comparison links with clear universe and source labels.
## v39.25 — 31 August 2026

- Converted Watch and sector-star controls into one-click add/remove toggles.
- Removed the disabled state that prevented a watched stock from being unwatched.
- Added immediate watchlist removal without waiting for a market-data request.
- Renamed the action to **Stop watching** and preserved paper-trade journals and learning history when a stock is unwatched.
## v39.24 — 30 August 2026

- Corrected annual revenue and net-profit growth extraction from the official Upstox `income_statement[].history` response.
- Displayed the current and previous annual reporting periods used for each growth calculation.
- Extended partial NSE symbol/company autocomplete to Research, Return Calculator, and Watchlist.
- Added cached headline context and direct Google News search links when the live headline request cannot be reached.
- Made sector rankings accept partial usable results, preserve saved rankings on the device, and offer an explicit retry.
- Cached NSE Updates and added a direct official NSE announcements link when live updates fail.
- Labelled weekend and after-hours snapshots as market-closed data instead of incorrectly calling them delayed.

## v39.23 — 30 August 2026

- Made a newly added watchlist ticker appear immediately before its market analysis completes.
- Added a lightweight fallback row so advanced-panel errors cannot leave the Watchlist blank.

## Security

- `.env`, `.env.*`, `.netlify`, access tokens, and private service keys are excluded from release ZIP files.
- Upstox credentials remain server-side environment variables.












