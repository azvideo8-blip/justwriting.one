# Refactoring Tickets — July 2026

Self-contained. Prefix: `REFAC-`. Goal: break up oversized files into focused modules without changing behaviour. All changes are pure moves/extractions — no logic changes. Implement in order: REFAC-1 → REFAC-2 → REFAC-3 → REFAC-4.

Each ticket includes the exact files to create/modify and what moves where. Tests should pass unchanged after each ticket (no logic change).

---

## REFAC-1 — Extract transport + parsing functions out of `useAIChat.ts` 🔴

**Context:** `src/features/ai/hooks/useAIChat.ts:1–301`

The first ~300 lines of `useAIChat.ts` are pure functions and module-level constants that have zero React dependency. They sit in the hook file only by historical accident.

**Create: `src/features/ai/utils/aiChatTransport.ts`**

Move the following from `useAIChat.ts` verbatim:
- `let _streamUnavailableUntil = 0` and `const CONTEXT_WINDOW = 14`
- `const NOTE_SEARCH_PATTERNS: RegExp[]` and `function looksLikeNoteSearch(text)`
- `export const API_MSG_CAP` and `function toApiContent(content)`
- `function pruneMessages(messages)`
- `async function streamChat(params)` — full function including the streaming loop and reasoning/answer parsing logic inside the `while(true)` block
- `async function callableChat(params)`
- `function extractReasoning(text)` and `function extractAnswer(text)`

**Exports from the new file:** all of the above that are currently used outside the module (check with grep). At minimum: `API_MSG_CAP`, `looksLikeNoteSearch`, `NOTE_SEARCH_PATTERNS`.

**Modify: `useAIChat.ts`**
- Delete the moved code.
- Add one import line: `import { streamChat, callableChat, extractReasoning, extractAnswer, looksLikeNoteSearch, pruneMessages, toApiContent, API_MSG_CAP, CONTEXT_WINDOW, _streamUnavailableUntil } from '../utils/aiChatTransport'`.
- Note: `_streamUnavailableUntil` is mutated from `streamChat` — keep it as a module-level export from `aiChatTransport.ts` so mutations persist correctly.

**Result:** `useAIChat.ts` drops from ~1245 to ~960 lines. `aiChatTransport.ts` is ~300 lines of pure, testable functions.

**Acceptance:** `tsc --noEmit` passes. All existing tests pass. `useAIChat.ts` imports `streamChat` from `aiChatTransport`.

---

## REFAC-2 — Extract context assembly into `useAIChatContext.ts` 🔴

**Context:** `src/features/ai/hooks/useAIChat.ts` — the `sendMessage` callback, lines ~560–985 (the context assembly block)

`sendMessage` is ~730 lines. ~425 of those lines are assembling `searchContext` — fetching portrait, facets, doors, doing note search, loading chat memory, detecting crisis, injecting date. This is a self-contained concern that can be its own hook.

**Create: `src/features/ai/hooks/useAIChatContext.ts`**

This hook owns all session-scoped caches and builds context on demand.

```ts
export interface ChatContextResult {
  userPortrait: string | null;
  customPersona: string | undefined;
  searchContext: string | undefined;
  documentMood: string | undefined;
}

export function useAIChatContext(effectivePersonaId: string): {
  buildContext(params: {
    text: string;
    attached: { content: string; documentId?: string } | null;
    mood: string | undefined;
    messageHistory: AIMessage[];
    isFirstTurn: boolean;
  }): Promise<ChatContextResult>;
  resetSession(): void;
  setAttachedNote(note: { content: string } | null): void;
  getAttachedNote(): { content: string } | null;
  incrementMessageCount(): void;
  getMessageCount(): number;
}
```

**Move into `useAIChatContext.ts` from `useAIChat.ts`:**
- All context-related `useRef` declarations:
  - `portraitCacheRef`
  - `facetsCacheRef`
  - `docsCacheRef`
  - `doorsCacheRef`
  - `stickyTurnsRef`
  - `lastSearchQueryRef`
  - `lastSearchNamesRef`
  - `attachedNoteRef`
  - `messageCountRef`
- The `resetSession` logic currently in `useEffect` (lines ~342–352): resetting all caches on dialogue change. Expose as `resetSession()`.
- The full context assembly block from `sendMessage` (currently lines ~560–985): move into `buildContext(params)`.
- The `prepareAttachment` note hydration logic (currently at line ~1170): move into hook as a private helper.

**Modify: `useAIChat.ts`**
- Replace the 9 moved `useRef` declarations with `const context = useAIChatContext(effectivePersonaId)`.
- In `useEffect` on dialogue change: call `context.resetSession()` instead of manual cache resets.
- In `sendMessage`, replace the 425-line context block with:
  ```ts
  const { userPortrait, customPersona, searchContext, documentMood } =
    await context.buildContext({ text, attached: effectiveAttached, mood, messageHistory: prunedMessages, isFirstTurn });
  ```
- Replace `attachedNoteRef` usages with `context.setAttachedNote()` / `context.getAttachedNote()`.
- Replace `messageCountRef` usages with `context.incrementMessageCount()` / `context.getMessageCount()`.
- Move `prepareAttachment` to delegate to the new hook.

**Result:** `useAIChat.ts` drops from ~960 (post REFAC-1) to ~450 lines. `useAIChatContext.ts` is ~480 lines with all context logic in one place. Every CTX-* feature will be added to `useAIChatContext.ts`, not `useAIChat.ts`.

