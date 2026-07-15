# Editor ↔ AI integration — Tickets (July 2026)

Self-contained. Goal: tighten the loop between free-writing (the editor) and the AI (`/ai` chat + quick actions), reusing machinery that already ships. Ordered: **Batch A** = quick wins (do first), **Batch B** = solid-but-not-quick.

## Verified baseline — reuse, do NOT rebuild

Checked against the code. These already exist:
- **`AIPanel`** (`src/features/writing/components/AIPanel.tsx`) is a complete, **unwired** quick-actions panel: 7 actions (shorten/accents/ideas/summarize/tags/mood/continue), reads live editor text from `useContentStore` (`content`/`setContent`/`setTags`), calls `AIService.process` → `editWithAI`, and **already guards offline + `useAiLimitStore.remaining`** (`AIPanel.tsx:43-62`). It is imported nowhere. It just needs mounting + a toggle.
- **Side-panel toggle precedent:** `LifeLogPanel` in `src/features/writing/pages/DesktopWritingLayout.tsx` (`:12` import, `:188`/`:205` render) — mirror this for AIPanel.
- **`/ai?doc=<id>` already works:** `AIPage.tsx:50` reads `searchParams.get('doc')`; `useAIPageData.ts:176-177` auto-stages that note as a pending attachment. So "discuss this note in chat" needs only a button that navigates there.
- **Attached-note summaries exist:** `aiSummaries` carries `summary`, `tone`, `themes`, `valence`, `arousal` (`localDb.ts:103-127`).
- **Rerank cards** are built from local summaries in `noteRetriever.ts` (`~:207` `const cards: {documentId, card}[]`, loop over `topIds`); `RERANK_THRESHOLD = 0.88` (`:22`); `searchNotesMulti` merges queries with `queries.join(' ')` (`:353`).

## Guardrails for every ticket (repo-specific)

- **Lint per changed file** — `npm run lint:changed`, never full `npm run lint` (it OOMs). Extractions/moves here repeatedly leave dead/misplaced imports — check both sides.
- **Live AI calls stay behind the per-user limit.** `AIPanel` already checks `useAiLimitStore.remaining` and the `editWithAI` server cap — do not bypass or duplicate calls. No new AI call fires without a user gesture.
- **No fire-and-forget bursts** from a hot path (editor keystroke, render). Debounce/gate anything new.
- **IDB changes additive** (optional fields, one version bump), migrations guarded `if (oldVersion < N)`.
- **Match existing patterns** (the `LifeLogPanel` toggle, the `?doc=` / `draftFacetId` param flow) instead of inventing parallel ones.
- On release, bump the four version spots (see CLAUDE.md checklist incl. `src/version.ts`).

---

# Batch A — quick wins

## UX-1 — Wire the AIPanel into the editor 🟢

**Context:** `AIPanel.tsx` (ready, self-sufficient via `useContentStore`), `DesktopWritingLayout.tsx` (LifeLogPanel toggle precedent), `Toolbar.tsx` / `WritingHeader.tsx` (desktop toggle spot), `MobileWriteScreen.tsx` + `MobileWriteToolbar.tsx` (mobile).

**Why:** a finished panel with real value (shorten/continue/mood/tags on the current draft) sits dead. Highest ROI in this set — mostly wiring, no new AI plumbing.

**Tasks:**
1. Add an `aiPanelOpen` boolean at the layout level, mirroring how `LifeLogPanel`'s open state is held in `DesktopWritingLayout`. Ensure only one of {LifeLog, AIPanel} is open at a time if they share the right rail.
2. Add an **`AIToggleButton`** (`Sparkles` icon, `lucide-react`) to `Toolbar.tsx`/`WritingHeader.tsx` (desktop) and `MobileWriteToolbar.tsx` (mobile) that toggles `aiPanelOpen`.
3. Render `<AIPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />` beside `LifeLogPanel` in the desktop layout, and in `MobileWriteScreen` as a sheet/overlay (match the mobile sheet pattern already used, e.g. `MobileStorageActionsSheet`).
4. No content wiring needed — `AIPanel` reads `useContentStore` itself. Verify apply-back (`setContent`/`setTags`) targets the same store the editor writes to.

**Budget note:** 0 new AI plumbing — `AIPanel` already gates on `useAiLimitStore.remaining` + offline. Each action is one user-initiated `editWithAI` call.

**Acceptance:** a Sparkles button in the editor toolbar (desktop + mobile) opens the panel; actions run on the current draft and apply back into the editor; with `remaining <= 0` the panel shows the rate-limit message and fires no call; toggling LifeLog/AIPanel doesn't overlap.

---

