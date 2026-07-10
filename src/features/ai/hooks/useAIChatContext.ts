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
import { parseTemporalQuery } from '../utils/temporalQueryParser';
import { AITimelineService } from '../services/AITimelineService';
import { AIMonthlyDigestService } from '../services/AIMonthlyDigestService';
import { AIPeopleService } from '../services/AIPeopleService';
import { relativeDate } from '../../../core/utils/dateUtils';
import { looksLikeNoteSearch } from '../utils/aiChatTransport';
import { cosineSimilarity, topKMultiWithChunkIndex } from '../utils/vectorSearch';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';

export interface ChatContextResult {
  userPortrait: string | null;
  customPersona: string | undefined; // customSystemPrompt
  searchContext: string | undefined;
  documentMood: string | undefined;
}

export function useAIChatContext(personaId: string): {
  buildContext(params: {
    text: string;
    attached: { content: string; documentId?: string } | null;
    mood: string | undefined;
    messageHistory: AIMessage[];
    isFirstTurn: boolean;
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
  }): Promise<ChatContextResult> => {
    const { text, attached, mood, isFirstTurn } = params;

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
      let allNotes: RetrievedNote[] = [];
      const temporalQuery = parseTemporalQuery(text);

      if (explicitSearch || stickySearch) {
        const db = await getLocalDb();
        const candidateNames = [...new Set([
          ...text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
          ...lastSearchNamesRef.current,
        ])];

        if (temporalQuery.type === 'month') {
          handledByTemporal = true;
          skipSemantic = true;
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
          handledByTemporal = true;
          skipSemantic = true;
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
        } else if (temporalQuery.type === 'person') {
          skipSemantic = true;
          try {
            const matchedPeople = await AIPeopleService.search(temporalQuery.personName!);
            const noteIds = [...new Set(matchedPeople.flatMap(p => p.noteIds))];
            for (const docId of noteIds) {
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

            const notes = await searchNotesMulti(searchQueries, 10, { queryVector: queryEmb, allEmbeddings });
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
              parts.push(`Заметка ${noteIdx}${datePart}: "${n.title}"\n${summaryPrefix}${snippet}`);
              totalChars += snippet.length + summaryPrefix.length;
            }
            const noteBlock = (
              `\n\nРезультаты поиска по архиву заметок (запрос: "${text}"). ` +
              `Найдено заметок: ${allNotes.length} (отобрано ${noteIdx} по релевантности). ` +
              `Это наиболее релевантные заметки по запросу. Если ответа в них нет — так и скажи, не домысливай.\n\n` +
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
            const db = await getLocalDb();
            const results = topKMultiWithChunkIndex(turnEmb, allEmb.map(e => ({ id: e.documentId, vectors: e.vectors })), 3);
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
                parts.push(`Заметка ${idx}${datePart}: "${doc.title || 'Без названия'}"\n${textChunk}`);
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

      try {
        const archived = await AIDialogueService.list({ includeArchived: true });
        const personaArchived = archived.filter(d => d.personaId === personaId && d.archivedAt !== undefined && d.closingSummary !== undefined && d.closingSummary !== '');
        const recentArchived = personaArchived
          .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
          .slice(0, 3);

        if (recentArchived.length > 0) {
          const prevSessionLines = recentArchived.map(d => {
            const dateStr = new Date(d.archivedAt!).toLocaleDateString('ru-RU');
            return `- ${dateStr}: ${d.closingSummary}`;
          }).join('\n');
          const previousContextBlock = `[Предыдущие сессии с этим персонажем]\n${prevSessionLines}`;
          proactiveBlock = proactiveBlock ? `${proactiveBlock}\n\n${previousContextBlock}` : previousContextBlock;
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

    return {
      userPortrait,
      customPersona: customSystemPrompt,
      searchContext,
      documentMood: mood,
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
