import { useState, useCallback, useRef, useEffect } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { AIService } from '../services/AIService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { TelemetryService } from '../../../core/services/TelemetryService';
import { getLocalDb } from '../../../core/storage/localDb';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { useAdminStatus } from '../../auth/hooks/useAdminStatus';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import { reportError } from '../../../shared/errors/reportError';

import { useDialogueManager } from './useDialogueManager';
import { usePersonaManager } from './usePersonaManager';
import { useAttachmentManager } from './useAttachmentManager';
import { NOTE_REF_RE, NOTE_VERB_RE } from '../utils/noteAutoAttacher';
import { searchNotes } from '../utils/noteRetriever';
import { getCurrentUser } from '../../../core/auth';
import { getChatExtrasEnabled } from '../../../core/ai/chatExtrasPreference';
import { DataProvider } from '../../../core/data';
import { getIndexingConsent, setIndexingConsent, INDEXING_CONSENT_VERSION } from '../../../core/ai/indexingConsent';
import { indexPending } from '../utils/embeddingIndexer';
import { looksLikeNoteSearch } from '../utils/aiChatTransport';
import { useLanguage } from '../../../shared/i18n';

type ResponseLength = 'short' | 'standard' | 'detailed';

const MAX_INPUT_CHARS = 10_000;
const EMPTY_MESSAGES: readonly never[] = [];

export const CHAT_STARTERS = [
  'Разобрать мой сегодняшний день',
  'Помоги копнуть глубже в то, что беспокоит',
  'Просто хочу выговориться',
];
export const CHAT_FOLLOW_UPS = [
  'Расскажи об этом подробнее',
  'А что мне с этим делать?',
  'Помоги увидеть это под другим углом',
];

