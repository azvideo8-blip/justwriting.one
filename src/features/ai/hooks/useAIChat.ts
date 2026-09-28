import { useState, useCallback, useEffect, useRef } from 'react';
import { getCurrentUser } from '../../../core/auth';
import { getChatExtrasEnabled } from '../../../core/ai/chatExtrasPreference';
import type { AIDialogue } from '../../../core/storage/localDb';
import { AIDialogueService } from '../services/AIDialogueService';
import { PRESET_PERSONAS, AIPersonaService } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { useLanguage } from '../../../shared/i18n';
import { incrementDailyUsage, setDailyLimitExhausted } from './useDailyLimit';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { getLocalDb } from '../../../core/storage/localDb';
import type { AIMessage } from '../services/AIService';
import { AIService } from '../services/AIService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { reportError } from '../../../shared/errors/reportError';
import { reportAIDegradation } from '../utils/aiDegradationReporter';

import { useAIChatContext } from '../services/aiChatContext';
import {
  streamChat,
  callableChat,
  extractReasoning,
  extractAnswer,
  prepareApiMessages,
  toApiContent,
  API_MSG_CAP,
  _streamUnavailableUntil
} from '../utils/aiChatTransport';
import { sanitizeFirstSeenDates } from '../utils/dateGuard';
import { CITATION_RE, isRecognisedCitation, extractSearchRequest } from '../shared/citationPatterns';
import { setAIStage } from '../store/useAIStageStore';
import { aiErrorToText } from '../../../shared/ai/aiErrorUtils';
export { API_MSG_CAP };

interface UseAIChatReturn {
  dialogue: AIDialogue | null;
  isLoading: boolean;
  streamingMessage: string | null;
  streamingReasoning: string | null;
  error: string | null;
  sendMessage: (text: string, attached?: { content: string; documentId?: string; inline?: boolean }, mood?: string) => Promise<string | null>;
  attachDocument: (documentId: string) => Promise<void>;
  prepareAttachment: (documentId: string) => Promise<{ title: string; content: string; lastSessionAt?: number | undefined } | null>;
  stop: () => void;
  regenerateLast: () => Promise<void>;
  triggerForcedSearch: (query: string) => Promise<void>;
  crisisActive: boolean;
  dismissCrisis: () => void;
  clearError: () => void;
}

