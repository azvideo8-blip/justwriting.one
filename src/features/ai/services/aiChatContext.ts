import { useRef } from 'react';
import { getLocalDb } from '../../../core/storage/localDb';
import type { LocalDocument, AIDocumentSummary } from '../../../core/storage/localDb';
import { loadDocumentSnapshot, loadSummarySnapshot } from '../utils/retrieval/docSnapshot';
import { AIProfileService } from './AIProfileService';
import { AIPersonaService, PRESET_PERSONAS } from './AIPersonaService';
import { AIProfileFacetService } from './AIProfileFacetService';
import { AIEmbeddingService } from './AIEmbeddingService';
import { searchNotesMulti, vectorScore01, type RetrievedNote } from '../utils/noteRetriever';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { AIService } from './AIService';
import { reportError } from '../../../shared/errors/reportError';
import { detectRisk } from '../utils/riskDetect';
import { analyzeDoors, aggregateDoors, doorLabel } from '../utils/contactDoors';
import { shouldRunFullSearch, asksForSimilarNotes, asksForOtherNotes, HIDDEN_NOTE_TITLE } from '../utils/aiChatTransport';
import { detectPersonMentions, buildPersonQuotesBlock, personQuoteIds, type PersonNote } from './chatContext/personQuotes';
import { isSmallTalkTurn, PSYCHE_PERSONAS } from '../utils/smallTalk';
import { cosineSimilarity } from '../utils/vectorSearch';
import { AIChatMemoryService } from './AIChatMemoryService';
import { AIMemoryAssembler, extractDocumentIdsFromText } from './AIMemoryAssembler';
import { MemoryFlagsService } from './memoryFlags';
import { setAIStage } from '../store/useAIStageStore';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { getSendPortraitInDialogue } from '../../../core/ai/portraitDialoguePreference';
import { extractFirstSeenDates } from '../utils/dateGuard';
import { reportAIDegradation, isDailyLimitError } from '../utils/aiDegradationReporter';
import type { ChatContextResult, BuildContextParams } from './chatContext/types';
import { getCorpusStats, formatDateYYYYMMDD, getDocDate } from './chatContext/corpusStats';
import { extractCitationIds, validateCitationIds, extractContextTitles } from './chatContext/citations';
import { createEmbedOnce } from './chatContext/embeddings';
import { buildProactiveBlock } from './chatContext/proactive';
import { buildTemporalBlocks } from './chatContext/temporalBlocks';
import { buildAggregateThemeBlock } from './chatContext/aggregateStats';
import { buildLiteRetrievalBlock } from './chatContext/liteRetrieval';
import { buildRelatedDaysBlock } from './chatContext/relatedDays';
import { ATTACHED_BLOCK_SEP, attachedBlockHeads, builderBlockHeads } from '../utils/attachedNoteFormat';
import { strictTurnPortrait } from '../../../shared/ai/portraitSections';
import { isExcludedFromAI, isPastedAttachmentId } from '../utils/isExcludedFromAI';
import { postBody } from '../utils/editorDiff';
import { nameForms, NEVER_MATCH } from '../utils/nameForms';

/** Заметка-тема диалога. title/date идут в правило строгого хода (noteScope). */
export interface AttachedNoteRef {
  content: string;
  documentId?: string;
  /** id приложенных заметок от сборщика хода (см. attachedBlockHeads). */
  blockIds?: string[];
  title?: string;
  date?: string;
}


/**
 * П-5: сколько заметок без вектора прочитать за ход ради поиска по имени.
 * Потолок, а не часть поиска: на устройстве с недостроенным индексом без вектора
 * может быть весь архив, и полный скан превратил бы один ход в сотни чтений
 * IndexedDB (см. X-5 и П-6). Заметки берутся самые свежие.
 */
const NAME_SCAN_NO_VECTOR_LIMIT = 200;
export async function hideExcludedNotes(content: string, db: Pick<Awaited<ReturnType<typeof getLocalDb>>, 'get'>, ids?: readonly string[]): Promise<string> {
  const heads = attachedBlockHeads(content, ids);
  // DY5-1: шапки не совпали со списком сборщика — ход не разобран, скрыт целиком.
  if (heads.length === 0) return ids ? `[Прикреплена заметка: "${HIDDEN_NOTE_TITLE}"]\n[заметка скрыта от ИИ]` : content;
  let out = content.slice(0, heads[0]!.index);
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1]!.index : content.length;
    const body = content.slice(h.index + h[0].length, bodyEnd);
    // S-63: вставленный текст — не заметка, строки в documents у него нет; скрывать нечего.
    let hidden = !isPastedAttachmentId(h[1]!);
    if (hidden) {
      try {
        hidden = isExcludedFromAI(await db.get('documents', h[1]!));
      } catch (e) {
        reportError(e, { action: 'hideExcludedNotes', documentId: h[1] });
      }
    }
    // Н-1 + решение владельца 24.10: от скрытой не уходят ни название, ни шапка
    // с id и датой. DY4 Н-2: разделитель к следующей заметке жил в конце тела —
    // без него следующий блок перестаёт быть блоком.
    out += hidden
      ? `[Прикреплена заметка: "${HIDDEN_NOTE_TITLE}"]\n[заметка скрыта от ИИ]${i + 1 < heads.length ? ATTACHED_BLOCK_SEP : '\n\n'}`
      : h[0] + body;
  }
  return out;
}

/**
 * ED-1: тема последнего ответа Редактора — тело до строки «— — —», 600 знаков.
 * Пустого ответа не бывает на этом ходе, но пустое тело (сервисные строки до
 * разделителя) возвращает undefined, и ход идёт по разбору заметки.
 * Приватность: если ответ ссылается на заметку, которую с тех пор скрыли от ИИ
 * или выбросили, ответ в запрос не берём — вместе с ним ушли бы её строки.
 */
export async function postTopicQuery(
  history: ReadonlyArray<{ role: string; content: string }>,
  docById: (id: string) => Promise<LocalDocument | undefined>,
): Promise<string | undefined> {
  const lastReply = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastReply) return undefined;
  for (const id of extractCitationIds(lastReply.content)) {
    const doc = await docById(id);
    if (doc && (isExcludedFromAI(doc) || doc.trashedAt)) return undefined;
  }
  const body = postBody(lastReply.content).replace(/\s+/g, ' ').trim().slice(0, 600);
  return body || undefined;
}

/**
 * LD-6: короткое согласие после широкого хода с результатами держит область
 * предыдущего хода. Третий ход «давай, собери, только без …» turnScope считает
 * строгим, а строгий возврат стоит раньше липкого поиска — найденные заметки
 * исчезали, и Редактор собирал пост только из приложенной заметки.
 * Список держим коротким: это дословные ответы на предложение, а не тема хода.
 */
const CONSENT_WORDS = ['да', 'давай', 'собери', 'делай', 'ок', 'хорошо', 'согласен', 'го'] as const;
const CONSENT_MAX_WORDS = 8;
// Чем закончился последний ответ, чтобы согласие относилось к нему: вопрос или
// явное предложение сделать.
const PROPOSAL_TAIL = /(?:хочешь|предлож|собер|сдела|давай)/iu;

function isConsentTurn(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > CONSENT_MAX_WORDS) return false;
  const first = (words[0] ?? '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase();
  return (CONSENT_WORDS as readonly string[]).includes(first);
}

function endsWithProposal(reply: string): boolean {
  const tail = reply.trim().slice(-200);
  return /\?\s*$/.test(tail) || PROPOSAL_TAIL.test(tail);
}

