# Security policy

This document has two jobs: to say how to report a vulnerability, and to
describe honestly what the application does and does not protect.

The second job is the harder one. In February 2026 a privacy assessment in this
repository stated that note text reached the AI provider "only on an explicit
user action". That was false for six months — a background timer was sending it.
The lesson is written down here because it governs how this file is maintained:
**a promise this document makes that the code does not keep is worse than no
document at all.** Every claim below was checked against the tree at `0.8.32`.

---

## Reporting a vulnerability

**Do not open a public issue.**

1. **Preferred — GitHub private vulnerability reporting.** Use the *Report a
   vulnerability* button under the repository's Security tab.
   *Maintainer note: this must be switched on in Settings → Code security before
   the first outside tester is invited; it is not on by default.*
2. **Fallback — email.** `security@justwriting.ru`.
   *Maintainer note: this alias does not exist yet and must be created, or this
   line replaced with an address that does.*

What helps: the version (shown in the sidebar), what you did, what you expected,
what happened. A proof of concept is welcome but never required.

**Please do not** run automated scanners against `justwriting.ru`, attempt
denial of service, or access data belonging to anyone but yourself. The service
runs on a single small VPS with one real user; load testing it is
indistinguishable from an attack.

**What to expect.** A single maintainer, so: acknowledgement within 72 hours, an
assessment within a week, and a fix timeline stated honestly rather than
optimistically. Reporters are credited in the changelog unless they prefer not
to be. There is no bounty programme.

---

## Scope

**In scope:** the client at `justwriting.ru`, the API service (`api/`), the
Supabase deployment and its row-level security policies, the deploy pipeline.

**Out of scope:** the AI provider's infrastructure; findings that require a
compromised device or a malicious browser extension (an extension in the origin
can already do anything the app can); social engineering; missing headers with
no demonstrated impact.

---

## The four postulates

Statements the design answers to. When a change conflicts with one of them, the
change is wrong — not the postulate.

1. **What a person writes locally is never lost**, except when they choose to
   delete it. A failed read, a half-finished write, a locked vault or a parse
   error must never be rendered as absence of data, and must never be written
   back as truth. This is the recurring bug class here; every fix for it carries
   a regression test.
2. **Nothing leaves for the cloud unencrypted.** Notes, titles, tags, labels,
   analyses, vectors, dialogues, the portrait — everything the person wrote or
   that was concluded about them is encrypted with a key derived on their
   device. A new field that syncs is encrypted before it syncs, not after
   someone notices.
3. **AI is the one disclosed exception.** Analysis requires sending text to the
   provider in the clear; there is no way around that today. The person is told
   so plainly, decides for themselves, and loses no other functionality by
   declining.
4. **Saved, encrypted, synchronised, nothing leaked** — apart from what the
   person deliberately sent for analysis.

---

## Encryption

Client-side, AES-256-GCM, with an envelope so the password can change without
re-encrypting the archive.

1. Password → PBKDF2, **600 000 iterations**, SHA-256 → master key (AES-KW,
   `extractable: false`). Vaults created before the raise are unwrapped with the
   legacy 300 000 and re-wrapped.
2. A random per-user data key (AES-256-GCM).
3. The data key is wrapped with the master key and stored server-side; the
   server never sees it unwrapped.
4. Content is encrypted with the data key, a fresh 12-byte CSPRNG IV each time.
5. A verification plaintext detects a wrong password without touching real data.
6. The session key lives in memory only, and is cleared after 15 minutes of
   inactivity or on tab visibility change. `secureClear` zeroes sensitive byte
   arrays; `CryptoKey` objects cannot be zeroed from JavaScript and are released
   to garbage collection — a platform limitation, stated rather than hidden.
7. A wrong password returns `false`. Encryption is never silently enabled
   without a valid data key.
8. **"Remember on device"** caches non-extractable keys in IndexedDB. They
   cannot be read by script, but any script running in this origin can ask the
   browser to decrypt with them. Anyone opting in is shown this trade-off.

---

## What is encrypted, and what is not

Encryption covers content. Some metadata stays readable in the database — a
deliberate trade-off, because without it synchronisation, quotas and
deduplication do not work.

