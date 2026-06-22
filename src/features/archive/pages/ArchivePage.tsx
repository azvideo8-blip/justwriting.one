import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { calculateStreak } from '../../../core/utils/utils';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { useLanguage } from '../../../shared/i18n';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { useUserId } from '../../../shared/hooks/useUserId';
import { ArchiveHeader, type SortMode } from '../components/ArchiveHeader';
import { ArchiveTagBar } from '../components/ArchiveTagBar';
import { ArchiveLabelBar } from '../components/ArchiveLabelBar';
import { ArchiveNoteList } from '../components/ArchiveNoteList';
import { OnThisDayCard } from '../components/OnThisDayCard';
import { ArchiveConfirmModals } from '../components/ArchiveConfirmModals';
import { MobileArchiveSidebarSheet } from '../components/MobileArchiveSidebarSheet';
import { useArchiveData } from '../hooks/useArchiveData';
import { useProfileLabels } from '../../profile/hooks/useProfileLabels';
import { useTagEditor } from '../hooks/useTagEditor';
import { useLabelEditor } from '../hooks/useLabelEditor';
import { useArchiveGrouping } from '../hooks/useArchiveGrouping';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

const DocumentPreview = lazy(() =>
  import('../components/DocumentPreview').then(m => ({ default: m.DocumentPreview }))
);
const ArchiveSidebar = lazy(() =>
  import('../components/ArchiveSidebar').then(m => ({ default: m.ArchiveSidebar }))
);

interface ArchiveViewProps {
  user: User | null;
  profile: UserProfile | null;
}

