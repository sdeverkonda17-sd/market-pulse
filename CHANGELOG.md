# Market Pulse changelog

Created by **Suman Devarakonda**.

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



