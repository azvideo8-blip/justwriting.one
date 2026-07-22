# In-app error surface + deriveTaxonomy 500 — Antigravity tickets (July 2026)

Self-contained. Prefix: `ERR-`. Two linked items. Owner reviews after.

## Guardrails
- Lint per changed file (`npm run lint` OOMs). Run `npx tsc --noEmit` in root AND `functions/`.
- Privacy: the in-app error log is **local only** (never synced to Firestore/Sentry beyond what `reportError` already does). It may contain the user's own content — that's fine locally, but do not add a new network sink.
- No new deps.

---

## ERR-1 — In-app error indicator ("N errors" badge → panel) 🟡

**Goal:** the owner shouldn't need the browser console. A small, unobtrusive badge that appears only when errors have occurred; clicking it opens a list of recent errors (time, message, context). Like a messenger unread badge.

**What exists:**
- `src/shared/errors/reportError.ts` — the single error funnel (DEV → `console.error`; prod → Sentry, PII-redacted). This is where to tee off.
- `ErrorBoundary` is used per-route (`AppRoutes.tsx`, `AppProviders.tsx`).
- No global `window.onerror` / `unhandledrejection` handler exists yet.

**Tasks:**
1. **Error log store** — a small module/zustand store with a ring buffer (cap ~50) of `{ id, time, message, context, level, source }`. In-memory is enough; optionally persist the last ~20 to `localStorage` so they survive a reload (local only).
2. **Tee `reportError` into it** — every `reportError(...)` call also pushes an entry (in addition to its current Sentry/console behavior). This captures all the app's caught errors (including the deriveTaxonomy failure, retrieval failures, sync errors, etc.).
3. **Global handlers** — add `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` (once, at app init) that push to the log and also call `reportError` (dedupe rapid repeats — e.g. collapse identical messages within a few seconds with a count, so a storm shows "×7" not 7 rows).
4. **UI badge + panel:**
   - A subtle fixed badge (e.g. bottom-left corner, small, muted) that is **hidden when the log is empty** and shows "N" (or a dot) when there are errors. Must not intrude on the writing surface — respect zen/silence mode (hide or keep it tiny).
   - Click → a small panel/sheet listing recent errors newest-first: relative time, message, and the context object (collapsed/expandable). A "Очистить" button to clear the log, and per-row dismiss.
   - Keep copy calm/quiet per the product voice — "1 ошибка" / "N ошибок", not alarmist.
5. **Scope:** show it for the owner/all authenticated users (it's a self-diagnostic). Don't gate behind admin-only Diagnostics — the whole point is to see errors without the console. A settings toggle to disable it is nice-to-have, not required.

**Non-goals:** not a full logging/telemetry system; not network requests' raw status lines (those are browser console entries, not JS exceptions) — surfacing `reportError`'d + unhandled JS errors covers the real cases. (The deriveTaxonomy failure IS surfaced, because `deriveAndStore` calls `reportError` on it.)

**Acceptance:** trigger a handled error (e.g. force a failing AI call) → a badge appears with "1 ошибка"; clicking shows the message + context; clearing hides the badge; identical repeated errors collapse with a count; the badge is invisible when there are no errors and doesn't disturb the writing surface.

---

## ERR-2 — `deriveTaxonomy` returns 500 (Internal Server Error) 🟠

**Context:** after ERR/FIX-2 fixed the 400 (bad payload), the endpoint now reaches the model and **500s**. Source: `functions/src/ai/deriveTaxonomy.ts`:
- `:116` `throw new HttpsError('internal', 'Taxonomy derivation produced no domains in Russian.')` — thrown when the model's labels are all filtered out (the Russian-only hardening we added: retry once, then drop English-only labels; if none remain → throw).
- `:129` generic `throw new HttpsError('internal', 'Taxonomy derivation failed.')` (parse/model failure).

**Likely root cause (the vicious cycle):** this user's stored themes are English ("Work and time boundaries", etc.). `buildSummaryDigest` feeds those English theme names into `deriveTaxonomy`, so the model echoes **English** domain labels; the retry+filter drops them all → 0 domains → **500** at `:116`. The auto-heal (English→Russian) then clears the taxonomy, re-derives, gets English again, filters to empty, 500s again (now gated by the 1-hour client cooldown, so it's ~1/hour, not a storm).

**Fix:**
1. **Don't 500 on an empty-but-valid outcome.** At `:116`, instead of `throw HttpsError('internal', …)`, **return `{ domains: [] }`** (a 200 with no domains). The client already handles `res.domains.length === 0` → skip + set the failure cooldown. This removes the scary 500 for what is really "the model gave nothing usable this time." Keep the genuine exception path (`:129`, parse/model crash) as a real error so ERR-1 can surface it.
2. **Break the English cycle (the real problem)** — pick one:
   - **(preferred, low-risk):** relax the filter — if after the retry the model still returns English-only labels, **keep them** rather than dropping to empty (an English label is better than no taxonomy, and it stops the endless re-derive). The client's English-detection staleness check should then NOT immediately re-clear a taxonomy it just derived (add a "just derived, don't re-heal for N days / until +K new notes" guard so it can't loop).
   - **or:** strengthen the digest/prompt so the model is pushed harder to Russian (e.g. translate the English theme names in the digest before sending, or a firmer system instruction). Higher effort, less certain.
3. Ensure the client treats the new empty-200 as a normal skip (it already does) and that the 1-hour cooldown still applies so nothing re-fires rapidly.

**Acceptance:** `deriveTaxonomy` no longer logs a 500 when it simply can't produce Russian domains — it returns empty and the client skips quietly; genuine model/parse failures still error (and now show in the ERR-1 panel); the auto-heal no longer loops forever on an English corpus (either it keeps the labels or backs off after deriving).