export function ArchivePage({ user, profile }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const userId = useUserId(user);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [showTagLabelBars, setShowTagLabelBars] = useState(false);
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const { labels: profileLabels, addLabel, updateLabel, removeLabel } = useProfileLabels(userId, profile?.labels ?? []);

  const {
    loading, error, cloudLoadFailed, fetchSessions, sessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession, deleteConfirm, setDeleteConfirm,
    allTags, filteredByFilters, filteredSessions, searchQuery, setSearchQuery,
    selectedDate, setSelectedDate, selectedMonth: _selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags, selectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordCloud, maxCount,
    dateLocale, entriesLabel,
  } = useArchiveData(user, userId, t, language, profileLabels);

  const tagEditor = useTagEditor(userId, fetchSessions);
  const labelEditor = useLabelEditor({ addLabel, updateLabel, removeLabel: (id) => void removeLabel(id) });

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
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="h-screen overflow-hidden flex flex-col">
        <div className="flex gap-0 min-w-[320px] flex-1 min-h-0">
          <div className="flex-1 min-w-0 pr-0 lg:pr-8 flex flex-col min-h-0">
            <div className="shrink-0">
            <ArchiveHeader
              title={t('nav_notes')} count={sortedSessions.length} countLabel={t('archive_count')}
              subtitle={t('archive_subtitle')}
              searchQuery={searchQuery} searchInputRef={searchInputRef} onSearchChange={setSearchQuery}
              searchPlaceholder={t('archive_search_placeholder')}
              viewMode={viewMode} onViewModeChange={setViewMode}
              listLabel={t('archive_list')} gridLabel={t('archive_grid')}
              sortMode={sortMode} onSortModeChange={setSortMode} sortLabels={sortLabels}
              onFilterClick={() => setIsFilterOpen(true)}
              showFilters={showTagLabelBars}
              onToggleFilters={() => setShowTagLabelBars(v => !v)}
              toggleFiltersLabel={showTagLabelBars ? t('archive_tags_hide') : t('archive_tags_label')}
            />
            {isMobile ? (
              showTagLabelBars && (allTags.length > 0 || profileLabels.length > 0) && (
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl px-4 py-1 shadow-md flex flex-col mt-4 [&>div:last-child]:!border-b-0">
                  <ArchiveTagBar
                    allTags={allTags}
                    selectedTags={selectedTags}
                    onToggleTag={tag => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                    renamingTag={tagEditor.renamingTag} renameTagValue={tagEditor.renameTagValue}
                    setRenameTagValue={tagEditor.setRenameTagValue}
                    onStartRename={(tag) => void tagEditor.startRenameTag(tag)} onRenameSubmit={(tag, newName) => void tagEditor.handleRenameTag(tag, newName)}
                    onRenameCancel={() => tagEditor.setRenamingTag(null)} onDeleteTag={tagEditor.setTagDeleteConfirm}
                    onResetTags={() => setSelectedTags([])} showControls={false} t={t}
                  />
                  <ArchiveLabelBar
                    labels={profileLabels} selectedLabels={selectedLabels} onToggleLabel={toggleLabel}
                    addingLabel={labelEditor.addingLabel} setAddingLabel={labelEditor.setAddingLabel}
                    newLabelName={labelEditor.newLabelName} setNewLabelName={labelEditor.setNewLabelName}
                    newLabelColor={labelEditor.newLabelColor} setNewLabelColor={labelEditor.setNewLabelColor}
                    onAddLabel={labelEditor.handleAddLabel}
                    editingLabelId={labelEditor.editingLabelId} setEditingLabelId={labelEditor.setEditingLabelId}
                    editLabelName={labelEditor.editLabelName} setEditLabelName={labelEditor.setEditLabelName}
                    editLabelColor={labelEditor.editLabelColor} setEditLabelColor={labelEditor.setEditLabelColor}
                    onUpdateLabel={labelEditor.handleUpdateLabel} onDeleteLabel={labelEditor.setLabelDeleteConfirm}
                    showControls={false} t={t}
                  />
                </div>
              )
            ) : (
              showTagLabelBars && (
                <>
                  <ArchiveTagBar
                    allTags={allTags}
                    selectedTags={selectedTags}
                    onToggleTag={tag => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                    renamingTag={tagEditor.renamingTag} renameTagValue={tagEditor.renameTagValue}
                    setRenameTagValue={tagEditor.setRenameTagValue}
                    onStartRename={(tag) => void tagEditor.startRenameTag(tag)} onRenameSubmit={(tag, newName) => void tagEditor.handleRenameTag(tag, newName)}
                    onRenameCancel={() => tagEditor.setRenamingTag(null)} onDeleteTag={tagEditor.setTagDeleteConfirm}
                    onResetTags={() => setSelectedTags([])} showControls={!!user} t={t}
                  />
                  <ArchiveLabelBar
                    labels={profileLabels} selectedLabels={selectedLabels} onToggleLabel={toggleLabel}
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
            )}
            {cloudLoadFailed && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-accent-danger/10 border border-accent-danger/30 text-accent-danger flex items-center justify-between mt-4">
                <span>{t('archive_cloud_load_error')}</span>
                <Button onClick={() => void fetchSessions()} className="underline text-accent-danger/70 hover:text-accent-danger">{t('retry')}</Button>
              </div>
            )}
            {!searchQuery && <OnThisDayCard sessions={filteredByFilters} onOpen={s => setPreviewSession(s)} />}
            </div>
            <div className="mt-4 flex-1 min-h-0 pr-1">
              <ArchiveNoteList
                viewMode={viewMode} loading={loading} error={error} filteredSessions={sortedSessions}
                groupedSessions={groupedSessions} sortedDates={sortedDates} dateLocale={dateLocale}
                labels={profileLabels} userId={userId} searchQuery={searchQuery}
                isGroupedByDate={isGroupedByDate}
                onOpen={s => setPreviewSession(s)} onDelete={s => setDeleteConfirm(s)}
                onTagsChange={(s, tags) => void handleTagsChange(s, tags)} onTitleChange={(s, title) => void handleTitleChange(s, title)}
                onDateChange={(s, date) => void handleDateChange(s, date)} onLabelChange={(s, label) => void handleLabelChange(s, label)}
                onStorageChange={() => void fetchSessions()} t={t} language={language} entriesLabel={entriesLabel}
                allTags={allTags} onClearSearch={() => setSearchQuery('')}
              />
            </div>
          </div>
          <Suspense fallback={null}>
            <ArchiveSidebar
              filteredByFilters={filteredByFilters} streakDays={filteredStreakDays} statsTitle={statsTitle}
              onReset={hasActiveFilter ? resetStatsFilter : undefined}
              sessions={sessions} sessionsByDate={sessionsByDate} selectedDate={selectedDate}
              onSelectDate={setSelectedDate} onSelectMonth={setSelectedMonth}
              wordCloud={wordCloud} maxCount={maxCount} onWordClick={setSearchQuery}
            />
          </Suspense>
          {previewSession && <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setPreviewSession(null)} />}

          <AnimatePresence>
            {previewSession && (
              <Suspense fallback={null}>
                <DocumentPreview
                session={previewSession} onClose={() => setPreviewSession(null)}
                onContinue={s => void navigate('/', { state: { sessionToContinue: s } })}
                onTagsChange={(s, tags) => void handleTagsChange(s, tags)} onLabelChange={(s, label) => void handleLabelChange(s, label)}
                onAddLabel={(label) => void addLabel(label)} labels={profileLabels} allTags={allTags}
              />
              </Suspense>
            )}
          </AnimatePresence>
          <ArchiveConfirmModals
            tagEditor={tagEditor} labelEditor={labelEditor} deleteConfirm={deleteConfirm}
            onDeleteConfirm={async () => { await handleDeleteSession(deleteConfirm!); setDeleteConfirm(null); }}
            onDeleteCancel={() => setDeleteConfirm(null)} t={t}
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
      </motion.div>
    </AdaptiveContainer>
  );
}
