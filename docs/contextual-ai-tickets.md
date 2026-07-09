# Contextual AI Tickets — July 2026

Self-contained. Prefix: `CTX-`. Goal: make the AI aware of what's in the user's notes at all times — temporal queries, proactive context, cross-note intelligence. Implement in dependency order: CTX-3 → CTX-4 → CTX-5 → CTX-1 → CTX-2 → CTX-6 → CTX-7 → CTX-8 → CTX-9 → CTX-10.

---

## CTX-3 — Event Timeline: aggregate extractedFacts by date into a queryable IDB store 🔴

**Context:** `src/core/storage/localDb.ts`, `src/features/ai/services/AISummaryService.ts`

`extractedFacts` exists in every `AIDocumentSummary` but are isolated per document. There's no way to answer "what happened in April" because facts are never cross-referenced with the note's date. This is the foundational store for temporal queries.

**New IDB store** (bump version 9 → 10):
```ts
// localDb.ts — add to JustWritingDB schema:
aiTimeline: {
  key: string;          // documentId (one entry per document)
  value: {
    documentId: string;
    date: string;       // YYYY-MM-DD from document's lastSessionAt
    month: string;      // YYYY-MM for easy range queries
    facts: string[];    // extractedFacts from the summary
    summary?: string;   // AIDocumentSummary.summary (1-2 sentence overview)
    tone?: string;
    themes?: string[];
  };
  indexes: { 'by-month': string; 'by-date': string };
};
```

**Tasks:**
1. In `localDb.ts`: bump DB version to 10, add `aiTimeline` store with indexes `by-month` (on `month`) and `by-date` (on `date`).
2. In `AISummaryService.save(summary)`: after saving to `aiSummaries`, look up the document's `lastSessionAt` from `documents` store and upsert an `aiTimeline` entry:
   ```ts
   const doc = await db.get('documents', summary.documentId);
   if (doc?.lastSessionAt) {
     const d = new Date(doc.lastSessionAt);
     await db.put('aiTimeline', {
       documentId: summary.documentId,
       date: d.toISOString().slice(0, 10),
       month: d.toISOString().slice(0, 7),
       facts: summary.extractedFacts ?? [],
       summary: summary.summary,
       tone: summary.tone,
       themes: summary.themes ?? [],
     });
   }
   ```
3. In `AISummaryService.delete(documentId)`: also `db.delete('aiTimeline', documentId)`.
4. Add a one-time migration helper `AITimelineService.rebuildFromSummaries()` that reads all `aiSummaries` + `documents` and populates `aiTimeline` from scratch. Call it once from `DiagnosticsPage` (a button is fine).
5. Add `AITimelineService` at `src/features/ai/services/AITimelineService.ts` with:
   - `getByMonth(month: string)` → `AITimelineEntry[]`
   - `getByDateRange(from: string, to: string)` → `AITimelineEntry[]`
   - `rebuildFromSummaries()` → `Promise<number>` (count of entries built)

**Acceptance:** After saving a summary, `db.getAll('aiTimeline')` contains an entry for that document with correct `date`, `month`, and `facts`. `getByMonth('2026-04')` returns all entries for April 2026.

---

## CTX-4 — Monthly Digest: precompute a short narrative per calendar month 🔴

**Context:** `src/features/ai/services/AITimelineService.ts` (from CTX-3), `src/features/ai/services/AIService.ts`

When the user asks "what happened in April", the ideal response is a narrative paragraph, not a raw list of facts. This store precomputes it so no LLM call is needed at query time.

**New IDB store** (bump version 10 → 11):
```ts
aiMonthlyDigest: {
  key: string;   // YYYY-MM
  value: {
    month: string;       // YYYY-MM
    narrative: string;   // 3-5 sentence plain text summary of that month
    tones: string[];     // dominant tones
    themes: string[];    // recurring themes
    noteCount: number;
    generatedAt: number;
  };
};
```

**New service:** `src/features/ai/services/AIMonthlyDigestService.ts`

**Tasks:**
1. Bump DB version to 11, add `aiMonthlyDigest` store.
2. `AIMonthlyDigestService.generateForMonth(month: string)`:
   - Load all `aiTimeline` entries for that month via `AITimelineService.getByMonth(month)`.
   - If fewer than 2 entries → skip (not enough data).
   - Call `AIService.summarizeFacet({ notes: entries.map(e => ({ title: e.date, excerpt: [e.summary, ...e.facts].join('. ') })), focus: `${month} дневник` })` using the existing facet summarizer.
   - Store result in `aiMonthlyDigest`.
