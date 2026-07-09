import { useState, useCallback, useEffect, useRef } from 'react';
import type { AIDialogue } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS, AIPersonaService } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useLanguage } from '../../../shared/i18n';
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
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { searchNotesMulti } from '../utils/noteRetriever';
import { analyzeDoors, aggregateDoors, doorLabel } from '../utils/contactDoors';
import { detectRisk, CRISIS_RESOURCES } from '../utils/riskDetect';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';

import { useAIChatContext } from './useAIChatContext';
import {
  streamChat,
  callableChat,
  extractReasoning,
  extractAnswer,
  looksLikeNoteSearch,
  pruneMessages,
  toApiContent,
  API_MSG_CAP,
  CONTEXT_WINDOW,
  _streamUnavailableUntil
} from '../utils/aiChatTransport';
export { API_MSG_CAP };

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  streamingReasoning: string | null;
  error: string | null;
  sendMessage: (text: string, attached?: { content: string; documentId?: string; inline?: boolean }, mood?: string) => Promise<string | null>;
  attachDocument: (documentId: string) => Promise<void>;
  prepareAttachment: (documentId: string) => Promise<{ title: string; content: string } | null>;
  stop: () => void;
  regenerateLast: () => Promise<void>;
  crisisActive: boolean;
  dismissCrisis: () => void;
  clearError: () => void;
}

