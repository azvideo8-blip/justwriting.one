# Security Batch 4 — SEC-51..68 (round 3, triaged)

Verified against the working tree. Severities corrected from the raw audit. ✅ = code-verified this pass · ◻︎ = assessed from description. Owner: 🤖 Antigravity-able · 🧠 needs judgment · 🧍 human.

**⚠️ The auditor's "top-5 immediate" list is STALE** — SEC-07 (lazyweb token) removed, SEC-24/25/26/27 shipped in **0.7.61**, SEC-01/02/08/28–34 all done. Ignore that summary; the real new work is below.

**Lint rule:** changed files only (full lint OOMs); run `tsc` (Antigravity ships tsc-red/eslint-red under a green self-report — caught 3× so far).

---

## 🟠 HIGH

### SEC-51 — OpenRouter API key in `.claude/settings.local.json` ✅ 🧍 (safe part DONE)
Live key `sk-or-v1-5412…` baked into ~11 saved curl permission entries. Not in git, not tracked — but sits in a dotfile (screenshot/backup exposure).
- **Already done this session (🤖):** stripped all 11 key-bearing permission entries; added `.claude/settings.local.json` to `.gitignore`.
- **Still required (🧍):** rotate the key in the OpenRouter dashboard — until rotated it's compromised. `git log --all -S "sk-or-v1-5412"` → confirm never committed (expected clean).

---

## 🟡 MEDIUM

### SEC-56 — Plaintext draft on `beforeunload` bypasses E2E ✅ 🧠 (the real standout)
`useDraftCore.ts:~122` does `localStorage.setItem('draft-'+uid, JSON.stringify({content…}))` on every `beforeunload`/`pagehide` with **no encryption check** — for E2E users the full diary sits plaintext in localStorage, readable by any same-origin script or browser-profile access. Silently defeats E2E (same class as SEC-29). **Action:** gate on `getEncryptionEnabled()` — skip the plaintext write (rely on Firestore draft) or encrypt first; mirror the read side (`WritingDraftService.ts`). Test: E2E on → close tab → localStorage has no plaintext.

### SEC-53 — Streaming endpoint has no timeout (slow-read DoS) ✅ 🤖
`api/chat.ts` `fetch()` to OpenRouter has **no `AbortController`/deadline**; `vercel.json` has **no `maxDuration`** for `/api/chat`. Slow-read clients pin invocations. **Action:** `AbortController` + 120s timeout on upstream fetch (both reasoning and non-reasoning paths), `clearTimeout` on completion; add `{ "source": "/api/chat", "maxDuration": 120 }`.

### SEC-54 — Unbounded telemetry writes ✅ 🧠
`firestore.rules:332` `allow create` on `anonymizedTelemetry/{telemetryId}` for any authed user, client-chosen id not bound to uid → unbounded write/storage spam. **Action:** bind `telemetryId == request.auth.uid`, or `match /anonymizedTelemetry/{uid}/{id}` with `isOwner(uid)`, or route via a rate-limited Cloud Function.

### SEC-55 — Security headers miss `/index.html` ✅ 🤖
CSP/frame-ancestors/HSTS block matches `/([^.]*)` (no dot) → `/index.html` served **without CSP** (only the global nosniff applies) → clickjacking / no XSS mitigation on direct load. **Action:** add an `/index.html` header block with the same set, or restructure so the CSP block covers it while `/assets/*` stay immutable.

### SEC-57 — Drag-drop archive import: no size/count cap ◻︎ 🤖 (partial dup of SEC-40)
`archiveImport.ts` reads dropped files fully into memory, extension-only validation. **Action:** `file.size` cap (10MB), batch count cap (~20), MIME-type check (not just extension). (SEC-40's DOCX cap covers part; this extends to the drop path + `.txt`.)

---

## 🟢 LOW (batch into one hygiene PR unless noted)

- **SEC-52 — pattern desync: STALE/DONE.** ✅ Both copies are already **21 patterns and in sync** (my SEC-44 synced them; functions has the extraction patterns). Only residual: **add an automated parity test** (import both, assert deep-equal) + fix the SECURITY.md claim. 🤖 Low.
- **SEC-58** — i18n `$`-pattern in replacement: `str.replace(re, () => String(v))` (function form). ◻︎ 🤖
- **SEC-59** — `?doc=` deep link: add `doc.guestId === userId` ownership check before load/overwrite. ◻︎ 🤠 Low (unguessable ids).
- **SEC-60** — export popup: `window.open(url, '_blank', 'noopener')`. ◻︎ 🤖
- **SEC-61** — MarkdownRenderer: `strip: ['script','style']`, drop `a[title]`. ◻︎ 🤖
- **SEC-62** — streaming parser O(n²): apply regex to new chunk + small lookback, not whole `fullText`. ◻︎ 🤖 (client self-DoS only).
- **SEC-63** — `npx -y firebase-tools@latest` → use pinned devDependency (drop `-y @latest`). ◻︎ 🤖 dev-only.
- **SEC-64** — GitHub Actions: pin `uses:` to SHA + add `permissions: contents: read`. ◻︎ 🧠 supply-chain.
- **SEC-65** — Sentry `beforeSend`: also delete `request.headers`/`cookies` (defense for future `sendDefaultPii`). ◻︎ 🤖 (`src/main.tsx`).
- **SEC-66** — `api/csp-report.ts`: no body cap / rate limit (my batch-2 endpoint). Add `if (JSON.stringify(req.body).length > 10_000) return 413`; consider dropping the endpoint if `report-to` unused. ◻︎ 🤖
- **SEC-67** — functions `refundGlobalRequest`: add `refunded?` guard (parity with `api/chat.ts`). ◻︎ 🤖 (invariant hardening, safe today).
- **SEC-68** — dead `isValidSession` in `firestore.rules` + stale SECURITY.md session section (`sessions` collection removed). Delete + doc-fix. ◻︎ 🤖 informational.

---

## Recommended order
1. **🧍 now:** rotate the OpenRouter key (SEC-51 code part done).
2. **🤖 real batch:** SEC-56 (E2E bypass — do first), SEC-53, SEC-55, SEC-54, SEC-57.
3. **🤖 hygiene PR:** SEC-52 parity test + SEC-58/60/61/62/65/66/67/68.
4. **🧠 supply-chain:** SEC-63, SEC-64.

**Auditor feedback:** top-5 list is stale (5 of them already shipped in 0.7.61); SEC-52's "bypassable" claim is fixed (patterns synced). Genuinely new & worth it: **SEC-56** (E2E bypass via unencrypted draft) and **SEC-53** (no stream timeout).