3. `AIMonthlyDigestService.get(month: string)` → `AIMonthlyDigest | undefined`.
4. `AIMonthlyDigestService.getRecent(n = 3)` → last N months that have a digest.
5. **Trigger generation:** in `AISummaryService.save()`, after updating `aiTimeline`, check if the current month's digest is older than 24 hours (or absent) and call `generateForMonth(currentMonth)` fire-and-forget (don't await, non-blocking).

**Acceptance:** After summarizing 3+ notes from April, `db.get('aiMonthlyDigest', '2026-04')` returns a non-empty `narrative` string. Re-runs after new notes are added to the month.

---

## CTX-5 — People Index: cross-note person tracking 🟠

**Context:** `src/core/storage/localDb.ts`, `src/features/ai/services/AISummaryService.ts`

`mentionedPeople` exists in every summary but is never aggregated. There's no way to answer "tell me about Наташа" or "who do I write about most?" without scanning all summaries.

**New IDB store** (bump version 11 → 12):
```ts
aiPeopleIndex: {
  key: string;   // person name lowercased (canonical)
  value: {
    name: string;         // display name (capitalized)
    role: string;         // most recent role seen
    noteIds: string[];    // all documentIds where mentioned
    lastMentionedAt: number;  // timestamp of most recent note
    mentionCount: number;
  };
  indexes: { 'by-lastMentioned': number };
};
```

**Tasks:**
1. Bump DB to 12, add `aiPeopleIndex` store with index `by-lastMentioned`.
2. In `AISummaryService.save(summary)`, after saving, upsert `aiPeopleIndex` for each entry in `summary.mentionedPeople ?? []`:
   - Key = `p.name.trim().toLowerCase()`
   - Merge with existing entry: push `summary.documentId` to `noteIds` if not already present, update `lastMentionedAt` from the note's `lastSessionAt`, update `role` if non-empty.
3. In `AISummaryService.delete(documentId)`: remove `documentId` from `noteIds` in all matching people entries; delete person entry if `noteIds` becomes empty.
4. Add `AIPeopleService` at `src/features/ai/services/AIPeopleService.ts`:
   - `getAll()` → sorted by `mentionCount` desc
   - `search(name: string)` → fuzzy match against stored names
   - `getForNote(documentId: string)` → people mentioned in a specific note

**Acceptance:** After saving summaries that mention "Наташа" and "Дима", `AIPeopleService.getAll()` returns both with correct `noteIds` and `mentionCount`. Adding the same person in two notes increments `mentionCount`, not duplicates.

---

## CTX-1 — Temporal Search: "что было в апреле" / "что я писал в марте" 🔴

**Context:** `src/features/ai/hooks/useAIChat.ts:30–43` (`NOTE_SEARCH_PATTERNS`, `looksLikeNoteSearch`), `src/features/ai/services/AITimelineService.ts` (CTX-3), `src/features/ai/services/AIPeopleService.ts` (CTX-5)

**Depends on:** CTX-3, CTX-5

Currently `looksLikeNoteSearch` has no patterns for time ("в апреле", "в прошлом году") or people ("про Наташу"). Temporal queries fall through to semantic search which doesn't understand dates.

**New module:** `src/features/ai/utils/temporalQueryParser.ts`

```ts
export interface TemporalQuery {
  type: 'month' | 'dateRange' | 'recent' | 'person' | 'none';
  month?: string;        // YYYY-MM if type=month
  from?: string;         // YYYY-MM-DD if type=dateRange
  to?: string;
  personName?: string;   // if type=person
  rawText: string;
}

export function parseTemporalQuery(text: string): TemporalQuery;
```

**Tasks:**
1. Create `temporalQueryParser.ts`. Implement `parseTemporalQuery`:
   - Match month names in Russian (nominative + genitive): "январе/января", "феврале/февраля", ... "декабре/декабря" → extract `YYYY-MM` using current year (or explicit year if mentioned: "в апреле 2025").
   - Match relative: "на прошлой неделе" → `dateRange` last 7 days; "в прошлом месяце" → previous calendar month; "в этом году" → `YYYY-01-01` to today; "давно" / "в начале года" → rough ranges.
   - Match person: "про Наташу", "о Диме", "с Сашей" → `type: 'person'`, `personName: 'Наташа'`.
   - Match catch-up: "что было", "напомни", "расскажи что происходило" → `type: 'recent'`.
