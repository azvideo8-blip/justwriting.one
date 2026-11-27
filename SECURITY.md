# Security policy

This document has two jobs: to say how to report a vulnerability, and to
describe honestly what the application does and does not protect.

The second job is the harder one. In February 2026 a privacy assessment in this
repository stated that note text reached the AI provider "only on an explicit
user action". That was false for six months — a background timer was sending it.
The lesson is written down here because it governs how this file is maintained:
**a promise this document makes that the code does not keep is worse than no
document at all.** The whole file was last checked against the tree at
`0.8.32`; on 27 November 2026, when the repository was public, the reporting
section, the encryption numbers, the AI paths, rate limits and input caps were
re-checked against `0.11.28`.

---

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub private vulnerability reporting: the *Report a vulnerability*
button under the repository's Security tab. Only the maintainer sees the
report.

What helps: the version (shown in the sidebar), what you did, what you expected,
what happened. A proof of concept is welcome but never required.

**Please do not** run automated scanners against `justwriting.ru`, attempt
denial of service, or access data belonging to anyone but yourself. The service
runs on a single small VPS; load testing it is
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

You can verify that these hold by running `npm run postulates`. It executes the
fault-injection matrix across all lifecycle sequences under both vault states,
and runs the plaintext sweep against the database when `DATABASE_URL` is set.

---

## What reaches the AI provider, and what never does

The postulates above say AI is the one disclosed exception. In practice:

- **Only on an action by the person** — a button, a chat message, dictation
  with AI consent. No timer or background job sends note text; a new automatic
  call needs the maintainer's explicit decision.
- **Notes hidden from AI never reach the model** — a note marked "hidden from
  AI" or in the trash is excluded from analysis, chat, search, the portrait,
  quotes, suggestions and dictation. A failed read counts as hidden.
  `src/test/aiCallVisibilityGate.test.ts` fails the build when a model call
  appears without that check; `src/test/aiStoreVisibilityGate.test.ts` does the
  same for reads of derived AI data.
- **Chat search draws only on analysed notes**; a note's full text goes to the
  model only when the person attaches it to a message.
- **Search vectors are computed on the same server**, not by the provider.
- **Voice input is the browser's.** Dictation uses the browser's speech
  recognition (Web Speech API): the app never receives audio, but the browser
  may process it on its vendor's servers (Chrome does). Only the recognised
  text reaches the app, and with AI consent a fragment of it goes to the
  provider for punctuation.

---

## Repository and pipeline

- Third-party GitHub Actions are pinned to a commit SHA, not a tag.
- Secrets: every push is scanned with gitleaks over the pushed range, and the
  full history is scanned daily.
- Production dependency advisories of moderate severity or above block CI.
- Deployment is a manual run; after it a smoke check verifies the live version, that
  the page loads without script errors and that an unauthenticated AI call is
  refused, and rolls back on failure.

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
   inactivity (1 hour if "Remember on device" is checked), re-checked on tab
   visibility change, and locked on page unload. `secureClear` zeroes sensitive byte
   arrays; `CryptoKey` objects cannot be zeroed from JavaScript and are released
   to garbage collection — a platform limitation, stated rather than hidden.
7. A wrong password returns `false`. Encryption is never silently enabled
   without a valid data key.
8. **"Remember on device"** caches non-extractable keys in IndexedDB. They
   cannot be read by script, but any script running in this origin can ask the
   browser to decrypt with them. Anyone opting in is shown this trade-off.
9. **One password, and the server never sees it** (0.9.0). The account password
   also unlocks the vault, so GoTrue receives only
   `hex(PBKDF2-SHA256(password, "justwriting-auth|" + lower(trim(email)), 600 000))`
   (`src/core/auth/authSecret.ts`). The vault salt is random per user, so this
   value cannot unwrap the data key. Accounts created before 0.9.0 still have
   the raw password on GoTrue: the first sign-in tries the derived value, falls
   back to the raw one and replaces it with the derived value. Remove that
   fallback once every account has signed in.
10. Without a vault a signed-in account sends no content to the cloud
    (`maybeEncrypt` throws `ENCRYPT_REQUIRED`). After an e-mail password reset
    the vault stays on the old password until one manual unlock with it, which
    re-wraps the vault with the new login password.

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
- **Schema validation** — Zod on every endpoint; every text field has a length
  cap (note text: 50 000 characters).
