# Deploy — JustWriting on VPS

## What goes where

| File | Destination |
|------|-------------|
| `nginx.conf` | `/etc/nginx/sites-available/justwriting` → symlink to `sites-enabled` |
| `snippets/security-headers.conf` | `/etc/nginx/snippets/security-headers.conf` — общие защитные заголовки (HSTS, nosniff, DENY и др.) |
| `www-killswitch/sw.js` | `/var/www/www-killswitch/sw.js` — служебный работник-выключатель для `www.` (nginx отдаёт его вместо 301, иначе старая сборка из кэша живёт вечно) |
| `supabase-compose.override.yml` | `/opt/justwriting/supabase/docker-compose.override.yml` — порты только на 127.0.0.1, русские письма GoTrue |
| `invite.sh` | `/opt/justwriting/deploy/invite.sh` — пригласить тестера (регистрация в UI выключена) |
| `justwriting.service` | `/etc/systemd/system/justwriting.service` |
| `api/package.json` + `api/package-lock.json` | `/opt/justwriting/api/` — внешние зависимости бандла службы; выкатка ставит их `npm ci` (ровно те версии, что в локе, — он же тот набор, на котором крутятся тесты; `npm ci` сначала сносит `node_modules`, поэтому при провале установки служба останется без зависимостей до следующей выкатки) |
| `.env.example` | Copy to `/opt/justwriting/api/.env` (`EnvironmentFile` in `justwriting.service`), fill in values |

## Prerequisites

- Node.js 22
- Docker (self-hosted Supabase in `/opt/justwriting/supabase`)
- nginx
- certbot (for TLS)
- A non-root `justwriting` user

## Первая установка (первый деплой)

```bash
# 1. Create user and app directory
sudo useradd -r -s /usr/sbin/nologin justwriting
sudo mkdir -p /opt/justwriting/api
sudo chown justwriting:justwriting /opt/justwriting/api

# 2. Copy build output (npm run build)
sudo cp -r dist/* /var/www/justwriting/

# 3. API: one esbuild bundle, dependencies external (same as the deploy workflow)
npx esbuild api/server.ts --bundle --platform=node --format=esm \
  --target=node20 --packages=external --outfile=/tmp/server.mjs
sudo cp /tmp/server.mjs /opt/justwriting/api/server.mjs
sudo cp deploy/api/package.json /opt/justwriting/api/package.json
sudo cp deploy/api/package-lock.json /opt/justwriting/api/package-lock.json
sudo chown justwriting:justwriting /opt/justwriting/api/server.mjs /opt/justwriting/api/package.json /opt/justwriting/api/package-lock.json
sudo -u justwriting env npm_config_cache=/opt/justwriting/api/.npm-cache \
  npm ci --prefix /opt/justwriting/api --omit=dev --no-audit --no-fund

# 4. Environment
sudo cp deploy/.env.example /opt/justwriting/api/.env
sudo chown justwriting:justwriting /opt/justwriting/api/.env
sudo chmod 600 /opt/justwriting/api/.env
# Edit /opt/justwriting/api/.env with actual values

# 5. nginx
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/snippets/security-headers.conf /etc/nginx/snippets/
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

# Server ready: 503, если задан DATABASE_URL и база не отвечает; показывает, куда уходят эмбеддинги
curl -f http://localhost:3000/ready

# nginx serving the SPA
curl -I https://yourdomain.com/

# Service worker never cached
curl -sD - https://yourdomain.com/sw.js | grep -i cache-control

# .map blocked
curl -I https://yourdomain.com/assets/index.js.map  # → 404
```

Обычная выкатка — не эти шаги, а ручной запуск workflow `Выкатка на сервер` (`.github/workflows/deploy.yml`): сборка, выкладка, перезапуск службы, `scripts/post-deploy-smoke.ts`, откат при сбое.

## Обновление вручную

То же, что делает `deploy.yml`, командами — на случай, когда Actions недоступен.
Пути, имена сервисов и последовательность взяты из workflow.

Клиент:

