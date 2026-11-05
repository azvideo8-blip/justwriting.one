import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { useDraftWriteAlertStore } from '../store/useDraftWriteAlertStore';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { isAccountReloadPending } from '../../../core/auth/accountReload';
import { applyWrite, buildGuestDraftRecord, getEditorTextOwner, type ApplyWriteOutcome, type DraftRecord } from '../services/draftWriter';
import { mayAccountWriteEditorText } from '../utils/draftOwnerGuard';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';


export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error';
// N1 вопрос 3 (владелец 02.11): облако отказало навсегда — экран не обещает
// досылку. `cloud-too-large` — проверка размера в базе (23514), `cloud-refused` — прочее.
// `cloud-off` — синхронизация выключена человеком: облака нет, досылки тоже (ревью 0.11.3).
export type DraftErrorKind = 'quota' | 'unknown' | 'cloud-too-large' | 'cloud-refused' | 'cloud-off' | null;

/** What a save reports back. Omitting `remoteOk` means "no remote save was attempted". */
export interface DraftSaveOutcome {
  localOk?: boolean;
  localSkipped?: boolean;
  /** VIS: почему локальная запись не состоялась. Без него пропуск неразличим:
   *  `stale-epoch` — штатный (молчим), отказ по владельцу — текст на экране и
   *  ни в одном адресе (показываем существующим статусом ошибки). */
  localSkipOutcome?: ApplyWriteOutcome | undefined;
  remoteOk?: boolean;
  remoteError?: unknown;
}

interface UseDraftCoreOptions {
  userId: string | null;
  onError?: (err: unknown, action: string) => void;
}

const PERMANENT_ERRORS = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'failed-precondition',
  '23514', // Postgres check_violation (e.g. drafts_title_check / drafts_content_check)
  '42501', // Postgres insufficient_privilege
  '400',
  '401',
  '403',
  'PGRST100',
]);

