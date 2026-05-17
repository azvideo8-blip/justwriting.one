import { create } from 'zustand';

interface SessionMetaState {
  activeSessionId: string | null;
  savedDocumentId: string | null;
  sessionStartTime: number | null;

  setActiveSessionId: (id: string | null) => void;
  setSavedDocumentId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  resetSessionMetadata: () => void;
}

export const useSessionMetaStore = create<SessionMetaState>((set) => ({
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null,

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSavedDocumentId: (savedDocumentId) => set({ savedDocumentId }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  resetSessionMetadata: () => set({
    activeSessionId: null,
    savedDocumentId: null,
    sessionStartTime: null,
  }),
}));