export function useAIChat(dialogueId: string | null, personaId: string, responseLength?: 'short' | 'standard' | 'detailed', reasoning?: boolean): UseAIChatReturn {
  const { language, t } = useLanguage();
  const [dialogue, setDialogue] = useState<AIDialogue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Safety-by-design: surface crisis resources in the UI (not just the prompt)
  // once acute-risk markers are detected; stays until the user dismisses it.
  const [crisisActive, setCrisisActive] = useState(false);

    const context = useAIChatContext(personaId);

  // Stop button: abort the in-flight streaming request.
  const abortRef = useRef<AbortController | null>(null);
  // R-1: Synchronous re-entrancy guard — isLoading is React state (async commit),
  // so two calls in the same tick both bypass it. sendingRef is checked/set
  // synchronously, preventing concurrent streams and orphaned AbortControllers.
  const sendingRef = useRef(false);

  useEffect(() => {
    context.resetSession();
    setCrisisActive(false);
    // Abort any in-flight stream from the previous dialogue
    abortRef.current?.abort();
  }, [dialogueId]);

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!dialogueId) { setDialogue(null); return; }
    const refresh = () => {
      void AIDialogueService.get(dialogueId).then(async d => {
        setDialogue(d ?? null);
        // Hydrate the sticky note from the dialogue's linked document so a
        // reloaded note-dialogue stays grounded (note re-injected, facets/memory
        // suppressed) without the user re-attaching.
        if (d?.documentId && !context.getAttachedNote()) {
          try {
            const content = await LocalVersionService.getLatestContent(d.documentId);
            if (content) context.setAttachedNote({ content, documentId: d.documentId });
          } catch { /* non-critical */ }
        }
      });
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
  const sendMessage = useCallback(async (text: string, attached?: { content: string; documentId?: string; inline?: boolean }, mood?: string): Promise<string | null> => {
    if (!text.trim()) return null;
    // R-1: Synchronous re-entrancy guard — prevents two calls in the same tick
    // from both proceeding past the isLoading check (state isn't committed yet).
    if (sendingRef.current) return null;
    sendingRef.current = true;

    if (!navigator.onLine) {
      sendingRef.current = false;
      setError(t('ai_error_offline'));
      return null;
    }

    const { remaining } = useAiLimitStore.getState();
    if (remaining <= 0) {
      // R-1: reset the guard on this early return — the try/finally that clears
      // it hasn't started yet, so without this sendMessage would deadlock after
      // the first limit hit.
      sendingRef.current = false;
      setDailyLimitExhausted();
      setError('Дневной лимит достигнут');
      return null;
    }

    setIsLoading(true);
    setStreamingMessage(null); setStreamingReasoning(null);
    setError(null);

    // Stop button: fresh controller per send; stop() aborts this one.
    // R-1: Abort any previous in-flight controller before overwriting the ref,
    // so a re-entrant call doesn't orphan the first stream.
    if (abortRef.current) { abortRef.current.abort(); }
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

            // Sticky note: remember a freshly attached note, and reuse it on follow-up
      // turns that don't re-attach so the note stays the subject of the dialogue.
      if (attached) {
        const note: { content: string; documentId?: string } = { content: attached.content };
        if (attached.documentId !== undefined) {
          note.documentId = attached.documentId;
        }
        context.setAttachedNote(note);
      }
      const effectiveAttached = attached ?? context.getAttachedNote() ?? undefined;

      // SAFETY: user asks to analyze "their note" but no note text is actually in
      // context (attach didn't fire / not re-sent). Never fabricate a note from
      // profile themes — suppress facets/memory and force the model to ask for the
      // text instead. This is the catastrophic case (it invented a whole fake note).
      const noteAnalysisIntent = /(заметк|запис|аскез)/i.test(text) && /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i.test(text);
      const noteIntentNoText = !effectiveAttached?.content && noteAnalysisIntent;

      // For attached notes the last user message goes to the API as a short
      // marker; the full note text travels via documentContent (see below).
      // Build the API history from the FRESHEST stored state (not the closure),
      // so regenerate (which trims the trailing turn before re-sending) doesn't
      // replay the old answer as context. Append the current user turn.
      const freshBase = dialogueId ? await AIDialogueService.get(dialogueId) : null;
      const baseMessages = freshBase ? freshBase.messages : (dialogue?.messages ?? []);
      const sourceForApi: AIMessage[] = [...baseMessages, { role: 'user' as const, content: text, type: 'chat' as const }];
      // Collapse any oversized attachment body so no single API message exceeds the
      // 10K per-message cap (the full note travels via documentContent instead).
      const apiMessages = pruneMessages(sourceForApi.filter(m => m.type !== 'system'))
        .map(m => ({ ...m, content: toApiContent(m.content) }));

      const isFirstTurn = baseMessages.filter(m => m.type !== 'system').length === 0;

      const { userPortrait, customPersona, searchContext: rawSearchContext } = await context.buildContext({
        text,
        attached: effectiveAttached ? (
          effectiveAttached.documentId !== undefined
            ? { content: effectiveAttached.content, documentId: effectiveAttached.documentId }
            : { content: effectiveAttached.content }
        ) : null,
        mood,
        messageHistory: apiMessages,
        isFirstTurn,
      });

      // Inject today's date so the model can reason about "вчера", "на этой неделе" etc.
      const todayRu = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let searchContext = rawSearchContext
        ? `[Сегодня: ${todayRu}]\n\n${rawSearchContext}`
        : `[Сегодня: ${todayRu}]`;

      // Defensive clamps — never exceed the API schema limits (documentContent
      // 50K, userPortrait 100K), or the request 400s before reaching the model.
      if (searchContext && searchContext.length > 49_000) searchContext = searchContext.slice(0, 49_000);
      const safePortrait = userPortrait && userPortrait.length > 99_000 ? userPortrait.slice(0, 99_000) : userPortrait;
      const customSystemPrompt = customPersona;
      const effectivePersonaId = customPersona ? 'custom' : personaId;

      // AX-11: Migrate old 'reasoning' value in stored dialogues
      const storedLength = dialogue?.responseLength;
      const isLegacyReasoning = storedLength === 'reasoning' as unknown as 'short' | 'standard' | 'detailed';
      const effectiveResponseLength: 'short' | 'standard' | 'detailed' =
        isLegacyReasoning ? 'standard' : (storedLength || responseLength || 'standard');
      const effectiveReasoning = dialogue?.reasoning ?? reasoning ?? isLegacyReasoning;

      let fullText: string;

      if (Date.now() < _streamUnavailableUntil) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait: safePortrait, responseLength: effectiveResponseLength, reasoning: effectiveReasoning });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: apiMessages,
            documentContent: searchContext,
            documentMood: mood,
            userPortrait: safePortrait,
            responseLength: effectiveResponseLength,
            reasoning: effectiveReasoning,
            signal: controller.signal,
            onChunk: (partial, reasoning) => {
              setStreamingMessage(partial);
              setStreamingReasoning(reasoning);
            },
          });
        } catch (e: unknown) {
          // Don't fall back to the callable if the user aborted on purpose.
          if (controller.signal.aborted) throw new Error('ABORTED');
          reportError(e, { action: 'Streaming chat failed, falling back to callable chat' });
          const errMsg = e instanceof Error ? e.message : '';
          if (errMsg !== 'DAILY_LIMIT' && errMsg !== 'AUTH_REQUIRED' && errMsg !== 'GLOBAL_LIMIT') {
            // Note: streaming already consumed a daily limit slot via checkAndIncrementLimit.
            // The callable fallback will consume another slot. We accept the double-count
            // to avoid losing the user's message, but this means fallback costs 2 quota.
            fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait: safePortrait, responseLength: effectiveResponseLength, reasoning: effectiveReasoning });
            // RSN-4: Parse reasoning from callable fallback
            if (effectiveReasoning) {
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
        let actualName = personaName;
        let actualEmoji = personaEmoji;
        if (!preset) {
          try {
            const custom = await AIPersonaService.getCustom(personaId);
            if (custom) {
              actualName = custom.name;
              actualEmoji = custom.emoji;
            }
          } catch {}
        }
        const title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        currentDialogue = await AIDialogueService.create({
          title,
          personaId,
          personaName: actualName,
          personaEmoji: actualEmoji,
          messages: [],
          responseLength: effectiveResponseLength,
          reasoning: effectiveReasoning,
        });
      }

      // RSN-4: Clean reasoning tags before saving; persist reasoning separately
      // so the collapsible "ход мысли" survives in dialogue history.
      const savedText = effectiveReasoning ? extractAnswer(fullText) : fullText;
      const savedReasoning = effectiveReasoning ? extractReasoning(fullText) : undefined;
      await AIDialogueService.appendMessage(currentDialogue.id, text, savedText, savedReasoning);
      // Link the dialogue to the attached note so it stays grounded after reload.
      if (attached?.documentId && attached.documentId.startsWith('local_')) {
        await AIDialogueService.setDocumentId(currentDialogue.id, attached.documentId);
      }
      // CHATFIX-3: Extract memory every 3rd turn, not every turn
      context.incrementMessageCount();
      if (context.getMessageCount() % 3 === 0) {
        // Strip attachment bodies — memory extraction goes to an AI endpoint with
        // the same per-message cap, and raw note text shouldn't be stored anyway.
        const memMessages = allMessages.map(m => ({ ...m, content: toApiContent(m.content) }));
        void AIChatMemoryService.extractFromDialogue(currentDialogue.id, memMessages);
      }
      const updated = await AIDialogueService.get(currentDialogue.id);
      setDialogue(updated ?? null);
      setStreamingMessage(null); setStreamingReasoning(null);

      // OPT-3: Auto-name the dialogue via LLM after the first exchange.
      // callType: 'auto_name' — server skips per-user quota, global guard still applies.
      if (wasNew) {
        void AIService.chat({
          personaId: 'coach',
          callType: 'auto_name',
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
      else if (msg === 'GLOBAL_LIMIT') { setError('Лимит приложения исчерпан — попробуйте позже'); }
      else if (msg === 'AUTH_REQUIRED') setError('Требуется регистрация');
      else if (msg === 'EMPTY_RESPONSE') setError('ИИ не ответил — сервис временно недоступен (возможно, исчерпан лимит). Попробуйте позже.');
      else setError('Произошла ошибка при отправке сообщения');
      return null;
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
    }
  }, [dialogue, dialogueId, personaId, responseLength, reasoning, language, t]);

  // Load a note's latest text without sending — lets the UI stage an attachment
  // (show a chip) so the user can add their own message before sending.
  const prepareAttachment = useCallback(async (documentId: string): Promise<{ title: string; content: string } | null> => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return null;
      const content = await LocalVersionService.getLatestContent(documentId);
      if (!content) return null;
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

  const dismissCrisis = useCallback(() => setCrisisActive(false), []);

  // AX-7: "Ответить иначе" — save the old answer as a variant, then regenerate.
  // Previous variants are preserved so the user can browse ‹ 2/3 › after several
  // regenerations. Nothing is lost.
  const regenerateLast = useCallback(async () => {
    if (isLoading) return;
    const id = dialogueId ?? dialogue?.id;
    if (!id) return;
    const d = await AIDialogueService.get(id);
    if (!d) return;
    const msgs = d.messages;
    let aiIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'assistant' && m.type !== 'system') { aiIdx = i; break; }
    }
    if (aiIdx < 0) return;
    let userIdx = -1;
    for (let i = aiIdx - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const userText = msgs[userIdx]?.content ?? '';
    if (!userText) return;

    // Save the current answer as a variant before truncating
    const oldAssistant = msgs[aiIdx];
    const oldVariants = oldAssistant?.variants ?? [];
    const oldContent = oldAssistant?.content ?? '';
    const savedVariants = [...oldVariants, oldContent];

    await AIDialogueService.truncateFrom(id, userIdx);
    const newId = await sendMessage(userText);
    // After the new response is saved, merge variants including the new response
    if (newId) {
      const updated = await AIDialogueService.get(newId);
      let newContent = '';
      if (updated) {
        for (let i = updated.messages.length - 1; i >= 0; i--) {
          const m = updated.messages[i];
          if (m && m.role === 'assistant' && m.type !== 'system') { newContent = m.content; break; }
        }
      }
      const allVariants = [...savedVariants, newContent];
      await AIDialogueService.setLastAssistantVariants(newId, allVariants, allVariants.length - 1);
    }
  }, [isLoading, dialogueId, dialogue, sendMessage]);

  return { dialogue, isLoading, streamingMessage, streamingReasoning, error, sendMessage, attachDocument, prepareAttachment, stop, regenerateLast, crisisActive, dismissCrisis, clearError };
}