## UX-2 — "Discuss with AI" button from the editor 🟢

**Context:** `/ai?doc=<id>` already auto-attaches (`AIPage.tsx:50`, `useAIPageData.ts:176-177`), `BottomStats.tsx` / `WritingFinishModal.tsx` (button spots), the editor's current doc id + save path.

**Why:** the note→chat bridge is one navigation away and mostly already built server-side of `/ai`. Closes a real gap (today: manual menu → chat → new dialogue → pick note).

**Tasks:**
1. Add a **"Обсудить с ИИ"** button in `BottomStats.tsx` (and/or `WritingFinishModal.tsx` save flow).
2. On click: save the current draft (reuse the existing save path so a doc id exists), then `navigate('/ai?doc=' + docId)`. **Reuse the existing `?doc=` param — do not add a new `newDialogueWithDoc` param.**
3. Optional (small): if the intent is always a *fresh* dialogue, also trigger `handleNewDialogue` on arrival when `?doc=` is present and the active dialogue is non-empty. Confirm current `?doc=` behavior first (it stages the attachment onto the active dialogue) and only add this if it feels wrong.

**Budget note:** 0 AI calls on navigation (attachment is staged; the call happens when the user sends).

**Acceptance:** clicking "Обсудить с ИИ" saves the draft and lands on `/ai` with that note already attached (chip visible), ready to send; no duplicate dialogues created on repeat clicks.

---

## UX-3 — Context-aware chat starters from the attached note 🟢

**Context:** `CHAT_STARTERS` (`useAIPageData.ts:30`, rendered `AIPage.tsx:584`), attached-note state in `AIPage`/`useAIPageData`, `aiSummaries.themes`/`summary` (`localDb.ts`).

**Why:** when a note is attached, the generic static starters are off-topic. Theme-derived starters make the first turn land on the actual note.

**Tasks:**
1. When a note is attached (pending attachment / `linkedDocId` present), look up its `aiSummaries` entry and read `themes` (and/or `summary`).
2. Build 2-3 dynamic starters from the top themes (e.g. theme "Выгорание" → «Что привело меня к выгоранию в этой записи?», «Помоги найти зоны напряжения в тексте»). Keep a small template set keyed off a theme string; fall back to `CHAT_STARTERS` when no summary/themes exist.
3. Render these in place of `CHAT_STARTERS` at `AIPage.tsx:584` only for the attached-note case.

**Budget note:** 0 AI calls — reads existing `aiSummaries`. Purely local.

**Acceptance:** attaching a summarized note shows starters derived from its themes; a note without a summary (or no attachment) shows the default starters; clicking a starter sends it as the first turn.

---

## T-2 — Rich rerank cards: add the matched raw chunk excerpt 🟢

**Context:** `noteRetriever.ts` rerank-card loop (`~:207`, `const cards: {documentId, card}[]`), `chunkIndexMap` (id → matched chunkIndex, built `~:186`), `loadNotes` (has access to chunk text), the cloud `rerankNotes` call.

**Why:** **quality, not perf.** Cards are built only from `aiSummaries` (summary/tone/themes/facts) — the raw chunk text that actually matched the vector search never reaches the reranker, so it misses exact-wording matches. Independent of corpus size.

