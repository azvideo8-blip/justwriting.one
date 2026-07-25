# AG-MIND-W8a — programmatic guard for first-seen dates

**Priority:** P1 · the only unguarded claim the user currently sees · Scope: Small-Medium
**Files:** `src/features/ai/hooks/useAIChat.ts` (next to `sanitizeCitations`), `src/features/ai/hooks/useAIChatContext.ts`, `src/features/ai/services/AIMemoryAssembler.ts`.

## Why

Since Stage 1 the assembler injects lines like:

```
Эту мысль («выгорание») ты впервые записал 2026-07-12
```

and `NOTES_GUARD` asks the model to name when a thought first appeared, with a date. **Nothing verifies the date it actually prints.** The model can state a first-seen date for a theme that was never injected, or shift the one that was — and it will sound exactly as authoritative as a real one.

Citations already have this protection: `sanitizeCitations` (`useAIChat.ts:46`) degrades any `[#id]` that wasn't in the injected set. Dates have no equivalent. This is the last unguarded part of the signature feature — and the one most likely to be believed, because a specific date reads as a fact rather than an inference.

Everything else still missing from W8 (provenance UI, C1, the C2 golden set) is invisible to the user. This is not.

## Task

Add a `sanitizeFirstSeenDates(text, allowedDates)` guard alongside `sanitizeCitations`, applied on the same paths (streaming partials, reasoning, and the final text).

1. **Plumb the allowed set.** The assembler already knows every `firstSeenAt` it injected this turn; surface them the way `injectedDocumentIds` is surfaced today, through `useAIChatContext` into `useAIChat`.

2. **Guard only first-seen claims, not every date.** Match a sentence that contains both a first-seen phrasing (*впервые записал / впервые появилась / впервые связал* and close variants) **and** a date. Dates elsewhere — inside a quoted note, a user's own words, a general remark — must be left alone.

3. **Compare at month+year granularity.** The model renders naturally ("в июле 2026", "12 июля 2026"), not as ISO, so exact-string matching would fail on legitimate output. A claim is allowed when its month+year matches an injected `firstSeenAt`.

4. **On mismatch, strip the date, keep the sentence.** The date is the falsifiable part; removing it turns a fabricated fact into a vague statement instead of mangling the reply. Log the strip so it is visible in diagnostics — a guard that fires often means the prompt needs work, and we should be able to see that.

5. **Do not over-strip.** If no first-seen lines were injected this turn, any first-seen claim with a date is unsupported by definition — strip it. If the allowed set is non-empty, only mismatches get stripped.

## Acceptance

- [ ] Injected first-seen date printed by the model in any natural form (`2026-07-12`, `12 июля 2026`, `в июле 2026`) survives untouched.
- [ ] A first-seen claim with a date that was **not** injected has its date removed, sentence otherwise intact.
- [ ] A first-seen claim when **nothing** was injected has its date removed.
- [ ] Dates in quoted note text and in ordinary prose are never touched.
- [ ] Works on streamed partials without mangling text split across chunks (mirror how `sanitizeCitations` is applied).
- [ ] Strips are counted/logged for diagnostics.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192` before pushing.

## Note on the hard part

The fuzzy match is the whole risk here: too strict and it eats correct answers, too loose and it passes invented dates. Prefer **under-stripping over mangling** — a missed fabrication is a bug, but a guard that chews up correct replies destroys trust in the feature it is meant to protect. Cover the "leave alone" cases in tests as thoroughly as the "strip" ones.

## Out of scope

C1 sensitivity/suppressed (the W7 blocker), provenance in `MemoryManagerModal`, the C2 golden-set fixture. Those are the rest of W8 and get their own tickets.
