import { useState, useCallback, useEffect, useRef } from 'react';
import type { AIDialogue } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS, AIPersonaService } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { incrementDailyUsage, setDailyLimitExhausted } from './useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { getAuth } from 'firebase/auth';
import { getLocalDb } from '../../../core/storage/localDb';
import type { AIMessage } from '../services/AIService';
import { AIService } from '../services/AIService';
import { AIProfileService } from '../services/AIProfileService';
import { AISummaryService } from '../services/AISummaryService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { searchNotes } from '../utils/noteRetriever';

let _streamAvailable: boolean | null = null;
const MAX_ATTACHMENT_CHARS = 9_500;
const CONTEXT_WINDOW = 14;

// Detect "search my notes" intent. Regex-based (not a fixed phrase list) so
// follow-ups like "а где про Сашу пишу?" also trigger. Avoids the imperative
// "напиши …" (write-for-me) by requiring a word boundary before пиш/писа.
const NOTE_SEARCH_PATTERNS: RegExp[] = [
  /заметк|\bзапис|дневник/i,
  /что годится в пост/i,
  /\b(найди|найти|поищи|поиск|ищу|напомни|вспомни|посмотри|посмотреть|проверь|перепроверь|глянь|собери|подбери|покажи)\b/i,
  // question word + writing/telling verb: "где про Сашу пишу", "о чём я писал"
  /(что|где|когда|о\s*ч[её]м|про\s+ко|про\s+что|сколько|как часто).{0,40}\b(пиш|писа|говорил|упомина|вспомина|расска|отмеча)/i,
  // "… про X пишу/писал"
  /\b(пиш[уеёя]|писа[лнв])\b.{0,30}\bпро\b/i,
  /что (я )?(обычно |часто |вообще )?(про|о)\b/i,
  /что у меня про|что есть про/i,
];

function looksLikeNoteSearch(text: string): boolean {
  return NOTE_SEARCH_PATTERNS.some(re => re.test(text));
}

function pruneMessages(messages: AIMessage[]): AIMessage[] {
  const chatOnly = messages.filter(m => m.type !== 'system');
  if (chatOnly.length <= CONTEXT_WINDOW) return chatOnly;
  const first = chatOnly[0];
  if (!first) return chatOnly;
  const rest = chatOnly.slice(-CONTEXT_WINDOW);
  if (first === rest[0]) return rest;
  return [first, ...rest];
}

async function streamChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  documentMood?: string | undefined;
  userPortrait?: string | null | undefined;
  onChunk: (partial: string) => void;
}): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const idToken = await user.getIdToken();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      personaId: params.personaId,
      customSystemPrompt: params.customSystemPrompt,
      messages: params.messages.map(({ role, content }) => ({ role, content })),
      documentContent: params.documentContent,
      documentMood: params.documentMood,
      userPortrait: params.userPortrait,
    }),
  });

  if (response.status === 404) {
    _streamAvailable = false;
    throw new Error('STREAM_FALLBACK');
  }

  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  if (response.status === 429) throw new Error('DAILY_LIMIT');
  if (!response.ok) throw new Error('SERVER_ERROR');

  _streamAvailable = true;

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      fullText += text;
      params.onChunk(fullText);
    }
  }

  return fullText;
}

async function callableChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  userPortrait?: string | null | undefined;
}): Promise<string> {
  const result = await AIService.chat({
    personaId: params.personaId,
    customSystemPrompt: params.customSystemPrompt,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
    documentContent: params.documentContent,
    userPortrait: params.userPortrait,
  });

  if (!result.ok) {
    if (result.error === 'DAILY_LIMIT') throw new Error('DAILY_LIMIT');
    if (result.error === 'AUTH_REQUIRED') throw new Error('AUTH_REQUIRED');
    if (result.error === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
    throw new Error('SERVER_ERROR');
  }

  return result.text;
}

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  attachDocument: (documentId: string) => Promise<void>;
  clearError: () => void;
}

