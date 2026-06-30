# Facet-Summary Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM judge that compares each facet summary against structured ground-truth (people-roles, themes) and auto-corrects confabulating summaries via a targeted re-summary.

**Architecture:** A new limit-exempt `judgeFacets` callable batch-reviews all facet summaries in one call, returning `{ok, issues, hint}` per facet. `summarizeFacet` gains an optional `correction`. A client `AIFacetJudgeService` builds the evidence from local `aiSummaries`, calls the judge, re-summarizes flagged facets with the hint, re-judges once, and keeps the corrected summary only if it passes (else keeps the original). A background trigger runs the pass after facets are (re)summarized.

**Tech Stack:** TypeScript, React, Vitest (src tests), Firebase Cloud Functions v2 (onCall), Fireworks (gpt-oss-20b via `generate()`), `idb` (read/write IndexedDB).

## Global Constraints

- `judgeFacets` is **infra**, exempt from per-user limits — `tryReserveGlobalRequest()` only. Pattern: `functions/src/ai/summarizeFacet.ts`.
- Model `process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b'`; `maxTokens: 8192`; reuse the `repairTruncatedJson` salvage (gpt-oss truncates JSON — see `gptoss-reasoning-truncates-json`). Never `reasoning_effort:'low'`.
- **No INJECTION_PATTERNS check on the evidence** — it's derived metadata, not an instruction channel (false-positives on AI-quoting notes; see the deriveTaxonomy fix). `sanitizeAiInput` is still applied.
- One batch judge call per pass; **≤1 corrective round per facet**; on failed re-judge keep the ORIGINAL summary.
- Commit after each task. Do NOT push or deploy — the human gates that.
- v1 fully automatic, no user-facing review UI.

**Reference signatures (existing code, do not change):**
- `summarizeFacet` callable input (`functions/src/ai/summarizeFacet.ts`): `{ notes: { title: string; excerpt: string }[]; focus?: string | null }` → returns `{ label: string; summary: string }`.
- `AIService.summarizeFacet({ notes, focus })` → `{ ok: true; label; summary } | { ok: false; error }` (`src/features/ai/services/AIService.ts`). `AIService.embed`, `httpsCallable`, `getFunctions`, `reportError` already imported there.
- `aiSummaries` record (`src/core/storage/localDb.ts`): `{ documentId: string; themes: string[]; insights: string[]; mentionedPeople?: { name: string; role: string }[] }`.
- `AIProfileFacet` (`src/core/storage/localDb.ts`): `{ id: string; label: string; summary: string; noteIds: string[]; … }`.
- `AIProfileFacetService.getAll()` (`src/features/ai/services/AIProfileFacetService.ts`); facets written via `(await getLocalDb()).put('aiProfileFacets', facet)`.
- `AIEmbeddingService.getAll()` → embeddings `{ documentId; chunkTexts?: string[]; … }`.
- `generate({ system, messages, json, maxTokens, model })` (`functions/src/shared/aiProvider.ts`).

---

### Task 1: `summarizeFacet` optional `correction`

**Files:**
- Modify: `functions/src/ai/summarizeFacet.ts`
- Modify: `src/features/ai/services/AIService.ts`

**Interfaces:**
- Produces: `summarizeFacet` accepts `correction?: string | null`; `AIService.summarizeFacet({ notes, focus?, correction? })`.

- [ ] **Step 1: Add `correction` to the callable**

In `functions/src/ai/summarizeFacet.ts`, extend the input schema and prompt:

```ts
// inputSchema: add the field
const inputSchema = z.object({
  notes: z.array(z.object({ title: z.string().max(300), excerpt: z.string().max(8_000) })).min(1).max(60),
  focus: z.string().max(200).nullish().default(null),
  correction: z.string().max(500).nullish().default(null),  // NEW
});
```

After the existing `const system = focus ? … : SYSTEM_PROMPT;` block, append the correction:

```ts
const correction = parsed.data.correction ? sanitizeAiInput(parsed.data.correction) : '';
const systemWithCorrection = correction
  ? `${system}\nОБЯЗАТЕЛЬНО УЧТИ ПОПРАВКУ (она важнее прежнего текста): ${correction}`
  : system;
```

Then use `systemWithCorrection` in the `generate({ system: systemWithCorrection, … })` call (replace the `system` arg).

- [ ] **Step 2: Pass `correction` through the client wrapper**

In `src/features/ai/services/AIService.ts`, change `summarizeFacet`'s signature and call:

