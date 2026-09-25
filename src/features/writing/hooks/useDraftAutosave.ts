import { useEffect, useCallback, useRef } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus, type DraftErrorKind } from './useDraftCore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { WritingDraftService } from '../services/WritingDraftService';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, resetAllSessionMetadata } from '../store/storeActions';
import { reportError } from '../../../shared/errors/reportError';

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
  const { layoutMode } = useLayoutMode();

  useEffect(() => {
    draftDataRef.current = draftData;
  }, [draftData]);

  // Чей текст сейчас в редакторе. Аккаунт сменился прямо под открытым
  // редактором (ссылка-приглашение поверх своей сессии, вход под другим в
  // соседней вкладке) — текст принадлежит прежнему. Сохраняем его ему, в его
  // локальную базу, и очищаем редактор. Без этого первое же автосохранение
  // записывало чужой текст черновиком нового аккаунта — и в его облако.
  // Выход (→ null) только очищает: при выходе с очисткой устройства запись
  // в базу вернула бы стёртое. Гость → аккаунт — это перенос, его делает миграция.
  const ownerRef = useRef<string | null>(userId);
  useEffect(() => {
    const prev = ownerRef.current;
    ownerRef.current = userId;
    if (!prev || prev === userId || prev.startsWith('guest')) return;
    const current = draftDataRef.current;
    if (userId && (current.content.trim() || current.title.trim())) {
      void persistDraft(buildLocalDraft({ uid: prev } as AppUser, current), { remote: false })
        .catch(e => reportError(e, { action: 'draftAutosave_saveForPreviousOwner' }));
    }
    resetAndClear();
    resetAllSessionMetadata();
  }, [userId]);

  const doAutosaveLocal = useCallback(async () => {
    if (!user || ownerRef.current !== user.uid) return;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: false });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    // Deliberately returns nothing: `remote: false` makes persistDraft report
    // remoteOk=true (nothing was attempted, so nothing failed). Passing that up
    // would clear the cloud-stale flag on every keystroke pause.
  }, [user]);

  const doAutosaveRemote = useCallback(async () => {
    if (!user || ownerRef.current !== user.uid) return;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    return result;
  }, [user]);

  const doForceSave = useCallback(async () => {
    if (!user || ownerRef.current !== user.uid) return;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    return result;
  }, [user]);

  const wrappedAutosaveLocal = useCallback(async () => {
    await wrapSave(doAutosaveLocal, 'draftAutosave/autoSaveLocal');
  }, [wrapSave, doAutosaveLocal]);

  const wrappedAutosaveRemote = useCallback(async () => {
    await wrapSave(doAutosaveRemote, 'draftAutosave/autoSave');
  }, [wrapSave, doAutosaveRemote]);

  const wrappedForceSave = useCallback(async () => {
    await wrapSave(doForceSave, 'draftAutosave/forceSave');
  }, [wrapSave, doForceSave]);

  useSyncUnloadSave(user, draftDataRef);
  useVisibilitySave(wrappedForceSave, () => draftDataRef.current.content);

  // Invalidate in-flight autosaves on unmount or when transitioning to idle
  useEffect(() => {
    return () => {
      if (userId) {
        WritingDraftService.bumpDraftGeneration(userId);
      }
    };
  }, [userId]);

  useEffect(() => {
    if (draftData.status === 'idle' && userId) {
      WritingDraftService.bumpDraftGeneration(userId);
    }
  }, [draftData.status, userId]);

  // Debounce: save LOCALLY shortly after the user stops typing to avoid cloud write-quota exhaustion.
  useEffect(() => {
    const isPristine = isPristineContinuedSession(draftData.content, draftData.title);
    if (user && !isPristine && (draftData.content.trim() || draftData.title.trim())) {
      const debounceDelay = layoutMode === 'mobile' ? 5000 : 500;
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
