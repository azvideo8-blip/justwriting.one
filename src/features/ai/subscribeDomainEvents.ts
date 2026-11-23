import { onDomainEvent } from '../../core/events/domainEvents';
import { reportError } from '../../shared/errors/reportError';

// Облачный отказ уборки уже в своём журнале (persistPendingAnalysisDelete). Локальный
// (дайджест/грань/портрет) — в журнале повтора локальной уборки: без него пересказ
// скрытой заметки оставался бы до следующего входа, и никто бы не узнал.
async function clearAnalysisInBackground(documentId: string): Promise<void> {
  const { NoteAnalysisService } = await import('./services/NoteAnalysisService');
  const { localFailed, purge } = await NoteAnalysisService.clearAnalysis(documentId);
  if (!localFailed) return;
  const { getCurrentUser } = await import('../../core/auth');
  const uid = getCurrentUser()?.uid;
  if (uid) {
    const { persistPendingLocalPurge } = await import('./services/pendingLocalPurges');
    persistPendingLocalPurge(uid, documentId, purge);
  }
  reportError(new Error('Local derivatives purge failed — queued for retry'), { action: 'note_derivatives_purge_failed', documentId }, 'warning');
}

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
        const [{ invalidateMiniSearchCache }, { AILexiconService }] = await Promise.all([
          import('./utils/noteRetriever'),
          import('./services/AILexiconService'),
        ]);
        // DY6-1 (Н-1): «свои слова» кэшируются на 10 минут, и без сброса слово
        // скрытой заметки уходит в модель ещё столько же после скрытия — даже когда
        // чистка произведена и строки разбора уже удалены.
        AILexiconService.clearCache();
        invalidateMiniSearchCache();
        await clearAnalysisInBackground(e.documentId);
        break;
      }
      case 'note.excludedFromAI': {
        const { refreshMiniSearchDoc } = await import('./utils/noteRetriever');
        const refreshing = refreshMiniSearchDoc(e.documentId);
        if (e.excluded) {
          const { AILexiconService } = await import('./services/AILexiconService');
          AILexiconService.clearCache();
          await clearAnalysisInBackground(e.documentId);
        } else {
          // Заметку вернули в ИИ — отложенная уборка её производных больше не нужна
          // (ревью 0.11.24: иначе повтор чистил бы вернувшуюся заметку).
          const { getCurrentUser } = await import('../../core/auth');
          const uid = getCurrentUser()?.uid;
          if (uid) {
            const { forgetIfVisibleToAI } = await import('./services/pendingLocalPurges');
            await forgetIfVisibleToAI(uid, e.documentId);
          }
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
