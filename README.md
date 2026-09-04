# justwriting

A quiet writing app: a timer, a blank page, and an archive that remembers. An
optional AI layer reads what you wrote and talks to you about it.

Live at **https://justwriting.ru**. Private repository, one maintainer, one
production user. A closed beta for 10–20 invited people is being prepared.

---

## Status

| | |
| :--- | :--- |
| Version | `0.8.36` (`src/version.ts` is what the UI shows) |
| Hosting | single VPS in Russia — nginx, systemd, Docker |
| Database | self-hosted Supabase (Postgres + GoTrue + PostgREST + Kong) |
| AI provider | RouterAI, OpenAI-compatible API |
| Client | React 19 · TypeScript · Vite · Tailwind v4 · Zustand |
| Tests | Vitest — 274 files, 1672 tests |
| Node | 22 (CI and the API service) |

There is no Firebase, no Firestore and no Cloud Functions: that stack was
replaced in August 2026. `vercel.json` is a leftover from the same era and no
longer governs anything — the live headers come from nginx.

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
text leaves the machine in the clear.

Nothing is sent to the AI provider without consent, and consent is split in two:

- **AI consent** — analysis, chat, editing. Without it every AI endpoint refuses.
- **Indexing consent** — computing search vectors. Separate because indexing is
  the one path that used to run without a button press.

With consent given, text reaches the provider when:

| Action | What is sent | Started by |
| :--- | :--- | :--- |
| Analyse a note | the note's full text | a button, per note or per archive |
| Chat | your message, the persona, the portrait, retrieved note fragments | you, per message |
| Semantic search | your query, then note cards for reranking | a search inside chat |
| Compute vectors | the note's text, in chunks | analysing a note; the one-time pass when indexing consent is granted |

Text reaches the provider on an explicit action: the timer that used to
summarise notes by itself was removed in August 2026. Writing and saving a note
send nothing.

There used to be one narrow exception: a listener on `doc-version-saved` in
`useAIPageData` called `indexDocument`, so a version saved while the AI page was
open — a conflict fork from a background sync, in practice — could index without
a press. It was removed in September 2026. Today the only callers of
`indexDocument` are the analyse button and the one-time indexing pass.

Models are configurable by environment variable; the defaults are
`deepseek/deepseek-v4-flash` for chat and `qwen/qwen3-embedding-8b` at 4096
dimensions for vectors.

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
VITE_SENTRY_DSN=...                    # optional — error reporting
VITE_POSTHOG_KEY=...                   # optional — analytics, consent-gated
VITE_POSTHOG_HOST=...                  # optional
```

A build without `VITE_SUPABASE_*` produces a client that loads and then fails
every request. This has happened in production: a green deploy and a dead app
look identical if only the server is checked. The post-deploy smoke check exists
because of it.

### Scripts

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # full lint; needs NODE_OPTIONS=--max-old-space-size=8192
npm run lint:changed # only files changed against origin/main
npm run test:ci      # vitest run --coverage
npm run ci           # typecheck + lint + tests
npm run build        # vite build + prerender
npm run i18n:audit   # missing / unused / incomplete translation keys
```

### Gates that run in CI

- `typecheck`, `lint`, the full test suite;
- `scripts/prod-audit.mjs` — blocks on any production dependency advisory of
  moderate severity or above;
- `scripts/cross-feature-check.sh` — a ratchet on cross-feature imports, at 0;
- `scripts/raw-overlay-check.sh` — a ratchet on raw overlay usage;
- bundle size ceilings on the index chunk, raw and gzipped;
- Supabase RLS tests.

Ratchets have baselines that only go down. If a change raises one, the fix is
the change, not the baseline.

---

## Layout

```
src/core/        storage, crypto, sync, data providers, auth — knows no features
src/features/    ai, archive, auth, navigation, profile, settings, writing
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

Open findings live in `docs/ag-audit-2026-09-03-tickets.md`, each with a status
saying whether I verified it myself or only checked that the mechanism exists.
The two that block the closed beta:

- **AI stores are not partitioned by account** (`AG-ISO-1`). On a shared device,
  a second account can read the first one's portrait and chat memory.
- **Search reads every document on the device** (`AG-ISO-2`), including notes
  belonging to another owner.

One cosmetic mismatch worth knowing: `index.html` still declares
`https://justwriting.one/` as the canonical URL, and that domain does not
resolve. Left alone deliberately — changing a canonical URL is an SEO decision,
not a cleanup.
