import { useState, useCallback, useEffect, useRef } from 'react';
import { getCurrentUser } from '../../../core/auth';
import { getChatExtrasEnabled } from '../../../core/ai/chatExtrasPreference';
import { getAiConsent, isProfileLoaded } from '../../../core/ai/aiConsent';
import { getLocalDb, type AIDialogue } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS, AIPersonaService } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useLanguage } from '../../../shared/i18n';
import { truncateText } from '../../../shared/utils/textLimits';
import { incrementDailyUsage, setDailyLimitExhausted } from './useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import type { AIMessage } from '../services/AIService';
import { AIService } from '../services/AIService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { captureConfirmedInsight } from '../services/insightCapture';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { reportError } from '../../../shared/errors/reportError';
import { reportAIDegradation } from '../utils/aiDegradationReporter';

import { useAIChatContext, type AttachedNoteRef } from '../services/aiChatContext';
import { turnScope, type TurnScope } from '../utils/turnScope';
import { noteMetaFor, noteScopeFor } from '../utils/noteMeta';
import { repairStrictNoteRefs } from '../../../shared/ai/strictRefRepair';
import {
  streamChat,
  callableChat,
  extractReasoning,
  extractAnswer,
  prepareApiMessages,
  withoutStaleEmptyClaims,
  toApiContent,
  splitAttachedMessage,
  legacyNoteHidden,
  citesAnyId,
  HIDDEN_ANSWER_PLACEHOLDER,
  HIDDEN_NOTE_TITLE,
  cleanAttachedTitle,
  API_MSG_CAP,
  _streamUnavailableUntil
} from '../utils/aiChatTransport';
import { hiddenNoteIdsFromDocs } from '../utils/hiddenNoteIds';
import { localDocIds } from '../utils/canonicalDocumentId';
import { isExcludedFromAI, isPastedAttachmentId, findNoteRow, noteHiddenFromAI } from '../utils/isExcludedFromAI';
import { aiWrittenNoteIds, humanQuestions } from '../utils/aiAuthorship';
import { detectAuthorGender, expandGenderForms } from '../../../shared/ai/authorGender';
import type { AttachedNoteBlock } from '../utils/attachedNoteFormat';
import { extractCitationIds } from '../services/chatContext/citations';
import { sanitizeFirstSeenDates } from '../utils/dateGuard';
import { fixCitedDates, hypothesisCitedDates } from '../utils/citedDateGuard';
import { normalizeQuoteText, quoteMaterialsText, unquoteAbsent, dropFabricatedSentences } from '../../../shared/ai/quoteGuard';
import { ARCHIVE_TURN_MARK } from '../../../shared/ai/archiveAnswerRule';
import { notesClaimWithoutRef } from '../../../shared/ai/notesRefRule';
import { CITATION_RE, isRecognisedCitation, extractSearchRequest, toolCallToSearchMarker } from '../shared/citationPatterns';
import { setAIStage } from '../store/useAIStageStore';
import { aiErrorToText } from '../../../shared/ai/aiErrorUtils';
export { API_MSG_CAP };

export interface SendMessageOptions {
  /** S-25/S-29: id пользовательской реплики заменяемого хода — не позиция. */
  replaceUserId?: string | undefined;
  /** Вопрос хода без текста заметки: по нему решается режим и строится контекст. */
  question?: string;
  /** Кнопки «Связать с другими записями» / «Посмотреть в других записях». */
  forceWide?: boolean;
  /** Название и дата приложенной заметки — для правила строгого хода. */
  noteMeta?: { title: string; date: string };
}

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  streamingReasoning: string | null;
  error: string | null;
  sendMessage: (text: string, attached?: { blocks: AttachedNoteBlock[]; documentId?: string }, mood?: string, forcedSearchQuery?: string, options?: SendMessageOptions) => Promise<string | null>;
  lastTurnScope: TurnScope | null;
  prepareAttachment: (documentId: string) => Promise<{ title: string; content: string; lastSessionAt?: number | undefined } | null>;
  stop: () => void;
  regenerateLast: () => Promise<void>;
  triggerForcedSearch: (query: string) => Promise<void>;
  crisisActive: boolean;
  dismissCrisis: () => void;
  clearError: () => void;
  /** S-31: отсутствие согласия — состояние, а не техническая ошибка. */
  consentRequired: ConsentCode | null;
}

const INTERRUPTED_STREAM_MARKER = '\n\n[ответ не дописан — стрим оборвался]';

// S-31: коды клиентского гейта согласия. Отсутствие согласия — состояние, а не
// поломка: callable бросает тот же код, а в журнал активности писать нечего.
export type ConsentCode = 'AI_CONSENT_REQUIRED' | 'INDEXING_CONSENT_REQUIRED';
const CONSENT_CODES: readonly ConsentCode[] = ['AI_CONSENT_REQUIRED', 'INDEXING_CONSENT_REQUIRED'];
const isConsentCode = (msg: string): msg is ConsentCode => (CONSENT_CODES as readonly string[]).includes(msg);
// X-2: отказ по формулировке реплики — тоже состояние, а не сбой сервиса: повтор
// той же реплики даёт тот же отказ. Значит — без callable-повтора (вторая трата
// квоты), без записи в журнал и без «Попробуй позже».
const DISALLOWED_PHRASE = 'DISALLOWED_PHRASE';

// Нормализка для сравнения цитаты с материалами — в src/shared/ai/quoteGuard.ts:
// то же правило считает `quote_unquoted` на сервере (MD-2/MD-3), и две реализации
// разойтись не должны.

// DLG-Q8 (Fable T-18): любые другие квадратные скобки. Модель оформляет ссылкой
// то, чем она не является: [«Новая копилка», 18.09.2026], [из заметок],
// [источник: …]. Правила промпта это запрещают, но промпт — не гарантия, поэтому
// чистим кодом. Правило намеренно ограничено скобками с кириллицей, «ёлочкой»
// или `#`: латинские сноски вида [1] в английском ответе — не выдумка.
const STRAY_BRACKET_RE = /\[([^[\]\n]{1,120})\]/g;

// «в заметке «Письмо маме»», если такого заголовка хода нет → «в заметке про
// письмо маме». Падеж существительного не трогаем: править его кодом — значит
// портить текст на каждом втором окончании.
// П5 (самопроверка): без левой границы маска ловила части внутри других слов —
// «в предзаписи «черновик»» переписывалось, хотя о заметке речи не было.
const TITLE_REF_RE = /(^|[^а-яёА-ЯЁ])((?:заметк|запис|текст)[а-яё]*)\s+«([^»\n]{2,60})»/gi;

// Чекбокс списка и латинская сноска — не ссылка и не выдумка. `[x]` и `[1]`
// иначе съедал CITATION_RE (его вторая ветка — `[a-zA-Z0-9_-]+`, то есть любой
// короткий латинский токен считается id заметки), а `[ ]` — финальная чистка
// пустых скобок. На время чистки прячем их под приватный маркер и возвращаем в
// конце.
const KEEP_TOKEN_RE = /\[(?:\d{1,3}|[a-zA-Z]{1,2}|[ xX])\]/g;
const LIST_ITEM_PREFIX = /(?:^|\n)[ \t]*(?:[-*+]\s+|\d+[.)]\s+)$/;
const KEEP_OPEN = '\uE001';
const KEEP_CLOSE = '\uE002';

