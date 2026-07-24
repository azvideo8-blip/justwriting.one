import { useRef } from 'react';
import type { AIMessage } from '../services/AIService';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIProfileService } from '../services/AIProfileService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { searchNotesMulti, type RetrievedNote } from '../utils/noteRetriever';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { AIService } from '../services/AIService';
import { reportError } from '../../../shared/errors/reportError';
import { detectRisk } from '../utils/riskDetect';
import { analyzeDoors, aggregateDoors, doorLabel } from '../utils/contactDoors';
import { parseTemporalQuery, MONTHS_MAP, lemmatizeRussianName, type TemporalQuery } from '../utils/temporalQueryParser';
import { AITimelineService } from '../services/AITimelineService';
import { AIMonthlyDigestService } from '../services/AIMonthlyDigestService';
import { AIPeopleService } from '../services/AIPeopleService';
import { relativeDate } from '../../../core/utils/dateUtils';
import { looksLikeNoteSearch } from '../utils/aiChatTransport';
import { cosineSimilarity, topKMultiWithChunkIndex } from '../utils/vectorSearch';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { AIMemoryAssembler } from '../services/AIMemoryAssembler';

function formatDateYYYYMMDD(timestamp: number | undefined): string {
  if (!timestamp) return 'unknown-date';
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function getDocDate(docId: string): Promise<string> {
  try {
    const db = await getLocalDb();
    const doc = await db.get('documents', docId);
    if (doc?.lastSessionAt) {
      const date = new Date(doc.lastSessionAt);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch { /* ignore */ }
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface ChatContextResult {
  userPortrait: string | null;
  customPersona: string | undefined; // customSystemPrompt
  searchContext: string | undefined;
  documentMood: string | undefined;
  memoryContext?: string | null;
  injectedDocumentIds?: string[];
}


export function useAIChatContext(personaId: string): {
  buildContext(params: {
    text: string;
    attached: { content: string; documentId?: string } | null;
    mood: string | undefined;
    messageHistory: AIMessage[];
    isFirstTurn: boolean;
    dialogueId?: string | null;
  }): Promise<ChatContextResult>;
  resetSession(): void;
  setAttachedNote(note: { content: string; documentId?: string } | null): void;
  getAttachedNote(): { content: string; documentId?: string } | null;
  incrementMessageCount(): void;
  getMessageCount(): number;
} {
  const portraitCacheRef = useRef<string | null | undefined>(undefined);
  const facetsCacheRef = useRef<{ facets: Awaited<ReturnType<typeof AIProfileFacetService.getAll>> | null }>({ facets: null });
  const docsCacheRef = useRef<Map<string, { id: string; title?: string; lastSessionAt?: number; firstSessionAt?: number }> | null>(null);
  const doorsCacheRef = useRef<{ hint: string } | null>(null);
  const messageCountRef = useRef(0);
  const attachedNoteRef = useRef<{ content: string; documentId?: string } | null>(null);
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

  const setAttachedNote = (note: { content: string; documentId?: string } | null) => {
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

  const buildContext = async (params: {
    text: string;
    attached: { content: string; documentId?: string } | null;
    mood: string | undefined;
    messageHistory: AIMessage[];
    isFirstTurn: boolean;
    dialogueId?: string | null;
  }): Promise<ChatContextResult> => {
    const { text, attached, mood, isFirstTurn, dialogueId } = params;
    const injectedDocumentIds: string[] = [];
    const db = await getLocalDb();

    // Scan prompt for Russian proper names and check if they are ignored
    const promptNames = [...new Set(text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [])];
    const ignoredNames = new Set<string>();
    const ignoredDocumentIds = new Set<string>();

    const RUSSIAN_CAPITALIZED_STOP_WORDS = new Set([
      'Я', 'Мы', 'Ты', 'Вы', 'Он', 'Она', 'Оно', 'Они',
      'Как', 'Что', 'Где', 'Когда', 'Почему', 'Зачем', 'Кто', 'Кому', 'Чем',
      'Если', 'Хотя', 'Чтобы', 'Потому', 'Поэтому', 'Зато',
      'Да', 'Нет', 'И', 'А', 'Но', 'Или', 'Даже', 'Лишь', 'Только',
      'Вчера', 'Сегодня', 'Завтра', 'Утром', 'Днем', 'Вечером', 'Ночью',
      'Мой', 'Твой', 'Свой', 'Наш', 'Ваш', 'Этот', 'Тот', 'Весь', 'Все', 'Всё',
      'Надо', 'Хочу', 'Могу', 'Очень', 'Просто', 'Быстро', 'Тоже', 'Так',
      'Там', 'Тут', 'Здесь', 'Где-то', 'Как-то', 'Иногда', 'Часто', 'Редко',
      'Опять', 'Снова', 'Вдруг', 'Сразу', 'Потом', 'Тогда', 'Сейчас', 'Теперь',
      'Было', 'Были', 'Будет', 'Будут', 'Есть', 'Нету', 'Раз', 'Два', 'Три',
      'Привет', 'Пока', 'Спасибо', 'Пожалуйста', 'Здравствуйте', 'Добрый',
    ]);

    for (const name of promptNames) {
      if (RUSSIAN_CAPITALIZED_STOP_WORDS.has(name)) continue;
      const lemmatized = lemmatizeRussianName(name);
      if (!lemmatized || lemmatized.length < 2) continue;
      const key = lemmatized.toLowerCase();
      try {
        const person = await db.get('aiPeopleIndex', key);
        if (person?.status === 'ignored') {
          ignoredNames.add(key);
          if (person.noteIds?.length) {
            person.noteIds.forEach(id => ignoredDocumentIds.add(id));
          }
        }
      } catch { /* ignore */ }
    }

    let turnEmb: number[] | undefined;
    if (text.trim().length > 0) {
      try {
        const res = await AIService.embed({ content: text });
        turnEmb = res.ok && res.vectors[0] ? res.vectors[0] : undefined;
      } catch { /* ignore */ }
    }

    // 1. Fetch portrait and custom persona concurrently
    const isPreset = PRESET_PERSONAS.some(p => p.id === personaId);
    const portraitPromise = portraitCacheRef.current !== undefined
      ? Promise.resolve(portraitCacheRef.current)
      : AIProfileService.getPortrait().then(p => { portraitCacheRef.current = p; return p; });
    const personaPromise = isPreset
      ? Promise.resolve(undefined)
      : AIPersonaService.getCustom(personaId);

    const [userPortrait, customPersonaObj] = await Promise.all([portraitPromise, personaPromise]);

    let customSystemPrompt: string | undefined;
    let effectivePersonaId = personaId;
    if (!isPreset && customPersonaObj) {
      customSystemPrompt = customPersonaObj.systemPrompt;
      effectivePersonaId = 'custom';
    }

    // 2. Hydrate searchContext
    const noteAnalysisIntent = /(заметк|запис|аскез)/i.test(text) && /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i.test(text);
    const noteIntentNoText = !attached?.content && noteAnalysisIntent;
    const explicitSearch = attached ? false : looksLikeNoteSearch(text);

    let searchContext: string | undefined;

    if (attached) {
      if (attached.content.includes('[#')) {
        searchContext = attached.content;
      } else {
        const yyyymmdd = attached.documentId ? (await getDocDate(attached.documentId)) : formatDateYYYYMMDD(Date.now());
        const docId = attached.documentId || 'attached-note';
        searchContext = `[#${docId} · ${yyyymmdd}]\n[Прикрепленная заметка]\n${attached.content}`;
      }
      
      if (attached.documentId) {
        injectedDocumentIds.push(attached.documentId);
      }
      const matches = attached.content.matchAll(/\[#([a-zA-Z0-9_-]+)\]/g);
      for (const m of matches) {
        if (m[1]) injectedDocumentIds.push(m[1]);
      }
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
          let facets = facetsCacheRef.current.facets;
          if (!facets) {
            facets = await AIProfileFacetService.getAll();
            facetsCacheRef.current = { facets };
          }

          if (facets.length > 0) {
            const searchQuery = explicitSearch ? text : lastSearchQueryRef.current;
            const queryEmbResult = await AIService.embed({ content: searchQuery });
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
                  const allowedIds = m.facet.noteIds.filter(id => !ignoredDocumentIds.has(id));
                  allowedIds.forEach(id => facetNoteIds.add(id));
                  const notesMeta = allowedIds.length > 0 ? ` (заметки: ${allowedIds.length})` : '';
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
      let allNotes: RetrievedNote[] = [];

      const isComparison = /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(?:vs|сравни|противо|по сравнению|разниц|отличи)(?![а-яёА-ЯЁa-zA-Z0-9])/i.test(text);
      let comparisonScopes: TemporalQuery[] = [];
      if (isComparison) {
        const monthStems = Object.keys(MONTHS_MAP);
        const foundMonths: { stem: string; index: number; year?: number }[] = [];
        const lowerText = text.toLowerCase();
        const yearMatch = lowerText.match(/(?:^|[^0-9])(202\d)(?![0-9])/);
        const defaultYear = yearMatch ? parseInt(yearMatch[1]!, 10) : new Date().getFullYear();

        monthStems.forEach(stem => {
          let idx = lowerText.indexOf(stem);
          while (idx !== -1) {
            foundMonths.push({ stem, index: idx, year: defaultYear });
            idx = lowerText.indexOf(stem, idx + 1);
          }
        });
        foundMonths.sort((a, b) => a.index - b.index);
        const uniqueMonths = foundMonths.filter((m, i) => i === 0 || m.stem !== foundMonths[i - 1]!.stem);

        if (uniqueMonths.length >= 2) {
          comparisonScopes = uniqueMonths.slice(0, 2).map(m => ({
            type: 'month' as const,
            month: `${m.year}-${MONTHS_MAP[m.stem]!}`,
            rawText: m.stem,
          }));
        } else {
          const seasons = [
            { name: 'зима', months: ['12', '01', '02'] },
            { name: 'зим', months: ['12', '01', '02'] },
            { name: 'весна', months: ['03', '04', '05'] },
            { name: 'весн', months: ['03', '04', '05'] },
            { name: 'лето', months: ['06', '07', '08'] },
            { name: 'летн', months: ['06', '07', '08'] },
            { name: 'осень', months: ['09', '10', '11'] },
            { name: 'осен', months: ['09', '10', '11'] },
          ];
          const foundSeasons: { name: string; index: number; months: string[] }[] = [];
          seasons.forEach(s => {
            let idx = lowerText.indexOf(s.name);
            while (idx !== -1) {
              foundSeasons.push({ name: s.name, index: idx, months: s.months });
              idx = lowerText.indexOf(s.name, idx + 1);
            }
          });
          foundSeasons.sort((a, b) => a.index - b.index);
          const uniqueSeasons = foundSeasons.filter((s, i) => i === 0 || s.name !== foundSeasons[i - 1]!.name);

          if (uniqueSeasons.length >= 2) {
            comparisonScopes = uniqueSeasons.slice(0, 2).map(s => ({
              type: 'dateRange' as const,
              from: `${defaultYear}-${s.months[0]}-01`,
              to: `${defaultYear}-${s.months[2]}-30`,
              rawText: s.name,
            }));
          } else {
            const yearMatches = [...lowerText.matchAll(/(?:^|[^0-9])(202\d)(?![0-9])/g)];
            if (yearMatches.length >= 2) {
              comparisonScopes = yearMatches.slice(0, 2).map(m => ({
                type: 'dateRange' as const,
                from: `${m[1]}-01-01`,
                to: `${m[1]}-12-31`,
                rawText: m[1]!,
              }));
            }
          }
        }
      }

      let temporalQuery = parseTemporalQuery(text);
      if (temporalQuery.type === 'none' && dialogueId) {
        try {
          const dlg = await AIDialogueService.get(dialogueId);
          if (dlg?.temporalScope) {
            temporalQuery = dlg.temporalScope;
          }
        } catch { /* ignore */ }
      }

      let minTime: number | undefined;
      let maxTime: number | undefined;

      if (comparisonScopes.length === 2) {
        const scopeA = comparisonScopes[0]!;
        const scopeB = comparisonScopes[1]!;
        
        const getScopeBlock = async (scope: TemporalQuery, label: string) => {
          let sMin: number | undefined;
          let sMax: number | undefined;
          if (scope.type === 'month') {
            const [yyyy, mm] = scope.month!.split('-');
            const year = parseInt(yyyy!, 10);
            const month = parseInt(mm!, 10) - 1;
            sMin = Date.UTC(year, month, 1);
            sMax = Date.UTC(year, month + 1, 1) - 1;
          } else if (scope.type === 'dateRange') {
            sMin = new Date(scope.from!).getTime();
            sMax = new Date(scope.to!).getTime() + 86_400_000 - 1;
          }

          let digestNarrative = '';
          if (scope.type === 'month') {
            const digest = await AIMonthlyDigestService.get(scope.month!);
            if (digest?.narrative) digestNarrative = `Сводка за месяц: ${digest.narrative}\n`;
          }

          let timelineFacts = '';
          if (scope.type === 'month') {
            const entries = await AITimelineService.getByMonth(scope.month!);
            timelineFacts = entries.flatMap(e => e.facts).join('; ');
          } else if (scope.type === 'dateRange') {
            const entries = await AITimelineService.getByDateRange(scope.from!, scope.to!);
            timelineFacts = entries.flatMap(e => e.facts).join('; ');
          }

          const searchQuery = explicitSearch ? text : `${lastSearchQueryRef.current}\n${text}`;
          const notes = await searchNotesMulti([searchQuery], 5, { minTime: sMin, maxTime: sMax });
          const notesText = notes.map(n => `[#${n.documentId} · ${formatDateYYYYMMDD(n.lastSessionAt)}] Заметка "${n.title}": ${n.content.slice(0, 1000)}`).join('\n\n');

          return `=== ПЕРИОД ${label} (${scope.rawText}) ===\n` +
                 (digestNarrative ? `${digestNarrative}\n` : '') +
                 (timelineFacts ? `События: ${timelineFacts}\n\n` : '') +
                 `Релевантные заметки:\n${notesText || '(нет заметок)'}\n`;
        };

        const blockA = await getScopeBlock(scopeA, 'А');
        const blockB = await getScopeBlock(scopeB, 'Б');

        searchContext = `[РЕЖИМ СРАВНЕНИЯ ПЕРИОДОВ]\nНиже приведены данные для двух сравниваемых периодов. Отвечай на вопросы пользователя, сравнивая их, но не смешивай факты между периодами.\n\n` +
                        `${blockA}\n\n${blockB}`;
        handledByTemporal = true;
        skipSemantic = true;
      } else if (temporalQuery.type === 'month') {
        const [yyyy, mm] = temporalQuery.month!.split('-');
        const year = parseInt(yyyy!, 10);
        const month = parseInt(mm!, 10) - 1;
        minTime = Date.UTC(year, month, 1);
        maxTime = Date.UTC(year, month + 1, 1) - 1;
        handledByTemporal = true;
        try {
          const entries = await AITimelineService.getByMonth(temporalQuery.month!);
          const factsStr = entries.flatMap(e => {
            const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
            return e.facts.map(f => `${dateLabel} ${f}`);
          }).join('; ');
          const digest = await AIMonthlyDigestService.get(temporalQuery.month!);
          const narrative = digest?.narrative ? `${digest.narrative}\n\n` : '';
          const textBlock = `${narrative}В ${temporalQuery.month}: ${factsStr || 'записи отсутствуют'}. Было ${entries.length} заметок.`;
          searchContext = (searchContext ?? '') + `\n\n[Результаты поиска по хронологии]\n${textBlock}`;
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] temporal query month failed' });
        }
      } else if (temporalQuery.type === 'dateRange') {
        minTime = new Date(temporalQuery.from!).getTime();
        maxTime = new Date(temporalQuery.to!).getTime() + 86_400_000 - 1;
        handledByTemporal = true;
        try {
          const entries = await AITimelineService.getByDateRange(temporalQuery.from!, temporalQuery.to!);
          const factsStr = entries.flatMap(e => {
            const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
            return e.facts.map(f => `${dateLabel} ${f}`);
          }).join('; ');
          const textBlock = `В период с ${temporalQuery.from} по ${temporalQuery.to}: ${factsStr || 'записи отсутствуют'}. Было ${entries.length} заметок.`;
          searchContext = (searchContext ?? '') + `\n\n[Результаты поиска по хронологии]\n${textBlock}`;
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] temporal query dateRange failed' });
        }
      } else if (temporalQuery.type === 'recent') {
        handledByTemporal = true;
        skipSemantic = true;
        try {
          const digests = await AIMonthlyDigestService.getRecent(3);
          const timelines = await AITimelineService.getMostRecent(10);
          const sortedDigests = [...digests].reverse();
          const digestLines = sortedDigests.map(d => `${d.month}: ${d.narrative}`).join('\n');
          const eventLines = timelines.flatMap(e => {
            const dateLabel = e.date ? `[${relativeDate(new Date(e.date).getTime())}]` : '';
            return e.facts.map(f => `- ${dateLabel}: ${f}`);
          }).join('\n');
          const catchUpBlock = `За последние месяцы:\n${digestLines || 'Нет обзоров.'}\n\nПоследние события:\n${eventLines || 'Нет зафиксированных событий.'}`;
          searchContext = (searchContext ?? '') + `\n\n[Хронологическая сводка]\n${catchUpBlock}`;
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] temporal query recent failed' });
        }
      }

      if (minTime && maxTime) {
        try {
          const db = await getLocalDb();
          const docs = await db.getAll('documents');
          let noteCountForPeriod = 0;
          for (const doc of docs) {
            const ts = doc.lastSessionAt;
            if (ts && ts >= minTime && ts <= maxTime) {
              noteCountForPeriod++;
            }
          }
          if (noteCountForPeriod <= 2) {
            searchContext = (searchContext ?? '') + `\n\n[СИСТЕМНОЕ ПРЕДУПРЕЖДЕНИЕ: За выбранный период найдено мало записей (${noteCountForPeriod}). Обязательно честно скажи об этом пользователю ("за этот период мало записей — ...") вместо того, чтобы придумывать или обобщать.]`;
          }
        } catch { /* ignore */ }
      }

      if (explicitSearch || stickySearch) {
        const db = await getLocalDb();
        const candidateNames = [...new Set([
          ...text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
          ...lastSearchNamesRef.current,
        ])];

        if (temporalQuery.type === 'person') {
          skipSemantic = true;
          try {
            const matchedPeople = await AIPeopleService.search(temporalQuery.personName!);
            const noteIds = [...new Set(matchedPeople.flatMap(p => p.noteIds))];
            for (const docId of noteIds) {
              if (ignoredDocumentIds.has(docId)) continue;
              const doc = await db.get('documents', docId);
              if (!doc) continue;
              const content = await LocalVersionService.getLatestContent(docId);
              if (!content) continue;
              allNotes.push({
                documentId: docId,
                title: doc.title || 'Без названия',
                content,
                score: 1.0,
                lastSessionAt: doc.lastSessionAt,
              });
            }
          } catch (e) {
            reportError(e, { action: '[useAIChatContext] temporal query person failed' });
          }
        }

        if (!skipSemantic) {
          const searchQuery = explicitSearch ? text : `${lastSearchQueryRef.current}\n${text}`;
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
                }
              } catch { /* fallback */ }
            }

            if (queryEmb === undefined) {
              const queryEmbResult = await AIService.embed({ content: searchQuery });
              queryEmb = queryEmbResult.ok && queryEmbResult.vectors[0] ? queryEmbResult.vectors[0] : undefined;
            }

            if (allEmbeddings === undefined) {
              allEmbeddings = await AIEmbeddingService.getAll();
            }

            const notes = await searchNotesMulti(searchQueries, 10, { queryVector: queryEmb, allEmbeddings, minTime, maxTime, ignoredDocIds: ignoredDocumentIds });
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
              if (!doc) continue;
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

            if (allNotes.length > 5) {
              try {
                const candidates = allNotes.map(n => ({
                  documentId: n.documentId,
                  card: `${n.title}\n${n.content.slice(0, 400)}`,
                }));
                const rr = await AIService.rerank({ query: text, candidates, maxResults: 8 });
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
            reportError(e, { action: '[useAIChatContext] note search failed' });
          }
        }

        try {
          if (allNotes.length > 0) {
            const BUDGET_CHARS = 25_000;
            const now = Date.now();
            const scored = allNotes.map(n => {
              const vectorScore = Math.max(0, n.score);
              const keywordScore = Math.min(1, (n.content.match(new RegExp(text.split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'))?.length ?? 0) / 10);
              const ageDays = (now - (n.lastSessionAt ?? now)) / 86_400_000;
              const recencyFactor = Math.exp(-ageDays / 365);
              return {
                note: n,
                compositeScore: 0.5 * vectorScore + 0.3 * keywordScore + 0.2 * recencyFactor,
              };
            }).sort((a, b) => b.compositeScore - a.compositeScore);

            const orderedForPlacement = [...scored].reverse();
            const CONTEXT_RADIUS = 500;
            const PER_NOTE_CHARS = 2_000;
            const parts: string[] = [];
            let totalChars = 0;
            let noteIdx = 0;

            for (const { note: n } of orderedForPlacement) {
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
              noteIdx++;
              const noteSummary = await db.get('aiSummaries', n.documentId);
              const summaryPrefix = noteSummary?.summary ? `[Суть: ${noteSummary.summary}]\n` : '';
              
              const dateLabel = n.lastSessionAt ? relativeDate(n.lastSessionAt) : '';
              const datePart = dateLabel ? ` (${dateLabel})` : '';
              const yyyymmdd = formatDateYYYYMMDD(n.lastSessionAt);
              injectedDocumentIds.push(n.documentId);
              parts.push(`[#${n.documentId} · ${yyyymmdd}]\nЗаметка ${noteIdx}${datePart}: "${n.title}"\n${summaryPrefix}${snippet}`);
              totalChars += snippet.length + summaryPrefix.length;
            }
            const noteBlock = (
              `\n\nРезультаты поиска по архиву заметок (запрос: "${text}"). ` +
              `Найдено заметок: ${allNotes.length} (отобрано ${noteIdx} по релевантности). ` +
              `Это наиболее релевантные заметки по запросу. Если ответа в них нет — так и скажи, не домысливай. ` +
              `При ссылке на заметку ОБЯЗАТЕЛЬНО используй синтаксис [#id] (например, [#${allNotes[0]?.documentId || 'local_123'}]).\n\n` +
              parts.join('\n\n')
            );
            searchContext = (searchContext ?? '') + noteBlock;
          } else if (!searchContext && !handledByTemporal) {
            searchContext =
              `Автоматический поиск по архиву заметок пользователя по запросу "${text}" не нашёл заметок. ` +
              `КАТЕГОРИЧЕСКИ не выдумывай содержание его заметок и не приписывай ему того, чего нет.`;
          }
        } catch (e) {
          reportError(e, { action: '[useAIChatContext] note formatting/budgeting failed' });
        }
      }

      // Lite retrieval if no full search was performed
      const performedFullSearch = explicitSearch || stickySearch;
      if (!attached && !performedFullSearch && !noteIntentNoText) {
        if (turnEmb) {
          try {
            const allEmb = await AIEmbeddingService.getAll();
            let filteredEmb = allEmb;
            if (minTime !== undefined || maxTime !== undefined || ignoredDocumentIds.size > 0) {
              const allowed = new Set<string>();
              const docs = await db.getAll('documents');
              for (const doc of docs) {
                if (ignoredDocumentIds.has(doc.id)) continue;
                const ts = doc.lastSessionAt;
                if (ts && (minTime === undefined || ts >= minTime) && (maxTime === undefined || ts <= maxTime)) {
                  allowed.add(doc.id);
                }
              }
              filteredEmb = allEmb.filter(e => allowed.has(e.documentId));
            }
            const results = topKMultiWithChunkIndex(turnEmb, filteredEmb.map(e => ({ id: e.documentId, vectors: e.vectors })), 3);
            if (results.length > 0) {
              const parts = [];
              let idx = 0;
              for (const r of results) {
                const doc = await db.get('documents', r.id);
                if (!doc) continue;
                const emb = allEmb.find(e => e.documentId === r.id);
                const textChunk = emb?.chunkTexts?.[r.chunkIndex] || '';
                if (!textChunk.trim()) continue;
                idx++;
                const dateLabel = doc.lastSessionAt ? relativeDate(doc.lastSessionAt) : '';
                const datePart = dateLabel ? ` (${dateLabel})` : '';
                const yyyymmdd = formatDateYYYYMMDD(doc.lastSessionAt);
                injectedDocumentIds.push(r.id);
                parts.push(`[#${doc.id} · ${yyyymmdd}]\nЗаметка ${idx}${datePart}: "${doc.title || 'Без названия'}"\n${textChunk}`);
              }
              if (parts.length > 0) {
                const liteBlock = `[Возможно релевантные заметки]\n` + parts.join('\n\n');
                searchContext = searchContext ? `${searchContext}\n\n${liteBlock}` : liteBlock;
              }
            }
          } catch (e) {
            reportError(e, { action: '[useAIChatContext] lite retrieval failed' });
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

      // Crisis resources check
      const isCrisis = detectRisk(text);
      if (isCrisis.isRisk) {
        const crisisResourceText =
          `Пользователь находится в кризисном состоянии. Интегрируй в свой ответ контакты служб поддержки:\n` +
          `Единый телефон доверия: 8-800-333-44-34, горячая линия психологической помощи: 051 (с городского) или +7 (495) 051.\n` +
          `Отвечай тепло, эмпатично, не давай советов, поддерживай.`;
        searchContext = searchContext ? `${crisisResourceText}\n\n${searchContext}` : crisisResourceText;
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
              const db = await getLocalDb();
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
      let proactiveBlock = '';
      try {
        const recentDigests = await AIMonthlyDigestService.getRecent(2);
        const db = await getLocalDb();
        const docs = await db.getAllFromIndex('documents', 'by-lastSession');
        const sortedDocs = [...docs].sort((a, b) => (b.lastSessionAt ?? 0) - (a.lastSessionAt ?? 0));

        const recentDocSummaries: string[] = [];
        for (const doc of sortedDocs.slice(0, 3)) {
          const summary = await db.get('aiSummaries', doc.id);
          if (summary) {
            const summaryText = summary.summary || summary.tone;
            if (summaryText) {
              recentDocSummaries.push(`- «${doc.title || 'Без названия'}»: ${summaryText}`);
            }
          }
        }

        let recentBlock = '';
        const digestsPart = recentDigests.map(d => d.narrative).join('\n\n');
        const notesPart = recentDocSummaries.length > 0
          ? `\n\nПоследние заметки:\n${recentDocSummaries.join('\n')}`
          : '';
        if (digestsPart || notesPart) {
          recentBlock = `[Что ты писал недавно]\n${digestsPart}${notesPart}`;
        }

        const isPsychPersona = ['cbt', 'group_psychology'].includes(personaId);
        if (isPsychPersona) {
          const moodTrend = await AITimelineService.getMoodTrend(3);
          if (moodTrend.length > 0) {
            const monthNamesRu = [
              'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
              'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
            ];
            const trendStr = moodTrend.map(t => {
              const parts = t.month.split('-');
              const monthIdx = parseInt(parts[1] ?? '1', 10) - 1;
              const monthName = monthNamesRu[monthIdx] ?? t.month;
              return `${monthName} — ${t.dominantTone}`;
            }).join(', ');

            recentBlock += `\n\nДинамика настроения: ${trendStr}.`;
          }
        }

        if (recentBlock) {
          proactiveBlock = recentBlock.slice(0, 2000);
        }
      } catch (e) {
        reportError(e, { action: '[useAIChatContext] proactive context failed' });
      }

      const shownIds = new Set<string>();
      try {
        const archived = await AIDialogueService.list({ includeArchived: true });
        const personaArchived = archived.filter(d => d.personaId === personaId && d.archivedAt !== undefined && d.closingSummary !== undefined && d.closingSummary !== '');
        const recentArchived = personaArchived
          .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
          .slice(0, 3);

        if (recentArchived.length > 0) {
          recentArchived.forEach(d => shownIds.add(d.id));
          const prevSessionLines = recentArchived.map(d => {
            const dateStr = new Date(d.archivedAt!).toLocaleDateString('ru-RU');
            return `- ${dateStr}: ${d.closingSummary}`;
          }).join('\n');
          const previousContextBlock = `[Предыдущие сессии с этим персонажем]\n${prevSessionLines}`;
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${previousContextBlock}` : previousContextBlock;
        }
      } catch (e) {
        reportError(e, { action: '[useAIChatContext] same persona dialogue memory context failed' });
      }

      try {
        const db = await getLocalDb();
        const allEvents = await db.getAll('aiDialogueEvents');
        const otherEvents = allEvents
          .filter(e => !shownIds.has(e.dialogueId))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5);

        if (otherEvents.length > 0) {
          const crossSessionLines = otherEvents.map(e => {
            let dateStr = e.date;
            try {
              const dObj = new Date(e.date);
              if (!isNaN(dObj.getTime())) {
                dateStr = dObj.toLocaleDateString('ru-RU');
              }
            } catch { /* ignore */ }
            return `- ${dateStr} (${e.personaName}): ${e.summary}`;
          }).join('\n');
          const crossContextBlock = `[Выводы прошлых разговоров]\n${crossSessionLines}`;
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${crossContextBlock}` : crossContextBlock;
        }
      } catch (e) {
        reportError(e, { action: '[useAIChatContext] cross dialogue memory context failed' });
      }

      try {
        const db = await getLocalDb();
        const timeline = await db.getAll('aiTimeline');
        
        // Trends
        const { computeTrends, formatTrendsBlock } = await import('../utils/contextTrends');
        const trends = computeTrends(timeline);
        const trendsBlock = formatTrendsBlock(trends);
        if (trendsBlock) {
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${trendsBlock}` : trendsBlock;
        }

        // Contradictions
        const { detectContradictions, formatContradictions } = await import('../utils/contradictionDetect');
        const contradictions = detectContradictions(timeline);
        if (contradictions.length > 0) {
          const contraBlock = formatContradictions(contradictions);
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${contraBlock}` : contraBlock;
        }

        // Commitments
        const { AICommitmentService } = await import('../services/AICommitmentService');
        const openCommitments = await AICommitmentService.getOpenCommitments();
        if (openCommitments.length > 0) {
          const commitmentsLines = openCommitments.map(c => `- «${c.text}» (создано: ${relativeDate(c.createdAt)})`).join('\n');
          const commitmentsBlock = `[Твои открытые планы / обязательства]\n${commitmentsLines}`;
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${commitmentsBlock}` : commitmentsBlock;
        }

        // Narrative threads
        if (turnEmb) {
          const { AIThreadService } = await import('../services/AIThreadService');
          const relevantThreads = await AIThreadService.getRelevant(turnEmb, 2);
          if (relevantThreads.length > 0) {
            const threadLines = relevantThreads.map(t => `- [Сюжетная линия, активность ${t.ageDays} дней назад]: ${t.summary}`).join('\n');
            const threadBlock = `[Связанные сюжетные линии]\n${threadLines}`;
            proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${threadBlock}` : threadBlock;
          }
        }
      } catch (e) {
        reportError(e, { action: '[useAIChatContext] proactive advanced context failed' });
      }

      if (proactiveBlock) {
        searchContext = searchContext ? `${proactiveBlock}\n\n${searchContext}` : proactiveBlock;
        recentContextInjectedRef.current = true;
      }
    }

    let memoryContext: string | null = null;
    try {
      memoryContext = await AIMemoryAssembler.assembleMemoryContext({
        attachedDocumentId: params.attached?.documentId ?? null,
        attachedContent: params.attached?.content ?? null,
      });
    } catch {
      /* ignore assembler errors */
    }


    return {
      userPortrait,
      customPersona: customSystemPrompt,
      searchContext,
      documentMood: mood,
      memoryContext,
      injectedDocumentIds: [...new Set(injectedDocumentIds)],
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
