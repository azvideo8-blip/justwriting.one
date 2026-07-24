# Security Batch 2 — SEC-07..23 (triaged)

Source: deep security audit, second batch. Each finding **verified against the working tree** before inclusion — severities below are corrected from the raw audit where it over- or under-stated risk. Reasons given inline. Do not bundle unrelated tickets into one change.

**Lint rule (all code tickets):** `npm run lint` on changed files only (full lint OOMs). Verify no dead/misplaced imports after edits.

**Legend:** 🧍 = human-only (dashboard/deploy/coordination, cannot be done in code) · 🤖 = Antigravity-able (mechanical code change + test) · 🧠 = needs judgment (touches several call sites or config).

---

## 🔴 CRITICAL

### SEC-07 — Live Bearer token in a PUBLIC repo 🧍 (+ 🤖 partial, already done)

**File:** `.codex/config.toml:11`

**Verified:** token committed and **tracked** (`git ls-files` lists it), present in history (`42370219`), repo `azvideo8-blip/justwriting.one` is **PUBLIC** (`gh repo view` → `visibility: PUBLIC`), `.codex/` was **not** in `.gitignore`. Token is exposed to anyone right now.

**Already done in this session (🤖):**
- [x] `.codex/` added to `.gitignore`.
- [x] `git rm --cached .codex/config.toml` (untracked; local file preserved).