| Field | Table | Why it is readable |
| :--- | :--- | :--- |
| `uuid`, `id`, `document_id`, `document_uuid`, `user_id`, `uid` | all tables | row keys, foreign keys, RLS scoping |
| `first_session_at`, `last_session_at`, `sessions_count`, `created_at`, `saved_at`, `session_started_at`, `updated_at` | documents, versions, users, drafts, ai_* | ordering, relations, timestamps |
| `word_count`, `duration`, `wpm`, `words_added`, `chars_added`, `total_words`, `total_duration`, `total_word_count`, `streak_days`, `avg_wpm`, `avg_session_words` | documents, versions, users | progress and aggregate statistics; server-side aggregates are impossible over ciphertext |
| `goal_words`, `goal_time`, `goal_reached` | versions | goal achievement tracking |
| `earned_achievements`, `achievements_reset_at` | users | gamification identifiers and reset timestamp |
| `is_public`, `label_id`, `excluded_from_ai`, `deleted_at` | documents, drafts | document share status, label relation, AI exclusion flag, tombstones |
| `email`, `nickname`, `role` | users | auth identity, profile handle, server permissions |
| `encryption_salt`, `encrypted_data_key`, `encryption_meta` | users | cryptographic envelope stored server-side |
| `privacy_accepted_at`, `privacy_version`, `ai_consent_at`, `ai_consent_version`, `indexing_consent_at`, `indexing_consent_version` | users | legal consent stamps |
| `seconds`, `initial_word_count`, `active_session_id`, `session_start_time`, `accumulated_duration`, `total_pause_seconds`, `saved_document_id` | drafts | draft session counters and linkage |
| `valence`, `arousal` | ai_summaries | sentiment statistics |
| `content_hash`, `prompt_version` | ai_summaries | freshness checks and prompt versioning |
| `dim`, `processed_at` | ai_embeddings | model-compatibility check and the freshness filter |
| `schema_v`, `_encrypted`, `version` | all tables | migrations and read branching |
| `current_version`, `total_words` | documents | conflict detection and reconciliation |
| row sizes | physical layer | Postgres does not hide lengths |

**Not disclosed:** note text, titles, tags, and the contents of vectors —
`vectorsJson`, `chunkTexts`, `model` and `contentHash` are all encrypted.

**Disclosed indirectly:** activity by day, from timestamps, and archive volume,
from word counts. A statistical profile over ciphertext.

**The boundary encryption does not close:** with AI features on, note text
reaches the provider in the clear. Consent wording is required to say this
outright.

---

## Isolation and access control

Postgres row-level security is the enforcement point; the client is not trusted.

- Every per-user table carries `user_id` and a policy requiring
  `user_id = auth.uid()` for select, insert, update and delete.
- Derived AI tables carry a second condition — the row must belong to a note the
  same user owns:
  `exists (select 1 from documents d where d.uuid = document_id and d.user_id = auth.uid())`.
  This is why derived rows are keyed by the note's permanent uuid and not by its
  local id; sending the local id produces a silent zero-row result, which has
  been the cause of three separate defects.
- Roles live in `users.role`. Admin is assigned by hand in the database; the
  client cannot write the field.
- Account deletion removes `local_store_records` explicitly, then the `users`
  row — which cascades to documents, versions, drafts, summaries and vectors —
  then the auth record. Since `0.8.32` it also wipes the device.

---

## API service hardening

Every AI endpoint enforces, in this order:

- **Authentication** — a Supabase JWT, verified before anything else.
- **Consent** — AI consent for analysis and chat, indexing consent for vectors.
  Refusal is a 403 with a distinct code, not a generic error.
- **Schema validation** — Zod on every endpoint; content is capped at 50 000
  characters.
- **Prompt-injection screening** — a shared list of 21 patterns, Latin and
  Cyrillic, in `src/shared/ai/injectionPatterns.ts`, applied to custom system
  prompts and user messages. Invisible characters are normalised first, so a
  guard phrase cannot be broken up with zero-width joiners.
- **Input sanitisation** — special token markers (`<|system|>`, `<|im_start|>`,
  `[INST]`, `<developer>`, …) are stripped.
- **Output sanitisation** — DOMPurify over model output. The client's markdown
  renderer must never gain `rehype-raw`: it would re-enable XSS from streamed
  output. Only `rehype-sanitize` is used, and the constraint is repeated in the
  component source.
