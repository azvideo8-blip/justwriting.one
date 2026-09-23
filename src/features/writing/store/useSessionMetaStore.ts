import { create } from 'zustand';
import { registerActiveEditorDocIdGetter } from '../../../core/sync/activeEditor';

export interface SessionMetaStateData {
  activeSessionId: string | null;
  savedDocumentId: string | null;
  sessionStartTime: number | null;
  loadedContent: string | null;
  loadedTitle: string | null;
}

interface SessionMetaState extends SessionMetaStateData {
  setActiveSessionId: (id: string | null) => void;
  setSavedDocumentId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setLoadedBaseline: (content: string | null, title: string | null) => void;
  resetSessionMetadata: () => void;
}

export const useSessionMetaStore = create<SessionMetaState>((set) => ({
  activeSessionId: null,
  savedDocumentId: null,
  sessionStartTime: null,
  loadedContent: null,
  loadedTitle: null,

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSavedDocumentId: (savedDocumentId) => set({ savedDocumentId }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  setLoadedBaseline: (loadedContent, loadedTitle) => set({ loadedContent, loadedTitle }),
  resetSessionMetadata: () => set({
    activeSessionId: null,
    savedDocumentId: null,
    sessionStartTime: null,
    loadedContent: null,
    loadedTitle: null,
  }),
}));

registerActiveEditorDocIdGetter(() => useSessionMetaStore.getState().savedDocumentId);

