import { getLocalDb } from '../../../core/storage/localDb';
import type { AIDocumentSummary } from '../../../core/storage/localDb';

export const AISummaryService = {
  async get(documentId: string): Promise<AIDocumentSummary | undefined> {
    const db = await getLocalDb();
    return db.get('aiSummaries', documentId) ?? undefined;
  },

  async save(summary: AIDocumentSummary): Promise<void> {
    const db = await getLocalDb();
    await db.put('aiSummaries', summary);
  },

  async delete(documentId: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('aiSummaries', documentId);
  },

  async exportAsMarkdown(documentId: string, docTitle: string): Promise<string> {
    const db = await getLocalDb();
    const summary = await db.get('aiSummaries', documentId);
    if (!summary) return '';

    const dateStr = new Date(summary.processedAt).toLocaleString();
    const lines = [
      `# Анализ документа: ${docTitle}`,
      `Дата анализа: ${dateStr}`,
      '',
      `**Тональность:** ${summary.tone}`,
      `**Ключевые слова:** ${summary.frequentWords.join(', ')}`,
      `**Темы:** ${summary.themes.join(', ')}`,
      '',
      '## Инсайты',
      ...summary.insights.map(i => `- ${i}`),
    ];

    const facts = summary.extractedFacts ?? [];
    if (facts.length > 0) {
      lines.push('', '## Факты', ...facts.map(f => `- ${f}`));
    }

    return lines.join('\n');
  },

  async hasAll(): Promise<Record<string, boolean>> {
    const db = await getLocalDb();
    const all = await db.getAll('aiSummaries');
    const map: Record<string, boolean> = {};
    for (const s of all) {
      map[s.documentId] = true;
    }
    return map;
  },
};
