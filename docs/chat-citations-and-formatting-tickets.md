# AG-CHAT-1..2 — raw note ids in replies, and replies rendered as a wall of text

Two independent defects in the same surface. Both are contained: nothing outside the chat rendering path changes.

**Files (both tickets):** `src/features/ai/hooks/useAIChat.ts`, `src/features/ai/pages/AIPage.tsx`, `src/features/ai/components/MarkdownRenderer.tsx`, `src/features/ai/hooks/useAIChatContext.ts`.

---

## AG-CHAT-1 — an unrecognised citation is printed as a bare id instead of being removed

**Priority:** P1 · visible in every affected reply · Scope: Small

### Why

Replies contain literal `[0ad3207b]` and `[local_d5751490-…]` in the running text. The cause is a two-step chain across two files that disagree about the marker.

**Step 1 — `sanitizeCitations`, `useAIChat.ts:47`:**

```ts
return text.replace(/\[#([a-zA-Z0-9_-]+)\]/g, (match, id) => {
  if (allowed.has(id)) return match;
  return `[${id}]`;          // ← drops the '#'
});
```

An id that is not in `injectedDocumentIds` is **degraded**, not removed: the `#` is stripped and the id survives as text.

**Step 2 — `processCitations`, `AIPage.tsx:280`:**

```ts
return text.replace(/\[#?([a-zA-Z0-9_-]+)\]/g, (match, id) => {
  if (!match.startsWith('[#') && !id.startsWith('local_')) {
    return match;            // ← prints it verbatim
  }
  …
});
```

The `#` is the only thing that tells the renderer this was ever a citation. Step 1 removes exactly that, so step 2 no longer recognises it and passes it through as visible text. **The degrade step is the bug**: an unrecognised citation must be deleted, not disarmed.

### Fix

- `sanitizeCitations` **removes** an unrecognised `[#id]` rather than rewriting it. Clean up the surrounding whitespace so removal does not leave a double space, a space before punctuation, or a line that ends in a dangling comma from a list of references.
- Apply the same rule to reasoning text, which goes through the same function.
- The two regexes must stop disagreeing. Put the citation pattern and the "is this a citation" predicate in **one** module that both `useAIChat` and `AIPage` import. Two independent copies of this rule is what produced the defect.

### The second half: why the ids were not recognised

Removing them hides the symptom. Find out why they were absent from `injectedDocumentIds` and report it — do not paper over it.

Known facts to start from:

- The prompt instructs `[#id]` with a real example (`useAIChatContext.ts:686`).
- `local_d5751490-…` **is** a real local id shape, so the model is citing a note that exists but was not injected in that turn — most likely remembered from earlier in the dialogue, or surfaced through memory rather than retrieval.
- `0ad3207b` is 8 hex characters: neither a Firestore auto-id (20 chars) nor a `local_` id. Two candidates worth checking, in this order: the model abbreviating a long id on its own, and belief evidence — `AIMemoryAssembler.ts:206` emits `[#${id}]` for ids obtained via `extractDocumentIdFromEvidenceId`, which are not necessarily document ids at all.

If belief evidence is emitting ids that are not documents, that is a second bug: either those ids join `injectedDocumentIds` (if they resolve to notes) or they must never be written as `[#…]` in the first place.

### Acceptance criteria

- No reply, streamed or stored, ever shows a bare id in the text.
- A citation of an injected note still renders as the clickable 📅 chip with its date.
- Removing a citation leaves clean punctuation and spacing.
- The report names the source of the unrecognised ids, with evidence.

### Tests

- Unrecognised `[#id]` → removed; recognised → preserved and rendered as a chip.
- A bare `[0ad3207b]` arriving straight from the model is also removed.
- `[local_…]` for a note that exists still resolves to a chip.
- Whitespace/punctuation after removal: mid-sentence, end of sentence, and inside a comma-separated list of references.
- Streaming: a citation split across two chunks must not be mangled or half-removed. **Check this case explicitly — the sanitiser runs on partial text at `useAIChat.ts:359`.**

---

## AG-CHAT-2 — long replies render as one undifferentiated block

**Priority:** P2 · Scope: Small

### Why

Two causes, and both need checking before either is changed:

1. **Markdown requires a blank line for a paragraph break.** A single `\n` renders as a space. If the model separates paragraphs with one newline, `react-markdown` correctly merges everything into a single `<p>`. Confirm what the model actually emits — log a raw reply before touching the renderer.
2. **Even when paragraphs do parse, they are 4px apart.** `MarkdownRenderer.tsx:36` sets `p` to `mb-1`, and lists and headings likewise. On a long answer this reads as a wall regardless of the markup.

There is currently **no instruction about formatting anywhere in the prompt** — no mention of paragraphs, structure or length. That is the cheapest lever and should be part of the fix.

### Fix

- Prompt: ask for paragraphs separated by blank lines, and for structure on long answers. Keep the existing tone and language of the prompt.
- Renderer: give paragraphs real separation. `mb-1` → something readable (`mb-3` scale); the same for `ul`/`ol` and around headings. This is a body of prose being read, not a dense table.
- Only if step 1 shows the model emitting single newlines: normalise them for rendering. Prefer `remark-breaks` (a small official remark plugin) over a hand-rolled regex — a regex that turns every `\n` into `\n\n` breaks lists, tables and code blocks, all of which this renderer supports.
- Do not add `rehype-raw`. The comment at the top of `MarkdownRenderer.tsx` explains why; it is a security boundary.

### Acceptance criteria

- A multi-paragraph reply is visually separated into paragraphs.
- Lists, tables, code blocks and blockquotes still render correctly — check each, they all have custom components.
- Streaming does not flicker between layouts as chunks arrive.
- The citation chips still sit correctly inline in the text.

### Tests

- A reply with single-newline separators renders as more than one paragraph.
- A markdown list is still a list (i.e. the newline handling did not swallow it).
- A code block preserves its internal line breaks.

---

## Process (both tickets)

Same as AG-BG-1:

- Full `npx vitest run` at the repo root **and** in `functions/`.
- `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`; the full run OOMs on this repo, so lint changed files individually if needed and say so. Do not pipe lint through `tail` — it masks the exit code.
- `npx tsc --noEmit`.
- **Verify every new test is non-vacuous**: revert its fix, confirm that exact test fails, restore.
- Attach the `tsc`, lint and both suite outputs to the report.
