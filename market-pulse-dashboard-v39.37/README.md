# Market Pulse v39 — reliable stock actions and scrolling

This version keeps the multi-factor research model, fixes stock-action loading and scrolling, and adds explainable machine learning.

- **Explainable ML:** a per-stock three-class logistic-regression model trains on chronological price windows and reports down, sideways and up probabilities.
- **Honest validation:** every ML view shows chronological holdout accuracy, training-sample count, confidence and strongest drivers. Low-performing models are labelled Low confidence.
- **Decision safety:** ML remains a separate perspective and never overrides the transparent fundamental, technical or risk rules.

- Stock requests now time out after 15 seconds and fall back to saved data instead of loading forever.
- Stale responses cannot replace a newer stock review or reopen content after the modal is closed.
- The stock-review modal has one explicit, touch-friendly scroll area on desktop and mobile.

- **55% fundamentals when available:** annual revenue growth, profit growth, P/E versus sector, ROE versus sector, and ROCE versus sector, supplied through your server-side Upstox token.
- **45% technical context:** latest price move, daily range, 52-week position, EMA 20/50 trend, RSI 14, and recent volatility.
- When a provider does not return fundamentals, the dashboard visibly says **technical-only**. Missing data never becomes a hidden positive score.
- **Recommended** presents three research candidates from the current tracked NIFTY 50 universe. Quantity is only an illustration of how many whole shares are close to a ₹10,000 research budget; it is not personal investment advice.
- **Review** now contains EMA 20, EMA 50, RSI 14, support/resistance, score inputs, business/valuation metrics, ticker headlines, and India/world market-news context.
- **Decision brief** gives specific reasons to consider, wait, or avoid based on the actual ticker evidence. Headlines are shown for human review and are deliberately not converted into an automatic buy signal.

## Test locally on a Windows PC

You need Node.js 20 or newer. Do this once:

1. Extract this ZIP to a folder such as `Documents\Market-Pulse-v39`.
2. Open that folder in File Explorer, click the address bar, type `powershell`, and press Enter.
3. Run: `npm install --global netlify-cli`
4. Create a new file named `.env` in this folder. Put this single line inside, replacing the value with your private token:

   `UPSTOX_ANALYTICS_TOKEN=your_upstox_analytics_token_here`

5. Run: `netlify dev`
6. Open `http://localhost:8888` in Chrome or Edge. Test **Top 10**, **Recommended**, a ticker **Review**, **Decision brief**, and the **Return calculator**.
7. Stop the local server with `Ctrl + C` when finished.

Never upload the `.env` file or paste the token into GitHub, `app.js`, or a browser form.

### Optional: test from your Android/iPhone on the same Wi-Fi

1. With the PC server stopped, run: `netlify dev --host 0.0.0.0`
2. On the PC, run `ipconfig` and note the IPv4 address under your active Wi-Fi connection (for example `192.168.1.20`).
3. On the phone, open `http://YOUR-PC-IP:8888` in its browser. If Windows asks, allow private-network access.
4. This is only a temporary local test; use the deployed Netlify URL for normal use and installation.

## Deploy this package to your existing Netlify site

1. Extract `market-pulse-dashboard-research-v38.zip`.
2. In GitHub, open the **market-pulse** repository, then open the **Code** tab.
3. Choose **Add file → Upload files**. Drag everything *inside* the extracted `market-pulse-dashboard` folder onto the page, including the `netlify` folder and `netlify.toml`.
4. Commit the changes. Do not upload `.env`.
5. In Netlify, confirm that `UPSTOX_ANALYTICS_TOKEN` is still present under **Project configuration → Environment variables**. Keep its value private.
6. Open **Deploys → Trigger deploy → Clear cache and deploy site**. Wait for it to say **Published**.
7. Open the site in a new tab. If you see an old version, close the tab completely and reopen it; the new service-worker cache is named v38.

The public site does not need a static IP. The Upstox token remains in Netlify’s server environment and is never sent to the browser.

---
# Market Pulse — setup guide

Market Pulse is an Indian-stock research dashboard. It must be deployed to Netlify because its secure market-data service runs on the server. Do not open `index.html` by double-clicking it.

## Data-source order

1. **NSE India** is tried first for the NIFTY 50 ranking, ticker quote, price history, and corporate disclosures.
2. If NSE is temporarily unreachable, the dashboard tries **Twelve Data** when its API key is configured in Netlify.
3. If Twelve Data is not configured or does not respond, the dashboard uses its free **Yahoo Finance NSE-symbol fallback** automatically. No API key is needed for this last-resort source.
4. The sector screener uses curated NSE-symbol baskets and follows the same Twelve Data then Yahoo fallback route. It labels the provider rather than presenting the basket as an official NSE sector index.
5. If all live sources fail, the dashboard shows the last saved result on the device, clearly marked as saved data.

The screen and every stock-review popup name the source. Yahoo Finance fallback data is informational, may be delayed, and is not an official NSE feed. Verify a trade or corporate disclosure on NSE.

## Recommended production data provider

For a dependable daily ranking, do **not** treat the free Yahoo route as a live trading feed. The best next integration is a broker API that gives authenticated exchange snapshots and historical candles:

