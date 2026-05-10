import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { Search, LayoutGrid, LayoutList, BookOpen } from 'lucide-react';
import { UserProfile } from '../../../types';
import { GridNoteCard } from '../components/GridNoteCard';
import { cn, calculateStreak } from '../../../core/utils/utils';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { useLanguage } from '../../../core/i18n';
import { useNavigate } from 'react-router-dom';
import { useUserId } from '../../../shared/hooks/useUserId';
import { EmptyState } from '../../../shared/components/EmptyState';
import { DocumentPreview } from '../components/DocumentPreview';
import { NoteRow } from '../components/NoteRow';
import { ArchiveSidebar } from '../components/ArchiveSidebar';
import { useArchiveData } from '../hooks/useArchiveData';
import { useProfileLabels } from '../../profile/hooks/useProfileLabels';

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

  const { labels: profileLabels, addLabel, removeLabel } = useProfileLabels(userId, profile?.labels ?? []);

  const data = useArchiveData(user, userId, t, language, profileLabels);
  const {
    loading, error, cloudLoadFailed, fetchSessions,
    handleDeleteSession, handleTagsChange, handleTitleChange, handleDateChange, handleLabelChange,
    previewSession, setPreviewSession,
    deleteConfirm, setDeleteConfirm,
    allTags, filteredByFilters, filteredSessions,
    searchQuery, setSearchQuery,
    selectedDate, setSelectedDate, selectedMonth: _selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordCloud, maxCount,
    groupedSessions, sortedDates, dateLocale, entriesLabel,
  } = data;

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

            {allTags.length > 0 && (
              <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span className="font-mono text-[10px] text-text-main/25 uppercase tracking-widest mr-1">
                  {t('archive_tags_label')}
                </span>
                {allTags.map(tag => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => setSelectedTags(prev =>
                        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                      )}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-[11px] font-mono transition-all border",
                        active
                          ? "bg-text-main/10 border-text-main/30 text-text-main"
                          : "bg-transparent border-border-subtle text-text-main/40 hover:text-text-main/60"
                      )}
                    >
                      #{tag}
                    </button>
                  );
                })}
                {selectedTags.length > 0 && (
                  <button
                    onClick={() => setSelectedTags([])}
                    className="px-2.5 py-1 rounded-full text-[11px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-all"
                  >
                    {t('archive_tags_reset')} &#10005;
                  </button>
                )}
              </div>
            )}

            {cloudLoadFailed && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-between mt-4">
                <span>{t('archive_cloud_load_error')}</span>
                <button
                  onClick={() => fetchSessions(true)}
                  className="underline text-red-400/70 hover:text-red-400"
                >
                  {t('retry')}
                </button>
              </div>
            )}

            <div className="mt-4 space-y-1">
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-6 py-16">
                  <motion.div
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    style={{ filter: "drop-shadow(0 0 24px color-mix(in srgb, var(--brand-soft) 40%, transparent))" }}
                  >
                    <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
                  </motion.div>
                  <p className="text-sm text-text-main/35 tracking-widest uppercase font-sans">
                    {t('archive_loading')}
                  </p>
                </div>
              ) : error ? (
                <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
                  <p className="text-red-400">{error}</p>
                </div>
              ) : filteredSessions.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title={t('archive_empty_title')}
                  description={t('archive_empty_subtitle')}
                />
              ) : (
                sortedDates.map(dateKey => (
                  <div key={dateKey}>
                    {viewMode !== 'grid' && (
                    <div className="flex items-center gap-4 py-4">
                      <h4 className="text-[15px] font-medium text-text-main whitespace-nowrap">
                        {format(new Date(dateKey), 'd MMMM yyyy', { locale: dateLocale })}
                      </h4>
                      <div className="flex-1 h-px bg-border-subtle" />
                      <span className="font-mono text-[11px] text-text-main/35 whitespace-nowrap">
                        {groupedSessions[dateKey].length} {entriesLabel(groupedSessions[dateKey].length)} · {' '}
                        {groupedSessions[dateKey]
                          .reduce((sum, s) => sum + (s.wordCount || 0), 0)
                          .toLocaleString()} {t('home_words_short')}
                      </span>
                    </div>
                    )}
                    {viewMode === 'list' ? (
                      <div className="flex flex-col">
                        {groupedSessions[dateKey].map(session => (
                          <NoteRow
                            key={session.id}
                            session={session}
                            onOpen={() => setPreviewSession(session)}
                            t={t}
                            language={language}
                            labels={profileLabels}
                            onDelete={(s) => setDeleteConfirm(s)}
                            onTagsChange={handleTagsChange}
                            onStorageChange={() => fetchSessions()}
                            onTitleChange={handleTitleChange}
                            onDateChange={handleDateChange}
                            onLabelChange={handleLabelChange}
                            userId={userId}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
                        {groupedSessions[dateKey].map(session => (
                          <GridNoteCard
                            key={session.id}
                            session={session}
                            onClick={() => setPreviewSession(session)}
                            searchQuery={searchQuery}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
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
            labels={profileLabels}
            onAddLabel={addLabel}
            onRemoveLabel={removeLabel}
            sessionsForLabels={data.sessions}
            selectedLabels={selectedLabels}
            onToggleLabel={toggleLabel}
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
              />
            )}
          </AnimatePresence>

          {deleteConfirm && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-surface-card border border-border-subtle rounded-2xl p-6 w-80 shadow-lg">
                <h3 className="text-base font-medium text-text-main mb-2">{t('archive_delete_confirm')}</h3>
                <p className="text-sm text-text-main/40 mb-5">
                  «{deleteConfirm.title || t('session_untitled')}»
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await handleDeleteSession(deleteConfirm);
                      setDeleteConfirm(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20"
                  >
                    {t('storage_delete_confirm')}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 py-2.5 rounded-xl border border-border-subtle text-text-main/40 text-sm hover:text-text-main"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
