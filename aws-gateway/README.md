# Market Pulse AWS gateway

This package runs the Market Pulse **read-only** market-data gateway on the
fixed-IP Lightsail instance. Once a Sharekhan customer session is connected,
the gateway uses the authorised Sharekhan ScripMaster and daily historical-data
endpoints for ticker analysis and the NIFTY 50 ranking. It falls back to the
existing NSE/Twelve Data/Yahoo path if the Sharekhan session or a data request
is unavailable.

The Sharekhan API Key, Secure Key, request token, and access token are kept on
the AWS server only. They are never sent to the Netlify dashboard, GitHub, or
the browser. This gateway does not include trading, order, holdings, funds,
or account endpoints. It does not enable Sharekhan's live WebSocket stream;
the Sharekhan result is clearly labelled as daily historical data.

## Put this release in your GitHub repository first

1. Extract `market-pulse-dashboard-sharekhan-gateway-v30.zip` on Windows.
2. In the `sdeverkonda17-sd/market-pulse` GitHub repository, choose **Add
   file → Upload files**.
3. Drag all extracted files and folders into GitHub, including the new
   `aws-gateway` folder and `config.js`, then commit the change.
4. Wait for Netlify to finish its automatic deployment. The dashboard will use
   the gateway as soon as the server installation below is complete.

## Update the existing Lightsail server after uploading this project

Run these commands in the Lightsail browser terminal. The application remains
bound to `127.0.0.1`; nginx is the only public entry point. Do not run `git
clone` again because this server already has `/opt/market-pulse`.

```bash
cd /opt/market-pulse && sudo git pull --ff-only
sudo install -d -m 700 -o marketpulse -g marketpulse /opt/market-pulse/runtime
sudo install -m 644 aws-gateway/market-pulse.service /etc/systemd/system/market-pulse.service
sudo systemctl daemon-reload
```

Replace the nginx route, test it, and then run Certbot again. The last command
is important because replacing the nginx file removes Certbot's previous HTTPS
section and Certbot safely puts it back.

```bash
sudo install -m 644 aws-gateway/market-pulse-nginx.conf /etc/nginx/sites-available/market-pulse
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d marketpulse-suman.duckdns.org -m sdeverkonda17@gmail.com --agree-tos --no-eff-email --redirect
```

## Add Sharekhan credentials privately

Open the private server file. Type the values yourself from the Sharekhan
developer portal; do not paste them into GitHub or chat.

```bash
sudo nano /etc/market-pulse/market-pulse.env
```

Add these three lines at the end. A **Self App/customer login** leaves
`SHAREKHAN_VENDOR_KEY` blank.

```ini
SHAREKHAN_API_KEY=type-your-Sharekhan-API-Key-here
SHAREKHAN_SECURE_KEY=type-your-32-character-Sharekhan-Secure-Key-here
SHAREKHAN_VENDOR_KEY=
```

In nano, save with `Ctrl+O`, press `Enter`, then exit with `Ctrl+X`. Restart
the service and confirm that it is running:

```bash
sudo systemctl restart market-pulse
sudo systemctl status market-pulse --no-pager
```

In the Sharekhan developer portal, set the Self App redirect URL to exactly:

```text
https://marketpulse-suman.duckdns.org/sharekhan/callback
```

Then open this URL in your normal browser (not the SSH terminal), sign in to
Sharekhan, and complete any OTP yourself:

```text
https://marketpulse-suman.duckdns.org/sharekhan/connect
```

The success screen says **Sharekhan connected**. It saves the access token only
in `/opt/market-pulse/runtime/sharekhan-session.json`, which is owned by the
restricted `marketpulse` service account.

Verify without any credential:

```bash
curl -s https://marketpulse-suman.duckdns.org/health
```

The response must contain `"status":"ok"`. After connection, open
`https://marketpulse-suman.duckdns.org/sharekhan/status`; it should show
`"configured":true` and `"connected":true`, without displaying any secret.

## Security boundary

- Do **not** add API keys, Secure Keys, passwords, PINs, or OTPs to this file,
  the browser, GitHub, or a chat.
- The dashboard uses only `GET /api/market`; this gateway has no order, trade,
  fund, holdings, or account endpoint.
- Sign in only through `https://marketpulse-suman.duckdns.org/sharekhan/connect`.
  Never send a Sharekhan password, PIN, OTP, API Key, Secure Key, request token,
  or access token to anyone in chat.