```ts
async summarizeFacet(params: { notes: { title: string; excerpt: string }[]; focus?: string; correction?: string }): Promise<
  { ok: true; label: string; summary: string } | { ok: false; error: string }
> {
  const functions = getFunctions();
  try {
    const fn = httpsCallable<unknown, { label: string; summary: string }>(functions, 'summarizeFacet');
    const res = await fn(params);
    return { ok: true, label: res.data.label ?? '', summary: res.data.summary ?? '' };
  } catch (e) {
    reportError(e, { action: 'summarizeFacet' });
    return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
  }
}
```

(If the existing method body differs, keep its shape and only add `correction?: string` to the params type — `params` is already forwarded to `fn(params)`, so no other change is needed.)

- [ ] **Step 3: Build + typecheck**

Run: `npm --prefix functions run build && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add functions/src/ai/summarizeFacet.ts src/features/ai/services/AIService.ts
git commit -m "feat(ai): summarizeFacet optional correction hint"
```

---

### Task 2: `judgeFacets` callable + client wrapper

**Files:**
- Create: `functions/src/ai/judgeFacets.ts`
- Modify: `functions/src/index.ts`
- Modify: `src/features/ai/services/AIService.ts`

**Interfaces:**
- Produces: callable `judgeFacets({ facets: { facetId; label; summary; evidence }[] }) → { verdicts: { facetId; ok; issues; hint }[] }`; client `AIService.judgeFacets(params) → { ok: true; verdicts } | { ok: false; error }`.

- [ ] **Step 1: Write the callable**

```ts
// functions/src/ai/judgeFacets.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

const JUDGE_MODEL = process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b';

const inputSchema = z.object({
  facets: z.array(z.object({
    facetId: z.string().min(1).max(64),
    label: z.string().max(120),
    summary: z.string().max(4_000),
    evidence: z.string().max(8_000),
  })).min(1).max(20),
});

const SYSTEM_PROMPT = `Ты — придирчивый фактчекер. Для каждого фасета сверь его ОПИСАНИЕ с приведёнными ФАКТАМИ (роли людей, темы). Отметь ok=false ТОЛЬКО если описание ПРОТИВОРЕЧИТ фактам или содержит выдуманное (имена, роли людей, события, числа, которых нет в фактах). К стилю и полноте НЕ придирайся. Верни СТРОГО валидный JSON:
{"verdicts":[{"facetId":"...","ok":true|false,"issues":["короткая претензия"],"hint":"одна строка-инструкция как поправить описание (например: Лариса — терапевт, не коллега)"}]}
Если всё верно — ok=true, issues=[], hint="". Только JSON, без markdown и рассуждений.`;

function repairTruncatedJson(raw: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of raw) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = raw;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const verdictSchema = z.object({
  facetId: z.string(),
  ok: z.boolean(),
  issues: z.array(z.string()).default([]),
  hint: z.string().default(''),
});

export const judgeFacets = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Registration required.');
  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');

  const facetsText = parsed.data.facets.map((f, i) =>
    `ФАСЕТ ${i + 1} [id=${sanitizeAiInput(f.facetId)}] «${sanitizeAiInput(f.label)}»\nОПИСАНИЕ: ${sanitizeAiInput(f.summary)}\nФАКТЫ: ${sanitizeAiInput(f.evidence)}`,
  ).join('\n\n');

  if (!(await tryReserveGlobalRequest())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: facetsText }],
      json: true,
      maxTokens: 8192,
      model: JUDGE_MODEL,
    });
    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'judge' }).catch(() => {});

    let txt = result.text.trim();
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    let obj: unknown;
    try { obj = JSON.parse(txt); } catch { obj = JSON.parse(repairTruncatedJson(txt)); }

    const arr = z.object({ verdicts: z.array(verdictSchema) }).safeParse(obj);
    if (!arr.success) {
      console.error('[AI judge] no valid verdicts. raw:', result.text.slice(0, 400));
      throw new HttpsError('internal', 'Judge produced no verdicts.');
    }
    const verdicts = arr.data.verdicts.map(v => ({
      facetId: v.facetId,
      ok: v.ok,
      issues: v.issues.map(s => sanitizeAiResponse(s)),
      hint: sanitizeAiResponse(v.hint),
    }));
    return { verdicts };
  } catch (e) {
    await refundGlobalRequest();
    const msg = String((e as { message?: string })?.message ?? e);
    if (!(e instanceof HttpsError)) console.error('[AI judge] failed:', msg);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', 'Facet judging failed.');
  }
});
```

