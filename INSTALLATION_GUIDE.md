# Установка justwriting

Из чего состоит:

- **клиент** — React + Vite, PWA; всё пишется сначала в IndexedDB на устройстве;
- **Supabase, развёрнутый у себя** — Postgres, GoTrue (вход), PostgREST, Kong
  перед ними, Supavisor (пул подключений) — в Docker;
- **служба `api/`** — небольшой Node-сервер: ИИ-эндпоинты, лимиты, согласия,
  удаление аккаунта, приём CSP-отчётов.

Firebase, Vercel и Gemini из проекта удалены; инструкции про них больше не
действуют.

Нужно: Node 22 (на нём CI и служба), Docker; для миграций — `psql` или
`docker compose`.

---

## 1. Клиент

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local`:

```env
VITE_SUPABASE_URL=<адрес Kong из сборки Supabase>
VITE_SUPABASE_ANON_KEY=<ANON_KEY из .env Supabase>
VITE_SITE_URL=https://justwriting.ru   # необязательно
```

Без `VITE_SUPABASE_*` клиент загрузится, но любое обращение к облаку упадёт с
«Supabase is not configured».

## 2. Supabase

Docker-сборки Supabase в репозитории нет: берётся официальная self-hosted
сборка Supabase (на сервере она лежит в `/opt/justwriting/supabase`). Из
репозитория к ней относятся:

- `deploy/supabase-compose.override.yml` — порты только на `127.0.0.1` и
  русские письма GoTrue (кладётся рядом как `docker-compose.override.yml`);
- `supabase/migrations/` — схема и RLS. Применить:

  ```bash
  DATABASE_URL=postgres://... bash supabase/scripts/migrate.sh
  bash supabase/scripts/migrate.sh --status
  ```

Проверка RLS на голом Postgres — `supabase/README.md`.

## 3. Служба `api/`

Служба не читает `.env` сама — переменные задаются окружением. Слушает только
`127.0.0.1`, порт из `PORT` (по умолчанию 3000, но его занимает Vite).
Dev-прокси Vite ведёт `/api` на `127.0.0.1:3111`, поэтому локально:

```bash
PORT=3111 \
DATABASE_URL=postgres://... \
SUPABASE_JWT_SECRET=<JWT_SECRET из .env Supabase> \
SUPABASE_JWT_ISS=<GOTRUE_JWT_ISSUER контейнера auth> \
OPENROUTER_API_KEY=<ключ RouterAI> \
npx tsx api/server.ts
```

С заданным `DATABASE_URL` служба без `SUPABASE_JWT_ISS` не стартует
(`api/auth.ts`). Полный список переменных с пояснениями —
`deploy/.env.example`.
`curl http://127.0.0.1:3111/ready` показывает, доступна ли база и куда уходят
эмбеддинги.

## 4. Сервер

Выкатка на VPS (nginx, systemd, сборка службы через esbuild) — в
`deploy/README.md`.
