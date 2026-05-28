import { useState, useCallback, useRef, useEffect } from 'react';
import type { AIDialogue } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { incrementDailyUsage, setDailyLimitExhausted } from './useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { getAuth } from 'firebase/auth';
import type { AIMessage } from '../services/AIService';


async function streamChat(params: {
  personaId: string;
  customSystemPrompt?: string;
  messages: AIMessage[];
  documentContent?: string;
  documentMood?: string;
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
      messages: params.messages,
      documentContent: params.documentContent,
      documentMood: params.documentMood,
    }),
  });

  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  if (response.status === 429) throw new Error('DAILY_LIMIT');
  if (!response.ok) throw new Error('SERVER_ERROR');

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

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  loadDocument: (documentId: string) => Promise<void>;
  clearError: () => void;
  documentContent: string | null;
  documentMood: string | null;
}

export function useAIChat(dialogueId: string | null, personaId: string): UseAIChatReturn {
  const { profile } = useAuthStatus();
  const isAdmin = profile?.role === 'admin';
  const [dialogue, setDialogue] = useState<AIDialogue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [documentMood, setDocumentMood] = useState<string | null>(null);
  const pendingDocRef = useRef<{ content: string; mood: string | null; documentId: string } | null>(null);

  useEffect(() => {
    if (!dialogueId) { setDialogue(null); return; }
    AIDialogueService.get(dialogueId).then(d => setDialogue(d ?? null));
  }, [dialogueId]);

  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const { remaining } = useAiLimitStore.getState();
    if (remaining <= 0 && !isAdmin) {
      setDailyLimitExhausted();
      setError('Дневной лимит достигнут');
      return;
    }

    setIsLoading(true);
    setStreamingMessage('');
    setError(null);

    try {
      const messages: AIMessage[] = dialogue
        ? [...dialogue.messages, { role: 'user' as const, content: text }]
        : [{ role: 'user' as const, content: text }];

      const fullText = await streamChat({
        personaId,
        messages,
        documentContent: pendingDocRef.current?.content ?? documentContent ?? undefined,
        documentMood: pendingDocRef.current?.mood ?? documentMood ?? undefined,
        onChunk: (partial) => setStreamingMessage(partial),
      });

      if (!isAdmin) incrementDailyUsage();

      let currentDialogue = dialogue;
      if (!currentDialogue) {
        const preset = PRESET_PERSONAS.find(p => p.id === personaId);
        const personaName = personaId === 'custom' ? 'Custom' : (preset?.name ?? personaId);
        const personaEmoji = personaId === 'custom' ? '🤖' : (preset?.emoji ?? '🤖');
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title, personaId, personaName, personaEmoji,
          documentId: pendingDocRef.current?.documentId,
          messages: [],
        });
      }

      await AIDialogueService.appendMessage(currentDialogue.id, text, fullText);
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);
      setStreamingMessage(null);

      if (pendingDocRef.current && !currentDialogue.documentId) {
        pendingDocRef.current = null;
      }
    } catch (e: unknown) {
      setStreamingMessage(null);
      const msg = e instanceof Error ? e.message : 'SERVER_ERROR';
      if (msg === 'DAILY_LIMIT') { setDailyLimitExhausted(); setError('Дневной лимит достигнут'); }
      else if (msg === 'AUTH_REQUIRED') setError('Требуется регистрация');
      else setError('Произошла ошибка при отправке сообщения');
    } finally {
      setIsLoading(false);
    }
  }, [dialogue, personaId, documentContent, documentMood, isAdmin]);

  const loadDocument = useCallback(async (documentId: string) => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return;
      const db = await (await import('../../../core/storage/localDb')).getLocalDb();
      const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
      if (versions.length === 0) return;
      versions.sort((a, b) => b.version - a.version);
      setDocumentContent(versions[0].content);
      setDocumentMood(doc.mood ?? null);
      pendingDocRef.current = { content: versions[0].content, mood: doc.mood ?? null, documentId };
    } catch {
      setError('Не удалось загрузить документ');
    }
  }, []);

  return { dialogue, isLoading, streamingMessage, error, sendMessage, loadDocument, clearError, documentContent, documentMood };
}
