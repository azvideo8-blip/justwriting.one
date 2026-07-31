import { create } from 'zustand';

/**
 * What the app is actually doing while the user waits.
 *
 * The indicator used to say "{персона} думает…" for the whole wait, which is
 * simply not what happens: most of that time is spent searching notes, reading
 * their summaries and picking the closest ones — the model is not involved yet.
 * Naming the real step is both honest and more informative when it takes long.
 */
export type AIStage =
  | 'query'      // making sense of the request
  | 'search'     // going through the notes
  | 'rank'       // picking the closest ones
  | 'summaries'  // reading what was written about them
  | 'memory'     // recalling earlier conversations
  | 'timeline'   // looking at the chronology
  | 'answer';    // the model is finally writing

/** Third person, so it reads as "{персона} ищет в заметках…" */
export const AI_STAGE_LABEL: Record<AIStage, string> = {
  query: 'разбирает запрос',
  search: 'ищет в заметках',
  rank: 'отбирает самое близкое',
  summaries: 'читает сводки заметок',
  memory: 'вспоминает прошлые разговоры',
  timeline: 'смотрит хронологию',
  answer: 'пишет ответ',
};

interface AIStageState {
  stage: AIStage | null;
  setStage: (stage: AIStage | null) => void;
}

export const useAIStageStore = create<AIStageState>((set) => ({
  stage: null,
  setStage: (stage) => set({ stage }),
}));

/** Callable from services that are not React components. */
export function setAIStage(stage: AIStage | null): void {
  useAIStageStore.getState().setStage(stage);
}
