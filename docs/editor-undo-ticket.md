# Editor undo/redo — Antigravity ticket (July 2026)

Self-contained. Prefix: `UNDO-`. Owner reviews after. One ticket.

## Why

The writing editor is a **controlled** textarea (`WritingEditor.tsx:96` `value={content}`, `onChange` → `useContentStore.setContent`). A controlled React textarea loses the browser's native undo stack, so **Ctrl/Cmd+Z does nothing** (and it never did — the typography work didn't cause this, it just made it noticeable). Add app-level undo/redo.

## UNDO-1 — App-level undo/redo for the editor 🟡

**Context:** `src/features/writing/store/useContentStore.ts` (zustand, holds `content` + `setContent`); `src/features/writing/components/WritingEditor.tsx` (textarea, `handleKeyDown`, `textareaRef`). Snapshots must coalesce bursts of typing — undo should revert a *word/phrase burst*, not one character at a time.

**Tasks:**
1. **History in the content store** (no new dependency — manual stacks; `zundo` is an acceptable alternative if preferred, but a small manual impl is fine):
   - Keep `past: { content: string; caret: number }[]` and `future: [...]` (or an index into one array). Cap `past` at ~100 entries (drop oldest) to bound memory.
   - Add actions `undo()`, `redo()`, `resetHistory()`, and a way to record a snapshot.
2. **Coalesced snapshotting.** Do NOT snapshot every keystroke. Coalesce a burst into one step: debounce (~400–600ms of idle) so a snapshot of the pre-burst content lands once the user pauses; a hard newline (Enter) can force an immediate snapshot boundary if easy. Each undo then reverts one burst. Clear `future` whenever a new edit is recorded.
3. **Guard against self-capture.** When `undo()`/`redo()` apply a value via `setContent`, do NOT record that as a new snapshot (a flag/`isApplyingHistory` ref).
4. **Keybindings in `WritingEditor.handleKeyDown`:**
   - `Cmd/Ctrl+Z` → `undo()`; `Cmd/Ctrl+Shift+Z` and `Ctrl+Y` → `redo()`. `preventDefault()` on those.
   - **Respect `streamMode`:** stream mode already blocks Backspace/Delete/cut ( `WritingEditor.tsx:62-78`) as a "no backtracking" mode — **disable undo/redo in streamMode too** (consistent).
5. **Caret restoration.** Store the caret offset with each snapshot; on undo/redo, after `setContent`, restore the textarea selection via `textareaRef` + `requestAnimationFrame` + `setSelectionRange` (mirror the pattern the typography change already uses). Falls back to end-of-text if the stored offset is out of range.
6. **Reset on document/session change.** Call `resetHistory()` when a new note/session loads or a draft is restored, so Ctrl+Z can never revert into a *different* note's content. (Find where content is loaded/replaced — draft restore, "new session", opening an archived note into the editor — and reset there.)
7. **Plays with typography (DGN-9):** typography writes through `setContent`, so snapshots capture the substituted text — that's fine; undo reverts to the previous burst. No special-casing needed.

**Non-goals:** no multi-document/global undo, no persistence of history across reloads (in-memory is fine), no undo for tags/title (content only).

**Acceptance:** while writing, `Ctrl/Cmd+Z` reverts the last typing burst (not one char) and `Ctrl/Cmd+Shift+Z` re-applies it; the caret lands sensibly after each; redo is cleared once you type again; undo does nothing in stream mode; loading a different note and pressing undo never pulls in the previous note's text; a unit test covers snapshot coalescing + undo/redo/reset on the store.

**Verify (not just tests):** open the editor, type a sentence, hit Cmd+Z → the burst is gone; Cmd+Shift+Z → it's back; type in stream mode → Cmd+Z is a no-op.
