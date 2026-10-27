import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStatus } from '../../app/useAuthStatus';
import { isVaultUnlocked } from '../crypto/encrypt';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { VAULT_UNLOCKED_EVENT } from '../crypto/vaultEvents';
import { onDomainEvent } from '../events/domainEvents';
// BS (N-2): LocalStorageService и DocumentService приходят по требованию внутри
// проверки — статически они вытягивали из ленивого куска в стартовый весь слой
// документов вместе с движком синхронизации.

export function getRestoreDismissedKey(userId: string): string {
  return `jw_restore_prompt_dismissed_${userId}`;
}

export function isRestoreDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(getRestoreDismissedKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function setRestoreDismissed(userId: string, dismissed = true): void {
  try {
    if (dismissed) {
      localStorage.setItem(getRestoreDismissedKey(userId), 'true');
    } else {
      localStorage.removeItem(getRestoreDismissedKey(userId));
    }
  } catch {
    /* ignore */
  }
}

export interface EmptyDeviceDetectionState {
  shouldPrompt: boolean;
  localCount: number;
  cloudCount: number;
  /** RA1-5: облако не пустое, а на устройстве ещё ни одной записи. Баннер
   *  остаётся и после «Не сейчас» — до первой локальной записи. */
  showCloudBanner: boolean;
  dismiss: () => void;
  recheck: () => Promise<void>;
}

/**
 * `cloudOnlyWhenEmpty` — для копий, которым нужен только баннер пустого главного
 * (`CloudNotesBanner`): облако читается лишь пока на устройстве нет записей.
 * Ревью 26.10: баннер монтируется заново после каждого завершения записи на
 * телефоне и при каждом заходе на главный на десктопе — полное чтение облака
 * с расшифровкой шло каждый раз, тот же BR-4 через второй вход.
 */
export function useEmptyDeviceDetection(opts?: { cloudOnlyWhenEmpty?: boolean }): EmptyDeviceDetectionState {
  const bannerOnly = opts?.cloudOnlyWhenEmpty === true;
  const { user, isGuest } = useAuthStatus();
  // BR-4: ключ проверки — строка `uid`, а не объект `user`: объект у
  // `useAuthStatus` новый на каждый рендер, и `check` пересоздавался,
  // перезапуская чтение локального и облачного списков на каждый рендер AppShell.
  const uid = user?.uid ?? null;
  // BR-4: один снимок на владельца. Сбрасывать три стейта эффектом нельзя
  // (линтер `react-hooks/set-state-in-effect`, и до первого ответа был бы
  // кадр с чужими числами) — вместо этого числа принадлежат тому `uid`, при
  // котором прочитаны: чужой снимок просто не показан.
  const [snapshot, setSnapshot] = useState<{ uid: string | null; local: number; cloud: number; prompt: boolean }>({ uid, local: 0, cloud: 0, prompt: false });
  const mine = snapshot.uid === uid ? snapshot : { uid, local: 0, cloud: 0, prompt: false };
  const localCount = mine.local;
  const cloudCount = mine.cloud;
  const shouldPrompt = mine.prompt;

  // Самопроверка 25.10: облачное чтение может кончиться уже после того, как
  // владелец сменился. Пишет только тот, кто сейчас настоящий; чужой поздний
  // ответ отбрасывается — он не должен ни показать чужие числа, ни стереть
  // уже прочитанные свои.
  const currentUidRef = useRef<string | null>(uid);
  useEffect(() => { currentUidRef.current = uid; }, [uid]);

  const write = useCallback((ownerUid: string | null, patch: Partial<{ local: number; cloud: number; prompt: boolean }>) => {
    if (currentUidRef.current !== ownerUid) return;
    setSnapshot(prev => (prev.uid === ownerUid
      ? { ...prev, ...patch }
      : { uid: ownerUid, local: 0, cloud: 0, prompt: false, ...patch }));
  }, []);

  /** Локальное число записей — без чтения облака. */
  const readLocalCount = useCallback(async (): Promise<number | null> => {
    if (!uid) return null;
    const { LocalStorageService } = await import('../services/LocalStorageService');
    return (await LocalStorageService.getDocumentsByOwner(uid)).length;
  }, [uid]);

  const check = useCallback(async (opts?: { cloudOnlyWhenEmpty?: boolean }) => {
    if (!uid || isGuest) {
      write(uid, { local: 0, cloud: 0, prompt: false });
      return;
    }

    const dismissed = isRestoreDismissed(uid);

    // Vault check: wait for vault unlock if encryption enabled
    if (getEncryptionEnabled(uid) && !isVaultUnlocked()) {
      // BR-4: запертый сейф — счётчики прошлого аккаунта показывать нельзя.
      write(uid, { local: 0, cloud: 0, prompt: false });
      return;
    }

    try {
      const localLen = await readLocalCount();
      if (localLen === null) return;
      // BR-4: локальное число — сразу. Раньше `setLocalCount` стоял после
      // облачного чтения, и сбой облака оставлял экран с `localCount = 0`.
      write(uid, { local: localLen });

      // BR-4: облако читаем только пока на устройстве пусто. `DocumentService
      // .getUserDocuments` ходит постранично по всем заметкам с расшифровкой, и
      // раньше этот перезапуск случался на каждое сохранение — навсегда.
      if (opts?.cloudOnlyWhenEmpty && localLen > 0) return;

      const [{ DocumentService }] = await Promise.all([
        import('../services/DocumentService'),
      ]);
      const cloudLen = (await DocumentService.getUserDocuments(uid)).length;

      // AG-RESTORE-1: Prompt if local device has fewer notes than the cloud.
      // RA1-5: отклонённая модалка гасит только вопрос; счётчики читаются и
      // дальше — из них живёт баннер на пустом главном.
      const isMissingCloudNotes = localLen < cloudLen && cloudLen > 0;
      write(uid, { cloud: cloudLen, prompt: isMissingCloudNotes && !dismissed });
    } catch {
      write(uid, { prompt: false });
    }
  }, [uid, isGuest, readLocalCount, write]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) {
        await check({ cloudOnlyWhenEmpty: bannerOnly });
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [check, bannerOnly]);

  // RA1-5: запертый сейф отвечал «вопроса нет» навсегда — после разблокировки
  // проверку нужно повторить, иначе главный так и остаётся пустым без вопроса.
  useEffect(() => {
    const onUnlocked = () => { void check({ cloudOnlyWhenEmpty: bannerOnly }); };
    window.addEventListener(VAULT_UNLOCKED_EVENT, onUnlocked);
    return () => window.removeEventListener(VAULT_UNLOCKED_EVENT, onUnlocked);
  }, [check, bannerOnly]);

  // Дейлик 27.10: сбой чтения облака — «нет ответа», а не «пусто». На новом
  // пустом устройстве ни сейфа, ни сохранения может не случиться — перечитываем,
  // когда вернулась сеть (облако — только пока устройство пустое).
  useEffect(() => {
    const onOnline = () => { void check({ cloudOnlyWhenEmpty: true }); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [check]);

  // RA1-5: появилась первая локальная запись — баннер «в облаке N заметок»
  // больше не про этот экран. BR-4: событие фильтруется по владельцу (как
  // `useReturnNote` и `useOnThisDayHome`), а перечитка облака нужна только
  // пока устройство пустое.
  useEffect(() => onDomainEvent((e) => {
    if (e.type !== 'note.saved') return;
    if (e.userId && uid && e.userId !== uid) return;
    void check({ cloudOnlyWhenEmpty: true });
  }), [check, uid]);

  const dismiss = useCallback(() => {
    if (uid) {
      setRestoreDismissed(uid, true);
    }
    write(uid, { prompt: false });
  }, [uid, write]);

  return {
    shouldPrompt,
    localCount,
    cloudCount,
    showCloudBanner: Boolean(uid) && !isGuest && localCount === 0 && cloudCount > 0,
    dismiss,
    recheck: check,
  };
}
