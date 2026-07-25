# AG-MIND-belief-provenance — make belief citations actually traceable

**Priority:** P1 · **blocks enabling `ff_memory_assembler_beliefs`** · Scope: Small-Medium
**Files:** `src/features/ai/services/AIMemoryAssembler.ts`, `src/features/ai/hooks/useAIChatContext.ts`, `src/features/ai/hooks/useAIChat.ts`.

## The gap

The belief read-path injects evidence references, as the read-path ticket required:

```
[Убеждение] «…» (впервые записал 2026-07-12, доказательства: [#summary-local_abc], [#u1])
```

But those ids are **memory-unit ids**, not document ids:

| Source | id shape |
|---|---|
| chat memory | `mem.id` (uuid) |
| timeline fact | `timeline-<documentId>-<i>` |
| summary | `summary-<documentId>` |

`sanitizeCitations` (`useAIChat.ts:46`) only preserves `[#id]` for ids present in `injectedDocumentIds`, and nothing adds belief evidence ids there. So when the model echoes a belief's citation, the marker is stripped and it renders as plain `[summary-local_abc]` text.

Result: **the provenance does not work.** The user cannot trace a belief back to the notes it came from — which is the whole reason beliefs carry evidence, and the difference between a citable memory and an unfalsifiable assertion.

Nothing is broken in production today: `ff_memory_assembler_beliefs` defaults to false. **This must be resolved before that flag is turned on.**

## Do NOT just add the ids to the allowed set

The obvious "fix" — pushing belief evidence ids into `injectedDocumentIds` — makes it worse. Citation clicks resolve through `db.get('documents', id)`, and `summary-local_abc` / a chat-memory uuid is not a document id, so the citation would render as a live control that resolves to nothing. That is exactly the dead-icon bug already fixed once this session (a citation that looks clickable and does nothing destroys trust faster than no citation at all).

## Options — pick one deliberately

**A. Map evidence to real document ids where one exists.** `timeline-<documentId>-<i>` and `summary-<documentId>` both embed a real document id; extract it and cite *that*, so the citation resolves to the actual note. Chat-memory units have no document behind them — drop those from the citation list rather than emitting a reference that cannot resolve.
*Best fidelity; partial coverage.*

**B. Don't cite inline; show provenance out of band.** Emit the belief without `[#id]` markers and rely on the Beliefs diagnostics (which already lists evidence per belief) plus the future `MemoryManagerModal` provenance (W8в) for tracing.
*Honest and simple; the user cannot trace from inside the conversation.*

**C. Resolve at injection time.** Look the evidence units up and cite the documents they derive from, falling back to no citation when there is none.
*Effectively A with a lookup; costs an IDB read on the assembly path — acceptable since it is local, but it must not become a network call.*

Recommendation: **A**, extended with B's diagnostics for the units that cannot map. It keeps every rendered citation resolvable — the invariant that matters — without inventing links.

## Acceptance

- [ ] Every `[#id]` a belief puts in front of the model resolves to a real note when clicked, or is not emitted at all.
- [ ] Belief citations survive `sanitizeCitations` (they are in the allowed set **because** they are genuine document ids, not because the guard was loosened).
- [ ] Chat-memory-only beliefs still inject and read sensibly without citations.
- [ ] Test: a belief built from a summary unit cites the underlying document and the citation survives the guard; a belief built from chat memory emits no unresolvable reference.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`.

## Out of scope

Enabling the flag (separate step, after this lands and the journal shows beliefs ranking sensibly), A3 forgetting, C1, W8в provenance UI.
