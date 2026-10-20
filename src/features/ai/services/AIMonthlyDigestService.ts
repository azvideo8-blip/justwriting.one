import { getLocalDb, type AIMonthlyDigest } from '../../../core/storage/localDb';
import { AITimelineService } from './AITimelineService';
import { AIService } from './AIService';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';


import type { CallAiOptions } from '../../../core/ai/callAi';

// Дедупликация одновременной пересборки одного месяца. Единственный вызов —
// обновление профиля по нажатию человека (AIProfileRefreshService), но оно идёт
// по месяцам подряд; без стража повторный вход в тот же месяц платил бы за
// вторую summarizeFacet, пока первая ещё не записала дайджест.
const inFlightMonths = new Set<string>();

export const AIMonthlyDigestService = {
  async generateForMonth(month: string, opts?: CallAiOptions): Promise<void> {
    if (inFlightMonths.has(month)) return;
    inFlightMonths.add(month);
    try {
      await generateForMonthInner(month, opts);
    } finally {
      inFlightMonths.delete(month);
    }
  },

  async get(month: string): Promise<AIMonthlyDigest | undefined> {
    const db = await getLocalDb();
    const digest = await db.get('aiMonthlyDigest', month);
    return digest && (await coversOnlyLiveNotes(digest)) ? digest : undefined;
  },

  async getRecent(n = 3): Promise<AIMonthlyDigest[]> {
    const db = await getLocalDb();
    const all = (await db.getAll('aiMonthlyDigest')).sort((a, b) => b.month.localeCompare(a.month));
    const out: AIMonthlyDigest[] = [];
    for (const d of all) {
      if (out.length >= n) break;
      if (await coversOnlyLiveNotes(d)) out.push(d);
    }
    return out;
  },

  /** AP-1: месяц, в котором лежала скрытая или удалённая заметка, больше не хранится. */
  async deleteMonth(month: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiMonthlyDigest', month);
    LocalStoreSyncService.scheduleStoreDelete('aiMonthlyDigest', month);
  },
};

async function generateForMonthInner(month: string, opts?: CallAiOptions): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.get('aiMonthlyDigest', month);

    const entries = await AITimelineService.getByMonth(month);
    // Дайджест собран из хронологии, а она скрытые и корзинные заметки уже не
    // отдаёт. Если живых записей осталось меньше двух, пересобирать не из чего:
    // удаляем дайджест, иначе он продолжает пересказывать скрытое.
    if (entries.length < 2) {
      if (existing) await AIMonthlyDigestService.deleteMonth(month);
      return;
    }

    // 24-часовой страж бережёт от второй платной пересборки, но не от
    // устаревшего текста: noteCount больше числа живых записей значит, что
    // заметки скрыли или удалили, — тогда пересобираем, не дожидаясь суток.
    const staleCount = existing ? !(await coversOnlyLiveNotes(existing)) : false;
    if (existing && !staleCount && Date.now() - existing.generatedAt < 24 * 60 * 60 * 1000) {
      return;
    }

    // Call summarizeFacet
    const notesInput = entries.map(e => ({
      title: e.date,
      excerpt: [e.summary ?? '', ...(e.facts ?? [])].filter(Boolean).join('. '),
    }));

    if (!AIBackgroundBudget.canSpend(1)) {
      console.warn(`[AIMonthlyDigestService] Skipping monthly digest for ${month}: background budget exhausted`);
      return;
    }

    const result = await AIService.summarizeFacet({
      notes: notesInput,
      focus: `${month} дневник`,
    }, ...(opts ? [opts] : []));

    if (!result.ok) {
      console.warn(`[AIMonthlyDigestService] Failed to summarize facet for month ${month}:`, result.error);
      return;
    }

    AIBackgroundBudget.spend(1);

    // Compute dominant tone and tone/theme lists
    const toneCounts: Record<string, number> = {};
    const themeCounts: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.tone) {
        const t = entry.tone.trim();
        toneCounts[t] = (toneCounts[t] ?? 0) + 1;
      }
      if (entry.themes) {
        for (const th of entry.themes) {
          const t = th.trim();
          themeCounts[t] = (themeCounts[t] ?? 0) + 1;
        }
      }
    }

    const tones = Object.entries(toneCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tone]) => tone);

    const themes = Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([theme]) => theme);

    const dominantTone = tones[0] ?? '';
    let narrative = result.summary || '';

    // CTX-8: Append dominant tone to the narrative
    if (dominantTone) {
      narrative = `${narrative}\nПреобладающий тон месяца: ${dominantTone}.`;
    }

    const digest: AIMonthlyDigest = {
      month,
      narrative,
      tones,
      themes,
      noteCount: entries.length,
      noteIds: entries.map(e => e.documentId),
      generatedAt: Date.now(),
    };

    await db.put('aiMonthlyDigest', digest);
    LocalStoreSyncService.scheduleStoreSync('aiMonthlyDigest', digest.month);
}

/**
 * Приёмка ai-privacy (security-review, Vuln 4 + проверка коммита): дайджест
 * отдаётся читателям, только если ВСЕ заметки, по которым он собран, ещё живы в
 * хронологии месяца (она скрытые и корзинные уже не отдаёт). Сверка по номерам, а
 * не по количеству: «одну скрыли, одну добавили» количество не меняет. У старого
 * дайджеста номеров нет — не отдаётся до пересборки по действию человека. Сбой
 * чтения — не отдаётся: «нет ответа» не значит «всё живое». Вызовов ИИ нет.
 */
async function coversOnlyLiveNotes(digest: AIMonthlyDigest): Promise<boolean> {
  if (!digest.noteIds || digest.noteIds.length === 0) return false;
  try {
    const live = new Set((await AITimelineService.getByMonth(digest.month)).map(e => e.documentId));
    return digest.noteIds.every(id => live.has(id));
  } catch {
    return false;
  }
}
