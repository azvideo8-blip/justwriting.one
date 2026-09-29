import type { AIMessage } from '../AIService';

// AUDIT-part3 6: был мёртвым экспортом — внешних потребителей нет,
// интерфейс нужен только внутри модуля.
export interface ChatContextResult {
  userPortrait: string | null;
  customPersona: string | undefined; // customSystemPrompt
  searchContext: string | undefined;
  documentMood: string | undefined;
  memoryContext?: string | null;
  injectedDocumentIds?: string[];
  allowedFirstSeenDates?: string[];
  degradedReason?: 'daily_limit' | undefined;
  /** Острый риск в реплике или приложенной заметке: UI показывает телефоны помощи. */
  crisis?: boolean;
}

export interface BuildContextParams {
  text: string;
  attached: { content: string; documentId?: string } | null;
  mood: string | undefined;
  messageHistory: AIMessage[];
  isFirstTurn: boolean;
  dialogueId?: string | null;
  forcedSearchQuery?: string | undefined;
  attachedIsSticky?: boolean | undefined;
  /** Режим хода при заметке-теме (turnScope). 'note' — в контекст идёт только она. */
  scope?: 'note' | 'wide' | undefined;
}
