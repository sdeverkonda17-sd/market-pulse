# Market Pulse AWS gateway

This package runs the existing **read-only** NSE → fallback market-data service
on the fixed-IP Lightsail instance. It does not store, display, or use any
Sharekhan credential yet. That separation is deliberate: broker login and
session setup must be reviewed against the current Sharekhan documentation and
kept server-side.

## Put this release in your GitHub repository first

1. Extract `market-pulse-dashboard-sharekhan-gateway-v29.zip` on Windows.
2. In the `sdeverkonda17-sd/market-pulse` GitHub repository, choose **Add
   file → Upload files**.
3. Drag all extracted files and folders into GitHub, including the new
   `aws-gateway` folder and `config.js`, then commit the change.
4. Wait for Netlify to finish its automatic deployment. The dashboard will use
   the gateway as soon as the server installation below is complete.

## Install after uploading this project to the Lightsail server

Run the commands below in the Lightsail browser terminal. They install Node,
create a restricted service account, and start the gateway. The application is
only bound to `127.0.0.1`; nginx is the only public entry point.

```bash
sudo apt update && sudo apt install -y git nodejs
sudo git clone https://github.com/sdeverkonda17-sd/market-pulse.git /opt/market-pulse
sudo adduser --system --group --no-create-home marketpulse
sudo install -d -o marketpulse -g marketpulse /etc/market-pulse
sudo install -m 640 -o root -g marketpulse aws-gateway/market-pulse.env.example /etc/market-pulse/market-pulse.env
sudo install -m 644 aws-gateway/market-pulse.service /etc/systemd/system/market-pulse.service
sudo systemctl daemon-reload && sudo systemctl enable --now market-pulse
sudo systemctl status market-pulse --no-pager
```

If the `git clone` command says the folder already exists, stop and use this
safe update command instead:

```bash
cd /opt/market-pulse && sudo git pull --ff-only
```

Then enable the nginx reverse proxy and refresh its HTTPS configuration:

```bash
sudo install -m 644 aws-gateway/market-pulse-nginx.conf /etc/nginx/sites-available/market-pulse
sudo unlink /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/market-pulse /etc/nginx/sites-enabled/market-pulse
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d marketpulse-suman.duckdns.org -m sdeverkonda17@gmail.com --agree-tos --no-eff-email --redirect
```

Verify without any credential:

```bash
curl -s https://marketpulse-suman.duckdns.org/health
```

The response must contain `"status":"ok"`.

## Security boundary

- Do **not** add API keys, Secure Keys, passwords, PINs, or OTPs to this file,
  the browser, GitHub, or a chat.
- The dashboard uses only `GET /api/market`; this gateway has no order, trade,
  fund, or account endpoint.
- The next broker step is a separately reviewed, server-only Sharekhan session
  integration after its current login/request specification is available.
