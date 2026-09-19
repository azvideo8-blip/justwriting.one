import { create } from 'zustand';

// Backlog idea "de-personalised portrait", shape 1 (docs/backlog-ideas-2026-09-11.md):
// a per-account switch, decided by the person, not a product-wide default. Same
// shape as indexingConsent.ts — a device-local preference, not a server column,
// because it is not a legal consent and does not need to follow the account
// across devices.
const PORTRAIT_IN_DIALOGUE_KEY = 'ai_send_portrait_in_dialogue';

interface PortraitDialoguePreferenceStore {
  values: Record<string, boolean>;
  setSend: (userId: string, send: boolean) => void;
  getSend: (userId: string) => boolean;
}

export const usePortraitDialoguePreferenceStore = create<PortraitDialoguePreferenceStore>((set, get) => ({
  values: {},
  setSend: (userId: string, send: boolean) => {
    if (!userId) return;
    try {
      localStorage.setItem(`${PORTRAIT_IN_DIALOGUE_KEY}_${userId}`, send ? '1' : '0');
    } catch { /* ignore */ }
    set(s => ({ values: { ...s.values, [userId]: send } }));
  },
  getSend: (userId: string) => {
    if (!userId) return true;
    const inMem = get().values[userId];
    if (inMem !== undefined) return inMem;
    try {
      const stored = localStorage.getItem(`${PORTRAIT_IN_DIALOGUE_KEY}_${userId}`);
      // Default is "send" — the behaviour every existing account already has.
      // Only an explicit '0' turns it off; anything else (unset, garbled) sends.
      if (stored === '0') return false;
    } catch { /* ignore */ }
    return true;
  },
}));

export function getSendPortraitInDialogue(userId?: string | null): boolean {
  const uid = userId || 'guest';
  return usePortraitDialoguePreferenceStore.getState().getSend(uid);
}

export function setSendPortraitInDialogue(userId: string | undefined | null, send: boolean): void {
  const uid = userId || 'guest';
  usePortraitDialoguePreferenceStore.getState().setSend(uid, send);
}
