import { create } from 'zustand';
import { isProfileLoaded } from '../crypto/cryptoHelpers';

interface AIConsentState {
  consents: Record<string, boolean>;
  setAiConsent: (userId: string, enabled: boolean) => void;
  getAiConsent: (userId: string) => boolean;
}

export const useAiConsentStore = create<AIConsentState>((set, get) => ({
  consents: {},
  setAiConsent: (userId: string, enabled: boolean) => {
    if (!userId) return;
    set(state => ({ consents: { ...state.consents, [userId]: enabled } }));
  },
  getAiConsent: (userId: string) => {
    if (!userId) return false;
    return get().consents[userId] ?? false;
  },
}));

export function setAiConsent(userId: string, enabled: boolean): void {
  useAiConsentStore.getState().setAiConsent(userId, enabled);
}

export function getAiConsent(userId: string): boolean {
  return useAiConsentStore.getState().getAiConsent(userId);
}

export { isProfileLoaded };
