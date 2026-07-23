# AI endpoint console errors (heavy-writer size limits + background failures) — Antigravity tickets (July 2026)

Self-contained. Prefix: `AIE-`. Diagnosed from prod Cloud Functions logs (`firebase functions:log`). Owner reviews + deploys functions after.

## Guardrails
- Lint per changed file (`npm run lint` OOMs). `npx tsc --noEmit` in root AND `functions/`.
- These touch Cloud Functions → the owner must `firebase deploy --only functions` after (no CI auto-deploy).
- Keep the abuse caps sane — raise limits to fit long-form journaling, don't remove them.

## Context: why some errors reached the in-app panel and some didn't
- `Failed to load resource: 400/500` lines are the **browser's own** network logging in DevTools — always shown, can't be suppressed from code. The only fix is to stop the request from failing.
- `<path> attribute d: Expected number` is a **browser SVG render warning**, not a JS exception/rejection → `reportError`/`window.onerror` never see it → never in the panel. (Fixed separately by FIX-2; it's from the currently-deployed bundle and clears after the next deploy.)
- Firestore `ERR_NETWORK_CHANGED` / `transport errored` are **transient network flaps**, not app bugs.
- The panel only shows what code routes through `reportError`. `chatWithAI`/`judgeFacets` failures reach it (their catch calls reportError); the background embedding indexer swallows some failures, so `embedDocument` 400s don't. AIE-4 addresses that.

---

## AIE-1 — `chatWithAI` 400 "Invalid payload": message content over 10 000 chars 🔴

**Ground truth (server log):**
```
Validation failed for chatWithAI. Errors: {"messages":{"0":{"content":{"_errors":["Too big: expected string to have <=10000 characters"]}}}}
```
**Root:** `functions/src/ai/chatWithAI.ts` `inputSchema` → `messages: z.array(z.object({ content: z.string().max(10_000) }))`. A single chat message over 10 000 chars is rejected → 400 on every send. This fires when a long note/reflection is pasted or a "discuss this note" injects note text as the message content — trivial for this user's long-form writing. (The `personaId: custom` in the panel context was incidental — the failing field is the message, not the persona; `customSystemPrompt` and the persona prompt both correctly cap at 500 and match.)

**Fix:** raise the per-message content cap to fit long entries — e.g. `content: z.string().max(50_000)` (aligns with `documentContent`'s 50 000). Keep the existing 200 000-char total-across-messages `refine` as the real abuse guard. Mirror the same limit in `api/chat.ts` if it has a parallel schema (grep for the messages schema there — keep them in sync).

**Acceptance:** sending / discussing a long (10k–50k char) message no longer 400s; the 200k total cap still rejects absurd payloads; `api/chat.ts` (if applicable) matches.

---

## AIE-2 — `embedDocument` 400: note content over 50 000 chars 🟠

**Root:** `functions/src/ai/embedDocument.ts` → `content: z.string().min(1).max(50_000)`; also `MAX_CHUNKS = 40` × `CHUNK_CHAR_LIMIT = 1_000` caps embedding coverage at ~40 000 chars anyway. A note longer than 50k is rejected (400) and never embeds → it's retried and 400s repeatedly (background indexer). A note between 40k–50k embeds only its first ~40k.

**Fix (pick the coherent pair):**
1. Raise `content.max` to a realistic long-note bound (e.g. **200_000**) so long notes aren't rejected outright, AND raise `MAX_CHUNKS` so coverage matches (e.g. 200 chunks for 200k) — otherwise you accept the note but silently embed only the first 40k. Keep a sane upper bound to bound cost/time.
2. Client-side (`useEmbeddingIndexer` / the embed caller): if a note exceeds the accepted limit, **don't retry the 400 forever** — mark it skipped/oversized (mirror the EMB-1 cloudSkipped pattern for the 1MB write) so the indexer stops hammering the endpoint.

Do both: raise the server limit to a reasonable bound, and make the client treat a hard 400 (invalid-argument) as permanent-skip, not a retry.

**Acceptance:** a long note embeds (with coverage matching the accepted length), or is skipped permanently without repeat 400s; normal notes unaffected.

---

## AIE-3 — `judgeFacets` 500 / "Timeout": upstream AI body-read timeout, surfaced as an error 🟡

**Ground truth (server log):** `[AI judge] failed: body read timeout` — the OpenRouter response body read timed out; the function then 500s (and the client sees a timeout). judgeFacets is a **background quality pass** (AIFacetJudgeService, run by the indexer), not user-initiated — a transient model timeout shouldn't surface as a red error.

**Fix:**
- Server (`functions/src/ai/judgeFacets.ts`): treat an upstream timeout / unparseable output as a soft failure — return an empty verdict set (e.g. `{ verdicts: [] }`, 200) instead of `throw HttpsError('internal', …)`, mirroring the deriveTaxonomy graceful-empty fix, so the client can no-op. Optionally one retry on body-read timeout before giving up.
- Client (`AIFacetJudgeService` / `useEmbeddingIndexer`): a judge failure is non-critical background work — log it at `warning` (or swallow) and back off; don't `reportError` it as a hard error or block indexing. The judge simply runs again next cycle.

**Acceptance:** a judge upstream timeout no longer produces a 500 or a red panel error; facet judging silently retries next indexing pass; genuine judge bugs still surface.

---

## AIE-4 — Make background indexer failures visible-but-quiet (panel hygiene) 🟢 (small)

The user expects the in-app panel to reflect real problems, but background AI work (embed/judge/summarize) currently either spams hard errors or is silently swallowed. Standardize: background indexer failures route through `reportError(…, level: 'warning')` (so they appear in the panel as warnings, distinct from hard errors) OR are swallowed with a single debug log — but **never** as red errors for expected-transient cases (network, upstream timeout, oversized-skip). Pair this with AIE-1/2/3 so that once the size/timeout causes are fixed, the panel is genuinely clean.

**Acceptance:** after AIE-1/2/3, a normal session produces no red entries in the panel; transient/background hiccups (if any) show as warnings, not errors.
