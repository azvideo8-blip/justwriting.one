---
name: code-mapping
description: Maps code paths, ownership boundaries, and execution flow before making changes. Use when you need a high-confidence map of how a feature works end-to-end before modifying it. Use when navigating unfamiliar code, tracing a bug to its source, or assessing change impact across service boundaries.
---

# Code Mapping

> Adapted from the [Codex code-mapper subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

Before changing code, know where it lives and how it flows. Code mapping is exploration-mode tracing: from entry point to boundary, identifying owning files, call chains, state transitions, and risk points. The output is a map — not a design proposal or a fix.

## When to Use

- Navigating unfamiliar code to understand how a feature works
- Tracing a bug from symptom to root cause across module boundaries
- Assessing change impact before modifying shared abstractions
- Identifying ownership boundaries for a refactoring or migration
- Building mental model of a system before making architectural decisions

**When NOT to use:**

- You already know the exact files and paths to change
- The change is mechanical (rename, move, delete) with known impact
- You need a design proposal or architecture review — use `system-design` or `architecture` instead

## The Process

```
ENTRY → TRACE → MAP → REPORT
```

### Step 1: Identify Entry Points

Find where the behavior starts — user-facing triggers, API handlers, event consumers, CLI commands, or scheduled jobs.

```
FOR THE TARGET BEHAVIOR:
- What user action or system event triggers it?
- What's the entry-point file and exported symbol?
- What are the input shape and contract at entry?
```

### Step 2: Trace Execution to Boundaries

Follow the call chain layer by layer until you hit a boundary — service boundary, database, external API, async queue, or UI adapter.

```
AT EACH LAYER, RECORD:
- File path and exported symbol
- What it calls (next layer down)
- What calls it (previous layer up)
- State transformations (input → output shape changes)
- Branch conditions that materially change the path
```

### Step 3: Map the Full Picture

Distill the trace into a structured map:

```
PRIMARY PATH:
1. file_a.ts:handler() → receives HTTP request
2. file_b.ts:service() → validates, transforms
3. file_c.ts:repository() → builds query
4. db.ts:query() → executes SQL

CRITICAL FILES BY LAYER:
- Entry: src/api/handler.ts
- Service: src/services/orchestrator.ts
- Data: src/repositories/user-repo.ts
- External: src/clients/payment-gateway.ts

BRANCH POINTS:
- line 42: if (user.role === 'admin') → different permission check
- line 78: switch (event.type) → 4 handler paths

SIDE-EFFECT BOUNDARIES:
- Writes to: orders table, audit log
- Calls: payment API, email service
```

### Step 4: Surface Unknowns

Identify where confidence drops and what would resolve it:

```
UNKNOWNS:
- Does middleware_a.ts run before or after authentication?
  → Fastest check: read middleware registration in app.ts:15
- Are retries configured for the payment call?
  → Fastest check: grep for timeout/retry in src/clients/
```

## Quality Checks

- Distinguish definitive path from likely path — mark speculation explicitly
- Separate core behavior from supporting utilities (logging, metrics, helpers)
- Identify where tracing confidence drops and why
- Do not propose fixes, redesigns, or edits unless explicitly asked

## Output

Return the map in this structure:

```
PRIMARY OWNING PATH:
<ordered steps with files and symbols>

CRITICAL FILES/SYMBOLS BY LAYER:
<layer → file list>

HIGHEST-RISK BRANCH POINTS:
<what branches and why they matter>

UNRESOLVED UNKNOWNS:
<what's uncertain + fastest next check>
```

## Red Flags

- Proposing a fix or redesign when only a map was requested
- Tracing through generic utilities instead of the specific feature path
- Claiming certainty on a speculative path without marking it as such
- Skipping boundary layers (service, DB, external API) in the trace
- Mapping every possible path instead of the primary relevant path

## Interaction with Other Skills

- **`debugging-and-error-recovery`**: code-mapping is the first step of structured debugging — trace before you fix
- **`doubt-driven-development`**: use code-mapping to produce the ARTIFACT for adversarial review when the claim is about how code works
- **`incremental-implementation`**: use code-mapping to scope the change boundaries before implementation
- **`deprecation-and-migration`**: use code-mapping to identify all callers and side-effect dependencies before deprecating

## Verification

- [ ] Entry points identified for the target behavior
- [ ] Execution traced to all boundary layers (service, DB, external API, async, UI)
- [ ] Primary path distilled as ordered steps with file:line references
- [ ] Branch points and side-effect boundaries documented
- [ ] Unknowns surfaced with fastest resolution path for each
- [ ] Speculative paths explicitly marked, not asserted as fact
- [ ] No redesign proposals or code edits included (unless explicitly asked)