```bash
# 0. npm run build; карты исходников на сервер не едут
find dist -name '*.map' -delete
REMOTE_DIR=$(ssh justwriting 'mktemp -d /tmp/jw-dist.XXXXXX')
trap 'ssh justwriting "rm -rf $REMOTE_DIR"' EXIT
rsync -az --delete dist/ justwriting:$REMOTE_DIR/
ssh justwriting "REMOTE_DIR=$REMOTE_DIR bash -s" <<'REMOTE'
set -euo pipefail
trap 'rm -rf "$REMOTE_DIR"' EXIT
# .prev — опора для отката
if [ -f /var/www/justwriting/index.html ]; then sudo cp /var/www/justwriting/index.html /var/www/justwriting/index.html.prev; fi
if [ -f /var/www/justwriting/sw.js ]; then sudo cp /var/www/justwriting/sw.js /var/www/justwriting/sw.js.prev; fi
# БЕЗ --delete: страница, открытая до выкатки, продолжает подгружать куски своего бандла
sudo rsync -a "$REMOTE_DIR"/ /var/www/justwriting/
sudo rsync -a /opt/justwriting/email-templates/ /var/www/justwriting/email/
sudo chown -R www-data:www-data /var/www/justwriting
REMOTE
```

Служба:

```bash
# 0. сборка одного бандла (тот же esbuild, что в workflow)
npx esbuild api/server.ts --bundle --platform=node --format=esm \
  --target=node20 --packages=external --outfile=/tmp/jw-server.mjs
REMOTE_DIR=$(ssh justwriting 'mktemp -d /tmp/jw-api.XXXXXX')
trap 'ssh justwriting "rm -rf $REMOTE_DIR"' EXIT
scp /tmp/jw-server.mjs justwriting:$REMOTE_DIR/server.mjs
scp deploy/api/package.json justwriting:$REMOTE_DIR/api-package.json
scp deploy/api/package-lock.json justwriting:$REMOTE_DIR/api-package-lock.json
ssh justwriting "REMOTE_DIR=$REMOTE_DIR bash -s" <<'REMOTE'
set -euo pipefail
trap 'rm -rf "$REMOTE_DIR"' EXIT
sudo cp /opt/justwriting/api/server.mjs /opt/justwriting/api/server.mjs.prev
# npm ci — в отдельный staging-каталог: ci сначала сносит node_modules,
# провал установки прямо на месте оставил бы службу без зависимостей
mkdir -p "$REMOTE_DIR"/stage
cp "$REMOTE_DIR"/api-package.json "$REMOTE_DIR"/stage/package.json
cp "$REMOTE_DIR"/api-package-lock.json "$REMOTE_DIR"/stage/package-lock.json
env npm_config_cache="$HOME/.npm-cache-jw-api" npm ci --prefix "$REMOTE_DIR"/stage --omit=dev --no-audit --no-fund
# готовое дерево подменяется на место, когда установка уже прошла
sudo rsync -a --delete "$REMOTE_DIR"/stage/node_modules/ /opt/justwriting/api/node_modules/
sudo cp "$REMOTE_DIR"/stage/package.json "$REMOTE_DIR"/stage/package-lock.json /opt/justwriting/api/
sudo cp "$REMOTE_DIR"/server.mjs /opt/justwriting/api/server.mjs
sudo chown -R justwriting:justwriting /opt/justwriting/api/node_modules /opt/justwriting/api/package.json /opt/justwriting/api/package-lock.json /opt/justwriting/api/server.mjs
# перезапуск и проверка, что служба жива
sudo systemctl restart justwriting && sleep 5 && systemctl is-active --quiet justwriting
REMOTE
```

Smoke-проверки (как шаги «Проверка после выкатки», нужны соответствующие секреты):

```bash
npx tsx scripts/post-deploy-smoke.ts https://justwriting.ru/
npx tsx scripts/post-deploy-login.ts https://justwriting.ru/
```

Если проверка упала — откат руками: вернуть `index.html.prev`/`sw.js.prev` в
`/var/www/justwriting/` (и `chown www-data`), для службы —
`server.mjs.prev` в `server.mjs` и `sudo systemctl restart justwriting`.

## Внешняя проверка сайта (на ноутбуке)

`monitor/ru.justwriting.sitecheck.plist` — шаблон: launchd не раскрывает `~`, поэтому пути
подставляются при установке (чекаут — в `~/justwriting`):

```bash
sed "s#__HOME__#$HOME#g" deploy/monitor/ru.justwriting.sitecheck.plist > ~/Library/LaunchAgents/ru.justwriting.sitecheck.plist
launchctl load ~/Library/LaunchAgents/ru.justwriting.sitecheck.plist
```

