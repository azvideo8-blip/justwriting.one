import { useEffect, useCallback, useRef } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus, type DraftErrorKind, type DraftSaveOutcome } from './useDraftCore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { WritingDraftService } from '../services/WritingDraftService';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, resetAllSessionMetadata } from '../store/storeActions';
import { reportError } from '../../../shared/errors/reportError';
import { useContentStore } from '../store/useContentStore';
import { onBeforeAccountReload } from '../../../core/auth/accountReload';

const SKIPPED: DraftSaveOutcome = { localSkipped: true };

function isPristineContinuedSession(content: string, title: string): boolean {
  const meta = useSessionMetaStore.getState();
  if (!meta.savedDocumentId || meta.loadedContent === null) return false;
  return content === meta.loadedContent && (meta.loadedTitle ?? '') === title;
}

export function useDraftAutosave(
  user: AppUser | null,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    initialWordCount?: number | undefined;
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    status: 'idle' | 'writing' | 'paused';
  }
) {
  const userId = user?.uid ?? null;
  const { saveStatus, saveErrorKind, lastSavedAt, remotePermanentError, wrapSave } = useDraftCore({ userId });
  const draftDataRef = useRef(draftData);
  // Приёмка ai-privacy (код-ревью, M-3): поколение черновика на момент последней
  // правки. Сохранение заметки поднимает поколение и стирает черновик ДО сброса
  // сессии; запись на размонтировании в этом окне с текущим поколением вернула бы
  // уже сохранённый текст «несохранённым черновиком». С этим поколением запись
  // отвергается (saveToLocal сверяет поколение).
  const draftGenAtEditRef = useRef<number | undefined>(undefined);
  const { layoutMode } = useLayoutMode();

  useEffect(() => {
    draftDataRef.current = draftData;
    if (userId) draftGenAtEditRef.current = WritingDraftService.getDraftGeneration(userId);
  }, [draftData, userId]);

  // Чей текст в редакторе — записано в самом сторе текста (N-47), а не в этом
  // хуке: стор переживает уход со страницы письма, и после приглашения или
  // входа под другим аккаунтом редактор монтируется заново с тем же текстом.
  // Текст прежнего владельца сохраняется ему, в его локальную базу, и только
  // после подтверждённой записи редактор очищается (N-32). Пока не записано —
  // под новым аккаунтом ничего не сохраняется, текст остаётся на экране, а
  // каждая попытка автосохранения повторяет спасение (N-49).
  const rescuingRef = useRef(false);
  const rescueForPreviousOwner = useCallback(async (prev: string): Promise<void> => {
    if (rescuingRef.current) return;
    rescuingRef.current = true;
    try {
      const current = draftDataRef.current;
      const clear = () => { resetAndClear(); resetAllSessionMetadata(); };
      if (!userId || !(current.content.trim() || current.title.trim())) { clear(); return; }
      // Только локально: сессия уже принадлежит новому человеку, облачная
      // запись от имени прежнего упрётся в права базы. Черновик уедет в облако,
      // когда прежний владелец войдёт снова (N-73б — пересмотрено).
      const res = await persistDraft(buildLocalDraft({ uid: prev } as AppUser, current), { remote: false });
      if (res.localOk && !res.localSkipped) { clear(); return; }
      reportError(new Error('DRAFT_RESCUE_FAILED: the previous account\'s draft was not written; kept on screen'),
        { action: 'draftAutosave_saveForPreviousOwner', localOk: res.localOk, localSkipped: res.localSkipped });
    } finally {
      rescuingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    const prev = useContentStore.getState().ownerUid;
    if (prev && prev !== userId && !prev.startsWith('guest')) void rescueForPreviousOwner(prev);
  }, [userId, rescueForPreviousOwner]);

  /** Текст этого аккаунта? Ничейный (новый, гостевой) становится его. Чужой —
   *  нет, и запускает спасение для владельца. */
  const ownsText = useCallback((uid: string): boolean => {
    const owner = useContentStore.getState().ownerUid;
    if (owner === uid) return true;
    if (!owner || owner.startsWith('guest')) {
      useContentStore.setState({ ownerUid: uid });
      return true;
    }
    void rescueForPreviousOwner(owner);
    return false;
  }, [rescueForPreviousOwner]);

  const doAutosaveLocal = useCallback(async (opts?: { rescue?: boolean; generation?: number | undefined }): Promise<DraftSaveOutcome> => {
    if (!user) return SKIPPED;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return SKIPPED;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return SKIPPED;
    if (opts?.rescue === false) {
      // AS-1: на размонтировании чужой текст не спасаем — этим занят эффект
      // смены аккаунта, а его побочные записи из cleanup путают следующий монтаж.
      const contentState = useContentStore.getState();
      const owner = contentState.ownerUid;
      if (owner && owner !== user.uid && !owner.startsWith('guest')) return SKIPPED;
      // Владельца нет, а в редакторе уже другой текст (спасение очистило стор) —
      // это хвост чужой сессии, подписывать его текущему аккаунту нельзя.
      if ((!owner || owner.startsWith('guest')) && contentState.content !== current.content) return SKIPPED;
      if (!owner || owner.startsWith('guest')) useContentStore.setState({ ownerUid: user.uid });
    } else if (!ownsText(user.uid)) return SKIPPED;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, opts?.generation !== undefined ? { remote: false, generation: opts.generation } : { remote: false });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    if (result.localSkipped) return SKIPPED;
    // Local only: `remote: false` makes persistDraft report remoteOk=true
    // (nothing was attempted, so nothing failed). Passing that up would clear
    // the cloud-stale flag on every keystroke pause.
    return {};
  }, [user, ownsText]);

  const doSaveWithRemote = useCallback(async (): Promise<DraftSaveOutcome> => {
    if (!user) return SKIPPED;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return SKIPPED;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return SKIPPED;
    if (!ownsText(user.uid)) return SKIPPED;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    // N-48: локальная запись пропущена — не «Сохранено», и облачный успех
    // не должен снимать флаг «облако устарело».
    if (result.localSkipped) return SKIPPED;
    return result;
  }, [user, ownsText]);
  const doAutosaveRemote = doSaveWithRemote;
  const doForceSave = doSaveWithRemote;

  const wrappedAutosaveLocal = useCallback(async () => {
    await wrapSave(doAutosaveLocal, 'draftAutosave/autoSaveLocal');
  }, [wrapSave, doAutosaveLocal]);

  const wrappedAutosaveRemote = useCallback(async () => {
    await wrapSave(doAutosaveRemote, 'draftAutosave/autoSave');
  }, [wrapSave, doAutosaveRemote]);

  const wrappedForceSave = useCallback(async () => {
    await wrapSave(doForceSave, 'draftAutosave/forceSave');
  }, [wrapSave, doForceSave]);

  // Смена аккаунта перезагружает страницу: текст на экране сначала
  // сохраняется его владельцу. Сейф включён — сохранение при закрытии
  // страницы (ниже) его пропускает, так что это единственный шанс.
  useEffect(() => onBeforeAccountReload(doAutosaveLocal), [doAutosaveLocal]);

  useSyncUnloadSave(user, draftDataRef);
  useVisibilitySave(wrappedForceSave, () => draftDataRef.current.content);

  // Invalidate in-flight autosaves on unmount or when transitioning to idle.
  // AS-1: перед подъёмом поколения пишем локальный черновик — уход из редактора
  // снимает таймер, и последние секунды набора иначе жили только в памяти.
  useEffect(() => {
    return () => {
      if (!userId) return;
      void (async () => {
        try {
          await doAutosaveLocal({ rescue: false, generation: draftGenAtEditRef.current });
        } catch (e) {
          reportError(e, { action: 'draftAutosave_unmount', userId });
        } finally {
          WritingDraftService.bumpDraftGeneration(userId);
        }
      })();
    };
  }, [userId, doAutosaveLocal]);

  useEffect(() => {
    if (draftData.status === 'idle' && userId) {
      WritingDraftService.bumpDraftGeneration(userId);
    }
  }, [draftData.status, userId]);

  // Debounce: save LOCALLY shortly after the user stops typing to avoid cloud write-quota exhaustion.
  useEffect(() => {
    const isPristine = isPristineContinuedSession(draftData.content, draftData.title);
    if (user && !isPristine && (draftData.content.trim() || draftData.title.trim())) {
      // AS-1: на телефоне секунда, а не пять: локальная запись не тратит
      // облачную квоту, и окно, в котором текст живёт только в памяти, короче.
      const debounceDelay = layoutMode === 'mobile' ? 1000 : 500;
      const timeout = setTimeout(() => void wrappedAutosaveLocal(), debounceDelay);
      return () => clearTimeout(timeout);
    }
  }, [draftData.content, draftData.title, draftData.wordCount, user, wrappedAutosaveLocal, layoutMode]);

  // Interval safety net: save to cloud (remote) every 30s even if the user types continuously.
  // Boolean dep on purpose: keyed on the text itself the interval would restart
  // on every keystroke and the "safety net" would never fire while typing.
  const isPristine = isPristineContinuedSession(draftData.content, draftData.title);
  const hasDraftText = !isPristine && Boolean(draftData.content.trim() || draftData.title.trim());
  useEffect(() => {
    if (!user || remotePermanentError) return;
    if (!hasDraftText) return;
    const interval = setInterval(() => void wrappedAutosaveRemote(), 30_000);
    return () => clearInterval(interval);
  }, [user, wrappedAutosaveRemote, hasDraftText, remotePermanentError]);

  return { saveStatus: saveStatus as DraftSaveStatus, saveErrorKind: saveErrorKind as DraftErrorKind, lastSavedAt };
}