// ED-1 (0.10.7): personaId включает исключение Редактора в страже кавычек;
// reasoning выключает страж целиком — ход мыслей черновик модели, а не ответ.
export interface SanitizeCitationsOptions {
  personaId?: string;
  reasoning?: boolean;
  /**
   * RA1-8: в строгом ходе кавычки сверяются только с приложенной заметкой и
   * репликами человека. Фон — пересказ, написанный ИИ, и кавычки в нём
   * оправдывают выдумку. Ссылки и названия по-прежнему сверяются с полным
   * набором (`materialsText`).
   */
  quoteMaterialsText?: string | undefined;
  /**
   * Ход «вопрос о записях» (флаг answer_chronicle_v2): цитата, которой нет в
   * материалах, — признак выдумки, а не огрех пересказа. Предложение с ней
   * удаляется целиком вместе со ссылкой, а не остаётся «по смыслу» (владелец
   * 12.11: выдуманный «контракт» со ссылкой на настоящую заметку).
   */
  dropFabricatedSentences?: boolean | undefined;
}

export function sanitizeCitations(
  text: string,
  injectedIds: string[],
  injectedTitles?: string[],
  materialsText?: string,
  opts?: SanitizeCitationsOptions,
): string {
  const allowed = new Set(injectedIds);
  const UNRECOGNISED_MARKER = '\uE000';
  const kept: string[] = [];
  let src = text.replace(KEEP_TOKEN_RE, (match: string, offset: number) => {
    // пустая скобка-чекбокс имеет смысл только в начале пункта списка
    if (/^\[[ xX]\]$/.test(match) && !LIST_ITEM_PREFIX.test(text.slice(0, offset))) return match;
    kept.push(match);
    return `${KEEP_OPEN}${kept.length - 1}${KEEP_CLOSE}`;
  });

  // Модель иногда сокращает номер: «[#local_d5751490…]». Такой не совпадал ни
  // с одним шаблоном и печатался сырым текстом вместо ссылки. Начало, которое
  // однозначно указывает на заметку из этого хода, достраивается до полного
  // номера; неоднозначное или чужое — убирается, как любая непризнанная ссылка.
  let cleaned = src.replace(/\[#?([a-zA-Z0-9_.-]{6,}?)(?:…|\.{2,3})\]/g, (_match, prefix: string) => {
    const hits = injectedIds.filter(id => id.startsWith(prefix));
    return hits.length === 1 ? `[#${hits[0]}]` : UNRECOGNISED_MARKER;
  });

  cleaned = cleaned.replace(CITATION_RE, (match, g1, g2) => {
    const id = g2 || g1 || '';
    if (isRecognisedCitation(match, id, allowed)) {
      return match.startsWith('[#') ? match : `[#${id}]`;
    }
    return UNRECOGNISED_MARKER;
  });

  // (а) DLG-Q8: всё, что осталось в квадратных скобках и похоже на ссылку, —
  // ссылка невыдуманная или отсутствует. Незакрытая скобка потокового хвоста
  // под этот шаблон не попадает, поэтому незакрытый кусок живёт до следующего
  // чанка и чистится в финальном вызове.
  cleaned = cleaned.replace(STRAY_BRACKET_RE, (match, inner: string, offset: number, whole: string) => {
    if (whole[offset + match.length] === '(') return match;            // markdown-ссылка [текст](url)
    const bare = inner.trim();
    if (!/[а-яё«»#]/i.test(bare)) return match;                        // [1], [EN] — не выдумка
    if (bare.startsWith('#')) {
      // R-2: модель иногда копирует шапку целиком — «[#local_a · 20261006]».
      // Настоящий id этого хода остаётся, дата при этом не нужна: ссылка в
      // интерфейсе живёт по номеру заметки. Номер не фильтруется набором
      // символов: у импортированных заметок он с точкой («1720194283.716586»).
      const id = bare.slice(1).trim().split(/\s*·\s*/)[0] ?? '';
      if (id && allowed.has(id)) return `[#${id}]`;
    }
    return UNRECOGNISED_MARKER;
  });

  // (в) DLG-Q8: название заметки, которого в этом ходе не было.
  // R-1: «в заметке "…"» — это ещё и обычная форма цитаты, поэтому правило
  // срабатывает только когда текст в ёлочках не найден в материалах хода. Без
  // материалов правило молчит: иначе верная цитата переписывается в «про …».
  const materialsHay = materialsText ? normalizeQuoteText(materialsText) : '';
  if (injectedTitles && injectedTitles.length > 0 && materialsHay) {
    const known = new Set(injectedTitles.map(normalizeQuoteText));
    cleaned = cleaned.replace(TITLE_REF_RE, (match, lead: string, word: string, title: string) => {
      const q = normalizeQuoteText(title);
      return known.has(q) || materialsHay.includes(q) ? match : `${lead}${word} про ${title}`;
    });
  }

  // (б) MD-3: кавычки, которых нет в материалах хода. Ранее снималось только то,
  // что модель приписала человеку («ты пишешь …»), и щадили гипотезы; на стенде
  // недословной считается любая цитата от 4 слов, и правило в промпте её не
  // держит (S5: 19/24 на базе). Слова остаются, «примерно:» не добавляется.
  // ED-1: у Редактора «по смыслу» — только по глаголу речи, его предложенные
  // строки от лица автора — не чужая речь. В ходе мыслей страж молчит вовсе.
  if (materialsText && !opts?.reasoning) {
    // RA1-8: если ход называет источник кавычек, сверяем только с ним; иначе
    // прежнее поведение — весь набор материалов (редактор, широкий ход).
    const quoteMaterials = opts?.quoteMaterialsText !== undefined ? opts.quoteMaterialsText : materialsText;
    if (opts?.dropFabricatedSentences) cleaned = dropFabricatedSentences(cleaned, quoteMaterials);
    cleaned = unquoteAbsent(cleaned, quoteMaterials, { markPersonal: opts?.personaId !== 'editor' }).text;
  }

  // Clean up punctuation and whitespace around the removed citation.
  // A list of references ("Источники: [#a], [#b].") loses its separator with the
  // item, whichever position it held — otherwise dropping the first leaves
  // "Источники:, [#b]." and dropping the last leaves "[#a],.". These two must
  // run before the generic punctuation rule below, which would eat the wrong
  // comma first.
  cleaned = cleaned.replace(new RegExp(`${UNRECOGNISED_MARKER}\\s*,\\s*(?=\\[#)`, 'g'), '');
  cleaned = cleaned.replace(new RegExp(`,\\s*${UNRECOGNISED_MARKER}(?=\\s*(?:[.,;:?!]|$))`, 'gm'), '');
  cleaned = cleaned.replace(new RegExp(`\\s*${UNRECOGNISED_MARKER}\\s*([.,;:?!])`, 'g'), '$1');
  cleaned = cleaned.replace(new RegExp(`,\\s*${UNRECOGNISED_MARKER}`, 'g'), '');
  cleaned = cleaned.replace(new RegExp(`(-|\\*)\\s*${UNRECOGNISED_MARKER}`, 'g'), '$1');
  cleaned = cleaned.replace(new RegExp(`\\s*${UNRECOGNISED_MARKER}\\s*`, 'g'), ' ');
  cleaned = cleaned.replace(/ ([.,;:?!])/g, '$1');
  cleaned = cleaned.replace(/ {2,}/g, ' ');
  cleaned = cleaned.replace(/\(\s*\)/g, '');
  cleaned = cleaned.replace(/\[\s*\]/g, '');

  // Снятые на время чистки токены возвращаем на место.
  cleaned = cleaned.replace(new RegExp(`${KEEP_OPEN}(\\d+)${KEEP_CLOSE}`, 'g'),
    (_m, i: string) => kept[Number(i)] ?? '');

  return cleaned.trim();
}

export function useAIChat(dialogueId: string | null, personaId: string, responseLength?: 'short' | 'standard' | 'detailed', reasoning?: boolean): UseAIChatReturn {
  const { language, t } = useLanguage();
  const [dialogue, setDialogue] = useState<AIDialogue | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Режим последнего ответа: под строгим — кнопка «Посмотреть в других записях».
  const [lastTurnScope, setLastTurnScope] = useState<TurnScope | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentRequired, setConsentRequired] = useState<ConsentCode | null>(null);
  // Safety-by-design: surface crisis resources in the UI (not just the prompt)
  // once acute-risk markers are detected; stays until the user dismisses it.
  const [crisisActive, setCrisisActive] = useState(false);

    const context = useAIChatContext(personaId);

  // Stop button: abort the in-flight streaming request.
  const abortRef = useRef<AbortController | null>(null);
  // R-1: Synchronous re-entrancy guard — isSending is React state (async commit),
  // so two calls in the same tick both bypass it. sendingRef is checked/set
  // synchronously, preventing concurrent streams and orphaned AbortControllers.
  const sendingRef = useRef(false);
  // Log unexpected reasoning once per session
  const reasoningMismatchReportedRef = useRef(false);

  const prevDialogueIdRef = useRef(dialogueId);
  useEffect(() => {
    const prev = prevDialogueIdRef.current;
    prevDialogueIdRef.current = dialogueId;
    // Новый диалог получает id после первого ответа (useAIPageData). Это тот же
    // разговор: сброс стирал прилипший поиск и заметку-тему, второй ход («а мы
    // тогда помирились?») шёл без найденных заметок, и модель сочиняла их
    // содержание (аудит диалогов, раунд 2, provider-log 769→781).
    if (prev === null && dialogueId !== null) return;
    context.resetSession();
    setCrisisActive(false);
    // Кнопка «Посмотреть в других записях» относится к ответу прошлого диалога.
    setLastTurnScope(null);
    // Abort any in-flight stream from the previous dialogue
    abortRef.current?.abort();
    // context is a stable ref-backed wrapper (same underlying refs across renders);
    // deliberately keyed on dialogueId only, matching the pre-refactor ref-based effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueId]);

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: у setDialogue девять писателей (загрузка, отправка, переименование, удаление). Здесь только сброс на null
    if (!dialogueId) { setDialogue(null); return; }
    // Чтение, опоздавшее к смене диалога или размонтированию, отбрасывается:
    // иначе под новым id вставал прошлый диалог, а в тестах setState уходил
    // в снесённое окружение.
    let cancelled = false;
    const refresh = () => {
      void AIDialogueService.get(dialogueId).then(async d => {
        if (cancelled) return;
        setDialogue(prev => {
          if (!d) return null;
          if (!prev || prev.id !== d.id) return d;
          // Merge: if prev has unsaved local/optimistic messages (e.g. sending or streaming),
          // preserve messages from prev that aren't yet in d
          if (prev.messages.length > d.messages.length) {
            const isPrefix = d.messages.every((m, idx) => m.content === prev.messages[idx]?.content && m.role === prev.messages[idx]?.role);
            if (isPrefix) {
              return {
                ...d,
                messages: prev.messages,
              };
            }
          }
          return d;
        });
        // Hydrate the sticky note from the dialogue's linked document so a
        // reloaded note-dialogue stays grounded (note re-injected, facets/memory
        // suppressed) without the user re-attaching.
        if (d?.documentId && !context.getAttachedNote()) {
          try {
            const content = await LocalVersionService.getLatestContent(d.documentId);
            const doc = await LocalDocumentService.getDocument(d.documentId);
            if (content && !cancelled) context.setAttachedNote({ blocks: [{ documentId: d.documentId, title: doc?.title ?? '', lastSessionAt: doc?.lastSessionAt, content }], fromLink: true, ...(doc ? noteMetaFor(doc) : {}) });
          } catch { /* non-critical */ }
        }
      });
    };
    refresh();
    // CX-2: старым ответам этого диалога дозаписывается таблица ссылок — один раз на открытие.
    void AIDialogueService.backfillCiteRefs(dialogueId);
    window.addEventListener('dialogue-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('dialogue-updated', refresh); };
    // context is a stable ref-backed wrapper; getAttachedNote/setAttachedNote are personaId-independent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueId]);

  // Персону в диалог пишет только ВЫБОР в этом чате. Раньше эффект срабатывал и
  // на обновление диалога синхронизацией: смена персоны с другого устройства
  // тут же перезаписывалась своей, два открытых чата с разными персонами
  // перебивали друг друга бесконечно и выгружали диалог на каждом проходе
  // (стенд, сценарий 6; прод, 2026-10-07 — head переписывался раз в 2 минуты).
  const lastSelectedPersonaRef = useRef(personaId);
  useEffect(() => {
    if (!dialogueId || !personaId || !dialogue) return;
    const selectionChanged = lastSelectedPersonaRef.current !== personaId;
    lastSelectedPersonaRef.current = personaId;
    if (!selectionChanged) return;
    if (dialogue.personaId === personaId) return;

    let active = true;

    void (async () => {
      let newPersonaName = 'Custom';
      let newPersonaEmoji = '\u{1F916}';

      const isPreset = PRESET_PERSONAS.some(p => p.id === personaId);
      if (!isPreset) {
        const customPersona = await AIPersonaService.getCustom(personaId);
        if (!active) return;
        if (customPersona) {
          newPersonaName = customPersona.name;
          newPersonaEmoji = customPersona.emoji;
        }
      } else {
        const preset = PRESET_PERSONAS.find(p => p.id === personaId);
        newPersonaName = preset?.name ?? personaId;
        newPersonaEmoji = preset?.emoji ?? '\u{1F916}';
      }

      if (!active) return;
      // S-57: запись — в сервисе, одной транзакцией и с постановкой в выгрузку.
      const fresh = await AIDialogueService.setPersona(dialogueId, { personaId, personaName: newPersonaName, personaEmoji: newPersonaEmoji });
      if (active && fresh) setDialogue({ ...fresh });
    })();

    return () => { active = false; };
  }, [dialogueId, personaId, dialogue]);

  const clearError = useCallback(() => { setError(null); setConsentRequired(null); }, []);

  // `attached.blocks` carry the full note text routed through documentContent (50K),
  // so the model reads the whole note while the chat message stays small (just a
  // "[Прикреплена заметка: …]" marker plus any text the user typed). The note body
  const sendMessage = useCallback(async (
    text: string,
    attached?: { blocks: AttachedNoteBlock[]; documentId?: string },
    mood?: string,
    forcedSearchQuery?: string,
    options?: SendMessageOptions,
  ): Promise<string | null> => {
    if (!text.trim() && !forcedSearchQuery) return null;
    // R-1: Synchronous re-entrancy guard — prevents two calls in the same tick
    // from both proceeding past the isSending check (state isn't committed yet).
    if (sendingRef.current) return null;
    sendingRef.current = true;

    if (!navigator.onLine) {
      sendingRef.current = false;
      setError(t('ai_error_offline'));
      return null;
    }

    const storedLength = dialogue?.responseLength;
    const isLegacyReasoning = storedLength === 'reasoning' as unknown as 'short' | 'standard' | 'detailed';
    const effectiveReasoning = dialogue?.reasoning ?? reasoning ?? isLegacyReasoning;

    const cooldownUntil = Number(localStorage.getItem('jw_ai_cooldown_until') || '0');
    if (cooldownUntil > Date.now()) {
      const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      sendingRef.current = false;
      setError(`Слишком частые запросы. Подождите ${remainingSec} сек. перед следующей отправкой.`);
      return null;
    }

    const inflightUntil = Number(localStorage.getItem('jw_ai_inflight') || '0');
    if (inflightUntil > Date.now()) {
      sendingRef.current = false;
      setError('Слишком частые запросы. Подождите немного перед следующей отправкой.');
      return null;
    }

    const { remaining, reasoningRemaining } = useAiLimitStore.getState();
    const isExhausted = effectiveReasoning ? reasoningRemaining <= 0 : remaining <= 0;
    if (isExhausted) {
      // R-1: reset the guard on this early return — the try/finally that clears
      // it hasn't started yet, so without this sendMessage would deadlock after
      // the first limit hit.
      sendingRef.current = false;
      setDailyLimitExhausted(effectiveReasoning);
      setError(effectiveReasoning ? 'Лимит рассуждений исчерпан' : 'Дневной лимит достигнут');
      return null;
    }

    try {
      localStorage.setItem('jw_ai_inflight', String(Date.now() + 15_000));
    } catch { /* ignore */ }

    setIsSending(true);
    setStreamingMessage(null); setStreamingReasoning(null);
    setError(null);
    setConsentRequired(null);

    // Stop button: fresh controller per send; stop() aborts this one.
    // R-1: Abort any previous in-flight controller before overwriting the ref,
    // so a re-entrant call doesn't orphan the first stream.
    if (abortRef.current) { abortRef.current.abort(); }
    const controller = new AbortController();
    abortRef.current = controller;

    // Build API messages from the ORIGINAL dialogue before the optimistic update.
    const allMessages: AIMessage[] = dialogue
      ? (text.trim() ? [...dialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }] : [...dialogue.messages])
      : (text.trim() ? [{ role: 'user' as const, content: text, type: 'chat' as const }] : []);

    // Resolve persona name/emoji early for the optimistic display.
    const preset = PRESET_PERSONAS.find(p => p.id === personaId);
    let personaName = preset?.name ?? 'Custom';
    let personaEmoji = preset?.emoji ?? '\u{1F916}';

    // TICKET-019: Optimistic display — immediately show the user message even
    // when no dialogue exists yet. Create a temporary dialogue object so the
    // message renders before the API responds.
    let optimisticDialogue = dialogue;
    if (optimisticDialogue) {
      const optimistic = { ...optimisticDialogue, messages: [...optimisticDialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }] };
      setDialogue(optimistic);
      optimisticDialogue = optimistic;
    } else {
      const tempDialogue: AIDialogue = {
        id: 'temp-id',
        title: 'Новый диалог',
        personaId,
        personaName,
        personaEmoji,
        documentId: undefined,
        messages: text.trim() ? [{ role: 'user', content: text, type: 'chat' }] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setDialogue(tempDialogue);
    }

    // SB-3: пара «вопрос + ответ» пишется один раз — в конце успешного прохода.
    // Поэтому исключение в середине стрима уносило из истории всё, что человек
    // уже видел. Эти три значения — страховка для catch: какой диалог, какой
    // показанный кусок и записан ли уже ход.
    let turnDialogueId: string | undefined = dialogueId ?? undefined;
    let shownPartial = '';
    let turnSaved = false;
    let createdThisTurn = false;

    try {
      // S-40: тот же гейт, что в streamChat/callAi, но до записи диалога — иначе
      // заблокированный ход в новый диалог оставлял пустую запись.
      const gateUid = getCurrentUser()?.uid;
      if (gateUid && isProfileLoaded(gateUid) && !getAiConsent(gateUid)) throw new Error('AI_CONSENT_REQUIRED');

            // Sticky note: remember a freshly attached note, and reuse it on follow-up
      // turns that don't re-attach so the note stays the subject of the dialogue.
      if (attached) {
        const note: AttachedNoteRef = { blocks: attached.blocks };
        if (options?.noteMeta) {
          note.title = options.noteMeta.title;
          note.date = options.noteMeta.date;
        }
        context.setAttachedNote(note);
      }
      // A note carried over from the dialogue's link is NOT something the user
      // attached in this turn. Labelling it as attached made the assistant say
      // "in the note you attached…" about a note the user never sent.
      const stickyAttached = !attached && !!context.getAttachedNote();
      const effectiveAttached = attached ?? context.getAttachedNote() ?? undefined;
      // Заметка-тема есть — ход строгий, пока вопрос не про связи (turnScope).
      // Раньше контекст строился по тексту, склеенному с заметкой, и в ответ
      // попадали цитаты из других записей под видом этой.
      const question = options?.question ?? text;
      const scope = effectiveAttached ? turnScope(question, { forceWide: options?.forceWide }) : undefined;
      const subjectNote = context.getAttachedNote();

      // For attached notes the last user message goes to the API as a short
      // marker; the full note text travels via documentContent (see below).
      // Build the API history from the FRESHEST stored state (not the closure),
      // so regenerate (which trims the trailing turn before re-sending) doesn't
      // replay the old answer as context. Append the current user turn.
      // AX-11: Migrate old 'reasoning' value in stored dialogues
      const effectiveResponseLength: 'short' | 'standard' | 'detailed' =
        isLegacyReasoning ? 'standard' : (storedLength || responseLength || 'standard');

      let effectiveDialogueId = dialogueId;
      let currentDialogue = effectiveDialogueId ? await AIDialogueService.get(effectiveDialogueId) : null;
      if (!currentDialogue) {
        let actualName = personaName;
        let actualEmoji = personaEmoji;
        if (!preset) {
          try {
            const custom = await AIPersonaService.getCustom(personaId);
            if (custom) {
              actualName = custom.name;
              actualEmoji = custom.emoji;
            }
          } catch { /* non-critical */ }
        }
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title,
          personaId,
          personaName: actualName,
          personaEmoji: actualEmoji,
          messages: [],
          responseLength: effectiveResponseLength,
          reasoning: effectiveReasoning,
        });
        effectiveDialogueId = currentDialogue.id;
        turnDialogueId = currentDialogue.id;
        createdThisTurn = true;
        // Show the freshly created dialogue WITH the message the user just sent.
        // The stored record is deliberately empty — appendMessage writes the
        // user turn together with the answer — but handing that empty record to
        // the UI wiped the optimistic message, so from here until the model
        // replied the screen showed "Начните диалог" and the user's own text was
        // nowhere. That is the whole wait, half a minute of it.
        setDialogue(text.trim()
          ? { ...currentDialogue, messages: [{ role: 'user', content: text, type: 'chat' }] }
          : currentDialogue);
      }

      // S-25/S-29: заменяемый ход ищем по id его реплики, а не по позиции из
      // состояния вкладки: если соседняя вкладка дописала ход, позиция ведёт в
      // чужой разговор.
      const replaceFromIdx = options?.replaceUserId !== undefined
        ? currentDialogue.messages.findIndex(m => m.id === options.replaceUserId)
        : -1;
      const baseMessages = replaceFromIdx >= 0
        ? currentDialogue.messages.slice(0, replaceFromIdx)
        : currentDialogue.messages;
      const sourceForApi: AIMessage[] = text.trim() ? [...baseMessages, { role: 'user' as const, content: text, type: 'chat' as const }] : [...baseMessages];
      // S-63: старые ходы без шапки — тело скрытой заметки-темы не идёт ни в историю, ни в память.
      const localDb = await getLocalDb();
      const legacyParse = { legacyNoteHidden: await legacyNoteHidden(currentDialogue, localDb) };
      // AP-2: цитата скрытой заметки в старом ответе — тот же запрет, что и на
      // тело приложенной заметки. Снимок документов один на ход.
      const allDocs = await localDb.getAll('documents');
      const hiddenCiteIds = hiddenNoteIdsFromDocs(allDocs);
      // Н-1: тот же разбор (без названий скрытых заметок) — и для извлечения памяти ниже.
      const parseOpts = { ...legacyParse, hiddenCitationIds: hiddenCiteIds };
      const apiMessages = prepareApiMessages(sourceForApi, parseOpts);

      const isFirstTurn = baseMessages.filter(m => m.type !== 'system').length === 0;

      // К21-1: материалы прошлого ответа — по id из его реплики (К21-3). Ход
      // «откуда ты это взял?» поднимает те же записи, а не ищет по тексту вопроса.
      // CX-5: ответ с другого устройства — id там местные; переводим по его citeRefs.
      // Служебное уведомление (role assistant, type system) — не ответ (ревью 0.11.13).
      const prevAssistant = [...baseMessages].reverse().find(m => m.role === 'assistant' && m.type !== 'system');
      const prevTurnDocIds = localDocIds(prevAssistant?.contextDocIds, prevAssistant?.citeRefs, allDocs);

      const {
        userPortrait,
        customPersona,
        searchContext: rawSearchContext,
        memoryContext,
        injectedDocumentIds,
        injectedTitles,
        allowedFirstSeenDates,
        degradedReason,
        crisis,
        effectiveScope,
        hypoStats,
      } = await context.buildContext({
        text: question,
        scope,
        attached: effectiveAttached ? {
          blocks: effectiveAttached.blocks,
          ...('fromLink' in effectiveAttached && effectiveAttached.fromLink ? { fromLink: true } : {}),
        } : null,
        mood,
        messageHistory: apiMessages,
        isFirstTurn,
        dialogueId: effectiveDialogueId,
        forcedSearchQuery,
        attachedIsSticky: stickyAttached,
        prevTurnDocIds,
      });

      // Телефоны помощи показывает интерфейс, а не только модель в тексте ответа.
      if (crisis) setCrisisActive(true);

      // DY4-15.8 (владелец 24.10): номер заметки, который модель видела в прошлых
      // ответах этого диалога (то, что ушло в apiMessages), — тоже ссылка, если
      // заметка есть на устройстве и не скрыта. Раньше страж его вырезал, и в
      // ответе оставалось «перекликается с, где…».
      const citeIds = [
        ...(injectedDocumentIds ?? []),
        ...apiMessages.filter(m => m.role === 'assistant').flatMap(m => extractCitationIds(m.content)).filter(id => !hiddenCiteIds.has(id)),
      ];

      // LD-6 (ревью): контекст может расширить ход (согласие после широкого хода
      // с найденными записями). Правило заметки для сервера строится по
      // фактическому режиму, а не по turnScope реплики.
      const turnMode = effectiveScope ?? scope;
      // Н-1 + DY4 Н-3: правило называет только видимые заметки хода (список блоков
      // от сборщика — DY5, без разбора текста). Скрыты все — заглушка без названия
      // и без даты (владелец 24.10).
      const isHiddenId = (id: string) => !isPastedAttachmentId(id) && hiddenCiteIds.has(id);
      // К21-3: что модель видела в этом ходу — в реплику, чтобы «откуда ты это
      // взял?» на следующем ходу не искало материалы заново. Скрытые и удалённые
      // не пишем: список виден в интерфейсе.
      const savedContextDocIds = (injectedDocumentIds ?? []).filter(id => !isHiddenId(id));
      const blocks = subjectNote?.blocks ?? [];
      const visibleBlocks = blocks.filter(b => !isHiddenId(b.documentId));
      const scopeNote = !subjectNote ? subjectNote
        : visibleBlocks.length === 0 ? { title: HIDDEN_NOTE_TITLE, date: '' }
        : visibleBlocks.length < blocks.length ? { title: visibleBlocks.map(b => cleanAttachedTitle(b.title)).join('», «'), date: '' }
        : subjectNote;
      const noteScope = turnMode ? noteScopeFor(turnMode, scopeNote) : undefined;

      setAIStage('answer');
      // Inject today's date so the model can reason about "вчера", "на этой неделе" etc.
      const todayRu = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let searchContext = rawSearchContext
        ? `[Сегодня: ${todayRu}]\n\n${rawSearchContext}`
        : `[Сегодня: ${todayRu}]`;

      // Defensive clamps — never exceed the API schema limits (documentContent
      // 50K, userPortrait 100K), or the request 400s before reaching the model.
      // A9 (FN-2б): строгий ход режется молча с начала — человеку об этом строка
      // в чате после ответа (сколько знаков дошло из скольких).
      const contextCut = turnMode === 'note' && searchContext.length > 49_000
        ? { n: 49_000, m: searchContext.length }
        : null;
      if (searchContext && searchContext.length > 49_000) {
        const excess = searchContext.length - 49_000;
        // Контекст без вложения начинается с пустой строки — заголовок ищется с первого непробельного символа.
        const headerEnd = searchContext.indexOf('\n\n', searchContext.search(/\S/));
        if (headerEnd !== -1 && headerEnd < 200) {
          const header = searchContext.slice(0, headerEnd + 2);
          const rest = searchContext.slice(headerEnd + 2);
          searchContext = header + '…' + rest.slice(excess + 1);
        } else {
          searchContext = '…' + searchContext.slice(excess + 1);
        }
      }
      // К24-3: в ходе с выдачей прошлый ответ-отказ не уходит модели образцом.
      const turnMessages = withoutStaleEmptyClaims(apiMessages, searchContext);
      // HY-2: на ходе с гипотезой дата у ссылки = дата записи.
      const citedDates = hypothesisCitedDates(searchContext);
      const guardDates = (s: string) => {
        const d = sanitizeFirstSeenDates(s, allowedFirstSeenDates || []);
        return citedDates ? fixCitedDates(d, citedDates) : d;
      };
      // К28-1: в строгом ходе чужой день под ссылкой на приложенную запись — ссылка прошлой
      // записи либо снимается (кодом, без вызова модели). Только для ответа, не для хода мысли.
      const strictNote = turnMode === 'note' && visibleBlocks.length === 1 && visibleBlocks[0]!.content
        ? { noteId: visibleBlocks[0]!.documentId, noteText: visibleBlocks[0]!.content }
        : null;
      // PR-10 (18.2) + К29-1: род человека — по его репликам и приложенной заметке, для
      // всех характеров. Найденные записи, портрет, вставленный текст и текст ИИ не в счёт.
      const aiWritten = aiWrittenNoteIds(visibleBlocks, question, baseMessages);
      const authorGender = detectAuthorGender([
        ...humanQuestions('', apiMessages),
        ...visibleBlocks.filter(b => !isPastedAttachmentId(b.documentId) && !aiWritten.has(b.documentId)).map(b => b.content),
      ].join('\n'))
        // Редактор пишет пост от лица автора из материалов хода — там, как раньше, и берёт род, если больше негде.
        ?? (!customPersona && personaId === 'editor' ? detectAuthorGender(searchContext) : null) ?? undefined;
      const citeIdSet = new Set(citeIds);
      const priorAssistantTexts = apiMessages.filter(m => m.role === 'assistant').map(m => m.content);
      const polishAnswer = (answerText: string) => expandGenderForms(
        strictNote ? repairStrictNoteRefs(answerText, strictNote, priorAssistantTexts, citeIdSet) : answerText,
        authorGender,
      );
      // П-4: по графемам — slice мог разрезать эмодзи пополам.
      const safePortrait = userPortrait && userPortrait.length > 4_000 ? truncateText(userPortrait, 4_000, { maxCodeUnits: 4_000 }) : userPortrait;

      // DLG-Q8: с чем сверять цитаты и названия — с теми же материалами, что
      // ушли модели, плюс реплики человека из этого диалога.
      const humanTurns = apiMessages.filter(m => m.role === 'user').map(m => m.content);
      const quoteInput = { documentContent: searchContext, memoryContext, humanTurns };
      const materialsText = quoteMaterialsText({ ...quoteInput, strict: false });
      // RA1-8: в строгом ходе кавычки — только из приложенной заметки и реплик
      // человека. Фон и память — пересказ ИИ; ссылки и названия ниже сверяются
      // с полным набором, как раньше. DY7-7: то же собрание считает сервер.
      const quoteMaterials = turnMode === 'note' ? quoteMaterialsText({ ...quoteInput, strict: true }) : undefined;
      // Ход «вопрос о записях»: метку в блок записей кладёт клиент с флагом answer_chronicle_v2.
      const archiveTurn = Boolean(searchContext?.includes(ARCHIVE_TURN_MARK));

      const customSystemPrompt = customPersona;
      const effectivePersonaId = customPersona ? 'custom' : personaId;

      // Response length and reasoning variables moved to top of sendMessage

      let fullText: string;
      let streamCut = false;

      if (Date.now() < _streamUnavailableUntil) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: turnMessages, documentContent: searchContext, userPortrait: safePortrait, memoryContext, noteScope, authorGender, responseLength: effectiveResponseLength, reasoning: effectiveReasoning, crisis, hypoStats, signal: controller.signal });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: turnMessages,
            documentContent: searchContext,
            documentMood: mood,
            userPortrait: safePortrait,
            memoryContext,
            noteScope,
            authorGender,
            responseLength: effectiveResponseLength,
            reasoning: effectiveReasoning,
            crisis,
            hypoStats,
            signal: controller.signal,
            onChunk: (partial, reasoning) => {
              const cleanPartial = polishAnswer(guardDates(
                sanitizeCitations(toolCallToSearchMarker(partial), citeIds, injectedTitles, materialsText, { personaId: effectivePersonaId, quoteMaterialsText: quoteMaterials, dropFabricatedSentences: archiveTurn })
              ));
              const cleanReasoning = reasoning
                ? guardDates(
                    sanitizeCitations(reasoning, citeIds, injectedTitles, materialsText, { reasoning: true })
                  )
                : null;
              setStreamingMessage(cleanPartial);
              setStreamingReasoning(cleanReasoning);
              shownPartial = cleanPartial;
            },
          });
        } catch (e: unknown) {
          // Don't fall back to the callable if the user aborted on purpose.
          if (controller.signal.aborted) throw new Error('ABORTED');
          const errMsg = e instanceof Error ? e.message : '';
          // S-31: нет согласия — не поломка. Гейт бросает до запроса, callable
          // бросил бы тот же код, а в журнале это выглядело как техническая ошибка.
          if (!isConsentCode(errMsg) && errMsg !== DISALLOWED_PHRASE) {
            // A handled fallback, not a failure: the callable path runs next and
            // usually answers. Logged as a warning so a provider hiccup does not
            // sit in the log looking like something broke.
            reportError(e, { action: 'Streaming chat failed, falling back to callable chat' }, 'warning');
          }
          const isUpstream = errMsg === 'UPSTREAM' || errMsg === 'UPSTREAM_ERROR' || errMsg === 'SERVICE_UNAVAILABLE' || errMsg.startsWith('UPSTREAM');
          if (!isConsentCode(errMsg) && errMsg !== DISALLOWED_PHRASE && !isUpstream && errMsg !== 'DAILY_LIMIT' && errMsg !== 'REASONING_LIMIT' && errMsg !== 'AUTH_REQUIRED' && errMsg !== 'GLOBAL_LIMIT' && errMsg !== 'RATE_LIMIT' && !errMsg.startsWith('RATE_LIMIT:')) {
            // #77: streaming already consumed a daily limit slot. The callable
            // fallback consumes another. Accepted by design: the residual case
            // after server-side refund-on-disconnect is a mid-stream network
            // drop, where generation work genuinely happened on both attempts.
            // Option A (charge-after-first-upstream-byte) would move billing
            // into the middle of the request and split the cooldown claim —
            // rejected for now; revisit if quota complaints appear.
            // to avoid losing the user's message, but this means fallback costs 2 quota.
            // AUDIT-M2: если стрим успел отдать существенный partial — не
            // перегенерируем (двойная оплата + потеря уже показанного текста).
            const lastPartial = shownPartial;
            if (lastPartial.trim().length > 200) {
              fullText = lastPartial;
              // Случай #27: кусок оставляем, но не молча — иначе оборванный
              // посреди слова ответ выглядит целым.
              streamCut = true;
            } else {
              // DY10-6: кризисный флаг — и в запасном пути, как в стриме и прямом callable.
              fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: turnMessages, documentContent: searchContext, userPortrait: safePortrait, memoryContext, noteScope, authorGender, responseLength: effectiveResponseLength, reasoning: effectiveReasoning, crisis, hypoStats, signal: controller.signal });
            }
            // RSN-4: Parse reasoning and answer unconditionally from callable fallback
            const cleanReasoning = extractReasoning(fullText);
            const cleanAnswer = extractAnswer(fullText);

            if (cleanReasoning) {
              setStreamingReasoning(
                guardDates(
                  sanitizeCitations(cleanReasoning, citeIds, injectedTitles, materialsText, { reasoning: true })
                )
              );
            }
            if (cleanAnswer) {
              setStreamingMessage(
                polishAnswer(guardDates(
                  sanitizeCitations(cleanAnswer, citeIds, injectedTitles, materialsText, { personaId: effectivePersonaId, quoteMaterialsText: quoteMaterials, dropFabricatedSentences: archiveTurn })
                ))
              );
            }
          } else {
            throw e;
          }
        }
      }

      // Разбор 18.11: разметка вызова инструмента вместо ответа — в кнопку поиска.
      fullText = toolCallToSearchMarker(fullText);

      // User stopped before any text arrived — just halt, no error, nothing saved.
      if (controller.signal.aborted && (!fullText || !fullText.trim())) {
        setStreamingMessage(null); setStreamingReasoning(null);
        return dialogue?.id ?? null;
      }

      // An empty stream (e.g. the model errored mid-stream on a quota/spend cap)
      // resolves without throwing — surface it as an error instead of saving a
      // blank assistant bubble.
      if (!fullText || !fullText.trim()) {
        throw new Error('EMPTY_RESPONSE');
      }

      incrementDailyUsage(effectiveReasoning);
      try {
        localStorage.setItem('jw_ai_cooldown_until', String(Date.now() + 10_000));
      } catch { /* ignore */ }

      const wasNew = !dialogueId;

      // RSN-4: Clean reasoning tags before saving; persist reasoning separately
      // so the collapsible "ход мысли" survives in dialogue history.
      const searchReq = extractSearchRequest(fullText);
      // ED-1b: ответ и ход мыслей чистятся порознь, как в стриме. Чистка всего
      // текста до разбора возвращала в сохранённый ход мыслей «по смыслу», которых
      // во время стрима не было.
      const clean = (s: string, reasoningPart: boolean) => {
        const guarded = guardDates(
          sanitizeCitations(s, citeIds, injectedTitles, materialsText, reasoningPart ? { reasoning: true } : { personaId: effectivePersonaId, quoteMaterialsText: quoteMaterials, dropFabricatedSentences: archiveTurn })
        );
        return reasoningPart ? guarded : polishAnswer(guarded);
      };
      let savedText = clean(extractAnswer(fullText), false);
      const rawReasoning = extractReasoning(fullText);
      let savedReasoning = rawReasoning ? clean(rawReasoning, true) : rawReasoning;

      // Log the mismatch if reasoning markers arrived when reasoning mode was off (once per session)
      if (!effectiveReasoning && savedReasoning) {
        if (!reasoningMismatchReportedRef.current) {
          reasoningMismatchReportedRef.current = true;
          reportError(
            new Error('REASONING_LEAK: unexpected reasoning markers in response when reasoning=false'),
            { action: 'useAIChat_reasoning_mismatch', personaId: effectivePersonaId },
            'warning'
          );
        }
      }

      // In reasoning mode the answer arrives after a marker. When none of them
      // ever appears, the model spent its whole output budget deliberating and
      // was cut off — publishing that as the reply showed the user a page of
      // "Мы получили два запроса… Я должен…" ending mid-word. Keep the
      // deliberation where it belongs and say plainly that no answer came.
      const hasAnswerSection = /<answer>|<\/think>|<\/reasoning>|(?:^|\n)ОТВЕТ:\s*/im.test(fullText);
      if (effectiveReasoning && !hasAnswerSection && fullText.trim()) {
        savedReasoning = clean(fullText, true).trim();
        savedText = 'Ответ не дошёл: я потратил весь лимит на рассуждение и оборвался на полуслове. Ход мысли сохранён ниже. Попробуй переспросить короче или выключить режим рассуждений.';
      }
      // Разбор 18.11: ответ был одной разметкой поиска — пустой пузырь с кнопкой
      // непонятен; одна строка объясняет, что кнопка ниже — поиск.
      if (!savedText.trim() && searchReq) savedText = 'Могу поискать в записях — нажми на запрос ниже.';
      if (controller.signal.aborted || streamCut) {
        savedText = `${savedText.trim()}${INTERRUPTED_STREAM_MARKER}`;
      }
      // К21-4: признак «пересказал записи, но не сослался ни на одну» считается
      // здесь — тем же общим правилом, что и счётчик сервера, по тем же
      // материалам, что ушли модели. Позже пересчитать его нечем: материалы хода
      // не хранятся, а пометка под ответом обязана пережить перезагрузку.
      const savedNoRefClaim = notesClaimWithoutRef(savedText, searchContext);
      if (options?.replaceUserId !== undefined) {
        await AIDialogueService.replaceLastTurn(currentDialogue.id, options.replaceUserId, text, savedText, savedReasoning, searchReq, degradedReason, savedContextDocIds, savedNoRefClaim);
      } else {
        await AIDialogueService.appendMessage(currentDialogue.id, text, savedText, savedReasoning, searchReq, degradedReason, savedContextDocIds, savedNoRefClaim);
      }
      if (contextCut) {
        await AIDialogueService.appendSystemMessage(currentDialogue.id, t('ai_context_cut_notice', contextCut), { once: true });
      }
      turnSaved = true;
      setLastTurnScope(turnMode ?? null);
      // Link the dialogue to the attached note so it stays grounded after reload.
      if (attached?.documentId && attached.documentId.startsWith('local_')) {
        await AIDialogueService.setDocumentId(currentDialogue.id, attached.documentId);
      }
      // CHATFIX-3: Extract memory every 3rd turn, not every turn
      context.incrementMessageCount();
      // EA-18: извлечение памяти — служебный запрос, выключается в настройках.
      if (context.getMessageCount() % 3 === 0 && getChatExtrasEnabled(getCurrentUser()?.uid)) {
        // Strip attachment bodies — memory extraction goes to an AI endpoint with
        // the same per-message cap, and raw note text shouldn't be stored anyway.
        // AP-2: ответ с цитатой скрытой заметки в окно извлечения не идёт.
        const memMessages = allMessages.map(m => {
          const content = toApiContent(m.content, API_MSG_CAP, parseOpts);
          return m.role === 'assistant' && citesAnyId(m.content, hiddenCiteIds)
            ? { ...m, content: HIDDEN_ANSWER_PLACEHOLDER }
            : { ...m, content };
        });
        void AIChatMemoryService.extractFromDialogue(currentDialogue.id, memMessages, parseOpts);
      }
      // DI-4: человек согласился с выводом прошлого ответа — захват отдельным
      // путём (правила по тексту, флаг, модель), не дожидаясь извлечения памяти.
      if (prevAssistant) {
        const prevAssistantIdx = baseMessages.indexOf(prevAssistant);
        const prevUserMsg = [...baseMessages.slice(0, prevAssistantIdx)].reverse().find(m => m.role === 'user');
        void captureConfirmedInsight({
          uid: getCurrentUser()?.uid,
          dialogueId: currentDialogue.id,
          personaId,
          userText: text,
          prevAssistant: { id: prevAssistant.id ?? '', content: prevAssistant.content, type: prevAssistant.type },
          prevUser: prevUserMsg?.content ?? '',
          hiddenCiteIds,
          parseOpts,
          docs: allDocs,
          t,
        });
      }
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);
      setStreamingMessage(null); setStreamingReasoning(null);

      // OPT-3: Auto-name the dialogue via LLM after the first exchange.
      // callType: 'auto_name' — server skips per-user quota, global guard still applies.
      if (wasNew) {
        // Н-1: ход — тем же разбором, что история: без тела заметки и без
        // названия скрытой (сырой `text` нёс и то и другое).
        const firstTurn = truncateText(toApiContent(text, API_MSG_CAP, parseOpts), 200);
        void AIService.chat({
          personaId: 'coach',
          callType: 'auto_name',
          messages: [
            { role: 'user', content: `Придумай короткое название (3-5 слов) для диалога на русском языке на основе первого сообщения пользователя: "${firstTurn}" и ответа ИИ: "${truncateText(fullText, 200)}". Ответь ТОЛЬКО названием, без кавычек.` },
          ],
        }).then(res => {
          if (res.ok && res.text) {
            const cleanTitle = truncateText(res.text.trim().replace(/^["«]|["»]$/g, ''), 50);
            if (cleanTitle.length > 0) {
              void AIDialogueService.updateTitle(currentDialogue!.id, cleanTitle);
            }
          } else if (!res.ok) {
            reportAIDegradation({
              feature: 'chat_auto_name',
              cause: res.error,
              action: 'Автоматическое именование диалога',
              impact: 'Диалог сохранён со стандартным названием',
            });
          }
        }).catch(err => {
          reportAIDegradation({
            feature: 'chat_auto_name',
            cause: err,
            action: 'Автоматическое именование диалога',
            impact: 'Диалог сохранён со стандартным названием',
          });
        });
      }
      // Return the persisted dialogue id so the caller can select it (a new
      // dialogue must become active or it looks "lost" after navigation).
      return currentDialogue.id;
    } catch (e: unknown) {
      setStreamingMessage(null); setStreamingReasoning(null);
      const fresh = (dialogueId && typeof dialogueId === 'string') ? await AIDialogueService.get(dialogueId) : undefined;
      setDialogue(fresh ?? dialogue);
      const rawMsg = e instanceof Error ? e.message : 'SERVER_ERROR';

      // SB-3: показанное должно пережить обрыв. Если куски уже были на экране, а
      // ход не записан (исключение из стрима или из callable-повтора), сохраняем
      // его как есть — с честной пометкой, что ответ не дописан. Вопрос сам по
      // себе в поле ввода остаётся, но в дневнике хода не было вовсе.
      if (!turnSaved && turnDialogueId && text.trim() && shownPartial.trim()) {
        try {
          const interruptedMsg = `${shownPartial.trim()}${INTERRUPTED_STREAM_MARKER}`;
          if (options?.replaceUserId !== undefined) {
            await AIDialogueService.replaceLastTurn(
              turnDialogueId,
              options.replaceUserId,
              text,
              interruptedMsg,
            );
          } else {
            await AIDialogueService.appendMessage(
              turnDialogueId,
              text,
              interruptedMsg,
            );
          }
          turnSaved = true;
        } catch (persistErr) {
          reportError(persistErr, { action: 'useAIChat_persistInterruptedTurn', dialogueId: turnDialogueId });
        }
      }

      if (rawMsg === 'ABORTED') {
        try { localStorage.removeItem('jw_ai_cooldown_until'); } catch { /* ignore */ }
        // user stopped — no error
        return null;
      }

      if (rawMsg === 'DAILY_LIMIT') {
        setDailyLimitExhausted(false);
      } else if (rawMsg === 'REASONING_LIMIT') {
        setDailyLimitExhausted(true);
      } else if (rawMsg === 'UPSTREAM' || rawMsg === 'UPSTREAM_ERROR' || rawMsg === 'SERVICE_UNAVAILABLE') {
        try { localStorage.removeItem('jw_ai_cooldown_until'); } catch { /* ignore */ }
        void useAiLimitStore.getState().loadLimitFromServer();
      }

      // S-31: согласие показывается отдельной панелью со ссылкой в Настройки,
      // а не красной плашкой «техническая ошибка».
      // X-2: отказ по формулировке идёт тем же путём «состояния, а не сбоя»:
      // пустой диалог не остаётся, набранное возвращается в поле ввода, а
      // человек читает просьбу перефразировать.
      if (isConsentCode(rawMsg) || rawMsg === DISALLOWED_PHRASE) {
        // S-56: отказ сервера по согласию (снято на другом устройстве) приходит
        // уже после создания диалога — пустая запись не остаётся.
        if (createdThisTurn && !turnSaved && turnDialogueId) {
          try { await AIDialogueService.discardEmpty(turnDialogueId); } catch (discardErr) { reportError(discardErr, { action: 'useAIChat_discardEmptyDialogue' }, 'warning'); }
        }
        if (isConsentCode(rawMsg)) setConsentRequired(rawMsg);
        else setError(aiErrorToText(rawMsg, { t, isLoggedIn: !!getCurrentUser() }));
        return null;
      }

      setError(aiErrorToText(rawMsg, { t, isLoggedIn: !!getCurrentUser() }));
      return null;
    } finally {
      try { localStorage.removeItem('jw_ai_inflight'); } catch { /* ignore */ }
      sendingRef.current = false;
      setIsSending(false);
      setAIStage(null);
    }
    // context excluded intentionally: buildContext reads current personaId, and personaId
    // is already a dep here, so sendMessage is recreated with a fresh context on persona change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogue, dialogueId, personaId, responseLength, reasoning, language, t]);

  // Load a note's latest text without sending — lets the UI stage an attachment
  // (show a chip) so the user can add their own message before sending.
  const prepareAttachment = useCallback(async (documentId: string): Promise<{ title: string; content: string; lastSessionAt?: number | undefined } | null> => {
    try {
      // DA-4 (ревью): ссылка /ai?doc= может нести постоянный номер — строку ищем и по нему.
      const doc = (await LocalDocumentService.getDocument(documentId)) ?? (await findNoteRow(documentId));
      // HA-5 (дейлик 26.11): скрытая от ИИ или выброшенная заметка не прикладывается — ни
      // карточкой с названием в поле ввода, ни текстом. Выбор заметки её и так не показывает;
      // остался вход по адресу /ai?doc=…
      if (!doc || isExcludedFromAI(doc) || await noteHiddenFromAI(documentId)) return null;
      const content = await LocalVersionService.getLatestContent(doc.id);
      if (!content) return null;
      // Дата заметки для шапки и правила: без последней сессии — дата создания, не «сегодня».
      return { title: doc.title || 'Без названия', content, lastSessionAt: doc.lastSessionAt ?? doc.firstSessionAt };
    } catch (e) {
      reportError(e, { action: 'prepareAttachment', documentId });
      throw new Error('Не удалось загрузить документ (ошибка доступа к БД).');
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismissCrisis = useCallback(() => setCrisisActive(false), []);

  // AX-7: "Ответить иначе" — save the old answer as a variant, then regenerate.
  // Previous variants are preserved so the user can browse ‹ 2/3 › after several
  // regenerations. Nothing is lost.
  const regenerateLast = useCallback(async () => {
    if (isSending) return;
    const id = dialogueId ?? dialogue?.id;
    if (!id) return;
    const d = await AIDialogueService.get(id);
    if (!d) return;
    const msgs = d.messages;
    let aiIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'assistant' && m.type !== 'system') { aiIdx = i; break; }
    }
    if (aiIdx < 0) return;
    let userIdx = -1;
    for (let i = aiIdx - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const userText = msgs[userIdx]?.content ?? '';
    if (!userText) return;

    // S-36: прежний ответ уходит в варианты внутри replaceLastTurn — по id хода,
    // а не «последнему ответу»: дописанный соседней вкладкой ход получал чужие
    // варианты, а снимок отсюда затирал союз вариантов после слияния.
    // Truncate dialogue in memory (React state) so sendMessage appends userText as a replacement turn,
    // but DO NOT truncate in IndexedDB yet so failures leave the stored dialogue intact.
    setDialogue({ ...d, messages: d.messages.slice(0, userIdx) });
    // Показанный текст хода — заметка + «Вопрос: …». Режим хода и поиск строятся
    // по вопросу, иначе слово «раньше» в заметке делало ход широким (R3-006).
    const attachedTurn = splitAttachedMessage(userText, { legacyNoteHidden: await legacyNoteHidden(d, await getLocalDb()) });
    await sendMessage(userText, undefined, undefined, undefined, {
      replaceUserId: msgs[userIdx]?.id,
      ...(attachedTurn ? { question: attachedTurn.question || 'Разбери эту заметку' } : {}),
    });
  }, [isSending, dialogueId, dialogue, sendMessage]);

  const triggerForcedSearch = useCallback(async (query: string) => {
    await sendMessage('', undefined, undefined, query);
  }, [sendMessage]);

  return { dialogue, isLoading: isSending, streamingMessage, streamingReasoning, error, consentRequired, sendMessage, lastTurnScope, prepareAttachment, stop, regenerateLast, triggerForcedSearch, crisisActive, dismissCrisis, clearError };
}
