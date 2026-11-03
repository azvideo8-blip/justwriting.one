import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { isAccountReloadPending } from '../../../core/auth/accountReload';
import { applyWrite, buildGuestDraftRecord, getEditorTextOwner, type DraftRecord } from '../services/draftWriter';
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
  // Сохранение, пришедшее во время другого: раньше оно просто отбрасывалось, и
  // «Сохранено» подтверждало текст без последнего абзаца (R3-019).
  const rerunRef = useRef<{ saveFn: () => Promise<DraftSaveOutcome | void>; action: string } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
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
  }, []);

  const markError = useCallback((err: unknown, action: string) => {
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    clearStatusTimer();
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
  }, [markSaving, markSaved, markError, userId]);
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
        const writeCopy = (rec: DraftRecord): void => {
          void applyWrite(rec, 'edit', { target: 'copy', uid: user.uid, epoch: getWriteEpoch?.() })
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
