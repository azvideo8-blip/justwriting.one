import React from 'react';
import { Plus, Archive, Download, Trash2, FileText, Paperclip, File, ArrowRight, Info } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { DocumentPickerModal } from '../components/DocumentPickerModal';
import { CreatePersonaModal } from '../components/CreatePersonaModal';
import { PersonaDetailModal } from '../components/PersonaDetailModal';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { personaVisual } from '../constants/personaVisuals';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { cn } from '../../../core/utils/utils';
import { Monogram, threadPreview, AttachedNoteCard, AttachedFileCard, AttachedSummaryCard, AssistantTurn, ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE } from '../components/AIChatPresentational';
import { useAIPageData } from '../hooks/useAIPageData';
import { useLanguage } from '../../../core/i18n';

export function AIPage() {
  const [searchParams] = useSearchParams();
  const linkedDocId = searchParams.get('doc') ?? undefined;
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
    isLoading, streamingMessage, error, clearError,
    dailyLimit,
    loadCustomPersonas,
    handleSendMessage, handleNewDialogue, handleArchive, handleDelete, handleExport,
    handleDocSelect, handleCopyMessage, handleFileUpload,
    allPersonas, openPersonaDetail,
    displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaName, convVisual,
    MAX_INPUT_CHARS,
  } = useAIPageData(linkedDocId);

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
              {t('ai_new_dialogue')}
            </button>
          </div>

          <div className="flex gap-1 px-4 pb-3.5">
            <button
              onClick={() => setShowArchived(false)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", !showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              {t('ai_active')}
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", showArchived ? "bg-surface-elevated text-text-main" : "text-text-main/40 hover:text-text-main/60")}
            >
              {t('ai_archive')}
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
                {showArchived ? t('ai_no_archived_dialogues') : t('ai_no_active_dialogues')}
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
              <div className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-text-main/30 mb-1">{t('ai_interlocutor')}</div>
              <div className="flex items-baseline gap-2.5">
                <h1 className="text-[22px] font-bold tracking-tight text-text-main truncate">{activePersona?.name}</h1>
                {activeRole && <span className="text-xs font-medium shrink-0" style={{ color: headerVisual.color }}>{activeRole}</span>}
              </div>
            </div>
            <div className="flex-1" />
            {activeDialogueId && (
              <div className="flex items-center gap-1">
                 <button onClick={handleExport} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_download_md')}>
                  <Download size={15} />
                </button>
                 <button onClick={handleArchive} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/45 hover:text-text-main transition-colors flex items-center justify-center" title={t('ai_to_archive')}>
                  <Archive size={15} />
                </button>
                 <button onClick={handleDelete} className="w-8 h-8 rounded-lg border border-border-subtle text-text-main/35 hover:text-red-400 transition-colors flex items-center justify-center" title={t('ai_delete')}>
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
                     title={t('ai_description_prompt')}
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
               {t('ai_create')}
            </button>
          </div>
        </div>

        <div className="relative z-[1] flex-1 overflow-y-auto px-6 py-7">
          <div className="max-w-[1600px] mx-auto flex flex-col gap-7">
            {displayMessages.length === 0 && !activeDialogueId && (
              <div className="flex flex-col items-center justify-center gap-4 text-center py-24">
                <Monogram color={headerVisual.color} mono={headerVisual.mono} size={56} />
                <div>
                  <p className="text-base font-medium text-text-main/70">{t('ai_start_dialogue', { name: activePersona?.name ?? '' })}</p>
                  <p className="text-xs text-text-main/30 mt-1.5">{t('ai_select_persona')}</p>
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
                   <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-text-main/25 mr-1">{t('ai_you')}</span>
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
                 <span className="text-text-main/40">{t('ai_typing')}</span>
              </AssistantTurn>
            )}

            {error && (
              <div className="flex justify-center">
                <div className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  {error}
                   <button onClick={clearError} className="ml-2 underline">{t('ai_close')}</button>
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
                  title={t('ai_attach')}
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
                      {t('ai_attach_note')}
                    </button>
                    <button
                      onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                    >
                      <File size={14} />
                      {t('ai_upload_file')}
                    </button>
                  </div>
                )}
              </div>
              <input
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                placeholder={t('ai_write_placeholder', { name: (activePersona?.name ?? '').toLowerCase() })}
                disabled={isLoading || dailyLimit.remaining === 0}
                className="flex-1 bg-transparent py-1.5 text-[14.5px] text-text-main placeholder:text-text-main/30 outline-none disabled:opacity-40"
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !inputText.trim() || dailyLimit.remaining === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl shrink-0 bg-gradient-to-b from-brand-soft to-brand-primary text-white text-[13.5px] font-semibold shadow-[0_4px_16px_rgba(125,79,209,0.35)] disabled:opacity-40 disabled:shadow-none transition-all"
              >
                {t('ai_send')}
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="flex items-center gap-3.5 mt-2.5">
              <span className="text-[10px] font-mono text-text-main/30">
                {t('ai_remaining_today')} <b className="text-text-main/50">{dailyLimit.remaining}/{dailyLimit.limit}</b> {t('ai_today')}
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