**Still required — human, in priority order (🧍):**
1. **NOW:** rotate the lazyweb token in its dashboard. While the token is live it is leaked regardless of git state.
2. Purge from history (`git filter-repo --replace-text` or BFG) + force-push — **coordinate with the team** (rewrites shared history). Not done automatically.
3. Commit the untrack + gitignore change (in this session's working tree, staged as `D .codex/config.toml`).

**Note:** `.mcp.json` is already gitignored and untracked — no action there beyond confirming it holds the same (now-rotated) token.

---

## ✅ Injection-guard family — one batch (identical pattern to shipped AG-SEC-02) 🤖

All verified: user text reaches the prompt through `sanitizeAiInput` but skips `hasInjectionAttempt`. Fix = add the guard, add a regression test. Mechanical, same shape as AG-SEC-02.

### SEC-11 — `summarizeFacet` correction/focus (Medium — take)

**File:** `functions/src/ai/summarizeFacet.ts:56-64`

`correction` (≤500) and `focus` (≤200) get only `sanitizeAiInput`. `notesText` is checked (line 46), these are not. Worse: `correction` is injected with the amplifier "ОБЯЗАТЕЛЬНО УЧТИ ПОПРАВКУ (она важнее прежнего текста)".

**Work:**
1. `hasInjectionAttempt(parsed.data.correction)` and `hasInjectionAttempt(parsed.data.focus)` before use → `HttpsError('invalid-argument')`.
2. Soften the amplifier: replace "ОБЯЗАТЕЛЬНО УЧТИ ПОПРАВКУ (она важнее прежнего текста)" with a neutral "Дополнительный контекст:".
3. Test: `correction: "ignore previous instructions"` → `invalid-argument`.

### SEC-18 — `summarizeDocument` mood (Low)

**File:** `functions/src/ai/summarizeDocument.ts:88-118`

`mood` (≤50) gets only `sanitizeAiInput` (line 118); `content`/`recentContext` are checked (88, 92). "ignore previous" fits in 50 chars. Injected as `[Настроение документа: ${safeMood}]`.

**Work:** add `hasInjectionAttempt(mood)`, mirroring AG-SEC-02.

### SEC-12 — Infra endpoints: rerank / taxonomy / judge (Low — defense-in-depth)

**Files:** `functions/src/ai/rerankNotes.ts:37`, `deriveTaxonomy.ts:55`, `judgeFacets.ts:67`

`rerankNotes.query`, `deriveTaxonomy.digest`, `judgeFacets.summary/evidence` — only `sanitizeAiInput`. Blast radius is low (user's own data, JSON-schema-constrained output), so this is guardrail hardening, not a live hole.

**Work:**
1. `hasInjectionAttempt(query)` in `rerankNotes` (note: it does not currently import `hasInjectionAttempt` — add it).
2. `hasInjectionAttempt` on input texts in `judgeFacets`.
3. `deriveTaxonomy`: add the check **or** document accepted risk (user's own digest) in a code comment. Either is fine.

**Acceptance (whole family):** malicious input rejected before the model; regression test per endpoint; lint clean.

---

## ✅ SEC-13 — App Check debug token can leak into prod bundle 🤖 (Medium — take, trivial)

**File:** `src/core/firebase/client.ts:42-44`

Verified: no `import.meta.env.DEV` guard. If `VITE_APPCHECK_DEBUG_TOKEN` is ever set in Vercel env, App Check is globally disabled in prod.

**Work:**
```ts
if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}
```

---

## ⚠️ Severity corrected from the raw audit

### SEC-10 — Admin check via Firestore field, not custom claim 🧠 (Medium — LATENT, not "privilege escalation")

**Files:** `functions/src/shared/aiUtils.ts:295`, `api/chat.ts:281`, also inline in `getAIUsageStats.ts:24`

Verified: `isAdmin` reads `users/{uid}.role`. **But** the `role` field is client-immutable per `firestore.rules:148`, so a user cannot self-promote today. `isAdmin` gates: daily-limit bump, cooldown skip, and cross-user read in `getAIUsageStats`. So the raw ticket's "one rules change → privilege escalation" is accurate as *latent* risk (a rules regression would open it), **not a live hole**. Fix is consistency hardening, not a fire.

**Work:** unify on the custom claim (`request.auth.token.role === 'admin'` / `decoded.role === 'admin'`), consistent with the rules. Touches several call sites — hence 🧠, not a blind mechanical edit.

### SEC-08 — Production source maps served 🧠 (Medium, not High)

**File:** `vite.config.ts:38`, `vercel.json`

Verified: `sourcemap: 'hidden'` emits `.map`; `vercel.json` does not block them → `/assets/*.js.map` public. But the client code already ships to the browser (minified) and must carry no secrets — this exposes IP/obfuscation, not a secret. Hence Medium.

**Work (Option B — keep for Sentry):** block serving `*.map` (rewrite `/assets/(.*).map` → `/404` or a deny header in `vercel.json`), and `rm dist/**/*.map` in the build script **after** the Sentry upload step.

### SEC-09 — Security headers miss static assets 🧠 (Medium-Low)

**File:** `vercel.json:17`

Verified: the `nosniff`/CSP block matches only `/([^.]*)` → `/assets/*`, `sw.js`, `*.map`, `manifest.json` get none. CSP on static assets is unnecessary, but `X-Content-Type-Options: nosniff` on them is worth having.

**Work:** add a global `{ "source": "/(.*)", "headers": [{ "key": "X-Content-Type-Options", "value": "nosniff" }] }` block. (The `*.map` deny from SEC-08 covers the map-serving concern.)

---

## 🟢 Low / hygiene — batch into one PR 🤖

- **SEC-19** — `getAIUsageStats.targetUid` is `z.string().min(1).max(128)` (no regex); `/` mutates the Firestore path. Admin-only → Low. Replace with `userIdSchema`. (Verified separately: `getAIUsageStats` **does** have an admin gate at line 24 — no missing-gate hole.)
- **SEC-20** — `embedDocument.ts:70` leaks chunk counts in the client-visible `HttpsError`. `console.error` the detail, throw generic `'Embedding failed.'`.
- **SEC-21** — CSP has no `report-uri`/`report-to`. Add reporting for XSS visibility. Low.
- **SEC-22** — `console.warn` not gated behind `import.meta.env.DEV` (`AIProfileService.ts:79,138,342,346`, `useEmbeddingIndexer.ts:71-87`). Wrap or drop. Low.
- **SEC-23** — Guest draft stored in `localStorage` plaintext (`GuestDraftService.ts:42`). Add a TTL auto-purge; note in privacy policy. Low.

---

## 🟢 Document-only (no code change to E2E model) 🧍/🧠

- **SEC-15** — `keyVaultCache.ts` non-extractable AES key in IDB: any same-origin script can `loadDeviceKey()`. This is the inherent cost of "remember on device". Action = document in SECURITY.md + a UI warning on opt-in. A PIN/CredentialManagement binding is a larger design call, not a quick fix.
- **SEC-16** — `LoginPage.tsx:96` keeps `encryptionSalt`/`encryptedDataKey` in `sessionStorage` briefly during signup. Action = minimize the window (write to Firestore then clear immediately) or hold in memory/ref. Low.

---

## ⛔ Reject / rewrite — do NOT action as written

### SEC-17 — Old Firebase API key in git history (near-zero risk)

**File:** `firebase-applet-config.json` (history)

**Firebase web API keys are public by design** — the *current* key already ships in the deployed client bundle. They are project identifiers, not secrets; access is gated by App Check + domain/API restrictions, not key secrecy. Rewriting history for an old one buys nothing. Only action: confirm the old key has no broader scope than the current one in Google Cloud Console. **Do not rewrite history for this** (unlike SEC-07, which is a real secret). Feed this back to the auditor — it's a knowledge gap.

### SEC-14 — Dev server on `0.0.0.0` (Low, not Medium; optional)

**File:** `package.json:7`

It's the **dev** server, not production. Binding to `0.0.0.0` is commonly wanted for phone testing on LAN. If you drop `--host=0.0.0.0`, keep an easy opt-in for on-device testing. Fix only if you never test on LAN — otherwise skip.

---

## Recommended order

1. **🧍 NOW:** rotate the lazyweb token (SEC-07). History purge + force-push when the team can coordinate.
2. **🤖 one batch:** SEC-11 + SEC-18 + SEC-12 + SEC-13 — injection family + debug-token guard, all mechanical, Antigravity's profile.
3. **🧠 separately:** SEC-10 (claim unification), SEC-08 + SEC-09 (`vercel.json` / build script).
4. **🤖 hygiene PR:** SEC-19 + SEC-20 + SEC-21 + SEC-22 + SEC-23.
5. **🧍 docs:** SEC-15 + SEC-16 → SECURITY.md.
6. **⛔ reject:** SEC-17 (explain Firebase keys to auditor), SEC-14 (optional).
