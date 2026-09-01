# Market Pulse v39.25 — local testing and Netlify deployment

This dashboard must be served through Netlify Dev or deployed to Netlify because market requests use the server-side function at `netlify/functions/market.js`. Do not test it by double-clicking `index.html`.

## Private configuration

The server function reads:

- `UPSTOX_ANALYTICS_TOKEN` — required for Upstox research, recommendations, fundamentals and intraday features.
- `TWELVE_DATA_API_KEY` — optional fallback provider.

Never paste either value into `app.js`, `config.js`, GitHub, a screenshot, or a browser form. `.env` and `.env.*` are excluded by `.gitignore`.

## Test locally on Windows

### 1. Install Node.js

Install Node.js 20 or newer from https://nodejs.org/ and restart PowerShell. Confirm it works:

```powershell
node --version
npm.cmd --version
```

Use `npm.cmd`, not `npm`, if PowerShell says `npm.ps1 cannot be loaded because running scripts is disabled`.

### 2. Extract the release

Extract `market-pulse-dashboard-v39.25.zip` to a normal folder such as:

```text
C:\Users\YOUR_NAME\Documents\market-pulse-dashboard-v39.25
```

Open that folder in File Explorer. Click the address bar, type `powershell`, and press Enter.

### 3. Install Netlify CLI

```powershell
npm.cmd install --global netlify-cli
netlify.cmd --version
```

If `netlify.cmd` is not found, close and reopen PowerShell, return to the project folder, and retry.

### 4. Create the private `.env`

```powershell
notepad .env
```

Add your real values without quotation marks:

```text
UPSTOX_ANALYTICS_TOKEN=replace_with_your_private_token
TWELVE_DATA_API_KEY=replace_with_optional_key
```

The Twelve Data line can be omitted. Save and close Notepad. Verify only that the filename exists—do not print its contents:

```powershell
Test-Path .env
```

### 5. Start the dashboard

```powershell
netlify.cmd dev --port 8888
```

Open http://localhost:8888 and keep PowerShell open. Stop the server with `Ctrl+C`.

### 6. Test the important flows

1. Press `Ctrl+Shift+R` once to bypass an older service-worker cache.
2. Open **Top 10** and refresh market data.
3. Open **Recommended** and verify both sections finish loading.
4. In **Research**, type part of a company or ticker and select an autocomplete result.
5. Open its Review and Decision Brief and inspect the 90-session ML sell analysis.
6. Open **Sectors** and test the `☆` Watchlist icon.
7. Open **Watchlist**, expand a stock, and test the Beginner Trade Coach and ML sell analysis.

### Common local problems

- **PowerShell blocks npm.ps1:** use `npm.cmd` and `netlify.cmd`.
- **`netlify.cmd` is not recognized:** reopen PowerShell after installing it.
- **Port 8888 is occupied:** use `netlify.cmd dev --port 8890` and open `http://localhost:8890`.
- **Old interface appears:** press `Ctrl+Shift+R`; if needed, clear localhost site data.
- **Authentication error:** verify the variable is exactly `UPSTOX_ANALYTICS_TOKEN`, then restart Netlify Dev.
- **Suggestions are offline:** exact symbols still work and the app uses its configured NSE fallback directory.

## Publish the project to GitHub

1. Sign in at https://github.com/.
2. Select **New repository**.
3. Name it `market-pulse-dashboard` and preferably choose **Private**.
4. Do not add another README or `.gitignore`.
5. Create the repository and choose **uploading an existing file**.
6. Drag everything *inside* the extracted project folder into GitHub. Include `index.html`, `app.js`, `styles.css`, `netlify.toml`, and the entire `netlify/functions` folder.
7. Confirm `.env` and `.netlify` are not listed.
8. Commit to `main`.

## Deploy through Netlify using GitHub

1. Sign in at https://app.netlify.com/.
2. Choose **Add new project** → **Import an existing project**.
3. Select **GitHub**, authorize it, and choose the repository.
4. Use:
   - Branch: `main`
   - Base directory: blank
   - Build command: blank
   - Publish directory: `.`
   - Functions: `netlify/functions` is read from `netlify.toml`
5. Open **Project configuration** → **Environment variables**.
6. Add `UPSTOX_ANALYTICS_TOKEN` with the private value.
7. Optionally add `TWELVE_DATA_API_KEY`.
8. Trigger **Deploy site**. After changing a variable, use **Deploys** → **Trigger deploy** → **Clear cache and deploy site**.
9. Wait for **Published**, open the `.netlify.app` URL, and press `Ctrl+Shift+R` once.

## Verify deployment

Open:

```text
https://YOUR-SITE.netlify.app/.netlify/functions/market?type=leaders
```

It should return JSON, not 404. Then test autocomplete, Review, Decision Brief, Recommended, Sectors and Watchlist.

If functions return 404, verify `netlify.toml` and `netlify/functions/market.js` are at the repository root. If an Upstox configuration error appears, verify the Netlify environment variable and redeploy.

## Updating later

1. Replace repository files while preserving the folder structure.
2. Never upload `.env` or `.netlify`.
3. Commit to `main`; Netlify should deploy automatically.
4. If an old service worker remains, clear the Netlify deploy cache and hard-refresh.

## Security checklist

- `.env` is absent from GitHub and release ZIPs.
- Tokens exist only in local `.env` and Netlify environment variables.
- Tokens are never stored in `config.js` or browser JavaScript.
- Rotate any token immediately if it is committed or shared.
- Watchlists, paper trades, timelines and coaching notes remain in browser local storage.



