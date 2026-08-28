import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { DocumentPickerModal } from '../../features/ai/components/DocumentPickerModal';
import { CreatePersonaModal } from '../../features/ai/components/CreatePersonaModal';
import { PersonaDetailModal } from '../../features/ai/components/PersonaDetailModal';
import { MemoryManagerModal } from '../../features/ai/components/MemoryManagerModal';
import { IndexingConsentModal } from '../../features/ai/components/IndexingConsentModal';
import { DocumentPreview } from '../../features/archive/components/DocumentPreview';
import type { ArchiveSession } from '../../shared/types/common';
import { useToast } from '../../shared/components/Toast';
import { useProfile } from '../../features/auth/contexts/ProfileContext';
import { personaVisual } from '../../features/ai/constants/personaVisuals';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { useLanguage } from '../../shared/i18n';
import { cn } from '../../core/utils/utils';
import { IconButton } from '../../shared/components/IconButton';
import { useAIPageData } from '../../features/ai/hooks/useAIPageData';
import { Button } from '../../shared/components/Button';
import { AIChatSidebar } from '../../features/ai/components/chat/AIChatSidebar';
import { AIChatHeader } from '../../features/ai/components/chat/AIChatHeader';
import { AIChatMessages } from '../../features/ai/components/chat/AIChatMessages';
import { AIChatComposer } from '../../features/ai/components/chat/AIChatComposer';
import { createNoteActions } from '../../features/ai/components/chat/noteActions';
import { NoteAnalysisService } from '../../features/ai/services/NoteAnalysisService';
import { AISummaryService } from '../../features/ai/services/AISummaryService';
import { findRelatedNotes } from '../../features/ai/utils/relatedNotes';

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
    handleDocSelect, handleCopyMessage, handleDeleteMessage, handleFileUpload, triggerForcedSearch,
    indexingModalOpen, handleGrantIndexingConsent, handleRefuseIndexingConsent,
    handleSetResponseLength, handleSetReasoning, handleRenameDialogue,
    responseLength,
    reasoning,
    proactiveHint,
    followUps,
    starters,
    allPersonas, openPersonaDetail,
    displayMessages,
    activePersona, activeRole, headerVisual,
    convPersonaName, convVisual,
    MAX_INPUT_CHARS,
  } = useAIPageData(linkedDocId, draftFacetId);

  const { profile } = useProfile();
  const userId = profile?.uid ?? 'guest';
  const { showToast } = useToast();
  const { handleCreateNote, handleApplyToNote } = createNoteActions({ userId, linkedDocId, showToast });

  const [memoryOpen, setMemoryOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const navigate = useNavigate();
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);

  const applyToNoteHandler = selectedPersonaId === 'editor' && linkedDocId
    ? (text: string) => { void handleApplyToNote(text); }
    : undefined;

  return (
    <div className={cn("h-screen bg-surface-base flex", isMobile ? "flex-col" : "flex-row")}>
      {!isMobile && (
        <AIChatSidebar
          dialogues={dialogues}
          archivedDialogues={archivedDialogues}
          activeDialogueId={activeDialogueId}
          onSelectDialogue={(id, personaId) => { setActiveDialogueId(id); setSelectedPersonaId(personaId); }}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onNewDialogue={handleNewDialogue}
          onUnarchive={(id) => { void handleUnarchive(id); }}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: `radial-gradient(circle at 80% 6%, ${headerVisual.color}14, transparent 44%)` }}
        />

        <AIChatHeader
          isMobile={isMobile}
          headerVisual={headerVisual}
          activePersonaName={activePersona?.name ?? ''}
          activeRole={activeRole}
          dialogueTitle={dialogue?.title}
          hasActiveDialogue={!!activeDialogueId}
          activeDialogueId={activeDialogueId}
          onOpenMemory={() => setMemoryOpen(true)}
          responseLength={responseLength}
          reasoning={reasoning}
          onSetResponseLength={(len) => { void handleSetResponseLength(len); }}
          onToggleReasoning={(v) => { void handleSetReasoning(v); }}
          onExport={() => { void handleExport(); }}
          onArchive={() => { void handleArchive(); }}
          onDelete={() => { void handleDelete(); }}
          onRename={(id, title) => { void handleRenameDialogue(id, title); }}
          selectedPersonaId={selectedPersonaId}
          setSelectedPersonaId={setSelectedPersonaId}
          allPersonas={allPersonas}
          openPersonaDetail={openPersonaDetail}
          onCreatePersona={() => setCreatePersonaOpen(true)}
        />

        <AIChatMessages
          displayMessages={displayMessages}
          streamingMessage={streamingMessage}
          streamingReasoning={streamingReasoning}
          isLoading={isLoading}
          error={error}
          clearError={clearError}
          convPersonaName={convPersonaName}
          convVisual={convVisual}
          onCopyMessage={handleCopyMessage}
          onDeleteMessage={(index) => { void handleDeleteMessage(index); }}
          onFeedback={(v) => { void handleFeedback(v); }}
          onRegenerate={() => { void handleRegenerate(); }}
          onSwitchVariant={(delta) => { void handleSwitchVariant(delta); }}
          onCreateNote={(text) => { void handleCreateNote(text); }}
          onApplyToNote={applyToNoteHandler}
          onForcedSearch={(query) => { void triggerForcedSearch(query); }}
          dailyLimitRemaining={dailyLimit.remaining}
          followUps={followUps}
          onSuggestion={handleSuggestion}
          starters={starters}
          activeDialogueId={activeDialogueId}
          activePersonaName={activePersona?.name ?? ''}
          headerVisual={headerVisual}
          proactiveHint={proactiveHint}
          setInputText={setInputText}
          isMobile={isMobile}
          messagesEndRef={messagesEndRef}
          previewSession={previewSession}
          onClosePreview={() => setPreviewSession(null)}
          setCitationPreviewSession={setPreviewSession}
        />

        <AIChatComposer
          inputText={inputText}
          setInputText={setInputText}
          inputRef={inputRef}
          isLoading={isLoading}
          onStop={() => stop()}
          onSend={() => { void handleSendMessage(); }}
          pendingAttachments={pendingAttachments}
          removePendingAttachment={removePendingAttachment}
          onPasteAsNote={handlePasteAsNote}
          attachMenuOpen={attachMenuOpen}
          setAttachMenuOpen={setAttachMenuOpen}
          attachMenuRef={attachMenuRef}
          fileInputRef={fileInputRef}
          onFileUpload={handleFileUpload}
          onOpenDocPicker={() => setDocPickerOpen(true)}
          dailyLimitRemaining={dailyLimit.remaining}
          dailyLimitTotal={dailyLimit.limit}
          maxInputChars={MAX_INPUT_CHARS}
          personaName={activePersona?.name ?? ''}
          crisisActive={crisisActive}
          dismissCrisis={dismissCrisis}
        />
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
      {memoryOpen && <MemoryManagerModal onClose={() => setMemoryOpen(false)} />}
      <IndexingConsentModal
        isOpen={indexingModalOpen}
        onConsent={() => void handleGrantIndexingConsent()}
        onRefuse={() => void handleRefuseIndexingConsent()}
      />

      <AnimatePresence>
        {previewSession && (
          <DocumentPreview
            session={previewSession}
            onClose={() => setPreviewSession(null)}
            onContinue={s => { void navigate('/', { state: { sessionToContinue: s } }); }}
            onAttach={id => { void handleDocSelect(id); setPreviewSession(null); }}
            onCopyText={text => {
              void navigator.clipboard.writeText(text);
              showToast('Текст скопирован', 'success');
            }}
            onAnalyzeNote={id => NoteAnalysisService.analyze(id)}
            fetchSummary={async id => (await AISummaryService.get(id)) ?? null}
            fetchRelatedNotes={id => findRelatedNotes({ docId: id }, { maxResults: 4 })}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
