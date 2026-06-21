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
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { AIProfileService } from '../services/AIProfileService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { searchNotesMulti } from '../utils/noteRetriever';
import { analyzeDoors, aggregateDoors, doorLabel } from '../utils/contactDoors';
import { detectRisk, CRISIS_RESOURCES } from '../utils/riskDetect';
import { cosineSimilarity } from '../utils/vectorSearch';

let _streamAvailable: boolean | null = null;
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

// Attachment messages embed the full note/file body for display in the bubble,
// but a chat message sent to the API is capped at 10K chars. The model already
// received the note in full via documentContent on the attaching turn, so for
// the API we collapse an attached-note message to just its marker line. A hard
// cap is the safety net for any other oversized message.
const API_MSG_CAP = 9_500;
function toApiContent(content: string): string {
  const noteMatch = content.match(/^\[Прикреплена заметка: "[^"]+"\]/);
  if (noteMatch) return noteMatch[0];
  return content.length > API_MSG_CAP ? content.slice(0, API_MSG_CAP) : content;
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
  responseLength?: 'short' | 'standard' | 'detailed' | 'reasoning' | undefined;
  signal?: AbortSignal | undefined;
  onChunk: (partial: string, reasoning: string | null) => void;
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
      responseLength: params.responseLength,
    }),
    signal: params.signal ?? null,
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

  try {
   while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      fullText += text;
      // Parse reasoning/answer sections from stream. DeepSeek exposes thinking
      // in three shapes, handled in priority order:
      //  1. <think>…</think> inline tags (reasoning models on Fireworks)
      //  2. <reasoning>…</reasoning><answer>…</answer> XML
      //  3. markdown headers ХОД МЫСЛИ: … ОТВЕТ: …
      const thinkMatch = fullText.match(/<think>([\s\S]*?)(<\/think>|$)/i);
      const reasoningMatch = fullText.match(/(?:\/\/)?<reasoning>([\s\S]*?)(<\/reasoning>|$)/i);
      const answerMatch = fullText.match(/<\/reasoning>\s*(?:\/\/)?<answer>([\s\S]*?)(<\/answer>|$)/i);
      const mdReasoningMatch = fullText.match(/ХОД МЫСЛИ:\s*([\s\S]*?)(?=ОТВЕТ:|$)/i);
      const mdAnswerMatch = fullText.match(/ОТВЕТ:\s*([\s\S]*?)$/i);

      let reasoningText: string | null = null;
      let answerText: string;

      if (thinkMatch) {
        reasoningText = thinkMatch[1]!.trim();
        // answer is whatever follows the closing </think>
        const after = fullText.split(/<\/think>/i)[1];
        answerText = after !== undefined ? after.trim() : '';
      } else if (reasoningMatch) {
        reasoningText = reasoningMatch[1]!.trim();
        answerText = answerMatch ? answerMatch[1]!.trim() : '';
      } else if (mdReasoningMatch) {
        reasoningText = mdReasoningMatch[1]!.trim();
        answerText = mdAnswerMatch ? mdAnswerMatch[1]!.trim() : '';
      } else {
        // No reasoning markers yet — show raw text as answer
        reasoningText = null;
        answerText = fullText;
      }
      params.onChunk(answerText, reasoningText || null);
    }
   }
  } catch (e) {
    // User pressed Stop — keep whatever streamed so far instead of erroring.
    if (params.signal?.aborted) return fullText;
    throw e;
  }

  return fullText;
}

