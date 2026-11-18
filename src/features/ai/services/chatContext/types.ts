import type { AIMessage } from '../AIService';
import type { AttachedNoteBlock } from '../../utils/attachedNoteFormat';
import type { HypoStats } from '../../../../shared/ai/chatShape';

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
  /** Разбор 18.11: шаги подбора опор, если ход их подбирал (только числа, в журнал сервера). */
  hypoStats?: HypoStats | undefined;
}

export interface BuildContextParams {
  text: string;
  /**
   * Приложенные заметки списком (DY5: блок — данные, а не позиция в строке).
   * fromLink — заметка диалога, поднятая по его documentId после перезагрузки:
   * человек её в этом ходе не присылал.
   */
  attached: { blocks: AttachedNoteBlock[]; fromLink?: boolean } | null;
  mood: string | undefined;
  messageHistory: AIMessage[];
  isFirstTurn: boolean;
  dialogueId?: string | null;
  forcedSearchQuery?: string | undefined;
  attachedIsSticky?: boolean | undefined;
  /** Режим хода при заметке-теме (turnScope). 'note' — в контекст идёт только она. */
  scope?: 'note' | 'wide' | undefined;
  /**
   * К21-1: id заметок, которые модель видела в материалах прошлого ответа
   * (`contextDocIds` его реплики). По ним ход «откуда ты это взял?» поднимает те
   * же записи. Отдельное поле, а не часть messageHistory: история уходит модели
   * на провод, а это — данные хода.
   */
  prevTurnDocIds?: string[] | undefined;
}
