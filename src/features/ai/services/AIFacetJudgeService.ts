import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { AIProfileFacetService } from './AIProfileFacetService';
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