## Сервер: защита

- Вход только по ключу, root запрещён; ufw — DROP всего, кроме 22/80/443.
- Автообновления безопасности (unattended-upgrades): таймер `apt-daily-upgrade.timer` активен, источники — только `-security` и ESM (без `-updates`: Docker и nginx обновляем руками при выкатке), `Automatic-Reboot` не задан (по умолчанию выкл., перезагружаем сами). Проверка: `sudo unattended-upgrade --dry-run -d`; журнал — `/var/log/unattended-upgrades/`. Сверено 2026-09-27.
- fail2ban (с 2026-09-27): jail sshd, режим aggressive — 3 неудачи за 10 мин → бан на 24 ч (`/etc/fail2ban/jail.local`). Проверка: `sudo fail2ban-client status sshd`.

## Rate Limiting & Auth Protection

1. **Nginx Layer (`deploy/nginx.conf`)**:
   - `/auth/`: strictly rate limited with `limit_req zone=auth_limit burst=5 nodelay` (5 req/min per IP) to prevent password brute-force and credential stuffing.
   - `/api/`: rate limited with `limit_req zone=api_limit burst=30 nodelay` (60 req/min per IP) with high burst to allow batch operations while preventing DoS and runaway AI spending.
   - `/rest/`: `limit_req zone=rest_limit burst=100 nodelay` (1000 req/min per IP — потолок по замеру пика прогонов индексации эмбеддингов, SA-3 в `nginx.conf`).
   - `/realtime/`: `limit_req zone=realtime_limit burst=5 nodelay` (10 req/min per IP — только рукопожатия websocket) плюс `limit_conn realtime_conn 10`.
   - `/storage/`: наружу не открыт — приложение не использует хранилище (0 бакетов).

2. **Supabase / GoTrue Layer (`/opt/justwriting/supabase/.env`)**:
   - `GOTRUE_DISABLE_SIGNUP=true` (registration closed, invites only)
   - `GOTRUE_RATE_LIMIT_EMAIL_SENT=30` (30 emails/hr)
   - `GOTRUE_RATE_LIMIT_VERIFY=30` (30 verifications/hr)
   - `GOTRUE_RATE_LIMIT_TOKEN_REFRESH=30` (30 refresh/hr)
   - `GOTRUE_RATE_LIMIT_HEADER=X-Real-IP` (enforces rate limits per client IP via nginx X-Real-IP, cannot be forged unlike client X-Forwarded-For)
   - *Note*: GoTrue rate limits protect email sending and token endpoint abuse, but do NOT protect against password brute-forcing; password brute-force protection is enforced by Nginx `limit_req` on `/auth/`.

3. **MFA (TOTP) for Admin**:
   - Supabase Auth natively supports TOTP MFA via `supabase.auth.mfa.enroll({ factorType: 'totp' })`. For admin accounts on single-user instances, MFA should be enrolled to protect elevated permissions.

4. **Registration Email Enumeration**:
   - Silent suppression of `email-already-in-use` requires an active transactional email delivery pipeline ("confirmation email sent" + notifying existing accounts out-of-band). This item is tracked and deferred until transactional email service (SMTP) is integrated.

5. **Cross-Browser Password Recovery (`token_hash`)**:
   - GoTrue fetches its mail templates by URL (`GOTRUE_MAILER_TEMPLATES_RECOVERY` → `https://justwriting.ru/email/recovery.html`), and that file ships with the client from `public/email/recovery.html`. Its link is `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`, not `{{ .ConfirmationURL }}`: the PKCE code in the default link only works in the browser that requested the reset, and on a phone the mail opens elsewhere. The page exchanges the hash itself via `supabase.auth.verifyOtp`.
   - No GoTrue restart is needed — deploying the client updates the template. `GOTRUE_MAILER_TEMPLATES_*` is a URL; inline HTML in that variable is not supported.

## Inviting a beta tester

Sign-up is off in the UI (`LoginPage.tsx`: `SIGNUP_ENABLED = false`). People get in by invitation only:

```bash
ssh justwriting 'sudo bash /opt/justwriting/deploy/invite.sh someone@example.com'
```