1. **DhanHQ** is the simplest fit for this dashboard: its market-quote API can request LTP, OHLC or depth for up to 1,000 instruments at once, so one server-side call can screen the 50-stock universe. It requires a Dhan client ID and access token.
2. **Upstox** is a strong alternative if you already use Upstox. Its market-quote API supports batches of exchange snapshots and its analytics token is designed for market-data and streaming use.
3. **Zerodha Kite Connect** is a good option for a Kite customer. It supports batched full/OHLC/LTP quotes and historical candles, but requires its API access and login/token lifecycle.
4. For an external/public product that needs official redistribution rights, use **NSE Data & Analytics** or an authorised vendor. That is the official route for licensed real-time, snapshot, historical and corporate data.

Keep provider tokens in Netlify environment variables, never in GitHub, JavaScript files or a browser form. This release keeps the existing NSE-first route live until you choose one provider and supply its server-side credentials.

## Deploy on Windows

1. Download `market-pulse-dashboard-research-v38.zip` and right-click it in **Downloads**.
2. Choose **Extract All**, then **Extract**.
3. In GitHub, open your `market-pulse` repository.
4. Choose **Add file → Upload files**.
5. Open the extracted `market-pulse-dashboard` folder and drag **everything inside it** onto the GitHub page. This must include the `netlify` folder and `netlify.toml`.
6. Click **Commit changes**. Netlify normally publishes the update automatically within one minute.
7. Open your `.netlify.app` dashboard link and click **Refresh market data**.

## Turn on the NSE fallback provider

This is optional but recommended. The free Yahoo Finance fallback works without setup. Twelve Data adds a second provider before Yahoo Finance, but needs an account and an API plan that includes NSE symbols and enough API credits for a 50-stock ranking.

1. Create or sign in to your Twelve Data account and copy your API key.
2. Open your site in Netlify.
3. Select **Site configuration → Environment variables**.
4. Click **Add a variable**.
5. For the key, enter exactly: `TWELVE_DATA_API_KEY`
6. For the value, paste your Twelve Data API key. Keep it private; never put it in GitHub or a browser form.
7. Save the variable.
8. In Netlify, go to **Deploys**, then choose **Trigger deploy → Deploy site**.
9. When the deploy is published, open the dashboard and refresh it. During an NSE outage it will say `NSE unavailable - using Twelve Data (NSE fallback)`.

Twelve Data batch requests use one API credit per requested symbol, so a full top-10 ranking needs a plan with capacity for the 50 tracked symbols. The dashboard rejects a partial response instead of misleadingly calling a small subset “top 10.” The free Yahoo Finance fallback also rejects a partial response and is cached for five minutes to reduce unnecessary requests.

## Use the dashboard

1. Open the `.netlify.app` link.
2. The top 10 uses a full table on a large screen. On a phone it shows three clear stock cards per page, with an always-visible **Previous / 1-3 of 10 / Next** control above the cards. Normal vertical scrolling stays available for Review and the return calculator so no result is cut off.
3. Click **Review** for the score explanation, price levels, scenario calculator, chart and company updates. Click **Decision brief** for evidence for strength, evidence for caution, and the price conditions that would change the view.
4. Use the **Research** tab for any NSE ticker. Switch between **Ticker analysis** and **Return calculator** rather than scrolling through both.
5. In **My Watchlist & Alerts**, add a ticker and optional target/stop levels. Use **Enable phone alerts** after installing the app on your phone.
6. In **Investment Scenario Calculator**, enter a ticker and units to buy. It shows the current price per unit, total investment, and base/bull/bear estimates for 1, 3, 6, and 12 months.

## Watchlist and alerts

- The watchlist is stored privately in the browser on that device; it does not require an account and does not sync automatically between devices.
- Up to eight stocks can be watched. Their price, daily change, signal, risk, target and stop level refresh while the dashboard is open.
- Tap **Enable phone alerts** from the installed Android/iPhone web app and allow notifications. Alerts are checked while the app is open or refreshed.
- SMS and WhatsApp messages need a separate paid provider such as Twilio. This version does not send your ticker, prices, or phone number to any messaging service.

## Market status and company updates

- The **Market status (IST)** card uses NSE’s live Capital Market status when it is reachable. If that request is unavailable, it falls back to the regular NSE equity-session schedule: `PRE-OPEN` (09:00–09:15), `OPEN` (09:15–15:30), `CLOSING` (15:30–16:00), or `CLOSED`.
- The schedule fallback is labelled as indicative because exchange holidays and special sessions can change normal hours.
- **Recent corporate announcements** is a separate, non-blocking section. It shows the newest NSE company disclosures and links to the original attachment when NSE is available.
- When NSE announcements cannot be reached, the rest of the dashboard and the market-status indicator stay usable; the updates panel says that official disclosures are temporarily unavailable.

## Install as an app on Android

1. Open the dashboard link in **Chrome**.
2. Tap the three dots at the top right.
3. Tap **Install app**. If it is not shown, tap **Add to Home screen**.
4. Tap **Install** or **Add**.
5. Open the new Market Pulse icon from your home screen.

## Install as an app on iPhone or iPad

1. Open the dashboard link in **Safari**.
2. Tap the **Share** button (square with an upward arrow).
3. Scroll down and choose **Add to Home Screen**.
4. Tap **Add**.
5. Open Market Pulse from the new home-screen icon.

## Important

Signals and scenarios are research aids, not investment advice or guaranteed returns. Verify prices, filings, valuations, and your own risk tolerance before investing.
