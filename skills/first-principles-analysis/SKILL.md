---
name: first-principles-analysis
description: Breaks problems down to fundamental truths and rebuilds solutions from scratch — challenging assumptions, stripping inherited solution framing, and avoiding convention-driven design. Use when stuck on a complex problem, when existing approaches haven't worked, or when you need to evaluate whether current assumptions are still valid.
---

# First-Principles Analysis

> Adapted from the [Codex first-principles-thinking subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

First-principles analysis reduces a problem to irreducible truths and rebuilds solutions from the ground up. Strip inherited assumptions, challenge the status quo, and avoid defaulting to incremental tweaks when the foundations may be wrong.

## When to Use

- You're stuck on a problem that existing approaches haven't solved
- A solution feels over-engineered or inherited without question
- You need to challenge whether the current approach is still valid
- Evaluating a "this is how it's always been done" situation
- Before making a major architectural or product decision
- The team has conflicting opinions and needs a neutral decomposition

**When NOT to use:**

- The existing solution works well and the cost of re-examination exceeds the expected benefit
- You need incremental improvement of a working system — use `incremental-implementation`
- The constraints are truly immovable (regulation, platform limitation, physics) — but still test them first
- Pure execution of a clearly-specified task — use the appropriate implementation skill

## The Process

### Step 1: Define the Problem Precisely

Restate the problem without embedded solution language:

```
CURRENT FRAMING:
"We need to migrate from REST to GraphQL because REST is slow."

FIRST-PRINCIPLES RESTATEMENT:
"The UI needs data from 5 endpoints to render one screen, 
and the total response time exceeds 2 seconds."
```

Check: is the restatement free of solution framing? If it assumes a solution, strip it.

### Step 2: Inventory Every Assumption

List assumptions across four dimensions:

| Dimension | Assumptions |
|-----------|-------------|
| **Technology** | What tech stack choices are presumed? What infrastructure is assumed? |
| **Process** | What workflows, approvals, or handoffs are baked in? |
| **Business** | What business rules, pricing models, or user segments are assumed? |
| **User** | What user behaviors, needs, or preferences are assumed? |

### Step 3: Challenge Each Assumption

For each assumption, determine:

```
ASSUMPTION: "Users need real-time data"
VERDICT: PARTIALLY VALID
EVIDENCE: Dashboard users need <1s latency; reporting users need <1min
WHAT CHANGES IF REVERSED: We'd use polling instead of WebSockets for reporting
```

| Verdict | Meaning |
|---------|---------|
| **Valid** | Supported by evidence, unlikely to change |
| **Partially valid** | True in some contexts but not all |
| **Invalid** | Contradicted by evidence or no longer true |

### Step 4: Identify Fundamental Truths

What remains after stripping all challenged assumptions?

```
FUNDAMENTAL TRUTHS:
1. Users need to see their data on screen (physical UI constraint)
2. Data lives in PostgreSQL (single source of truth)
3. Users are on desktop browsers (99% of traffic)
Everything else — real-time, GraphQL, microservices, caching layer — is an assumption.
```

### Step 5: Rebuild Solutions from Fundamentals

Generate 2-3 rebuilt solution directions:

```
DIRECTION 1: Server-rendered views with Postgres queries
- Simplest possible: Rails/Django/ASP.NET rendering
- No API layer between DB and UI
- Tradeoff: Less flexible for mobile clients

DIRECTION 2: Lightweight API with targeted optimization
- REST endpoints optimized for the slowest queries
- Add caching only where measured >1s
- Tradeoff: More upfront profiling work

DIRECTION 3: <new entrant approach>
- What would someone with no existing codebase build?
- Tradeoff: <honest assessment>
```

### Step 6: Evaluate and Decide

```
| Direction | Impact | Effort | Risk | Reversibility |
|-----------|--------|--------|------|---------------|
| 1 | Medium | Low | Low | High |
| 2 | High | Medium | Medium | Medium |
| 3 | High | High | High | Low |
```

Include a **do nothing** option and its consequences.

## Output

```
PROBLEM RESTATED:
<first-principles language, solution-free>

CHALLENGED ASSUMPTIONS:
| Assumption | Verdict | Evidence |
|-----------|---------|----------|

FUNDAMENTAL TRUTHS:
<what remains after stripping assumptions>

2-3 REBUILT DIRECTIONS:
- Direction 1: <description and tradeoffs>
- Direction 2: <description and tradeoffs>
- Direction 3: <description and tradeoffs>

RECOMMENDED NEXT STEP:
<owner and action>
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The current approach exists for good reasons" | Maybe. But those reasons may no longer apply. Test them. |
| "We can't change X, it's a hard constraint" | Most "hard constraints" are assumptions that were never pressure-tested |
| "First-principles takes too long" | It takes one focused session. Debugging the wrong architecture for 6 months takes much longer. |
| "We already know what the problem is" | Problem statements that embed solution language are the most common source of wrong directions |

## Red Flags

- Defaulting to incremental tweaks of the existing approach without challenging its assumptions
- Problem statement that embeds a solution ("we need to migrate to X")
- Less than 2-3 alternative directions generated before recommending
- "Do nothing" option missing from the evaluation
- Recommendations that trace back to convention rather than fundamental truths
- Treating an assumption inventory as a checkbox exercise rather than genuine challenge

## Interaction with Other Skills

- **`spec-driven-development`**: use first-principles before writing a spec to ensure the problem is correctly framed
- **`architecture`**: use first-principles to challenge architectural assumptions before writing an ADR
- **`planning-and-task-breakdown`**: use first-principles to validate that the plan targets the right problem
- **`idea-refine`**: first-principles is the divergent-thinking counterpart; idea-refine converges on refinements

## Verification

- [ ] Problem restated without any solution framing or embedded technology choices
- [ ] Assumption inventory covers technology, process, business, and user dimensions
- [ ] Each assumption has an explicit verdict (valid/partially valid/invalid) with supporting reasoning
- [ ] Fundamental truths identified — what remains after stripping all assumptions
- [ ] At least 2-3 rebuilt solution directions generated before recommending one
- [ ] Recommendations trace back to fundamental truths, not convention
- [ ] "Do nothing" option evaluated with its consequences
- [ ] Evaluation includes impact, effort, risk, and reversibility
