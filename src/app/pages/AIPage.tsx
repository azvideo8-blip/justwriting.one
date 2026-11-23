import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLanguage } from '../../shared/i18n';
import { useProfile } from '../../features/auth/contexts/ProfileContext';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { cn } from '../../core/utils/utils';
import { useAIPageData } from '../../features/ai/hooks/useAIPageData';
import { AIChatSidebar } from '../../features/ai/components/chat/AIChatSidebar';
import { AIChatHeader } from '../../features/ai/components/chat/AIChatHeader';
import { MobileDialogueListSheet } from '../../features/ai/components/chat/MobileDialogueListSheet';
import { AIChatMessages } from '../../features/ai/components/chat/AIChatMessages';
import { AIChatComposer } from '../../features/ai/components/chat/AIChatComposer';
import { createNoteActions } from '../../features/ai/components/chat/noteActions';
import { NoteAnalysisService } from '../../features/ai/services/NoteAnalysisService';
import { AISummaryService } from '../../features/ai/services/AISummaryService';
import { findRelatedNotes } from '../../features/ai/utils/relatedNotes';
import { closePanelsForNavigation } from '../../shared/hooks/usePanelHistory';

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

  const {
    dialogueList, activeDialogueId, setActiveDialogueId,
    selectedPersonaId, setSelectedPersonaId,
    showArchived, setShowArchived,
    inputText, setInputText,
    docPickerOpen, setDocPickerOpen,
    createPersonaOpen, setCreatePersonaOpen,
    detailPersona, setDetailPersona,
    attachMenuOpen, setAttachMenuOpen,
    messagesEndRef, fileInputRef, attachMenuRef,
    isLoading, streamingMessage, streamingReasoning, error, consentRequired, clearError,
    stop, pendingAttachments, removePendingAttachment, handlePasteAsNote,
    lastTurnScope, handleAnalyzeNote, handleRelateNote, handleLookWider,
    handleSuggestion, handleFeedback, handleRegenerate, handleSwitchVariant,
    handleSaveInsight, saveInsightBusy, insightsButtonVisible,
    crisisActive, dismissCrisis,
    dialogue,
    dailyLimit,
    loadCustomPersonas, openDialogueById,
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
    convPersonaId, convPersonaName, convVisual,
    activeDialogue,
    MAX_INPUT_CHARS,
  } = useAIPageData(linkedDocId, draftFacetId);

  const { profile } = useProfile();
  const userId = profile?.uid ?? 'guest';
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { handleCreateNote } = createNoteActions({ userId, showToast, t });
  // Ревью 0.10.1: стабильная ссылка — новая стрелка на каждый кусок потока
  // ломала memo у MarkdownRenderer, и все прошлые ответы разбирались заново.
  const onCitationMissing = useCallback(() => showToast(t('ai_cite_not_on_device'), 'info'), [showToast, t]);

  // DI-6: переход из «Выводов из разговоров» — параметр снимаем после чтения,
  // по образцу draftFacet; архивный открывается как из списка архива.
  const dialogueParam = searchParams.get('dialogue') ?? undefined;
  useEffect(() => {
    if (!dialogueParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('dialogue');
    setSearchParams(next, { replace: true });
    void openDialogueById(dialogueParam).then(d => {
      if (!d) { showToast(t('ai_dialogue_gone'), 'info'); return; }
      setSelectedPersonaId(d.personaId);
    });
  }, [dialogueParam, openDialogueById, searchParams, setSearchParams, showToast, t, setSelectedPersonaId]);

  const [memoryOpen, setMemoryOpen] = useState(false);
  // MR-1: на телефоне список диалогов живёт в листе, который открывает ☰ в шапке.
  const [dialoguesOpen, setDialoguesOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const navigate = useNavigate();
  const [previewSession, setPreviewSession] = useState<ArchiveSession | null>(null);

  return (
    <div className={cn("bg-surface-base flex", isMobile ? "h-full flex-col" : "h-screen flex-row")}>
      {!isMobile && (
        <AIChatSidebar
          list={dialogueList}
          activeDialogueId={activeDialogueId}
          onSelectDialogue={(id, personaId) => { setActiveDialogueId(id); setSelectedPersonaId(personaId); }}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onNewDialogue={handleNewDialogue}
          onUnarchive={(id) => { void handleUnarchive(id); }}
        />
      )}

      <div className={cn("flex-1 flex flex-col min-w-0 relative", isMobile && "min-h-0")}>
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
          onOpenDialogues={() => setDialoguesOpen(true)}
          onNewDialogue={() => { setDialoguesOpen(false); void handleNewDialogue(); }}
          quota={{
            chatRemaining: dailyLimit.remaining,
            chatTotal: dailyLimit.limit,
            reasoningRemaining: dailyLimit.reasoningRemaining ?? 5,
            reasoningTotal: dailyLimit.reasoningLimit ?? 5,
          }}
        />

        <AIChatMessages
          displayMessages={displayMessages}
          streamingMessage={streamingMessage}
          streamingReasoning={streamingReasoning}
          isLoading={isLoading}
          error={error}
          clearError={clearError}
          consentRequired={consentRequired}
          onOpenSettings={() => { void navigate('/settings#security'); }}
          convPersonaId={convPersonaId}
          convPersonaName={convPersonaName}
          dialogueDocumentId={activeDialogue?.documentId ?? undefined}
          convVisual={convVisual}
          onCopyMessage={handleCopyMessage}
          onDeleteMessage={(index) => { void handleDeleteMessage(index); }}
          onFeedback={(v) => { void handleFeedback(v); }}
          onSaveInsight={insightsButtonVisible ? handleSaveInsight : undefined}
          saveInsightBusy={saveInsightBusy}
          onRegenerate={() => { void handleRegenerate(); }}
          onSwitchVariant={(delta) => { void handleSwitchVariant(delta); }}
          onCreateNote={(text) => { void handleCreateNote(text); }}
          onForcedSearch={(query) => { void triggerForcedSearch(query); }}
          dailyLimitRemaining={dailyLimit.remaining}
          followUps={followUps}
          onSuggestion={handleSuggestion}
          starters={starters}
          activeDialogueId={activeDialogueId}
          activePersonaName={activePersona?.name ?? ''}
          activePersonaNameInstrumental={activePersona?.nameInstrumental}
          headerVisual={headerVisual}
          proactiveHint={proactiveHint}
          setInputText={setInputText}
          isMobile={isMobile}
          messagesEndRef={messagesEndRef}
          previewSession={previewSession}
          onClosePreview={() => setPreviewSession(null)}
          setCitationPreviewSession={setPreviewSession}
          onCitationMissing={onCitationMissing}
        />

        <AIChatComposer
          isMobile={isMobile}
          inputText={inputText}
          setInputText={setInputText}
          inputRef={inputRef}
          isLoading={isLoading}
          onStop={() => stop()}
          onSend={() => { void handleSendMessage(); }}
          pendingAttachments={pendingAttachments}
          removePendingAttachment={removePendingAttachment}
          onPasteAsNote={handlePasteAsNote}
          onAnalyzeNote={handleAnalyzeNote}
          onRelateNote={handleRelateNote}
          onLookWider={lastTurnScope === 'note' ? handleLookWider : undefined}
          attachMenuOpen={attachMenuOpen}
          setAttachMenuOpen={setAttachMenuOpen}
          attachMenuRef={attachMenuRef}
          fileInputRef={fileInputRef}
          onFileUpload={handleFileUpload}
          onOpenDocPicker={() => setDocPickerOpen(true)}
          dailyLimitRemaining={dailyLimit.remaining}
          dailyLimitTotal={dailyLimit.limit}
          quotaUnknown={dailyLimit.limitUnknown}
          reasoningRemaining={dailyLimit.reasoningRemaining}
          reasoningLimit={dailyLimit.reasoningLimit}
          reasoning={reasoning}
          maxInputChars={MAX_INPUT_CHARS}
          crisisActive={crisisActive}
          dismissCrisis={dismissCrisis}
        />
      </div>

      {isMobile && (
        <MobileDialogueListSheet
          open={dialoguesOpen}
          onClose={() => setDialoguesOpen(false)}
          list={dialogueList}
          activeDialogueId={activeDialogueId}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onSelectDialogue={(id, personaId) => {
            setActiveDialogueId(id);
            setSelectedPersonaId(personaId);
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }}
          onRename={(id, title) => { void handleRenameDialogue(id, title); }}
          onArchive={(id) => { void handleArchive(id); }}
          onUnarchive={(id) => { void handleUnarchive(id); }}
          onDelete={(id) => { void handleDelete(id); }}
        />
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
            onContinue={s => closePanelsForNavigation(() => void navigate('/', { state: { sessionToContinue: s } }))}
            onAttach={id => { void handleDocSelect(id); setPreviewSession(null); }}
            onAnalyzeNote={id => NoteAnalysisService.analyze(id)}
            fetchSummary={async id => (await AISummaryService.get(id)) ?? null}
            fetchRelatedNotes={id => findRelatedNotes({ docId: id }, { maxResults: 4 })}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
