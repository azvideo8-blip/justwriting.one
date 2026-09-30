# justwriting

A quiet writing app: a timer, a blank page, and an archive that remembers. An
optional AI layer reads what you wrote and talks to you about it.

Live at **https://justwriting.ru**. Private repository, one maintainer, one
production user. A closed beta for 10–20 invited people is being prepared.

---

## Status

| | |
| :--- | :--- |
| Version | `0.9.24` (`src/version.ts` is what the UI shows) |
| Hosting | single VPS in Russia — nginx, systemd, Docker |
| Database | self-hosted Supabase (Postgres + GoTrue + PostgREST + Kong) |
| AI provider | RouterAI, OpenAI-compatible API |
| Client | React 19 · TypeScript · Vite · Tailwind v4 · Zustand |
| Tests | Vitest (`npm run test:ci`), SQL RLS tests, Playwright e2e |
| Node | 22 (CI and the API service) |

There is no Firebase, no Firestore, no Cloud Functions and no Vercel: that stack
was replaced in August 2026. The live headers come from nginx
(`deploy/nginx.conf`).

---

## How the data is arranged

**Local first.** Everything is written to IndexedDB on the device before it is
written anywhere else. The app is fully usable with no account and no network:
notes, versions, archive, statistics and export all work offline.

**The cloud is a second copy.** With an account, notes and their versions sync to
Postgres, protected by row-level security keyed on `auth.uid()`. Derived AI data
(analyses, vectors, dialogues, memory, the portrait) syncs too, through a
separate explicit action.

