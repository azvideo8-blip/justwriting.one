import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { TelemetryService } from '../../../core/services/TelemetryService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import type { PersonaDetailTarget } from '../components/PersonaDetailModal';

type ResponseLength = 'short' | 'standard' | 'detailed' | 'reasoning';

const MAX_INPUT_CHARS = 10_000;

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
// 1-tap mood check-in (passed to the model as documentMood for the next message).
export const CHAT_MOODS: { emoji: string; label: string }[] = [
  { emoji: '😟', label: 'тревожно' },
  { emoji: '😔', label: 'грустно' },
  { emoji: '😐', label: 'нейтрально' },
  { emoji: '🙂', label: 'спокойно' },
  { emoji: '😊', label: 'хорошо' },
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
  // Feature: staged note attachment — attaching shows a chip; the note is sent
  // together with the user's typed message instead of auto-sending on attach.
  const [pendingAttachment, setPendingAttachment] = useState<{ documentId: string; title: string; content: string } | null>(null);
  const [chatMood, setChatMood] = useState<string | null>(null);
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
  } = useAIChat(activeDialogueId, selectedPersonaId, responseLength);

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
    setPendingAttachment(null);
  }, []);

  // THERAPY-4: Proactive contact point — check for faded topics on AI page load
  const [proactiveHint, setProactiveHint] = useState<string | null>(null);
  const proactiveShownRef = useRef(false);

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
      if (p) setPendingAttachment({ documentId: linkedDocId, title: p.title, content: p.content });
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
        console.warn('[useAIPageData] draftFacet handling failed:', e);
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
    if ((!text && !pendingAttachment) || isLoading) return;

    // Resolve the note to attach: an explicitly staged one, OR auto-pull from the
    // archive by date when the user says "разбери мою последнюю/сегодняшнюю заметку".
    let attach: { documentId: string; title: string; content: string } | null = pendingAttachment;
    if (!attach && text && NOTE_REF_RE.test(text) && NOTE_VERB_RE.test(text)) {
      try {
        const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
        const docs = await LocalDocumentService.getGuestDocuments(uid);
        const picked = pickNoteByText(docs, text);
        if (picked) {
          const prepared = await prepareAttachment(picked.id);
          if (prepared && prepared.content.trim()) attach = { documentId: picked.id, title: prepared.title, content: prepared.content };
        }
      } catch { /* fall through to a plain message */ }
    }

    const mood = chatMood ?? undefined;
    const prevPending = pendingAttachment;
    if (overrideText === undefined) setInputText('');
    setChatMood(null);
    setPendingAttachment(null);

    let id: string | null;
    if (attach) {
      const marker = `[Прикреплена заметка: "${attach.title}"]`;
      const content = attach.content;
      // Deliver the note IN the message when it fits (most reliable channel, like
      // file upload); large notes go via documentContent. Real notes keep a
      // 'local_…' id so the dialogue stays linked across reloads.
      const fits = content.length <= 9000;
      const docId = attach.documentId.startsWith('local_') ? attach.documentId : undefined;
      const display = fits
        ? `${marker}\n\n${content}${text ? `\n\n— — —\nВопрос: ${text}` : ''}`
        : (text ? `${marker}\n\n${text}` : marker);
      id = await sendMessage(display, { content, ...(docId ? { documentId: docId } : {}), inline: fits }, mood);
    } else {
      id = await sendMessage(text, undefined, mood);
    }

    if (id) {
      if (!activeDialogueId) setActiveDialogueId(id);
      await loadDialogues();
    } else {
      // Failure / stop / daily-limit — restore the user's message and attachment
      // so nothing typed is lost (they can retry without re-typing).
      if (overrideText === undefined) setInputText(text);
      if (prevPending) setPendingAttachment(prevPending);
    }
  };

  // Tap a starter / follow-up suggestion → send it immediately.
  const handleSuggestion = (text: string) => { void handleSendMessage(text); };

  // 👍/👎 on an answer → store an explicit preference memory (silent, ≤2 clicks).
  const handleFeedback = async (value: 'up' | 'down') => {
    if (value === 'up') {
      await AIChatMemoryService.addManual('preference', 'Пользователю понравился такой ответ (тон/подход) — продолжать в этом духе.', activeDialogueId ?? undefined);
    } else {
      const reason = (window.prompt('Что не так с ответом? (необязательно)') ?? '').trim();
      const text = reason
        ? `Пользователю не понравился ответ: ${reason}. Учесть в тоне/подходе.`
        : 'Пользователю не понравился такой ответ (тон/подход) — скорректировать стиль.';
      await AIChatMemoryService.addManual('preference', text, activeDialogueId ?? undefined);
    }
  };

  const handleRegenerate = async () => {
    await regenerateLast();
    await loadDialogues();
  };

  const removePendingAttachment = useCallback(() => setPendingAttachment(null), []);

  // Long pasted text is usually a note, not a chat message — let the user turn it
  // into a staged attachment (chip) so it's analyzed strictly as a note (facets/
  // memory suppressed) instead of mixing with profile context.
  const handlePasteAsNote = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setPendingAttachment({ documentId: `pasted-${Date.now()}`, title: 'Вставленный текст', content: text });
    setInputText('');
  }, [inputText]);

  const handleSetResponseLength = useCallback(async (length: ResponseLength) => {
    // TICKET-049: Disclaimer for reasoning mode (reduced limit)
    if (length === 'reasoning') {
      const confirm = window.confirm('Дневной лимит запросов в режиме рассуждений ограничен 5 (вместо 10). Изменить режим на «Рассуждения»?');
      if (!confirm) return;
    }
    setResponseLength(length);
    useAiLimitStore.getState().setLimit(length === 'reasoning' ? 5 : 10);
    const did = activeDialogueId ?? dialogue?.id;
    if (did) {
      await AIDialogueService.updateResponseLength(did, length);
      await loadDialogues();
    }
  }, [activeDialogueId, dialogue, loadDialogues]);

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
      if (!window.confirm('Удалить диалог безвозвратно?')) return;
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
    if (prepared) setPendingAttachment({ documentId, title: prepared.title, content: prepared.content });
  };

  const handleCopyMessage = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  const handleDeleteMessage = async (index: number) => {
    const id = activeDialogueId ?? dialogue?.id;
    if (!id) return;
    if (!window.confirm('Удалить это сообщение из диалога? Действие необратимо.')) return;
    await AIDialogueService.deleteMessage(id, index);
    await loadDialogues();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 1_048_576;
    if (file.size > MAX_FILE_SIZE) {
      alert(`Файл слишком большой (максимум 1 МБ)`);
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const allowedTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html'];
    const allowedExts = ['.txt', '.md', '.csv', '.json', '.html', '.xml'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      alert(`Неподдерживаемый тип файла. Допустимы: ${allowedExts.join(', ')}`);
      e.target.value = '';
      setAttachMenuOpen(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = typeof ev.target?.result === 'string' ? ev.target.result : '';
      if (text.length > MAX_INPUT_CHARS) {
        alert(`Файл слишком большой (более ${MAX_INPUT_CHARS.toLocaleString()} символов)`);
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
  const displayMessages = activeDialogue?.messages ?? [];

  const activePersona = allPersonas.find(p => p.id === selectedPersonaId) ?? allPersonas[0];
  const activeRole = usePersonaRole(selectedPersonaId, activePersona?.name ?? '');
  const headerVisual = personaVisual(selectedPersonaId, activePersona?.name ?? '');
  const convPersonaId = activeDialogue?.personaId ?? selectedPersonaId;
  const convPersonaName = activeDialogue?.personaName ?? activePersona?.name ?? '';
  const convVisual = personaVisual(convPersonaId, convPersonaName);

  useEffect(() => {
    const nextVal = activeDialogue?.responseLength ?? 'standard';
    void Promise.resolve().then(() => {
      setResponseLength(curr => {
        if (curr !== nextVal) {
          useAiLimitStore.getState().setLimit(nextVal === 'reasoning' ? 5 : 10);
          return nextVal;
        }
        return curr;
      });
    });
  }, [activeDialogue]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length, streamingMessage]);

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
    pendingAttachment, removePendingAttachment, handlePasteAsNote,
    chatMood, setChatMood,
    handleSuggestion, handleFeedback, handleRegenerate,
    crisisActive, dismissCrisis,
    dailyLimit,
    loadDialogues, loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleUnarchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleDeleteMessage, handleFileUpload,
    allPersonas, openPersonaDetail,
    activeDialogue, displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaId, convPersonaName, convVisual,
    handleSetResponseLength, handleRenameDialogue,
    responseLength,
    proactiveHint,
    MAX_INPUT_CHARS,
  };
}