2. Extend `NOTE_SEARCH_PATTERNS` in `useAIChat.ts` with temporal patterns:
   ```ts
   /\b(в|за|про)\s+(январ|феврал|март|апрел|ма[йе]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i,
   /\b(прошл|этой?|следующ)\s+(недел|месяц|год)/i,
   /\bчто\s+было\b|\bнапомни\b|\bрасскажи\s+что/i,
   ```
3. In `useAIChat.ts`, after `explicitSearch` is set to true, call `parseTemporalQuery(text)`. If result is not `type: 'none'`:
   - For `type: 'month'`: load `AITimelineService.getByMonth(month)` instead of semantic search. Build a text block: `"В ${monthName}: ${entries.flatMap(e => e.facts).join('; ')}. Было ${entries.length} заметок."`. Also load `AIMonthlyDigestService.get(month)` and prepend its `narrative` if available.
   - For `type: 'dateRange'`: `AITimelineService.getByDateRange(from, to)`, same assembly.
   - For `type: 'person'`: `AIPeopleService.search(personName)`, load those note IDs from semantic search filtered to those docs.
   - For `type: 'recent'`: handled by CTX-6.
   - Set this assembled block as `searchContext` (skip semantic search for temporal queries entirely).

**Acceptance:** "Что было в апреле?" returns facts from April notes without a semantic embed call. "Расскажи про Наташу" loads notes mentioning Наташа. "На прошлой неделе" returns the last 7 days of facts.

---

## CTX-2 — Proactive Recent Context on New Dialogue 🟠

**Context:** `src/features/ai/hooks/useAIChat.ts`, `src/features/ai/services/AIMonthlyDigestService.ts` (CTX-4)

**Depends on:** CTX-4

When a new dialogue is opened (0 messages), the AI has no idea what's happening in the user's life. The `userPortrait` is static. A freshness layer — "what you wrote this week" — would make the AI immediately relevant.

**Tasks:**
1. In `useAIChat.ts`, after loading `userPortrait` (around line 548), if `messages.length === 0` (first turn):
   - Load `AIMonthlyDigestService.getRecent(2)` → last 2 months with digests.
   - Load the 3 most recent `aiSummaries` from `documents` sorted by `lastSessionAt` (take the 3 most recent documentIds, load their summaries).
   - Build a `recentBlock`:
     ```
     [Что ты писал недавно]
     ${currentMonthDigest.narrative}
     
     Последние заметки:
     - «${title}»: ${summary.summary ?? summary.tone}
     - ...
     ```
   - Prepend `recentBlock` to `searchContext` (before the date line). Cap at 2000 chars.
2. Only inject on first turn (`messages.length === 0`) and only if the user's message is NOT a direct note search (don't double-inject context with semantic search results).
3. Add a ref `recentContextInjectedRef` so the block is not re-injected on subsequent turns.

**Acceptance:** Opening a fresh dialogue and sending "привет" results in the AI having the last 2 months' digest and 3 most recent note summaries as context. Second and subsequent messages in the same dialogue do not re-inject this block.

---

## CTX-6 — Catch-Me-Up Handler: "напомни что было" 🟠

**Context:** `src/features/ai/hooks/useAIChat.ts`, `src/features/ai/utils/temporalQueryParser.ts` (CTX-1), `src/features/ai/services/AITimelineService.ts` (CTX-3), `src/features/ai/services/AIMonthlyDigestService.ts` (CTX-4)

**Depends on:** CTX-1, CTX-3, CTX-4

When the user's first message is a catch-up request ("напомни что было", "что у меня происходит", "расскажи что я писал"), the current semantic search returns nothing useful because there's no query vector to match against.

**Tasks:**
1. In `temporalQueryParser.ts`, ensure `type: 'recent'` is returned for catch-up phrases: "напомни", "что у меня", "что я писал", "что происходит", "кратко что было".
2. In `useAIChat.ts`, when `parseTemporalQuery` returns `type: 'recent'`:
   - Load last 3 monthly digests via `AIMonthlyDigestService.getRecent(3)`.
   - Load last 10 `aiTimeline` entries sorted by `date` desc.
   - Assemble into a catch-up block:
     ```
     За последние месяцы:
     ${digest3.month}: ${digest3.narrative}
     ${digest2.month}: ${digest2.narrative}
     ${digest1.month}: ${digest1.narrative}
     
     Последние события:
     - [дата]: ${fact}
     - ...
     ```
   - Set as `searchContext`, skip semantic search.
