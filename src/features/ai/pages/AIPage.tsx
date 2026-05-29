import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Plus, Archive, Download, Trash2, FileText, Paperclip, ChevronDown, ChevronUp, File } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

const MAX_INPUT_CHARS = 10_000;
const ATTACHED_NOTE_RE = /^\[Прикреплена заметка: "([^"]+)"\]/;
const ATTACHED_NOTE_SUMMARY_RE = /^\[Прикреплено саммари заметки: "([^"]+)"\]/;
const ATTACHED_FILE_RE = /^\[Прикреплен файл: "([^"]+)"\]/;

function AttachedNoteCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_RE);
  const title = match?.[1] ?? 'Заметка';
  const noteContent = content.replace(ATTACHED_NOTE_RE, '').trim();

  return (
    <div className="rounded-xl bg-brand-soft/5 border border-brand-soft/15 p-2.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs font-medium text-brand-soft"
      >
        <span className="flex items-center gap-1.5"><Paperclip size={12} /> {title}</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {noteContent}
        </div>
      )}
    </div>
  );
}

function AttachedFileCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_FILE_RE);
  const fileName = match?.[1] ?? 'Файл';
  const fileContent = content.replace(ATTACHED_FILE_RE, '').trim();

  return (
    <div className="rounded-xl bg-text-main/5 border border-border-subtle p-2.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs font-medium text-text-main/60"
      >
        <span className="flex items-center gap-1.5"><File size={12} /> {fileName}</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {fileContent}
        </div>
      )}
    </div>
  );
}

function AttachedSummaryCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
  const title = match?.[1] ?? 'Заметка';
  const summaryContent = content.replace(ATTACHED_NOTE_SUMMARY_RE, '').trim();

  return (
    <div className="rounded-xl bg-brand-soft/5 border border-brand-soft/15 p-2.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs font-medium text-brand-soft"
      >
        <span className="flex items-center gap-1.5"><Sparkles size={12} /> Саммари: {title}</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {summaryContent}
        </div>
      )}
    </div>
  );
}

