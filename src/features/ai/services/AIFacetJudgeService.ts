import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { AIProfileFacetService, withFacetLock } from './AIProfileFacetService';
import { AIEmbeddingService } from './AIEmbeddingService';

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

const MAX_EXCERPTS = 14;
const EXCERPT_CHARS = 2_000;

export type JudgeStatus = 'ok' | 'corrected' | 'flagged';
export interface JudgeLogEntry { label: string; status: JudgeStatus; issues: string[] }
export interface JudgeLog { at: number; entries: JudgeLogEntry[] }
export const JUDGE_LOG_KEY = 'ai_judge_log';

export const AIFacetJudgeService = {
  /** The last review's log (persisted), for the UI panel. */
  getLog(): JudgeLog | null {
    try {
      const raw = localStorage.getItem(JUDGE_LOG_KEY);
      return raw ? (JSON.parse(raw) as JudgeLog) : null;
    } catch {
      return null;
    }
  },

  async review(): Promise<{ judged: number; corrected: number; log: JudgeLogEntry[] }> {
    return withFacetLock(async () => {
    const facets = await AIProfileFacetService.getAll();
    if (facets.length === 0) return { judged: 0, corrected: 0, log: [] };

    const db = await getLocalDb();
    const summaries = (await db.getAll('aiSummaries')) as SummaryRow[];
    const embeddings = await AIEmbeddingService.getAll();

    const payload = facets.map(f => ({
      facetId: f.id,
      label: f.label,
      summary: f.summary,
      evidence: buildEvidence(f.noteIds, summaries),
    }));

    // Pack facets into judge calls BY SIZE — a call with several long summaries
    // overruns the function timeout (gpt-oss reasoning scales with content), so
    // fixed count-chunking silently dropped the biggest facets. Budget bounds
    // per-call work; a lone oversized facet still gets its own call.
    const CHUNK_CHAR_BUDGET = 3500;
    const CHUNK_MAX = 3;
    const chunks: (typeof payload)[] = [];
    let cur: typeof payload = [];
    let curLen = 0;
    for (const p of payload) {
      const len = p.summary.length + p.evidence.length;
      if (cur.length > 0 && (curLen + len > CHUNK_CHAR_BUDGET || cur.length >= CHUNK_MAX)) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(p);
      curLen += len;
    }
    if (cur.length > 0) chunks.push(cur);
    const results = await Promise.all(chunks.map(c => AIService.judgeFacets({ facets: c })));
    const verdicts = results.flatMap(r => (r.ok ? r.verdicts : []));
    if (verdicts.length === 0 && results.every(r => !r.ok)) {
      throw new Error('judge_call_failed');
    }

    let corrected = 0;
    const log: JudgeLogEntry[] = [];
    for (const v of verdicts) {
      const facet = facets.find(f => f.id === v.facetId);
      const label = facet?.label ?? v.facetId;
      if (v.ok || !v.hint) { log.push({ label, status: 'ok', issues: [] }); continue; }
      if (!facet) { log.push({ label, status: 'flagged', issues: v.issues }); continue; }

      const texts: string[] = [];
      for (const e of embeddings) {
        if (!facet.noteIds.includes(e.documentId)) continue;
        for (const t of e.chunkTexts ?? []) if (t.trim()) texts.push(t);
      }
      const excerpts = texts.slice(0, MAX_EXCERPTS).map(t => ({ title: '(фрагмент)', excerpt: t.slice(0, EXCERPT_CHARS) }));
      if (excerpts.length === 0) { log.push({ label, status: 'flagged', issues: v.issues }); continue; }

      const re = await AIService.summarizeFacet({ notes: excerpts, focus: facet.label, correction: v.hint });
      if (!re.ok || !re.summary) { log.push({ label, status: 'flagged', issues: v.issues }); continue; }

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
        log.push({ label, status: 'corrected', issues: v.issues });
      } else {
        // Keep the original summary (conservative), no second round.
        log.push({ label, status: 'flagged', issues: v.issues });
      }
    }

    try {
      localStorage.setItem(JUDGE_LOG_KEY, JSON.stringify({ at: Date.now(), entries: log } satisfies JudgeLog));
    } catch { /* quota — non-critical */ }
    return { judged: verdicts.length, corrected, log };
    });
  },
};