3. In the system prompt context this becomes `documentContent`. The AI is prompted to use it as a briefing and summarise it naturally for the user.

**Acceptance:** "Напомни что у меня происходило" returns a chronological briefing of the last 3 months without any embedding call. Empty digests (no notes in a month) are skipped gracefully.

---

## CTX-7 — Cross-Dialogue Memory: AI remembers previous conversations 🟠

**Context:** `src/core/storage/localDb.ts:75–90` (`AIDialogue`), `src/features/ai/services/AIDialogueService.ts`, `src/features/ai/hooks/useAIChat.ts`

Each new dialogue with a persona starts from scratch. If the user discussed their anxiety with the CBT therapist last week, the next session has no idea.

**Schema change — add `closingSummary` to `AIDialogue`:**
```ts
// localDb.ts AIDialogue interface — add:
closingSummary?: string;  // 1-2 sentence summary generated when dialogue is archived/closed
```

**New service function in `AIDialogueService`:**
```ts
async generateClosingSummary(id: string): Promise<void>
```

**Tasks:**
1. Add `closingSummary?: string` to `AIDialogue` interface in `localDb.ts` (no DB version bump needed — optional field on existing store).
2. In `AIDialogueService`, add `generateClosingSummary(id)`:
   - Load dialogue. If < 4 messages → skip.
   - Call `AIService.chat` with `personaId: 'custom'`, `customSystemPrompt: 'Составь 1-2 предложения: о чём был этот диалог и к какому выводу пришли. Только факты, без оценок.'`, messages = last 10 turns.
   - Store result in `dialogue.closingSummary`.
3. Call `generateClosingSummary` fire-and-forget when a dialogue is archived (`AIDialogueService.archive(id)`).
4. In `useAIChat.ts`, when starting a new dialogue AND the same persona has previous archived dialogues:
   - Load last 3 archived dialogues with this `personaId` that have `closingSummary`.
   - Build a `previousContext` block:
     ```
     [Предыдущие сессии с этим персонажем]
     - ${date}: ${closingSummary}
     - ${date}: ${closingSummary}
     ```
   - Inject into `searchContext` on first turn only (same guard as CTX-2).

**Acceptance:** Archiving a dialogue with 10+ messages generates a `closingSummary`. Opening a new CBT dialogue shows the AI 2-3 prior session summaries in its context. The AI can say "в прошлый раз мы говорили о...".

---

## CTX-8 — Mood Timeline: emotional arc over weeks/months 🟡

**Context:** `src/core/storage/localDb.ts`, `src/features/ai/services/AITimelineService.ts` (CTX-3)

**Depends on:** CTX-3

The `tone` field in each summary is never aggregated. The AI can't answer "как я себя чувствовал в марте" or notice that anxiety has been increasing.

**Tasks:**
1. Extend `AITimelineEntry` (from CTX-3) to include `tone` — it's already in the schema above. No new store needed.
2. Add to `AITimelineService`:
   ```ts
   getMoodByMonth(month: string): Promise<{ tone: string; count: number }[]>
   getMoodTrend(months = 3): Promise<{ month: string; dominantTone: string; toneDistribution: Record<string, number> }[]>
   ```
   - `getMoodTrend`: load last N months' timeline entries, count tone occurrences per month, return sorted by month.
3. In `AIMonthlyDigestService.generateForMonth()` (CTX-4), add tone distribution to the digest:
   - Compute dominant tone for the month from timeline entries.
   - Append to narrative: "Преобладающий тон месяца: {tone}."
4. In `useAIChat.ts`, when the persona is `cbt` or `group_psychology` AND it's a new dialogue (first turn), load `getMoodTrend(3)` and append to the `recentBlock` (CTX-2):
   ```
   Динамика настроения: апрель — задумчивый, май — тревожный, июнь — противоречивый.
   ```

**Acceptance:** After summarizing notes from 3 months, `getMoodTrend(3)` returns correct dominant tones per month. The CBT persona receives mood trend in its first-turn context.

---

