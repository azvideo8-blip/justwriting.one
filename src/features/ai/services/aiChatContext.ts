import { useRef } from 'react';
import { getLocalDb } from '../../../core/storage/localDb';
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
import { looksLikeNoteSearch, shouldRunFullSearch } from '../utils/aiChatTransport';
import { cosineSimilarity } from '../utils/vectorSearch';
import { AIChatMemoryService } from './AIChatMemoryService';
import { AIMemoryAssembler, extractDocumentIdsFromText } from './AIMemoryAssembler';
import { MemoryFlagsService } from './memoryFlags';
import { setAIStage } from '../store/useAIStageStore';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { getSendPortraitInDialogue } from '../../../core/ai/portraitDialoguePreference';
import { extractFirstSeenDates } from '../utils/dateGuard';
import { reportAIDegradation, isDailyLimitError } from '../utils/aiDegradationReporter';
import type { ChatContextResult, BuildContextParams } from './chatContext/types';
import { getCorpusStats, formatDateYYYYMMDD, getDocDate } from './chatContext/corpusStats';
import { extractCitationIds, validateCitationIds } from './chatContext/citations';
import { createEmbedOnce } from './chatContext/embeddings';
import { buildProactiveBlock } from './chatContext/proactive';
import { buildTemporalBlocks } from './chatContext/temporalBlocks';
import { buildAggregateThemeBlock } from './chatContext/aggregateStats';
import { buildLiteRetrievalBlock } from './chatContext/liteRetrieval';
import { isExcludedFromAI } from '../utils/isExcludedFromAI';

/** Заметка-тема диалога. title/date идут в правило строгого хода (noteScope). */
export interface AttachedNoteRef {
  content: string;
  documentId?: string;
  title?: string;
  date?: string;
}

