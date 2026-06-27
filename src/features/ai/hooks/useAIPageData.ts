import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { AIService } from '../services/AIService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { useToast } from '../../../shared/components/Toast';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { TelemetryService } from '../../../core/services/TelemetryService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { useProfile } from '../../auth/contexts/ProfileContext';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import type { PersonaDetailTarget } from '../components/PersonaDetailModal';
import { reportError } from '../../../shared/errors/reportError';

type ResponseLength = 'short' | 'standard' | 'detailed';

const MAX_INPUT_CHARS = 10_000;
const EMPTY_MESSAGES: readonly never[] = [];

// Conversation starters (empty chat) and follow-up suggestions (after a reply).
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

// Auto-pull: "разбери/прочитай (мою)? (последнюю|сегодняшнюю|вчерашнюю|свежую)? заметку/аскезу"
const NOTE_REF_RE = /(заметк|запис|аскез)/i;
const NOTE_VERB_RE = /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i;
type DocLite = { id: string; title?: string | undefined; lastSessionAt?: number; firstSessionAt?: number };
function sameCalendarDay(ms: number, ref: Date): boolean {
  const d = new Date(ms);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}
function pickNoteByText<T extends DocLite>(docs: T[], text: string): T | null {
  if (docs.length === 0) return null;
  const recent = [...docs].sort((a, b) => (b.lastSessionAt ?? b.firstSessionAt ?? 0) - (a.lastSessionAt ?? a.firstSessionAt ?? 0));
  const now = new Date();
  if (/сегодняшн|сегодня/i.test(text)) return recent.find(d => sameCalendarDay(d.lastSessionAt ?? d.firstSessionAt ?? 0, now)) ?? recent[0] ?? null;
  if (/вчерашн|вчера/i.test(text)) { const y = new Date(now); y.setDate(now.getDate() - 1); return recent.find(d => sameCalendarDay(d.lastSessionAt ?? d.firstSessionAt ?? 0, y)) ?? recent[0] ?? null; }
  return recent[0] ?? null; // последнюю / свежую / мою / эту → самая свежая
}