- [ ] **Step 2: Export it**

```ts
// functions/src/index.ts — next to the deriveTaxonomy export
export { judgeFacets } from './ai/judgeFacets';
```

- [ ] **Step 3: Client wrapper**

```ts
// src/features/ai/services/AIService.ts — next to deriveTaxonomy
async judgeFacets(params: { facets: { facetId: string; label: string; summary: string; evidence: string }[] }): Promise<
  { ok: true; verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] } | { ok: false; error: string }
> {
  const functions = getFunctions();
  try {
    const fn = httpsCallable<unknown, { verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] }>(functions, 'judgeFacets');
    const res = await fn(params);
    return { ok: true, verdicts: res.data.verdicts ?? [] };
  } catch (e) {
    reportError(e, { action: 'judgeFacets' });
    return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
  }
},
```

- [ ] **Step 4: Build + live check**

Run: `npm --prefix functions run build && npx tsc --noEmit`
Expected: both exit 0.

Live check (key from `~/.zshrc`, never print it): POST one facet to gpt-oss-20b with the `SYSTEM_PROMPT`, where ОПИСАНИЕ says "коллега Лариса" but ФАКТЫ say "Лариса (терапевт)". Confirm the response parses to `verdicts` with `ok:false` and a hint mentioning терапевт.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/judgeFacets.ts functions/src/index.ts src/features/ai/services/AIService.ts
git commit -m "feat(ai): judgeFacets callable + client wrapper"
```

---

### Task 3: Evidence builder (client, pure)

**Files:**
- Create: `src/features/ai/services/AIFacetJudgeService.ts`
- Test: `src/features/ai/services/__tests__/AIFacetJudgeService.test.ts`

**Interfaces:**
- Produces: `buildEvidence(noteIds: string[], summaries: SummaryRow[], opts?: { maxThemes?; maxPeople? }): string` and `interface SummaryRow { documentId: string; themes?: string[]; insights?: string[]; mentionedPeople?: { name: string; role: string }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/services/__tests__/AIFacetJudgeService.test.ts
import { describe, it, expect } from 'vitest';
import { buildEvidence, type SummaryRow } from '../AIFacetJudgeService';

const rows: SummaryRow[] = [
  { documentId: 'n1', themes: ['отвержение', 'доверие'], insights: ['боится просить'], mentionedPeople: [{ name: 'Лариса', role: 'терапевт' }] },
  { documentId: 'n2', themes: ['отвержение'], insights: [], mentionedPeople: [{ name: 'Лариса', role: 'терапевт' }, { name: 'Наташа', role: 'знакомая' }] },
  { documentId: 'n3', themes: ['деньги'], insights: [], mentionedPeople: [] },
];

describe('buildEvidence', () => {
  it('aggregates dedup people-roles for the facet notes only', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('Лариса — терапевт');
    expect(ev).toContain('Наташа — знакомая');
    expect(ev).not.toContain('деньги'); // n3 excluded
  });

  it('includes top themes by frequency', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('отвержение');
  });

  it('returns a non-empty string even with no people', () => {
    const ev = buildEvidence(['n3'], rows);
    expect(ev).toContain('деньги');
    expect(typeof ev).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/services/__tests__/AIFacetJudgeService.test.ts`
Expected: FAIL — `Cannot find module '../AIFacetJudgeService'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/ai/services/AIFacetJudgeService.ts
export interface SummaryRow {
  documentId: string;
  themes?: string[];
  insights?: string[];
  mentionedPeople?: { name: string; role: string }[];
}

export function buildEvidence(
  noteIds: string[],
  summaries: SummaryRow[],
  opts: { maxThemes?: number; maxPeople?: number } = {},
): string {
  const { maxThemes = 8, maxPeople = 10 } = opts;
  const idSet = new Set(noteIds);
  const rows = summaries.filter(s => idSet.has(s.documentId));

  const people = new Map<string, string>(); // name -> role (first non-empty)
  const themeFreq = new Map<string, number>();
  const insights: string[] = [];
  for (const r of rows) {
    for (const p of r.mentionedPeople ?? []) {
      if (p.name && !people.has(p.name)) people.set(p.name, p.role || '?');
    }
    for (const t of r.themes ?? []) themeFreq.set(t, (themeFreq.get(t) ?? 0) + 1);
    for (const i of r.insights ?? []) if (i) insights.push(i);
  }

  const topThemes = [...themeFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxThemes).map(([t]) => t);
  const peopleList = [...people.entries()].slice(0, maxPeople).map(([n, role]) => `${n} — ${role}`);

  const parts: string[] = [];
  if (peopleList.length) parts.push(`Люди (имя — роль): ${peopleList.join('; ')}`);
  if (topThemes.length) parts.push(`Темы: ${topThemes.join(', ')}`);
  if (insights.length) parts.push(`Инсайты: ${insights.slice(0, 6).join('; ')}`);
  return parts.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/ai/services/__tests__/AIFacetJudgeService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/services/AIFacetJudgeService.ts src/features/ai/services/__tests__/AIFacetJudgeService.test.ts
git commit -m "feat(ai): facet judge evidence builder"
```

---

### Task 4: `review()` orchestrator

**Files:**
- Modify: `src/features/ai/services/AIFacetJudgeService.ts`
- Test: `src/features/ai/services/__tests__/AIFacetJudgeService.test.ts`

**Interfaces:**
- Consumes: `buildEvidence`, `AIService.judgeFacets`, `AIService.summarizeFacet`, `AIProfileFacetService.getAll`, `getLocalDb`, `AIEmbeddingService.getAll`.
- Produces: `AIFacetJudgeService.review(): Promise<{ judged: number; corrected: number }>`.

- [ ] **Step 1: Write the failing test (mock AIService + db)**

```ts
// add to AIFacetJudgeService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIFacetJudgeService } from '../AIFacetJudgeService';

const judgeMock = vi.fn();
const summarizeMock = vi.fn();
vi.mock('../AIService', () => ({ AIService: { judgeFacets: (...a: unknown[]) => judgeMock(...a), summarizeFacet: (...a: unknown[]) => summarizeMock(...a) } }));

const putMock = vi.fn();
vi.mock('../AIProfileFacetService', () => ({ AIProfileFacetService: { getAll: vi.fn(async () => [
  { id: 'f1', label: 'Доверие', summary: 'коллега Лариса', noteIds: ['n1'] },
]) } }));
vi.mock('../../../../core/storage/localDb', () => ({ getLocalDb: vi.fn(async () => ({
  getAll: vi.fn(async (store: string) => store === 'aiSummaries'
    ? [{ documentId: 'n1', themes: ['доверие'], insights: [], mentionedPeople: [{ name: 'Лариса', role: 'терапевт' }] }]
    : []),
  put: putMock,
})) }));
vi.mock('../AIEmbeddingService', () => ({ AIEmbeddingService: { getAll: vi.fn(async () => []) } }));

describe('AIFacetJudgeService.review', () => {
  beforeEach(() => { judgeMock.mockReset(); summarizeMock.mockReset(); putMock.mockReset(); });

  it('re-summarizes a flagged facet with the hint and stores the corrected summary', async () => {
    judgeMock
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: false, issues: ['роль'], hint: 'Лариса — терапевт' }] })
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    summarizeMock.mockResolvedValue({ ok: true, label: 'Доверие', summary: 'терапевт Лариса' });

    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).toHaveBeenCalledWith(expect.objectContaining({ correction: 'Лариса — терапевт' }));
    expect(putMock).toHaveBeenCalledWith('aiProfileFacets', expect.objectContaining({ summary: 'терапевт Лариса' }));
    expect(res.corrected).toBe(1);
  });

  it('writes nothing when all facets pass', async () => {
    judgeMock.mockResolvedValue({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(res.corrected).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/services/__tests__/AIFacetJudgeService.test.ts -t review`
Expected: FAIL — `AIFacetJudgeService` is not exported.

- [ ] **Step 3: Implement `review()`**

```ts
// add to AIFacetJudgeService.ts
import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { AIProfileFacetService } from './AIProfileFacetService';
import { AIEmbeddingService } from './AIEmbeddingService';

const MAX_EXCERPTS = 14;
const EXCERPT_CHARS = 2_000;

export const AIFacetJudgeService = {
  async review(): Promise<{ judged: number; corrected: number }> {
    const facets = await AIProfileFacetService.getAll();
    if (facets.length === 0) return { judged: 0, corrected: 0 };

    const db = await getLocalDb();
    const summaries = (await db.getAll('aiSummaries')) as SummaryRow[];
    const embeddings = await AIEmbeddingService.getAll();

    const payload = facets.map(f => ({
      facetId: f.id,
      label: f.label,
      summary: f.summary,
      evidence: buildEvidence(f.noteIds, summaries),
    }));

    const judged = await AIService.judgeFacets({ facets: payload });
    if (!judged.ok) return { judged: 0, corrected: 0 };

    let corrected = 0;
    for (const v of judged.verdicts) {
      if (v.ok || !v.hint) continue;
      const facet = facets.find(f => f.id === v.facetId);
      if (!facet) continue;

      const texts: string[] = [];
      for (const e of embeddings) {
        if (!facet.noteIds.includes(e.documentId)) continue;
        for (const t of e.chunkTexts ?? []) if (t.trim()) texts.push(t);
      }
      const excerpts = texts.slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
      if (excerpts.length === 0) continue;

      const re = await AIService.summarizeFacet({ notes: excerpts, focus: facet.label, correction: v.hint });
      if (!re.ok || !re.summary) continue;

      // Re-judge the single corrected facet once.
      const recheck = await AIService.judgeFacets({
        facets: [{ facetId: facet.id, label: facet.label, summary: re.summary, evidence: buildEvidence(facet.noteIds, summaries) }],
      });
      const passed = recheck.ok && recheck.verdicts[0]?.ok;
      if (passed) {
        facet.summary = re.summary;
        facet.updatedAt = Date.now();
        await db.put('aiProfileFacets', facet);
        corrected++;
      }
      // else: keep the original summary (conservative), no second round.
    }

    return { judged: judged.verdicts.length, corrected };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/ai/services/__tests__/AIFacetJudgeService.test.ts`
Expected: PASS (evidence + review tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/services/AIFacetJudgeService.ts src/features/ai/services/__tests__/AIFacetJudgeService.test.ts
git commit -m "feat(ai): facet judge review loop with conservative correction"
```

---

### Task 5: Background trigger

**Files:**
- Modify: `src/features/ai/hooks/useEmbeddingIndexer.ts`

**Interfaces:**
- Consumes: `AIFacetJudgeService.review`.

- [ ] **Step 1: Wire the trigger after dirty re-summary**

In `scheduleResummarize`, after the `resummarizeDirty().then(...)` block reports its count (where the portrait auto-regenerate is triggered), add a best-effort judge pass so corrections happen right after summaries are (re)written:

```ts
import { AIFacetJudgeService } from '../services/AIFacetJudgeService';
// inside the resummarizeDirty().then(r => { ... }) callback, after the portrait regen:
void AIFacetJudgeService.review()
  .then(j => { if (j.corrected > 0) console.warn(`[useEmbeddingIndexer] judge corrected ${j.corrected}/${j.judged} facets`); })
  .catch(e => reportError(e, { action: '[useEmbeddingIndexer] facet judge failed' }));
```

(It self-guards: no facets → no call. Cost is one batch judge call + re-summaries only for flagged facets.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Verify ai tests still pass**

Run: `npx vitest run src/features/ai/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/hooks/useEmbeddingIndexer.ts
git commit -m "feat(ai): run facet judge after dirty re-summary"
```

---

### Task 6: Ground-truth validation (manual gate)

**Files:** none (verification only).

- [ ] **Step 1: Full check**

Run: `npm run typecheck && npm run lint && npx vitest run src/features/ai/ && npm --prefix functions run build`
Expected: all green.

- [ ] **Step 2: Live ground-truth**

With `judgeFacets` deployed (human gates the deploy), on the author's profile (which has the "коллега Лариса" / "партнёр Наташа" errors), trigger a judge pass and confirm: those facets are flagged `ok:false`, re-summarized with the role correction, and the stored summary no longer mislabels Лариса/Наташа/Феруза. Record the before/after in the commit/PR notes. This is the success criterion.

- [ ] **Step 3: No commit** (verification only). Report results to the human for the deploy/version decision.

---

## Self-Review

- **Spec coverage:** judgeFacets callable (T2) ✓; evidence builder from aiSummaries people-roles/themes (T3) ✓; summarizeFacet correction (T1) ✓; review() loop with re-judge + conservative keep-original (T4) ✓; background trigger (T5) ✓; ground-truth validation (T6) ✓. Batch-one-call + ≤1 round + grounded judge all enforced in T2/T4.
- **Placeholders:** none — every code step has concrete code; the live checks specify exact inputs/expected.
- **Type consistency:** `buildEvidence(noteIds, summaries)`, `SummaryRow`, `judgeFacets({facets:{facetId,label,summary,evidence}[]})→{verdicts:{facetId,ok,issues,hint}[]}`, `summarizeFacet({notes,focus?,correction?})`, `review()→{judged,corrected}` are consistent across T1–T5.