- **Prompt-injection screening** — one shared list of patterns, Latin and
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
strict-origin-when-cross-origin`, a Permissions-Policy disabling camera and
geolocation and limiting the microphone to the site itself (voice input),
COOP/CORP, `frame-ancestors: none`,
`object-src: none`, and a Content-Security-Policy. CSP violations are reported to
the API service, which rate-limits reports per client IP and logs the
reported URLs without their query string.

---

## Analytics and error reporting

There is no third-party analytics, error-reporting or AI-observability service.

- **Errors** go to the in-app activity log on the device (`localStorage`, the
  last 50 entries), and nowhere else unless the person copies the log.
  `reportError` strips personal keys before anything is stored
  (`src/shared/errors/piiScrub.ts`, one list shared with the activity log):
  identifiers (`userId`, `uid`, `email`, `documentId`, `docId`, `localId`,
  `versionId`, `sessionId`, `personaId`, `labelId`, `noteId`, `threadId`, …)
  and anything the person wrote (`title`, `content`, `text`, `summary`, `tag`,
  `theme`, `label`, `name`, `query`, `snippet`, `prompt`, `answer`,
  `message`). Redaction matches exact key names, so the list deliberately
  covers families — `docId` beside `documentId` is the same thing under another
  name. Message text is also scrubbed by shape: uuids, email addresses and long
  base64 runs.
- **No telemetry** — the usage counters this document used to describe (theme,
  note-count bucket, average note length, reasoning share) were removed on
  2026-10-01 for data minimisation: no `sendTelemetry` endpoint, and migration
  `0036_drop_telemetry.sql` drops `anonymized_telemetry` and
  `telemetry_cooldown`. Nothing about a person's usage leaves the device except
  the notes they explicitly send to an AI endpoint.

---

## Known open weaknesses

Listed because a security document that hides them is worth less than none.
Audit reports and fix plans are kept in the maintainer's private notes; what
matters to a user is summarised here.

| | Weakness | Consequence |
| :--- | :--- | :--- |
| `BETA-7` | Two guests on one device share a database (`justwriting-local`). | Two people who both use the app without signing in, on the same browser profile and device, share one IndexedDB database (`justwriting-local`) — notes, AI stores, and everything else. Without an account identity to partition by, isolation cannot be enforced; using separate browser profiles or private browsing is required on shared hardware. |

The default on sign-out is to **keep** local data; erasing is a choice offered in
the dialogue ("this is someone else's computer"). That is a deliberate product
decision, not a defect. For guest users who have no account, clearing browser storage
or using private browsing is the only way to partition data on a shared computer.

---

## Closed weaknesses (Audit history)

Weaknesses identified in previous security audits that have been resolved and verified:

| | Weakness | Resolution & Commit |
| :--- | :--- | :--- |
| `AG-ISO-1` | AI stores in IndexedDB carried no account (`aiPortrait` singleton). | Closed in `2710c0d0` (2026-09-03). IndexedDB is strictly partitioned per account (`justwriting-local-<uid>`), and AI stores reside within the user's isolated database. |
| `AG-ISO-2` | Retrieval paths read every document on the device with no owner filter. | Closed in `2710c0d0` (2026-09-03). `getMiniSearch` and retrieval open the owner's database (`getLocalDb(effectiveOwner)`). Notes from other accounts are not reachable. |
| `AG-DEL-3` | Cloud tombstone reaction did not mark note local-only in all paths. | Closed in `2710c0d0` (2026-09-03). Both tombstone reaction paths call `LocalDocumentService.unlinkFromCloud(id, 'tombstone')`, setting `localOnly: true` and `unlinkedByTombstone: true`. Verified by `tombstoneNoResurrect.test.ts`. |
| `AG-RESTORE-2` | Bulk reads were unpaginated and stopped at 1000 rows. | Closed in `2710c0d0` (2026-09-03). All bulk reads across documents, versions, summaries, embeddings, and local store records paginate with `PAGE_SIZE = 1000` and range queries. |
| `AG-ENC-1` | `versions.mood` synced in plaintext. | Closed in `5fe48bd8` & `228ac4d2` (0.8.37). `versions.mood` is encrypted with the vault key. Database sweep on 2026-09-04 verified zero plaintext. |

---

## Documented trade-offs

- **The session draft is stored in IndexedDB as plaintext even for vault users.**
  A draft is an autosave of working state rather than a stored note: it is
  overwritten when the session ends and removed on sign-out with erasure. The
  `localStorage` copy is suppressed while encryption is on. If the threat model
  tightens, the same encryption helper can cover it.
- **A stream that falls back mid-generation charges two slots.** The remaining
  case after refund-on-disconnect: the connection drops mid-stream and both
  attempts really did generate. Charging after the first upstream byte was
  rejected — it moves billing into the middle of a request and splits an atomic
  claim.
