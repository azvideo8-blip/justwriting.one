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
const AI_RESTORE_RETRY_MS = 30 * 60_000;

// EX-1: повторить локальную уборку, которая отказала (дайджест/грань/портрет).
async function retryLocalPurges(uid: string): Promise<void> {
  try {
    const { retryPendingLocalPurges } = await import('../services/pendingLocalPurges');
    await retryPendingLocalPurges(uid);
  } catch (e) {
    reportError(e, { action: 'backgroundSync_retryPendingLocalPurges' });
  }
}

export function useBackgroundSync(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  // BR-10: возврат сети во время идущего прохода раньше молча отбрасывался, и
  // заметка ждала опроса (≤120 с) с порогом возраста 5 мин. Флаг догоняет
  // ссып сразу после того прохода.
  const pendingSweepRef = useRef(false);
  const runPassRef = useRef<((sweepNow?: boolean) => Promise<void>) | null>(null);
  // Жив ли ещё хук: догон в `finally` обязан молчать после unmount.
  const aliveRef = useRef(true);

  const runPass = useCallback(async (sweepNow = false) => {
    if (runningRef.current) {
      if (sweepNow) pendingSweepRef.current = true;
      return;
    }
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
      // автосинхронизации (без force: true). При выключенной синхронизации уходят
      // только отложенные удаления заметок (PR-1), текста — никакого.
      try {
        await SyncService.syncPending(uid);
      } catch (e) {
        reportError(e, { action: 'backgroundSync_syncPending' });
      }

      // Дейлик 24.11 (Н-1): уборка локальная и от тумблера выгрузки не зависит.
      // При включённой синхронизации она идёт в конце прохода — после забора из
      // облака, который мог вернуть то, что убираем.
      if (!cloudSyncEnabled(uid)) {
        await retryLocalPurges(uid);
        return;
      }
      // DA-10 (владелец 27.11): заметки забирались только на входе, по возврату во
      // вкладку и сети — вкладка, всё время открытая на экране, не видела правок с
      // телефона. Теперь каждый проход: по rev — один лёгкий запрос (повторный
      // вызов, пока идёт прежний, ждёт его же); без rev — проверка курсора, как на
      // видимости, а не полный проход.
      try {
        const { syncPullByRevEnabled } = await import('../../../core/sync/syncFlags');
        if (await syncPullByRevEnabled(uid) && !SyncService.isRevPullUnavailable(uid)) {
          await SyncService.pullNotes(uid);
        } else {
          const { checkAndSyncCursor } = await import('../../../core/sync/changeCursor');
          await checkAndSyncCursor(uid);
        }
      } catch (e) {
        reportError(e, { action: 'backgroundSync_pullNotes' });
      }
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
      // C2: отметки раздельные — заметки и ИИ-данные. Неполный список облака
      // (битый ряд) даёт `hasMore` надолго; с общей отметкой каждые 120 с заново
      // шёл и полный restoreAIDataFromCloud. ИИ-данные от заметок не зависят:
      // строка без заметки на устройстве сохраняется, её довяжет
      // reattachOrphanedAnalysis (AIRestoreService.ts:422).
      const today = new Date().toISOString().slice(0, 10);
      const restoreDoneKey = `ai_restore_done_date_${uid}`;
      const notesDoneKey = `notes_restore_done_date_${uid}`;
      if (localStorage.getItem(notesDoneKey) !== today) {
        try {
          const { restored, hasMore, throttled, locked } = await CloudSyncService.restoreMissingDocuments(uid);
          if (restored > 0) {
            useActivityLogStore.getState().addActivity(
              'activity_cloud_restored_notes',
              { action: 'restoreMissingDocuments', restored, hasMore },
              'info',
              'sync',
            );
          }
          // DY10-4: запертый сейф — проход не состоялся, отметку не ставим (как
          // skippedLocked у ИИ-отметки ниже).
          if (!hasMore && !throttled && !locked) localStorage.setItem(notesDoneKey, today);
        } catch (e) {
          reportError(e, { action: 'backgroundSync_restoreFromCloud' });
        }
      }
      // Журнал владельца 30.10: полный проход ИИ-данных тяжёлый (десятки МБ).
      // Упал — не повторять его каждые 120 с, а подождать 30 минут; отметка
      // «сделано за сегодня» по-прежнему ставится только после полного успеха.
      const restoreRetryKey = `ai_restore_retry_after_${uid}`;
      const retryAfter = Number(localStorage.getItem(restoreRetryKey)) || 0;
      if (localStorage.getItem(restoreDoneKey) !== today && Date.now() >= retryAfter) {
        const backOff = () => localStorage.setItem(restoreRetryKey, String(Date.now() + AI_RESTORE_RETRY_MS));
        try {
          const aiRestored = await restoreAIDataFromCloud(uid);
          if (!aiRestored.skippedLocked && (aiRestored.failed ?? 0) === 0 && !aiRestored.sectionFailed) {
            localStorage.setItem(restoreDoneKey, today);
            localStorage.removeItem(restoreRetryKey);
          } else if (!aiRestored.skippedLocked) {
            backOff();
          }
        } catch (e) {
          backOff();
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
        // Раздел упал (сбой чтения облака) — курсор стоит: иначе непрочитанное за
        // это окно больше не приедет («нет ответа» ≠ «нечего забирать»). Повтор
        // перечитает окно целиком, запись строк идемпотентна.
        if (!pulled.skippedLocked && !pulled.sectionFailed) {
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
      // RA1-1: по возврату сети порог возраста не нужен — заметка, сохранённая
      // только что без связи, и есть та, которую человек может потерять.
      try {
        await SyncService.sweepOrphanedDocuments(uid, sweepNow ? 0 : undefined);
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
      await retryLocalPurges(uid);
    } catch (e) {
      reportError(e, { action: 'backgroundSync_pass' });
    } finally {
      runningRef.current = false;
      // BR-10: если во время этого прохода сеть «моргнула» ещё раз — догоняем
      // ссыпом сразу, не дожидаясь опроса. Самопроверка 25.10: когда хук уже
      // размонтирован (человек вышел с экрана), догон запускать нельзя —
      // подписки и таймеры сняты, а проход от этого продолжился бы.
      if (pendingSweepRef.current) {
        pendingSweepRef.current = false;
        if (aliveRef.current) void runPassRef.current?.(true);
      }
    }
  }, []);

  useEffect(() => { runPassRef.current = runPass; }, [runPass]);

  const scheduleIdle = useCallback(() => {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      timerRef.current = setTimeout(() => { void runPass(); }, IDLE_TIMEOUT_MS);
      return;
    }
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number })
      .requestIdleCallback(() => { void runPass(); }, { timeout: IDLE_TIMEOUT_MS });
  }, [runPass]);

  useEffect(() => {
    aliveRef.current = true;
    scheduleIdle();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') scheduleIdle();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // RA1-1: сеть вернулась — ссып сразу, а не через опрос 120 с. Без порога
    // возраста: заметка, сохранённая офлайн минуту назад, ещё не «старая».
    const onOnline = () => { void runPass(true); };
    window.addEventListener('online', onOnline);

    pollRef.current = setInterval(scheduleIdle, POLL_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scheduleIdle, runPass]);
}
