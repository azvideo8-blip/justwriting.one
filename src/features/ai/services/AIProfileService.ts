import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';

export const AIProfileService = {
  async generate(): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
    const db = await getLocalDb();
    const allSummaries = await db.getAll('aiSummaries');

    if (allSummaries.length < 3) {
      return { ok: false, error: 'NOT_ENOUGH_DATA' };
    }

    const aggregatedData = allSummaries.map(s => ({
      tone: s.tone,
      themes: s.themes,
      insights: s.insights,
      frequentWords: s.frequentWords,
    }));

    const result = await AIService.chat({
      personaId: 'group_psychology',
      messages: [{
        role: 'user',
        content: `На основе анализа ${allSummaries.length} текстов пользователя составь его психологический портрет. Вот агрегированные данные:\n\n${JSON.stringify(aggregatedData, null, 2)}\n\nОпиши паттерны мышления, эмоциональные тенденции, сильные стороны и зоны роста. Формат: markdown.`,
      }],
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return { ok: true, markdown: result.text };
  },

  async exportMarkdown(): Promise<string | null> {
    const result = await this.generate();
    if (!result.ok) return null;

    const blob = new Blob([result.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-profile-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    return result.markdown;
  },
};
