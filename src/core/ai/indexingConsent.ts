import { create } from 'zustand';
import { INDEXING_CONSENT_VERSION } from '../../shared/ai/consentVersion';

export { INDEXING_CONSENT_VERSION };

export type IndexingConsentState = 'granted' | 'refused' | 'unanswered';

// _v2: согласие по тексту версии 1 (обещал шифрование на устройстве) не переносится —
// человек увидит исправленный текст и ответит заново (R7F-018).
const INDEXING_CONSENT_KEY = 'ai_indexing_consent_v2';

interface IndexingConsentStore {
  consents: Record<string, IndexingConsentState>;
  setConsent: (userId: string, state: IndexingConsentState) => void;
  getConsent: (userId: string) => IndexingConsentState;
}

export const useIndexingConsentStore = create<IndexingConsentStore>((set, get) => ({
  consents: {},
  setConsent: (userId: string, state: IndexingConsentState) => {
    if (!userId) return;
    try {
      if (state === 'unanswered') {
        localStorage.removeItem(`${INDEXING_CONSENT_KEY}_${userId}`);
      } else {
        localStorage.setItem(`${INDEXING_CONSENT_KEY}_${userId}`, state);
      }
    } catch { /* ignore */ }
    set(s => ({ consents: { ...s.consents, [userId]: state } }));
  },
  getConsent: (userId: string) => {
    if (!userId) return 'unanswered';
    const inMem = get().consents[userId];
    if (inMem) return inMem;
    try {
      const stored = localStorage.getItem(`${INDEXING_CONSENT_KEY}_${userId}`);
      if (stored === 'granted' || stored === 'refused') {
        return stored;
      }
    } catch { /* ignore */ }
    return 'unanswered';
  },
}));

export function getIndexingConsent(userId?: string): IndexingConsentState {
  const uid = userId || 'guest';
  return useIndexingConsentStore.getState().getConsent(uid);
}

export function hasIndexingConsent(userId?: string): boolean {
  const uid = userId || 'guest';
  return getIndexingConsent(uid) === 'granted';
}

export function setIndexingConsent(userId: string | undefined, state: IndexingConsentState): void {
  const uid = userId || 'guest';
  useIndexingConsentStore.getState().setConsent(uid, state);
}