**Acceptance:** `tsc --noEmit` passes. No behaviour change. The returned API of `useAIChat` is identical. All imports of `useAIChat` from `AIPage.tsx` and `useAIPageData.ts` continue to work unchanged.

---

## REFAC-3 — Split `AIProfileFacetService.ts` into three focused modules 🟠

**Context:** `src/features/ai/services/AIProfileFacetService.ts` — 534 lines with three unrelated responsibilities

**Current public API:**
- `getAll()`, `clear()` — reads
- `build()` — full rebuild from embeddings (~280 lines)
- `incrementalUpdate(noteId)` — update centroid on new note (~65 lines)
- `summarizePending()` — call LLM for facets without summaries (~85 lines)
- `resummarizeDirty()` — re-summarize facets that changed (~60 lines)

**Create three files:**

**1. `src/features/ai/services/AIProfileFacetService.ts`** (keep, reduce to ~150 lines)
Keeps only: `getAll()`, `clear()`, `incrementalUpdate()`, `withFacetLock`, and `AIProfileFacetService` export object. Imports from the two new files below.

**2. `src/features/ai/services/AIProfileFacetBuilder.ts`** (~280 lines)
Moves: the entire `build()` function and all its private helpers:
- `fallbackFromTexts()`
- `canonicalName()` (now a simple capitalize-first helper since NAME_ALIASES was removed)
- The clustering/taxonomy/domain assignment logic
- Type definitions: `Chunk`, `FacetSpec`, `FacetBuildProgress`, `FacetBuildResult`

Exports: `buildFacets(onProgress?): Promise<FacetBuildResult>`

**3. `src/features/ai/services/AIProfileFacetSummarizer.ts`** (~120 lines)
Moves: `summarizePending()` and `resummarizeDirty()` plus the `LLM_DELAY_MS` constant.

Exports: `summarizePendingFacets(onProgress?)`, `resummarizeDirtyFacets(onProgress?)`

**Update `AIProfileFacetService.ts`** to re-export from both new files:
```ts
export const AIProfileFacetService = {
  getAll,
  clear,
  incrementalUpdate,
  build: buildFacets,           // delegates
  summarizePending: summarizePendingFacets,  // delegates
  resummarizeDirty: resummarizeDirtyFacets,  // delegates
};
```

All callers of `AIProfileFacetService.build()` etc. remain unchanged.

**Acceptance:** `tsc --noEmit` passes. `AIProfileFacetService.build()` behaves identically. No caller imports change.

---

## REFAC-4 — Split `useAIPageData.ts` into focused sub-hooks 🟠

**Context:** `src/features/ai/hooks/useAIPageData.ts` — 637 lines, 39 React hooks (useState/useCallback/useRef/useEffect)

One hook managing: dialogue list, archive, persona selection, custom personas, attachments, input state, send/feedback/regenerate handlers, proactive hints, follow-ups. Unrelated concerns sharing one context.

**Create two sub-hooks:**

**1. `src/features/ai/hooks/useDialogueManager.ts`** (~200 lines)

Owns dialogue state and CRUD:
- `dialogues`, `archivedDialogues`, `activeDialogueId` state
- `showArchived` toggle
- `loadDialogues()`, `handleNewDialogue()`, `handleSelectDialogue()`, `handleArchiveDialogue()`, `handleDeleteDialogue()`
- The `useEffect` that loads dialogues on mount and listens to `dialogue-updated` events

```ts
export function useDialogueManager(linkedDocId?: string) {
  return { dialogues, archivedDialogues, activeDialogueId, showArchived, ... };
}
```

**2. `src/features/ai/hooks/usePersonaManager.ts`** (~120 lines)

Owns persona selection and custom persona CRUD:
- `selectedPersonaId`, `customPersonas` state
- `createPersonaOpen`, `detailPersona` modal state
- `loadCustomPersonas()`, `handleSelectPersona()`, `handleCreatePersona()`, `handleDeletePersona()`

```ts
export function usePersonaManager() {
  return { selectedPersonaId, customPersonas, createPersonaOpen, detailPersona, ... };
}
```

**Modify `useAIPageData.ts`**
- Delete the moved state/callbacks.
- Import and compose: `const dialogueManager = useDialogueManager(linkedDocId)` and `const personaManager = usePersonaManager()`.
- Spread their returns into `useAIPageData`'s return object so all callers (`AIPage.tsx`) remain unchanged.
- Result: `useAIPageData.ts` drops from 637 to ~280 lines, focusing on: input state, attachments, send/feedback/regenerate handlers, proactive hints.

**Acceptance:** `tsc --noEmit` passes. `AIPage.tsx` import of `useAIPageData` is unchanged. All dialogue and persona functionality works identically.

---

## Summary

| Ticket | New file | Lines moved | `useAIChat.ts` result |
|--------|----------|-------------|----------------------|
| REFAC-1 | `aiChatTransport.ts` | ~300 | 1245 → ~960 |
| REFAC-2 | `useAIChatContext.ts` | ~480 | ~960 → ~450 |
| REFAC-3 | `AIProfileFacetBuilder.ts` + `AIProfileFacetSummarizer.ts` | ~400 | — |
| REFAC-4 | `useDialogueManager.ts` + `usePersonaManager.ts` | ~320 | — |

**REFAC-1 before REFAC-2** — transport functions need to be in their own module before context hook is extracted (context hook imports `streamChat` etc. from transport).

**No logic changes in any ticket.** Pure file splits. If behaviour changes, it's a bug in the refactoring.
