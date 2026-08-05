# Market Pulse — setup guide

Market Pulse is an Indian-stock research dashboard. It must be deployed to Netlify because its secure market-data service runs on the server. Do not open `index.html` by double-clicking it.

## Data-source order

1. **NSE India** is always tried first for the NIFTY 50 ranking, ticker quote, price history, and corporate disclosures.
2. If NSE is temporarily unreachable, the dashboard tries **Twelve Data** when its API key is configured in Netlify.
3. If Twelve Data is not configured or does not respond, the dashboard uses its free **Yahoo Finance NSE-symbol fallback** automatically. No API key is needed for this last-resort source.
4. If all live sources fail, the dashboard shows the last saved result on the device, clearly marked as saved data.

The screen and every stock-review popup name the source. Yahoo Finance fallback data is informational, may be delayed, and is not an official NSE feed. Verify a trade or corporate disclosure on NSE.

## Deploy on Windows

1. Download `market-pulse-dashboard-watchlist-v28.zip` and right-click it in **Downloads**.
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
2. The table displays the daily top 10 and the current source label.
3. Click **Review** to see signal reasoning, risk, support/resistance, price trend and return scenarios. Click **Decision** for a plain-language buying case, reasons to wait, and key price levels.
4. Enter any NSE ticker in **Analyse a specific ticker** for a separate review.
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
