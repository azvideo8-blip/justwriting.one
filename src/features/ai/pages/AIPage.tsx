import React, { useEffect, useRef, useState } from 'react';
import { Plus, Archive, Download, Trash2, FileText, Paperclip, File, ArrowRight, Info, Pencil, Sparkles, Square, X, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import { PersonaDetailModal } from '../components/PersonaDetailModal';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { personaVisual } from '../constants/personaVisuals';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { cn } from '../../../core/utils/utils';
import { Monogram, threadPreview, AttachedNoteCard, AttachedFileCard, AttachedSummaryCard, AssistantTurn, ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE } from '../components/AIChatPresentational';
import { CRISIS_RESOURCES } from '../utils/riskDetect';
import { useAIPageData, CHAT_STARTERS } from '../hooks/useAIPageData';
import { useLanguage } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';

export function AIPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedDocId = searchParams.get('doc') ?? undefined;
  const draftFacetId = searchParams.get('draftFacet') ?? undefined;

  // Clear draftFacet param after it's been consumed
  useEffect(() => {
    if (draftFacetId) {
      const next = new URLSearchParams(searchParams);
      next.delete('draftFacet');
      setSearchParams(next, { replace: true });
    }
  }, [draftFacetId, searchParams, setSearchParams]);
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const { t } = useLanguage();

  const {
    dialogues, archivedDialogues, activeDialogueId, setActiveDialogueId,
    selectedPersonaId, setSelectedPersonaId,
    showArchived, setShowArchived,
    inputText, setInputText,
    docPickerOpen, setDocPickerOpen,
    createPersonaOpen, setCreatePersonaOpen,
    detailPersona, setDetailPersona,
    attachMenuOpen, setAttachMenuOpen,
    messagesEndRef, fileInputRef, attachMenuRef,
    isLoading, streamingMessage, streamingReasoning, error, clearError,
    stop, pendingAttachments, removePendingAttachment, handlePasteAsNote,
    handleSuggestion, handleFeedback, handleRegenerate, handleSwitchVariant,
    crisisActive, dismissCrisis,
    dialogue,
    dailyLimit,
    loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleUnarchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleDeleteMessage, handleFileUpload,
    handleSetResponseLength, handleSetReasoning, handleRenameDialogue,
    responseLength,
    reasoning,
    proactiveHint,
    followUps,
    allPersonas, openPersonaDetail,
    displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaName, convVisual,
    MAX_INPUT_CHARS,
  } = useAIPageData(linkedDocId, draftFacetId);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // AX-4: Resizable sidebar — persisted to localStorage
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_KEY = 'ai_sidebar_width';
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    const w = saved ? parseInt(saved, 10) : 286;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarDragRef = useRef(false);

  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(w);
    };
    const onMouseUp = () => {
      if (sidebarDragRef.current) {
        sidebarDragRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_KEY, String(sidebarWidthRef.current));
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputText]);

  const lastAssistantIdx = (() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') return i;
    }
    return -1;
  })();

  const handleSaveRename = () => {
    setIsRenaming(false);
    if (renameValue.trim() && activeDialogueId && renameValue.trim() !== dialogue?.title) {
      void handleRenameDialogue(activeDialogueId, renameValue.trim());
    }
  };

  return (
    <div className={cn("h-screen bg-surface-base flex", isMobile ? "flex-col" : "flex-row")}>
      {!isMobile && (
        <>
        <div className="border-r border-border-subtle flex flex-col bg-surface-card/30" style={{ width: sidebarWidth, flexShrink: 0 }}>
          <div className="p-4 pb-3.5">
            <Button
              onClick={handleNewDialogue}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/25 text-brand-soft text-sm font-semibold hover:bg-brand-soft/20 transition-colors"
            >
              <Plus size={15} />
              {t('ai_new_dialogue')}
            </Button>
          </div>

          <div className="flex gap-1 px-4 pb-3.5">
            <Button
              onClick={() => setShowArchived(false)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/60 hover:text-text-main/60")}
            >
              {t('ai_active')}
            </Button>
            <Button
              onClick={() => setShowArchived(true)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/60 hover:text-text-main/60")}
            >
              {t('ai_archive')}
            </Button>
          </div>

          <div className="h-px bg-border-subtle mx-4 mb-1.5" />

          <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5">
            {(showArchived ? archivedDialogues : dialogues).map(d => {
              const v = personaVisual(d.personaId, d.personaName);
              const isActive = activeDialogueId === d.id;
              const preview = threadPreview(d);
              return (
                <Button
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
                      <span className="text-[9.5px] font-mono text-text-main/60 shrink-0">{new Date(d.updatedAt).toLocaleDateString()}</span>
                    </span>
                    <span className={cn("flex items-center gap-1.5 mt-1 text-xs leading-snug truncate", isActive ? "text-text-main/60" : "text-text-main/60")}>
                      {d.documentId && <FileText size={10} className="shrink-0" />}
                      <span className="truncate">{preview}</span>
                    </span>
                  </span>
                  {showArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleUnarchive(d.id); }}
                      className="shrink-0 p-1.5 rounded-lg text-text-main/60 hover:text-brand-soft transition-colors"
                      title={t('ai_unarchive')}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </Button>
              );
            })}
            {((showArchived ? archivedDialogues : dialogues).length === 0) && (
              <div className="py-8 text-center text-xs text-text-main/60">
                {showArchived ? t('ai_no_archived_dialogues') : t('ai_no_active_dialogues')}
              </div>
            )}
          </div>
        </div>
        <div
          onMouseDown={startSidebarDrag}
          className="w-1 cursor-col-resize hover:bg-brand-soft/30 transition-colors shrink-0"
          style={{ marginRight: -1 }}
        />
        </>
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
              <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-text-main/60 mb-1">{t('ai_interlocutor')}</div>
              <div className="flex items-baseline gap-2.5">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={handleSaveRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') { setIsRenaming(false); }
                    }}
                    className="text-[22px] font-bold tracking-tight text-text-main bg-transparent border-b border-brand-soft/40 outline-none px-1 -mx-1 max-w-[300px]"
                    placeholder="Название диалога"
                  />
                ) : (
                  <h1 className="text-[22px] font-bold tracking-tight text-text-main truncate">{activePersona?.name}</h1>
                )}
                {activeRole && !isRenaming && <span className="text-xs font-medium shrink-0" style={{ color: headerVisual.color }}>{activeRole}</span>}
              </div>
            </div>
            <div className="flex-1" />
            {activeDialogueId && (
              <div className="flex items-center gap-1">
                 <IconButton onClick={() => void handleExport()} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_download_md')} label={t('ai_download_md')} icon={<Download size={15} />} />
                 <IconButton onClick={() => { setIsRenaming(true); setRenameValue(dialogue?.title ?? ''); }} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title="Переименовать" label="Переименовать" icon={<Pencil size={15} />} />
                 <IconButton onClick={() => void handleArchive()} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_to_archive')} label={t('ai_to_archive')} icon={<Archive size={15} />} />
                 <IconButton onClick={() => void handleDelete()} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/35 hover:text-accent-danger transition-colors flex items-center justify-center" title={t('ai_delete')} label={t('ai_delete')} icon={<Trash2 size={15} />} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 mt-2">
              <span className="text-[9px] font-mono uppercase tracking-wider text-text-main/60 mr-1">объём:</span>
              {(['short', 'standard', 'detailed'] as const).map(len => {
                const active = responseLength === len;
                const label = len === 'short' ? 'Кратко' : len === 'standard' ? 'Стандартно' : 'Объёмно';
                return (
                  <Button
                    key={len}
                    onClick={() => void handleSetResponseLength(len)}
                    className={cn(
                      "px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                      active
                        ? "bg-brand-soft/15 border-brand-soft/30 text-brand-soft"
                        : "border-border-subtle text-text-main/60 hover:text-text-main"
                    )}
                  >
                    {label}
                  </Button>
                );
              })}
              <button
                type="button"
                onClick={() => void handleSetReasoning(!reasoning)}
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors flex items-center gap-1",
                  reasoning
                    ? "bg-brand-soft/15 border-brand-soft/30 text-brand-soft"
                    : "border-border-subtle text-text-main/60 hover:text-text-main"
                )}
              >
                🧠 Рассуждения
              </button>
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
                    on ? "pl-1 pr-1.5 text-text-main" : "pl-3 pr-1.5 text-text-main/60 hover:text-text-main"
                  )}
                  style={on
                    ? { background: `${v.color}1c`, borderColor: `${v.color}55` }
                    : { borderColor: 'var(--color-border-subtle)' }}
                >
                  <Button
                    onClick={() => setSelectedPersonaId(p.id)}
                    className="flex items-center gap-2 py-1 pr-1 hover:text-text-main/70 transition-colors"
                  >
                    {on
                      ? <Monogram color={v.color} mono={v.mono} size={20} />
                      : <span className="w-[7px] h-[7px] rounded-full" style={{ background: v.color, opacity: 0.85 }} />}
                    <span>{p.name}</span>
                  </Button>
                  <IconButton
                    onClick={() => openPersonaDetail(p)}
                    className="w-5 h-5 rounded-full text-text-main/35 hover:text-text-main/70 hover:bg-text-main/10 flex items-center justify-center shrink-0 transition-colors"
                    title={t('ai_description_prompt')}
                    label={t('ai_description_prompt')}
                    icon={<Info size={13} />}
                  />
                </div>
              );
            })}
            <Button
              onClick={() => setCreatePersonaOpen(true)}
              className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border-subtle text-text-main/60 hover:text-text-main/60 transition-colors"
            >
              <Plus size={12} />
               {t('ai_create')}
            </Button>
          </div>
        </div>

        <div className="relative z-[1] flex-1 overflow-y-auto px-6 py-7">
          <div className="max-w-[1600px] mx-auto flex flex-col gap-7" aria-live="polite">
            {proactiveHint && !activeDialogueId && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-brand-soft/10 border border-brand-soft/20 text-sm text-brand-soft">
                <Sparkles size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex-1">{proactiveHint}</span>
                <Button
                  onClick={() => { if (proactiveHint) setInputText(proactiveHint.replace(/.*«|».*/, '').trim()); }}
                  className="text-xs font-bold px-3 py-1 rounded-lg bg-brand-soft/20 hover:bg-brand-soft/30"
                >
                  {isMobile ? 'OK' : 'Обсудить'}
                </Button>
              </div>
            )}
            {displayMessages.length === 0 && !activeDialogueId && (
              <div className="flex flex-col items-center justify-center gap-4 text-center py-24">
                <Monogram color={headerVisual.color} mono={headerVisual.mono} size={56} />
                <div>
                  <p className="text-base font-medium text-text-main/70">{t('ai_start_dialogue', { name: activePersona?.name ?? '' })}</p>
                  <p className="text-xs text-text-main/60 mt-1.5">{t('ai_select_persona')}</p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  {CHAT_STARTERS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSuggestion(s)}
                      disabled={isLoading || dailyLimit.remaining === 0}
                      className="px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle text-sm text-text-main/80 hover:border-brand-soft/40 hover:text-text-main transition-colors disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
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
                    <div className="px-4 py-1.5 rounded-full bg-surface-card border border-border-subtle text-[11px] text-text-main/60 font-mono">
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
                    onDelete={() => void handleDeleteMessage(i)}
                    onFeedback={v => void handleFeedback(v)}
                    onRegenerate={i === lastAssistantIdx && !isLoading ? () => void handleRegenerate() : undefined}
                    variants={msg.variants}
                    variantIndex={msg.variantIndex}
                    onSwitchVariant={i === lastAssistantIdx ? (delta: number) => void handleSwitchVariant(delta) : undefined}
                  >
                    {msg.reasoning && (
                      <details className="mb-3 rounded-xl border border-border-subtle bg-surface-card/50 overflow-hidden">
                        <summary className="px-4 py-2 text-xs font-medium text-text-main/60 cursor-pointer hover:text-text-main transition-colors select-none">
                          🧠 Ход мысли
                        </summary>
                        <div className="px-4 py-3 text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap border-t border-border-subtle">
                          {msg.reasoning}
                        </div>
                      </details>
                    )}
                    <MarkdownRenderer content={msg.content} />
                  </AssistantTurn>
                );
              }

              if (isAttachedNote) {
                // AX-1/AX-10: parse display into note cards + question.
                // Supports multiple attached notes (each with its own marker).
                const SEPARATOR = '\n\n— — —\nВопрос: ';
                const sepIdx = msg.content.indexOf(SEPARATOR);
                const beforeSep = sepIdx >= 0 ? msg.content.slice(0, sepIdx) : msg.content;
                const question = sepIdx >= 0 ? msg.content.slice(sepIdx + SEPARATOR.length).trim() : '';

                // Extract all note markers and their content blocks
                const NOTE_MARKER_RE = /\[Прикреплена заметка: "([^"]+)"\]/g;
                const markers: { title: string; start: number; end: number }[] = [];
                for (const m of beforeSep.matchAll(NOTE_MARKER_RE)) {
                  markers.push({ title: m[1] ?? 'Заметка', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
                }
                const notes: { title: string; body: string }[] = markers.map((mk, idx) => {
                  const nextStart = idx + 1 < markers.length ? markers[idx + 1]!.start : beforeSep.length;
                  const body = beforeSep.slice(mk.end, nextStart).trim();
                  return { title: mk.title, body };
                });

                return (
                  <div key={i} className="flex flex-col items-end gap-1.5">
                    <div className="max-w-[78%] flex flex-col items-end gap-1.5">
                      {notes.map((note, ni) => (
                        note.body
                          ? <AttachedNoteCard key={ni} content={`[Прикреплена заметка: "${note.title}"]\n\n${note.body}`} />
                          : <span key={ni} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-card border border-brand-soft/30 text-xs text-text-main/80 max-w-full">
                              <Paperclip size={12} className="text-brand-soft shrink-0" />
                              <span className="truncate">{note.title}</span>
                            </span>
                      ))}
                      {question && (
                        <div className="px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-b from-brand-primary/25 to-brand-primary/15 border border-brand-primary/30 text-text-main text-[14.5px] leading-relaxed whitespace-pre-wrap">
                          {question}
                        </div>
                      )}
                      <button type="button" onClick={() => void handleDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors mr-1" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                    </div>
                  </div>
                );
              }

              if (isAttachment) {
                return (
                  <div key={i} className="flex flex-col items-end gap-1.5">
                    <div className="max-w-[78%] flex flex-col items-end gap-1.5">
                      {isAttachedSummary
                        ? <AttachedSummaryCard content={msg.content} />
                        : <AttachedFileCard content={msg.content} />}
                      <button type="button" onClick={() => void handleDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors mr-1" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-b from-brand-primary/25 to-brand-primary/15 border border-brand-primary/30 text-text-main text-[14.5px] leading-relaxed">
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-2 mr-1">
                    <button type="button" onClick={() => void handleDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                    <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-text-main/60">{t('ai_you')}</span>
                  </div>
                </div>
              );
            })}

            {streamingReasoning && (
              <details className="mb-3 rounded-xl border border-border-subtle bg-surface-card/50 overflow-hidden">
                <summary className="px-4 py-2 text-xs font-medium text-text-main/60 cursor-pointer hover:text-text-main transition-colors select-none">
                  🧠 Ход мысли
                </summary>
                <div className="px-4 py-3 text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap border-t border-border-subtle">
                  {streamingReasoning}
                </div>
              </details>
            )}

            {streamingMessage !== null && (
              <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono}>
                <MarkdownRenderer content={streamingMessage || '…'} />
              </AssistantTurn>
            )}

            {isLoading && !streamingMessage && (
              <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono}>
                 <ThinkingIndicator name={convPersonaName} />
              </AssistantTurn>
            )}

            {error && (
              <div className="flex justify-center">
                <div className="px-4 py-2 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-xs text-accent-danger">
                  {error}
                   <Button onClick={clearError} className="ml-2 underline">{t('ai_close')}</Button>
                </div>
              </div>
            )}

            {!isLoading && streamingMessage === null && !error && lastAssistantIdx === displayMessages.length - 1 && displayMessages.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {followUps.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSuggestion(s)}
                    disabled={dailyLimit.remaining === 0}
                    className="px-3 py-1.5 rounded-full bg-surface-card border border-border-subtle text-xs text-text-main/70 hover:border-brand-soft/40 hover:text-text-main transition-colors disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {crisisActive && (
          <div className="relative z-10 mx-6 mb-2 rounded-xl border border-accent-danger/30 bg-accent-danger/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="text-sm">🆘</span>
              <div className="flex-1 text-xs text-text-main/80 leading-relaxed">
                <p className="font-semibold mb-1">Если тяжело — ты не один. Можно позвонить живому человеку прямо сейчас:</p>
                <ul className="space-y-0.5">
                  {CRISIS_RESOURCES.map(r => <li key={r}>{r}</li>)}
                </ul>
              </div>
              <button type="button" onClick={dismissCrisis} className="text-text-main/40 hover:text-text-main transition-colors" aria-label={t('ai_close')}><X size={14} /></button>
            </div>
          </div>
        )}

        <div className="relative z-10 px-6 py-4 border-t border-border-subtle">
          <div>
            {pendingAttachments.length === 0 && inputText.trim().length > 1500 && (
              <button
                type="button"
                onClick={handlePasteAsNote}
                className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-soft/10 border border-brand-soft/30 text-xs text-brand-soft hover:bg-brand-soft/20 transition-colors"
              >
                <Paperclip size={12} />
                Это заметка? Разобрать как заметку (точнее по тексту)
              </button>
            )}
            {pendingAttachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingAttachments.map((att, idx) => (
                  <div key={idx} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-brand-soft/30 text-xs text-text-main/80 max-w-full">
                    <Paperclip size={12} className="text-brand-soft shrink-0" />
                    <span className="truncate max-w-[200px]">{att.title}</span>
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(idx)}
                      className="shrink-0 text-text-main/50 hover:text-text-main transition-colors"
                      aria-label={t('ai_close')}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2.5 p-2.5 pl-3.5 rounded-2xl bg-surface-card border border-border-subtle focus-within:border-brand-soft/40 transition-colors">
              <div className="relative" ref={attachMenuRef}>
                <IconButton
                  onClick={() => setAttachMenuOpen(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-elevated border border-border-subtle text-text-main/45 hover:text-text-main/70 transition-colors shrink-0"
                  title={t('ai_attach')}
                  label={t('ai_attach')}
                  icon={<Plus size={15} />}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                {attachMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-48 border border-border-subtle rounded-xl shadow-xl overflow-hidden z-50 bg-surface-popup">
                    <Button
                      onClick={() => { setAttachMenuOpen(false); setDocPickerOpen(true); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                    >
                      <Paperclip size={14} />
                      {t('ai_attach_note')}
                    </Button>
                    <Button
                      onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                    >
                      <File size={14} />
                      {t('ai_upload_file')}
                    </Button>
                  </div>
                )}
              </div>
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSendMessage(); } }}
                placeholder={t('ai_write_placeholder', { name: (activePersona?.name ?? '').toLowerCase() })}
                disabled={isLoading || dailyLimit.remaining === 0}
                rows={1}
                className="flex-1 bg-transparent py-1.5 text-[14.5px] text-text-main placeholder:text-text-main/40 outline-none disabled:opacity-40 resize-none overflow-y-auto max-h-40"
              />
              {isLoading ? (
                <Button
                  onClick={() => stop()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl shrink-0 bg-surface-elevated border border-border-subtle text-text-main/80 text-[13.5px] font-semibold hover:text-text-main transition-all"
                >
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-text-main/30 border-t-text-main/80 animate-spin" />
                  {t('ai_processing')}
                  <Square size={13} className="fill-current" />
                </Button>
              ) : (
                <Button
                  onClick={() => void handleSendMessage()}
                  disabled={(!inputText.trim() && pendingAttachments.length === 0) || dailyLimit.remaining === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl shrink-0 bg-gradient-to-b from-brand-soft to-brand-primary text-white text-[13.5px] font-semibold shadow-[0_4px_16px_rgba(125,79,209,0.35)] disabled:opacity-40 disabled:shadow-none transition-all"
                >
                  {t('ai_send')}
                  <ArrowRight size={14} />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3.5 mt-2.5">
              <span className="text-[10px] font-mono text-text-main/60">
                {t('ai_remaining_today')} <b className="text-text-main/60">{dailyLimit.remaining}/{dailyLimit.limit}</b> {t('ai_today')}
              </span>
              <div className="flex-1" />
              <span className={cn(
                "text-[10px] font-mono",
                inputText.length > MAX_INPUT_CHARS * 0.9 ? "text-accent-danger" : "text-text-main/60"
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
                  <Button
                    onClick={() => setSelectedPersonaId(p.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
                      selectedPersonaId === p.id ? "text-text-main" : "text-text-main/60"
                    )}
                    style={selectedPersonaId === p.id ? { background: `${v.color}1c` } : undefined}
                  >
                    <span className="w-[7px] h-[7px] rounded-full" style={{ background: v.color, opacity: 0.85 }} />
                    {p.name}
                  </Button>
                  <IconButton
                    onClick={e => { e.stopPropagation(); openPersonaDetail(p); }}
                    className="w-5 h-5 rounded-full text-text-main/60 hover:text-text-main/60 flex items-center justify-center"
                    label={t('ai_description_prompt')}
                    icon={<Info size={12} />}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DocumentPickerModal isOpen={docPickerOpen} onClose={() => setDocPickerOpen(false)} onSelect={(doc) => void handleDocSelect(doc)} />
      <CreatePersonaModal isOpen={createPersonaOpen} onClose={() => setCreatePersonaOpen(false)} onCreated={() => void loadCustomPersonas()} />
      <PersonaDetailModal persona={detailPersona} onClose={() => setDetailPersona(null)} onChanged={() => void loadCustomPersonas()} />
    </div>
  );
}

// UXFIX-2: Animated thinking indicator with seconds counter
function ThinkingIndicator({ name }: { name: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-text-main/60">
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-text-main/40 animate-pulse" style={{ animationDelay: '300ms' }} />
      </span>
      <span className="text-sm">{name} думает… {seconds}с</span>
    </div>
  );
}
