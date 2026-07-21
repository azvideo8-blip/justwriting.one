# Closing the loop: notes ↔ dialogues ↔ profile — Antigravity tickets (July 2026)

Self-contained. Prefix: `RING-`. Cherry-picked from the "AI integration deep-dive" — NOT the whole plan. Goal: start closing the loop between notes, dialogues and profile **without** new expensive LLM calls and **without** rippling changes through `aiTimeline`'s many readers. Owner will NOT self-fix — implement here, owner reviews after.

**Ordering (do in this order):** RING-0 (privacy prerequisite) → RING-1 (cheap, fixes a broken flow) → RING-2 → RING-3 (flagged prototype, last).

## Guardrails (repo-specific — read before coding)

- **Run lint.** Full `npm run lint` OOMs — use `npm run lint:changed` (per file). Check both sides of every moved import.
- **No new expensive LLM calls on any path.** Reuse already-paid results (`closingSummary`) and local cosine/IDB work. The only new AI call allowed is RING-3's single `embed` of an already-generated `closingSummary` — an infra call, exempt from the per-user chat limit but still behind the project cost-guard.
- **Do NOT write dialogue data into `aiTimeline`.** It's read by `LifeStoryTimeline` (`docMap.get(entry.documentId)` → undefined for a dialogue id), `getDefaultEventDate` (−1 day is meaningless for a dialogue), monthly digests, mood-trend and RAG. Use a **separate store** with explicit opt-in consumers (RING-2).
- **IDB changes additive**, guarded `if (oldVersion < N)`. DB is currently at **14** (`localDb.ts:358`); RING-2 bumps to **15** (new store); RING-3 adds optional fields — fold into the same 15 bump if landed together, else a further bump.
- On release bump the four version spots (package.json, package-lock.json, public/sw.js `CACHE_VERSION`, src/version.ts `APP_VERSION`).

---

## RING-0 — Delete a dialogue = purge its derived memory (privacy prerequisite) 🔴

**A real existing leak, independent of the new features — do it first.**

**Root cause (verified):** `AIDialogueService.delete(id)` (`src/features/ai/services/AIDialogueService.ts:203-205`) only does `db.delete('aiDialogues', id)`. But every ~3 turns `AIChatMemoryService.extractFromDialogue` writes extracted facts/insights/commitments/preferences into `aiChatMemory`, each tagged `sourceDialogueId` (`localDb.ts:183`, index `by-dialogue` at `:406`). Nothing removes those on delete. `useAIChatContext` (`:733-743`) injects `getPreferences()` + relevant memories into **every** prompt as "[Долгосрочная память (прошлые диалоги)]". Result: **deleting a dialogue leaves its conclusions live and still shaping AI replies** — the user can't actually make it forget. The AI never says "in the deleted conversation" (memory is injected as anonymous bullets), which is arguably worse: silent persistence of content the user chose to delete.