async function callableChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  userPortrait?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | 'reasoning' | undefined;
}): Promise<string> {
  const result = await AIService.chat({
    personaId: params.personaId,
    customSystemPrompt: params.customSystemPrompt,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
    documentContent: params.documentContent,
    userPortrait: params.userPortrait,
    responseLength: params.responseLength,
  });

  if (!result.ok) {
    if (result.error === 'DAILY_LIMIT') throw new Error('DAILY_LIMIT');
    if (result.error === 'AUTH_REQUIRED') throw new Error('AUTH_REQUIRED');
    if (result.error === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
    throw new Error('SERVER_ERROR');
  }

  return result.text;
}

function extractReasoning(text: string): string | undefined {
  // <think> tags
  const think = text.match(/<think>([\s\S]*?)(<\/think>|$)/i);
  if (think) { const r = think[1]!.trim(); return r || undefined; }
  // XML tags
  const xml = text.match(/(?:\/\/)?<reasoning>([\s\S]*?)(<\/reasoning>|$)/i);
  if (xml) { const r = xml[1]!.trim(); return r || undefined; }
  // Markdown header: ХОД МЫСЛИ: ... (until ОТВЕТ: or end)
  const md = text.match(/ХОД МЫСЛИ:\s*([\s\S]*?)(?=ОТВЕТ:|$)/i);
  if (md) { const r = md[1]!.trim(); return r || undefined; }
  return undefined;
}

function extractAnswer(text: string): string {
  // <think>…</think> — answer is what follows the closing tag
  if (/<\/think>/i.test(text)) {
    const after = text.split(/<\/think>/i)[1];
    if (after !== undefined) return after.trim();
  }
  // Try XML tags
  const answerMatch = text.match(/(?:\/\/)?<answer>([\s\S]*?)(<\/answer>|$)/i);
  if (answerMatch) return answerMatch[1]!.trim();
  // Try markdown: ОТВЕТ: ...
  const mdAnswerMatch = text.match(/ОТВЕТ:\s*([\s\S]*?)$/i);
  if (mdAnswerMatch) return mdAnswerMatch[1]!.trim();
  // Strip reasoning blocks and return the rest
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/(?:\/\/)?<\/?reasoning>/gi, '')
    .replace(/ХОД МЫСЛИ:[\s\S]*?(?=ОТВЕТ:|$)/gi, '')
    .replace(/ОТВЕТ:/gi, '')
    .replace(/(?:\/\/)?<answer>/gi, '')
    .replace(/<\/answer>/gi, '')
    .trim();
}

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  streamingReasoning: string | null;
  error: string | null;
  sendMessage: (text: string, attached?: { content: string }) => Promise<string | null>;
  attachDocument: (documentId: string) => Promise<void>;
  prepareAttachment: (documentId: string) => Promise<{ title: string; content: string } | null>;
  stop: () => void;
  clearError: () => void;
}