GoTrue creates the user and mails `public/email/invite.html` (subject and template URL in `deploy/supabase-compose.override.yml`). The link lands on `/reset-password?type=invite` with a `token_hash`, so it works from a phone's mail app. The tester sets a password and signs in; role is `user`, limits are the stranger's (`AI_DAILY_LIMIT`, reasoning 5).

`deploy/supabase-compose.override.yml` is copied by hand to `/opt/justwriting/supabase/docker-compose.override.yml`; after changing it, `cd /opt/justwriting/supabase && sudo docker compose up -d auth`.

## Registration & Signup Control

- **Single-User / Private Instance**: Once the primary admin account is registered, public signups can be disabled to prevent unauthorized account creation. In `/opt/justwriting/supabase/.env`, set `DISABLE_SIGNUP=true` (or `GOTRUE_DISABLE_SIGNUP=true` in `docker-compose.yml`), then reload Supabase containers (`docker compose up -d auth`).
- **Open / Multi-User Instance**: Keep signups enabled (`DISABLE_SIGNUP=false`). Protection against credential stuffing and brute-force registration is enforced by the Nginx `/auth/` rate limit (5 req/min per IP).

## Environment variables

Read by the API service (`api/`). Defaults are from the code.

| Name | Required | Description |
|------|----------|-------------|
| `PORT` | no | API listen port, default 3000; binds to `127.0.0.1` only |
| `SUPABASE_JWT_SECRET` | yes | JWT secret for verifying auth tokens |
| `SUPABASE_JWT_ISS` | yes (prod) | Must equal GoTrue's `GOTRUE_JWT_ISSUER`; the service refuses to start without it in production |
| `REQUIRE_JWT_ISSUER` | no | `true`/`false` forces the issuer check on/off; unset = on under `NODE_ENV=production` or with `DATABASE_URL` |
| `DATABASE_URL` | yes | Postgres connection string (via Supavisor, tenant-qualified user) |
| `SUPABASE_URL` | no | GoTrue admin API base for invites, default `https://justwriting.ru` |
| `SUPABASE_SERVICE_ROLE_KEY` | for invites | Service role key (`SERVICE_ROLE_KEY` also accepted) |
| `TELEMETRY_ID_PEPPER` | for telemetry | Secret salt for telemetry row keys; without it `sendTelemetry` fails |
| `OPENROUTER_API_KEY` | yes | AI provider key (RouterAI) |
| `AI_BASE_URL` | no | Provider base URL, default `https://routerai.ru/api/v1` |
| `AI_EMBED_BASE_URL` | no | Separate embeddings server (the local one); unset = embeddings go to `AI_BASE_URL` |
| `OPENROUTER_MODEL` | no | Chat model, default `deepseek/deepseek-v4-flash` |
| `OPENROUTER_EMBED_MODEL` | no | Embedding model, default `qwen/qwen3-embedding-8b`; changing it invalidates stored vectors |
| `AI_SUMMARY_MODEL`, `AI_FACET_MODEL` | no | Models for analysis / profile tasks, default `deepseek/deepseek-v4-flash` |
| `AI_PROVIDER_COUNTRY` | no | Provider routing restriction (`country`); unset = none |
| `AI_DAILY_LIMIT` | no | Per-user daily chat calls, default 30 |
| `AI_ADMIN_DAILY_LIMIT` | no | Same for `role = 'admin'`, default 60 |
| `AI_REASONING_DAILY_LIMIT` | no | Reasoning calls per user per day, default 5 |
| `AI_BULK_DAILY_LIMIT` | no | Background calls per user per day, default 50 |
| `AI_INTERNAL_CHAT_DAILY_LIMIT` | no | Internal chat-helper calls per user per day, default 60 |
| `AI_BULK_WINDOW_MS`, `AI_BULK_MAX_PER_WINDOW` | no | Sliding window per endpoint, default 20 calls per 60000 ms |
| `AI_TIER_RPD` | no | Global daily request cap (default 10,000) |
| `AI_TIER_TPD` | no | Global daily token cap (default 25,000,000) |
| `AI_DAILY_SPEND_LIMIT_RUB` | no | Daily spend ceiling in Rubles (e.g. 100); unset = token cap only |
| `AI_RUB_PER_1M_TOKENS` | no | Estimated price per 1M tokens in RUB (default 30) |
