import { onDomainEvent } from '../../core/events/domainEvents';

// Модули ИИ грузятся ДИНАМИЧЕСКИ, внутри обработчика.
//
// Статические импорты здесь тянули весь граф ИИ — NoteAnalysisService,
// noteRetriever вместе с MiniSearch, индексатор эмбеддингов, сервис
// восстановления — в стартовый бандл: AppProviders подписывается при монтаже,
// то есть у каждого человека, даже если он никогда не откроет ИИ. Замер:
// entry 211.6 → 219.8 КБ gzip. Обработчик и так async, поэтому await import
// ничего не стоит до первого события.
//
// Ошибки НЕ глушим: emitDomainEvent ловит и синхронный бросок, и отклонённый
// промис и зовёт reportError. Локальный catch здесь сделал бы уборку
// производных данных молчаливой — ровно то, ради чего в шину и добавляли
// репорт.
let initialized = false;

export function initAiDomainEvents(): () => void {
  if (initialized) return () => {};
  initialized = true;

  const unsub = onDomainEvent(async (e) => {
    switch (e.type) {
      // R7F-010: корзина — то же исключение из ИИ (`isExcludedFromAI` читает
      // trashedAt), а убирала производные только явная «скрыть от ИИ». Заметка,
      // положенная в корзину, продолжала поставлять факты и цитаты в подсказки.
      case 'note.deleted':
      case 'note.trashed': {
        const [{ NoteAnalysisService }, { invalidateMiniSearchCache }, { AILexiconService }] = await Promise.all([
          import('./services/NoteAnalysisService'),
          import('./utils/noteRetriever'),
          import('./services/AILexiconService'),
        ]);
        // DY6-1 (Н-1): «свои слова» кэшируются на 10 минут, и без сброса слово
        // скрытой заметки уходит в модель ещё столько же после скрытия — даже когда
        // чистка произведена и строки разбора уже удалены.
        AILexiconService.clearCache();
        invalidateMiniSearchCache();
        await NoteAnalysisService.clear(e.documentId);
        break;
      }
      case 'note.excludedFromAI': {
        const { refreshMiniSearchDoc } = await import('./utils/noteRetriever');
        const refreshing = refreshMiniSearchDoc(e.documentId);
        if (e.excluded) {
          const [{ NoteAnalysisService }, { AILexiconService }] = await Promise.all([
            import('./services/NoteAnalysisService'),
            import('./services/AILexiconService'),
          ]);
          AILexiconService.clearCache();
          await NoteAnalysisService.clear(e.documentId);
        }
        await refreshing;
        break;
      }
      case 'sync.restoredFromCloud': {
        const { restoreAIDataFromCloud, reattachOrphanedAnalysis } =
          await import('./services/AIRestoreService');
        await restoreAIDataFromCloud(e.userId);
        await reattachOrphanedAnalysis();
        break;
      }
      case 'ai.indexPending': {
        const { indexPending } = await import('./utils/embeddingIndexer');
        await indexPending();
        break;
      }
    }
  });

  return () => {
    unsub();
    initialized = false;
  };
}
