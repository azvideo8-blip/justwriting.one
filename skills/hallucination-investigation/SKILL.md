---
name: hallucination-investigation
description: Root-cause analysis for factuality failures, unsupported claims, and context breakdowns in AI outputs. Use when an LLM produces wrong, unsupported, or fabricated information. Use when investigating whether a failure came from missing context, bad retrieval, prompt framing, tool misuse, or model limitations.
---

# Hallucination Investigation

> Adapted from the [Codex hallucination-investigator subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

Not every wrong answer is a hallucination. The term is overused and obscures real root causes: poor retrieval, stale data, broken tool calls, ambiguous prompts, or context window constraints. This skill diagnoses the actual failure mechanism and recommends the smallest change that reduces recurrence.

## When to Use

- An AI agent produced factually incorrect or unsupported information
- A response contradicted available evidence or context
- You need to distinguish between no-evidence failures and evidence-ignored failures
- Designing guardrails to catch unsupported claims before delivery
- Investigating recurring failures in a production AI workflow

**When NOT to use:**

- The answer was correct but the user disagrees — that's a prompt framing or expectation issue
- The system is behaving correctly but the query was ambiguous
- Investigating model behavior drift — use `prompt-regression-testing` instead
- Evaluating overall system quality — use `eval-engineering` instead

## The Process

### Step 1: Reconstruct the Failing Example

Capture exactly what happened and what evidence was available:

```
FAILING OUTPUT:
"<exact text of the wrong answer>"

EVIDENCE AVAILABLE TO THE SYSTEM:
- Retrieved documents (which ones, their content, relevance scores)
- Context window content at time of generation
- Tool call results (inputs, outputs, errors)
- Prompt/system instructions
```

### Step 2: Classify the Failure Mechanism

Determine which category the failure falls into:

| Category | Diagnosis | Evidence |
|----------|-----------|----------|
| **No-evidence failure** | System answered a question the available evidence could not support | No relevant document contained the claimed information |
| **Evidence-ignored failure** | Evidence was available but the model overrode or ignored it | Retrieved doc says X, output says not-X |
| **Retrieval miss** | Relevant evidence existed but wasn't retrieved or was ranked too low | The correct document exists in the corpus but wasn't in the context |
| **Stale context** | Evidence was once correct but is now outdated | Doc says "current CEO is Alice" but Alice left in 2024 |
| **Prompt framing** | The prompt encouraged overconfident completion | "Always provide a complete answer" without "if unknown, say so" |
| **Tool misuse** | The model called a tool incorrectly or misread its output | Called get_weather("NYC") but interpreted result as London |
| **Unsupported inference** | The model combined facts to produce a conclusion not in evidence | Doc A and Doc B are both true individually, but the output's combination isn't supported |

### Step 3: Recommend the Smallest Fix

Map root cause to intervention:

```
ROOT CAUSE: retrieval miss — correct doc exists but ranked too low
FIX: adjust retrieval chunk size from 256 to 512 tokens for this query type
VERIFICATION: test with the original query + a variant
```

### Step 4: Design Detection and Guardrails

Identify opportunities to catch similar failures before delivery:

```
DETECTION:
- Add factual consistency check: does the output cite evidence for every claim?
- Add uncertainty signal: if retrieval relevance scores below threshold, flag for review

GUARDRAIL:
- If no retrieved document scores above 0.7, respond "I don't have enough information" 
  instead of synthesizing an answer
```

## Quality Checks

- Diagnosis uses the actual failing path, not generic speculation
- No-evidence failures are separated from evidence-ignored failures
- Fix addresses root cause, not only suppresses wording
- At least one targeted regression case is included

## Output

```
FAILURE RECONSTRUCTION:
<what happened and what evidence was available>

ROOT CAUSE:
<failure category and supporting evidence>

HIGHEST-LEVERAGE FIX:
<smallest change with greatest recurrence reduction>

DETECTION / GUARDRAIL IDEAS:
<how to catch this on future runs>

VERIFICATION CASES:
<minimum 1 regression case to test the fix>

RESIDUAL RISK:
<what's still vulnerable if only this fix is applied>
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The model just hallucinated" | That's a label, not a diagnosis. Was it retrieval? Prompt framing? Context pressure? |
| "We need a better model" | A better model with the same retrieval and prompt will fail in the same way |
| "The answer sounds right to me" | That is confirmation bias. Check the evidence. |
| "We'll add more context" | More context increases distraction. Fix retrieval relevance first. |

## Red Flags

- Labeling every wrong answer a hallucination without investigating the mechanism
- Recommending a new model as the primary fix without fixing retrieval, prompt, or context issues first
- Adding more context when the problem is that relevant context wasn't ranked high enough
- Adding guardrails that suppress false positives but also suppress true positives

## Interaction with Other Skills

- **`eval-engineering`**: use hallucination-investigation to design evaluation scenarios that catch factuality failures
- **`prompt-regression-testing`**: after fixing, add regression cases to ensure the fix survives prompt changes
- **`debugging-and-error-recovery`**: when the failure is in a tool-use or multi-step workflow, use debugging skills to trace the fault
- **`source-driven-development`**: when the model overrides retrieved evidence, use source-driven development to ensure authoritative sources are prioritized

## Verification

- [ ] Failing output captured verbatim with available evidence reconstructed
- [ ] Failure mechanism classified into a specific category (not just "hallucination")
- [ ] No-evidence vs evidence-ignored distinction made
- [ ] Recommended fix addresses root cause, not symptoms
- [ ] Detection or guardrail idea produced for future catches
- [ ] At least one targeted regression case defined
- [ ] Residual risk documented if only the recommended fix is applied