**Tasks:**
1. Add `AIChatMemoryService.deleteByDialogue(dialogueId: string): Promise<void>` — use the existing `by-dialogue` index to collect all keys for that `sourceDialogueId` and delete them in one readwrite tx. Do NOT touch `sourceDialogueId === 'manual'` entries.
2. Call it from `AIDialogueService.delete(id)` (await; log-and-continue on error so a memory-cleanup failure doesn't block the dialogue delete).
3. **Archive stays untouched** — archiving keeps `closingSummary` + memory (intended). Only hard delete purges.
4. Regression test: seed a dialogue + 2 `aiChatMemory` rows with its `sourceDialogueId` + 1 `'manual'` row; delete the dialogue; assert the 2 are gone, the manual row survives.

**Principle going forward:** every derived store keyed to a dialogue (RING-2's `aiDialogueEvents`, RING-3's `facet.dialogueIds`) MUST be cascaded from this same `delete` — add them here as they land.

**Acceptance:** deleting a dialogue removes its `aiChatMemory` rows (by `sourceDialogueId`), keeps manual memories, and never resurfaces that dialogue's content in later prompts; archive unchanged; test green.

---

## RING-1 — "Обсудить тему" from the profile (finish + fix the facet→chat bridge) 🟢

**Current state (verified — broken, not just unfinished):** the `draftFacet` bridge exists in `useAIPageData.ts:220-244`, but:
- It seeds `inputText` with **«Напиши вовлекающий пост для Telegram/блога…»** — leftover from the removed "в пост" feature. Clicking a theme starts a marketing-post request, not a discussion.
- Its only entry point was the "в пост" button, removed from the facet cards. So **there is currently no way into this flow from the profile.**

**Tasks:**
1. **Entry button.** On each theme card in `ProfileFacets.tsx` add an **«✨ Обсудить»** button that works in the profile (it's a navigation action — safe under `readOnly`, do not gate it behind the removed build/judge controls). On click: `navigate('/ai?draftFacet=' + f.id)` — **reuse the existing param, do NOT invent `?facet=`.** Add to theme facets; person facets optional.
2. **Fix the seeded prompt** (`useAIPageData.ts:230-233`): replace the Telegram-post text with a discuss opener grounded on the theme, e.g.
   `Давай разберём тему «${facet.label}». Вот что я про неё писал — помоги увидеть паттерн и что с этим делать.` (one short line; the attached notes supply grounding).
3. **Persona:** keep `cbt` (routing emotional→cbt / goals→coach is a later decision — do NOT build it here).
4. **Grounding notes:** keep attaching facet notes as `pendingAttachments`, but prefer `primaryNoteIds` if present, cap at 5, most-recent first, so the first message isn't bloated.

**Cost:** 0 LLM until send. **Risk:** low — repairs a broken/orphaned flow.

**Acceptance:** a theme card has an «Обсудить» button; clicking opens a fresh CBT dialogue seeded with a discussion prompt about that theme, its notes attached (chips visible), ready to send; no Telegram-post text remains.

---

## RING-2 — Dialogue conclusions stop being siloed (separate store + cross-persona recall) 🟡

**Goal:** a `closingSummary` from any archived session becomes available to all personas — without polluting `aiTimeline`.

**Current state:** `AIDialogueService.generateClosingSummary` (`:161-190`) writes `closingSummary` onto the dialogue in a tx (`:178-186`). It's consumed only in `useAIChatContext:868-879` — filtered to the **same** persona ("[Предыдущие сессии с этим персонажем]").

**Tasks:**
1. **New IDB store `aiDialogueEvents`** (migration 14→15, guarded `if (oldVersion < 15)`): `{ dialogueId (keyPath), date: 'YYYY-MM-DD' (archive date), month: 'YYYY-MM', personaId, personaName, summary: string (the closingSummary), themes?: string[] }`. Index `by-date`.
2. **Write it** inside `generateClosingSummary`, in the same success block that sets `closingSummary` (`:178-186`) — **0 new LLM**, reuse the text. `themes` optional (leave empty; RING-3 can fill it once embedding exists).
3. **Cross-persona recall in `useAIChatContext`.** Alongside the existing same-persona block, add a small **cross-persona** block from `aiDialogueEvents` (any persona), e.g. "[Выводы прошлых разговоров]" — the ~3-5 most recent by `date` (no embed needed here). Closes the isolation gap (Coach can reference a CBT-session conclusion). Keep it short, clearly labeled, and don't double-count the same-persona ones already shown.
4. **Cascade on delete (RING-0):** in `AIDialogueService.delete`, also `db.delete('aiDialogueEvents', id)`.
5. On **unarchive** (`:192-197`): remove the event (re-created on next archive) — keeps the store truthful.

**Cost:** 0 LLM. **Risk:** low — new store + one additive read path; no `aiTimeline` reader touched.

**Acceptance:** archiving a dialogue writes an `aiDialogueEvents` row (no new AI call); a later chat with a *different* persona surfaces "[Выводы прошлых разговоров]" referencing it; deleting the dialogue removes the row; `aiTimeline` and its consumers unchanged.

---

## RING-3 — Dialogues in facet clustering (behind a flag, prototype) 🟠

**Goal:** a theme shows "N заметок + M диалогов" so the profile reflects talked-about attention, not just written. **Off by default** — prototype, landed last.

**Current state:** `AIProfileFacetBuilder.build` (`:60`) builds `ChunkItem`s from note chunk vectors (`aiEmbeddings`) and clusters against domain seeds + K-means. `AIProfileFacet` (`localDb.ts:190`) has `noteIds` but no dialogue link. `AIFacetJudgeService.buildEvidence` (`:13-20`) builds evidence by filtering `aiSummaries` to `facet.noteIds`.

**Tasks (all behind a flag, e.g. `localStorage` `ff_dialogues_in_facets`, default off):**
1. **Embed the closingSummary once at archive** (1 infra `embed` call) and store `vector?: number[]` on the `aiDialogueEvents` row. Gate behind the flag so nothing is spent when off.
2. **Feed dialogue vectors into `build()`** as extra `ChunkItem`s tagged by source (dialogueId) when the flag is on. Clustering stays local.
3. **`dialogueIds?: string[]` on `AIProfileFacet`** — populate when a dialogue vector lands in a cluster. Render "💬 N диалогов" on the card in `ProfileFacets.tsx`.
4. **⚠ Judge must be dialogue-aware.** `buildEvidence` filters `aiSummaries` by `noteIds`; dialogue members aren't in `aiSummaries`, so evidence would be silently incomplete and the judge could "correct" a theme against half its sources. Either (a) skip dialogue members when judging, or (b) extend evidence to include `aiDialogueEvents.summary` for the facet's `dialogueIds`. Prefer (b); never let the judge run on partial evidence.
5. **Cascade on delete (RING-0):** removing a dialogue drops its id from any `facet.dialogueIds` and marks those facets for rebuild/resummarize.

**Cost:** 1 embed per archived dialogue (flag-gated). **Risk:** medium — theme pollution by meta-talk (discussing *about* a theme ≠ living it) + the judge ripple. Flag + prototype, evaluated on real data before default-on.

**Acceptance (flag on):** a theme with related dialogues shows "N заметок + M диалогов"; the judge uses complete evidence (or skips dialogue members); deleting a dialogue updates affected facets; **flag off → behavior and cost exactly as today (no embed spent).**

---

### Summary for the owner
- **RING-0** isn't a feature — it's a privacy fix for an existing leak (deleted dialogues keep influencing the AI). First, regardless.
- **RING-1** is the cheap win that also repairs a currently-broken flow (theme click → wrong "write a Telegram post" prompt, and no entry button).
- **RING-2** closes the dialogue-isolation gap with zero new LLM, via a separate store (never `aiTimeline`).
- **RING-3** is the speculative one — flagged, last, judge-aware, evaluated before default-on.
