import { useEffect, useCallback, useRef } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { mayAccountWriteEditorText, markEditorTextOwnedBy } from '../utils/draftOwnerGuard';
import { getEditorTextOwner, markEditorTextOwner, applySessionEnd } from '../services/draftWriter';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus, type DraftErrorKind, type DraftSaveOutcome } from './useDraftCore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { WritingDraftService } from '../services/WritingDraftService';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { reportError } from '../../../shared/errors/reportError';
import { onBeforeAccountReload } from '../../../core/auth/accountReload';

const SKIPPED: DraftSaveOutcome = { localSkipped: true };
const FOREIGN_TEXT: DraftSaveOutcome = { localSkipped: true, localSkipOutcome: 'owner-mismatch' };

/** Текст равен сохранённой заметке, которую продолжают (D-24): писать нечего. */
export function isPristineContinuedSession(content: string, title: string): boolean {
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
  const { saveStatus, saveErrorKind, lastSavedAt, remotePermanentError, wrapSave, clearLocalWriteStuck } = useDraftCore({ userId });
  const draftDataRef = useRef(draftData);
  // Приёмка ai-privacy (код-ревью, M-3): поколение черновика на момент последней
  // правки. Сохранение заметки поднимает поколение и стирает черновик ДО сброса
  // сессии; запись на размонтировании в этом окне с текущим поколением вернула бы
  // уже сохранённый текст «несохранённым черновиком». С этим поколением запись
  // отвергается (saveToLocal сверяет поколение).
  //
  // DY10-10: «момент правки» — это изменение текста, а не последний рендер.
  // `seconds` и `wpm` тикают каждую секунду, объект `draftData` пересоздаётся, и
  // ссылка обновлялась до текущего поколения раньше, чем отсроченная запись
  // успевала сработать. На медленной сети сохранение заметки длится секунды,
  // отсрочка (1 с на телефоне) срабатывает внутри окна между стиранием черновика
  // и сбросом сессии — и записывает сохранённый текст обратно. Надгробие его не
  // ловит: `savedDocumentId` к тому моменту заполнен, хэш нагрузки другой, а
  // метка строки новее отметки удаления.
  const draftGenAtEditRef = useRef<number | undefined>(undefined);
  const editedRef = useRef<{
    content: string;
    title: string;
    wordCount: number;
    initialWordCount: number | undefined;
    pinnedThoughts: string;
    activeSessionId: string | null;
    sessionStartTime: number | undefined;
  } | null>(null);
  const { layoutMode } = useLayoutMode();
  useEffect(() => {
    draftDataRef.current = draftData;
    if (!userId) return;
    const edited = {
      content: draftData.content,
      title: draftData.title,
      wordCount: draftData.wordCount,
      initialWordCount: draftData.initialWordCount,
      pinnedThoughts: draftData.pinnedThoughts.join('\u0000'),
      activeSessionId: draftData.activeSessionId,
      sessionStartTime: draftData.sessionStartTime,
    };
    const prev = editedRef.current;
    if (prev && (Object.keys(edited) as (keyof typeof edited)[]).every(k => prev[k] === edited[k])) return;
    editedRef.current = edited;
    draftGenAtEditRef.current = WritingDraftService.getDraftGeneration(userId);
    // DW-9: правка под текущим аккаунтом делает текст его — с этого момента
    // «владельца нет» не означает «текущий аккаунт» ни для одного писателя
    // (I6 из карты DW-2). Первый рендер экземпляра (prev === null) правкой не
    // считается. Владелец меняется только вместе с ТЕКСТОМ: кортеж правки содержит
    // заголовок, закрепления и id сессии.
    if (prev && prev.content !== edited.content) {
      markEditorTextOwnedBy(userId, edited.content);
    }
  }, [draftData, userId]);

  /**
   * Текст этого аккаунта? Ничейный (новый, гостевой) становится его. Смена аккаунта
   * перезагружает вкладку (`accountReload.ts`), поэтому чужому тексту здесь взяться
   * неоткуда. Если взялся — видимый отказ, а не запись под чужим именем.
   */
  const ownsText = useCallback((uid: string): boolean => {
    const owner = getEditorTextOwner();
    if (owner === uid) return true;
    if (!owner || owner.startsWith('guest')) {
      markEditorTextOwner(uid);
      return true;
    }
    return false;
  }, []);

  const doAutosaveLocal = useCallback(async (opts?: { unmounting?: boolean }): Promise<DraftSaveOutcome> => {
    if (!user) return SKIPPED;
    const current = draftDataRef.current;
    if (!current.content.trim() && !current.title.trim()) return SKIPPED;
    // D-24: do not save draft for continued notes with no edits
    if (isPristineContinuedSession(current.content, current.title)) return SKIPPED;
    if (opts?.unmounting === true) {
      // DW-9: правило живёт в одном помощнике вместе с записью при закрытии
      // вкладки — два писателя одного текста не могут сверять владельца по-разному.
      if (!mayAccountWriteEditorText(user.uid, current.content)) return SKIPPED;
    } else if (!ownsText(user.uid)) return FOREIGN_TEXT;

    // Шаг 5 DW-4: эпоха правки едет в строке (`buildLocalDraft`), а не отдельным
    // аргументом: писателю нечего «забыть назвать», сверяет её мутатор.
    const draft = buildLocalDraft(user, current, draftGenAtEditRef.current);
    const result = await persistDraft(draft, { remote: false });
    if (!result.localOk) {
      throw result.localError ?? new Error('Local save failed');
    }
    // VIS: исход отказа доезжает до показа — иначе `no-owner`/`owner-mismatch`
    // неразличимы со штатным `stale-epoch` и выглядят как «нечего сохранять».
    if (result.localSkipped) return { localSkipped: true, localSkipOutcome: result.localSkipOutcome };
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
    if (!ownsText(user.uid)) return FOREIGN_TEXT;

    const draft = buildLocalDraft(user, current, draftGenAtEditRef.current);
    // DY10-10: тот же токен, что у локальной записи. Уход в фон и 30-секундная
    // страховка срабатывают по часам, а не по правке, и без поколения они пишут
    // в облако черновик, который сохранение заметки уже стёрло.
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw result.localError ?? new Error('Local save failed');
    }
    // N-48: локальная запись пропущена — не «Сохранено», и облачный успех
    // не должен снимать флаг «облако устарело».
    if (result.localSkipped) return { localSkipped: true, localSkipOutcome: result.localSkipOutcome };
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

  /** DY10-10: эпоха, названная на момент правки. Сверку делает мутатор
   *  (applyWrite, DW4-2) — writer-сверка isStaleDraftWrite удалена: правило
   *  одно на все адреса, второй источник эпохи на один выпуск — класс DW-4. */
  const getWriteEpoch = useCallback(() => draftGenAtEditRef.current, []);

  // Дейлик 03.11 Н-2: у сейфа снимка в localStorage нет (SEC-56) — хвост,
  // не дождавшийся отсрочки, уходит той же локальной записью, что и на размонтировании.
  const flushLocalOnUnload = useCallback(() => {
    void doAutosaveLocal({ unmounting: true })
      .catch(e => reportError(e, { action: 'draftAutosave_unloadEncrypted', userId }, 'warning'));
  }, [doAutosaveLocal, userId]);

  useSyncUnloadSave(user, draftDataRef, getWriteEpoch, flushLocalOnUnload);
  useVisibilitySave(wrappedForceSave, () => draftDataRef.current.content);

  // Invalidate in-flight autosaves on unmount or when transitioning to idle.
  // AS-1: перед подъёмом поколения пишем локальный черновик — уход из редактора
  // снимает таймер, и последние секунды набора иначе жили только в памяти.
  // DW4-4: только на настоящей выгрузке, а не на смене uid.
  const unmountSaveRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    unmountSaveRef.current = async () => {
      if (!userId) return;
      try {
        await doAutosaveLocal({ unmounting: true });
      } catch (e) {
        reportError(e, { action: 'draftAutosave_unmount', userId });
      } finally {
        // Шаг 5: сессию письма закрывает мутатор, а не этот писатель.
        applySessionEnd(userId);
      }
    };
  });
  useEffect(() => () => {
    const save = unmountSaveRef.current;
    unmountSaveRef.current = null;
    if (save) void save();
  }, []);

  useEffect(() => {
    if (draftData.status === 'idle' && userId) {
      applySessionEnd(userId);
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
    // Заметка ревьюера 04.11 21:55, п.2: текст стёрт — попытки записи пустого
    // не бывает (условие выше), `markSaved` не зовётся, и баннер «только на
    // экране» остался бы висеть над пустым редактором неправдой.
    // Правки отменены до сохранённой заметки: писать нечего, текст уже в заметке.
    if (user && (isPristine || (!draftData.content.trim() && !draftData.title.trim()))) {
      clearLocalWriteStuck();
    }
  }, [draftData.content, draftData.title, draftData.wordCount, user, wrappedAutosaveLocal, layoutMode, clearLocalWriteStuck]);

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
