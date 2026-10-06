import { useRef, useEffect, useCallback } from 'react';
import { getCurrentUser } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
// Курсор — общая формула с сетевым фуззом; чистая функция, чтобы тест hook'а
// не подменял её своим mock'ом.
import { nextPullCursor } from '../services/pullCursor';
import { SyncService } from '../../../core/services/SyncService';

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
const PULL_CLOCK_SKEW_MS = 30 * 60_000;
const PULL_FIRST_WINDOW_MS = 24 * 60 * 60_000;

export function useBackgroundSync(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const runPass = useCallback(async () => {
    if (runningRef.current) return;
    const uid = getCurrentUser()?.uid;
    if (!uid) return;

    runningRef.current = true;
    try {
      // D-22: Автоматический дренаж очереди синхронизации уважает переключатель
      // автосинхронизации (без force: true). При выключенной синхронизации в облако
      // ничего не уходит.
      try {
        await SyncService.syncPending(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_syncPending' });
      }

      if (!cloudSyncEnabled(uid)) return;
      // Лениво: сервис восстановления нужен только при включённой синхронизации,
      // а не на старте (бюджет стартового куска).
      const { restoreAIDataFromCloud, reattachOrphanedAnalysis } = await import('../services/AIRestoreService');
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
              'activity_cloud_restored_notes',
              { action: 'restoreMissingDocuments', restored, hasMore },
              'info',
              'sync',
            );
          }
          const aiRestored = await restoreAIDataFromCloud(uid);
          const notesFullyRestored = !hasMore && !throttled;
          if (!aiRestored.skippedLocked && notesFullyRestored && (aiRestored.failed ?? 0) === 0 && !aiRestored.sectionFailed) {
            localStorage.setItem(restoreDoneKey, new Date().toISOString().slice(0, 10));
          }
        } catch (e) {
          reportError(e, { action: 'backgroundSync_restoreFromCloud' });
        }
      }

      // Каждый проход, а не однократно: заметки приезжают из облака по одной,
      // и приехавшая позже всё ещё должна найти свой разбор. Дёшево, когда
      // осиротевшего ничего нет — выходит до всякого хеширования.
      // Разбор и диалоги, сделанные на другом устройстве, забираем каждый проход,
      // а не раз в день: раньше разбор с компьютера доезжал до ноутбука только
      // на следующие сутки. Берём изменённое после прошлого забора с запасом на
      // расхождение часов устройств (курсор — по серверной отметке строки, W-5);
      // повторно забранное безвредно — восстановление идемпотентно.
      try {
        const pullKey = `ai_pull_since_${uid}`;
        const startedAt = Date.now();
        const last = Number(localStorage.getItem(pullKey)) || startedAt - PULL_FIRST_WINDOW_MS;
        const pulled = await restoreAIDataFromCloud(uid, { sinceMs: last - PULL_CLOCK_SKEW_MS });
        // Формула — общая с сетевым фуззом (pullCursor.ts): по отметке, реально
        // увиденной в облаке, с часами устройства только как потолком.
        if (!pulled.skippedLocked) {
          localStorage.setItem(pullKey, String(nextPullCursor(startedAt, last, pulled.maxUpdatedAt)));
        }
      } catch (e) {
        reportError(e, { action: 'backgroundSync_pullAIData' });
      }

      try {
        await reattachOrphanedAnalysis();
      } catch (e) {
        reportError(e, { action: 'backgroundSync_reattachAnalysis' });
      }

      // Защитный обход: найти и поставить в очередь заметки, оставшиеся без облачной копии
      // и очереди (например, созданные в оффлайне или при сбое процесса).
      try {
        await SyncService.sweepOrphanedDocuments(uid);
        await SyncService.syncPending(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_sweepOrphanedDocuments' });
      }

      // Дописать в облако векторы, посчитанные при запертом хранилище.
      // Обращений к ИИ здесь нет — только выгрузка уже посчитанного.
      await AIEmbeddingService.syncPendingToCloud();

      // Выгрузить накопившиеся в очереди записи 13 хранилищ ИИ (если сейф был заперт)
      LocalStoreSyncService.retryOversizedRecords();
      await LocalStoreSyncService.flushPending();

      // Повторить накопившиеся удаления анализа заметок в облаке (F-008)
      try {
        const { retryPendingAnalysisDeletes } = await import('../services/pendingAnalysisDeletes');
        await retryPendingAnalysisDeletes(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_retryPendingAnalysisDeletes' });
      }
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
