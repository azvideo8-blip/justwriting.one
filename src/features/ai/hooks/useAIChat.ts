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

let _streamAvailable: boolean | null = null;
const MAX_ATTACHMENT_CHARS = 9_500;
const CONTEXT_WINDOW = 14;

function pruneMessages(messages: AIMessage[]): AIMessage[] {
  const chatOnly = messages.filter(m => m.type !== 'system');
  if (chatOnly.length <= CONTEXT_WINDOW) return chatOnly;
  const first = chatOnly[0];
  const rest = chatOnly.slice(-CONTEXT_WINDOW);
  if (first === rest[0]) return rest;
  return [first, ...rest];
}

async function streamChat(params: {
  personaId: string;
  customSystemPrompt?: string;
  messages: AIMessage[];
  documentContent?: string;
  documentMood?: string;
  userPortrait?: string | null;
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
  customSystemPrompt?: string;
  messages: AIMessage[];
  userPortrait?: string | null;
}): Promise<string> {
  const result = await AIService.chat({
    personaId: params.personaId,
    customSystemPrompt: params.customSystemPrompt,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
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
    AIDialogueService.get(dialogueId).then(d => setDialogue(d ?? null));
  }, [dialogueId]);

  useEffect(() => {
    if (!dialogueId || !personaId || !dialogue) return;
    if (dialogue.personaId === personaId) return;

    let active = true;

    (async () => {
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

    let optimisticDialogue = dialogue;
    if (optimisticDialogue) {
      const optimistic = { ...optimisticDialogue, messages: [...optimisticDialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }] };
      setDialogue(optimistic);
      optimisticDialogue = optimistic;
    }

    try {
      const allMessages: AIMessage[] = optimisticDialogue
        ? [...optimisticDialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }]
        : [{ role: 'user' as const, content: text, type: 'chat' as const }];

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

      let fullText: string;

      if (_streamAvailable === false) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, userPortrait });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: apiMessages,
            userPortrait,
            onChunk: (partial) => setStreamingMessage(partial),
          });
        } catch (e: unknown) {
          console.warn('Streaming chat failed, falling back to callable chat:', e);
          const errMsg = e instanceof Error ? e.message : '';
          if (errMsg !== 'DAILY_LIMIT' && errMsg !== 'AUTH_REQUIRED') {
            fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, userPortrait });
          } else {
            throw e;
          }
        }
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
      const real = dialogue ? await db.get('aiDialogues', dialogue.id) : null;
      setDialogue(real ?? dialogue);
      const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
      if (msg === 'DAILY_LIMIT') { setDailyLimitExhausted(); setError('Дневной лимит достигнут'); }
      else if (msg === 'AUTH_REQUIRED') setError('Требуется регистрация');
      else setError('Произошла ошибка при отправке сообщения');
    } finally {
      setIsLoading(false);
    }
  }, [dialogue, personaId]);

  const attachDocument = useCallback(async (documentId: string) => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return;
      const db = await getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
      if (versions.length === 0) return;
      versions.sort((a, b) => b.version - a.version);
      const content = versions[0].content;
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
