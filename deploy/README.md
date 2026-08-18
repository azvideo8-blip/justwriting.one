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
# Поскольку код написан на TypeScript (api/server.ts), его нужно скомпилировать.
# Здесь предполагается, что сборка бэкенда производится локально или в CI.
# Например: npx tsc api/server.ts
sudo cp api/server.js /opt/justwriting/
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

# Server ready (проверяет только то, что процесс поднялся, т.к. зависимость от Firestore убрана до подключения Supabase)
curl -f http://localhost:3000/ready

# nginx serving the SPA
curl -I https://yourdomain.com/

# Service worker never cached
curl -sD - https://yourdomain.com/sw.js | grep -i cache-control

# .map blocked
curl -I https://yourdomain.com/assets/index.js.map  # → 404
```

## API Limitations

`/api/chat` в данный момент возвращает 501 Not Implemented. Это нормальное поведение. Настоящая реализация появится позже, когда будет куда ходить, поэтому не ожидайте работающего чата из коробки на данном этапе.

## Rate Limiting & Auth Protection

1. **Nginx Layer (`deploy/nginx.conf`)**:
   - `/auth/`: strictly rate limited with `limit_req zone=auth_limit burst=5 nodelay` (5 req/min per IP) to prevent password brute-force and credential stuffing.
   - `/api/`: rate limited with `limit_req zone=api_limit burst=30 nodelay` (60 req/min per IP) with high burst to allow batch operations while preventing DoS and runaway AI spending.
   - `/rest/`, `/realtime/`, `/storage/`: not subject to strict auth throttling so regular note synchronization operates smoothly.

2. **Supabase / GoTrue Layer (`/opt/justwriting/supabase/.env`)**:
   - `GOTRUE_RATE_LIMIT_EMAIL_SENT=30` (30 emails/hr)
   - `GOTRUE_RATE_LIMIT_VERIFY=30` (30 verifications/hr)
   - `GOTRUE_RATE_LIMIT_TOKEN_REFRESH=30` (30 refresh/hr)
   - `GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For`
   - *Note*: GoTrue rate limits protect email sending and token endpoint abuse, but do NOT protect against password brute-forcing; password brute-force protection is enforced by Nginx `limit_req` on `/auth/`.

3. **MFA (TOTP) for Admin**:
   - Supabase Auth natively supports TOTP MFA via `supabase.auth.mfa.enroll({ factorType: 'totp' })`. For admin accounts on single-user instances, MFA should be enrolled to protect elevated permissions.

4. **Registration Email Enumeration**:
   - Silent suppression of `email-already-in-use` requires an active transactional email delivery pipeline ("confirmation email sent" + notifying existing accounts out-of-band). This item is tracked and deferred until transactional email service (SMTP) is integrated.


## Registration & Signup Control

- **Single-User / Private Instance**: Once the primary admin account is registered, public signups can be disabled to prevent unauthorized account creation. In `/opt/justwriting/supabase/.env`, set `DISABLE_SIGNUP=true` (or `GOTRUE_DISABLE_SIGNUP=true` in `docker-compose.yml`), then reload Supabase containers (`docker compose up -d auth`).
- **Open / Multi-User Instance**: Keep signups enabled (`DISABLE_SIGNUP=false`). Protection against credential stuffing and brute-force registration is enforced by the Nginx `/auth/` rate limit (5 req/min per IP).

## Environment variables

| Name | Required | Description |
|------|----------|-------------|
| `PORT` | no | API listen port, default 3000 |
| `SUPABASE_JWT_SECRET` | yes | JWT secret for verifying auth tokens |
| `DATABASE_URL` | yes | Postgres connection string |
| `OPENROUTER_API_KEY` | yes | AI provider key (RouterAI) |
| `AI_BASE_URL` | no | Provider base URL, default `https://routerai.ru/api/v1` |
| `AI_TIER_RPD` | no | Global daily request cap (default 10,000) |
| `AI_TIER_TPD` | no | Global daily token cap (default 25,000,000) |
| `AI_DAILY_SPEND_LIMIT_RUB` | no | Daily spend ceiling in Rubles (e.g. 100) |
| `AI_RUB_PER_1M_TOKENS` | no | Estimated price per 1M tokens in RUB (default 30) |
| `SENTRY_DSN` | no | Error tracking |
| `POSTHOG_API_KEY` | no | Analytics |