## CTX-9 — Smart Opening Hook: "хочешь поговорить о том, что писал вчера?" 🟡

**Context:** `src/features/ai/pages/AIPage.tsx` or the dialogue list UI, `src/features/ai/services/AITimelineService.ts` (CTX-3)

**Depends on:** CTX-3

When opening the AI section, show a one-click hook suggesting the most recent unprocessed/recent note as a conversation starter. Non-intrusive — appears only if last note is less than 3 days old and hasn't been attached to a dialogue yet.

**Tasks:**
1. Add `AITimelineService.getMostRecent(n = 1)` → last N `AITimelineEntry` sorted by `date` desc.
2. In `AIPage.tsx` (or wherever the dialogue list lives), on mount:
   - Load the most recent timeline entry.
   - If `entry.date` is within the last 3 days AND `entry.documentId` doesn't appear in any non-archived `aiDialogues` messages as an attachment:
   - Show a dismissible banner above the dialogue list:
     > "Хочешь поговорить о том, что писал {дата}? [{entry.summary ?? первая тема}]"
   - Two buttons: "Открыть диалог" (creates new dialogue with that note attached) and "×" dismiss (stores dismissed documentId in localStorage to avoid re-showing).
3. Banner is dismissible per-note (not globally). If user opens the dialogue, never show it again for that note.

**Acceptance:** If last note was written yesterday, a suggestion banner appears on the AI page. Clicking "Открыть диалог" opens a new dialogue with the note pre-attached. Clicking × hides the banner until a newer note is written.

---

## CTX-10 — Temporal Date Labels in Search Results 🟡

**Context:** `src/features/ai/hooks/useAIChat.ts` (note block assembly, around line 900), `src/features/ai/utils/noteRetriever.ts`

When notes are shown to the AI and user as search results, the date of each note is invisible. The AI answers "ты писал X" without saying when. Knowing "три недели назад" or "в апреле" dramatically improves usefulness.

**Tasks:**
1. `RetrievedNote` interface already has `lastSessionAt?: number`. Add a `relativeDate(ts: number): string` utility at `src/core/utils/dateUtils.ts`:
   ```ts
   // Returns "сегодня", "вчера", "3 дня назад", "2 недели назад", "в апреле", "в марте 2025"
   export function relativeDate(ts: number): string
   ```
   - < 1 day → "сегодня"
   - 1 day → "вчера"
   - 2–6 days → "N дней назад"
   - 1–3 weeks → "на прошлой неделе" / "2 недели назад"
   - Same year, different month → "в {месяц}" (локализованный русский)
   - Different year → "в {месяц} {год}"
2. In `useAIChat.ts`, in the note block assembly (currently `Заметка N: "${n.title}"`), prepend the date:
   ```ts
   const dateLabel = n.lastSessionAt ? relativeDate(n.lastSessionAt) : '';
   parts.push(`Заметка ${noteIdx} (${dateLabel}): "${n.title}"\n${summaryPrefix}${snippet}`);
   ```
3. In `AITimelineService.getByMonth()` / `getByDateRange()` results (CTX-1), also format dates when assembling the context block so the AI knows exact dates.
4. When the AI surface references a specific note to the user in the chat UI, show the date label next to the note title chip/badge (if there's such a UI element).

**Acceptance:** AI chat response about a retrieved note includes the time reference: "Вот что ты писал три недели назад..." The note header in `searchContext` reads: `Заметка 1 (в апреле): "Рабочие мысли"`.

---

## Implementation order and dependencies

```
CTX-3 (Timeline store) ←─── CTX-1 (Temporal search)
      ↓                         ↓
CTX-4 (Monthly digest) ←─── CTX-2 (Proactive context)
      ↓                         ↓
CTX-5 (People index) ←──── CTX-6 (Catch-me-up)

CTX-7 (Cross-dialogue)     — independent, needs AIDialogue.closingSummary
CTX-8 (Mood timeline)      — depends on CTX-3 (uses timeline.tone)
CTX-9 (Smart opening)      — depends on CTX-3
CTX-10 (Date labels)       — mostly independent, needs relativeDate util
```

**IDB version bump summary:**
- Version 10: add `aiTimeline` (CTX-3)
- Version 11: add `aiMonthlyDigest` (CTX-4)
- Version 12: add `aiPeopleIndex` (CTX-5)

Each bump must be guarded with `if (oldVersion < N)` in the upgrade handler.
