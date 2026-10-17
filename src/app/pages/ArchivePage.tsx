import React, { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import type { AppUser } from '../../core/auth/types';
import { UserProfile } from '../../types';
import { calculateStreak, cn } from '../../core/utils/utils';
import { useLocalStorage } from '../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../shared/components/Layout/AdaptiveContainer';
import { useLanguage } from '../../shared/i18n';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../shared/components/Button';
import { useUserId } from '../../shared/hooks/useUserId';
import { ArchiveHeader, type SortMode } from '../../features/archive/components/ArchiveHeader';
import { MobileArchiveHeader } from '../../features/archive/components/MobileArchiveHeader';
import { MobileInlinePanel } from '../../features/archive/components/MobileInlinePanel';
import { MobileArchiveMenuSheet } from '../../features/archive/components/MobileArchiveMenuSheet';
import { useToast } from '../../shared/components/Toast';
import { ArchiveTagBar } from '../../features/archive/components/ArchiveTagBar';
import { ArchiveLabelBar } from '../../features/archive/components/ArchiveLabelBar';
import { isSearchShortcut } from '../../features/archive/utils/searchShortcut';
import { ArchiveNoteList } from '../../features/archive/components/ArchiveNoteList';
import { ImportDropOverlay } from '../../features/archive/components/ImportDropOverlay';
import { OnThisDayCard } from '../../features/archive/components/OnThisDayCard';
import { ArchiveConfirmModals } from '../../features/archive/components/ArchiveConfirmModals';
import { ArchiveSidebarContent, MobileArchiveSidebarSheet } from '../../features/archive/components/MobileArchiveSidebarSheet';
import { useArchiveData } from '../../features/archive/hooks/useArchiveData';
import { useProfileLabels } from '../../features/profile/hooks/useProfileLabels';
import { useTagEditor } from '../../features/archive/hooks/useTagEditor';
import { useLabelEditor } from '../../features/archive/hooks/useLabelEditor';
import { useArchiveGrouping } from '../../features/archive/hooks/useArchiveGrouping';
import { useLayoutMode } from '../../shared/hooks/useLayoutMode';
import { closePanelsForNavigation } from '../../shared/hooks/usePanelHistory';
import { rebuildWordCloud } from '../../features/archive/hooks/useArchiveWordCloud';

import { ArchiveTrashView } from '../../features/archive/components/ArchiveTrashView';

import { NoteAnalysisService } from '../../features/ai/services/NoteAnalysisService';
import { AISummaryService } from '../../features/ai/services/AISummaryService';
import { findRelatedNotes } from '../../features/ai/utils/relatedNotes';

const DocumentPreview = lazy(() =>
  import('../../features/archive/components/DocumentPreview').then(m => ({ default: m.DocumentPreview }))
);
const ArchiveSidebar = lazy(() =>
  import('../../features/archive/components/ArchiveSidebar').then(m => ({ default: m.ArchiveSidebar }))
);

interface ArchiveViewProps {
  user: AppUser | null;
  profile: UserProfile | null;
}

export function ArchivePage({ user, profile }: ArchiveViewProps) {
  const { t, tp, language } = useLanguage();
  const navigate = useNavigate();
  const userId = useUserId(user);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // MF-17: на телефоне календарь и статистика — панель над заметками, а не лист.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // MR-8: на телефоне остальные контролы шапки живут в этом листе.
  const [archiveMenuOpen, setArchiveMenuOpen] = useState(false);
  const [showTagLabelBars, setShowTagLabelBars] = useState(false);
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isSearchShortcut(e, document.activeElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const { labels: profileLabels, addLabel, updateLabel, removeLabel } = useProfileLabels(userId, profile?.labels ?? []);

  const [activeTab, setActiveTab] = useState<'notes' | 'trash'>('notes');

  const {
    loading, error, cloudLoadFailed, fetchSessions, sessions, trashedSessions,
    handleTrashSession, handleRestoreSession, handlePermanentDeleteSession, handleEmptyTrash,
    handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession, openPreview, deleteConfirm, setDeleteConfirm,
    permanentDeleteConfirm, setPermanentDeleteConfirm,
    emptyTrashConfirm, setEmptyTrashConfirm,
    allTags, tagCounts, labelCounts, filteredByFilters, filteredSessions, searchQuery, setSearchQuery,
    selectedDate, setSelectedDate, selectedMonth: _selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags, selectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordsByDate, wordCloud, maxCount,
    dateLocale,
  } = useArchiveData(user, userId, t, language, profileLabels);

  const filteredTrashedSessions = useMemo(() => {
    if (!searchQuery.trim()) return trashedSessions;
    const q = searchQuery.toLowerCase();
    return trashedSessions.filter(s =>
      (s.title && s.title.toLowerCase().includes(q)) ||
      (s.content && s.content.toLowerCase().includes(q)) ||
      (s.tags && s.tags.some(tag => tag.toLowerCase().includes(q)))
    );
  }, [trashedSessions, searchQuery]);

  const previewContext = useMemo(() => {
    const totalActive = selectedLabels.length + selectedTags.length + (selectedDate ? 1 : 0);
    if (totalActive !== 1) return undefined;
    if (selectedLabels.length === 1) {
      return profileLabels.find(l => l.id === selectedLabels[0])?.name;
    }
    if (selectedTags.length === 1) {
      return '#' + selectedTags[0];
    }
    if (selectedDate) {
      return format(selectedDate, 'd MMM yyyy', { locale: dateLocale });
    }
    return undefined;
  }, [selectedLabels, selectedTags, selectedDate, profileLabels, dateLocale]);

  const tagEditor = useTagEditor(userId, fetchSessions);
  const labelEditor = useLabelEditor({ addLabel, updateLabel, removeLabel: (id) => void removeLabel(id) });

  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleImportFiles = async (files: FileList) => {
    let importedCount = 0;
    let failedCount = 0;
    let dateWarningCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      try {
        const { importNoteFile } = await import('../../features/archive/services/archiveImport');
        const res = await importNoteFile(file, userId, !!user);
        if (res.success) {
          importedCount++;
          if (res.dateUnreadable) dateWarningCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        console.error('Failed to import file:', file.name, err);
        failedCount++;
      }
    }

    if (importedCount > 0) {
      showToast(t('archive_import_success', { count: importedCount }), 'success');
      void fetchSessions();
      void rebuildWordCloud(userId).catch(() => {});
    }
    if (dateWarningCount > 0) {
      showToast(t('archive_import_date_warning', { count: dateWarningCount }), 'error');
    }
    if (failedCount > 0) {
      showToast(t('archive_import_failed', { count: failedCount }), 'error');
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer !== null && e.dataTransfer.files.length > 0) {
      void handleImportFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files !== null && e.target.files.length > 0) {
      void handleImportFiles(e.target.files);
    }
  };

  const filteredStreakDays = useMemo(() => calculateStreak(filteredByFilters), [filteredByFilters]);

  const [viewMode, setViewMode] = useLocalStorage<'list' | 'grid'>(
    'archive_viewMode',
    'list',
    z.enum(['list', 'grid'])
  );

  const [sortMode, setSortMode] = useLocalStorage<SortMode>(
    'archive_sortMode',
    'newest',
    z.enum(['newest', 'oldest', 'longest', 'shortest', 'title_az', 'title_za'])
  );

  const sortLabels: Record<SortMode, string> = useMemo(() => ({
    newest: t('archive_sort_newest'),
    oldest: t('archive_sort_oldest'),
    longest: t('archive_sort_longest'),
    shortest: t('archive_sort_shortest'),
    title_az: t('archive_sort_title_az'),
    title_za: t('archive_sort_title_za'),
  }), [t]);

  const sortedSessions = useMemo(() => {
    const s = [...filteredSessions];
    switch (sortMode) {
      case 'oldest':    return s.sort((a, b) => (a.sessionStartTime ?? 0) - (b.sessionStartTime ?? 0));
      case 'newest':    return s.sort((a, b) => (b.sessionStartTime ?? 0) - (a.sessionStartTime ?? 0));
      case 'longest':   return s.sort((a, b) => b.wordCount - a.wordCount);
      case 'shortest':  return s.sort((a, b) => a.wordCount - b.wordCount);
      case 'title_az':  return s.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', language));
      case 'title_za':  return s.sort((a, b) => (b.title ?? '').localeCompare(a.title ?? '', language));
      default:          return s;
    }
  }, [filteredSessions, sortMode, language]);

  const { groupedSessions, sortedDates: dateGroupOrder } = useArchiveGrouping(sortedSessions);

  const sortedDates = useMemo(() => {
    if (sortMode === 'oldest') return [...dateGroupOrder].reverse();
    return dateGroupOrder;
  }, [dateGroupOrder, sortMode]);

  const isGroupedByDate = sortMode === 'newest' || sortMode === 'oldest';

  return (
    <AdaptiveContainer>
      <motion.div
        initial={{ opacity: 0, transform: "translateY(20px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        className="h-screen overflow-hidden flex flex-col relative"
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".txt,.md,.docx"
          multiple
          style={{ display: 'none' }}
        />
        {/* MR-4: min-w-[320px] нужен десктопной колонке, а на телефоне складывался
            с отступами main и давал горизонтальный скролл на 320. */}
        <div className={cn("flex gap-0 flex-1 min-h-0", !isMobile && "min-w-[320px]")}>
          {/* MQ-8: высокую панель календаря прокручивает колонка, а не сама панель — список под
              ней получает свою высоту (70dvh) и остаётся достижим прокруткой колонки. */}
          <div className={cn("flex-1 min-w-0 pr-0 lg:pr-8 flex flex-col min-h-0", isMobile && calendarOpen && "overflow-y-auto")}>
            <div className="shrink-0">
            {isMobile ? (
              <>
                <MobileArchiveHeader
                  title={activeTab === 'notes' ? t('nav_notes') : t('archive_tab_trash')}
                  count={activeTab === 'notes' ? sortedSessions.length : filteredTrashedSessions.length}
                  countLabel={tp('archive_count', activeTab === 'notes' ? sortedSessions.length : filteredTrashedSessions.length)}
                  searchQuery={searchQuery} searchInputRef={searchInputRef} onSearchChange={setSearchQuery}
                  onOpenMenu={() => setArchiveMenuOpen(true)}
                  allTags={allTags} selectedTags={selectedTags}
                  onToggleTag={tag => setSelectedTags(prev => (prev.includes(tag) ? prev.filter(x => x !== tag) : [...prev, tag]))}
                />
                <MobileArchiveMenuSheet
                  open={archiveMenuOpen}
                  onClose={() => setArchiveMenuOpen(false)}
                  viewMode={viewMode} onViewModeChange={setViewMode}
                  sortMode={sortMode} onSortModeChange={setSortMode} sortLabels={sortLabels}
                  onOpenTags={() => setShowTagLabelBars(v => !v)}
                  tagsOpen={showTagLabelBars}
                  onOpenCalendar={() => setCalendarOpen(v => !v)}
                  calendarOpen={calendarOpen}
                  activeTab={activeTab} onTabChange={setActiveTab}
                  trashCount={trashedSessions.length}
                  onClearTrash={() => setEmptyTrashConfirm(true)}
                />
              </>
            ) : (
              <ArchiveHeader
              title={activeTab === 'notes' ? t('nav_notes') : t('archive_tab_trash')}
              count={activeTab === 'notes' ? sortedSessions.length : filteredTrashedSessions.length}
              countLabel={tp('archive_count', activeTab === 'notes' ? sortedSessions.length : filteredTrashedSessions.length)}
              subtitle={activeTab === 'notes' ? t('archive_subtitle') : t('archive_trash_subtitle')}
              searchQuery={searchQuery} searchInputRef={searchInputRef} onSearchChange={setSearchQuery}
              searchPlaceholder={activeTab === 'notes' ? t('archive_search_placeholder') : t('archive_trash_search_placeholder')}
              viewMode={viewMode} onViewModeChange={setViewMode}
              listLabel={t('archive_list')} gridLabel={t('archive_grid')}
              sortMode={sortMode} onSortModeChange={setSortMode} sortLabels={sortLabels}
              onFilterClick={() => setIsFilterOpen(true)}
              showFilters={showTagLabelBars}
              onToggleFilters={() => setShowTagLabelBars(v => !v)}
              // Временно скрыто, см. TASK-4
              // onImportClick={() => fileInputRef.current?.click()}
              importLabel={t('archive_import')}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              notesTabLabel={t('archive_tab_notes')}
              trashTabLabel={t('archive_tab_trash')}
              trashCount={trashedSessions.length}
            />
            )}
            {isMobile && activeTab === 'notes' && calendarOpen && (
              <MobileInlinePanel testId="archive-calendar-panel" title={t('archive_menu_calendar')} onClose={() => setCalendarOpen(false)}>
                <div className="space-y-5">
                  <ArchiveSidebarContent
                    filteredByFilters={filteredByFilters} streakDays={filteredStreakDays} statsTitle={statsTitle}
                    onReset={hasActiveFilter ? resetStatsFilter : undefined}
                    sessions={sessions} sessionsByDate={sessionsByDate} wordsByDate={wordsByDate} selectedDate={selectedDate}
                    onSelectDate={setSelectedDate} onSelectMonth={setSelectedMonth}
                    wordCloud={wordCloud} maxCount={maxCount} onWordClick={setSearchQuery} collapseCloud flat
                  />
                </div>
              </MobileInlinePanel>
            )}
            {activeTab === 'notes' && (
              isMobile ? (
                showTagLabelBars && (allTags.length > 0 || profileLabels.length > 0) && (
                  <MobileInlinePanel testId="archive-tags-panel" title={t('archive_menu_tags')} onClose={() => setShowTagLabelBars(false)}>
                  <div className="flex flex-col [&>div:last-child]:!border-b-0">
                    <ArchiveTagBar
                      allTags={allTags}
                      selectedTags={selectedTags}
                      tagCounts={tagCounts}
                      onToggleTag={tag => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                      renamingTag={tagEditor.renamingTag} renameTagValue={tagEditor.renameTagValue}
                      setRenameTagValue={tagEditor.setRenameTagValue}
                      onStartRename={(tag) => void tagEditor.startRenameTag(tag)} onRenameSubmit={(tag, newName) => void tagEditor.handleRenameTag(tag, newName)}
                      onRenameCancel={() => tagEditor.setRenamingTag(null)} onDeleteTag={tagEditor.setTagDeleteConfirm}
                      onResetTags={() => setSelectedTags([])} showControls={false} t={t}
                      labelKey="archive_tags_only"
                      variant="sheet"
                    />
                    <ArchiveLabelBar
                      labels={profileLabels} selectedLabels={selectedLabels} onToggleLabel={toggleLabel}
                      labelCounts={labelCounts}
                      addingLabel={labelEditor.addingLabel} setAddingLabel={labelEditor.setAddingLabel}
                      newLabelName={labelEditor.newLabelName} setNewLabelName={labelEditor.setNewLabelName}
                      newLabelColor={labelEditor.newLabelColor} setNewLabelColor={labelEditor.setNewLabelColor}
                      onAddLabel={labelEditor.handleAddLabel}
                      editingLabelId={labelEditor.editingLabelId} setEditingLabelId={labelEditor.setEditingLabelId}
                      editLabelName={labelEditor.editLabelName} setEditLabelName={labelEditor.setEditLabelName}
                      editLabelColor={labelEditor.editLabelColor} setEditLabelColor={labelEditor.setEditLabelColor}
                      onUpdateLabel={labelEditor.handleUpdateLabel} onDeleteLabel={labelEditor.setLabelDeleteConfirm}
                      showControls={false} t={t}
                      variant="sheet"
                    />
                  </div>
                  </MobileInlinePanel>
                )
              ) : (
                showTagLabelBars && (
                  <>
                    <ArchiveTagBar
                      allTags={allTags}
                      selectedTags={selectedTags}
                      tagCounts={tagCounts}
                      onToggleTag={tag => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                      renamingTag={tagEditor.renamingTag} renameTagValue={tagEditor.renameTagValue}
                      setRenameTagValue={tagEditor.setRenameTagValue}
                      onStartRename={(tag) => void tagEditor.startRenameTag(tag)} onRenameSubmit={(tag, newName) => void tagEditor.handleRenameTag(tag, newName)}
                      onRenameCancel={() => tagEditor.setRenamingTag(null)} onDeleteTag={tagEditor.setTagDeleteConfirm}
                      onResetTags={() => setSelectedTags([])} showControls={!!user} t={t}
                    />
                    <ArchiveLabelBar
                      labels={profileLabels} selectedLabels={selectedLabels} onToggleLabel={toggleLabel}
                      labelCounts={labelCounts}
                      addingLabel={labelEditor.addingLabel} setAddingLabel={labelEditor.setAddingLabel}
                      newLabelName={labelEditor.newLabelName} setNewLabelName={labelEditor.setNewLabelName}
                      newLabelColor={labelEditor.newLabelColor} setNewLabelColor={labelEditor.setNewLabelColor}
                      onAddLabel={labelEditor.handleAddLabel}
                      editingLabelId={labelEditor.editingLabelId} setEditingLabelId={labelEditor.setEditingLabelId}
                      editLabelName={labelEditor.editLabelName} setEditLabelName={labelEditor.setEditLabelName}
                      editLabelColor={labelEditor.editLabelColor} setEditLabelColor={labelEditor.setEditLabelColor}
                      onUpdateLabel={labelEditor.handleUpdateLabel} onDeleteLabel={labelEditor.setLabelDeleteConfirm}
                      showControls={!!user} t={t}
                    />
                  </>
                )
              )
            )}
            {cloudLoadFailed && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-accent-danger/10 border border-accent-danger/30 text-accent-danger flex items-center justify-between mt-4">
                <span>{t('archive_cloud_load_error')}</span>
                <Button onClick={() => void fetchSessions()} className="underline text-accent-danger/70 hover:text-accent-danger">{t('retry')}</Button>
              </div>
            )}
            {activeTab === 'notes' && !searchQuery && <OnThisDayCard sessions={filteredByFilters} onOpen={s => void openPreview(s)} />}
            </div>
            {activeTab === 'trash' ? (
              <div className="mt-4 flex-1 min-h-0 pr-1">
                <ArchiveTrashView
                  trashedSessions={filteredTrashedSessions}
                  onRestore={handleRestoreSession}
                  onDeletePermanently={s => setPermanentDeleteConfirm(s)}
                  onEmptyTrash={() => setEmptyTrashConfirm(true)}
                  onOpenPreview={s => void openPreview(s)}
                  dateLocale={dateLocale}
                  t={t}
                  isMobile={isMobile}
                />
              </div>
            ) : (
              <div className={cn("mt-4 pr-1", isMobile && calendarOpen ? "h-[70dvh] shrink-0" : "flex-1 min-h-0")}>
                <ArchiveNoteList
                  viewMode={viewMode} loading={loading} error={error} filteredSessions={sortedSessions}
                  groupedSessions={groupedSessions} sortedDates={sortedDates} dateLocale={dateLocale}
                  labels={profileLabels} userId={userId} searchQuery={searchQuery}
                  isGroupedByDate={isGroupedByDate}
                  onOpen={s => void openPreview(s)} onDelete={s => setDeleteConfirm(s)}
                  onTagsChange={(s, tags) => void handleTagsChange(s, tags)} onTitleChange={(s, title) => void handleTitleChange(s, title)}
                  onDateChange={(s, date) => void handleDateChange(s, date)} onLabelChange={(s, label) => void handleLabelChange(s, label)}
                  onStorageChange={() => void fetchSessions()} t={t} language={language}
                  allTags={allTags} onClearSearch={() => setSearchQuery('')}
                  onAnalyzeNote={id => NoteAnalysisService.analyze(id)}
                  onClearAnalysis={id => NoteAnalysisService.clear(id)}
                  loadAiProcessedMap={() => AISummaryService.hasAll()}
                />
              </div>
            )}
          </div>
          <Suspense fallback={null}>
            <ArchiveSidebar
              filteredByFilters={filteredByFilters} streakDays={filteredStreakDays} statsTitle={statsTitle}
              onReset={hasActiveFilter ? resetStatsFilter : undefined}
              sessions={sessions} sessionsByDate={sessionsByDate} wordsByDate={wordsByDate} selectedDate={selectedDate}
              onSelectDate={setSelectedDate} onSelectMonth={setSelectedMonth}
              wordCloud={wordCloud} maxCount={maxCount} onWordClick={setSearchQuery}
            />
          </Suspense>
          <AnimatePresence>
            { /* R5 (emil-review, хвост MQ-15): затемнение десктопного превью
                стояло вне AnimatePresence и появлялось/пропадало рывком. Теперь
                оно в том же блоке и гаснет за 200 мс вместе с окном. Что
                меняется на десктопе: только появление и исчезновение подложки
                (200 мс по прозрачности); сама карточка превью, её содержимое и
                слои не тронуты, на телефоне этого слоя нет. */}
            {previewSession && (
              /* not-a-modal: preview backdrop */
              <motion.div
                key="preview-backdrop"
                className="fixed inset-0 z-40 bg-black/20"
                onClick={() => setPreviewSession(null)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            )}
            {previewSession && (
              <Suspense fallback={null}>
                <DocumentPreview
                session={previewSession} onClose={() => setPreviewSession(null)}
                context={previewContext}
                onContinue={s => closePanelsForNavigation(() => void navigate('/', { state: { sessionToContinue: s } }))}
                onTagsChange={(s, tags) => void handleTagsChange(s, tags)} onLabelChange={(s, label) => void handleLabelChange(s, label)}
                onAddLabel={(label) => void addLabel(label)} labels={profileLabels} allTags={allTags}
                onTitleChange={(s, title) => void handleTitleChange(s, title)}
                onDelete={s => setDeleteConfirm(s)} onStorageChange={() => void fetchSessions()}
                onAnalyzeNote={id => NoteAnalysisService.analyze(id)}
                onClearAnalysis={id => NoteAnalysisService.clear(id)}
                fetchSummary={async id => (await AISummaryService.get(id)) ?? null}
                fetchRelatedNotes={id => findRelatedNotes({ docId: id }, { maxResults: 4 })}
              />
              </Suspense>
            )}
          </AnimatePresence>
          <ArchiveConfirmModals
            tagEditor={tagEditor} labelEditor={labelEditor} deleteConfirm={deleteConfirm}
            onDeleteConfirm={async () => { await handleTrashSession(deleteConfirm!); setDeleteConfirm(null); }}
            onDeleteCancel={() => setDeleteConfirm(null)}
            permanentDeleteConfirm={permanentDeleteConfirm}
            onPermanentDeleteConfirm={async () => {
              if (permanentDeleteConfirm) await handlePermanentDeleteSession(permanentDeleteConfirm);
              setPermanentDeleteConfirm(null);
            }}
            onPermanentDeleteCancel={() => setPermanentDeleteConfirm(null)}
            emptyTrashConfirm={emptyTrashConfirm}
            onEmptyTrashConfirm={async () => {
              await handleEmptyTrash(trashedSessions);
              setEmptyTrashConfirm(false);
            }}
            onEmptyTrashCancel={() => setEmptyTrashConfirm(false)}
            t={t}
          />
          <AnimatePresence>
            {isFilterOpen && (
              <MobileArchiveSidebarSheet
                isOpen={isFilterOpen}
                onClose={() => setIsFilterOpen(false)}
                filteredByFilters={filteredByFilters}
                streakDays={filteredStreakDays}
                statsTitle={statsTitle}
                onReset={hasActiveFilter ? resetStatsFilter : undefined}
                sessions={sessions}
                sessionsByDate={sessionsByDate}
                wordsByDate={wordsByDate}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onSelectMonth={setSelectedMonth}
                wordCloud={wordCloud}
                maxCount={maxCount}
                onWordClick={(w) => { setSearchQuery(w); setIsFilterOpen(false); }}
              />
            )}
          </AnimatePresence>
        </div>

        {dragActive && (
          <ImportDropOverlay
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          />
        )}
      </motion.div>
    </AdaptiveContainer>
  );
}
