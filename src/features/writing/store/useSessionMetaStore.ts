import { create } from 'zustand';
import { registerActiveEditorDocIdGetter } from '../../../core/sync/activeEditor';

export interface SessionMetaStateData {
  activeSessionId: string | null;
  savedDocumentId: string | null;
  sessionStartTime: number | null;
  loadedContent: string | null;
  loadedTitle: string | null;
  /**
   * R7Q-008: идентификатор РЕДАКТИРУЕМОГО Черновика. `savedDocumentId` у
   * несохранённой заметки — null, и «null === null» не различает два разных
   * новых черновика: текст диктовки уезжал в тот, что открыли вторым.
   */
  draftNonce: string;
}

interface SessionMetaState extends SessionMetaStateData {
  setActiveSessionId: (id: string | null) => void;
  setSavedDocumentId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setLoadedBaseline: (content: string | null, title: string | null) => void;
  newDraftNonce: () => string;
  resetSessionMetadata: () => void;
}

/** Новый черновик = новый идентификатор. Коллизия случайности не опасна:
 *  она означала бы лишь «текст вставился в соседний свежий черновик». */
export function newDraftNonce(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const useSessionMetaStore = create<SessionMetaState>((set) => ({
  activeSessionId: null,
  savedDocumentId: null,
  sessionStartTime: null,
  loadedContent: null,
  loadedTitle: null,
  draftNonce: newDraftNonce(),

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSavedDocumentId: (savedDocumentId) => set({ savedDocumentId }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  setLoadedBaseline: (loadedContent, loadedTitle) => set({ loadedContent, loadedTitle }),
  newDraftNonce,
  resetSessionMetadata: () => set({
    activeSessionId: null,
    savedDocumentId: null,
    sessionStartTime: null,
    loadedContent: null,
    loadedTitle: null,
    draftNonce: newDraftNonce(),
  }),
}));

registerActiveEditorDocIdGetter(() => useSessionMetaStore.getState().savedDocumentId);

