# Market Pulse — simple setup guide

This is an Indian NSE stock dashboard. It includes its own market-data API function, so **do not open `index.html` by double-clicking it**. Follow the Windows setup once to create a secure web address; then use that address on every device.

## What you need

- A Windows PC with internet access
- An email address
- A free GitHub account and a free Netlify account (the same email can be used for both)

No coding, API key, APK, or installation of any software is needed.

## Part 1 — create your live dashboard link on a Windows PC

1. Download the latest `market-pulse-dashboard-india-v4.zip` file.
2. Open your **Downloads** folder. Right-click the ZIP file and choose **Extract All**. Click **Extract**.
3. Go to [github.com](https://github.com), click **Sign up**, and create a free account if you do not already have one.
4. Once signed in, click the **+** at the top right and choose **New repository**.
5. In “Repository name”, type `market-pulse`. Leave it Public, then click **Create repository**.
6. On the next page click **uploading an existing file**.
7. Open the extracted `market-pulse-dashboard` folder in another File Explorer window. Drag **all files and folders inside it** onto the GitHub upload page. This includes `netlify.toml` and the `netlify` folder. Wait until every file appears.
8. Scroll down and click **Commit changes**.
9. Open [netlify.com](https://www.netlify.com), click **Sign up**, and select **GitHub** to sign in.
10. In Netlify, click **Add new site → Import an existing project → GitHub**. Authorize GitHub if it asks.
11. Select the `market-pulse` repository.
12. Leave the build settings as shown and click **Deploy site**. Wait for “Published”.
13. Click the generated address ending in `.netlify.app`. This is your dashboard. Bookmark it.

Netlify runs the included `/api/market` service automatically. This is what makes the dashboard reliably retrieve all ten NSE stocks. You do **not** need an API key.

## Part 2 — use the dashboard

1. Open your `.netlify.app` link.
2. Wait for the line at the top to say `10/10 stocks updated`.
3. Click a stock row or **Review**. A popup shows its signal, one-year scenario, chart, explanation, and related news.
4. To analyze another company, type its NSE ticker in “Any NSE stock”. Examples: `MARUTI`, `TATAMOTORS`, `HDFCBANK`, `IRCTC`. Click **Analyze stock**.
5. Click **Refresh analysis** once each market day after the market closes.

## Part 3 — install on Android

1. On the Android phone, open **Chrome**.
2. Type or paste your `.netlify.app` dashboard address.
3. Tap the **three dots** in the top-right corner.
4. Tap **Install app**. If that wording is not shown, tap **Add to Home screen**.
5. Tap **Install** or **Add** to confirm.
6. A Market Pulse icon appears on the phone’s home screen. Tap it like any other app.

## Part 4 — install on iPhone or iPad

1. Open **Safari** (not Chrome) on the iPhone/iPad.
2. Type or paste your `.netlify.app` dashboard address.
3. Tap the **Share** button: the square with an upward arrow.
4. Scroll down and tap **Add to Home Screen**.
5. Tap **Add** in the top-right corner.
6. A Market Pulse icon appears on the home screen. Tap it to use the app.

## Updating later

To publish a newer version, open your GitHub `market-pulse` repository, choose **Add file → Upload files**, upload the replacement files, then click **Commit changes**. Netlify updates the site automatically within a minute. On phones, close and reopen the installed app once after an update.

## Important

Signals and one-year scenarios are research tools, not investment advice or guaranteed returns. Verify company results, valuations, filings and your own risk tolerance before making a trade.