**Tasks:**
1. In the rerank-card loop, for each `id` also fetch a short excerpt of the **matched chunk** (via `chunkIndexMap.get(id)` → the chunk's text, from the embedding entry or the document content at that chunk index — reuse whatever `loadNotes` already uses to slice chunk text).
2. Append the excerpt to the card body under a clear delimiter (e.g. `Фрагмент: "…"`), capped (~300-400 chars) so cards don't blow the rerank payload.
3. Keep the summary/tone/themes/facts already in the card — this augments, not replaces.

**Budget note:** 0 extra AI calls (reads local embeddings/docs already loaded); rerank payload grows by the capped excerpt only.

**Acceptance:** a query matching an exact phrase that appears in a note's body but not its summary now ranks that note correctly; card payload stays within the cap; existing high-score/exact-title bypass path (`:196`) is unchanged.

---

# Batch B — solid, not quick (medium effort / more risk)

## UX-7 — "Create a note from this reply" (cut a thought back to the journal) 🟡

**Context:** assistant message render in `AIPage.tsx` (`MarkdownRenderer` at `:641`), `LocalDocumentService.createDocument`, editor navigation (`WritingSessionContext` uses `location.state`).

**Why:** the AI often crystallizes the user's idea; there's no way to send that back into the journal. On-brand for a writing app — closes the chat→journal loop.

**Tasks:**
1. Add a "Создать заметку из ответа" action on an assistant message (button near the copy control, or on text selection).
2. On click: `LocalDocumentService.createDocument` with the reply text (or the selected span), auto-tag `#insight` / `#ai-reflection`, then navigate to the editor on that new doc.
3. Attribute lightly (it's the user's takeaway, not a transcript dump) — keep the inserted text as-is; don't restructure.

**Budget note:** 0 AI calls (uses existing text).

**Acceptance:** clicking the action creates a new note containing the reply/selection with the tag, and opens it in the editor; the chat is untouched.

---

## UX-4 — "Apply to note" for the editor persona 🟡

**Context:** attached-doc state in `useAIChat`/`useAIPageData`, active persona id (`editor`), `LocalVersionService.addVersion` (note the method is `addVersion`, not `saveVersion`), assistant turn render.

**Why:** with the `editor` persona on an attached note, the AI produces an improved version but the user must hand-copy it back.

**Tasks:**
1. Show an **"Применить к заметке"** button on an assistant turn only when: a document is attached AND the active persona is `editor` (gate tightly to avoid accidental overwrites).
2. On click: write the reply as a **new version** of the attached doc via `LocalVersionService.addVersion` (preserve history — never destructive overwrite), then confirm with a toast + offer "открыть в редакторе".
3. Guard: never apply to a note that isn't the attached one; require an explicit confirm since this mutates journal content.

**Budget note:** 0 AI calls.

**Acceptance:** editor-persona + attached note shows the button; applying creates a new version (old one recoverable), never touches other notes; non-editor personas or no attachment → no button.

---

## UX-5 — Quick actions in the citation preview 🟡

**Context:** `handleCitationClick` → `setPreviewSession` → `DocumentPreview` (`AIPage.tsx:190,212,937`), `context.setAttachedNote`, editor navigation.

**Why:** citation chips open a read-only `DocumentPreview`; the natural next steps (attach it, edit it, copy an excerpt) aren't there.

**Tasks:**
1. In the citation preview, add: **"Прикрепить к диалогу"** (`context.setAttachedNote` / stage as pending attachment), **"Открыть в редакторе"** (navigate to editor on that doc), **"Скопировать фрагмент"**.
2. Keep it scoped to the citation-preview entry point so the archive's own `DocumentPreview` usage is unaffected (pass an optional actions prop rather than hard-coding).

**Budget note:** 0 AI calls.

**Acceptance:** opening a citation shows the three actions; attach stages the note for the next turn; edit opens the editor; copy puts the excerpt on the clipboard; archive preview unchanged.

---

## T-6 — Decayed query weighting in multi-turn retrieval 🟡

**Context:** `searchNotesMulti` (`noteRetriever.ts:321`, `combinedQuery = queries.join(' ')` at `:353`).

**Why:** flat `join(' ')` gives every prior turn equal weight, so "а что с этим?" after a long thread retrieves by old topics instead of the latest turn.

**Tasks:**
1. Weight the query embedding toward the most recent turn: either embed the latest turn separately and blend vectors with exponential decay by turn age, or repeat/emphasize the latest turn text in the combined query (simpler, no extra embed).
2. Keep it behind the existing multi-query path; don't change single-query behavior.

**Budget note:** at most +1 embed if you blend vectors (embeds are exempt/cheap); 0 if you weight the text.

**Acceptance:** in a long thread, a vague latest turn retrieves notes relevant to that turn, not the thread's earlier topics; single-query search unchanged.

---

## T-3 — Local rerank pre-pass on named-entity / keyword matches 🟡

**Context:** rerank section in `noteRetriever.ts` (below the `RERANK_THRESHOLD` bypass), `AIPeopleService` (extracted names), `shouldBoostKeywords` (already present).

**Why:** below 0.88 the code always hits the cloud `rerankNotes` (~1.5s + API cost). When the query contains a known person name or an exact keyword, a local pass can surface the right notes instantly and sometimes skip the cloud call — real latency/quota win given free-tier sensitivity.

**Tasks:**
1. Before the cloud rerank, run a local pre-pass: boost candidates whose text/title contains an exact query keyword or a resolved person name (from `AIPeopleService`), lifting them in `topIds`.
2. If the local pass yields a confident ordering (e.g. an exact person/keyword hit in the top candidate), optionally return it without the cloud call; otherwise fall through to `rerankNotes` as today.
3. **Touches the hot retrieval path — add a focused test** on the local ordering (synthetic candidates + a name/keyword query → expected order) so a regression is visible.

**Budget note:** net **reduction** in cloud rerank calls; 0 new AI calls.

**Acceptance:** a query naming a known person surfaces that person's notes first without waiting on the cloud when the match is exact; abstract queries still go through `rerankNotes`; the ordering test passes.