export function useAIChat(dialogueId: string | null, personaId: string, responseLength?: 'short' | 'standard' | 'detailed' | 'reasoning'): UseAIChatReturn {
  const [dialogue, setDialogue] = useState<AIDialogue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // L12: Cache portrait across messages to avoid Firestore reads per turn.
  const portraitCacheRef = useRef<string | null | undefined>(undefined);

  // OPT-4: Cache facets + documents for the session, invalidate on dialogue change
  const facetsCacheRef = useRef<{ facets: Awaited<ReturnType<typeof AIProfileFacetService.getAll>> | null }>({ facets: null });
  // CHATFIX-2: docsCacheRef — Map<id, doc>, loaded once per session
  const docsCacheRef = useRef<Map<string, { id: string; title?: string; lastSessionAt?: number; firstSessionAt?: number }> | null>(null);
  // CHATFIX-1: doorsCacheRef — aggregate doors, computed once per session
  const doorsCacheRef = useRef<{ hint: string } | null>(null);
  // CHATFIX-3: Track message count for memory extraction throttle
  const messageCountRef = useRef(0);

  // Sticky note-search: once a search happens, keep retrieving for the next few
  // follow-up turns (e.g. "посмотри в этих", "собери", "а почему") even if they
  // don't match a trigger, reusing the last real query so the topic carries.
  const stickyTurnsRef = useRef(0);
  const lastSearchQueryRef = useRef('');
  const lastSearchNamesRef = useRef<string[]>([]);
  // Stop button: abort the in-flight streaming request.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stickyTurnsRef.current = 0;
    lastSearchQueryRef.current = '';
    lastSearchNamesRef.current = [];
    // OPT-4: Invalidate facet/doc/doors cache on dialogue change
    facetsCacheRef.current = { facets: null };
    docsCacheRef.current = null;
    doorsCacheRef.current = null;
    messageCountRef.current = 0;
  }, [dialogueId]);

  useEffect(() => {
    if (!dialogueId) { setDialogue(null); return; }
    const refresh = () => {
      void AIDialogueService.get(dialogueId).then(d => setDialogue(d ?? null));
    };
    refresh();
    window.addEventListener('dialogue-updated', refresh);
    return () => window.removeEventListener('dialogue-updated', refresh);
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

  // `attached.content` is the full note text routed through documentContent (50K),
  // so the model reads the whole note while the chat message stays small (just a
  // "[Прикреплена заметка: …]" marker plus any text the user typed). The note body
  // is never put into the message itself (that would trip the 10K per-message cap).
  const sendMessage = useCallback(async (text: string, attached?: { content: string }): Promise<string | null> => {
    if (!text.trim()) return null;

    const { remaining } = useAiLimitStore.getState();
    if (remaining <= 0) {
      setDailyLimitExhausted();
      setError('Дневной лимит достигнут');
      return null;
    }

    setIsLoading(true);
    setStreamingMessage(null); setStreamingReasoning(null);
    setError(null);

    // Stop button: fresh controller per send; stop() aborts this one.
    const controller = new AbortController();
    abortRef.current = controller;

    // Build API messages from the ORIGINAL dialogue before the optimistic update.
    const allMessages: AIMessage[] = dialogue
      ? [...dialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }]
      : [{ role: 'user' as const, content: text, type: 'chat' as const }];

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
        messages: [{ role: 'user', content: text, type: 'chat' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setDialogue(tempDialogue);
    }

    try {

      // For attached notes the last user message goes to the API as a short
      // marker; the full note text travels via documentContent (see below).
      // Collapse any oversized attachment body so no single API message exceeds the
      // 10K per-message cap (the full note travels via documentContent instead).
      const apiMessages = pruneMessages(allMessages.filter(m => m.type !== 'system'))
        .map(m => ({ ...m, content: toApiContent(m.content) }));

      // async-cheap-condition-before-await: compute sync flags before any awaits.
      // An attached note must NOT trigger an archive search — the note is already
      // provided in full via documentContent, and its "[Прикреплена заметка…]"
      // marker would otherwise match the note-search heuristic.
      const explicitSearch = attached ? false : looksLikeNoteSearch(text);

      let effectivePersonaId = personaId;
      let customSystemPrompt: string | undefined;

      const isPreset = PRESET_PERSONAS.some(p => p.id === personaId);

      // async-parallel: fetch portrait and custom persona concurrently.
      const portraitPromise = portraitCacheRef.current !== undefined
        ? Promise.resolve(portraitCacheRef.current)
        : AIProfileService.getPortrait().then(p => { portraitCacheRef.current = p; return p; });
      const personaPromise = isPreset
        ? Promise.resolve(undefined)
        : AIPersonaService.getCustom(personaId);

      const [userPortrait, customPersona] = await Promise.all([portraitPromise, personaPromise]);

      if (!isPreset && customPersona) {
        customSystemPrompt = customPersona.systemPrompt;
        personaName = customPersona.name;
        personaEmoji = customPersona.emoji;
        effectivePersonaId = 'custom';
      } else if (isPreset) {
        const preset = PRESET_PERSONAS.find(p => p.id === personaId);
        personaName = preset?.name ?? personaId;
        personaEmoji = preset?.emoji ?? '\u{1F916}';
      }

      // Note-search context goes through documentContent (backend cap 50K), NOT
      // appended to the message — a chat message is capped at 10K chars, and
      // full notes blow past it (that returned 400 Bad Request from /api/chat).
      let searchContext: string | undefined;

      // Explicit trigger, or sticky follow-up within an ongoing notes conversation.
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
      // BUT NOT when a note is attached: the note IS the subject of analysis, and
      // mixing in facet/profile summaries made the model confabulate a fake note
      // out of past themes (it described events that weren't in the attached text).
      const psychePersonas = ['group_psychology', 'cbt', 'coach', 'parts'];
      const needsFacets = !attached && (explicitSearch || stickySearch || psychePersonas.includes(effectivePersonaId));
      const facetNoteIds = new Set<string>();

      // OPT-1: Single embedding for the query — reused in facets + search
      let queryEmb: number[] | undefined;
      // OPT-1: Single getAll() call — reused for facets + name search + vector search
      let allEmbeddings: Awaited<ReturnType<typeof AIEmbeddingService.getAll>> | undefined;

      // OPT-4: Gate facet augmentation on trivial messages
      // CHATFIX-7: For psycho-personas, relax gate — emotional short messages
      // ("мне плохо", "устал") are key moments that need context.
      const wordCount = text.trim().split(/\s+/).length;
      const isPsyche = psychePersonas.includes(effectivePersonaId);
      const isTrivial = isPsyche
        ? (wordCount < 2 && !/[?]/.test(text) && !looksLikeNoteSearch(text))
        : (wordCount < 4 && !/[?]/.test(text) && !looksLikeNoteSearch(text));
      const shouldRunFacets = needsFacets && !isTrivial;

      if (shouldRunFacets) {
        try {
          // OPT-4: Read facets from cache, only load from DB once per session
          let facets = facetsCacheRef.current.facets;
          if (!facets) {
            facets = await AIProfileFacetService.getAll();
            facetsCacheRef.current = { facets };
          }
          if (facets.length > 0) {
            // OPT-1: Compute query embedding ONCE, reuse for search
            if (queryEmb === undefined) {
              const embedQuery = explicitSearch || stickySearch
                ? (explicitSearch ? text : `${lastSearchQueryRef.current}\n${text}`)
                : text;
              const queryEmbResult = await AIService.embed({ content: embedQuery });
              queryEmb = queryEmbResult.ok && queryEmbResult.vectors[0] ? queryEmbResult.vectors[0] : undefined;
            }
            const qv = queryEmb;

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
              // CHATFIX-2: Use docsCacheRef — single getAll('documents') per session
              let docMap = docsCacheRef.current;
              if (!docMap) {
                const db = await getLocalDb();
                const docs = await db.getAll('documents');
                docMap = new Map(docs.map(d => [d.id, d]));
                docsCacheRef.current = docMap;
              }

              const facetLines = relevant.map(({ f }) => {
                // Collect note IDs from relevant facets for supplemental note loading
                for (const id of f.noteIds) facetNoteIds.add(id);

                const noteTitles = f.noteIds
                  .slice(0, 12)
                  .map(id => docMap.get(id)?.title)
                  .filter(Boolean)
                  .map(t => `  · ${t}`)
                  .join('\n');

                // DLG-4: Temporal observations from facet firstAt/lastAt
                const now = Date.now();
                const dayMs = 86_400_000;
                let temporalNote = '';
                if (f.firstAt && f.lastAt) {
                  const lastDaysAgo = Math.round((now - f.lastAt) / dayMs);
                  const firstDaysAgo = Math.round((now - f.firstAt) / dayMs);
                  if (lastDaysAgo <= 3) {
                    temporalNote = ` [тема активна сейчас]`;
                  } else if (lastDaysAgo <= 14) {
                    temporalNote = ` [последняя запись ${lastDaysAgo} дн. назад]`;
                  } else if (lastDaysAgo > 30 && firstDaysAgo > 60) {
                    temporalNote = ` [тема затихла с ${new Date(f.lastAt).toLocaleDateString('ru-RU')}]`;
                  } else if (firstDaysAgo <= 7) {
                    temporalNote = ` [новая тема]`;
                  }
                }

                return `— ${f.label} (${f.noteCount} заметок)${temporalNote}:\n${f.summary}${noteTitles ? `\nЗаметки по теме:\n${noteTitles}` : ''}`;
              }).join('\n\n');
              const facetBlock = `Темы профиля пользователя (обобщены ИИ по заметкам):\n${facetLines}\n\nОпирайся на эти темы и на заметки ниже при ответе. Не выдумывай детали, которых нет в текстах.`;

              // CHATFIX-1: Doors hint — cached per session, not recomputed every message
              let doorsHint = '';
              if (psychePersonas.includes(effectivePersonaId)) {
                if (doorsCacheRef.current) {
                  doorsHint = doorsCacheRef.current.hint;
                } else {
                  try {
                    const db = await getLocalDb();
                    // CHATFIX-2: reuse docMap from cache instead of second getAll
                    const allDocs = [...(docMap ?? new Map()).values()];
                    if (allDocs.length > 0) {
                      const perNote: { doors: ReturnType<typeof analyzeDoors>; ts: number }[] = [];
                      for (const d of allDocs) {
                        const vers = await db.getAllFromIndex('versions', 'by-document', d.id);
                        if (vers.length === 0) continue;
                        vers.sort((a, b) => b.version - a.version);
                        perNote.push({ doors: analyzeDoors(vers[0]?.content ?? ''), ts: d.lastSessionAt ?? d.firstSessionAt ?? 0 });
                      }
                      // CHATFIX-4: Sort by ts desc, take 20 newest
                      perNote.sort((a, b) => b.ts - a.ts);
                      const doorsResult = aggregateDoors(perNote.slice(0, 20));
                      if (!doorsResult.lowData && doorsResult.thinnestDoor && doorsResult.dominantDoor) {
                        doorsHint = `\n\nНаблюдение: в записях пользователь чаще опирается на ${doorLabel(doorsResult.dominantDoor)}; ${doorLabel(doorsResult.thinnestDoor)} звучат реже. Если уместно — мягко, гипотезой пригласи заметить ${doorLabel(doorsResult.thinnestDoor)} под ${doorLabel(doorsResult.dominantDoor)}; не дави, дай возможность отказаться.`;
                      }
                    }
                    doorsCacheRef.current = { hint: doorsHint };
                  } catch { /* non-critical */ }
                }
              }

              searchContext = facetBlock + doorsHint;
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
          // OPT-2: Query expansion disabled by default — hybrid BM25+vector
          // already provides good recall. Set AI_QUERY_EXPANSION=true to re-enable.
          let searchQueries = [searchQuery];
          const expansionEnabled = import.meta.env.VITE_AI_QUERY_EXPANSION === 'true';
          if (explicitSearch && expansionEnabled) {
            try {
              const expandRes = await AIService.chat({
                personaId: 'coach',
                messages: [{ role: 'user', content: `Для поискового запроса по личному дневнику: "${searchQuery}", напиши 3 альтернативных поисковых запроса на русском языке (синонимы, связанные темы, имена). Выдай их одной строкой через запятую.` }],
              });
              if (expandRes.ok && expandRes.text) {
                const expanded = expandRes.text.split(',').map(s => s.trim()).filter(s => s.length > 2);
                if (expanded.length > 0) searchQueries = [searchQuery, ...expanded.slice(0, 3)];
              }
            } catch { /* non-critical, fall back to original query */ }
          }

          // OPT-1: Reuse query embedding if already computed for facets
          if (queryEmb === undefined) {
            const queryEmbResult = await AIService.embed({ content: searchQuery });
            queryEmb = queryEmbResult.ok && queryEmbResult.vectors[0] ? queryEmbResult.vectors[0] : undefined;
          }

          // OPT-1: Reuse allEmbeddings if already loaded for name search
          if (allEmbeddings === undefined) {
            allEmbeddings = await AIEmbeddingService.getAll();
          }

          const notes = await searchNotesMulti(searchQueries, 10, { queryVector: queryEmb, allEmbeddings });

          // Text-based name search: vector embeddings are bad at proper-name
          // retrieval ("Даша" won't match chunks that mention her briefly).
          // Extract candidate names from current text + carry forward from the
          // original query on sticky turns ("а ещё про неё?" has no names).
          const candidateNames = [...new Set([
            ...text.match(/[А-ЯЁ][а-яё]{2,}/g) ?? [],
            ...lastSearchNamesRef.current,
          ])];
          const nameSearchIds = new Set<string>();
          // M2: Load embeddings once, reuse for both name search and facet-note matching.
          // OPT-1: allEmbeddings already loaded above, reuse here
          const nameSearchEmb = candidateNames.length > 0 ? (allEmbeddings ?? await AIEmbeddingService.getAll()) : [];
          // js-hoist-regexp: pre-compile all name regexes once instead of in a loop.
          const nameRegexes = candidateNames.map(name =>
            new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^а-яёА-ЯЁa-zA-Z0-9_]|$)`)
          );
          if (nameRegexes.length > 0) {
            for (const emb of nameSearchEmb) {
              if (nameSearchIds.has(emb.documentId)) continue;
              const texts = emb.chunkTexts ?? [];
              if (texts.some(t => nameRegexes.some(re => re.test(t)))) nameSearchIds.add(emb.documentId);
            }
          }

          // Combine: vector search results + facet notes + name-search notes
          const foundIds = new Set(notes.map(n => n.documentId));
          // M2: reuse nameSearchEmb + nameRegexes already compiled above.
          if (nameRegexes.length > 0 && facetNoteIds.size > 0) {
            for (const emb of nameSearchEmb) {
              if (!facetNoteIds.has(emb.documentId)) continue;
              if (foundIds.has(emb.documentId) || nameSearchIds.has(emb.documentId)) continue;
              const texts = emb.chunkTexts ?? [];
              if (texts.some(t => nameRegexes.some(re => re.test(t)))) nameSearchIds.add(emb.documentId);
            }
          }
          // L11: skip facet extraIds already covered by vector search to avoid duplicate notes.
          const extraIds: string[] = [];
          for (const id of facetNoteIds) {
            if (!foundIds.has(id) && !nameSearchIds.has(id) && extraIds.length < 10) extraIds.push(id);
          }
          const nameIds = [...nameSearchIds].filter(id => !foundIds.has(id) && !extraIds.includes(id)).slice(0, 15);
          let allNotes = notes.length > 0 ? [...notes] : [];

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
              lastSessionAt: doc.lastSessionAt,
            });
          }

          if (allNotes.length > 5) {
            // Rerank when we have many candidates — pick the most relevant 5-8.
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
              console.warn('[useAIChat] rerank failed, keeping original order:', e);
            }
          }

          if (allNotes.length > 0) {
            // TICKET-025: Dynamic Context Budgeting — score by vector sim +
            // keyword density + recency, then add notes until budget exhausted.
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

            // OPT-7: Place most relevant notes near the END (closest to user question)
            // to combat "lost in the middle" effect — reverse the scored list
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
              parts.push(`Заметка ${noteIdx}: "${n.title}"\n${snippet}`);
              totalChars += snippet.length;
            }
            const noteBlock = (
              `\n\nРезультаты поиска по архиву заметок (запрос: "${text}"). ` +
              `Найдено заметок: ${allNotes.length} (отобрано ${noteIdx} по релевантности). ` +
              `Это наиболее релевантные заметки по запросу. Если ответа в них нет — так и скажи, не домысливай.\n\n` +
              parts.join('\n\n')
            );
            searchContext = (searchContext ?? '') + noteBlock;
          } else if (!searchContext) {
            searchContext =
              `Автоматический поиск по архиву заметок пользователя по запросу "${text}" не нашёл заметок. ` +
              `КАТЕГОРИЧЕСКИ не выдумывай содержание его заметок и не приписывай ему того, чего нет.`;
          }
          // H5: Cap total searchContext to prevent blowing past model context window.
          // Budget: 30K chars ≈ 10K tokens for notes/facets (model window ~128K tokens).
          const CONTEXT_CAP = 30_000;
          if (searchContext && searchContext.length > CONTEXT_CAP) {
            const facetHead = searchContext.indexOf('\n\nРезультаты поиска');
            if (facetHead > 0) {
              const facetPart = searchContext.slice(0, facetHead);
              const notePart = searchContext.slice(facetHead);
              const facetBudget = 5_000;
              const noteBudget = CONTEXT_CAP - facetBudget;
              const trimmedFacet = facetPart.length <= facetBudget ? facetPart : facetPart.slice(0, facetBudget) + '…';
              const trimmedNote = notePart.length <= noteBudget ? notePart : notePart.slice(0, noteBudget) + '…';
              searchContext = trimmedFacet + trimmedNote;
            } else {
              searchContext = searchContext.slice(0, CONTEXT_CAP) + '…';
            }
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

      // DLG-1: Cross-dialogue memory — inject relevant memories into context.
      // Skip when a note is attached: memory of past chats (incl. the AI's own
      // past interpretations) leaked in and got misattributed to the attached note.
      if (queryEmb && !attached) {
        try {
          const memories = await AIChatMemoryService.getRelevant(queryEmb, 5);
          if (memories.length > 0) {
            const memoryBlock = '[Что ИИ помнит о пользователе из прошлых бесед]\n' +
              memories.map(m => `— ${m.kind}: ${m.text}`).join('\n');
            searchContext = searchContext ? searchContext + '\n\n' + memoryBlock : memoryBlock;
          }
        } catch (e) {
          console.warn('[useAIChat] memory retrieval failed:', e);
        }
      }

      // THERAPY-2: Crisis safety check — if acute risk detected, inject safety context
      const riskResult = detectRisk(text);
      if (riskResult.isRisk) {
        const crisisBlock = `⚠️ КРИЗИСНЫЙ КОНТЕКСТ: пользователь выразил явные маркеры острого риска. ` +
          `СЛЕДУЙ КРИЗИСНОМУ ПРОТОКОЛУ (SAFETY_GUIDE). ` +
          `Ресурсы для пользователя: ${CRISIS_RESOURCES.join(' | ')}. ` +
          `Тепло признай боль, направь к живой помощи, НЕ обрывай диалог.`;
        searchContext = searchContext ? crisisBlock + '\n\n' + searchContext : crisisBlock;
      }

      // Attached note: inject the FULL text as primary context (capped to fit the
      // 50K documentContent budget). Takes priority over facet/search context.
      if (attached?.content) {
        const noteText = attached.content.slice(0, 45_000);
        const noteBlock =
          `[Прикреплённая пользователем заметка — ЕДИНСТВЕННЫЙ источник для разбора]\n` +
          `Разбирай СТРОГО то, что реально написано ниже. Не добавляй событий, сцен, цитат, эмоций или фактов, которых в этом тексте нет (например слёз, сессий, чужих фраз), даже если они кажутся вероятными или звучали раньше. Если чего-то в тексте нет — значит этого нет.\n\n` +
          noteText;
        if (searchContext) {
          const room = 48_000 - noteBlock.length;
          searchContext = room > 500 ? noteBlock + '\n\n' + searchContext.slice(0, room) : noteBlock;
        } else {
          searchContext = noteBlock;
        }
      }

      const effectiveResponseLength = dialogue?.responseLength || responseLength || 'standard';

      let fullText: string;

      if (_streamAvailable === false) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait, responseLength: effectiveResponseLength });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: apiMessages,
            documentContent: searchContext,
            userPortrait,
            responseLength: effectiveResponseLength,
            signal: controller.signal,
            onChunk: (partial, reasoning) => {
              setStreamingMessage(partial);
              setStreamingReasoning(reasoning);
            },
          });
        } catch (e: unknown) {
          // Don't fall back to the callable if the user aborted on purpose.
          if (controller.signal.aborted) throw new Error('ABORTED');
          console.warn('Streaming chat failed, falling back to callable chat:', e);
          const errMsg = e instanceof Error ? e.message : '';
          if (errMsg !== 'DAILY_LIMIT' && errMsg !== 'AUTH_REQUIRED') {
            fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait, responseLength: effectiveResponseLength });
            // RSN-4: Parse reasoning from callable fallback
            if (effectiveResponseLength === 'reasoning') {
              // Try XML tags
              const reasoningMatch = fullText.match(/(?:\/\/)?<reasoning>([\s\S]*?)<\/reasoning>/i);
              const answerMatch = fullText.match(/(?:\/\/)?<answer>([\s\S]*?)(<\/answer>|$)/i);
              // Try markdown headers
              const mdReasoningMatch = fullText.match(/ХОД МЫСЛИ:\s*([\s\S]*?)(?=ОТВЕТ:|$)/i);
              const mdAnswerMatch = fullText.match(/ОТВЕТ:\s*([\s\S]*?)$/i);
              
              if (reasoningMatch) setStreamingReasoning(reasoningMatch[1]!.trim());
              else if (mdReasoningMatch) setStreamingReasoning(mdReasoningMatch[1]!.trim());
              
              if (answerMatch) setStreamingMessage(answerMatch[1]!.trim());
              else if (mdAnswerMatch) setStreamingMessage(mdAnswerMatch[1]!.trim());
              else setStreamingMessage(fullText);
            }
          } else {
            throw e;
          }
        }
      }

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

      incrementDailyUsage();

      let currentDialogue = dialogue;
      const wasNew = !currentDialogue;
      if (!currentDialogue) {
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title,
          personaId,
          personaName,
          personaEmoji,
          messages: [],
          responseLength: effectiveResponseLength,
        });
      }

      // RSN-4: Clean reasoning tags before saving; persist reasoning separately
      // so the collapsible "ход мысли" survives in dialogue history.
      const savedText = effectiveResponseLength === 'reasoning' ? extractAnswer(fullText) : fullText;
      const savedReasoning = effectiveResponseLength === 'reasoning' ? extractReasoning(fullText) : undefined;
      await AIDialogueService.appendMessage(currentDialogue.id, text, savedText, savedReasoning);
      // CHATFIX-3: Extract memory every 3rd turn, not every turn
      messageCountRef.current += 1;
      if (messageCountRef.current % 3 === 0) {
        // Strip attachment bodies — memory extraction goes to an AI endpoint with
        // the same per-message cap, and raw note text shouldn't be stored anyway.
        const memMessages = allMessages.map(m => ({ ...m, content: toApiContent(m.content) }));
        void AIChatMemoryService.extractFromDialogue(currentDialogue.id, memMessages);
      }
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);
      setStreamingMessage(null); setStreamingReasoning(null);

      // OPT-3: Auto-name the dialogue via LLM after the first exchange.
      // Uses chat API (void — non-blocking). TODO: switch to cheap facet model
      // via a dedicated callable to avoid burning the reasoning model on naming.
      if (wasNew) {
        void AIService.chat({
          personaId: 'coach',
          messages: [
            { role: 'user', content: `Придумай короткое название (3-5 слов) для диалога на русском языке на основе первого сообщения пользователя: "${text.slice(0, 200)}" и ответа ИИ: "${fullText.slice(0, 200)}". Ответь ТОЛЬКО названием, без кавычек.` },
          ],
        }).then(res => {
          if (res.ok && res.text) {
            const cleanTitle = res.text.trim().replace(/^["«]|["»]$/g, '').slice(0, 50);
            if (cleanTitle.length > 0) {
              void AIDialogueService.updateTitle(currentDialogue!.id, cleanTitle);
            }
          }
        }).catch(() => { /* non-critical */ });
      }
      // Return the persisted dialogue id so the caller can select it (a new
      // dialogue must become active or it looks "lost" after navigation).
      return currentDialogue.id;
    } catch (e: unknown) {
      setStreamingMessage(null); setStreamingReasoning(null);
      const db = await getLocalDb();
      const fresh = dialogueId ? await db.get('aiDialogues', dialogueId) : null;
      setDialogue(fresh ?? dialogue);
      const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
      if (msg === 'ABORTED') { /* user stopped — no error */ }
      else if (msg === 'DAILY_LIMIT') { setDailyLimitExhausted(); setError('Дневной лимит достигнут'); }
      else if (msg === 'AUTH_REQUIRED') setError('Требуется регистрация');
      else if (msg === 'EMPTY_RESPONSE') setError('ИИ не ответил — сервис временно недоступен (возможно, исчерпан лимит). Попробуйте позже.');
      else setError('Произошла ошибка при отправке сообщения');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [dialogue, dialogueId, personaId, responseLength]);

  // Load a note's latest text without sending — lets the UI stage an attachment
  // (show a chip) so the user can add their own message before sending.
  const prepareAttachment = useCallback(async (documentId: string): Promise<{ title: string; content: string } | null> => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return null;
      const db = await getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
      if (versions.length === 0) return null;
      versions.sort((a, b) => b.version - a.version);
      const content = versions[0]?.content;
      if (content === undefined) return null;
      return { title: doc.title || 'Без названия', content };
    } catch {
      return null;
    }
  }, []);

  // Attach + send in one step (used when opening chat from a note / facet draft).
  // The note text goes via documentContent; the message is just the marker.
  const attachDocument = useCallback(async (documentId: string) => {
    const prepared = await prepareAttachment(documentId);
    if (!prepared) { setError('Не удалось прикрепить документ'); return; }
    const marker = `[Прикреплена заметка: "${prepared.title}"]`;
    await sendMessage(marker, { content: prepared.content });
  }, [prepareAttachment, sendMessage]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { dialogue, isLoading, streamingMessage, streamingReasoning, error, sendMessage, attachDocument, prepareAttachment, stop, clearError };
}