export function useAIChat(dialogueId: string | null, personaId: string): UseAIChatReturn {
  const [dialogue, setDialogue] = useState<AIDialogue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sticky note-search: once a search happens, keep retrieving for the next few
  // follow-up turns (e.g. "посмотри в этих", "собери", "а почему") even if they
  // don't match a trigger, reusing the last real query so the topic carries.
  const stickyTurnsRef = useRef(0);
  const lastSearchQueryRef = useRef('');
  const lastSearchNamesRef = useRef<string[]>([]);

  useEffect(() => {
    stickyTurnsRef.current = 0;
    lastSearchQueryRef.current = '';
    lastSearchNamesRef.current = [];
  }, [dialogueId]);

  useEffect(() => {
    if (!dialogueId) { setDialogue(null); return; }
    void AIDialogueService.get(dialogueId).then(d => setDialogue(d ?? null));
  }, [dialogueId]);

  useEffect(() => {
    if (!dialogueId || !personaId || !dialogue) return;
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

      const db = await getLocalDb();
      if (!active) return;
      const existing = await db.get('aiDialogues', dialogueId);
      if (!active || !existing) return;

      existing.personaId = personaId;
      existing.personaName = newPersonaName;
      existing.personaEmoji = newPersonaEmoji;
      existing.messages.push({
        role: 'assistant',
        content: `⚙️ [Смена персоны]: Теперь с вами общается ${newPersonaName}`,
        type: 'system',
      });
      existing.updatedAt = Date.now();
      await db.put('aiDialogues', existing);
      if (active) setDialogue({ ...existing });
    })();

    return () => { active = false; };
  }, [dialogueId, personaId, dialogue]);

  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const { remaining } = useAiLimitStore.getState();
    if (remaining <= 0) {
      setDailyLimitExhausted();
      setError('Дневной лимит достигнут');
      return;
    }

    setIsLoading(true);
    setStreamingMessage('');
    setError(null);

    // Build API messages from the ORIGINAL dialogue before the optimistic update.
    // Using optimisticDialogue here would duplicate the user message because
    // optimisticDialogue.messages already contains it after the update below.
    const allMessages: AIMessage[] = dialogue
      ? [...dialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }]
      : [{ role: 'user' as const, content: text, type: 'chat' as const }];

    let optimisticDialogue = dialogue;
    if (optimisticDialogue) {
      const optimistic = { ...optimisticDialogue, messages: [...optimisticDialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }] };
      setDialogue(optimistic);
      optimisticDialogue = optimistic;
    }

    try {

      const apiMessages = pruneMessages(allMessages.filter(m => m.type !== 'system'));

      let effectivePersonaId = personaId;
      let customSystemPrompt: string | undefined;
      let personaName = 'Custom';
      let personaEmoji = '\u{1F916}';

      const isPreset = PRESET_PERSONAS.some(p => p.id === personaId);
      if (!isPreset) {
        const customPersona = await AIPersonaService.getCustom(personaId);
        if (customPersona) {
          customSystemPrompt = customPersona.systemPrompt;
          personaName = customPersona.name;
          personaEmoji = customPersona.emoji;
          effectivePersonaId = 'custom';
        }
      } else {
        const preset = PRESET_PERSONAS.find(p => p.id === personaId);
        personaName = preset?.name ?? personaId;
        personaEmoji = preset?.emoji ?? '\u{1F916}';
      }

      const userPortrait = await AIProfileService.getPortrait();

      // Note-search context goes through documentContent (backend cap 50K), NOT
      // appended to the message — a chat message is capped at 10K chars, and
      // full notes blow past it (that returned 400 Bad Request from /api/chat).
      let searchContext: string | undefined;

      // Explicit trigger, or sticky follow-up within an ongoing notes conversation.
      const explicitSearch = looksLikeNoteSearch(text);
      const stickySearch = !explicitSearch && stickyTurnsRef.current > 0 && lastSearchQueryRef.current.length > 0;
      if (explicitSearch) {
        stickyTurnsRef.current = 4;
        lastSearchQueryRef.current = text;
        lastSearchNamesRef.current = [...new Set(text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [])];
      } else if (stickySearch) {
        stickyTurnsRef.current -= 1;
      }

      // PROF-6: augment context with relevant profile facets.
      // Always include for psychology/cbt/coach personas; for others only on search.
      const psychePersonas = ['group_psychology', 'cbt', 'coach'];
      const needsFacets = explicitSearch || stickySearch || psychePersonas.includes(effectivePersonaId);
      const facetNoteIds = new Set<string>();

      if (needsFacets) {
        try {
          const facets = await AIProfileFacetService.getAll();
          if (facets.length > 0) {
            const embedQuery = explicitSearch || stickySearch
              ? (explicitSearch ? text : `${lastSearchQueryRef.current}\n${text}`)
              : text;
            const queryEmb = await AIService.embed({ content: embedQuery });
            const qv = queryEmb.ok && queryEmb.vectors[0] ? queryEmb.vectors[0] : null;

            const queryLower = text.toLowerCase();
            const queryWords = queryLower.match(/[а-яё]{3,}/gi) ?? [];
            const queryNames = [...new Set([
              ...text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
              ...lastSearchNamesRef.current,
            ])];
            const nameLower = queryNames.map(n => n.toLowerCase());

            const relevant = facets
              .map(f => {
                let sim = qv ? cosineSimilarity(qv, f.centroid) : 0;
                // Keyword name-match boost: if the query contains words that appear
                // in this facet's label or summary, boost similarity so name-based
                // queries ("про Сашу") find the partner facet.
                if (queryWords.length > 0 && f.noteIds.length > 0) {
                  const labelLower = f.label.toLowerCase();
                  const summaryLower = f.summary.toLowerCase();
                  const labelHit = queryWords.some(w => labelLower.includes(w) && w.length >= 3);
                  const summaryHit = queryWords.some(w => summaryLower.includes(w) && w.length >= 3);
                  if (labelHit) sim = Math.max(sim, 0.60);
                  else if (summaryHit) sim = Math.max(sim, 0.55);
                }
                // Proper-name boost: if the query contains a capitalized name
                // and this facet's note texts mention that name, strong boost.
                if (nameLower.length > 0 && f.noteIds.length > 0) {
                  const allLower = `${f.label} ${f.summary}`.toLowerCase();
                  if (nameLower.some(n => allLower.includes(n))) sim = Math.max(sim, 0.60);
                }
                return { f, sim };
              })
              .filter(({ sim }) => sim >= 0.35)
              .sort((a, b) => b.sim - a.sim)
              .slice(0, 5);

            if (relevant.length > 0) {
              const db = await getLocalDb();
              const docs = await db.getAll('documents');
              const docMap = new Map(docs.map(d => [d.id, d]));

              const facetLines = relevant.map(({ f }) => {
                // Collect note IDs from relevant facets for supplemental note loading
                for (const id of f.noteIds) facetNoteIds.add(id);

                const noteTitles = f.noteIds
                  .slice(0, 12)
                  .map(id => docMap.get(id)?.title)
                  .filter(Boolean)
                  .map(t => `  · ${t}`)
                  .join('\n');
                return `— ${f.label} (${f.noteCount} заметок):\n${f.summary}${noteTitles ? `\nЗаметки по теме:\n${noteTitles}` : ''}`;
              }).join('\n\n');
              const facetBlock = `Темы профиля пользователя (обобщены ИИ по всем его заметкам, это достоверный источник):\n${facetLines}\n\nОпирайся на эти темы и на заметки ниже при ответе. Темы профиля — этоsummary заметок пользователя, их можно цитировать и ссылаться на них.`;

              searchContext = facetBlock;
            }
          }
        } catch (e) {
          console.warn('[useAIChat] facet augmentation failed:', e);
        }
      }

      if (explicitSearch || stickySearch) {
        // On sticky turns reuse the last real query so a terse follow-up
        // ("собери", "а ещё") still retrieves the same topic.
        const searchQuery = explicitSearch ? text : `${lastSearchQueryRef.current}\n${text}`;
        try {
          const notes = await searchNotes(searchQuery, 10);

          // Text-based name search: vector embeddings are bad at proper-name
          // retrieval ("Даша" won't match chunks that mention her briefly).
          // Extract candidate names from current text + carry forward from the
          // original query on sticky turns ("а ещё про неё?" has no names).
          const candidateNames = [...new Set([
            ...text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
            ...lastSearchNamesRef.current,
          ])];
          const nameSearchIds = new Set<string>();
          if (candidateNames.length > 0) {
            const allEmb = await AIEmbeddingService.getAll();
            for (const name of candidateNames) {
              const nameRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
              for (const emb of allEmb) {
                if (nameSearchIds.has(emb.documentId)) continue;
                const texts = emb.chunkTexts ?? [];
                if (texts.some(t => nameRe.test(t))) nameSearchIds.add(emb.documentId);
              }
            }
          }

          // Combine: vector search results + facet notes + name-search notes
          const foundIds = new Set(notes.map(n => n.documentId));
          // Also add facet notes where the queried name appears in chunk texts
          if (candidateNames.length > 0 && facetNoteIds.size > 0) {
            const allEmb = await AIEmbeddingService.getAll();
            for (const name of candidateNames) {
              const nameRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
              for (const emb of allEmb) {
                if (!facetNoteIds.has(emb.documentId)) continue;
                if (foundIds.has(emb.documentId) || nameSearchIds.has(emb.documentId)) continue;
                const texts = emb.chunkTexts ?? [];
                if (texts.some(t => nameRe.test(t))) nameSearchIds.add(emb.documentId);
              }
            }
          }
          const extraIds: string[] = [];
          for (const id of facetNoteIds) {
            if (!foundIds.has(id) && !nameSearchIds.has(id) && extraIds.length < 10) extraIds.push(id);
          }
          const nameIds = [...nameSearchIds].filter(id => !foundIds.has(id) && !extraIds.includes(id)).slice(0, 15);
          const allNotes = notes.length > 0 ? [...notes] : [];

          const db = await getLocalDb();
          for (const docId of [...extraIds, ...nameIds]) {
            const doc = await db.get('documents', docId);
            if (!doc) continue;
            const versions = await db.getAllFromIndex('versions', 'by-document', docId);
            if (versions.length === 0) continue;
            versions.sort((a, b) => b.version - a.version);
            allNotes.push({
              documentId: docId,
              title: doc.title || 'Без названия',
              content: versions[0]?.content ?? '',
              score: 0,
            });
          }

          if (allNotes.length > 0) {
            // For name-based queries, extract fragments around the name instead
            // of truncating from the start — the name may appear deep in the note.
            const CONTEXT_RADIUS = 500;
            const PER_NOTE_CHARS = 2_000;
            const parts = allNotes.slice(0, 25).map((n, i) => {
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
              return `Заметка ${i + 1}: "${n.title}"\n${snippet}`;
            });
            const noteBlock = (
              `\n\nРезультаты поиска по архиву заметок (запрос: "${text}"). ` +
              `Найдено заметок: ${allNotes.length} (показаны первые ${Math.min(allNotes.length, 25)}). ` +
              `В этих заметках точно содержится ответ на вопрос пользователя — прочитай их внимательно.\n\n` +
              parts.join('\n\n')
            ).slice(0, 40_000);
            searchContext = (searchContext ?? '').slice(0, 5_000) + noteBlock;
          } else if (!searchContext) {
            searchContext =
              `Автоматический поиск по архиву заметок пользователя по запросу "${text}" не нашёл заметок. ` +
              `КАТЕГОРИЧЕСКИ не выдумывай содержание его заметок и не приписывай ему того, чего нет.`;
          }
        } catch (e) {
          console.warn('[useAIChat] note search failed:', e);
          if (!searchContext) {
            searchContext =
              `Поиск по архиву заметок пользователя по запросу "${text}" временно не сработал. ` +
              `Не выдумывай содержание его заметок.`;
          }
        }
      }

      let fullText: string;

      if (_streamAvailable === false) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: apiMessages,
            documentContent: searchContext,
            userPortrait,
            onChunk: (partial) => setStreamingMessage(partial),
          });
        } catch (e: unknown) {
          console.warn('Streaming chat failed, falling back to callable chat:', e);
          const errMsg = e instanceof Error ? e.message : '';
          if (errMsg !== 'DAILY_LIMIT' && errMsg !== 'AUTH_REQUIRED') {
            fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait });
          } else {
            throw e;
          }
        }
      }

      // An empty stream (e.g. the model errored mid-stream on a quota/spend cap)
      // resolves without throwing — surface it as an error instead of saving a
      // blank assistant bubble.
      if (!fullText || !fullText.trim()) {
        throw new Error('EMPTY_RESPONSE');
      }

      incrementDailyUsage();

      let currentDialogue = dialogue;
      if (!currentDialogue) {
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title,
          personaId,
          personaName,
          personaEmoji,
          messages: [],
        });
      }

      await AIDialogueService.appendMessage(currentDialogue.id, text, fullText);
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);
      setStreamingMessage(null);
    } catch (e: unknown) {
      setStreamingMessage(null);
      const db = await getLocalDb();
      const fresh = dialogueId ? await db.get('aiDialogues', dialogueId) : null;
      setDialogue(fresh ?? dialogue);
      const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
      if (msg === 'DAILY_LIMIT') { setDailyLimitExhausted(); setError('Дневной лимит достигнут'); }
      else if (msg === 'AUTH_REQUIRED') setError('Требуется регистрация');
      else if (msg === 'EMPTY_RESPONSE') setError('ИИ не ответил — сервис временно недоступен (возможно, исчерпан лимит). Попробуйте позже.');
      else setError('Произошла ошибка при отправке сообщения');
    } finally {
      setIsLoading(false);
    }
  }, [dialogue, dialogueId, personaId]);

  const attachDocument = useCallback(async (documentId: string) => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return;
      const db = await getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
      if (versions.length === 0) return;
      versions.sort((a, b) => b.version - a.version);
      const firstVersion = versions[0];
      if (!firstVersion) return;
      const content = firstVersion.content;
      const title = doc.title || 'Без названия';

      if (content.length > MAX_ATTACHMENT_CHARS) {
        const summary = await AISummaryService.get(documentId);
        if (summary) {
          const compressed = `Тональность: ${summary.tone}\nТемы: ${summary.themes.join(', ')}\nИнсайты: ${summary.insights.join('; ')}\nФакты: ${summary.extractedFacts.join('; ')}`;
          const formattedMessage = `[Прикреплено саммари заметки: "${title}"]\n\n[Сжатое содержание]: ${compressed}`;
          await sendMessage(formattedMessage);
        } else {
          const result = await AIService.summarize({ content: content.slice(0, 30_000) });
          if (result.ok) {
            const compressed = `Тональность: ${result.summary.tone}\nТемы: ${result.summary.themes.join(', ')}\nИнсайты: ${result.summary.insights.join('; ')}\nФакты: ${result.summary.extractedFacts.join('; ')}`;
            const formattedMessage = `[Прикреплено саммари заметки: "${title}"]\n\n[Сжатое содержание]: ${compressed}`;
            await AISummaryService.save({
              documentId,
              tone: result.summary.tone,
              frequentWords: result.summary.frequentWords,
              insights: result.summary.insights,
              themes: result.summary.themes,
              extractedFacts: result.summary.extractedFacts,
              processedAt: Date.now(),
            });
            await sendMessage(formattedMessage);
          } else {
            setError('Не удалось сжать заметку для отправки');
          }
        }
      } else {
        const formattedMessage = `[Прикреплена заметка: "${title}"]\n\n${content}`;
        await sendMessage(formattedMessage);
      }
    } catch {
      setError('Не удалось прикрепить документ');
    }
  }, [sendMessage]);

  return { dialogue, isLoading, streamingMessage, error, sendMessage, attachDocument, clearError };
}
