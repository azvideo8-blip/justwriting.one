import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, Plus, Archive, Download, Trash2, FileText, Paperclip, ChevronDown, ChevronUp, File, Copy, ArrowRight, Info } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AIDialogueService } from '../services/AIDialogueService';
import { AIPersonaService, PRESET_PERSONAS } from '../services/AIPersonaService';
import { useAIChat } from '../hooks/useAIChat';
import { useDailyLimit } from '../hooks/useDailyLimit';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import { PersonaDetailModal, type PersonaDetailTarget } from '../components/PersonaDetailModal';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { personaVisual, usePersonaRole } from '../constants/personaVisuals';
import type { AIDialogue, AIPersona } from '../../../core/storage/localDb';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { cn } from '../../../core/utils/utils';

const MAX_INPUT_CHARS = 10_000;
const ATTACHED_NOTE_RE = /^\[Прикреплена заметка: "([^"]+)"\]/;
const ATTACHED_NOTE_SUMMARY_RE = /^\[Прикреплено саммари заметки: "([^"]+)"\]/;
const ATTACHED_FILE_RE = /^\[Прикреплен файл: "([^"]+)"\]/;

// Serif monogram tile in a persona's colour — the avatar used across header, threads and messages.
function Monogram({ color, mono, size = 36, dim = false }: { color: string; mono: string; size?: number; dim?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: dim ? `${color}14` : `linear-gradient(180deg, ${color}30, ${color}14)`,
        border: `1px solid ${color}${dim ? '2a' : '55'}`,
        boxShadow: dim ? 'none' : `0 0 14px ${color}26`,
        fontWeight: 600,
        fontSize: size * 0.38,
        color,
        letterSpacing: '-0.02em',
        lineHeight: 1,
      }}
    >
      {mono}
    </span>
  );
}

function threadPreview(d: AIDialogue): string {
  const last = d.messages[d.messages.length - 1];
  if (!last) return '';
  const c = last.content.replace(/^\[[^\]]*\]\s*/, '').trim();
  return c.length > 64 ? `${c.slice(0, 64)}…` : c;
}

function AttachedNoteCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_RE);
  const title = match?.[1] ?? 'Заметка';
  const noteContent = content.replace(ATTACHED_NOTE_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-brand-soft shadow-[0_0_8px_rgba(165,131,232,0.5)]" />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Paperclip size={12} className="text-text-main/40 shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">{title}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
            {noteContent}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachedFileCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_FILE_RE);
  const fileName = match?.[1] ?? 'Файл';
  const fileContent = content.replace(ATTACHED_FILE_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-text-main/30" />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <File size={12} className="text-text-main/40 shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">{fileName}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
            {fileContent}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachedSummaryCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
  const title = match?.[1] ?? 'Заметка';
  const summaryContent = content.replace(ATTACHED_NOTE_SUMMARY_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-brand-soft shadow-[0_0_8px_rgba(165,131,232,0.5)]" />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Sparkles size={12} className="text-brand-soft shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">Саммари: {title}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {summaryContent}
          </div>
        )}
      </div>
    </div>
  );
}