export function useDraftCore({ userId, onError }: UseDraftCoreOptions) {
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<DraftErrorKind>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [remotePermanentError, setRemotePermanentError] = useState(false);
  // Refs, not state: wrapSave reads and writes these within a single call, so
  // they must be current immediately rather than after the next render.
  const remoteFailCountRef = useRef(0);
  // Sticky. Only a remote save that actually succeeded clears it — a local-only
  // save carries no information about the cloud copy and must not reset it.
  const cloudStaleRef = useRef(false);
  // Почему облако отказало навсегда; снимается той же удачной записью, что и cloudStaleRef.
  const permanentKindRef = useRef<DraftErrorKind>(null);
  const isMountedRef = useRef(true);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  /** VIS T3: сколько записей подряд отказали. Ref, а не состояние: счётчик
   *  читается и пишется внутри одного `wrapSave`, до следующего рендера. */
  const localFailStreakRef = useRef(0);
  /** Заметка ревьюера 04.11 21:55, п.3: исход, который журнал уже записал.
   *  `null` — состояния отказа в журнале нет (запись принята или был другой
   *  исход показа). */
  const refusedLoggedRef = useRef<string | null>(null);
  // Заметка ревьюера 04.11 21:55, п.2: «текст только на экране» перестало быть
  // правдой (запись принята, текст стёрт) — снять показ и счётчик подряд. Вызывается
  // и оттуда, где `markSaved` не звался: пустой редактор в обоих писателях.
  const clearLocalWriteStuck = useCallback(() => {
    localFailStreakRef.current = 0;
    useDraftWriteAlertStore.getState().setLocalWriteStuck(false);
  }, []);
  // Сохранение, пришедшее во время другого: раньше оно просто отбрасывалось, и
  // «Сохранено» подтверждало текст без последнего абзаца (R3-019).
  const rerunRef = useRef<{ saveFn: () => Promise<DraftSaveOutcome | void>; action: string } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      // Заметка ревьюера 04.11 21:55, п.2: редактор размонтирован — над ним
      // баннера нет, а следующая сессия не должна начинаться с чужого «только
      // на экране». `markSaved` при уходе не зовётся.
      localFailStreakRef.current = 0;
      useDraftWriteAlertStore.getState().setLocalWriteStuck(false);
    };
  }, []);

  // Таймер «Сохранено → пусто» от прошлого сохранения не должен гасить
  // «сохраняется» и «ошибку» нового (R3-018).
  const clearStatusTimer = () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
  };

  const markSaving = useCallback(() => {
    clearStatusTimer();
    if (isMountedRef.current) {
      setSaveStatus('saving');
      setSaveErrorKind(null);
    }
  }, []);

  const markSaved = useCallback((isCloudStale = false) => {
    // VIS T3: принятая запись снимает и счётчик отказов, и стоячий баннер —
    // текст снова в адресе, «только на экране» больше не правда.
    refusedLoggedRef.current = null;
    clearLocalWriteStuck();
    if (isMountedRef.current) {
      setSaveStatus(isCloudStale ? 'cloud-stale' : 'saved');
      setLastSavedAt(Date.now());
      setSaveErrorKind(isCloudStale ? permanentKindRef.current : null);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      // "Saved" is transient — it confirms one write and fades. The stale
      // warning is a standing condition, so it must not fade back to a blank
      // indicator that reads as "everything is fine".
      if (!isCloudStale) {
        statusTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setSaveStatus('idle');
        }, 1000);
      }
    }
  }, [clearLocalWriteStuck]);

  const markError = useCallback((err: unknown, action: string) => {
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    clearStatusTimer();
    // Показ ушёл в другой исход (настоящая ошибка записи): следующий отказ
    // мутатора по владельцу — новое состояние для журнала.
    refusedLoggedRef.current = null;
    // VIS T3 (владелец 04.11, строка 6 карты): одиночный отказ показывается
    // существующим значком и словами, а два подряд — уже не случайность: текст
    // стоит только на экране, и вкладку закрывать нельзя. Счётчик подряд, поэтому
    // удачная запись между отказами его обнуляет (markSaved).
    localFailStreakRef.current += 1;
    if (localFailStreakRef.current >= 2) useDraftWriteAlertStore.getState().setLocalWriteStuck(true);
    if (isMountedRef.current) {
      setSaveStatus('error');
      setSaveErrorKind(isQuota ? 'quota' : 'unknown');
    }
    if (onError) {
      onError(err, action);
    } else if (isQuota) {
      reportError(err, { action, userId: userId ?? undefined }, 'warning');
    } else {
      reportError(err, { action, userId: userId ?? undefined });
    }
  }, [onError, userId]);

  /**
   * VIS (владелец 04.11): мутатор отверг запись по владельцу — это не «нечего
   * сохранять». Текст стоит на экране, а записи нет ни в одном адресе, и
   * показывать это надо существующими словами ошибки: нового текста нет.
   * В журнал — только исход, без текста и заголовка заметки.
   */
  const markRefused = useCallback((outcome: ApplyWriteOutcome, action: string) => {
    clearStatusTimer();
    if (isMountedRef.current) {
      setSaveStatus('error');
      setSaveErrorKind('unknown');
    }
    // Заметка ревьюера 04.11 21:55, п.3: автосохранение стучит раз в секунду и
    // раз в 30 с — журнал ведётся на состояние, а не на попытку. Состояние
    // ушло и вернулось (markSaved/markError сбросили пометку) — это новая
    // запись. DRAFT_WRITE_REFUSED живёт только с этим условием.
    if (refusedLoggedRef.current !== outcome) {
      refusedLoggedRef.current = outcome;
      reportError(new Error(`DRAFT_WRITE_REFUSED: ${outcome}`), { action, userId: userId ?? undefined });
    }
  }, [userId]);

  const wrapSave = useCallback(async (saveFn: () => Promise<DraftSaveOutcome | void>, action: string): Promise<boolean> => {
    if (savingRef.current) {
      rerunRef.current = { saveFn, action };
      return false;
    }
    savingRef.current = true;
    try {
      markSaving();
      const res = await saveFn();

      // N-33: запись пропущена (черновик устарел) — это не «Сохранено».
      if (res && res.localSkipped) {
        // VIS: отказ по владельцу — ошибка записи, а не пропуск. `stale-epoch`
        // и `vault-cleared` остаются тихими: первый штатный, второй потребитель
        // не показывает (VIS-3: ни одного исхода без потребителя).
        if (res.localSkipOutcome === 'no-owner' || res.localSkipOutcome === 'owner-mismatch') {
          markRefused(res.localSkipOutcome, action);
          return false;
        }
        if (isMountedRef.current) setSaveStatus('idle');
        return false;
      }

      // A local-only save resolves with no remote information at all. It must
      // fall through both branches: it neither proves the cloud copy is current
      // nor that it is stale, so it leaves the sticky flag exactly as it was.
      if (res && res.remoteOk === false) {
        const err = res.remoteError as { code?: unknown; status?: unknown; message?: unknown; details?: unknown } | undefined;
        const code = typeof err?.code === 'string' ? err.code : typeof err?.code === 'number' ? String(err.code) : undefined;
        const status = typeof err?.status === 'string' ? err.status : typeof err?.status === 'number' ? String(err.status) : undefined;
        const message = typeof err?.message === 'string' ? err.message : '';
        const details = typeof err?.details === 'string' ? err.details : '';

        const isPermanent = (code !== undefined && PERMANENT_ERRORS.has(code)) ||
          (status !== undefined && PERMANENT_ERRORS.has(status)) ||
          message.includes('check constraint') ||
          message.includes('23514') ||
          details.includes('check constraint');

        if (isPermanent) {
          setRemotePermanentError(true);
          const tooLarge = code === '23514' || message.includes('23514')
            || message.includes('check constraint') || details.includes('check constraint');
          permanentKindRef.current = tooLarge ? 'cloud-too-large' : 'cloud-refused';
        }

        remoteFailCountRef.current += 1;
        if (!isPermanent && userId && !cloudSyncEnabled(userId)) permanentKindRef.current = 'cloud-off';
        if (isPermanent || remoteFailCountRef.current >= 3) {
          cloudStaleRef.current = true;
        }
      } else if (res && res.remoteOk === true) {
        remoteFailCountRef.current = 0;
        cloudStaleRef.current = false;
        permanentKindRef.current = null;
        setRemotePermanentError(false);
      }

      markSaved(cloudStaleRef.current);
      return true;
    } catch (err) {
      markError(err, action);
      return false;
    } finally {
      savingRef.current = false;
      const rerun = rerunRef.current;
      rerunRef.current = null;
      if (rerun && isMountedRef.current) void wrapSaveRef.current(rerun.saveFn, rerun.action);
    }
  }, [markSaving, markSaved, markError, markRefused, userId]);
  const wrapSaveRef = useRef(wrapSave);
  useEffect(() => { wrapSaveRef.current = wrapSave; }, [wrapSave]);

  return {
    saveStatus,
    saveErrorKind,
    lastSavedAt,
    remotePermanentError,
    isMountedRef,
    savingRef,
    markSaving,
    markSaved,
    markError,
    wrapSave,
    clearLocalWriteStuck,
  };
}