export function useAIPageData(linkedDocId?: string, draftFacetId?: string) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog, alert: alertDialog, prompt: promptDialog } = useConfirmDialog();

  const [inputText, setInputText] = useState('');
  const [responseLength, setResponseLength] = useState<ResponseLength>('standard');
  const [reasoning, setReasoning] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  const dailyLimit = useDailyLimit();

  const dialogueManager = useDialogueManager({ confirmDialog });
  const {
    dialogues,
    archivedDialogues,
    activeDialogueId,
    setActiveDialogueId,
    showArchived,
    setShowArchived,
    loadDialogues,
    handleRenameDialogue,
    handleArchive,
    handleUnarchive,
    handleDelete,
    handleExport,
  } = dialogueManager;

  const personaManager = usePersonaManager();
  const {
    selectedPersonaId,
    setSelectedPersonaId,
    customPersonas,
    createPersonaOpen,
    setCreatePersonaOpen,
    detailPersona,
    setDetailPersona,
    loadCustomPersonas,
    allPersonas,
    openPersonaDetail,
  } = personaManager;

  const {
    dialogue,
    isLoading,
    streamingMessage,
    streamingReasoning,
    error,
    sendMessage,
    prepareAttachment,
    stop,
    regenerateLast,
    crisisActive,
    dismissCrisis,
    clearError,
    triggerForcedSearch,
  } = useAIChat(activeDialogueId, selectedPersonaId, responseLength, reasoning);

  const attachmentManager = useAttachmentManager({
    prepareAttachment,
    sendMessage,
    activeDialogueId,
    setActiveDialogueId,
    loadDialogues,
    alertDialog,
    inputText,
    setInputText,
  });
  const {
    docPickerOpen,
    setDocPickerOpen,
    attachMenuOpen,
    setAttachMenuOpen,
    pendingAttachments,
    setPendingAttachments,
    fileInputRef,
    attachMenuRef,
    removePendingAttachment,
    handlePasteAsNote,
    handleDocSelect,
    handleFileUpload,
  } = attachmentManager;

  const { isAdmin } = useAdminStatus();

  useEffect(() => {
    useAiLimitStore.getState().setAdmin(isAdmin);
  }, [isAdmin]);

  const handleNewDialogue = useCallback(() => {
    setActiveDialogueId(null);
    setInputText('');
    setPendingAttachments([]);
  }, [setActiveDialogueId, setPendingAttachments]);

  const [proactiveHint, setProactiveHint] = useState<string | null>(null);
  const proactiveShownRef = useRef(false);


  const [followUps, setFollowUps] = useState<string[]>(CHAT_FOLLOW_UPS);
  const lastFollowUpKeyRef = useRef('');
  const [starters, setStarters] = useState<string[]>(CHAT_STARTERS);

  useEffect(() => {
    void (async () => {
      if (!linkedDocId) {
        setStarters(CHAT_STARTERS);
        return;
      }
      try {
        const db = await getLocalDb();
        const summary = await db.get('aiSummaries', linkedDocId);
        if (summary && summary.themes?.length) {
          const themes = summary.themes;
          const dynamicStarters = themes.slice(0, 3).map((theme: string) => {
            const t = theme.toLowerCase();
            if (t.includes('выгоран') || t.includes('устал') || t.includes('стресс') || t.includes('работ')) {
              return `Помоги найти причины усталости и выгорания в этой записи`;
            }
            if (t.includes('отношен') || t.includes('семь') || t.includes('друг') || t.includes('любов')) {
              return `Разбери динамику отношений, описанную в этой заметке`;
            }
            if (t.includes('творчеств') || t.includes('иде') || t.includes('проект') || t.includes('книг')) {
              return `Помоги развить творческие идеи из этой записи`;
            }
            if (t.includes('страх') || t.includes('тревог') || t.includes('беспокойств')) {
              return `Помоги разобраться с тревогой и страхами в этом тексте`;
            }
            return `Давай обсудим тему «${theme}» из этой заметки`;
          });
          setStarters(dynamicStarters);
        } else {
          setStarters(CHAT_STARTERS);
        }
      } catch (e) {
        console.warn('[useAIPageData] failed to load custom starters:', e);
        setStarters(CHAT_STARTERS);
      }
    })();
  }, [linkedDocId]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setTimeout(() => {
      void loadDialogues();
      void AIDialogueService.cleanupEmpty().then(n => { if (n > 0) void loadDialogues(); });
      void AIChatMemoryService.cleanupDuplicates();
      void loadCustomPersonas();
      void TelemetryService.maybeSendTelemetry();
      if (!proactiveShownRef.current) {
        proactiveShownRef.current = true;
        void (async () => {
          try {
            const lastShown = localStorage.getItem('proactive_last_shown');
            if (lastShown && (Date.now() - parseInt(lastShown, 10)) < 86_400_000) return;
            const facets = await AIProfileFacetService.getAll();
            const now = Date.now();
            const dayMs = 86_400_000;
            const faded = facets
              .filter(f => f.lastAt !== undefined && f.noteCount >= 3 && (now - f.lastAt) > 14 * dayMs && (now - f.lastAt) < 90 * dayMs)
              .sort((a, b) => (b.noteCount ?? 0) - (a.noteCount ?? 0))
              .slice(0, 1);
            if (faded.length > 0) {
              const f = faded[0]!;
              const daysAgo = Math.round((now - f.lastAt) / dayMs);
              setProactiveHint(`Тема «${f.label}» была активна ${daysAgo} дн. назад — хочешь вернуться к ней?`);
              localStorage.setItem('proactive_last_shown', String(Date.now()));
            }
          } catch { /* non-critical */ }
        })();
      }
    }, 0);
    if (linkedDocId) void prepareAttachment(linkedDocId).then(p => {
      if (p) setPendingAttachments([{ documentId: linkedDocId, title: p.title, content: p.content }]);
    }).catch(e => reportError(e, { action: 'useAIPageData/prepareAttachment', documentId: linkedDocId }));
  }, [loadDialogues, loadCustomPersonas, linkedDocId, prepareAttachment, setPendingAttachments]);

  const draftFacetHandledRef = useRef(false);
  useEffect(() => {
    if (!draftFacetId || draftFacetHandledRef.current) return;
    draftFacetHandledRef.current = true;
    void (async () => {
      try {
        const facet = (await AIProfileFacetService.getAll()).find(f => f.id === draftFacetId);
        if (!facet) return;
        setSelectedPersonaId('cbt');
        handleNewDialogue();
        setInputText(
          `Давай разберём тему «${facet.label}». Вот что я про неё писал — помоги увидеть паттерн и что с этим делать.`
        );

        const noteIdsToUse = facet.primaryNoteIds && facet.primaryNoteIds.length > 0
          ? facet.primaryNoteIds
          : facet.noteIds;

        const db = await getLocalDb();
        const docs = await Promise.all(
          noteIdsToUse.map(async id => {
            try {
              const doc = await db.get('documents', id);
              return { id, lastSessionAt: doc?.lastSessionAt ?? 0 };
            } catch {
              return { id, lastSessionAt: 0 };
            }
          })
        );
        // Sort descending by lastSessionAt (most-recent first)
        docs.sort((a, b) => b.lastSessionAt - a.lastSessionAt);
        const sortedIds = docs.map(d => d.id).slice(0, 5);

        const notes: { documentId: string; title: string; content: string; lastSessionAt?: number | undefined }[] = [];
        for (const noteId of sortedIds) {
          try {
            const p = await prepareAttachment(noteId);
            if (p) notes.push({ documentId: noteId, title: p.title, content: p.content, lastSessionAt: p.lastSessionAt });
          } catch (e) {
            reportError(e, { action: 'useAIPageData/prepareAttachment', documentId: noteId });
          }
        }
        setPendingAttachments(notes);
      } catch (e) {
        reportError(e, { action: 'use_ai_page_data_draft_facet' });
      }
    })();
  }, [draftFacetId, prepareAttachment, handleNewDialogue, setSelectedPersonaId, setPendingAttachments]);

  const executeSendMessage = useCallback(async (text: string, overrideText?: string) => {
    let attaches: { documentId: string; title: string; content: string; lastSessionAt?: number | undefined }[] = [...pendingAttachments];
    if (attaches.length === 0 && text && NOTE_REF_RE.test(text) && NOTE_VERB_RE.test(text)) {
      try {
        const matches = text.match(NOTE_REF_RE);
        const term = matches?.[1] || '';
        const index = await searchNotes(term, 1);
        if (index[0]) {
          const docId = index[0].documentId;
          try {
            const p = await prepareAttachment(docId);
            if (p) attaches = [{ documentId: docId, title: p.title, content: p.content, lastSessionAt: p.lastSessionAt }];
          } catch (e) {
            console.error('useAIPageData/prepareAttachment failed for', docId, e);
          }
        }
      } catch { /* ignore fallback */ }
    }

    const prevPending = pendingAttachments;
    if (overrideText === undefined) setInputText('');
    setPendingAttachments([]);

    let id: string | null;
    if (attaches.length > 0) {
      const markers = attaches.map(a => `[Прикреплена заметка: "${a.title}"]`);
      const firstLocalDocId = attaches.find(a => a.documentId.startsWith('local_'))?.documentId;

      const formatRefTag = (a: { documentId: string; lastSessionAt?: number | undefined; title: string; content: string }) => {
        const yyyymmdd = a.lastSessionAt ? new Date(a.lastSessionAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        return `[#${a.documentId} · ${yyyymmdd}]\n[Прикреплена заметка: "${a.title}"]\n${a.content}`;
      };

      const totalContent = attaches.map(formatRefTag).join('\n\n---\n\n');
      const totalChars = attaches.reduce((s, a) => s + a.content.length, 0);
      const fits = totalChars <= 9000;

      if (attaches.length === 1) {
        const a = attaches[0]!;
        const marker = markers[0]!;
        const display = fits
          ? `${formatRefTag(a)}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`
          : (text ? `${marker}\n\n${text}` : marker);
        id = await sendMessage(display, { content: formatRefTag(a), ...(firstLocalDocId ? { documentId: firstLocalDocId } : {}), inline: fits });
      } else {
        const display = fits
          ? `${totalContent}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`
          : `${markers.join('\n')}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`;
        id = await sendMessage(display, { content: totalContent, ...(firstLocalDocId ? { documentId: firstLocalDocId } : {}), inline: fits });
      }
    } else {
      id = await sendMessage(text);
    }

    if (id) {
      if (!activeDialogueId) setActiveDialogueId(id);
      await loadDialogues();
    } else {
      if (overrideText === undefined) setInputText(text);
      if (prevPending.length > 0) setPendingAttachments(prevPending);
    }
  }, [pendingAttachments, prepareAttachment, sendMessage, activeDialogueId, setActiveDialogueId, loadDialogues, setInputText, setPendingAttachments]);

  const [indexingModalOpen, setIndexingModalOpen] = useState(false);
  const pendingSearchActionRef = useRef<(() => Promise<void>) | null>(null);

  const checkIndexingConsentOrProceed = useCallback(async (action: () => Promise<void>, text?: string) => {
    const uid = getCurrentUser()?.uid;
    const consentState = getIndexingConsent(uid);
    const isSearch = text ? looksLikeNoteSearch(text) : true;
    if (consentState === 'unanswered' && isSearch) {
      pendingSearchActionRef.current = action;
      setIndexingModalOpen(true);
      return;
    }
    await action();
  }, []);

  const handleGrantIndexingConsent = useCallback(async () => {
    setIndexingModalOpen(false);
    const uid = getCurrentUser()?.uid;
    setIndexingConsent(uid, 'granted');
    if (uid) {
      try {
        await DataProvider.updateProfile(uid, {
          indexingConsentAt: new Date(),
          indexingConsentVersion: INDEXING_CONSENT_VERSION,
        });
      } catch { /* ignore */ }
    }
    void indexPending();
    const action = pendingSearchActionRef.current;
    pendingSearchActionRef.current = null;
    if (action) await action();
  }, []);

  const handleRefuseIndexingConsent = useCallback(async () => {
    setIndexingModalOpen(false);
    const uid = getCurrentUser()?.uid;
    setIndexingConsent(uid, 'refused');
    const action = pendingSearchActionRef.current;
    pendingSearchActionRef.current = null;
    if (action) await action();
  }, []);

  const handleSendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && pendingAttachments.length === 0) || isLoading) return;

    if (looksLikeNoteSearch(text)) {
      await checkIndexingConsentOrProceed(async () => {
        await executeSendMessage(text, overrideText);
      }, text);
    } else {
      await executeSendMessage(text, overrideText);
    }
  }, [inputText, pendingAttachments, isLoading, executeSendMessage, checkIndexingConsentOrProceed]);

  const handleTriggerForcedSearch = useCallback(async (query: string) => {
    await checkIndexingConsentOrProceed(async () => {
      await triggerForcedSearch(query);
    }, query);
  }, [checkIndexingConsentOrProceed, triggerForcedSearch]);

  const handleSuggestion = (text: string) => { void handleSendMessage(text); };

  const handleFeedback = async (value: 'up' | 'down') => {
    if (value === 'up') {
      await AIChatMemoryService.addManual('preference', 'Пользователю понравился такой ответ (тон/подход) — продолжать в этом духе.', activeDialogueId ?? undefined);
      showToast('Учту — продолжу в этом стиле', 'success');
    } else {
      const reason = (await promptDialog({
        title: t('ai_feedback_prompt_title'),
        message: t('ai_feedback_prompt_message'),
        placeholder: t('ai_feedback_prompt_placeholder'),
      }))?.trim() ?? '';
      const text = reason
        ? `Пользователю не нравится в ответе: ${reason}. Скорректировать стиль.`
        : 'Пользователю не понравился такой ответ (тон/подход) — скорректировать стиль.';
      await AIChatMemoryService.addManual('preference', text, activeDialogueId ?? undefined);
      showToast(reason ? `Учту: меньше «${reason}»` : 'Учту — скорректирую стиль', 'success');
    }
  };

  const handleRegenerate = async () => {
    await regenerateLast();
    await loadDialogues();
  };

  const handleSwitchVariant = async (delta: number) => {
    const id = activeDialogueId ?? dialogue?.id;
    if (!id) return;
    const msgs = displayMessages;
    let aiIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === 'assistant' && m.type !== 'system') { aiIdx = i; break; }
    }
    if (aiIdx < 0) return;
    const msg = msgs[aiIdx];
    if (!msg?.variants || msg.variants.length <= 1) return;
    const currentIdx = msg.variantIndex ?? msg.variants.length - 1;
    const newIdx = Math.max(0, Math.min(msg.variants.length - 1, currentIdx + delta));
    if (newIdx === currentIdx) return;
    await AIDialogueService.switchVariant(id, newIdx);
    await loadDialogues();
  };

  const handleSetResponseLength = useCallback(async (length: ResponseLength) => {
    setResponseLength(length);
    const did = activeDialogueId ?? dialogue?.id;
    if (did) {
      await AIDialogueService.updateResponseLength(did, length, reasoning);
      await loadDialogues();
    }
  }, [activeDialogueId, dialogue, reasoning, loadDialogues]);

  const handleSetReasoning = useCallback(async (value: boolean) => {
    if (value) {
      const ok = await confirmDialog({
        title: t('ai_reasoning_mode_confirm_title'),
        // D-7: число берётся из того же лимита, который действительно действует
        // (сервер отдаёт свой в заголовке ответа), иначе окно врёт про квоту.
        message: t('ai_reasoning_mode_confirm_message', {
          limit: useAiLimitStore.getState().reasoningLimit,
        }),
        confirmLabel: t('ai_reasoning_mode_confirm_label'),
        destructive: false,
      });
      if (!ok) return;
    }
    setReasoning(value);
    const did = activeDialogueId ?? dialogue?.id;
    if (did) {
      await AIDialogueService.updateResponseLength(did, responseLength, value);
      await loadDialogues();
    }
  }, [activeDialogueId, dialogue, responseLength, loadDialogues, confirmDialog, t]);

  const handleCopyMessage = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  const handleDeleteMessage = async (index: number) => {
    const id = activeDialogueId ?? dialogue?.id;
    if (!id) return;
    const ok = await confirmDialog({
      title: t('ai_delete_message_confirm_title'),
      message: t('ai_delete_message_confirm_message'),
    });
    if (!ok) return;
    await AIDialogueService.deleteMessage(id, index);
    await loadDialogues();
  };

  const activeDialogue = dialogue ?? dialogues.find(d => d.id === activeDialogueId) ?? null;
  const displayMessages = activeDialogue?.messages ?? EMPTY_MESSAGES;

  const activePersona = allPersonas.find(p => p.id === selectedPersonaId) ?? allPersonas[0];
  const activeRole = usePersonaRole(selectedPersonaId, activePersona?.name ?? '');
  const headerVisual = personaVisual(selectedPersonaId, activePersona?.name ?? '');
  const convPersonaId = activeDialogue?.personaId ?? selectedPersonaId;
  const convPersonaName = activeDialogue?.personaName ?? activePersona?.name ?? '';
  const convVisual = personaVisual(convPersonaId, convPersonaName);

  useEffect(() => {
    let nextVal = activeDialogue?.responseLength ?? 'standard';
    let nextReasoning = activeDialogue?.reasoning ?? false;
    if (nextVal === 'reasoning' as unknown as ResponseLength) {
      nextVal = 'standard';
      nextReasoning = true;
    }
    void Promise.resolve().then(() => {
      setResponseLength(curr => curr !== nextVal ? nextVal : curr);
      setReasoning(curr => curr !== nextReasoning ? nextReasoning : curr);
    });
  }, [activeDialogue]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length, streamingMessage]);

  useEffect(() => {
    let lastAssistant: string | null = null;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') { lastAssistant = m.content; break; }
    }
    const key = `${activeDialogueId ?? 'new'}:${displayMessages.length}:${lastAssistant?.slice(0, 100) ?? 'none'}`;
    if (key === lastFollowUpKeyRef.current) return;
    lastFollowUpKeyRef.current = key;
    if (!lastAssistant) return;
    // EA-18: служебный запрос подсказок — только если человек их не выключил.
    if (!getChatExtrasEnabled(getCurrentUser()?.uid)) return;
    void AIService.chat({
      personaId: 'coach',
      callType: 'follow_up',
      messages: [{ role: 'user', content: `Предложи 3 коротких варианта следующего сообщения пользователя (1-5 слов каждое, по-русски, как будто пользователь пишет собеседнику). Контекст — последний ответ ИИ:\n\n${lastAssistant.slice(0, 800)}\n\nОтветь ТОЛЬКО JSON-массивом строк, без пояснений.` }],
    }).then(res => {
      if (res.ok && res.text) {
        try {
          const parsed = JSON.parse(res.text);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(s => typeof s === 'string')) {
            setFollowUps(parsed.slice(0, 3));
            return;
          }
        } catch { /* fall through to static */ }
      }
      setFollowUps(CHAT_FOLLOW_UPS);
    }).catch(() => setFollowUps(CHAT_FOLLOW_UPS));
  }, [displayMessages, activeDialogueId]);

  return {
    dialogues, archivedDialogues, activeDialogueId, setActiveDialogueId,
    selectedPersonaId, setSelectedPersonaId,
    showArchived, setShowArchived,
    customPersonas,
    inputText, setInputText,
    docPickerOpen, setDocPickerOpen,
    createPersonaOpen, setCreatePersonaOpen,
    detailPersona, setDetailPersona,
    attachMenuOpen, setAttachMenuOpen,
    messagesEndRef, fileInputRef, attachMenuRef,
    dialogue,
    isLoading,
    streamingMessage,
    streamingReasoning,
    error,
    clearError,
    stop,
    pendingAttachments, removePendingAttachment, handlePasteAsNote,
    handleSuggestion, handleFeedback, handleRegenerate, handleSwitchVariant,
    crisisActive, dismissCrisis,
    dailyLimit,
    loadDialogues, loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleUnarchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleDeleteMessage, handleFileUpload,
    triggerForcedSearch: handleTriggerForcedSearch,
    indexingModalOpen,
    handleGrantIndexingConsent,
    handleRefuseIndexingConsent,
    allPersonas, openPersonaDetail,
    activeDialogue, displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaId, convPersonaName, convVisual,
    handleSetResponseLength, handleSetReasoning, handleRenameDialogue,
    responseLength,
    reasoning,
    proactiveHint,
    followUps,
    starters,
    MAX_INPUT_CHARS,
  };
}
