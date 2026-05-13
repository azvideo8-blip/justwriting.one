import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { Search, LayoutGrid, LayoutList } from 'lucide-react';
import { UserProfile } from '../../../types';
import { cn, calculateStreak } from '../../../core/utils/utils';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { useLanguage } from '../../../core/i18n';
import { useNavigate } from 'react-router-dom';
import { useUserId } from '../../../shared/hooks/useUserId';
import { DocumentPreview } from '../components/DocumentPreview';
import { ArchiveSidebar } from '../components/ArchiveSidebar';
import { ArchiveTagBar } from '../components/ArchiveTagBar';
import { ArchiveLabelBar } from '../components/ArchiveLabelBar';
import { ArchiveNoteList } from '../components/ArchiveNoteList';
import { useArchiveData } from '../hooks/useArchiveData';
import { useProfileLabels } from '../../profile/hooks/useProfileLabels';
import { useTagEditor } from '../hooks/useTagEditor';
import { useLabelEditor } from '../hooks/useLabelEditor';
import { ConfirmModal } from '../../../shared/components/ConfirmModal';

interface ArchiveViewProps {
  user: User | null;
  profile: UserProfile | null;
}

export function ArchivePage({ user, profile }: ArchiveViewProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const userId = useUserId(user);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
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

  const data = useArchiveData(user, userId, t, language, profileLabels);
  const {
    loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession,
    deleteConfirm, setDeleteConfirm,
    allTags, filteredByFilters, filteredSessions,
    searchQuery, setSearchQuery,
    selectedDate, setSelectedDate, selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordCloud, maxCount,
    groupedSessions, sortedDates, dateLocale, entriesLabel,
  } = data;

  const tagEditor = useTagEditor(userId, fetchSessions);
  const labelEditor = useLabelEditor({ addLabel, updateLabel, removeLabel });

  const filteredStreakDays = React.useMemo(() => calculateStreak(filteredByFilters), [filteredByFilters]);

  const [viewMode, setViewMode] = useLocalStorage<'list' | 'grid'>(
    'archive_viewMode',
    'list',
    z.enum(['list', 'grid'])
  );

  return (
    <AdaptiveContainer>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="pb-10"
      >
        <div className="flex gap-0 h-full min-w-[320px]">
          <div className="flex-1 min-w-0 pr-0 lg:pr-8 overflow-y-auto">
            <div style={{ padding: '24px 0 18px', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-baseline gap-3 mb-1">
                <h1 className="text-3xl font-medium tracking-tight text-text-main">
                  {t('nav_notes')}
                </h1>
                <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
                  {filteredSessions.length} {t('archive_count')}
                </span>
              </div>
              <p className="text-sm text-text-main/40 mb-5">
                {t('archive_subtitle')}
              </p>

              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-[440px]">
                  <Search size={14} className="absolute left-3 top-2.5 text-text-main/30" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('archive_search_placeholder')}
                    className="w-full pl-8 pr-10 py-2 bg-text-main/[0.03] border border-border-subtle rounded-lg text-sm text-text-main placeholder:text-text-main/25 outline-none focus:border-border-subtle/60 transition-colors"
                  />
                  <kbd className="absolute right-3 top-2 text-[10px] text-text-main/25 font-mono border border-border-subtle rounded px-1.5 py-0.5">&#8984;K</kbd>
                </div>

                <div className="flex bg-text-main/[0.03] border border-border-subtle rounded-lg p-0.5">
                  {(['list', 'grid'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setViewMode(v)}
                      className={cn(
                        "w-8 h-7 rounded-md flex items-center justify-center transition-all",
                        viewMode === v ? "bg-text-main/10 text-text-main" : "text-text-main/30 hover:text-text-main/60"
                      )}
                      title={v === 'list' ? t('archive_list') : t('archive_grid')}
                      aria-label={v === 'list' ? t('archive_list') : t('archive_grid')}
                    >
                      {v === 'list' ? <LayoutList size={14} /> : <LayoutGrid size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <ArchiveTagBar
              allTags={allTags}
              selectedTags={selectedTags}
              onToggleTag={tag => setSelectedTags(prev =>
                prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
              )}
              renamingTag={tagEditor.renamingTag}
              renameTagValue={tagEditor.renameTagValue}
              setRenameTagValue={tagEditor.setRenameTagValue}
              onStartRename={tagEditor.startRenameTag}
              onRenameSubmit={tagEditor.handleRenameTag}
              onRenameCancel={() => tagEditor.setRenamingTag(null)}
              onDeleteTag={tagEditor.setTagDeleteConfirm}
              onResetTags={() => setSelectedTags([])}
              showControls={!!user}
              t={t}
            />

            <ArchiveLabelBar
              labels={profileLabels}
              selectedLabels={selectedLabels}
              onToggleLabel={toggleLabel}
              addingLabel={labelEditor.addingLabel}
              setAddingLabel={labelEditor.setAddingLabel}
              newLabelName={labelEditor.newLabelName}
              setNewLabelName={labelEditor.setNewLabelName}
              newLabelColor={labelEditor.newLabelColor}
              setNewLabelColor={labelEditor.setNewLabelColor}
              onAddLabel={labelEditor.handleAddLabel}
              editingLabelId={labelEditor.editingLabelId}
              setEditingLabelId={labelEditor.setEditingLabelId}
              editLabelName={labelEditor.editLabelName}
              setEditLabelName={labelEditor.setEditLabelName}
              editLabelColor={labelEditor.editLabelColor}
              setEditLabelColor={labelEditor.setEditLabelColor}
              onUpdateLabel={labelEditor.handleUpdateLabel}
              onDeleteLabel={labelEditor.setLabelDeleteConfirm}
              showControls={!!user}
              t={t}
            />

            {cloudLoadFailed && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-between mt-4">
                <span>{t('archive_cloud_load_error')}</span>
                <button
                  onClick={() => fetchSessions()}
                  className="underline text-red-400/70 hover:text-red-400"
                >
                  {t('retry')}
                </button>
              </div>
            )}

            <div className="mt-4">
              <ArchiveNoteList
                viewMode={viewMode}
                loading={loading}
                error={error}
                filteredSessions={filteredSessions}
                groupedSessions={groupedSessions}
                sortedDates={sortedDates}
                dateLocale={dateLocale}
                labels={profileLabels}
                userId={userId}
                searchQuery={searchQuery}
                onOpen={s => setPreviewSession(s)}
                onDelete={s => setDeleteConfirm(s)}
                onTagsChange={handleTagsChange}
                onTitleChange={handleTitleChange}
                onDateChange={handleDateChange}
                onLabelChange={handleLabelChange}
                onStorageChange={() => fetchSessions()}
                t={t}
                language={language}
                entriesLabel={entriesLabel}
              />
            </div>
          </div>

          <ArchiveSidebar
            filteredByFilters={filteredByFilters}
            streakDays={filteredStreakDays}
            statsTitle={statsTitle}
            onReset={hasActiveFilter ? resetStatsFilter : undefined}
            sessions={data.sessions}
            sessionsByDate={sessionsByDate}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onSelectMonth={setSelectedMonth}
            wordCloud={wordCloud}
            maxCount={maxCount}
            onWordClick={setSearchQuery}
          />

          {previewSession && (
            <div
              className="fixed inset-0 z-40 bg-black/20"
              onClick={() => setPreviewSession(null)}
            />
          )}

          <AnimatePresence>
            {previewSession && (
              <DocumentPreview
                session={previewSession}
                onClose={() => setPreviewSession(null)}
                onContinue={(s) => navigate('/', { state: { sessionToContinue: s } })}
                onTagsChange={handleTagsChange}
                onLabelChange={handleLabelChange}
                labels={profileLabels}
              />
            )}
          </AnimatePresence>

          <ConfirmModal
            isOpen={!!tagEditor.tagDeleteConfirm}
            title={t('archive_tags_label')}
            message={t('archive_tag_delete_confirm', { tag: tagEditor.tagDeleteConfirm ?? '' })}
            confirmLabel={t('storage_delete_confirm')}
            cancelLabel={t('common_cancel')}
            onConfirm={tagEditor.handleDeleteTag}
            onCancel={() => tagEditor.setTagDeleteConfirm(null)}
          />

          <ConfirmModal
            isOpen={!!labelEditor.labelDeleteConfirm}
            title={t('archive_labels')}
            message={t('archive_label_delete_confirm')}
            confirmLabel={t('storage_delete_confirm')}
            cancelLabel={t('common_cancel')}
            onConfirm={labelEditor.confirmDeleteLabel}
            onCancel={() => labelEditor.setLabelDeleteConfirm(null)}
          />

          <ConfirmModal
            isOpen={!!deleteConfirm}
            title={t('archive_delete_confirm')}
            message={`«${deleteConfirm?.title || t('session_untitled')}»`}
            confirmLabel={t('storage_delete_confirm')}
            cancelLabel={t('common_cancel')}
            onConfirm={async () => {
              await handleDeleteSession(deleteConfirm!);
              setDeleteConfirm(null);
            }}
            onCancel={() => setDeleteConfirm(null)}
          />
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
