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
      case 'note.deleted': {
        const [{ NoteAnalysisService }, { invalidateMiniSearchCache }] = await Promise.all([
          import('./services/NoteAnalysisService'),
          import('./utils/noteRetriever'),
        ]);
        await NoteAnalysisService.clear(e.documentId);
        invalidateMiniSearchCache();
        break;
      }
      case 'note.excludedFromAI': {
        const { refreshMiniSearchDoc } = await import('./utils/noteRetriever');
        if (e.excluded) {
          const { NoteAnalysisService } = await import('./services/NoteAnalysisService');
          await NoteAnalysisService.clear(e.documentId);
        }
        void refreshMiniSearchDoc(e.documentId);
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
