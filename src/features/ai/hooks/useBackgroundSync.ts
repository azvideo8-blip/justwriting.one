import { useRef, useEffect, useCallback } from 'react';
import { getCurrentUser } from '../../../core/auth';
import { reportError } from '../../../shared/errors/reportError';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';
// Курсор — общая формула с сетевым фуззом; чистая функция, чтобы тест hook'а
// не подменял её своим mock'ом.
import { nextPullCursor, pullSince } from '../services/pullCursor';
// BS (N-2): SyncService, CloudSyncService, LocalStoreSyncService и AIEmbeddingService
// грузятся по требованию в начале прохода (см. runPass) — статическое ребро отсюда
// утаскивало весь движок синка, включая сегментный формат диалогов, в стартовый кусок.

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
 * - начатая догрузка векторов из облака продолжается каждым проходом (В-1), пока
 *   не дойдёт до конца;
 * - векторы, посчитанные при запертом хранилище, дописываются в облако.
 *
 * Всё это — операции синхронизации, поэтому подчиняются тумблеру автосинка, а
 * не согласию на обработку ИИ.
 */

const IDLE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 120_000;
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
      // BS (N-2): граница «первый проход после входа» уже асинхронная — здесь и
      // подгружаем движок, по одному сервису и только тот, что нужен этому проходу.
      // Отказ куска попадает в общий catch прохода: очередь живёт в IndexedDB и в
      // журнале localStorage, так что «кусок не пришёл» не читается как
      // «синхронизировать нечего» — следующий проход повторит.
      const { SyncService } = await import('../../../core/services/SyncService');
      // D-22: Автоматический дренаж очереди синхронизации уважает переключатель
      // автосинхронизации (без force: true). При выключенной синхронизации в облако
      // ничего не уходит.
      try {
        await SyncService.syncPending(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_syncPending' });
      }

      if (!cloudSyncEnabled(uid)) return;
      const { CloudSyncService } = await import('../../../core/services/CloudSyncService');
      // Лениво: сервис восстановления нужен только при включённой синхронизации,
      // а не на старте (бюджет стартового куска).
      const { restoreAIDataFromCloud, reattachOrphanedAnalysis, continueEmbeddingDownload } = await import('../services/AIRestoreService');
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
      // на следующие сутки. Берём изменённое после прошлого забора; курсор — по
      // серверной отметке строки (W-5), поэтому запаса на часы нет (pullSince).
      try {
        const pullKey = `ai_pull_since_${uid}`;
        const startedAt = Date.now();
        const last = Number(localStorage.getItem(pullKey)) || startedAt - PULL_FIRST_WINDOW_MS;
        const pulled = await restoreAIDataFromCloud(uid, { sinceMs: pullSince(last) });
        // Формула — общая с сетевым фуззом (pullCursor.ts): по отметке, реально
        // увиденной в облаке, с часами устройства только как потолком.
        if (!pulled.skippedLocked) {
          localStorage.setItem(pullKey, String(nextPullCursor(startedAt, last, pulled.maxUpdatedAt)));
        }
      } catch (e) {
        reportError(e, { action: 'backgroundSync_pullAIData' });
      }

      // В-1 (замер 08.10.2026): начатая догрузка векторов продолжается ЭТИМ
      // проходом, а не следующим днём. Полный проход — раз в сутки (ключ выше),
      // и на потолке прошлой сборки в 100 записей архив в 1000 заметок догружался
      // десять суток, всё это время `indexPending` ждал облако и не трогал заметки,
      // которых в нём нет вовсе. Первый запуск по-прежнему решает полный проход.
      try {
        await continueEmbeddingDownload(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_continueEmbeddingDownload' });
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
      const { AIEmbeddingService } = await import('../services/AIEmbeddingService');
      await AIEmbeddingService.syncPendingToCloud();

      // Выгрузить накопившиеся в очереди записи 13 хранилищ ИИ (если сейф был заперт)
      const { LocalStoreSyncService } = await import('../../../core/services/LocalStoreSyncService');
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