const CRISIS_RESOURCE_TEXT =
  `Пользователь находится в кризисном состоянии. Интегрируй в свой ответ контакты служб поддержки:\n` +
  `Единый телефон доверия: 8-800-333-44-34, горячая линия психологической помощи: 051 (с городского) или +7 (495) 051.\n` +
  `Отвечай тепло, эмпатично, не давай советов, поддерживай.`;

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

  const resetSession = () => {
    stickyTurnsRef.current = 0;
    lastSearchQueryRef.current = '';
    lastSearchNamesRef.current = [];
    facetsCacheRef.current = { facets: null };
    docsCacheRef.current = null;
    doorsCacheRef.current = null;
    messageCountRef.current = 0;
    recentContextInjectedRef.current = false;
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
    let degradedDueToDailyLimit = false;

    let turnEmb: number[] | undefined;
    const uid = getCurrentUser()?.uid;
    // AUDIT-M5: один текст за ход векторизуется ОДИН раз — повторные вызовы
    // (поисковый запрос === текст реплики) переиспользуют результат.
    const embedOnce = createEmbedOnce({
      text,
      onDailyLimitError: () => { degradedDueToDailyLimit = true; },
    });
    // Строгий ход по заметке ничего не ищет — и вектор реплики ему не нужен.
    const strictNoteTurn = params.scope === 'note' && !!attached;
    // Кризис ищем и в приложенной заметке: текст хода теперь — только вопрос.
    const riskText = attached ? `${text}\n${attached.content}` : text;
    if (!strictNoteTurn && text.trim().length > 0 && hasIndexingConsent(uid)) {
      try {
        setAIStage('query');
        const res = await AIService.embed({ content: text });
        if (!res.ok) {
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
        turnEmb = res.ok && res.vectors[0] ? res.vectors[0] : undefined;
      } catch (e) {
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
    const explicitSearch = forcedSearchQuery ? true : shouldRunFullSearch(text, !!attached);
    const effectiveQuery = forcedSearchQuery ?? text;

    let searchContext: string | undefined;
    let attachedBlock: string | undefined;

    if (attached) {
      let isAttachedExcluded = false;
      if (attached.documentId) {
        try {
          const doc = await db.get('documents', attached.documentId);
          if (isExcludedFromAI(doc)) {
            isAttachedExcluded = true;
          }
        } catch { /* ignore */ }
      }
      if (!isAttachedExcluded) {
        if (attached.content.includes('[#')) {
          attachedBlock = attached.content;
        } else {
          const yyyymmdd = attached.documentId ? (await getDocDate(attached.documentId)) : formatDateYYYYMMDD(Date.now());
          const docId = attached.documentId || 'attached-note';
          const label = attachedIsSticky
            ? '[Заметка, к которой привязан этот диалог — пользователь НЕ присылал её сейчас, не говори «присланная/прикреплённая заметка»]'
            : '[Прикрепленная заметка]';
          attachedBlock = `[#${docId} · ${yyyymmdd}]\n${label}\n${attached.content}`;
        }
        searchContext = attachedBlock;

        if (attached.documentId) {
          injectedDocumentIds.push(attached.documentId);
        }
        // AUDIT-M3: `[#id]` в тексте заметки не должен открывать цитирование
        // исключённых из AI или несуществующих документов — валидируем по корпусу.
        const citedIds = await validateCitationIds(
          extractCitationIds(attached.content),
          async id => (await db.get('documents', id)) ?? undefined,
        );
        injectedDocumentIds.push(...citedIds);
      }
    }

    // Строгий ход: заметка, портрет (фон — правило в системном промпте) и, при
    // кризисе, телефоны помощи. Поиск, хронология, «недавнее» и память здесь
    // раньше запускались по тексту хода, и модель приписывала приложенной
    // заметке цитаты из других записей.
    if (strictNoteTurn && attachedBlock) {
      return {
        userPortrait: userPortrait ?? null,
        customPersona: customSystemPrompt,
        searchContext: detectRisk(riskText).isRisk ? `${CRISIS_RESOURCE_TEXT}\n\n${attachedBlock}` : attachedBlock,
        documentMood: mood,
        memoryContext: null,
        injectedDocumentIds: [...new Set(injectedDocumentIds)],
        allowedFirstSeenDates: [],
        degradedReason: degradedDueToDailyLimit ? 'daily_limit' : undefined,
      };
    }

    if (!noteIntentNoText) {
      const stickySearch = !explicitSearch && stickyTurnsRef.current > 0 && lastSearchQueryRef.current.length > 0;
      if (explicitSearch) {
        stickyTurnsRef.current = 4;
        lastSearchQueryRef.current = text;
        lastSearchNamesRef.current = [...new Set(text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [])];
      } else if (stickySearch) {
        stickyTurnsRef.current -= 1;
      }

      const psychePersonas = ['group_psychology', 'cbt', 'coach', 'parts'];
      const needsFacets = !attached && !noteIntentNoText && (explicitSearch || stickySearch || psychePersonas.includes(effectivePersonaId));
      const facetNoteIds = new Set<string>();

      let queryEmb: number[] | undefined;
      let allEmbeddings: Awaited<ReturnType<typeof AIEmbeddingService.getAll>> | undefined;

      const wordCount = text.trim().split(/\s+/).length;
      const isPsyche = psychePersonas.includes(effectivePersonaId);
      const isTrivial = isPsyche
        ? (wordCount < 2 && !/[?]/.test(text) && !looksLikeNoteSearch(text))
        : (wordCount < 4 && !/[?]/.test(text) && !looksLikeNoteSearch(text));
      const shouldRunFacets = needsFacets && !isTrivial;

      if (shouldRunFacets) {
        try {
          if (!facetsCacheRef.current.facets) {
            facetsCacheRef.current.facets = await AIProfileFacetService.getAll();
          }
          const facets = facetsCacheRef.current.facets;

          if (facets.length > 0 && hasIndexingConsent(uid)) {
            const searchQuery = explicitSearch ? effectiveQuery : lastSearchQueryRef.current;
            const queryEmbResult = await AIService.embed({ content: searchQuery });
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
                const blocks = matched.map(m => {
                  m.facet.noteIds.forEach(id => facetNoteIds.add(id));
                  const notesMeta = m.facet.noteIds.length > 0 ? ` (заметки: ${m.facet.noteIds.length})` : '';
                  return `Раздел "${m.facet.label}": ${m.facet.summary || 'описание отсутствует'}${notesMeta}`;
                });
                searchContext = `[Профиль пользователя: авто-выделенные темы]\n` + blocks.join('\n');
              }
            }
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] facet augmentation failed' });
        }
      }

      let handledByTemporal = false;
      let skipSemantic = false;
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
            const nameSearchEmb = candidateNames.length > 0 ? (allEmbeddings ?? await AIEmbeddingService.getAll()) : [];
            const nameRegexes = candidateNames.map(name =>
              new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^а-яёА-ЯЁa-zA-Z0-9_]|$)`)
            );
            if (nameRegexes.length > 0) {
              for (const emb of nameSearchEmb) {
                if (nameSearchIds.has(emb.documentId)) continue;
                const texts = emb.chunkTexts ?? [];
                if (texts.some((t: string) => nameRegexes.some(re => re.test(t)))) nameSearchIds.add(emb.documentId);
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
              const doc = await db.get('documents', docId);
              if (!doc || isExcludedFromAI(doc)) continue;
              const content = await LocalVersionService.getLatestContent(docId);
              if (!content) continue;
              allNotes.push({
                documentId: docId,
                title: doc.title || 'Без названия',
                content,
                score: 0,
                lastSessionAt: doc.lastSessionAt,
              });
            }

            const hasChatQuota = useAiLimitStore.getState().remaining > 0;
            const cooldownActive = Number(localStorage.getItem('jw_ai_cooldown_until') || '0') > Date.now();
            if (allNotes.length > 5 && hasChatQuota && !cooldownActive) {
              try {
                const candidates = await Promise.all(allNotes.map(async n => {
                  let cardBody = n.content.slice(0, 400);
                  try {
                    const sum = await db.get('aiSummaries', n.documentId);
                    if (sum?.summary && sum.summary.trim().length >= 80) {
                      cardBody = sum.summary.trim();
                    }
                  } catch { /* use 400-char content fallback */ }
                  return {
                    documentId: n.documentId,
                    card: `${n.title}\n${cardBody}`,
                  };
                }));
                setAIStage('rank');
                const rr = await AIService.rerank({ query: effectiveQuery, candidates, maxResults: 8 });
                if (!rr.ok) {
                  reportAIDegradation({
                    feature: 'chat_rerank',
                    cause: rr.error,
                    action: 'Реранжирование заметок в чате',
                    impact: 'Использован исходный порядок заметок',
                  });
                }
                if (rr.ok && rr.documentIds.length > 0) {
                  const rerankOrder = new Map(rr.documentIds.map((id, i) => [id, i]));
                  allNotes.sort((a, b) => {
                    const ai = rerankOrder.get(a.documentId) ?? 999;
                    const bi = rerankOrder.get(b.documentId) ?? 999;
                    return ai - bi;
                  });
                  allNotes = allNotes.slice(0, 8);
                }
              } catch (e) {
                reportError(e, { action: '[useAIChatContext] rerank failed, keeping original order' });
              }
            }
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
          }

          if (allNotes.length > 0) {
            const existingContextLen = (searchContext ?? '').length;
            const remainingBudget = Math.max(5_000, 48_000 - existingContextLen);
            const BUDGET_CHARS = Math.min(25_000, remainingBudget);
            const now = Date.now();
            const scored = allNotes.map(n => {
              // RRF живёт в шкале ≤~0.05; нормализация — см. vectorScore01 (#104).
              const vs01 = vectorScore01(n.score);
              const keywordScore = Math.min(1, (n.content.match(new RegExp(text.split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'))?.length ?? 0) / 10);
              const ageDays = (now - (n.lastSessionAt ?? now)) / 86_400_000;
              const recencyFactor = Math.exp(-ageDays / 365);
              return {
                note: n,
                compositeScore: 0.5 * vs01 + 0.3 * keywordScore + 0.2 * recencyFactor,
              };
            }).sort((a, b) => b.compositeScore - a.compositeScore);

            const CONTEXT_RADIUS = 500;
            const PER_NOTE_CHARS = 2_000;
            const selectedNotes: Array<{
              note: typeof scored[0]['note'];
              snippet: string;
              summaryPrefix: string;
            }> = [];
            let totalChars = 0;

            for (const { note: n } of scored) {
              if (totalChars >= BUDGET_CHARS) break;
              let snippet: string;
              if (candidateNames.length > 0) {
                const namePositions = candidateNames
                  .map(name => n.content.indexOf(name))
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
                snippet = n.content.length > PER_NOTE_CHARS
                  ? n.content.slice(0, PER_NOTE_CHARS) + '…'
                  : n.content;
              }

              setAIStage('summaries');
              const noteSummary = await db.get('aiSummaries', n.documentId);
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
              `\n\nРезультаты поиска по архиву заметок (запрос: "${text}"). ` +
              `Искал по ВСЕЙ базе: ${corpus.total} заметок, ${corpus.from} — ${corpus.to}. ` +
              `Найдено заметок: ${allNotes.length} (отобрано ${selectedNotes.length} по релевантности). ` +
              `Это наиболее релевантные заметки по запросу. Если ответа в них нет — так и скажи, не домысливай.\n\n` +
              parts.join('\n\n')
            );
            searchContext = (searchContext ?? '') + noteBlock;
          } else if (searchFailed) {
            searchContext = (searchContext ?? '') +
              `\n\n[СИСТЕМНОЕ СООБЩЕНИЕ: Поиск по базе не удался из-за технической ошибки. Сообщи пользователю "Я не смог выполнить поиск по вашим заметкам из-за технической ошибки." и КАТЕГОРИЧЕСКИ не делай выводов о том, есть ли у него такие заметки.]`;
          } else if (!handledByTemporal) {
            // Appended, not assigned: with a note attached this used to be
            // skipped entirely, so a search that ran and found nothing left no
            // trace — and the model fell back to "I have no access to your
            // archive", the exact claim this block exists to prevent.
            const corpus = await getCorpusStats(db);
            searchContext = (searchContext ?? '') +
              `\n\n[Поиск по ВСЕЙ базе (${corpus.total} заметок, ${corpus.from} — ${corpus.to}) по запросу "${text}" ` +
              `не нашёл подходящих заметок. Скажи, что по этому запросу в базе ничего не нашлось (НЕ «нет доступа»), ` +
              `предложи переформулировать. КАТЕГОРИЧЕСКИ не выдумывай содержание его заметок и не приписывай ему того, чего нет.` +
              (semanticIndexMissing
                ? ` ВАЖНО: смысловой индекс заметок сейчас не построен, поэтому искал только по совпадению слов — предупреди об этом и предложи попробовать другие формулировки и точные слова из записей.]`
                : `]`);
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] note formatting/budgeting failed' });
        }
      }

      // Lite retrieval if no full search was performed
      const performedFullSearch = explicitSearch || stickySearch;
      if (!attached && !performedFullSearch && !noteIntentNoText) {
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

      // Crisis resources check
      const isCrisis = detectRisk(riskText);
      if (isCrisis.isRisk) {
        searchContext = searchContext ? `${CRISIS_RESOURCE_TEXT}\n\n${searchContext}` : CRISIS_RESOURCE_TEXT;
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
                doorHint = `\n\nНаблюдение: в записях пользователь чаще опирается на ${doorLabel(doorsResult.dominantDoor)}; ${doorLabel(doorsResult.thinnestDoor)} звучат реже. Если уместно — мягко, гипотезой пригласи заметить ${doorLabel(doorsResult.thinnestDoor)} под ${doorLabel(doorsResult.dominantDoor)}; не дави, дай возможность отказаться.`;
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
    } else {
      searchContext =
        `ВНИМАНИЕ: пользователь просит разобрать заметку, но ЕЁ ТЕКСТ НЕ ПРИЛОЖЕН к этому сообщению и его нет в контексте. ` +
        `У тебя НЕТ текста этой заметки. КАТЕГОРИЧЕСКИ запрещено выдумывать, реконструировать или пересказывать её содержание — ` +
        `даже если кажется, что ты «помнишь» тему. Не сочиняй ни единого предложения «из заметки». ` +
        `Вместо этого коротко и по-доброму скажи, что не видишь текста заметки, и попроси прикрепить её (скрепкой) или вставить текст. Ничего больше не придумывай.`;
    }

    // 3. Proactive recent context and dialogue memory
    const shouldInjectProactive = isFirstTurn && !explicitSearch && !recentContextInjectedRef.current;
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
        attachedDocumentId: params.attached?.documentId ?? null,
        attachedContent: params.attached?.content ?? null,
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

    return {
      userPortrait: effectivePortrait,
      customPersona: customSystemPrompt,
      searchContext: effectiveSearchContext,
      documentMood: mood,
      memoryContext,
      injectedDocumentIds: [...new Set(allInjectedDocIds)],
      allowedFirstSeenDates: [...new Set(allowedFirstSeenDates)],
      degradedReason: degradedDueToDailyLimit ? 'daily_limit' : undefined,
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