export function useVisibilitySave(doSave: () => Promise<void>, getContent: () => string) {
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!getContent()) return;
      void doSave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doSave, getContent]);
}

export function useSyncUnloadSave(
  user: AppUser | null,
  draftDataRef: RefObject<{
    pinnedThoughts: string[];
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    [key: string]: unknown;
  }>,
  /** DW4-2: эпоха на момент правки. Сверяет её мутатор (applyWrite), писатель
   *  только называет — прежний writer-страж isStaleWrite удалён, иначе сверка
   *  эпохи жила бы в двух местах на один выпуск (класс DW-4). */
  getWriteEpoch?: () => number | undefined,
  /** Дейлик 03.11 Н-2: сейф включён — открытый снимок не пишем, но запускаем
   *  обычную локальную запись черновика (best effort: браузер может не дождаться). */
  onEncryptedUnload?: () => void,
) {
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isAccountReloadPending()) return;
      const contentState = useContentStore.getState();
      const timerState_ = useTimerStore.getState();
      const meta = useSessionMetaStore.getState();
      const isPristine = Boolean(
        meta.savedDocumentId &&
        meta.loadedContent !== null &&
        contentState.content === meta.loadedContent &&
        (meta.loadedTitle ?? '') === contentState.title
      );
      if (user && !isPristine && (contentState.content.trim() || contentState.title.trim())) {
        // DW4-2: единственная запись копии закрытия — applyWrite(..., target:
        // 'copy'). Ключ (`draft-<uid>` / гостевой), сейф (SEC-56) и сверку эпохи
        // решает мутатор; 'stale-epoch' — сохранение заметки подняло эпоху, и
        // уже сохранённый текст черновиком не возвращается (DY10-10).
        // Шаг 5 DW-4: эпоха правки — поле записи, её называет билдер, а не
        // отдельный аргумент мутатору: писатель копии не может «забыть назвать».
        const writeCopy = (rec: DraftRecord): void => {
          void applyWrite(rec, 'edit', { target: 'copy', uid: user.uid })
            .catch(e => reportError(e, { action: 'autosave_beforeunload', userId: user.uid }, 'warning'));
        };
        const accountRec: DraftRecord = {
          content: contentState.content,
          title: contentState.title,
          seconds: timerState_.seconds,
          status: timerState_.status,
          wordCount: contentState.wordCount,
          pinnedThoughts: draftDataRef.current.pinnedThoughts ?? [],
          sessionStartTime: draftDataRef.current.sessionStartTime ?? null,
          activeSessionId: draftDataRef.current.activeSessionId ?? null,
          tags: contentState.tags ?? [],
          labelId: contentState.labelId ?? undefined,
          // DW4-4: владелец — зеркало (чей текст стоит); на этом пути DW-9-страж
          // уже отсеял чужое, так что зеркало здесь — это сам аккаунт или пусто.
          owner: getEditorTextOwner() ?? user.uid,
          epoch: getWriteEpoch?.(),
          updatedAt: Date.now(),
        };
        const { getEncryptionEnabled } = useEncryptionStore.getState();
        if (!user.uid.startsWith('guest') && getEncryptionEnabled(user.uid)) {
          // SEC-56: E2E is enabled — открытой копии в LS нет (мутатор стирает
          // ключ), но запись строки это не отменяет («нет дубля» ≠ «запись не
          // нужна»): её запускает локальная запись ниже.
          writeCopy(accountRec);
          onEncryptedUnload?.();
          return;
        }
        if (user.uid.startsWith('guest')) {
          // Гостевой фолбэк попадает в ключ, который реально читается при
          // возврате (STORAGE_KEYS.GUEST_DRAFT): прежний `draft-guest_<uuid>`
          // никто не читал — «защита» была декоративной.
          // DW4-1: строку собирает тот же билдер, что и отсрочка
          // GuestDraftService, — одна форма гостевой строки по построению
          // (класс DW-F-2), сериализует её мутатор.
          writeCopy(buildGuestDraftRecord({
            ...(draftDataRef.current as DraftRecord),
            content: contentState.content,
            title: contentState.title,
            seconds: timerState_.seconds,
            status: timerState_.status,
            wordCount: contentState.wordCount,
            tags: contentState.tags ?? [],
            labelId: contentState.labelId ?? undefined,
            // DW4-4: гостевой текст подписан гостем, не кем-то из аккаунтов (I1).
            owner: user.uid,
            epoch: getWriteEpoch?.(),
            timestamp: Date.now(),
          }));
          return;
        }
        // DW-9 (сид 191): в этой же вкладке без перезагрузки мог включиться
        // другой аккаунт, а редактор всё ещё держит текст прежнего. Ключ
        // `draft-<uid>` читается при следующем входе (`pickNewerLocalCopy`,
        // N1-4) — текст прежнего аккаунта восстанавливался у нового. Сверка та же,
        // что у записи на размонтировании (AS-1), и из одного помощника.
        // Писатель приносит СВОЙ снимок текста (`draftDataRef`), иначе второе
        // плечо правила — «владельца нет, а в сторе уже другой текст» — было
        // бы мертво: сравнивать стор с самим собой бессмысленно.
        const sessionContent = (draftDataRef.current as { content?: unknown }).content;
        if (!mayAccountWriteEditorText(user.uid, typeof sessionContent === 'string' ? sessionContent : contentState.content)) return;
        writeCopy(accountRec);
      }

    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [user, draftDataRef, getWriteEpoch, onEncryptedUnload]);
}