**Encryption is client-side.** With the vault enabled, note content, titles,
tags, analyses, vectors and the portrait are encrypted on the device before
upload. The server never has the key. What stays readable in the database — row
ids, timestamps, word counts — and why, is listed field by field in
[SECURITY.md](SECURITY.md#what-is-encrypted-and-what-is-not).

### Where each kind of data lives

| Data | Device | Cloud |
| :--- | :--- | :--- |
| Notes, versions, drafts | IndexedDB | `documents`, `versions`, `drafts` |
| Per-note analyses | `aiSummaries` | `ai_summaries` |
| Search vectors | `aiEmbeddings` | `ai_embeddings` |
| Dialogues, chat memory, themes, beliefs, timeline, life story, portrait, facets, commitments, threads, personas | 13 IndexedDB stores | `local_store_records` |
| Injection journal, belief rejections, domain vectors | IndexedDB only | — (diagnostics and recomputable data, deliberately local) |

---

## The AI layer, and what leaves the device

This is the part worth reading carefully, because it is the only place where
text leaves the machine in the clear — to a third party, at least. Search
vectors are the one exception: since September 2026 they are computed on this
same VPS, not sent anywhere.

Nothing is sent to the AI provider without consent, and consent is split in two:

- **AI consent** — analysis, chat, editing. Without it every AI endpoint refuses.
- **Indexing consent** — computing search vectors. Kept separate for history's
  sake (indexing used to run without a button press, and used to leave the
  device) even though indexing no longer reaches a third party at all.

With consent given, text reaches the (third-party) AI provider when:

| Action | What is sent | Started by |
| :--- | :--- | :--- |
| Analyse a note | the note's full text | a button, per note or per archive |
| Chat | your message, the persona, the portrait, retrieved note fragments | you, per message |
| Semantic search | your query, then note cards for reranking | a search inside chat |

Text reaches the provider on an explicit action: the timer that used to
summarise notes by itself was removed in August 2026. Writing and saving a note
send nothing.

**Search vectors are computed locally, not by the AI provider.** A small
embedding server (`BAAI/bge-m3`, via Hugging Face's Text Embeddings Inference)
runs on the VPS itself, reachable only from `api/` on `127.0.0.1` — the note
text a vector is computed from never leaves the machine. `AI_EMBED_BASE_URL`
points the server at it; if that variable is ever unset, embeddings silently
fall back to the same third-party provider chat uses, as a rollback path, not
a decision that got reverted.

There used to be one narrow exception: a listener on `doc-version-saved` in
`useAIPageData` called `indexDocument`, so a version saved while the AI page was
open — a conflict fork from a background sync, in practice — could index without
a press. It was removed in September 2026. Today the only callers of
`indexDocument` are the analyse button and the one-time indexing pass.

Models are configurable by environment variable. Chat defaults to
`deepseek/deepseek-v4-flash` (`OPENROUTER_MODEL`, RouterAI). The embedding
model is whatever `OPENROUTER_EMBED_MODEL` names; the code default is
`qwen/qwen3-embedding-8b` (4096 dimensions), the model used before the
September 2026 move to local compute. The local server runs `BAAI/bge-m3`
(1024 dimensions).

**The portrait is injected into every chat turn.** It is a psychological
summary built from your analyses, and it is part of the system prompt on every
message, not a page you visit. See `docs/protocols-2026-09-02.md` for the
measurement protocol that will decide whether it stays.

---

## Development

**Prerequisites:** Node 22+.

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` for the client:

```env
VITE_SUPABASE_URL=https://<your-supabase-host>
VITE_SUPABASE_ANON_KEY=...
VITE_SITE_URL=https://justwriting.ru   # optional
```

A build without `VITE_SUPABASE_*` produces a client that loads and then fails
every request. This has happened in production: a green deploy and a dead app
look identical if only the server is checked. The post-deploy smoke check exists
because of it.

> **Important:** E2E tests (`npx playwright test`) and prerender (`npm run build`)
> require `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (any values, even dummy
> ones like `VITE_SUPABASE_URL=http://localhost:54321` and `VITE_SUPABASE_ANON_KEY=dummy`).
> Without them, client initialization throws immediately on startup and 19 of 22 E2E
> tests fail.

In dev, Vite proxies `/api` to `http://127.0.0.1:3111` (`VITE_DEV_API_TARGET`
overrides it). Running the API and a local backend: see
[INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md).

### Scripts

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # full lint; needs NODE_OPTIONS=--max-old-space-size=8192
npm run lint:changed # only files changed against origin/main
npm run test:ci      # vitest run --coverage
npm run ci           # typecheck + lint + tests
npm run build        # vite build + prerender
npm run i18n:audit   # translation keys + hardcoded Cyrillic in the UI
npm run postulates   # verify the 4 postulates + database plaintext sweep
```

### Gates that run in CI

- `typecheck`, `lint`, the full test suite;
- `npm run postulates` — verifies the four postulates across the lifecycle fault matrix;
- `scripts/prod-audit.mjs` — blocks on any production dependency advisory of
  moderate severity or above, for both shipped sets: the client bundle at the repo
  root and the API service in `deploy/api`;
- `scripts/cross-feature-check.sh` — a ratchet on cross-feature imports, at 0;
- `scripts/raw-overlay-check.sh` — a ratchet on raw overlay usage;
- `scripts/knip-check.mjs` — a ratchet on dead code (`knip`), against
  `scripts/knip-baseline.txt`; it also blocks `unresolved` and `unlisted`
  imports, which are not baselinable at all (a clean `npm ci` breaks on them);
- `npm run i18n:audit` — missing, unused and half-translated keys, plus Cyrillic
  that reaches the UI without going through `t()`: JSX text and attributes, and
  since C-4 non-JSX sinks too — `showToast`/`confirm`/`alert`, `setError`-style
  setters, `addActivity` and object fields like `currentStage`/`message`/`label`,
  in `.ts` as well as `.tsx`. Log calls and prompt text are not sinks. The
  existing hits sit in `scripts/i18n-baseline.txt`, keyed by
  `file:sink:text`, so moving a string into `t()` crosses its line off;
- bundle size ceilings on the index chunk, raw and gzipped;
- Supabase RLS tests.

Ratchets have baselines that only go down. If a change raises one, the fix is
the change, not the baseline. `knip-check.mjs --update` therefore refuses to
write a baseline with a key that was not there before (exit 1); a deliberate,
ticketed increase needs `--update --grow`, which prints the keys it added.
`i18n-audit` works the same way with `--update-baseline` / `--grow-baseline`.

The raw index-chunk ceiling went 700000 → 750000 → 760000 in a week, and the
note left at the third raise said the next step was to move the Supabase client
out of the main chunk rather than raise the number a fourth time. That is what
happened: `vendor-supabase` is its own chunk, the index chunk dropped from
777559 to 560871 and its gzip from 224432 to 167883, and both ceilings came
down with it.

---

## Layout

```
src/core/        storage, crypto, sync, data providers, auth — knows no features
src/features/    admin, ai, archive, auth, encryption, navigation, profile, settings, writing
src/shared/      i18n, components, utilities shared by everything
src/app/         pages and composition — where features are allowed to meet
api/             the Node service: AI endpoints, limits, CSP reports
supabase/        migrations and the migration runner
scripts/         gates, the post-deploy smoke check, one-off tools
docs/            tickets, audit reports, measurement protocols
```

`core` must not import from `features`. This is enforced by
`import/no-restricted-paths` and by the cross-feature ratchet.

---

## Deploy

Deployment is a manual GitHub Actions run — `Выкатка на сервер`, with
`what = client | api | both`. It builds, uploads, restarts the service, and then
runs `scripts/post-deploy-smoke.ts`, which checks that the site answers, that
the expected version is live, that an unauthenticated AI call is refused, and
that an aborted chat stream refunds its quota slot. On failure it rolls back.

Releasing means bumping the version in **four** places — `package.json`,
`package-lock.json`, `public/sw.js` (`CACHE_VERSION`, which evicts stale caches)
and `src/version.ts` (what the UI shows) — plus both changelogs: `CHANGELOG.md`
and the in-app `src/features/navigation/data/changelog.ts`.

---

## Known gaps

Open findings live in `docs/ag-audit-2026-09-03-tickets.md` and `docs/beta-postulate-closeout-tickets.md`.
The isolation weaknesses that previously blocked the closed beta (`AG-ISO-1` and `AG-ISO-2`) were
resolved in commit `2710c0d0` by scoping local IndexedDB databases strictly per authenticated account.

The honest residual limit:
- **Two guests on one device share a database** (`BETA-7`). Two people using the app without signing in
  on the same device share `justwriting-local`. Partitioning without accounts relies on separate browser profiles
  or private browsing.
