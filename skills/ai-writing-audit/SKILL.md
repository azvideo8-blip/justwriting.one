---
name: ai-writing-audit
description: Detects AI writing patterns in prose and rewrites content to sound natural and human. Use when reviewing AI-generated text for credibility markers, when editing content that reads like it was written by an LLM, or when ensuring copy sounds authentic and on-brand.
---

# AI Writing Audit

> Adapted from the [Codex ai-writing-auditor subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

AI-generated prose carries detectable patterns — formatting tics, tiered vocabulary, hedging structures, and rhythmic repetition — that undermine credibility with human readers. This skill finds those patterns and rewrites them while preserving meaning, information density, and the author's voice.

## When to Use

- Reviewing AI-generated text before publishing (blog posts, documentation, social media, email)
- Editing content that feels "off" or robotic but you can't pinpoint why
- Ensuring consistency in tone across AI-assisted writing
- Before submitting copy for human review or client delivery
- Auditing marketing or communications material for AI credibility markers

**When NOT to use:**

- Purely technical documentation where precision trumps natural tone (API docs, error messages, legal language)
- Content explicitly requested to be in a formal or "corporate" register
- The author has explicitly approved the current AI tone

## The Process

### Step 1: Read and Classify

Read the target content end-to-end and classify its format:

```
FORMAT:
- Blog post, social media, email, technical doc, landing page, casual note
→ Strictness varies by format (technical docs allow more hedging, marketing stays strict)
```

### Step 2: Scan for AI Patterns

Check across three categories:

**Formatting tells:**

| Pattern | Example | Severity |
|---------|---------|----------|
| Em dash overuse | "The API — while powerful — requires careful setup" | P1 |
| Bold overuse | "**Crucially**, this **must** be configured **properly**" | P1 |
| Header emojis | "## 🚀 Getting Started" | P2 |
| Excessive bullet lists | 7+ bullet points in a row | P2 |
| Rule of three compulsion | "fast, reliable, and scalable" | P0 when every paragraph has one |

**Sentence patterns:**

- **Hollow intensifiers**: "very", "really", "extremely", "highly", "significantly" without supporting evidence
- **Hedging**: "it's worth noting that", "it should be mentioned that", "importantly", "it's important to note"
- **Missing connective tissue**: transitions between ideas feel abrupt or formulaic ("Meanwhile", "Furthermore", "Moreover", "In contrast")
- **False contrasts**: "It's not X, it's Y" — almost always replaceable with direct statement

**Tiered vocabulary:**

| Tier | Examples | Action |
|------|----------|--------|
| **T1 — Always replace** | delve, leverage, utilize, robust, comprehensive, seamless, holistic, synergy, tapestry, paradigm, navigate, foster, landscape, unlock, empower, facilitate, revolutionize, granular, ecosystem, silo | Replace on sight |
| **T2 — Flag in clusters** | iterate, optimize, actionable, deep dive, circle back, pivot, scalable, proactive, best-in-class, cutting-edge, thought leader, game-changer | Flag if 2+ per paragraph |
| **T3 — Flag by density** | All other formal/jargony terms | Flag if >3% of word count |

### Step 3: Rewrite

Apply fixes preserving meaning and author voice:

```
P0 (credibility killers) → always fix
P1 (obvious AI smell) → always fix  
P2 (stylistic polish) → fix unless author voice prefers it
```

### Step 4: Report

```
FINDINGS TABLE:
| Severity | Exact Text | Suggested Fix | Rule |
| P0 | "leverage" → "use" | Tier-1 vocabulary |
| P1 | "it's worth noting that" → ∅ | Hedging |

FULL REWRITE:
<resolved content with all P0 and P1 fixes applied>

SUMMARY:
- 12 changes: 3 P0, 7 P1, 2 P2
- 2 residual P2 items flagged for author review
```

## Quality Checks

- Every flag cites the exact phrase, not a paraphrase
- Rewrites preserve factual claims and information density
- Section structure and intended audience tone survive the edit
- Rule application matches the detected content-type profile
- Anything requiring author judgment (not mechanical replacement) is called out

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Readers won't notice AI patterns" | They won't name them, but they'll feel the content reads like marketing sludge |
| "Em dashes make writing more sophisticated" | Three per paragraph is a signature, not style |
| "The client asked for 'robust enterprise-grade solutions'" | Quote their exact required terms and make everything else natural around them |
| "AI vocabulary shows expertise" | Jargon signals the opposite — clear writing signals understanding |
| "It's just one 'leverage', it doesn't matter" | P0 terms are credibility killers. Kill them all. |

## Red Flags

- Stripping technical precision for the sake of "natural" tone
- Rewriting into a different register than the original (e.g., casual → formal)
- Removing voice elements that are intentional and on-brand
- Flagging domain-specific terms that are actually standard in the field
- Applying marketing strictness to technical documentation

## Interaction with Other Skills

- **`code-review-and-quality`**: use ai-writing-audit on README, documentation, and changelogs after code review
- **`documentation-and-adrs`**: apply to ADRs and user-facing docs to ensure they read naturally while staying precise
- **`frontend-ui-engineering`**: apply to UX copy and microcopy in the UI

## Verification

- [ ] Content format classified and strictness level set
- [ ] Formatting tells scanned (em dashes, bold, header emojis, bullet density)
- [ ] Sentence patterns checked (hollow intensifiers, hedging, false contrasts)
- [ ] Tier-1 vocabulary fully replaced
- [ ] Tier-2 vocabulary flagged in clusters
- [ ] Tier-3 vocabulary density checked
- [ ] Rewrite preserves factual claims and information density
- [ ] Author voice and intended register maintained
- [ ] Findings table with severity, exact text, fix, and rule produced
- [ ] Residual P2 items surfaced for author decision