/**
 * LD-7: позиция материала в найденной заметке — по чанку, ближайшему к вектору
 * запроса. Без этого окно бралось с начала заметки, а дневниковая запись —
 * 5–6 тысяч знаков, и главное в ней стоит во второй половине.
 * null — чанков нет, их текст не сошёлся с телом (заметку правили после
 * индексации), запроса без вектора нет, или заметка короче окна: тогда whole
 * note и так попадает в контекст, а сдвиг только отрезал бы её голову.
 */
function bestChunkPosition(
  content: string,
  emb: { vectors?: number[][]; chunkTexts?: string[] } | undefined,
  queryEmb: number[] | undefined,
  windowChars: number,
): number | null {
  const texts = emb?.chunkTexts;
  const vectors = emb?.vectors;
  if (!queryEmb?.length || !texts?.length || !vectors?.length) return null;
  if (content.length <= windowChars) return null;
  let best = -1;
  let bestSim = -Infinity;
  for (let i = 0; i < Math.min(texts.length, vectors.length); i++) {
    const v = vectors[i];
    const t = texts[i];
    if (!v?.length || !t) continue;
    const sim = cosineSimilarity(queryEmb, v);
    if (sim > bestSim) { bestSim = sim; best = i; }
  }
  if (best < 0) return null;
  const pos = content.indexOf(texts[best] ?? '');
  return pos >= 0 ? pos : null;
}

