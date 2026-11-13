/**
 * TR-9: в разговор попадают только разобранные заметки. Фикстурам, которые
 * проверяют не разбор, а поиск, грани или контекст, нужна строка в `aiSummaries`
 * на каждую посеянную заметку. Сводка пустая намеренно: строка есть — заметка
 * «разобрана», а в текст запроса («[Суть: …]») ничего не добавляется.
 * Уже посеянные сводки и скрытые от ИИ заметки не трогает.
 */
interface SummaryStoreDb {
  getAll(store: 'documents'): Promise<{ id: string; excludedFromAI?: boolean }[]>;
  get(store: 'aiSummaries', key: string): Promise<unknown>;
  put(store: 'aiSummaries', value: never): Promise<unknown>;
}

export async function markAllAnalysed(db: unknown): Promise<void> {
  const d = db as SummaryStoreDb;
  for (const doc of await d.getAll('documents')) {
    // Скрытую не трогаем: тесты приватности проверяют, что сводки у неё нет.
    if (doc.excludedFromAI || await d.get('aiSummaries', doc.id)) continue;
    await d.put('aiSummaries', {
      documentId: doc.id, summary: '', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
    } as never);
  }
}
