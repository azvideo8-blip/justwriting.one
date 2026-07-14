# AG-2 — App Check Enforcement: Rollback Runbook

**Last updated:** 2026-07-14  
**Applies to:** All Firebase Callable AI functions + `/api/chat` Vercel endpoint

---

## Scenario

App Check enforcement is now **ON** for all AI endpoints. If legitimate users
are getting `unauthenticated` errors that indicate a broken App Check client
integration, this runbook describes how to roll back without disabling Firebase
Auth or rate limits.

> [!IMPORTANT]  
> **Do not** disable Firebase Auth or per-user rate limits as part of a rollback.
> App Check and Auth are independent layers. Rolling back App Check does not
> weaken the Auth requirement.

---

## Monitoring signals to watch

| Signal | Threshold to act | Where to find it |
|--------|-----------------|-----------------|
| App Check rejection rate | > 1% of valid authenticated sessions | Firebase Console → App Check → Metrics |
| `401` rate on `/api/chat` | Spike above baseline | Vercel Functions logs |
| Cloud Function errors with code `unauthenticated` from App Check | > 0 for production iOS/Android | Firebase Console → Functions → Logs |
| User reports blocked from AI features | Any | Support queue |

---

## Rollback Steps

### Step 1 — Disable App Check enforcement on `/api/chat` (Vercel, < 2 min)

This affects the streaming endpoint only and takes effect immediately without a
deployment.

1. Open **Vercel Dashboard → Project → Settings → Environment Variables**.
2. Find `APP_CHECK_ENFORCE`.
3. Change value from `true` to `false` (or delete the variable entirely).
4. Click **Save**.
5. Vercel propagates the env change within ~30 seconds — no redeployment needed.

**Verification:** Send a test request without an `x-firebase-appcheck` header.
It should now pass auth and reach body validation (400), not 401 App Check error.

---

### Step 2 — Disable App Check enforcement on Cloud Functions (Firebase, ~5 min)

Each callable was changed from `enforceAppCheck: false` to `enforceAppCheck: true`.
Reverting requires a code change and redeploy.

**Files to change** (flip `true` → `false` in `enforceAppCheck`):

```
functions/src/ai/chatWithAI.ts
functions/src/ai/deriveTaxonomy.ts
functions/src/ai/editWithAI.ts
functions/src/ai/embedDocument.ts
functions/src/ai/extractChatMemory.ts
functions/src/ai/getAILimit.ts
functions/src/ai/getAIUsageStats.ts
functions/src/ai/judgeFacets.ts
functions/src/ai/rerankNotes.ts
functions/src/ai/summarizeDocument.ts
functions/src/ai/summarizeFacet.ts
functions/src/ai/validateCustomPrompt.ts
functions/src/admin/setUserRole.ts
functions/src/admin/resetUserLimit.ts
```

You can do this with a single `sed` command from the `functions/` directory:

```bash
cd functions
grep -rl "enforceAppCheck: true" src/ | xargs sed -i '' 's/enforceAppCheck: true/enforceAppCheck: false/g'
```

Then build and deploy:

```bash
npm run build
cd ..
firebase deploy --only functions
```

**Verification:** Call `getAILimit` from the Firebase Console emulator or a
test client without providing an App Check token — it should succeed.

---

## What is NOT affected by this rollback

- **Firebase Auth** — still required on every endpoint; an App Check rollback
  does not allow unauthenticated requests.
- **Per-user daily limits** — `checkAndIncrementLimit` still enforces per-UID
  daily request caps.
- **Global project quota** — `tryReserveGlobalRequest` / `refundGlobalRequest`
  shard-allocated quota system still runs.
- **Input sanitization** — `hasInjectionAttempt` and `sanitizeAiInput` guards
  still run on every request.

---

## Re-enabling App Check after a fix

Once the root cause (e.g., misconfigured App Check provider, broken token
issuance on a client version) is resolved:

1. Validate fix in staging: confirm App Check tokens flow through without errors.
2. Re-enable on Vercel: set `APP_CHECK_ENFORCE=true` in env vars.
3. Re-enable on Functions: flip `enforceAppCheck: false` → `true` in the 14 files above, build, and deploy.
4. Monitor rejection rate for 30 min before declaring success.
