import { useRef, useEffect, useCallback } from 'react';
import { getCurrentUser } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';
import { restoreAIDataFromCloud, reattachOrphanedAnalysis } from '../services/AIRestoreService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';

/**
 * Фоновый проход, который **не обращается к ИИ**.
 *
 * Раньше здесь жил конвейер, сам отправлявший текст заметок поставщику ИИ по
 * таймеру: сводки, векторы, грани профиля, портрет, консолидация, таксономия.
 * Он убран целиком — разбор заметки делается только по нажатию (кнопка ✨ у
 * заметки, `NoteAnalysisService`). Осталось то, что лишь возвращает домой уже
 * существующие данные и никуда ничего не отправляет:
 *
 * - заметки и разбор, потерянные при очистке устройства, тянутся из облака;
 * - разбор, приехавший раньше своей заметки, привязывается к ней;
 * - векторы, посчитанные при запертом хранилище, дописываются в облако.
 *
 * Всё это — операции синхронизации, поэтому подчиняются тумблеру автосинка, а
 * не согласию на обработку ИИ.
 */

const IDLE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 120_000;

export function useBackgroundSync(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const runPass = useCallback(async () => {
    if (runningRef.current) return;
    const uid = getCurrentUser()?.uid;
    if (!uid) return;
    if (!cloudSyncEnabled(uid)) return;

    runningRef.current = true;
    try {
      // Раз в сутки на аккаунт: вернуть заметки и разбор, которых на
      // устройстве нет. Оба сканирования ниже читают только локальные
      // хранилища, поэтому после очистки они бы сочли, что ничего никогда
      // не было.
      // AUD-13: ключ по аккаунту, а не глобальный — иначе выход и вход другим
      // человеком снимал (или навязывал) чужой троттлинг. Ставится только после
      // полного успеха: упавший проход не должен откладывать повтор на сутки.
      const restoreDoneKey = `ai_restore_done_date_${uid}`;
      if (localStorage.getItem(restoreDoneKey) !== new Date().toISOString().slice(0, 10)) {
        try {
          const { restored, hasMore, throttled } = await CloudSyncService.restoreMissingDocuments(uid);
          if (restored > 0) {
            useActivityLogStore.getState().addActivity(
              `Восстановлено заметок из облака: ${restored}`,
              { action: 'restoreMissingDocuments', restored, hasMore },
              'info',
              'sync',
            );
          }
          const aiRestored = await restoreAIDataFromCloud(uid);
          const notesFullyRestored = !hasMore && !throttled;
          if (!aiRestored.skippedLocked && notesFullyRestored) {
            localStorage.setItem(restoreDoneKey, new Date().toISOString().slice(0, 10));
          }
        } catch (e) {
          reportError(e, { action: 'backgroundSync_restoreFromCloud' });
        }
      }

      // Каждый проход, а не однократно: заметки приезжают из облака по одной,
      // и приехавшая позже всё ещё должна найти свой разбор. Дёшево, когда
      // осиротевшего ничего нет — выходит до всякого хеширования.
      try {
        await reattachOrphanedAnalysis();
      } catch (e) {
        reportError(e, { action: 'backgroundSync_reattachAnalysis' });
      }

      // Дописать в облако векторы, посчитанные при запертом хранилище.
      // Обращений к ИИ здесь нет — только выгрузка уже посчитанного.
      await AIEmbeddingService.syncPendingToCloud();

      // Выгрузить накопившиеся в очереди записи 13 хранилищ ИИ (если сейф был заперт)
      const { LocalStoreSyncService } = await import('../../../core/services/LocalStoreSyncService');
      LocalStoreSyncService.retryOversizedRecords();
      await LocalStoreSyncService.flushPending();
    } catch (e) {
      reportError(e, { action: 'backgroundSync_pass' });
    } finally {
      runningRef.current = false;
    }
  }, []);

  const scheduleIdle = useCallback(() => {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      timerRef.current = setTimeout(() => { void runPass(); }, IDLE_TIMEOUT_MS);
      return;
    }
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number })
      .requestIdleCallback(() => { void runPass(); }, { timeout: IDLE_TIMEOUT_MS });
  }, [runPass]);

  useEffect(() => {
    scheduleIdle();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') scheduleIdle();
    };
    document.addEventListener('visibilitychange', onVisibility);

    pollRef.current = setInterval(scheduleIdle, POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scheduleIdle]);
}
