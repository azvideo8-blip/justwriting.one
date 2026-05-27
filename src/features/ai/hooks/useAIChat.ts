import { useState, useCallback, useRef, useEffect } from 'react';
import type { AIDialogue } from '../../../core/storage/localDb';
import { AIService } from '../services/AIService';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { incrementDailyUsage, setDailyLimitExhausted } from './useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import type { AIMessage } from '../services/AIService';

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [documentMood, setDocumentMood] = useState<string | null>(null);
  const pendingDocRef = useRef<{ content: string; mood: string | null; documentId: string } | null>(null);

  useEffect(() => {
    if (!dialogueId) {
      setDialogue(null);
      return;
    }
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
    setError(null);

    try {
      const messages: AIMessage[] = dialogue
        ? [...dialogue.messages, { role: 'user' as const, content: text }]
        : [{ role: 'user' as const, content: text }];

      const result = await AIService.chat({
        personaId,
        messages,
        documentContent: pendingDocRef.current?.content ?? documentContent ?? undefined,
        documentMood: pendingDocRef.current?.mood ?? documentMood ?? undefined,
      });

      if (!result.ok) {
        if (result.error === 'DAILY_LIMIT') {
          setDailyLimitExhausted();
          setError('Дневной лимит достигнут');
        } else if (result.error === 'RATE_LIMIT') {
          setError('Слишком много запросов. Пожалуйста, подождите несколько секунд.');
        } else if (result.error === 'AUTH_REQUIRED') {
          setError('Требуется регистрация');
        } else {
          setError(result.error);
        }
        setIsLoading(false);
        return;
      }

      if (!isAdmin) {
        incrementDailyUsage();
      }

      let currentDialogue = dialogue;
      if (!currentDialogue) {
        const preset = PRESET_PERSONAS.find(p => p.id === personaId);
        const personaName = personaId === 'custom' ? 'Custom' : (preset?.name ?? personaId);
        const personaEmoji = personaId === 'custom' ? '🤖' : (preset?.emoji ?? '🤖');
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title,
          personaId,
          personaName,
          personaEmoji,
          documentId: pendingDocRef.current?.documentId,
          messages: [],
        });
      }

      await AIDialogueService.appendMessage(currentDialogue.id, text, result.text);
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);

      if (pendingDocRef.current && !currentDialogue.documentId) {
        pendingDocRef.current = null;
      }
    } catch {
      setError('Произошла ошибка при отправке сообщения');
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
      const content = versions[0].content;

      setDocumentContent(content);
      setDocumentMood(doc.mood ?? null);
      pendingDocRef.current = { content, mood: doc.mood ?? null, documentId };
    } catch {
      setError('Не удалось загрузить документ');
    }
  }, []);

  return {
    dialogue,
    isLoading,
    error,
    sendMessage,
    loadDocument,
    clearError,
    documentContent,
    documentMood,
  };
}