export function useAIChatContext(personaId: string): {
  buildContext(params: BuildContextParams): Promise<ChatContextResult>;
  resetSession(): void;
  setAttachedNote(note: AttachedNoteRef | null): void;
  getAttachedNote(): AttachedNoteRef | null;
  incrementMessageCount(): void;
  getMessageCount(): number;
} {
  const portraitCacheRef = useRef<string | null | undefined>(undefined);
  const facetsCacheRef = useRef<{ facets: Awaited<ReturnType<typeof AIProfileFacetService.getAll>> | null }>({ facets: null });
  const docsCacheRef = useRef<Map<string, { id: string; title?: string; lastSessionAt?: number; firstSessionAt?: number }> | null>(null);
  const doorsCacheRef = useRef<{ hint: string } | null>(null);
  const messageCountRef = useRef(0);
  const attachedNoteRef = useRef<AttachedNoteRef | null>(null);
  const stickyTurnsRef = useRef(0);
  const lastSearchQueryRef = useRef('');
  const lastSearchNamesRef = useRef<string[]>([]);
  const recentContextInjectedRef = useRef(false);
  // DLG-Q9: блок слов человека кэшируется на сессию по (люди, набор id заметок).
  const personQuotesCacheRef = useRef<{ key: string; block: string | undefined; ids: string[] } | null>(null);

  const resetSession = () => {
    stickyTurnsRef.current = 0;
    lastSearchQueryRef.current = '';
    lastSearchNamesRef.current = [];
    facetsCacheRef.current = { facets: null };
    docsCacheRef.current = null;
    doorsCacheRef.current = null;
    messageCountRef.current = 0;
    recentContextInjectedRef.current = false;
    personQuotesCacheRef.current = null;
    // Заметка-тема принадлежит диалогу: без сброса она ехала в «Новый диалог»
    // и делала его ходы строгими по чужой заметке (R3-005). Связанную заметку
    // диалог поднимает сам (useAIChat, d.documentId).
    attachedNoteRef.current = null;
  };

  const setAttachedNote = (note: AttachedNoteRef | null) => {
    attachedNoteRef.current = note;
  };

  const getAttachedNote = () => {
    return attachedNoteRef.current;
  };

  const incrementMessageCount = () => {
    messageCountRef.current += 1;
  };

  const getMessageCount = () => {
    return messageCountRef.current;
  };

  const buildContext = async (params: BuildContextParams): Promise<ChatContextResult> => {
    const { text, attached, mood, isFirstTurn, forcedSearchQuery, attachedIsSticky } = params;
    const injectedDocumentIds: string[] = [];
    const db = await getLocalDb();
    // X-5: снимки заметок и разборов на один ход. Точечные чтения на каждого
    // кандидата давали ~100 обращений к IndexedDB за ход. Снимок создаётся
    // лениво и живёт до конца хода, поэтому права («не показывать ИИ») и
    // корзина проверяются по записям ЭТОГО хода, а не по вчерашним.
    let docsSnap: Promise<Map<string, LocalDocument>> | undefined;
    let summariesSnap: Promise<Map<string, AIDocumentSummary>> | undefined;
    const docAt = async (id: string) => (await (docsSnap ??= loadDocumentSnapshot())).get(id);
    const summaryAt = async (id: string) => (await (summariesSnap ??= loadSummarySnapshot())).get(id);
    let degradedDueToDailyLimit = false;

    let turnEmb: number[] | undefined;
    const uid = getCurrentUser()?.uid;
    // X-1: светский ход («привет», «спасибо», «как дела») не тянет за собой
    // архив — ни векторизации реплики, ни лайт-поиска, ни проактивного блока.
    const smallTalk = isSmallTalkTurn(text);
    // Открывающее «привет» не отнимает блок «недавнего» у первого содержательного
    // хода: он положен ходу, перед которым были только светские реплики.
    // messageHistory заканчивается текущим ходом — его не считаем.
    const priorUserTurns = params.messageHistory.filter(m => m.role === 'user').slice(0, -1);
    const onlySmallTalkBefore = priorUserTurns.length > 0
      && priorUserTurns.every(m => typeof m.content === 'string' && isSmallTalkTurn(m.content));
    // AUDIT-M5: один текст за ход векторизуется ОДИН раз — повторные вызовы
    // (поисковый запрос === текст реплики) переиспользуют результат.
    const embedOnce = createEmbedOnce({
      text,
      onDailyLimitError: () => { degradedDueToDailyLimit = true; },
    });
    // Строгий ход по заметке ничего не ищет — и вектор реплики ему не нужен.
    // LD-6: короткое согласие после широкого хода с результатами и предложением
    // в конце ответа — продолжение того хода, а не новый строгий разбор заметки.
    const lastAssistantReply = [...params.messageHistory].reverse().find(m => m.role === 'assistant');
    const consentContinuation = params.scope === 'note' && !!attached
      && stickyTurnsRef.current > 0
      && lastSearchQueryRef.current.length > 0
      && !!lastAssistantReply
      && isConsentTurn(text)
      && endsWithProposal(lastAssistantReply.content);
    const strictNoteTurn = params.scope === 'note' && !!attached && !consentContinuation;
    // Кризис ищем и в приложенной заметке: текст хода теперь — только вопрос.
    const crisis = detectRisk(attached ? `${text}\n${attached.content}` : text).isRisk;
    if (!strictNoteTurn && !smallTalk && text.trim().length > 0 && hasIndexingConsent(uid)) {
      try {
        setAIStage('query');
        const res = await AIService.embed({ content: text });
        if (!res.ok) {
          // S-40: нет согласия на ИИ — ход останавливается с подсказкой (useAIChat), а не
          // идёт «в базовом режиме» в тот же гейт на chat с записью «Сбой сервиса ИИ».
          if (res.error === 'AI_CONSENT_REQUIRED') throw new Error(res.error);
          // S-56: нет согласия на индексацию — базовый режим без записи о сбое.
          if (res.error !== 'INDEXING_CONSENT_REQUIRED') {
            if (isDailyLimitError(res.error)) {
              degradedDueToDailyLimit = true;
            }
            reportAIDegradation({
              feature: 'chat_turn_embed',
              cause: res.error,
              action: 'Векторизация реплики чата',
              impact: 'Поворот диалога не сохранён в векторной памяти',
            });
          }
        }
        turnEmb = res.ok && res.vectors[0] ? res.vectors[0] : undefined;
      } catch (e) {
        if (e instanceof Error && e.message === 'AI_CONSENT_REQUIRED') throw e;
        if (!(e instanceof Error && e.message === 'INDEXING_CONSENT_REQUIRED')) {
          if (isDailyLimitError(e)) {
            degradedDueToDailyLimit = true;
          }
          reportAIDegradation({
            feature: 'chat_turn_embed',
            cause: e,
            action: 'Векторизация реплики чата',
            impact: 'Поворот диалога не сохранён в векторной памяти',
          });
        }
      }
    }

    // 1. Fetch portrait and custom persona concurrently
    const isPreset = PRESET_PERSONAS.some(p => p.id === personaId);
    const portraitPromise = portraitCacheRef.current !== undefined
      ? Promise.resolve(portraitCacheRef.current)
      : AIProfileService.getPortrait().then(p => { portraitCacheRef.current = p; return p; });
    const personaPromise = isPreset
      ? Promise.resolve(undefined)
      : AIPersonaService.getCustom(personaId);

    const [rawPortrait, customPersonaObj] = await Promise.all([portraitPromise, personaPromise]);
    // Backlog idea "de-personalised portrait" (docs/backlog-ideas-2026-09-11.md),
    // shape 1: gated here, the single point everything downstream reads the
    // portrait from — both AIMemoryAssembler.assembleMemoryContext below (whose
    // 'comp-portrait' item has a 600-char floor, so a raw value would survive
    // even a tight budget) and effectivePortrait further down. Gating only at
    // useAIChat's attach site, as the backlog note first sketched, would leave
    // the portrait riding into memoryContext regardless.
    const userPortrait = (getSendPortraitInDialogue(uid) && personaId !== 'editor') ? rawPortrait : null;

    let customSystemPrompt: string | undefined;
    let effectivePersonaId = personaId;
    if (!isPreset && customPersonaObj) {
      customSystemPrompt = customPersonaObj.systemPrompt;
      effectivePersonaId = 'custom';
    }

    // 2. Hydrate searchContext
    const noteAnalysisIntent = /(заметк|запис|аскез)/i.test(text) && /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i.test(text);
    const noteIntentNoText = !attached?.content && noteAnalysisIntent;

    // The forced turn: use the provided query and force the search
    let explicitSearch = forcedSearchQuery ? true : shouldRunFullSearch(text, !!attached);
    let effectiveQuery = forcedSearchQuery ?? text;
    // DLG-Q7: запрос, построенный из приложенной заметки (просьба посмотреть
    // похожее). Отличает этот ход от обычного поиска по тексту реплики.
    let similarNotesQuery: string | undefined;

    let searchContext: string | undefined;
    let attachedBlock: string | undefined;

    let isAttachedExcluded = false;
    // S-39: при нескольких заметках в documentId только первая — скрытую от ИИ
    // проверяем по шапке каждого блока в момент отправки, а не при прикреплении.
    const blockIds = attached?.blockIds;
    const attachedContent = attached ? await hideExcludedNotes(attached.content, db, blockIds) : '';
    // DY4 Н-1: ход с шапками режет по блокам hideExcludedNotes (сбой чтения = скрыта),
    // и «скрыт» весь ход, только когда видимых блоков не осталось. Заметка-тема —
    // первая видимая, а не documentId (первая приложенная): по ней строятся фон и
    // поиск похожих, и скрытая первая утекла бы в них сутью.
    // Только ход от сборщика (есть blockIds) и разобранный на блоки с первой
    // строки. Иначе — старый ход, липкая заметка после перезагрузки (сырой текст),
    // битая шапка — ворота по documentId, как раньше (fail-closed).
    const turnHasHeads = !!blockIds && attachedBlockHeads(attached!.content, blockIds).length > 0;
    // Только из шапок блоков: `[#id]` в теле (вставленный старый ответ ИИ) — не тема.
    const subjectId = turnHasHeads
      ? builderBlockHeads(attachedContent).map(h => h[1]!).find(id => !isPastedAttachmentId(id))
      : attached?.documentId;
    if (attached) {
      // DY5-1: список от сборщика есть, а шапки с ним не совпали — ход скрыт целиком.
      // После hideExcludedNotes шапки уже свои (сверены по списку), список не нужен.
      if (blockIds && !turnHasHeads) isAttachedExcluded = true;
      if (turnHasHeads && builderBlockHeads(attachedContent).length === 0) isAttachedExcluded = true;
      if (attached.documentId && !turnHasHeads) {
        try {
          const doc = await db.get('documents', attached.documentId);
          if (isExcludedFromAI(doc)) {
            isAttachedExcluded = true;
          }
        } catch (e) {
          // S-51: не прочитали заметку — не знаем, скрыта ли; тело не уходит.
          reportError(e, { action: 'buildContext_attachedExcluded', documentId: attached.documentId }, 'warning');
          isAttachedExcluded = true;
        }
      }
      if (!isAttachedExcluded) {
        if (attachedContent.includes('[#')) {
          attachedBlock = attachedContent;
        } else {
          const yyyymmdd = attached.documentId ? (await getDocDate(attached.documentId)) : formatDateYYYYMMDD(Date.now());
          const docId = attached.documentId || 'attached-note';
          const label = attachedIsSticky
            ? '[Заметка, к которой привязан этот диалог — пользователь НЕ присылал её сейчас, не говори «присланная/прикреплённая заметка»]'
            : '[Прикрепленная заметка]';
          attachedBlock = `[#${docId} · ${yyyymmdd}]\n${label}\n${attachedContent}`;
        }
        searchContext = attachedBlock;

        if (subjectId) {
          injectedDocumentIds.push(subjectId);
        }
        // AUDIT-M3: `[#id]` в тексте заметки не должен открывать цитирование
        // исключённых из AI или несуществующих документов — валидируем по корпусу.
        const citedIds = await validateCitationIds(
          extractCitationIds(attachedContent),
          async id => (await db.get('documents', id)) ?? undefined,
        );
        injectedDocumentIds.push(...citedIds);
      }
    }

    // DLG-Q7 (Fable T-11): «поищи похожее», «другие заметки ещё посмотри» при
    // приложенной заметке — это просьба поискать по ТЕМАТИКЕ заметки. Прежний ход
    // оставался строгим (поиск не запускался вовсе) либо искал по тексту реплики,
    // и Редактор честно отвечал «по этому запросу в базе ничего не нашлось».
    // Запрос строится из самой заметки: разбор, если он есть, иначе название +
    // начало тела. Тело скрытой от ИИ заметки в запрос не попадает.
    if (!forcedSearchQuery && attached && !isAttachedExcluded && params.scope === 'wide' && asksForOtherNotes(text)) {
      if (asksForSimilarNotes(text)) {
        // ED-1 (ревью 09.10): если в диалоге уже есть ответ Редактора, «эта
        // тема» — тема ответа, а не всё, что разобрала заметка. Диагноз на
        // синтетическом архиве: запрос из разбора многотемной заметки давал
        // блок из 9 заметок, где 6 — про другие темы той же заметки.
        const fromPost = await postTopicQuery(
          params.messageHistory,
          async id => (await docAt(id)) ?? undefined,
        );
        if (fromPost) {
          similarNotesQuery = fromPost;
        } else {
          const summary = subjectId ? await summaryAt(subjectId) : undefined;
          const fromSummary = [summary?.summary, ...(summary?.themes ?? [])].filter(Boolean).join('. ');
          if (fromSummary.trim()) {
            similarNotesQuery = fromSummary;
          } else {
            const title = subjectId ? (await docAt(subjectId))?.title : undefined;
            const body = attachedContent.replace(/\s+/g, ' ').trim().slice(0, 600);
            const built = [title, body].filter(Boolean).join('. ');
            if (built.trim()) similarNotesQuery = built;
          }
        }
        if (similarNotesQuery) {
          explicitSearch = true;
          effectiveQuery = similarNotesQuery;
        }
      } else if (!explicitSearch) {
        // R-3 (ревью 07.10): у хода своя тема («поищи в других заметках про
        // маму»), и поиск по её тексту не триггернулся — широкий ход с
        // просьбой о других записях не должен оставаться без поиска вовсе.
        explicitSearch = true;
      }
    }

    // Строгий ход: заметка, портрет (фон — правило в системном промпте) и, при
    // кризисе, телефоны помощи. Поиск, хронология, «недавнее» и память здесь
    // раньше запускались по тексту хода, и модель приписывала приложенной
    // заметке цитаты из других записей.
    // Заметка скрыта от ИИ — её текста у модели нет вовсе (R3-004), а ход
    // остаётся строгим: иначе вопрос ушёл бы искать по всему архиву.
    if (strictNoteTurn) {
      const noteBlock = attachedBlock ?? '[Заметка скрыта от ИИ пользователем — её текста у тебя нет. Скажи об этом и не додумывай содержание.]';
      // П5 (самопроверка): в строгом ходе блок заметки печатается без названия,
      // и список названий хода был пуст — правило (в) не работало вовсе, а
      // законное «в заметке "Бег по утрам"» модель могла читать и как выдумку.
      // Название носит маркер в реплике человека (`[Прикреплена заметка: "…"]`),
      // поэтому список собирается из реплик этого хода, а не из блока.
      const turnText = [text, ...(params.messageHistory ?? []).filter(m => m.role === 'user').map(m => m.content)].join('\n');
      // Фон из прошлых дней (0.9.35): суть похожих записей перед заметкой.
      // Не для Редактора — его пост пишется из того, что дал автор, а других
      // заметок он просит явно. Не для скрытой заметки — её вектор не читаем.
      let related: ReturnType<typeof buildRelatedDaysBlock> = null;
      if (effectivePersonaId !== 'editor' && subjectId && !isAttachedExcluded && attachedBlock) {
        try {
          related = buildRelatedDaysBlock(
            subjectId,
            await AIEmbeddingService.getAll(),
            await (docsSnap ??= loadDocumentSnapshot()),
            await (summariesSnap ??= loadSummarySnapshot()),
            attachedContent,
            // FN-2: в documentId только первая — остальные приложенные берём из шапок.
            extractCitationIds(attachedContent),
          );
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] related days failed' });
        }
      }
      if (related) injectedDocumentIds.push(...related.ids);
      // DR-11 + PX-1: в строгом ходе от портрета остаётся только часть о том, как
      // говорить, а при старом формате (нет раздела «Стиль общения») портрет в
      // ход не едет вовсе: темы и паттерны модель поднимала в целый тред
      // «центральная тема ваших заметок» и выдавала его за вывод из этого текста
      // (кейс 8, кейс 9.8). Правило в промпте усилить нельзя (LD-3: 1/20 → 6/20),
      // поэтому рычаг кодовый.
      const strictPortrait = strictTurnPortrait(userPortrait);
      return {
        userPortrait: strictPortrait,
        customPersona: customSystemPrompt,
        searchContext: related ? `${related.block}\n\n${noteBlock}` : noteBlock,
        documentMood: mood,
        memoryContext: null,
        injectedDocumentIds: [...new Set(injectedDocumentIds)],
        injectedTitles: extractContextTitles(`${noteBlock}\n${turnText}`),
        allowedFirstSeenDates: [],
        degradedReason: degradedDueToDailyLimit ? 'daily_limit' : undefined,
        crisis,
      };
    }

    if (!noteIntentNoText) {
      const stickySearch = !explicitSearch && stickyTurnsRef.current > 0 && lastSearchQueryRef.current.length > 0;
      if (explicitSearch) {
        stickyTurnsRef.current = 4;
        lastSearchQueryRef.current = effectiveQuery;
        lastSearchNamesRef.current = [...new Set(effectiveQuery.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [])];
      } else if (stickySearch) {
        stickyTurnsRef.current -= 1;
      }

      const needsFacets = !attached && !noteIntentNoText && (explicitSearch || stickySearch || PSYCHE_PERSONAS.includes(effectivePersonaId));
      const facetNoteIds = new Set<string>();

      let queryEmb: number[] | undefined;
      let allEmbeddings: Awaited<ReturnType<typeof AIEmbeddingService.getAll>> | undefined;

      const shouldRunFacets = needsFacets && !smallTalk;

      if (shouldRunFacets) {
        try {
          if (!facetsCacheRef.current.facets) {
            facetsCacheRef.current.facets = await AIProfileFacetService.getAll();
          }
          const facets = facetsCacheRef.current.facets;

          if (facets.length > 0 && hasIndexingConsent(uid)) {
            const searchQuery = explicitSearch ? effectiveQuery : lastSearchQueryRef.current;
            // П-7: один вектор реплики на ход. При явном поиске поисковый запрос
            // совпадает с текстом реплики, а он уже векторизован выше (turnEmb,
            // AUDIT-M5) — второй вызов на тот же текст стоил ход-user'у ещё одну
            // единицу эмбеддингов. Для другого текста идёт прямой вызов, а не
            // embedOnce: embedOnce возвращает только вектор и вешает отметку о
            // дневном лимите лишь на путь «тот же текст», а здесь важен
            // результат целиком (ниже — chat_facet_embed).
            const reuseTurnVector = searchQuery === text && turnEmb !== undefined;
            const queryEmbResult = reuseTurnVector
              ? { ok: true as const, vectors: [turnEmb as number[]] }
              : await AIService.embed({ content: searchQuery });
            if (!queryEmbResult.ok) {
              if (isDailyLimitError(queryEmbResult.error)) {
                degradedDueToDailyLimit = true;
              }
              reportAIDegradation({
                feature: 'chat_facet_embed',
                cause: queryEmbResult.error,
                action: 'Сопоставление тем профиля с запросом',
                impact: 'Темы профиля не были сопоставлены с запросом',
              });
            }
            queryEmb = queryEmbResult.ok && queryEmbResult.vectors[0] ? queryEmbResult.vectors[0] : undefined;

            if (queryEmb) {
              const matched = facets
                .map(f => {
                  const sim = cosineSimilarity(queryEmb!, f.centroid);
                  return { facet: f, sim };
                })
                .filter(m => m.sim > 0.45)
                .sort((a, b) => b.sim - a.sim)
                .slice(0, 3);

              if (matched.length > 0) {
                const blocks: string[] = [];
                for (const m of matched) {
                  // W-3: тема профиля — производный текст, собранный по своим
                  // заметкам. Проверка идёт на каждом ходе по снимку хода (те же
                  // docAt + isExcludedFromAI/trashedAt, что в блоке цитат
                  // человека), потому что сокрытие заметки фасет не перестраивает.
                  // Тема без видимых заметок не показывается; тема, у которой
                  // хотя бы одна заметка скрыта или в корзине, не показывается
                  // вовсе — её summary нельзя почистить на чтении, а формулировка
                  // скрытой записи живёт именно в summary.
                  const visible: string[] = [];
                  let excluded = 0;
                  for (const id of m.facet.noteIds) {
                    const doc = await docAt(id);
                    if (!doc || isExcludedFromAI(doc) || doc.trashedAt) excluded++;
                    else visible.push(id);
                  }
                  if (visible.length === 0 || excluded > 0) continue;
                  for (const id of visible) facetNoteIds.add(id);
                  blocks.push(`Раздел "${m.facet.label}": ${m.facet.summary || 'описание отсутствует'} (заметки: ${visible.length})`);
                }
                if (blocks.length > 0) {
                  searchContext = `[Профиль пользователя: авто-выделенные темы]\n` + blocks.join('\n');
                }
              }
            }
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] facet augmentation failed' });
        }
      }

      let handledByTemporal = false;
      let skipSemantic = false;
      let periodWindow: { minTime: number; maxTime: number } | undefined;
      let searchFailed = false;
      let semanticIndexMissing = false;
      let allNotes: RetrievedNote[] = [];

      let minTime: number | undefined;
      let maxTime: number | undefined;

      // Scope comes from THIS message only. It used to be pinned to the whole
      // dialogue from the first question, so a later question that named no
      // period was silently answered from inside the old one — invisibly making
      // every following answer worse. Follow-ups already keep their thread
      // through the sticky search below.
      const temporal = await buildTemporalBlocks({
        text,
        effectiveQuery,
        explicitSearch,
        lastSearchQuery: lastSearchQueryRef.current,
        db,
      });
      handledByTemporal = temporal.outcome.handledByTemporal;
      periodWindow = temporal.periodWindow;
      skipSemantic = temporal.outcome.skipSemantic;
      minTime = temporal.outcome.minTime;
      maxTime = temporal.outcome.maxTime;
      if (temporal.setSearchContextTo !== undefined) {
        searchContext = attachedBlock
          ? `${temporal.setSearchContextTo}\n\n${attachedBlock}`
          : temporal.setSearchContextTo;
      } else if (temporal.appended) {
        searchContext = (searchContext ?? '') + temporal.appended;
      }

      const aggregateBlock = await buildAggregateThemeBlock({
        effectiveQuery,
        queryEmb,
        uid,
        onDailyLimitError: () => { degradedDueToDailyLimit = true; },
      });
      if (aggregateBlock) {
        searchContext = (searchContext ?? '') + aggregateBlock;
      }

      if (explicitSearch || stickySearch) {
        const candidateNames = [...new Set([
          ...effectiveQuery.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
          ...lastSearchNamesRef.current,
        ])];
        // П-5 (замер 08.10.2026): имя ищется по падежным формам. Строкой раньше
        // было «граница + Имя + граница», то есть только именительный: на
        // согласованном корпусе он видел 64 помеченные заметки из 73 (87 %), а
        // формы по окончаниям — 69 (95 %) при нулевом лишнем.
        const nameRegexes = candidateNames.map(nameForms).filter(re => re !== NEVER_MATCH);

        // Раньше здесь была картотека людей: имя → её noteIds. Картотека убрана
        // (D4.17), и вопрос про человека идёт обычным путём — поиском по тексту
        // заметок ниже, где имя и так ищется по candidateNames. Индекс всё равно
        // был лишь ускорением: на свежем устройстве он пуст, и общий поиск
        // отвечал на «что я писал про Сашу» лучше него.
        if (!skipSemantic) {
          const searchQuery = explicitSearch ? effectiveQuery : `${lastSearchQueryRef.current}\n${text}`;
          try {
            let searchQueries = [searchQuery];
            const expansionEnabled = import.meta.env.VITE_AI_QUERY_EXPANSION === 'true';
            if (explicitSearch && expansionEnabled) {
              try {
                const expandRes = await AIService.chat({
                  personaId: 'coach',
                  callType: 'query_expand',
                  messages: [{ role: 'user', content: `Для поискового запроса по личному дневнику: "${searchQuery}", напиши 3 альтернативных поисковых запроса на русском языке (синонимы, связанные темы, имена). Выдай их одной строкой через запятую.` }],
                });
                if (expandRes.ok && expandRes.text) {
                  const expanded = expandRes.text.split(',').map(s => s.trim()).filter(s => s.length > 2);
                  if (expanded.length > 0) searchQueries = [searchQuery, ...expanded.slice(0, 3)];
                } else if (!expandRes.ok) {
                  reportAIDegradation({
                    feature: 'chat_query_expand',
                    cause: expandRes.error,
                    action: 'Расширение поискового запроса в чате',
                    impact: 'Использован исходный поисковый запрос без расширения',
                  });
                }
              } catch (e) {
                reportAIDegradation({
                  feature: 'chat_query_expand',
                  cause: e,
                  action: 'Расширение поискового запроса в чате',
                  impact: 'Использован исходный поисковый запрос без расширения',
                });
              }
            }

            if (queryEmb === undefined && hasIndexingConsent(uid)) {
              // AUDIT-M5: при searchQuery === text переиспользуем turnEmb —
              // один текст за ход векторизуется один раз.
              if (searchQuery === text && turnEmb !== undefined) {
                queryEmb = turnEmb;
              } else {
                queryEmb = await embedOnce(searchQuery);
              }
            }

            if (allEmbeddings === undefined) {
              allEmbeddings = await AIEmbeddingService.getAll();
            }

            setAIStage('search');
            const searchResult = await searchNotesMulti(searchQueries, 10, { queryVector: queryEmb, allEmbeddings, minTime, maxTime });
            const notes = searchResult.notes;
            if (searchResult.failed) searchFailed = true;
            if (searchResult.degraded) semanticIndexMissing = true;

            const nameSearchIds = new Set<string>();
            // Текст, прочитанный для поиска по имени без вектора: те же заметки
            // включаются в контекст ниже, второе чтение IndexedDB не нужен.
            const scannedContent = new Map<string, string>();
            const nameSearchEmb = candidateNames.length > 0 ? (allEmbeddings ?? await AIEmbeddingService.getAll()) : [];
            if (nameRegexes.length > 0) {
              for (const emb of nameSearchEmb) {
                if (nameSearchIds.has(emb.documentId)) continue;
                const texts = emb.chunkTexts ?? [];
                if (texts.some((t: string) => nameRegexes.some(re => re.test(t)))) nameSearchIds.add(emb.documentId);
              }
              // П-5: этот блок читал только chunkTexts, то есть заметки с вектором.
              // Без вектора заметка оставалась невидимой для поиска по имени — на
              // устройстве, где индекс не достроен, это половина архива. Текст
              // берётся из снимка хода; скрытые и корзина отсекаются тем же
              // фильтром, что и везде. Потолок на чтение — чтобы ход на пустом
              // индексе не превращался в полный скан архива (это задача П-6).
              const embeddedIds = new Set(nameSearchEmb.map(e => e.documentId));
              const docsAll = await (docsSnap ??= loadDocumentSnapshot());
              const withoutVectors = [...docsAll.values()]
                .filter(d => !embeddedIds.has(d.id) && !isExcludedFromAI(d) && !nameSearchIds.has(d.id))
                .sort((a, b) => (b.lastSessionAt ?? 0) - (a.lastSessionAt ?? 0))
                .slice(0, NAME_SCAN_NO_VECTOR_LIMIT);
              for (const doc of withoutVectors) {
                const content = await LocalVersionService.getLatestContent(doc.id);
                if (!content) continue;
                scannedContent.set(doc.id, content);
                if (nameRegexes.some(re => re.test(`${doc.title ?? ''}\n${content}`))) nameSearchIds.add(doc.id);
              }
            }

            const foundIds = new Set(notes.map(n => n.documentId));
            if (nameRegexes.length > 0 && facetNoteIds.size > 0) {
              for (const emb of nameSearchEmb) {
                if (!facetNoteIds.has(emb.documentId)) continue;
                if (foundIds.has(emb.documentId) || nameSearchIds.has(emb.documentId)) continue;
                const texts = emb.chunkTexts ?? [];
                if (texts.some((t: string) => nameRegexes.some(re => re.test(t)))) nameSearchIds.add(emb.documentId);
              }
            }

            const extraIds: string[] = [];
            for (const id of facetNoteIds) {
              if (!foundIds.has(id) && !nameSearchIds.has(id) && extraIds.length < 10) extraIds.push(id);
            }
            const nameIds = [...nameSearchIds].filter(id => !foundIds.has(id) && !extraIds.includes(id)).slice(0, 15);
            allNotes = notes.length > 0 ? [...notes] : [];

            for (const docId of [...extraIds, ...nameIds]) {
              const doc = await docAt(docId); // X-5
              if (!doc || isExcludedFromAI(doc)) continue;
              const content = scannedContent.get(docId) ?? await LocalVersionService.getLatestContent(docId);
              if (!content) continue;
              allNotes.push({
                documentId: docId,
                title: doc.title || 'Без названия',
                content,
                score: 0,
                lastSessionAt: doc.lastSessionAt,
              });
            }
            // П-1 (замер 08.10.2026): второго прохода переранжирования здесь больше
            // нет. Он решал только состав top-8, а порядок показа пересобирается ниже
            // по composite-оценке — то есть на выдачу не влиял, зато тратил второй
            // сетевой вызов на ход и снимал 0,03 помеченных заметок из контекста.
            // Первый проход остаётся внутри searchNotes.
          } catch (e) {
            searchFailed = true;
            reportError(e, { action: '[useAIChatContext] note search failed' });
          }
        }

        try {
          if (allNotes.length > 0) {
            const allLocalDocs = await db.getAll('documents');
            const excludedSet = new Set(allLocalDocs.filter(d => isExcludedFromAI(d)).map(d => d.id));
            if (excludedSet.size > 0) {
              allNotes = allNotes.filter(n => !excludedSet.has(n.documentId));
            }
            // DLG-Q7: приложенная заметка уже в контексте отдельным блоком —
            // второй раз она в результатах не нужна.
            if (similarNotesQuery && attached?.documentId) {
              allNotes = allNotes.filter(n => n.documentId !== attached.documentId && n.documentId !== subjectId);
            }
          }

          if (allNotes.length > 0) {
            const existingContextLen = (searchContext ?? '').length;
            const remainingBudget = Math.max(5_000, 48_000 - existingContextLen);
            const BUDGET_CHARS = Math.min(25_000, remainingBudget);
            const now = Date.now();
            // ED-1: на ходе «похожие записи» ищут не по словам реплики, а по
            // построенному запросу, и вес слов обязан считаться по нему — иначе
            // 0.3keyword всегда около нуля и блок размывается чужими темами.
            const keywordSource = similarNotesQuery ? effectiveQuery : text;
            const scored = allNotes.map(n => {
              // RRF живёт в шкале ≤~0.05; нормализация — см. vectorScore01 (#104).
              const vs01 = vectorScore01(n.score);
              const keywordScore = Math.min(1, (n.content.match(new RegExp(keywordSource.split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'))?.length ?? 0) / 10);
              const ageDays = (now - (n.lastSessionAt ?? now)) / 86_400_000;
              const recencyFactor = Math.exp(-ageDays / 365);
              return {
                note: n,
                compositeScore: 0.5 * vs01 + 0.3 * keywordScore + 0.2 * recencyFactor,
              };
            }).sort((a, b) => b.compositeScore - a.compositeScore);

            const CONTEXT_RADIUS = 500;
            const PER_NOTE_CHARS = 2_000;
            // LD-7: индекс чанков заметки — справочник по id, а не поиск по
            // массиву на каждую заметку хода.
            const embByDoc = new Map((allEmbeddings ?? []).map(e => [e.documentId, e]));
            const selectedNotes: Array<{
              note: typeof scored[0]['note'];
              snippet: string;
              summaryPrefix: string;
            }> = [];
            let totalChars = 0;

            for (const { note: n } of scored) {
              if (totalChars >= BUDGET_CHARS) break;
              let snippet: string;
              if (nameRegexes.length > 0) {
                // П-5: позиция ищется по форме имени. Заметку, где имя только в
                // дательном («с Олей»), находили, а кусок брали с начала — indexOf
                // знал лишь именительный.
                const namePositions = nameRegexes
                  .map(re => re.exec(n.content)?.index ?? -1)
                  .filter(pos => pos >= 0);
                if (namePositions.length > 0) {
                  const firstPos = Math.min(...namePositions);
                  const start = Math.max(0, firstPos - CONTEXT_RADIUS);
                  snippet = n.content.slice(start, start + PER_NOTE_CHARS);
                  if (start > 0) snippet = '…' + snippet;
                  if (start + PER_NOTE_CHARS < n.content.length) snippet += '…';
                } else {
                  snippet = n.content.slice(0, PER_NOTE_CHARS);
                }
              } else {
                // LD-7: без имени в запросе окно берётся вокруг чанка,
                // ближайшего к вектору запроса, а не строго с начала заметки.
                const chunkPos = bestChunkPosition(n.content, embByDoc.get(n.documentId), queryEmb, PER_NOTE_CHARS);
                if (chunkPos === null) {
                  snippet = n.content.length > PER_NOTE_CHARS
                    ? n.content.slice(0, PER_NOTE_CHARS) + '…'
                    : n.content;
                } else {
                  const start = Math.max(0, chunkPos - CONTEXT_RADIUS);
                  snippet = n.content.slice(start, start + PER_NOTE_CHARS);
                  if (start > 0) snippet = '…' + snippet;
                  if (start + PER_NOTE_CHARS < n.content.length) snippet += '…';
                }
              }

              setAIStage('summaries');
              const noteSummary = await summaryAt(n.documentId); // X-5
              const summaryPrefix = noteSummary?.summary ? `[Суть: ${noteSummary.summary}]\n` : '';

              selectedNotes.push({ note: n, snippet, summaryPrefix });
              totalChars += snippet.length + summaryPrefix.length;
            }

            // OPT-7: place best notes last (reversed selected notes) so they are closest to query
            const orderedForPlacement = [...selectedNotes].reverse();
            const parts: string[] = [];
            let noteIdx = 0;

            for (const { note: n, snippet, summaryPrefix } of orderedForPlacement) {
              noteIdx++;
              const yyyymmdd = formatDateYYYYMMDD(n.lastSessionAt);
              injectedDocumentIds.push(n.documentId);
              parts.push(`[#${n.documentId} · ${yyyymmdd}]\nЗаметка ${noteIdx}: "${n.title}"\n${summaryPrefix}${snippet}`);
            }

            const corpus = await getCorpusStats(db);
            const noteBlock = (
              `\n\nРезультаты поиска по архиву заметок (запрос: "${effectiveQuery}"). ` +
              `Искал по ВСЕЙ базе: ${corpus.total} заметок, ${corpus.from} — ${corpus.to}. ` +
              `Найдено заметок: ${allNotes.length} (отобрано ${selectedNotes.length} по релевантности). ` +
              `Это наиболее релевантные заметки по запросу. Если ответа в них нет — так и скажи, не домысливай.\n\n` +
              parts.join('\n\n')
            );
            searchContext = (searchContext ?? '') + noteBlock;
          } else if (searchFailed) {
            searchContext = (searchContext ?? '') +
              `\n\n[СИСТЕМНОЕ СООБЩЕНИЕ: Поиск по базе не удался из-за технической ошибки. Сообщи пользователю "Я не смог выполнить поиск по вашим заметкам из-за технической ошибки." и КАТЕГОРИЧЕСКИ не делай выводов о том, есть ли у него такие заметки.]`;
          } else if (!handledByTemporal || explicitSearch) {
            // Appended, not assigned: with a note attached this used to be
            // skipped entirely, so a search that ran and found nothing left no
            // trace — and the model fell back to "I have no access to your
            // archive", the exact claim this block exists to prevent.
            // W-1: то же «ничего не нашлось» пишется и когда ход разобран как
            // хронологический, но человек явно просил поискать.
            // ED-3: на ходе «похожие записи» оба блока сразу противоречат друг
            // другу по тону (один говорит «в базе ничего нет», второй зовёт
            // приложить заметку, которая уже приложена). Остаётся один блок —
            // про похожие записи, — и к нему строка о том, что просить
            // приложенную заметку не нужно.
            const corpus = await getCorpusStats(db);
            // Скрытая от ИИ приложенная заметка в контекст не попадает вовсе,
            // поэтому и строка про «приложена» ей не показывается: иначе модель
            // остаётся без текста, но с обещанием, что текст под рукой.
            const attachedHint = attached && !isAttachedExcluded
              ? ' Заметка приложена и у тебя есть — не проси приложить её.'
              : '';
            searchContext = (searchContext ?? '') + (similarNotesQuery
              ? `\n\n[Поиск похожих записей: ничего не найдено. Других записей на эту тему в найденном нет — скажи об этом прямо и НЕ выдумывай их.${attachedHint}]`
              : `\n\n[Поиск по ВСЕЙ базе (${corpus.total} заметок, ${corpus.from} — ${corpus.to}) по запросу "${effectiveQuery}" ` +
                `не нашёл подходящих заметок. Скажи, что по этому запросу в базе ничего не нашлось (НЕ «нет доступа»), ` +
                `предложи переформулировать.${attachedHint} КАТЕГОРИЧЕСКИ не выдумывай содержание его заметок и не приписывай ему того, чего нет.` +
                (semanticIndexMissing
                  ? ` ВАЖНО: смысловой индекс заметок сейчас не построен, поэтому искал только по совпадению слов — предупреди об этом и предложи попробовать другие формулировки и точные слова из записей.]`
                  : `]`));
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] note formatting/budgeting failed' });
        }
      }

      // Lite retrieval if no full search was performed
      const performedFullSearch = explicitSearch || stickySearch;
      if (!attached && !performedFullSearch && !noteIntentNoText && !smallTalk) {
        const liteBlock = await buildLiteRetrievalBlock({
          turnEmb,
          db,
          minTime,
          maxTime,
          injectedDocumentIds,
        });
        if (liteBlock) {
          searchContext = searchContext ? `${searchContext}\n\n${liteBlock}` : liteBlock;
        }
      }

      // DLG-Q9 (Fable T-17): строки того человека, о котором спрашивают. Без
      // такого блока модель подгоняет записи под реплику: «мама против», хотя в
      // записях мама зовёт переезжать к ней (расхождение называет в 3–4 ходах из
      // 9 с блоком и 0 из 9 без). В кризис архив не поднимаем, светский ход и
      // строгий ход (он вышел раньше) блока не получают.
      if (!smallTalk && !crisis) {
        const persons = detectPersonMentions(text, {
          selfName: getCurrentUser()?.displayName ?? undefined,
          corpusText: allNotes.map(n => n.content).join('\n'),
        });
        if (persons.length > 0) {
          const cacheKey = `${persons.map(p => p.key).join(',')}|${allNotes.map(n => n.documentId).sort().join(',')}`;
          // Права проверяются на каждом ходе: заметку из блока могли скрыть от ИИ
          // или удалить в другой вкладке или на другом устройстве, а ключ кэша
          // её не видит (заметки дополнительного поиска в него не входят).
          const cached = personQuotesCacheRef.current;
          let cacheValid = cached?.key === cacheKey;
          if (cached && cacheValid) {
            for (const id of cached.ids) {
              const doc = await docAt(id);
              if (!doc || isExcludedFromAI(doc) || doc.trashedAt) { cacheValid = false; break; }
            }
          }
          if (cacheValid && cached) {
            injectedDocumentIds.push(...cached.ids);
          } else {
            let extraSearchUsed = false;
            const blockIds: string[] = [];
            const chunks: string[] = [];
            for (const person of persons) {
              let pool = allNotes.filter(n => person.pattern.test(n.content));
              if (pool.length === 0 && !extraSearchUsed && hasIndexingConsent(uid)) {
                // Один дополнительный поиск на ход, тем же путём, что основной.
                extraSearchUsed = true;
                try {
                  // V-5 (план MIND: 0 новых вызовов LLM на горячем пути): порядок
                  // здесь не нужен — строки всё равно отбираются по имени, —
                  // поэтому без облачного переранжирования.
                  const extra = await searchNotesMulti([person.key], 5, {
                    queryVector: await embedOnce(person.key),
                    allEmbeddings: await AIEmbeddingService.getAll(),
                    skipRerank: true,
                  });
                  pool = extra.notes;
                } catch { /* поиск не удался — блока просто нет */ }
              }
              const notes: PersonNote[] = [];
              for (const n of pool) {
                // Тот же снимок хода и тот же фильтр приватности, что у поиска.
                const doc = await docAt(n.documentId);
                if (!doc || isExcludedFromAI(doc) || doc.trashedAt) continue;
                if (!n.content.trim()) continue;
                notes.push({ id: n.documentId, date: formatDateYYYYMMDD(n.lastSessionAt), text: n.content });
              }
              const block = buildPersonQuotesBlock(person, notes);
              if (block) {
                chunks.push(block);
                const ids = personQuoteIds(person, notes);
                injectedDocumentIds.push(...ids);
                blockIds.push(...ids);
              }
            }
            personQuotesCacheRef.current = { key: cacheKey, block: chunks.length > 0 ? chunks.join('\n\n') : undefined, ids: [...new Set(blockIds)] };
          }
          const personBlock = personQuotesCacheRef.current?.block;
          if (personBlock) {
            const marker = 'Результаты поиска по архиву';
            const at = (searchContext ?? '').indexOf(marker);
            searchContext = at > 0
              ? `${(searchContext as string).slice(0, at)}${personBlock}\n\n${(searchContext as string).slice(at)}`
              : `${searchContext ?? ''}\n\n${personBlock}`.trim();
          }
        }
      }

      // Memory integration
      // AX-8: preference memories (from 👍/👎) are ALWAYS included, not just by
      // embedding similarity, so feedback reliably influences the next response.
      if (!attached && !noteIntentNoText) {
        try {
          const relevantMemories = queryEmb ? await AIChatMemoryService.getRelevant(queryEmb, 5) : [];
          const preferences = await AIChatMemoryService.getPreferences();
          // Merge + deduplicate by id
          const seen = new Set<string>();
          const allMemories = [...preferences, ...relevantMemories].filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          if (allMemories.length > 0) {
            const memoryBlock = `[Долгосрочная память (прошлые диалоги)]\n` + allMemories.map(m => `— ${m.text}`).join('\n');
            searchContext = searchContext ? `${memoryBlock}\n\n${searchContext}` : memoryBlock;
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] memory integration failed' });
        }
      }

      // Contact Doors check
      const isPresetId = PRESET_PERSONAS.some(p => p.id === effectivePersonaId);
      const isPsychePersona = ['group_psychology', 'cbt', 'coach'].includes(effectivePersonaId);
      if (isPresetId && isPsychePersona) {
        try {
          const cachedDoors = doorsCacheRef.current;
          let doorHint = '';
          if (cachedDoors) {
            doorHint = cachedDoors.hint;
          } else {
            const cachedDocsMap = docsCacheRef.current;
            let docsList: { id: string; title?: string; lastSessionAt?: number; firstSessionAt?: number }[] = [];
            if (cachedDocsMap) {
              docsList = Array.from(cachedDocsMap.values());
            } else {
              docsList = await db.getAll('documents');
              const map = new Map();
              docsList.forEach(d => map.set(d.id, d));
              docsCacheRef.current = map;
            }
            if (docsList.length > 0) {
              const perNote: { doors: ReturnType<typeof analyzeDoors>; ts: number }[] = [];
              for (const d of docsList) {
                const content = await LocalVersionService.getLatestContent(d.id);
                if (!content) continue;
                perNote.push({ doors: analyzeDoors(content), ts: d.lastSessionAt ?? d.firstSessionAt ?? 0 });
              }
              perNote.sort((a, b) => b.ts - a.ts);
              const doorsResult = aggregateDoors(perNote.slice(0, 20));
              if (!doorsResult.lowData && doorsResult.thinnestDoor && doorsResult.dominantDoor) {
                doorHint = `\n\nНаблюдение: в записях пользователь чаще опирается на ${doorLabel(doorsResult.dominantDoor)}; ${doorLabel(doorsResult.thinnestDoor)} звучат реже. Если уместно — мягко, гипотезой пригласи заметить ${doorLabel(doorsResult.thinnestDoor)} за ${doorLabel(doorsResult.dominantDoor)}; не дави, дай возможность отказаться.`;
              }
            }
            doorsCacheRef.current = { hint: doorHint };
          }
          if (doorHint) {
            searchContext = searchContext ? `${doorHint}\n\n${searchContext}` : doorHint;
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] contact doors failed' });
        }
      }

      // LD-8: «за период N заметок, в материалах полный текст у M». До этого ход
      // «перечисли все мои X за октябрь» отвечал из топ-10 и утверждал, что это
      // все записи; теперь полнота материалов сказано вслух.
      if (periodWindow) {
        const docsAll = await (docsSnap ??= loadDocumentSnapshot());
        const inPeriod = [...docsAll.values()].filter(d => !isExcludedFromAI(d)
          && typeof d.lastSessionAt === 'number'
          && d.lastSessionAt >= periodWindow.minTime && d.lastSessionAt <= periodWindow.maxTime);
        const injected = new Set(injectedDocumentIds);
        const fullText = inPeriod.filter(d => injected.has(d.id)).length;
        if (inPeriod.length > 0 && fullText < inPeriod.length) {
          searchContext = (searchContext ?? '') +
            `\n\n[Полнота материалов] за период ${inPeriod.length} заметок, в материалах полный текст у ${fullText}. ` +
            `Остальных текстов у тебя нет — не говори, что перечислил все записи периода.`;
        }
      }
    } else {
      searchContext =
        `ВНИМАНИЕ: пользователь просит разобрать заметку, но ЕЁ ТЕКСТ НЕ ПРИЛОЖЕН к этому сообщению и его нет в контексте. ` +
        `У тебя НЕТ текста этой заметки. КАТЕГОРИЧЕСКИ запрещено выдумывать, реконструировать или пересказывать её содержание — ` +
        `даже если кажется, что ты «помнишь» тему. Не сочиняй ни единого предложения «из заметки». ` +
        `Вместо этого коротко и по-доброму скажи, что не видишь текста заметки, и попроси прикрепить её (скрепкой) или вставить текст. Ничего больше не придумывай.`;
    }

    // 3. Proactive recent context and dialogue memory
    const shouldInjectProactive = (isFirstTurn || onlySmallTalkBefore) && !explicitSearch && !smallTalk && !recentContextInjectedRef.current;
    if (shouldInjectProactive) {
      const proactiveBlock = await buildProactiveBlock({ personaId, turnEmb });
      if (proactiveBlock) {
        searchContext = searchContext ? `${proactiveBlock}\n\n${searchContext}` : proactiveBlock;
        recentContextInjectedRef.current = true;
      }
    }

    let memoryContext: string | null = null;
    try {
      setAIStage('memory');
      memoryContext = await AIMemoryAssembler.assembleMemoryContext({
        query: text,
        attachedDocumentId: isAttachedExcluded ? null : (subjectId ?? null),
        attachedContent: isAttachedExcluded || !attached ? null : attachedContent,
        userPortrait,
        proactiveBlock: searchContext,
        dialogueId: params.dialogueId ?? null,
      });
    } catch {
      /* ignore assembler errors */
    }

    const currentFlags = MemoryFlagsService.getFlags();
    const effectivePortrait = (!currentFlags.ff_memory_assembler_shadow && currentFlags.ff_memory_assembler_portrait)
      ? null
      : (userPortrait ?? null);
    const effectiveSearchContext = (!currentFlags.ff_memory_assembler_shadow && currentFlags.ff_memory_assembler_turn1)
      ? undefined
      : (searchContext ?? undefined);

    const allowedFirstSeenDates = [
      ...extractFirstSeenDates(memoryContext),
      ...extractFirstSeenDates(searchContext),
    ];

    const memoryDocIds = extractDocumentIdsFromText(memoryContext);
    const searchDocIds = extractDocumentIdsFromText(searchContext);
    // AUDIT-M3: id'шники, вытащенные из ТЕКСТА (заметка может содержать
    // произвольные [#...] маркеры), валидируются по корпусу — исключённые из AI
    // и несуществующие документы не попадают в allowlist цитат.
    const rawDocIds = [...memoryDocIds, ...searchDocIds];
    const validatedDocIds = await validateCitationIds(
      rawDocIds,
      async id => (await db.get('documents', id)) ?? undefined,
    );
    const allInjectedDocIds = [
      ...injectedDocumentIds,
      ...validatedDocIds,
    ];
    // DLG-Q8: названия, которые модель реально видела в этом ходе, — по ним
    // sanitizeCitations отличает законную ссылку на заметку от выдуманной.
    const contextTitles = [
      ...extractContextTitles(searchContext),
      ...extractContextTitles(memoryContext),
    ];

    return {
      userPortrait: effectivePortrait,
      customPersona: customSystemPrompt,
      searchContext: effectiveSearchContext,
      documentMood: mood,
      memoryContext,
      injectedDocumentIds: [...new Set(allInjectedDocIds)],
      injectedTitles: [...new Set(contextTitles)],
      allowedFirstSeenDates: [...new Set(allowedFirstSeenDates)],
      degradedReason: degradedDueToDailyLimit ? 'daily_limit' : undefined,
      crisis,
      ...(consentContinuation ? { effectiveScope: 'wide' as const } : {}),
    };

  };

  return {
    buildContext,
    resetSession,
    setAttachedNote,
    getAttachedNote,
    incrementMessageCount,
    getMessageCount,
  };
}