export function useAIPageData(linkedDocId?: string, draftFacetId?: string) {
  const { showToast } = useToast();
  const { confirm: confirmDialog, alert: alertDialog, prompt: promptDialog } = useConfirmDialog();
  const { profile } = useProfile();
  const [dialogues, setDialogues] = useState<AIDialogue[]>([]);
  const [archivedDialogues, setArchivedDialogues] = useState<AIDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('group_psychology');
  const [showArchived, setShowArchived] = useState(false);
  const [customPersonas, setCustomPersonas] = useState<AIPersona[]>([]);
  const [inputText, setInputText] = useState('');
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [detailPersona, setDetailPersona] = useState<PersonaDetailTarget | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [responseLength, setResponseLength] = useState<ResponseLength>('standard');
  const [reasoning, setReasoning] = useState(false);
  // AX-10: Multiple note attachments — array instead of single object
  const [pendingAttachments, setPendingAttachments] = useState<{ documentId: string; title: string; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const dailyLimit = useDailyLimit();
  const {
    dialogue,
    isLoading,
    streamingMessage,
    streamingReasoning,
    error,
    sendMessage,
    attachDocument,
    prepareAttachment,
    stop,
    regenerateLast,
    crisisActive,
    dismissCrisis,
    clearError,
  } = useAIChat(activeDialogueId, selectedPersonaId, responseLength, reasoning);

  // LX-2a: Sync admin role to the limit store so the client pre-check never blocks admins.
  useEffect(() => {
    useAiLimitStore.getState().setAdmin(profile?.role === 'admin');
  }, [profile?.role]);

  const loadDialogues = useCallback(async () => {
    const [active, archived] = await Promise.all([
      AIDialogueService.list({ includeArchived: false }),
      AIDialogueService.list({ includeArchived: true }),
    ]);
    setDialogues(active);
    setArchivedDialogues(archived.filter(d => d.archivedAt));
  }, []);

  const loadCustomPersonas = useCallback(async () => {
    const list = await AIPersonaService.listCustom();
    setCustomPersonas(list);
  }, []);

  const handleNewDialogue = useCallback(() => {
    setActiveDialogueId(null);
    setInputText('');
    setPendingAttachments([]);
  }, []);

  // THERAPY-4: Proactive contact point — check for faded topics on AI page load
  const [proactiveHint, setProactiveHint] = useState<string | null>(null);
  const proactiveShownRef = useRef(false);

  // AX-9: Auto-generated follow-up suggestions based on the last AI response
  const [followUps, setFollowUps] = useState<string[]>(CHAT_FOLLOW_UPS);
  const lastFollowUpKeyRef = useRef('');

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setTimeout(() => {
      void loadDialogues();
      void loadCustomPersonas();
      void TelemetryService.maybeSendTelemetry();
      // THERAPY-4: Check for faded topics (once per session, debounced)
      if (!proactiveShownRef.current) {
        proactiveShownRef.current = true;
        void (async () => {
          try {
            const lastShown = localStorage.getItem('proactive_last_shown');
            if (lastShown && (Date.now() - parseInt(lastShown, 10)) < 86_400_000) return; // once per day
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
    // Opening chat from a note stages it as a pending attachment (chip), so the
    // user can add a question before sending rather than auto-firing the note.
    if (linkedDocId) void prepareAttachment(linkedDocId).then(p => {
      if (p) setPendingAttachments([{ documentId: linkedDocId, title: p.title, content: p.content }]);
    });
  }, [loadDialogues, loadCustomPersonas, linkedDocId, prepareAttachment]);

  // TICKET-013: Handle draftFacet query param — pre-fill editor with facet data
  const draftFacetHandledRef = useRef(false);
  useEffect(() => {
    if (!draftFacetId || draftFacetHandledRef.current) return;
    draftFacetHandledRef.current = true;
    void (async () => {
      try {
        const facet = (await AIProfileFacetService.getAll()).find(f => f.id === draftFacetId);
        if (!facet) return;
        setSelectedPersonaId('editor');
        handleNewDialogue();
        setInputText(
          `Напиши вовлекающий пост для Telegram/блога на тему «${facet.label}» на основе связанных заметок. ` +
          `Инсайты для фокуса: ${facet.summary}`
        );
        // Attach facet notes to the new dialogue
        for (const noteId of facet.noteIds.slice(0, 5)) {
          await attachDocument(noteId);
        }
      } catch (e) {
        reportError(e, { action: 'use_ai_page_data_draft_facet' });
      }
    })();
  }, [draftFacetId, attachDocument, handleNewDialogue]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [attachMenuOpen]);

  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if ((!text && pendingAttachments.length === 0) || isLoading) return;

    // AX-10: Resolve attachments — staged ones, OR auto-pull from the archive
    let attaches: { documentId: string; title: string; content: string }[] = [...pendingAttachments];
    if (attaches.length === 0 && text && NOTE_REF_RE.test(text) && NOTE_VERB_RE.test(text)) {
      try {
        const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const docs = await LocalDocumentService.getGuestDocuments(uid);
        const picked = pickNoteByText(docs, text);
        if (picked) {
          const prepared = await prepareAttachment(picked.id);
          if (prepared && prepared.content.trim()) attaches = [{ documentId: picked.id, title: prepared.title, content: prepared.content }];
        }
      } catch { /* fall through to a plain message */ }
    }

    const prevPending = pendingAttachments;
    if (overrideText === undefined) setInputText('');
    setPendingAttachments([]);

    let id: string | null;
    if (attaches.length > 0) {
      // Build markers and display for multiple notes
      const markers = attaches.map(a => `[Прикреплена заметка: "${a.title}"]`);
      const totalContent = attaches.map(a => a.content).join('\n\n---\n\n');
      const totalChars = attaches.reduce((s, a) => s + a.content.length, 0);
      const fits = totalChars <= 9000;
      const firstLocalDocId = attaches.find(a => a.documentId.startsWith('local_'))?.documentId;

      if (attaches.length === 1) {
        // Single note — same format as before
        const a = attaches[0]!;
        const marker = markers[0]!;
        const display = fits
          ? `${marker}\n\n${a.content}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`
          : (text ? `${marker}\n\n${text}` : marker);
        id = await sendMessage(display, { content: a.content, ...(firstLocalDocId ? { documentId: firstLocalDocId } : {}), inline: fits });
      } else {
        // Multiple notes — each marked, combined content
        const noteBlocks = attaches.map((a, idx) => `${markers[idx]}\n\n${a.content}`).join('\n\n');
        const display = fits
          ? `${noteBlocks}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`
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
      // Failure / stop / daily-limit — restore the user's message and attachments
      if (overrideText === undefined) setInputText(text);
      if (prevPending.length > 0) setPendingAttachments(prevPending);
    }
  };

  // Tap a starter / follow-up suggestion → send it immediately.
  const handleSuggestion = (text: string) => { void handleSendMessage(text); };

  // AX-8: 👍/👎 feedback — saves preference memory that is GUARANTEED to reach
  // the model's system prompt on the next turn (see useAIChat: preference
  // memories are always included, not just by embedding similarity). A toast
  // makes the effect visible to the user.
  //
  // What's saved to AIChatMemory (IndexedDB 'aiChatMemory', kind='preference'):
  //  👍 → "Пользователю понравился такой ответ (тон/подход) — продолжать в этом духе."
  //  👎 → "Пользователю не нравится: {reason}. Скорректировать стиль."
  // These surface in future turns as "[Что ИИ помнит о пользователе] — preference: …"
  const handleFeedback = async (value: 'up' | 'down') => {
    if (value === 'up') {
      await AIChatMemoryService.addManual('preference', 'Пользователю понравился такой ответ (тон/подход) — продолжать в этом духе.', activeDialogueId ?? undefined);
      showToast('Учту — продолжу в этом стиле', 'success');
    } else {
      const reason = (await promptDialog({ title: 'Что не так с ответом?', message: 'короче / теплее / конкретнее / не выдумывай — или свой вариант', placeholder: 'Причина' }))?.trim() ?? '';
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

  // AX-7: Switch between regenerate variants
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

  const removePendingAttachment = useCallback((index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Long pasted text is usually a note, not a chat message — let the user turn it
  // into a staged attachment (chip) so it's analyzed strictly as a note (facets/
  // memory suppressed) instead of mixing with profile context.
  const handlePasteAsNote = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setPendingAttachments(prev => [...prev, { documentId: `pasted-${Date.now()}`, title: 'Вставленный текст', content: text }]);
    setInputText('');
  }, [inputText]);

  // AX-11: Length and reasoning are separate controls.
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
        title: 'Режим рассуждений',
        message: 'Дневной лимит запросов в режиме рассуждений ограничен 5 (вместо 10). Включить?',
        confirmLabel: 'Включить',
        destructive: false,
      });
      if (!ok) return;
    }
    setReasoning(value);
    useAiLimitStore.getState().setLimit(value ? 5 : 10);
    const did = activeDialogueId ?? dialogue?.id;
    if (did) {
      await AIDialogueService.updateResponseLength(did, responseLength, value);
      await loadDialogues();
    }
  }, [activeDialogueId, dialogue, responseLength, loadDialogues, confirmDialog]);

  const handleRenameDialogue = useCallback(async (id: string, newTitle: string) => {
    await AIDialogueService.updateTitle(id, newTitle);
    await loadDialogues();
  }, [loadDialogues]);

  const handleArchive = async () => {
    if (activeDialogueId) {
      await AIDialogueService.archive(activeDialogueId);
      setActiveDialogueId(null);
      await loadDialogues();
    }
  };

  const handleUnarchive = async (id: string) => {
    await AIDialogueService.unarchive(id);
    await loadDialogues();
  };

  const handleDelete = async () => {
    if (activeDialogueId) {
      const ok = await confirmDialog({ title: 'Удалить диалог?', message: 'Действие необратимо.' });
      if (!ok) return;
      await AIDialogueService.delete(activeDialogueId);
      setActiveDialogueId(null);
      await loadDialogues();
    }
  };

  const handleExport = async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
    if (!md) return;
    const blob = new Blob([md], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dialogue-${activeDialogueId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDocSelect = async (documentId: string) => {
    const prepared = await prepareAttachment(documentId);
    if (prepared) setPendingAttachments(prev => [...prev, { documentId, title: prepared.title, content: prepared.content }]);
  };

  const handleCopyMessage = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  const handleDeleteMessage = async (index: number) => {
    const id = activeDialogueId ?? dialogue?.id;
    if (!id) return;
    const ok = await confirmDialog({ title: 'Удалить сообщение?', message: 'Действие необратимо.' });
    if (!ok) return;
    await AIDialogueService.deleteMessage(id, index);
    await loadDialogues();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 1_048_576;
    if (file.size > MAX_FILE_SIZE) {
      void alertDialog({ title: 'Файл слишком большой', message: 'Максимум 1 МБ' });
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const allowedTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html'];
    const allowedExts = ['.txt', '.md', '.csv', '.json', '.html', '.xml'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      void alertDialog({ title: 'Неподдерживаемый тип файла', message: `Допустимы: ${allowedExts.join(', ')}` });
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : '';
      if (text.length > MAX_INPUT_CHARS) {
        void alertDialog({ title: 'Файл слишком большой', message: `Более ${MAX_INPUT_CHARS.toLocaleString()} символов` });
        return;
      }
      const formatted = `[Прикреплен файл: "${file.name}"]\n\n${text}`;
      await sendMessage(formatted);
      if (!activeDialogueId && dialogue) {
        setActiveDialogueId(dialogue.id);
      }
      await loadDialogues();
    };
    reader.readAsText(file);
    e.target.value = '';
    setAttachMenuOpen(false);
  };

  const allPersonas: { id: string; name: string; emoji: string; isPreset: boolean; systemPrompt?: string }[] = [
    ...PRESET_PERSONAS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: true })),
    ...customPersonas.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: false, systemPrompt: p.systemPrompt })),
  ];

  const openPersonaDetail = (persona: typeof allPersonas[number]) => {
    const v = personaVisual(persona.id, persona.name);
    setDetailPersona({
      id: persona.id,
      name: persona.name,
      isPreset: persona.isPreset,
      systemPrompt: persona.systemPrompt,
      color: v.color,
      mono: v.mono,
    });
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
    // AX-11: Migrate old 'reasoning' value → {length: 'standard', reasoning: true}
    let nextVal = activeDialogue?.responseLength ?? 'standard';
    let nextReasoning = activeDialogue?.reasoning ?? false;
    if (nextVal === 'reasoning' as unknown as ResponseLength) {
      nextVal = 'standard';
      nextReasoning = true;
    }
    void Promise.resolve().then(() => {
      setResponseLength(curr => curr !== nextVal ? nextVal : curr);
      setReasoning(curr => curr !== nextReasoning ? nextReasoning : curr);
      useAiLimitStore.getState().setLimit(nextReasoning ? 5 : 10);
    });
  }, [activeDialogue]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length, streamingMessage]);

  // AX-9: Generate context-aware follow-ups when the last assistant message changes
  useEffect(() => {
    let lastAssistant: string | null = null;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') { lastAssistant = m.content; break; }
    }
    const key = `${activeDialogueId ?? 'new'}:${displayMessages.length}:${lastAssistant?.slice(0, 100) ?? 'none'}`;
    if (key === lastFollowUpKeyRef.current) return;
    lastFollowUpKeyRef.current = key;
    if (!lastAssistant) return; // keep default static follow-ups
    // callType: 'follow_up' — server skips per-user quota, global guard still applies.
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
    allPersonas, openPersonaDetail,
    activeDialogue, displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaId, convPersonaName, convVisual,
    handleSetResponseLength, handleSetReasoning, handleRenameDialogue,
    responseLength,
    reasoning,
    proactiveHint,
    followUps,
    MAX_INPUT_CHARS,
  };
}