export function AIPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const linkedDocId = searchParams.get('doc') ?? undefined;
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  const [dialogues, setDialogues] = useState<AIDialogue[]>([]);
  const [archivedDialogues, setArchivedDialogues] = useState<AIDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('group_psychology');
  const [showArchived, setShowArchived] = useState(false);
  const [customPersonas, setCustomPersonas] = useState<AIPersona[]>([]);
  const [inputText, setInputText] = useState('');
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [createPersonaOpen, setCreatePersonaOpen] = useState(false);
  const [infoPersonaId, setInfoPersonaId] = useState<string | null>(null);
  const [infoPromptText, setInfoPromptText] = useState<string | null>(null);
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
    if (infoPersonaId === null) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.info-trigger')) return;
      setInfoPersonaId(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [infoPersonaId]);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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

  const handleInfoClick = (persona: typeof allPersonas[number]) => {
    if (infoPersonaId === persona.id) {
      setInfoPersonaId(null);
      return;
    }
    setInfoPersonaId(persona.id);
    setInfoPromptText(persona.isPreset ? null : (persona.systemPrompt ?? null));
  };

  const renderInfoTooltip = (persona: typeof allPersonas[number]) => {
    if (infoPersonaId !== persona.id) return null;
    return (
      <div
        className="absolute bottom-full left-0 mb-1 w-56 max-h-48 overflow-y-auto p-2 rounded-xl bg-surface-card border border-border-subtle text-xs text-text-main/70 shadow-lg z-10"
        onClick={e => e.stopPropagation()}
      >
        {persona.isPreset
          ? (t(`ai_persona_desc_${persona.id}` as `ai_persona_desc_${typeof persona.id}`) ?? persona.name)
          : (infoPromptText
            ? <span className="whitespace-pre-wrap break-words">{infoPromptText}</span>
            : <span className="text-text-main/40">Нет описания</span>
          )
        }
      </div>
    );
  };

  const activeDialogue = dialogue ?? dialogues.find(d => d.id === activeDialogueId) ?? null;
  const displayMessages = activeDialogue?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length, streamingMessage]);

  return (
    <div className={cn("h-screen bg-surface-base flex", isMobile ? "flex-col" : "flex-row")}>
      {!isMobile && (
        <div className="w-[280px] border-r border-border-subtle flex flex-col bg-surface-card/50">
          <div className="p-4 border-b border-border-subtle">
            <button
              onClick={handleNewDialogue}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-sm font-medium hover:bg-brand-soft/20 transition-colors"
            >
              <Plus size={16} />
              Новый диалог
            </button>
          </div>

          <div className="flex gap-1 px-3 pt-3">
            <button
              onClick={() => setShowArchived(false)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Активные
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-text-main/10 text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Архив
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {(showArchived ? archivedDialogues : dialogues).map(d => (
              <button
                key={d.id}
                onClick={() => { setActiveDialogueId(d.id); setSelectedPersonaId(d.personaId); }}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-xl transition-colors",
                  activeDialogueId === d.id ? "bg-text-main/10 text-text-main" : "text-text-main/60 hover:bg-text-main/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{d.personaEmoji}</span>
                  <span className="text-sm font-medium truncate flex-1">{d.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-text-main/25">{new Date(d.updatedAt).toLocaleDateString()}</span>
                  {d.documentId && <FileText size={10} className="text-text-main/20" />}
                </div>
              </button>
            ))}
            {((showArchived ? archivedDialogues : dialogues).length === 0) && (
              <div className="py-8 text-center text-xs text-text-main/25">
                {showArchived ? 'Нет архивных диалогов' : 'Нет активных диалогов'}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 pt-4 pb-2 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-brand-soft" />
              <h2 className="text-lg font-bold text-text-main">AI</h2>
            </div>
            <div className="flex items-center gap-1">
              {activeDialogueId && (
                <>
                  <button onClick={handleExport} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors" title="Скачать .md">
                    <Download size={16} />
                  </button>
                  <button onClick={handleArchive} className="p-2 rounded-lg text-text-main/40 hover:text-text-main transition-colors" title="В архив">
                    <Archive size={16} />
                  </button>
                  <button onClick={handleDelete} className="p-2 rounded-lg text-text-main/30 hover:text-red-400 transition-colors" title="Удалить">
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar">
            {allPersonas.map(p => (
              <div key={p.id} className="relative shrink-0 flex items-center gap-1">
                <button
                  onClick={() => setSelectedPersonaId(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                    selectedPersonaId === p.id
                      ? "bg-brand-soft/10 border-brand-soft/30 text-brand-soft"
                      : "bg-text-main/3 border-border-subtle text-text-main/50 hover:text-text-main/70"
                  )}
                >
                  <span>{p.emoji}</span>
                  <span>{p.name}</span>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); handleInfoClick(p); }}
                  className="info-trigger w-5 h-5 rounded-full text-[9px] text-text-main/30 hover:text-text-main/60 flex items-center justify-center shrink-0"
                >
                  i
                </button>
                {renderInfoTooltip(p)}
              </div>
            ))}
            <button
              onClick={() => setCreatePersonaOpen(true)}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-colors"
            >
              <Plus size={12} />
              Создать
            </button>
          </div>

          {!activeDialogueId && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setDocPickerOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-text-main/5 border border-dashed border-border-subtle text-xs text-text-main/40 hover:text-text-main/60 transition-colors"
              >
                <Paperclip size={12} />
                Прикрепить заметку
              </button>
              <span className="text-[10px] text-text-main/25">необязательно</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {displayMessages.length === 0 && !activeDialogueId && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-soft/10 flex items-center justify-center">
                <Sparkles size={28} className="text-brand-soft/50" />
              </div>
              <div>
                <p className="text-sm text-text-main/50">Начните диалог с ИИ</p>
                <p className="text-xs text-text-main/25 mt-1">Выберите персону и напишите сообщение</p>
              </div>
            </div>
          )}

          {displayMessages.map((msg, i) => {
            const isAttachedNote = msg.role === 'user' && ATTACHED_NOTE_RE.test(msg.content);
            const isAttachedSummary = msg.role === 'user' && ATTACHED_NOTE_SUMMARY_RE.test(msg.content);
            const isAttachedFile = msg.role === 'user' && ATTACHED_FILE_RE.test(msg.content);
            const isSystemMessage = msg.type === 'system';

            if (isSystemMessage) {
              return (
                <div key={i} className="flex justify-center">
                  <div className="px-4 py-1.5 rounded-xl bg-text-main/5 border border-border-subtle text-[11px] text-text-main/40 font-mono">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user'
                      ? "bg-brand-soft/10 text-text-main rounded-br-md"
                      : "bg-surface-card border border-border-subtle text-text-main/80 rounded-bl-md"
                  )}
                >
                  {isAttachedNote
                    ? <AttachedNoteCard content={msg.content} />
                    : isAttachedSummary
                      ? <AttachedSummaryCard content={msg.content} />
                      : isAttachedFile
                        ? <AttachedFileCard content={msg.content} />
                        : msg.role === 'assistant'
                          ? <MarkdownRenderer content={msg.content} />
                          : msg.content
                  }
                </div>
              </div>
            );
          })}

          {streamingMessage !== null && (
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-surface-card border border-border-subtle text-text-main/80 rounded-bl-md text-sm leading-relaxed">
                <MarkdownRenderer content={streamingMessage || '…'} />
              </div>
            </div>
          )}

          {isLoading && streamingMessage === null && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl bg-surface-card border border-border-subtle rounded-bl-md">
                <span className="text-sm text-text-main/40 italic">печатает...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {error}
                <button onClick={clearError} className="ml-2 underline">Закрыть</button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="relative" ref={attachMenuRef}>
              <button
                onClick={() => setAttachMenuOpen(v => !v)}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-text-main/5 border border-border-subtle text-text-main/40 hover:text-text-main/60 transition-colors shrink-0"
                title="Прикрепить"
              >
                <Plus size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={handleFileUpload}
              />
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-48 border border-border-subtle rounded-xl shadow-xl overflow-hidden z-50" style={{ background: 'var(--bg-elevated)' }}>
                  <button
                    onClick={() => { setAttachMenuOpen(false); setDocPickerOpen(true); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                  >
                    <Paperclip size={14} />
                    Прикрепить заметку
                  </button>
                  <button
                    onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                  >
                    <File size={14} />
                    Загрузить файл
                  </button>
                </div>
              )}
            </div>
            <input
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              placeholder="Написать сообщение..."
              disabled={isLoading || dailyLimit.remaining === 0}
              className="flex-1 px-4 py-2.5 rounded-xl bg-text-main/5 border border-border-subtle text-sm text-text-main placeholder:text-text-main/30 outline-none focus:border-brand-soft/40 disabled:opacity-40"
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !inputText.trim() || dailyLimit.remaining === 0}
              className="px-4 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-medium disabled:opacity-40 transition-colors"
            >
              Отправить
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-mono text-text-main/25">
              {`Осталось ${dailyLimit.remaining}/${dailyLimit.limit} сегодня`}
            </span>
            <span className={cn(
              "text-[10px] font-mono",
              inputText.length > MAX_INPUT_CHARS * 0.9
                ? "text-red-400"
                : "text-text-main/20"
            )}>
              {inputText.length.toLocaleString()}/{MAX_INPUT_CHARS.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06]">
          <div className="flex gap-1 overflow-x-auto px-3 py-2 no-scrollbar">
            {allPersonas.slice(0, 5).map(p => (
              <div key={p.id} className="relative shrink-0 flex items-center gap-0.5">
                <button
                  onClick={() => setSelectedPersonaId(p.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs",
                    selectedPersonaId === p.id ? "bg-brand-soft/10 text-brand-soft" : "text-text-main/40"
                  )}
                >
                  {p.emoji} {p.name}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); handleInfoClick(p); }}
                  className="info-trigger w-5 h-5 rounded-full text-[8px] text-text-main/30 hover:text-text-main/60 flex items-center justify-center"
                >
                  i
                </button>
                {renderInfoTooltip(p)}
              </div>
            ))}
          </div>
        </div>
      )}

      <DocumentPickerModal isOpen={docPickerOpen} onClose={() => setDocPickerOpen(false)} onSelect={handleDocSelect} />
      <CreatePersonaModal isOpen={createPersonaOpen} onClose={() => setCreatePersonaOpen(false)} onCreated={loadCustomPersonas} />
    </div>
  );
}
