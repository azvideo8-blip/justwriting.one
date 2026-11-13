import { useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { EarlierQuestionOpenContext } from './onboardingQueue';
import { useAuthStatus } from '../features/auth/hooks/useAuthStatus';
import { STORAGE_KEYS } from '../shared/constants/storageKeys';
import { AI_CONSENT_VERSION_REQUIRED } from '../core/constants/privacyVersion';
import { isVaultUnlocked } from '../core/crypto/encrypt';
import { getEncryptionEnabled } from '../core/crypto/cryptoHelpers';
import { withRateLimitRetry } from '../core/services/rateGate';
import { useContentStore } from '../features/writing/store/useContentStore';
import { useTimerStore } from '../features/writing/store/useTimerStore';
import { canAutoStart } from '../features/tour/tourGate';
import { readTourState } from '../features/tour/tourState';
import { FOREIGN_DIALOG, TourOverlay } from '../features/tour/TourOverlay';

const AUTO_POLL_MS = 500;
/** Условия не сошлись за минуту — в этот заход тура нет, отметка не ставится. */
const AUTO_LIMIT_MS = 60_000;
const MANUAL_POLL_MS = 100;
/** Ручной запуск ждёт, пока закроется окно, из которого его нажали (настройки). */
const MANUAL_LIMIT_MS = 3000;
const MANUAL_QUIET_MS = 300;

function stored(read: () => string | null): string | null | undefined {
  try { return read(); } catch { return undefined; }
}

/** Заметок на устройстве. Запертый сейф или сбой чтения — `null`, не ноль. */
async function countLocalNotes(uid: string): Promise<number | null> {
  try {
    if (getEncryptionEnabled(uid) && !isVaultUnlocked()) return null;
    const { LocalStorageService } = await import('../core/services/LocalStorageService');
    return (await LocalStorageService.getDocumentsByOwner(uid)).length;
  } catch {
    return null;
  }
}

async function countCloudNotes(uid: string): Promise<number | null> {
  try {
    const { readCloudDocumentsPartial } = await import('../core/services/cloudListPartial');
    const list = await withRateLimitRetry(() => readCloudDocumentsPartial(uid));
    return list.docs.length + list.unreadable.length;
  } catch {
    return null;
  }
}

interface TourAutoStartProps {
  /** Запуск из «Как всё устроено»: отметка и число заметок не спрашиваются. */
  manual: boolean;
  onEnd: () => void;
}

/**
 * TR-4: ленивая половина автозапуска. Живёт в `app/`, а не в `features/tour`:
 * ей нужны состояние письма и вход, а фичи друг друга не импортируют. Собирает условия для `canAutoStart` и
 * ждёт, пока они сойдутся. Сам ничего не пишет: отметку ставит только тур.
 */
export function TourAutoStart({ manual, onEnd }: TourAutoStartProps) {
  const { user, isGuest } = useAuthStatus();
  const { pathname } = useLocation();
  const queued = useContext(EarlierQuestionOpenContext);
  const [show, setShow] = useState(false);
  const uid = user && !isGuest ? user.uid : null;
  const live = useRef({ pathname, queued, onEnd });
  useEffect(() => { live.current = { pathname, queued, onEnd }; });

  useEffect(() => {
    if (show) return;
    let elapsed = 0;
    let quietMs = 0;
    let noteCount: number | null = null;
    let cloudCount: number | null = null;
    let counting = false;
    let cloudAsked = false;
    let alive = true;
    const poll = manual ? MANUAL_POLL_MS : AUTO_POLL_MS;

    const tick = () => {
      elapsed += poll;
      quietMs = document.querySelector(FOREIGN_DIALOG) ? 0 : quietMs + poll;
      if (manual) {
        if (quietMs >= MANUAL_QUIET_MS) setShow(true);
        else if (elapsed >= MANUAL_LIMIT_MS) live.current.onEnd();
        return;
      }
      // Число заметок перечитывается каждый тик: после «восстановить из облака»
      // ноль устарел бы. У нового человека это чтение пустого списка.
      if (uid && !counting) {
        counting = true;
        void countLocalNotes(uid).then(n => { if (alive) { noteCount = n; counting = false; } });
      }
      const input = {
        signedIn: !!uid,
        isGuest,
        path: live.current.pathname,
        tourState: uid ? readTourState(uid) : null,
        privacyConfirmed: !!uid && stored(() => localStorage.getItem(STORAGE_KEYS.PRIVACY_ACCEPTED(uid))) === String(AI_CONSENT_VERSION_REQUIRED),
        syncAnswered: !!uid && (
          typeof stored(() => localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ASKED(uid))) === 'string' ||
          typeof stored(() => localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(uid))) === 'string'
        ),
        // Хранилище не ответило — считаем, что код ждёт показа.
        recoveryCodePending: !uid || [
          stored(() => sessionStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid))),
          stored(() => localStorage.getItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(uid))),
        ].some(v => v !== null),
        queued: live.current.queued,
        dialogQuietMs: quietMs,
        noteCount,
        cloudCount,
        editorEmpty: useContentStore.getState().content.trim() === '',
        sessionIdle: useTimerStore.getState().status === 'idle',
      };
      // Облако читаем один раз и только когда всё остальное уже сошлось.
      if (uid && !cloudAsked && canAutoStart({ ...input, cloudCount: 0 }) === 'start') {
        cloudAsked = true;
        void countCloudNotes(uid).then(n => { if (alive) cloudCount = n; });
      }
      const verdict = canAutoStart(input);
      if (verdict === 'start') setShow(true);
      else if (verdict === 'never' || elapsed >= AUTO_LIMIT_MS) live.current.onEnd();
    };
    const id = window.setInterval(tick, poll);
    return () => { alive = false; window.clearInterval(id); };
  }, [manual, uid, isGuest, show]);

  return show ? <TourOverlay uid={uid} isGuest={isGuest} onClose={onEnd} /> : null;
}
