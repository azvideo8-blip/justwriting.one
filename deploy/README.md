# Deploy — JustWriting on VPS

## What goes where

| File | Destination |
|------|-------------|
| `nginx.conf` | `/etc/nginx/sites-available/justwriting` → symlink to `sites-enabled` |
| `justwriting.service` | `/etc/systemd/system/justwriting.service` |
| `.env.example` | Copy to `/opt/justwriting/.env`, fill in values |

## Prerequisites

- Node.js 20+
- nginx
- certbot (for TLS)
- A non-root `justwriting` user

## Setup

```bash
# 1. Create user and app directory
sudo useradd -r -s /usr/sbin/nologin justwriting
sudo mkdir -p /opt/justwriting/data
sudo chown justwriting:justwriting /opt/justwriting/data

# 2. Copy build output
sudo cp -r dist/* /var/www/justwriting/

# 3. Copy API code
sudo cp api/server.ts /opt/justwriting/
sudo npm --prefix /opt/justwriting install express firebase-admin

# 4. Environment
sudo cp deploy/.env.example /opt/justwriting/.env
sudo chown justwriting:justwriting /opt/justwriting/.env
sudo chmod 600 /opt/justwriting/.env
# Edit /opt/justwriting/.env with actual values

# 5. nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/justwriting
sudo ln -sf /etc/nginx/sites-available/justwriting /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 6. TLS
sudo certbot --nginx -d yourdomain.com

# 7. systemd
sudo cp deploy/justwriting.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable justwriting
sudo systemctl start justwriting
```

## Verify

```bash
# Process alive
curl -f http://localhost:3000/health

# Dependencies available
curl -f http://localhost:3000/ready

# nginx serving the SPA
curl -I https://yourdomain.com/

# Service worker never cached
curl -sD - https://yourdomain.com/sw.js | grep -i cache-control

# .map blocked
curl -I https://yourdomain.com/assets/index.js.map  # → 404
```

## Environment variables

| Name | Required | Description |
|------|----------|-------------|
| `FIREBASE_PROJECT_ID` | yes | GCP project id |
| `FIREBASE_SERVICE_ACCOUNT` | yes | JSON service account key (one line) |
| `FIRESTORE_DATABASE_ID` | yes | Firestore database id (not "(default)") |
| `PORT` | no | API listen port, default 3000 |
| `OPENAI_API_KEY` | yes | For /api/chat endpoint |
| `SENTRY_DSN` | no | Error tracking |
| `POSTHOG_API_KEY` | no | Analytics |
