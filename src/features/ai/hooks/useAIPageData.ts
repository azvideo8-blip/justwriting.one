import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import type { PersonaDetailTarget } from '../components/PersonaDetailModal';

const MAX_INPUT_CHARS = 10_000;

export function useAIPageData(linkedDocId?: string) {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const dailyLimit = useDailyLimit();
  const {
    dialogue,
    isLoading,
    streamingMessage,
    error,
    sendMessage,
    attachDocument,
    clearError,
  } = useAIChat(activeDialogueId, selectedPersonaId);

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

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setTimeout(() => {
      loadDialogues();
      loadCustomPersonas();
    }, 0);
    if (linkedDocId) attachDocument(linkedDocId);
  }, [loadDialogues, loadCustomPersonas, linkedDocId, attachDocument]);

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
    if (!inputText.trim() || isLoading) return;
    const text = inputText.trim();
    setInputText('');
    await sendMessage(text);
    if (!activeDialogueId && dialogue) {
      setActiveDialogueId(dialogue.id);
    }
    loadDialogues();
  };

  const handleNewDialogue = () => {
    setActiveDialogueId(null);
    setInputText('');
  };

  const handleArchive = async () => {
    if (activeDialogueId) {
      await AIDialogueService.archive(activeDialogueId);
      setActiveDialogueId(null);
      loadDialogues();
    }
  };

  const handleDelete = async () => {
    if (activeDialogueId) {
      await AIDialogueService.delete(activeDialogueId);
      setActiveDialogueId(null);
      loadDialogues();
    }
  };

  const handleExport = async () => {
    if (!activeDialogueId) return;
    const md = await AIDialogueService.exportAsMarkdown(activeDialogueId);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dialogue-${activeDialogueId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDocSelect = async (documentId: string) => {
    await attachDocument(documentId);
  };

  const handleCopyMessage = (text: string) => {
    navigator.clipboard?.writeText(text);
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
      const text = ev.target?.result as string;
      if (text.length > MAX_INPUT_CHARS) {
        alert(`Файл слишком большой (более ${MAX_INPUT_CHARS.toLocaleString()} символов)`);
        return;
      }
      const formatted = `[Прикреплен файл: "${file.name}"]\n\n${text}`;
      await sendMessage(formatted);
      if (!activeDialogueId && dialogue) {
        setActiveDialogueId(dialogue.id);
      }
      loadDialogues();
    };
    reader.readAsText(file);
    e.target.value = '';
    setAttachMenuOpen(false);
  };

  const allPersonas = [
    ...PRESET_PERSONAS.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: true as const, systemPrompt: undefined as string | undefined })),
    ...customPersonas.map(p => ({ id: p.id, name: p.name, emoji: p.emoji, isPreset: false as const, systemPrompt: p.systemPrompt })),
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
    dialogue, isLoading, streamingMessage, error, clearError,
    dailyLimit,
    loadDialogues, loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleFileUpload,
    allPersonas, openPersonaDetail,
    activeDialogue, displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaId, convPersonaName, convVisual,
    MAX_INPUT_CHARS,
  };
}
