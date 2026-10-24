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
  /** DLG-Q8: названия заметок, попавших в контекст хода — против выдуманных «заметок». */
  injectedTitles?: string[];
  allowedFirstSeenDates?: string[];
  degradedReason?: 'daily_limit' | undefined;
  /** Острый риск в реплике или приложенной заметке: UI показывает телефоны помощи. */
  crisis?: boolean;
  /** Режим хода, если контекст его поменял (LD-6: согласие после широкого хода).
   *  По нему строится правило заметки на сервере — иначе модель получала бы
   *  «анализируй только заметку» рядом с результатами поиска. */
  effectiveScope?: 'note' | 'wide' | undefined;
}

export interface BuildContextParams {
  text: string;
  /** blockIds — id приложенных заметок от сборщика хода; без них шапкам в тексте не верим. */
  attached: { content: string; documentId?: string; blockIds?: string[] } | null;
  mood: string | undefined;
  messageHistory: AIMessage[];
  isFirstTurn: boolean;
  dialogueId?: string | null;
  forcedSearchQuery?: string | undefined;
  attachedIsSticky?: boolean | undefined;
  /** Режим хода при заметке-теме (turnScope). 'note' — в контекст идёт только она. */
  scope?: 'note' | 'wide' | undefined;
}
