---
name: prompt-regression-testing
description: Builds and maintains regression test suites for AI system behavior. Use when changing prompts, models, tools, or orchestration. Use when you need to ensure previously-working behaviors still work after a change — without bloating the test set.
---

# Prompt Regression Testing

> Adapted from the [Codex prompt-regression-tester subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

Every prompt change, model upgrade, or tool update risks regressing existing behavior. Regression testing is change-risk control: a compact suite of representative cases that catches drift before it reaches users. The goal is the smallest set with the highest signal-to-noise ratio.

## When to Use

- Before deploying a prompt change to production
- After upgrading the model version
- When adding, removing, or modifying tool definitions
- When changing orchestration logic (routing, chaining, fallbacks)
- After fixing a bug (add a regression case to prevent recurrence)

**When NOT to use:**

- No production deployment or user-facing risk
- The change is purely cosmetic (whitespace, formatting in system prompts)
- Evaluating overall system quality — use `eval-engineering`
- Investigating a specific failure — use `hallucination-investigation` first

## The Process

### Step 1: Scope the Risk

Identify the change and the behaviors most likely to drift:

```
CHANGE UNDER TEST:
<what changed — prompt, model, tool, orchestration>

HIGH-RISK BEHAVIORS:
- Previously broken cases (regression risk)
- Core user journeys (top-traffic paths)
- Safety and refusal boundaries (compliance risk)
- Output format compliance (downstream consumers)
- Tool selection logic (if tools changed)
```

### Step 2: Select the Regression Suite

Choose a compact but representative set:

```
CORE TASKS (must pass):
<3-5 scenarios covering the primary workflow>

FRAGILE EDGES (likely to break):
<3-5 scenarios that broke before or are behaviorally complex>

SAFETY BOUNDARIES (must not regress):
<2-3 refusal/adversarial scenarios>

FORMAT COMPLIANCE (must match schema):
<2-3 scenarios checking output structure>
```

### Step 3: Define Pass/Fail Criteria

| Case Type | Criteria | When to Escalate |
|-----------|----------|-----------------|
| Deterministic | Exact match on field or structure | Any mismatch |
| Instruction following | Rubric (1-5) on specific requirement | Score drop >1 |
| Factual grounding | All claims traceable to source evidence | Any unsupported claim |
| Tool selection | Correct tool + parameter names | Wrong tool or missing required param |
| Safety/refusal | Correct refusal — no false negatives or false positives | Either failure |

### Step 4: Establish Comparison Strategy

Decide what to compare against:

```
BASELINE: current production prompt + model
VARIANT: proposed change
COMPARISON: run both against the same regression suite
DECISION: variant must not regress on any P0 case
```

### Step 5: Plan for Maintenance

```
SUITE SIZE: <target number, aim for 10-20 cases>
UPDATE CADENCE: <when to add/remove cases>
- Add: after every bug fix (as regression guard)
- Add: after every user-facing failure (as detection)
- Remove: when a behavior path is deprecated or replaced
```

## Quality Checks

- Suite covers more than happy-path examples
- Cases are stable enough to detect change, not noise
- Deterministic assertions are separated from rubric-based review cases
- Call out what should be sampled live after release

## Output

```
REGRESSION SCOPE:
<what changed and what's at risk>

RECOMMENDED CASES:
| Case | Why It Matters | Criteria | Type |
|------|---------------|----------|------|
| "order a refund" | Core workflow | Correct tool + params | Deterministic |

PASS/FAIL CRITERIA:
<how each case is judged>

COMPARISON STRATEGY:
<baseline vs variant approach>

BLIND SPOTS:
<what the suite does not cover>
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "One-case regression test is enough" | One case covers one failure mode. Real regressions happen where you don't look. |
| "We'll test it manually after deploy" | Manual testing is not regression testing — it's spot-checking with no audit trail |
| "The prompt change is tiny, it can't break anything" | Tiny prompt changes produce large behavioral shifts, especially around refusal and format boundaries |
| "Adding cases is always good" | Bloated suites create noise, slow down iteration, and get ignored. Keep it lean. |
| "If it passes the suite, it's safe to ship" | A regression suite reduces risk but doesn't eliminate it. Live monitoring is still required. |

## Red Flags

- Creating a bloated test set that is expensive to maintain without improving decision quality
- No comparison strategy (baseline vs variant)
- Only testing happy-path examples
- No safety/refusal boundary cases
- Cases that produce noisy results (flapping between pass/fail)
- Forgetting to update the suite when behavior changes intentionally

## Interaction with Other Skills

- **`eval-engineering`**: eval-engineering designs the overall measurement framework; prompt-regression-testing selects specific regression cases within it
- **`hallucination-investigation`**: after investigating a failure, add a regression case to prevent recurrence
- **`test-driven-development`**: for deterministic AI behavior (format parsing, tool call formatting), TDD is complementary
- **`shipping-and-launch`**: regression suite results should be part of the pre-deployment checklist

## Verification

- [ ] Change under test identified with high-risk behaviors documented
- [ ] Regression suite selected (core tasks, fragile edges, safety boundaries, format compliance)
- [ ] Pass/fail criteria defined for each case type
- [ ] Comparison strategy established (baseline vs variant, decision rules)
- [ ] Maintenance plan defined (update cadence, when to add/remove)
- [ ] Blind spots acknowledged
- [ ] Suite is small enough to run repeatedly (target 10-20 cases)