- **Rate limiting**, in three independent layers:
  - a per-user daily limit for interactive calls (default 30; administrators 60);
  - a per-user daily limit for background calls (default 50) plus a sliding
    window per endpoint (default 20 per minute), so a batch cannot drain a day
    in one burst;
  - a deployment-wide daily ceiling on requests and tokens, with an optional
    hard spend limit in roubles.
  Quota is refunded when a request fails or the client disconnects before an
  answer arrives — tokens the provider actually produced are paid for and never
  refunded.
- **Edge rate limiting** — nginx limits requests per IP independently of all of
  the above.

Note-derived text is fenced inside the prompt with explicit markers stating that
the content is data and never instructions.

---

## Transport and headers

Served by nginx over TLS: HSTS with preload, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, a Permissions-Policy disabling camera,
microphone and geolocation, COOP/CORP, `frame-ancestors: none`,
`object-src: none`, and a Content-Security-Policy. CSP violations are reported to
the API service, which rate-limits reports per origin.

`vercel.json` still exists in the repository and is **not** the source of these
headers; it is a leftover from the previous hosting.

---

## Analytics and error reporting

- **PostHog** — opt-in only. Every tracking call checks consent first;
  `person_profiles: 'identified_only'`.
- **Sentry and the in-app activity log** — `maskAllText`, `blockAllMedia`, the
  user identified by uid alone. `reportError` strips personal keys before
  anything is stored: identifiers (`userId`, `uid`, `email`, `documentId`,
  `docId`, `localId`, `versionId`, `sessionId`, `personaId`, `labelId`,
  `noteId`, `threadId`, …) and anything the person wrote (`title`, `content`,
  `text`, `summary`, `tag`, `theme`, `label`, `name`, `query`, `snippet`,
  `prompt`, `answer`, `message`). Redaction matches exact key names, so the list
  deliberately covers families — `docId` beside `documentId` is the same thing
  under another name.
- **Langfuse** — AI request observability: tokens, model, usage. No note content
  and no model output.

---

## Known open weaknesses

Listed because a security document that hides them is worth less than none.
Details and fix plans are in `docs/ag-audit-2026-09-03-tickets.md`.

| | Weakness | Consequence |
| :--- | :--- | :--- |
| `AG-ISO-1` | AI stores in IndexedDB carry no account. `aiPortrait` is a single row under the key `'singleton'`. | On a shared device, if the first account signs out without choosing to erase, the second account can read the first one's portrait, chat memory and beliefs — and an upload will write them into the second account's cloud data. |
| `AG-ISO-2` | Five retrieval paths read every document on the device with no owner filter. | Search results and chat context can include another owner's notes. |
| `AG-DEL-3` | Two code paths react to a cloud tombstone; one of them does not mark the note local-only. | A note deleted on one device can be re-uploaded from another and reappear. Unverified — see the ticket. |
| `AG-ENC-1` | `versions.mood` is transmitted unencrypted during session save (`CloudSyncService.ts:838, 858`). | When vault is enabled, `documents.mood` is encrypted, but `versions.mood` is written in plaintext to Postgres with `_encrypted: true`. Personal emotional state leaks in the cloud database. |
| `AG-RESTORE-2` | Bulk reads are unpaginated and stop at the server's row cap without an error. | On a large archive a restore can be silently incomplete. |

The default on sign-out is to **keep** local data; erasing is a choice offered in
the dialogue ("this is someone else's computer"). That is a deliberate product
decision, not a defect — but it is the precondition that makes `AG-ISO-1`
reachable, so it is named here rather than left implicit.

---

## Documented trade-offs

- **The session draft is stored in IndexedDB as plaintext even for vault users.**
  A draft is an autosave of working state rather than a stored note: it is
  overwritten when the session ends and removed on sign-out with erasure. The
  `localStorage` copy is suppressed while encryption is on. If the threat model
  tightens, encrypting it with the same helper is described in
  `docs/audit-cleanup-plan.md` §3.10.
- **A stream that falls back mid-generation charges two slots.** The remaining
  case after refund-on-disconnect: the connection drops mid-stream and both
  attempts really did generate. Charging after the first upstream byte was
  rejected — it moves billing into the middle of a request and splits an atomic
  claim.