export function sanitizeCitations(text: string, injectedIds: string[]): string {
  const allowed = new Set(injectedIds);
  const UNRECOGNISED_MARKER = '\uE000';

  let cleaned = text.replace(CITATION_RE, (match, g1, g2) => {
    const id = g2 || g1 || '';
    if (isRecognisedCitation(match, id, allowed)) {
      return match.startsWith('[#') ? match : `[#${id}]`;
    }
    return UNRECOGNISED_MARKER;
  });

  // Clean up punctuation and whitespace around the removed citation.
  // A list of references ("Источники: [#a], [#b].") loses its separator with the
  // item, whichever position it held — otherwise dropping the first leaves
  // "Источники:, [#b]." and dropping the last leaves "[#a],.". These two must
  // run before the generic punctuation rule below, which would eat the wrong
  // comma first.
  cleaned = cleaned.replace(new RegExp(`${UNRECOGNISED_MARKER}\\s*,\\s*(?=\\[#)`, 'g'), '');
  cleaned = cleaned.replace(new RegExp(`,\\s*${UNRECOGNISED_MARKER}(?=\\s*(?:[.,;:?!]|$))`, 'gm'), '');
  cleaned = cleaned.replace(new RegExp(`\\s*${UNRECOGNISED_MARKER}\\s*([.,;:?!])`, 'g'), '$1');
  cleaned = cleaned.replace(new RegExp(`,\\s*${UNRECOGNISED_MARKER}`, 'g'), '');
  cleaned = cleaned.replace(new RegExp(`(-|\\*)\\s*${UNRECOGNISED_MARKER}`, 'g'), '$1');
  cleaned = cleaned.replace(new RegExp(`\\s*${UNRECOGNISED_MARKER}\\s*`, 'g'), ' ');
  cleaned = cleaned.replace(/ ([.,;:?!])/g, '$1');
  cleaned = cleaned.replace(/ {2,}/g, ' ');
  cleaned = cleaned.replace(/\(\s*\)/g, '');
  cleaned = cleaned.replace(/\[\s*\]/g, '');

  return cleaned.trim();
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
  // Log unexpected reasoning once per session
  const reasoningMismatchReportedRef = useRef(false);

  useEffect(() => {
    context.resetSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: setCrisisActive пишется ещё и по ответу модели. Здесь сброс при смене диалога, а не вывод значения
    setCrisisActive(false);
    // Abort any in-flight stream from the previous dialogue
    abortRef.current?.abort();
    // context is a stable ref-backed wrapper (same underlying refs across renders);
    // deliberately keyed on dialogueId only, matching the pre-refactor ref-based effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogueId]);

  // Abort stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- НЕ производное: у setDialogue девять писателей (загрузка, отправка, переименование, удаление). Здесь только сброс на null
    if (!dialogueId) { setDialogue(null); return; }
    const refresh = () => {
      void AIDialogueService.get(dialogueId).then(async d => {
        setDialogue(prev => {
          if (!d) return null;
          if (!prev || prev.id !== d.id) return d;
          // Merge: if prev has unsaved local/optimistic messages (e.g. sending or streaming),
          // preserve messages from prev that aren't yet in d
          if (prev.messages.length > d.messages.length) {
            const isPrefix = d.messages.every((m, idx) => m.content === prev.messages[idx]?.content && m.role === prev.messages[idx]?.role);
            if (isPrefix) {
              return {
                ...d,
                messages: prev.messages,
              };
            }
          }
          return d;
        });
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
    // context is a stable ref-backed wrapper; getAttachedNote/setAttachedNote are personaId-independent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      if (!active) return;
      const db = await getLocalDb();
      if (!active) return;
      const fresh = await db.get('aiDialogues', dialogueId);
      if (!active || !fresh) return;

      fresh.personaId = personaId;
      fresh.personaName = newPersonaName;
      fresh.personaEmoji = newPersonaEmoji;
      fresh.messages.push({
        role: 'assistant',
        content: `⚙️ [Смена персоны]: Теперь с вами общается ${newPersonaName}`,
        type: 'system',
      });
      fresh.updatedAt = Date.now();
      if (!active) return;
      await db.put('aiDialogues', fresh);
      if (active) setDialogue({ ...fresh });
    })();

    return () => { active = false; };
  }, [dialogueId, personaId, dialogue]);

  const clearError = useCallback(() => setError(null), []);

  // `attached.content` is the full note text routed through documentContent (50K),
  // so the model reads the whole note while the chat message stays small (just a
  // "[Прикреплена заметка: …]" marker plus any text the user typed). The note body
  const sendMessage = useCallback(async (
    text: string,
    attached?: { content: string; documentId?: string; inline?: boolean },
    mood?: string,
    forcedSearchQuery?: string,
    options?: { replaceFromIndex?: number },
  ): Promise<string | null> => {
    if (!text.trim() && !forcedSearchQuery) return null;
    // R-1: Synchronous re-entrancy guard — prevents two calls in the same tick
    // from both proceeding past the isLoading check (state isn't committed yet).
    if (sendingRef.current) return null;
    sendingRef.current = true;

    if (!navigator.onLine) {
      sendingRef.current = false;
      setError(t('ai_error_offline'));
      return null;
    }

    const storedLength = dialogue?.responseLength;
    const isLegacyReasoning = storedLength === 'reasoning' as unknown as 'short' | 'standard' | 'detailed';
    const effectiveReasoning = dialogue?.reasoning ?? reasoning ?? isLegacyReasoning;

    const cooldownUntil = Number(localStorage.getItem('jw_ai_cooldown_until') || '0');
    if (cooldownUntil > Date.now()) {
      const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      sendingRef.current = false;
      setError(`Слишком частые запросы. Подождите ${remainingSec} сек. перед следующей отправкой.`);
      return null;
    }

    const inflightUntil = Number(localStorage.getItem('jw_ai_inflight') || '0');
    if (inflightUntil > Date.now()) {
      sendingRef.current = false;
      setError('Слишком частые запросы. Подождите немного перед следующей отправкой.');
      return null;
    }

    const { remaining, reasoningRemaining } = useAiLimitStore.getState();
    const isExhausted = effectiveReasoning ? reasoningRemaining <= 0 : remaining <= 0;
    if (isExhausted) {
      // R-1: reset the guard on this early return — the try/finally that clears
      // it hasn't started yet, so without this sendMessage would deadlock after
      // the first limit hit.
      sendingRef.current = false;
      setDailyLimitExhausted(effectiveReasoning);
      setError(effectiveReasoning ? 'Лимит рассуждений исчерпан' : 'Дневной лимит достигнут');
      return null;
    }

    try {
      localStorage.setItem('jw_ai_inflight', String(Date.now() + 15_000));
    } catch { /* ignore */ }

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
      ? (text.trim() ? [...dialogue.messages, { role: 'user' as const, content: text, type: 'chat' as const }] : [...dialogue.messages])
      : (text.trim() ? [{ role: 'user' as const, content: text, type: 'chat' as const }] : []);

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
        messages: text.trim() ? [{ role: 'user', content: text, type: 'chat' }] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setDialogue(tempDialogue);
    }

    // SB-3: пара «вопрос + ответ» пишется один раз — в конце успешного прохода.
    // Поэтому исключение в середине стрима уносило из истории всё, что человек
    // уже видел. Эти три значения — страховка для catch: какой диалог, какой
    // показанный кусок и записан ли уже ход.
    let turnDialogueId: string | undefined = dialogueId ?? undefined;
    let shownPartial = '';
    let turnSaved = false;

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
      // A note carried over from the dialogue's link is NOT something the user
      // attached in this turn. Labelling it as attached made the assistant say
      // "in the note you attached…" about a note the user never sent.
      const stickyAttached = !attached && !!context.getAttachedNote();
      const effectiveAttached = attached ?? context.getAttachedNote() ?? undefined;

      // For attached notes the last user message goes to the API as a short
      // marker; the full note text travels via documentContent (see below).
      // Build the API history from the FRESHEST stored state (not the closure),
      // so regenerate (which trims the trailing turn before re-sending) doesn't
      // replay the old answer as context. Append the current user turn.
      // AX-11: Migrate old 'reasoning' value in stored dialogues
      const effectiveResponseLength: 'short' | 'standard' | 'detailed' =
        isLegacyReasoning ? 'standard' : (storedLength || responseLength || 'standard');

      let effectiveDialogueId = dialogueId;
      let currentDialogue = effectiveDialogueId ? await AIDialogueService.get(effectiveDialogueId) : null;
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
          } catch { /* non-critical */ }
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
        effectiveDialogueId = currentDialogue.id;
        turnDialogueId = currentDialogue.id;
        // Show the freshly created dialogue WITH the message the user just sent.
        // The stored record is deliberately empty — appendMessage writes the
        // user turn together with the answer — but handing that empty record to
        // the UI wiped the optimistic message, so from here until the model
        // replied the screen showed "Начните диалог" and the user's own text was
        // nowhere. That is the whole wait, half a minute of it.
        setDialogue(text.trim()
          ? { ...currentDialogue, messages: [{ role: 'user', content: text, type: 'chat' }] }
          : currentDialogue);
      }

      const baseMessages = options?.replaceFromIndex !== undefined
        ? currentDialogue.messages.slice(0, options.replaceFromIndex)
        : currentDialogue.messages;
      const sourceForApi: AIMessage[] = text.trim() ? [...baseMessages, { role: 'user' as const, content: text, type: 'chat' as const }] : [...baseMessages];
      const apiMessages = prepareApiMessages(sourceForApi);

      const isFirstTurn = baseMessages.filter(m => m.type !== 'system').length === 0;

      const {
        userPortrait,
        customPersona,
        searchContext: rawSearchContext,
        memoryContext,
        injectedDocumentIds,
        allowedFirstSeenDates,
        degradedReason,
      } = await context.buildContext({
        text,
        attached: effectiveAttached ? (
          effectiveAttached.documentId !== undefined
            ? { content: effectiveAttached.content, documentId: effectiveAttached.documentId }
            : { content: effectiveAttached.content }
        ) : null,
        mood,
        messageHistory: apiMessages,
        isFirstTurn,
        dialogueId: effectiveDialogueId,
        forcedSearchQuery,
        attachedIsSticky: stickyAttached,
      });

      setAIStage('answer');
      // Inject today's date so the model can reason about "вчера", "на этой неделе" etc.
      const todayRu = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let searchContext = rawSearchContext
        ? `[Сегодня: ${todayRu}]\n\n${rawSearchContext}`
        : `[Сегодня: ${todayRu}]`;

      // Defensive clamps — never exceed the API schema limits (documentContent
      // 50K, userPortrait 100K), or the request 400s before reaching the model.
      if (searchContext && searchContext.length > 49_000) searchContext = searchContext.slice(0, 49_000);
      const safePortrait = userPortrait && userPortrait.length > 4_000 ? userPortrait.slice(0, 4_000) : userPortrait;

      const customSystemPrompt = customPersona;
      const effectivePersonaId = customPersona ? 'custom' : personaId;

      // Response length and reasoning variables moved to top of sendMessage

      let fullText: string;

      if (Date.now() < _streamUnavailableUntil) {
        fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait: safePortrait, memoryContext, responseLength: effectiveResponseLength, reasoning: effectiveReasoning, signal: controller.signal });
      } else {
        try {
          fullText = await streamChat({
            personaId: effectivePersonaId,
            customSystemPrompt,
            messages: apiMessages,
            documentContent: searchContext,
            documentMood: mood,
            userPortrait: safePortrait,
            memoryContext,
            responseLength: effectiveResponseLength,
            reasoning: effectiveReasoning,

            signal: controller.signal,
            onChunk: (partial, reasoning) => {
              const cleanPartial = sanitizeFirstSeenDates(
                sanitizeCitations(partial, injectedDocumentIds || []),
                allowedFirstSeenDates || []
              );
              const cleanReasoning = reasoning
                ? sanitizeFirstSeenDates(
                    sanitizeCitations(reasoning, injectedDocumentIds || []),
                    allowedFirstSeenDates || []
                  )
                : null;
              setStreamingMessage(cleanPartial);
              setStreamingReasoning(cleanReasoning);
              shownPartial = cleanPartial;
            },
          });
        } catch (e: unknown) {
          // Don't fall back to the callable if the user aborted on purpose.
          if (controller.signal.aborted) throw new Error('ABORTED');
          // A handled fallback, not a failure: the callable path runs next and
          // usually answers. Logged as a warning so a provider hiccup does not
          // sit in the log looking like something broke.
          reportError(e, { action: 'Streaming chat failed, falling back to callable chat' }, 'warning');
          const errMsg = e instanceof Error ? e.message : '';
          const isUpstream = errMsg === 'UPSTREAM' || errMsg === 'UPSTREAM_ERROR' || errMsg === 'SERVICE_UNAVAILABLE' || errMsg.startsWith('UPSTREAM');
          if (!isUpstream && errMsg !== 'DAILY_LIMIT' && errMsg !== 'AUTH_REQUIRED' && errMsg !== 'GLOBAL_LIMIT' && errMsg !== 'RATE_LIMIT' && !errMsg.startsWith('RATE_LIMIT:')) {
            // #77: streaming already consumed a daily limit slot. The callable
            // fallback consumes another. Accepted by design: the residual case
            // after server-side refund-on-disconnect is a mid-stream network
            // drop, where generation work genuinely happened on both attempts.
            // Option A (charge-after-first-upstream-byte) would move billing
            // into the middle of the request and split the cooldown claim —
            // rejected for now; revisit if quota complaints appear.
            // to avoid losing the user's message, but this means fallback costs 2 quota.
            // AUDIT-M2: если стрим успел отдать существенный partial — не
            // перегенерируем (двойная оплата + потеря уже показанного текста).
            const lastPartial = streamingMessage ?? '';
            if (lastPartial.trim().length > 200) {
              fullText = lastPartial;
            } else {
              fullText = await callableChat({ personaId: effectivePersonaId, customSystemPrompt, messages: apiMessages, documentContent: searchContext, userPortrait: safePortrait, memoryContext, responseLength: effectiveResponseLength, reasoning: effectiveReasoning, signal: controller.signal });
            }
            // RSN-4: Parse reasoning and answer unconditionally from callable fallback
            const cleanReasoning = extractReasoning(fullText);
            const cleanAnswer = extractAnswer(fullText);

            if (cleanReasoning) {
              setStreamingReasoning(
                sanitizeFirstSeenDates(
                  sanitizeCitations(cleanReasoning, injectedDocumentIds || []),
                  allowedFirstSeenDates || []
                )
              );
            }
            if (cleanAnswer) {
              setStreamingMessage(
                sanitizeFirstSeenDates(
                  sanitizeCitations(cleanAnswer, injectedDocumentIds || []),
                  allowedFirstSeenDates || []
                )
              );
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

      incrementDailyUsage(effectiveReasoning);
      try {
        localStorage.setItem('jw_ai_cooldown_until', String(Date.now() + 10_000));
      } catch { /* ignore */ }

      const wasNew = !dialogueId;

      // RSN-4: Clean reasoning tags before saving; persist reasoning separately
      // so the collapsible "ход мысли" survives in dialogue history.
      const searchReq = extractSearchRequest(fullText);
      const sanitizedFullText = sanitizeFirstSeenDates(
        sanitizeCitations(fullText, injectedDocumentIds || []),
        allowedFirstSeenDates || []
      );
      let savedText = extractAnswer(sanitizedFullText);
      let savedReasoning = extractReasoning(sanitizedFullText);

      // Log the mismatch if reasoning markers arrived when reasoning mode was off (once per session)
      if (!effectiveReasoning && savedReasoning) {
        if (!reasoningMismatchReportedRef.current) {
          reasoningMismatchReportedRef.current = true;
          reportError(
            new Error('REASONING_LEAK: unexpected reasoning markers in response when reasoning=false'),
            { action: 'useAIChat_reasoning_mismatch', personaId: effectivePersonaId },
            'warning'
          );
        }
      }

      // In reasoning mode the answer arrives after a marker. When none of them
      // ever appears, the model spent its whole output budget deliberating and
      // was cut off — publishing that as the reply showed the user a page of
      // "Мы получили два запроса… Я должен…" ending mid-word. Keep the
      // deliberation where it belongs and say plainly that no answer came.
      const hasAnswerSection = /<answer>|<\/think>|<\/reasoning>|(?:^|\n)ОТВЕТ:\s*/im.test(sanitizedFullText);
      if (effectiveReasoning && !hasAnswerSection && sanitizedFullText.trim()) {
        savedReasoning = sanitizedFullText.trim();
        savedText = 'Ответ не дошёл: я потратил весь лимит на рассуждение и оборвался на полуслове. Ход мысли сохранён ниже. Попробуй переспросить короче или выключить режим рассуждений.';
      }
      if (options?.replaceFromIndex !== undefined) {
        await AIDialogueService.replaceLastTurn(currentDialogue.id, options.replaceFromIndex, text, savedText, savedReasoning, searchReq, degradedReason);
      } else {
        await AIDialogueService.appendMessage(currentDialogue.id, text, savedText, savedReasoning, searchReq, degradedReason);
      }
      turnSaved = true;
      // Link the dialogue to the attached note so it stays grounded after reload.
      if (attached?.documentId && attached.documentId.startsWith('local_')) {
        await AIDialogueService.setDocumentId(currentDialogue.id, attached.documentId);
      }
      // CHATFIX-3: Extract memory every 3rd turn, not every turn
      context.incrementMessageCount();
      // EA-18: извлечение памяти — служебный запрос, выключается в настройках.
      if (context.getMessageCount() % 3 === 0 && getChatExtrasEnabled(getCurrentUser()?.uid)) {
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
          } else if (!res.ok) {
            reportAIDegradation({
              feature: 'chat_auto_name',
              cause: res.error,
              action: 'Автоматическое именование диалога',
              impact: 'Диалог сохранён со стандартным названием',
            });
          }
        }).catch(err => {
          reportAIDegradation({
            feature: 'chat_auto_name',
            cause: err,
            action: 'Автоматическое именование диалога',
            impact: 'Диалог сохранён со стандартным названием',
          });
        });
      }
      // Return the persisted dialogue id so the caller can select it (a new
      // dialogue must become active or it looks "lost" after navigation).
      return currentDialogue.id;
    } catch (e: unknown) {
      setStreamingMessage(null); setStreamingReasoning(null);
      const db = await getLocalDb();
      const fresh = (dialogueId && typeof dialogueId === 'string') ? await db.get('aiDialogues', dialogueId) : null;
      setDialogue(fresh ?? dialogue);
      const rawMsg = e instanceof Error ? e.message : 'SERVER_ERROR';

      // SB-3: показанное должно пережить обрыв. Если куски уже были на экране, а
      // ход не записан (исключение из стрима или из callable-повтора), сохраняем
      // его как есть — с честной пометкой, что ответ не дописан. Вопрос сам по
      // себе в поле ввода остаётся, но в дневнике хода не было вовсе.
      if (!turnSaved && turnDialogueId && text.trim() && shownPartial.trim()) {
        try {
          const interruptedMsg = `${shownPartial.trim()}\n\n[ответ не дописан — стрим оборвался]`;
          if (options?.replaceFromIndex !== undefined) {
            await AIDialogueService.replaceLastTurn(
              turnDialogueId,
              options.replaceFromIndex,
              text,
              interruptedMsg,
            );
          } else {
            await AIDialogueService.appendMessage(
              turnDialogueId,
              text,
              interruptedMsg,
            );
          }
          turnSaved = true;
        } catch (persistErr) {
          reportError(persistErr, { action: 'useAIChat_persistInterruptedTurn', dialogueId: turnDialogueId });
        }
      }

      if (rawMsg === 'ABORTED') {
        try { localStorage.removeItem('jw_ai_cooldown_until'); } catch { /* ignore */ }
        // user stopped — no error
        return null;
      }

      if (rawMsg === 'DAILY_LIMIT') {
        setDailyLimitExhausted(false);
      } else if (rawMsg === 'REASONING_LIMIT') {
        setDailyLimitExhausted(true);
      } else if (rawMsg === 'UPSTREAM' || rawMsg === 'UPSTREAM_ERROR' || rawMsg === 'SERVICE_UNAVAILABLE') {
        try { localStorage.removeItem('jw_ai_cooldown_until'); } catch { /* ignore */ }
        void useAiLimitStore.getState().loadLimitFromServer();
      }

      setError(aiErrorToText(rawMsg));
      return null;
    } finally {
      try { localStorage.removeItem('jw_ai_inflight'); } catch { /* ignore */ }
      sendingRef.current = false;
      setIsLoading(false);
      setAIStage(null);
    }
    // context excluded intentionally: buildContext reads current personaId, and personaId
    // is already a dep here, so sendMessage is recreated with a fresh context on persona change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogue, dialogueId, personaId, responseLength, reasoning, language, t]);

  // Load a note's latest text without sending — lets the UI stage an attachment
  // (show a chip) so the user can add their own message before sending.
  const prepareAttachment = useCallback(async (documentId: string): Promise<{ title: string; content: string; lastSessionAt?: number | undefined } | null> => {
    try {
      const doc = await LocalDocumentService.getDocument(documentId);
      if (!doc) return null;
      const content = await LocalVersionService.getLatestContent(documentId);
      if (!content) return null;
      return { title: doc.title || 'Без названия', content, lastSessionAt: doc.lastSessionAt };
    } catch (e) {
      reportError(e, { action: 'prepareAttachment', documentId });
      throw new Error('Не удалось загрузить документ (ошибка доступа к БД).');
    }
  }, []);

  // Attach + send in one step (used when opening chat from a note / facet draft).
  // The note text goes via documentContent; the message is just the marker.
  const attachDocument = useCallback(async (documentId: string) => {
    try {
      const prepared = await prepareAttachment(documentId);
      if (!prepared) { setError('Не удалось прикрепить документ'); return; }
      const marker = `[Прикреплена заметка: "${prepared.title}"]`;
      await sendMessage(marker, { content: prepared.content });
    } catch (e) {
      reportError(e, { action: 'attachDocument_failed', documentId });
      setError('Не удалось загрузить документ из-за ошибки доступа');
    }
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

    // Truncate dialogue in memory (React state) so sendMessage appends userText as a replacement turn,
    // but DO NOT truncate in IndexedDB yet so failures leave the stored dialogue intact.
    setDialogue({ ...d, messages: d.messages.slice(0, userIdx) });
    const newId = await sendMessage(userText, undefined, undefined, undefined, { replaceFromIndex: userIdx });
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

  const triggerForcedSearch = useCallback(async (query: string) => {
    await sendMessage('', undefined, undefined, query);
  }, [sendMessage]);

  return { dialogue, isLoading, streamingMessage, streamingReasoning, error, sendMessage, attachDocument, prepareAttachment, stop, regenerateLast, triggerForcedSearch, crisisActive, dismissCrisis, clearError };
}
