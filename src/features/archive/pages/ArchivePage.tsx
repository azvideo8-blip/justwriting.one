import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { Search, LayoutGrid, LayoutList, BookOpen, Pencil, X } from 'lucide-react';
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
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { DocumentService } from '../../writing/services/DocumentService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';

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
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_PRESET_COLORS[0]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('');
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameTagValue, setRenameTagValue] = useState('');
  const [tagDeleteConfirm, setTagDeleteConfirm] = useState<string | null>(null);
  const [labelDeleteConfirm, setLabelDeleteConfirm] = useState<string | null>(null);

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
                  if (renamingTag === tag) {
                    return (
                      <div key={tag} className="flex items-center gap-1 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
                        <span className="text-[11px] font-mono text-text-main/40">#</span>
                        <input
                          value={renameTagValue}
                          onChange={e => setRenameTagValue(e.target.value)}
                          autoFocus
                          className="w-20 bg-transparent text-[12px] text-text-main outline-none"
                          onKeyDown={async e => {
                            if (e.key === 'Enter') {
                              const trimmed = renameTagValue.trim();
                              if (trimmed && trimmed !== tag) {
                                await DocumentService.renameTagInAllDocs(userId, tag, trimmed).catch(() => {});
                                await LocalDocumentService.renameTagInAllDocs(userId, tag, trimmed).catch(() => {});
                                fetchSessions();
                              }
                              setRenamingTag(null);
                            }
                            if (e.key === 'Escape') setRenamingTag(null);
                          }}
                        />
                        <button onClick={() => setRenamingTag(null)} className="text-[10px] text-text-main/30 hover:text-text-main/50">✕</button>
                      </div>
                    );
                  }
                  return (
                    <div key={tag} className="group/tag relative flex items-center">
                      <button
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
                      {user && (
                        <span className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/tag:opacity-100 transition-opacity flex gap-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); setRenamingTag(tag); setRenameTagValue(tag); }}
                            className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main/60"
                          >
                            <Pencil size={7} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setTagDeleteConfirm(tag); }}
                            className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-red-400"
                          >
                            <X size={7} />
                          </button>
                        </span>
                      )}
                    </div>
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

            {(profileLabels.length > 0 || user) && (
              <div className="flex items-center gap-2 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span className="font-mono text-[10px] text-text-main/25 uppercase tracking-widest mr-1">
                  {t('archive_labels')}
                </span>
                {profileLabels.map(label => {
                  const active = selectedLabels.includes(label.id);
                  if (editingLabelId === label.id) {
                    return (
                      <div key={label.id} className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
                        <input
                          value={editLabelName}
                          onChange={e => setEditLabelName(e.target.value)}
                          autoFocus
                          className="w-24 bg-transparent text-[12px] text-text-main outline-none"
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const trimmed = editLabelName.trim();
                              if (trimmed) updateLabel(label.id, { name: trimmed, color: editLabelColor });
                              setEditingLabelId(null);
                            }
                            if (e.key === 'Escape') setEditingLabelId(null);
                          }}
                        />
                        <div className="flex gap-1">
                          {LABEL_PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              style={{ background: c }}
                              className={cn("w-3.5 h-3.5 rounded-full transition-all", editLabelColor === c && "ring-2 ring-offset-1 ring-offset-surface-card ring-white/40")}
                              onClick={() => setEditLabelColor(c)}
                            />
                          ))}
                        </div>
                        <button onClick={() => { const trimmed = editLabelName.trim(); if (trimmed) updateLabel(label.id, { name: trimmed, color: editLabelColor }); setEditingLabelId(null); }}
                          disabled={!editLabelName.trim()}
                          className="text-[10px] font-medium text-text-main/60 hover:text-text-main disabled:opacity-30">
                          {t('common_save')}
                        </button>
                        <button onClick={() => setEditingLabelId(null)} className="text-[10px] text-text-main/30 hover:text-text-main/50">✕</button>
                      </div>
                    );
                  }
                  return (
                    <div key={label.id} className="group/label relative flex items-center">
                      <button
                        onClick={() => toggleLabel(label.id)}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono transition-all border",
                          active ? "border-transparent text-white" : "bg-transparent border-border-subtle text-text-main/50 hover:text-text-main/70"
                        )}
                        style={active ? { background: label.color, borderColor: label.color } : {}}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: label.color }} />
                        {label.name}
                      </button>
                      {user && (
                        <span className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/label:opacity-100 transition-opacity flex gap-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); setEditingLabelId(label.id); setEditLabelName(label.name); setEditLabelColor(label.color); }}
                            className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-text-main/60"
                          >
                            <Pencil size={7} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setLabelDeleteConfirm(label.id); }}
                            className="w-4 h-4 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center text-text-main/40 hover:text-red-400"
                          >
                            <X size={7} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {selectedLabels.length > 0 && (
                  <button
                    onClick={() => selectedLabels.forEach(id => toggleLabel(id))}
                    className="px-2.5 py-1 rounded-full text-[11px] font-mono border border-dashed border-border-subtle text-text-main/30 hover:text-text-main/50 transition-all"
                  >
                    {t('archive_tags_reset')} &#10005;
                  </button>
                )}
                {user && !addingLabel && !editingLabelId && (
                  <button
                    onClick={() => setAddingLabel(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-mono text-text-main/30 hover:text-text-main/50 border border-dashed border-border-subtle transition-all"
                  >
                    + {t('archive_add_label')}
                  </button>
                )}
                {user && addingLabel && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-xl border border-border-subtle bg-surface-card">
                    <input
                      value={newLabelName}
                      onChange={e => setNewLabelName(e.target.value)}
                      placeholder={t('archive_label_name_placeholder')}
                      autoFocus
                      className="w-28 bg-transparent text-[12px] text-text-main outline-none placeholder:text-text-main/25"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const trimmed = newLabelName.trim();
                          if (trimmed) { addLabel({ name: trimmed, color: newLabelColor }); setNewLabelName(''); setAddingLabel(false); setNewLabelColor(LABEL_PRESET_COLORS[0]); }
                        }
                        if (e.key === 'Escape') { setAddingLabel(false); setNewLabelName(''); }
                      }}
                    />
                    <div className="flex gap-1">
                      {LABEL_PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          style={{ background: c }}
                          className={cn("w-4 h-4 rounded-full transition-all", newLabelColor === c && "ring-2 ring-offset-1 ring-offset-surface-card ring-white/40")}
                          onClick={() => setNewLabelColor(c)}
                        />
                      ))}
                      <div className="relative">
                        <input type="color" defaultValue={newLabelColor} onChange={e => setNewLabelColor(e.target.value)} className="sr-only" id="new-label-color" />
                        <label htmlFor="new-label-color"
                          className={cn("w-4 h-4 rounded-full border border-dashed border-border-subtle flex items-center justify-center cursor-pointer text-[9px] text-text-main/40 hover:border-text-main/40",
                            !LABEL_PRESET_COLORS.includes(newLabelColor) && "ring-2 ring-offset-1 ring-offset-surface-card"
                          )}
                          style={!LABEL_PRESET_COLORS.includes(newLabelColor) ? { background: newLabelColor } : {}}
                        >
                          {LABEL_PRESET_COLORS.includes(newLabelColor) && '+'}
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={() => { const trimmed = newLabelName.trim(); if (trimmed) { addLabel({ name: trimmed, color: newLabelColor }); setNewLabelName(''); setAddingLabel(false); setNewLabelColor(LABEL_PRESET_COLORS[0]); } }}
                      disabled={!newLabelName.trim()}
                      className="text-[11px] font-medium text-text-main/60 hover:text-text-main disabled:opacity-30 transition-colors"
                    >
                      {t('common_save')}
                    </button>
                    <button onClick={() => { setAddingLabel(false); setNewLabelName(''); }}
                      className="text-[11px] text-text-main/30 hover:text-text-main/50 transition-colors">
                      ✕
                    </button>
                  </div>
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

          {tagDeleteConfirm && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-surface-card border border-border-subtle rounded-2xl p-6 w-80 shadow-lg">
                <h3 className="text-base font-medium text-text-main mb-2">{t('archive_tags_label')}</h3>
                <p className="text-sm text-text-main/40 mb-5">
                  {t('archive_tag_delete_confirm', { tag: tagDeleteConfirm })}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await DocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm).catch(() => {});
                      await LocalDocumentService.removeTagFromAllDocs(userId, tagDeleteConfirm).catch(() => {});
                      fetchSessions();
                      setTagDeleteConfirm(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20"
                  >
                    {t('storage_delete_confirm')}
                  </button>
                  <button
                    onClick={() => setTagDeleteConfirm(null)}
                    className="flex-1 py-2.5 rounded-xl border border-border-subtle text-text-main/40 text-sm hover:text-text-main"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {labelDeleteConfirm && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-surface-card border border-border-subtle rounded-2xl p-6 w-80 shadow-lg">
                <h3 className="text-base font-medium text-text-main mb-2">{t('archive_labels')}</h3>
                <p className="text-sm text-text-main/40 mb-5">
                  {t('archive_label_delete_confirm')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { removeLabel(labelDeleteConfirm); setLabelDeleteConfirm(null); }}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20"
                  >
                    {t('storage_delete_confirm')}
                  </button>
                  <button
                    onClick={() => setLabelDeleteConfirm(null)}
                    className="flex-1 py-2.5 rounded-xl border border-border-subtle text-text-main/40 text-sm hover:text-text-main"
                  >
                    {t('common_cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

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
