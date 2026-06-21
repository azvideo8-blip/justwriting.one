import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { TelemetryService } from '../../../core/services/TelemetryService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import type { PersonaDetailTarget } from '../components/PersonaDetailModal';

type ResponseLength = 'short' | 'standard' | 'detailed' | 'reasoning';

const MAX_INPUT_CHARS = 10_000;

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

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if ((!text && !pendingAttachment) || isLoading) return;
    setInputText('');
    let id: string | null;
    if (pendingAttachment) {
      const marker = `[Прикреплена заметка: "${pendingAttachment.title}"]`;
      const display = text ? `${marker}\n\n${text}` : marker;
      const content = pendingAttachment.content;
      setPendingAttachment(null);
      id = await sendMessage(display, { content });
    } else {
      id = await sendMessage(text);
    }
    // Select the (possibly newly created) dialogue so it persists across nav.
    if (!activeDialogueId && id) setActiveDialogueId(id);
    await loadDialogues();
  };

  const removePendingAttachment = useCallback(() => setPendingAttachment(null), []);

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

  const handleDelete = async () => {
    if (activeDialogueId) {
      await AIDialogueService.delete(activeDialogueId);
      setActiveDialogueId(null);
      await loadDialogues();
    }
  };

  const handleExport = async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
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
    pendingAttachment, removePendingAttachment,
    dailyLimit,
    loadDialogues, loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleFileUpload,
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