// Letter-style assistant turn: monogram, name, serif body framed by a persona-coloured rule.
function AssistantTurn({
  name,
  color,
  mono,
  children,
  onCopy,
}: {
  name: string;
  color: string;
  mono: string;
  children: React.ReactNode;
  onCopy?: () => void;
}) {
  return (
    <div className="flex gap-4 w-full self-start">
      <Monogram color={color} mono={mono} size={36} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span className="text-[13px] font-semibold text-text-main">{name}</span>
        </div>
        <div
          className="text-[15px] leading-[1.65] text-text-main/90 pl-[18px]"
          style={{ borderLeft: `2px solid ${color}40` }}
        >
          {children}
        </div>
        {onCopy && (
          <div className="flex gap-1 mt-3 -ml-2">
            <button
              onClick={onCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
            >
              <Copy size={11} />
              копировать
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AIPage() {
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
  // The persona that actually authored the open dialogue (falls back to the picker for a fresh chat).
  const convPersonaId = activeDialogue?.personaId ?? selectedPersonaId;
  const convPersonaName = activeDialogue?.personaName ?? activePersona?.name ?? '';
  const convVisual = personaVisual(convPersonaId, convPersonaName);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages.length, streamingMessage]);

  return (
    <div className={cn("h-screen bg-surface-base flex", isMobile ? "flex-col" : "flex-row")}>
      {!isMobile && (
        <div className="w-[286px] border-r border-border-subtle flex flex-col bg-surface-card/30">
          <div className="p-4 pb-3.5">
            <button
              onClick={handleNewDialogue}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/25 text-brand-soft text-sm font-semibold hover:bg-brand-soft/20 transition-colors"
            >
              <Plus size={15} />
              Новый диалог
            </button>
          </div>

          <div className="flex gap-1 px-4 pb-3.5">
            <button
              onClick={() => setShowArchived(false)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Активные
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              Архив
            </button>
          </div>

          <div className="h-px bg-border-subtle mx-4 mb-1.5" />

          <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5">
            {(showArchived ? archivedDialogues : dialogues).map(d => {
              const v = personaVisual(d.personaId, d.personaName);
              const isActive = activeDialogueId === d.id;
              const preview = threadPreview(d);
              return (
                <button
                  key={d.id}
                  onClick={() => { setActiveDialogueId(d.id); setSelectedPersonaId(d.personaId); }}
                  className="w-full text-left relative flex gap-3 px-3 py-3 rounded-xl transition-colors"
                  style={isActive ? { background: `linear-gradient(90deg, ${v.color}16, transparent 75%)` } : undefined}
                >
                  {isActive && (
                    <span
                      className="absolute left-1 top-3.5 bottom-3.5 w-[2.5px] rounded-full"
                      style={{ background: v.color, boxShadow: `0 0 9px ${v.color}90` }}
                    />
                  )}
                  <Monogram color={v.color} mono={v.mono} size={28} dim={!isActive} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("flex-1 min-w-0 text-sm font-medium truncate", isActive ? "text-text-main" : "text-text-main/55")}>{d.title}</span>
                      <span className="text-[9.5px] font-mono text-text-main/25 shrink-0">{new Date(d.updatedAt).toLocaleDateString()}</span>
                    </span>
                    <span className={cn("flex items-center gap-1.5 mt-1 text-xs leading-snug truncate", isActive ? "text-text-main/50" : "text-text-main/30")}>
                      {d.documentId && <FileText size={10} className="shrink-0" />}
                      <span className="truncate">{preview}</span>
                    </span>
                  </span>
                </button>
              );
            })}
            {((showArchived ? archivedDialogues : dialogues).length === 0) && (
              <div className="py-8 text-center text-xs text-text-main/25">
                {showArchived ? 'Нет архивных диалогов' : 'Нет активных диалогов'}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: `radial-gradient(circle at 80% 6%, ${headerVisual.color}14, transparent 44%)` }}
        />

        <div className="relative z-10 px-6 pt-5 pb-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-3.5">
            {!isMobile && <Monogram color={headerVisual.color} mono={headerVisual.mono} size={40} />}
            <div className="min-w-0">
              <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-text-main/30 mb-1">собеседник</div>
              <div className="flex items-baseline gap-2.5">
                <h1 className="text-[22px] font-bold tracking-tight text-text-main truncate">{activePersona?.name}</h1>
                {activeRole && <span className="text-xs font-medium shrink-0" style={{ color: headerVisual.color }}>{activeRole}</span>}
              </div>
            </div>
            <div className="flex-1" />
            {activeDialogueId && (
              <div className="flex items-center gap-1">
                <button onClick={handleExport} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title="Скачать .md">
                  <Download size={15} />
                </button>
                <button onClick={handleArchive} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title="В архив">
                  <Archive size={15} />
                </button>
                <button onClick={handleDelete} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/35 hover:text-red-400 transition-colors flex items-center justify-center" title="Удалить">
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-1.5 items-center overflow-x-auto pb-1 pt-3.5 -mx-1 px-1 no-scrollbar">
            {allPersonas.map(p => {
              const v = personaVisual(p.id, p.name);
              const on = selectedPersonaId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "shrink-0 flex items-center rounded-full text-xs font-medium border transition-colors",
                    on ? "pl-1 pr-1.5 text-text-main" : "pl-3 pr-1.5 text-text-main/50"
                  )}
                  style={on
                    ? { background: `${v.color}1c`, borderColor: `${v.color}55` }
                    : { borderColor: 'var(--color-border-subtle)' }}
                >
                  <button
                    onClick={() => setSelectedPersonaId(p.id)}
                    className="flex items-center gap-2 py-1 pr-1 hover:text-text-main/70 transition-colors"
                  >
                    {on
                      ? <Monogram color={v.color} mono={v.mono} size={20} />
                      : <span className="w-[7px] h-[7px] rounded-full" style={{ background: v.color, opacity: 0.85 }} />}
                    <span>{p.name}</span>
                  </button>
                  <button
                    onClick={() => openPersonaDetail(p)}
                    className="w-5 h-5 rounded-full text-text-main/35 hover:text-text-main/70 hover:bg-text-main/10 flex items-center justify-center shrink-0 transition-colors"
                    title="Описание и промпт"
                  >
                    <Info size={13} />
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setCreatePersonaOpen(true)}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-colors"
            >
              <Plus size={12} />
              Создать
            </button>
          </div>
        </div>

        <div className="relative z-[1] flex-1 overflow-y-auto px-6 py-7">
          <div className="max-w-[1600px] mx-auto flex flex-col gap-7">
            {displayMessages.length === 0 && !activeDialogueId && (
              <div className="flex flex-col items-center justify-center gap-4 text-center py-24">
                <Monogram color={headerVisual.color} mono={headerVisual.mono} size={56} />
                <div>
                  <p className="text-base font-medium text-text-main/70">Начните диалог с {activePersona?.name}</p>
                  <p className="text-xs text-text-main/30 mt-1.5">Выберите персону и напишите сообщение</p>
                </div>
              </div>
            )}

            {displayMessages.map((msg, i) => {
              const isAttachedNote = msg.role === 'user' && ATTACHED_NOTE_RE.test(msg.content);
              const isAttachedSummary = msg.role === 'user' && ATTACHED_NOTE_SUMMARY_RE.test(msg.content);
              const isAttachedFile = msg.role === 'user' && ATTACHED_FILE_RE.test(msg.content);
              const isSystemMessage = msg.type === 'system';
              const isAttachment = isAttachedNote || isAttachedSummary || isAttachedFile;

              if (isSystemMessage) {
                return (
                  <div key={i} className="flex justify-center">
                    <div className="px-4 py-1.5 rounded-full bg-surface-card border border-border-subtle text-[11px] text-text-main/40 font-mono">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              if (msg.role === 'assistant') {
                return (
                  <AssistantTurn
                    key={i}
                    name={convPersonaName}
                    color={convVisual.color}
                    mono={convVisual.mono}
                    onCopy={() => handleCopyMessage(msg.content)}
                  >
                    <MarkdownRenderer content={msg.content} />
                  </AssistantTurn>
                );
              }

              if (isAttachment) {
                return (
                  <div key={i} className="flex flex-col items-end gap-1.5">
                    <div className="max-w-[78%]">
                      {isAttachedNote
                        ? <AttachedNoteCard content={msg.content} />
                        : isAttachedSummary
                          ? <AttachedSummaryCard content={msg.content} />
                          : <AttachedFileCard content={msg.content} />}
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-b from-brand-primary/25 to-brand-primary/15 border border-brand-primary/30 text-text-main text-[14.5px] leading-relaxed">
                    {msg.content}
                  </div>
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-text-main/25 mr-1">вы</span>
                </div>
              );
            })}

            {streamingMessage !== null && (
              <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono}>
                <MarkdownRenderer content={streamingMessage || '…'} />
              </AssistantTurn>
            )}

            {isLoading && streamingMessage === null && (
              <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono}>
                <span className="text-text-main/40">печатает…</span>
              </AssistantTurn>
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
        </div>

        <div className="relative z-10 px-6 py-4 border-t border-border-subtle">
          <div>
            <div className="flex items-end gap-2.5 p-2.5 pl-3.5 rounded-2xl bg-surface-card border border-border-subtle focus-within:border-brand-soft/40 transition-colors">
              <div className="relative" ref={attachMenuRef}>
                <button
                  onClick={() => setAttachMenuOpen(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-elevated border border-border-subtle text-text-main/45 hover:text-text-main/70 transition-colors shrink-0"
                  title="Прикрепить"
                >
                  <Plus size={15} />
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
                placeholder={`Напишите ${(activePersona?.name ?? '').toLowerCase()}…`}
                disabled={isLoading || dailyLimit.remaining === 0}
                className="flex-1 bg-transparent py-1.5 text-[14.5px] text-text-main placeholder:text-text-main/30 outline-none disabled:opacity-40"
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !inputText.trim() || dailyLimit.remaining === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl shrink-0 bg-gradient-to-b from-brand-soft to-brand-primary text-white text-[13.5px] font-semibold shadow-[0_4px_16px_rgba(125,79,209,0.35)] disabled:opacity-40 disabled:shadow-none transition-all"
              >
                Отправить
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="flex items-center gap-3.5 mt-2.5">
              <span className="text-[10px] font-mono text-text-main/30">
                осталось <b className="text-text-main/50">{dailyLimit.remaining}/{dailyLimit.limit}</b> сегодня
              </span>
              <div className="flex-1" />
              <span className={cn(
                "text-[10px] font-mono",
                inputText.length > MAX_INPUT_CHARS * 0.9 ? "text-red-400" : "text-text-main/25"
              )}>
                {inputText.length.toLocaleString()}/{MAX_INPUT_CHARS.toLocaleString()}
              </span>
              <div className="w-[120px] h-[3px] rounded-full bg-border-subtle overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-deep to-brand-soft transition-[width]"
                  style={{ width: `${Math.min(100, (inputText.length / MAX_INPUT_CHARS) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-surface-card/85 backdrop-blur-xl border-t border-white/[0.06]">
          <div className="flex gap-1 overflow-x-auto px-3 py-2 no-scrollbar">
            {allPersonas.slice(0, 5).map(p => {
              const v = personaVisual(p.id, p.name);
              return (
                <div key={p.id} className="relative shrink-0 flex items-center gap-0.5">
                  <button
                    onClick={() => setSelectedPersonaId(p.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
                      selectedPersonaId === p.id ? "text-text-main" : "text-text-main/40"
                    )}
                    style={selectedPersonaId === p.id ? { background: `${v.color}1c` } : undefined}
                  >
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: v.color, opacity: 0.85 }} />
                    {p.name}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); openPersonaDetail(p); }}
                    className="w-5 h-5 rounded-full text-text-main/30 hover:text-text-main/60 flex items-center justify-center"
                  >
                    <Info size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DocumentPickerModal isOpen={docPickerOpen} onClose={() => setDocPickerOpen(false)} onSelect={handleDocSelect} />
      <CreatePersonaModal isOpen={createPersonaOpen} onClose={() => setCreatePersonaOpen(false)} onCreated={loadCustomPersonas} />
      <PersonaDetailModal persona={detailPersona} onClose={() => setDetailPersona(null)} onChanged={loadCustomPersonas} />
    </div>
  );
}
