import { useState, useCallback, useEffect } from 'react';
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
import { searchNotes } from '../utils/noteRetriever';

let _streamAvailable: boolean | null = null;
const MAX_ATTACHMENT_CHARS = 9_500;
const CONTEXT_WINDOW = 14;

const NOTE_SEARCH_TRIGGERS = [
  'что я писал', 'что я думал', 'найди заметк', 'найди запис', 'поиск по заметк',
  'что годится в пост', 'где я писал', 'что я писа', 'напомни что', 'о чём я писал',
  'о чем я писал', 'что я говорил', 'ищу заметк', 'найди мне', 'найди среди',
  'что есть про', 'что у меня про', 'что я писал про',
];

function looksLikeNoteSearch(text: string): boolean {
  const lower = text.toLowerCase();
  return NOTE_SEARCH_TRIGGERS.some(t => lower.includes(t));
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
      // appended to the message — a chat message is capped at 10K chars, and 5
      // full notes blow past it (that returned 400 Bad Request from /api/chat).
      let searchContext: string | undefined;
      if (looksLikeNoteSearch(text)) {
        try {
          const notes = await searchNotes(text, 5);
          if (notes.length > 0) {
            const PER_NOTE_CHARS = 6_000;
            const parts = notes.map((n, i) => {
              const snippet = n.content.length > PER_NOTE_CHARS
                ? n.content.slice(0, PER_NOTE_CHARS) + '…'
                : n.content;
              return `Заметка ${i + 1}: "${n.title}"\n${snippet}`;
            });
            searchContext = (
              `Это результаты автоматического семантического поиска по личному архиву заметок пользователя по запросу: "${text}". ` +
              `Система нашла эти заметки в его архиве и предоставила их тебе — это собственные тексты пользователя, у тебя есть к ним доступ. ` +
              `Не отвечай, что у тебя нет доступа к заметкам и что ты видишь только прикреплённое. ` +
              `Опираясь на эти заметки, ответь на вопрос пользователя — что он обычно пишет на эту тему, какие темы, детали и чувства повторяются. ` +
              `Найдено заметок: ${notes.length}.\n\n` +
              parts.join('\n\n')
            ).slice(0, 45_000);
          }
        } catch (e) {
          console.warn('[useAIChat] note search failed:', e);
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
