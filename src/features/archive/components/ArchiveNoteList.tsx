import { memo, type ComponentPropsWithoutRef, useState, useEffect } from 'react';
import { useReducedMotion } from 'motion/react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { format, Locale } from 'date-fns';
import { BookOpen } from 'lucide-react';
import { GridNoteCard } from './GridNoteCard';
import { EmptyState } from '../../../shared/components/EmptyState';
import { NoteRow } from './NoteRow';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { AISummaryService } from '../../../core/services/AISummaryService';
import { NoteAnalysisService } from '../../ai/services/NoteAnalysisService';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { reportError } from '../../../shared/errors/reportError';
import { getCurrentUser } from '../../../core/auth';

const GridItem = memo<ComponentPropsWithoutRef<'div'>>(
  ({ className, children, style, ...props }) => (
    <div className={cn('archive-grid-item', className)} style={style} {...props}>
      {children}
    </div>
  )
);
GridItem.displayName = 'GridItem';

interface ArchiveNoteListProps {
  viewMode: 'list' | 'grid';
  loading: boolean;
  error: string | null;
  filteredSessions: ArchiveSession[];
  groupedSessions: Record<string, ArchiveSession[]>;
  sortedDates: string[];
  dateLocale: Locale;
  labels: Label[];
  userId: string;
  searchQuery: string;
  isGroupedByDate: boolean;
  onOpen: (s: ArchiveSession) => void;
  onDelete: (s: ArchiveSession) => void;
  onTagsChange: (s: ArchiveSession, tags: string[]) => void;
  onTitleChange: (s: ArchiveSession, title: string) => void;
  onDateChange: (s: ArchiveSession, date: Date) => void;
  onLabelChange: (s: ArchiveSession, labelId: string | undefined) => void;
  onStorageChange: () => void;
  t: (key: string, args?: Record<string, string | number>) => string;
  language: string;
  entriesLabel: (n: number) => string;
  allTags?: string[];
  onClearSearch?: () => void;
}

const gridListClassName = 'grid gap-4 mt-3 archive-grid-list';
const gridItemClassName = '';
const gridComponents = { Item: GridItem };

export function ArchiveNoteList({
  viewMode, loading, error, filteredSessions,
  groupedSessions, sortedDates, dateLocale,
  labels, userId, searchQuery, isGroupedByDate,
  onOpen, onDelete, onTagsChange, onTitleChange,
  onDateChange, onLabelChange, onStorageChange,
  t, language, entriesLabel: _entriesLabel, allTags, onClearSearch,
}: ArchiveNoteListProps) {
  const reducedMotion = useReducedMotion();
  const { tp } = useLanguage();
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [aiProcessedMap, setAiProcessedMap] = useState<Record<string, boolean>>({});
  const [aiLoadingMap, setAiLoadingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void AISummaryService.hasAll().then(setAiProcessedMap);
  }, []);

  // Заметка разбирается только по этому нажатию — фонового разбора нет.
  // Второе нажатие на разобранной заметке удаляет сводку и вектор, в том числе
  // облачные копии: иначе «удалить разбор» ничего бы не удаляло.
  const handleAIClick = async (session: ArchiveSession) => {
    if (!session.id || aiLoadingMap[session.id]) return;

    if (aiProcessedMap[session.id]) {
      const ok = await confirmDialog({
        title: t('ai_note_clear_confirm'),
        message: t('ai_note_clear_confirm_hint'),
      });
      if (!ok) return;
      setAiLoadingMap(m => ({ ...m, [session.id]: true }));
      try {
        await NoteAnalysisService.clear(session.id);
        setAiProcessedMap(m => ({ ...m, [session.id]: false }));
        showToast(t('ai_note_cleared'), 'success');
      } catch (e) {
        reportError(e, { action: 'archive_clear_analysis', documentId: session.id });
        showToast(t('error_generic_action'), 'error');
      } finally {
        setAiLoadingMap(m => ({ ...m, [session.id]: false }));
      }
      return;
    }

    setAiLoadingMap(m => ({ ...m, [session.id]: true }));
    try {
      const res = await NoteAnalysisService.analyze(session.id);
      if (res.ok) {
        setAiProcessedMap(m => ({ ...m, [session.id]: true }));
        showToast(t('ai_note_analyzed'), 'success');
      } else {
        const errMap: Record<string, string> = {
          NO_CONTENT: t('ai_note_too_short'),
          TOO_SHORT: t('ai_note_too_short'),
          AUTH_REQUIRED: getCurrentUser() ? t('ai_error_session') : t('ai_error_auth'),
          DAILY_LIMIT: t('ai_error_rate_limit'),
          RATE_LIMIT: t('ai_error_rate_limit'),
          TOO_LONG: t('ai_error_too_long'),
          SERVER_ERROR: t('ai_error_server'),
          NETWORK: t('ai_error_offline'),
        };
        showToast(errMap[res.error] ?? t('ai_error_server'), 'error');
      }
    } catch (e) {
      reportError(e, { action: 'archive_analyze_note', documentId: session.id });
      showToast(t('ai_error_server'), 'error');
    } finally {
      setAiLoadingMap(m => ({ ...m, [session.id]: false }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-1 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-4 px-4 py-3 rounded-xl",
              !reducedMotion && "animate-pulse"
            )}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-text-main/8 rounded w-1/3" />
              <div className="h-2.5 bg-text-main/5 rounded w-2/3" />
            </div>
            <div className="h-2.5 bg-text-main/5 rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center rounded-3xl border bg-accent-danger/10 border-accent-danger/30">
        <p className="text-accent-danger">{error}</p>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    if (searchQuery?.trim()) {
      return (
        <div className="py-16 text-center space-y-3">
          <p className="text-[16px] text-text-main/60 font-medium">
            {t('archive_empty_filtered')}
          </p>
          <p className="text-[13px] text-text-main/60">
            {t('archive_search_no_results', { query: searchQuery })}
          </p>
          <Button
            onClick={() => onClearSearch?.()}
            className="text-sm text-brand-soft hover:underline"
          >
            {t('archive_search_clear')}
          </Button>
        </div>
      );
    }
    return (
      <EmptyState
        icon={BookOpen}
        title={t('archive_empty_title')}
        description={t('archive_empty_subtitle')}
      />
    );
  }

  if (!isGroupedByDate) {
    if (viewMode === 'grid') {
      return (
        <VirtuosoGrid
          data={filteredSessions}
          className="custom-scrollbar h-full"
          components={gridComponents}
          listClassName={gridListClassName}
          itemClassName={gridItemClassName}
          itemContent={(index, session) => (
            <GridNoteCard
              session={session}
              onClick={() => onOpen(session)}
              searchQuery={searchQuery}
              labels={labels}
              allTags={allTags}
              onTagsChange={onTagsChange}
              onLabelChange={onLabelChange}
              aiProcessed={!!aiProcessedMap[session.id]}
              aiLoading={!!aiLoadingMap[session.id]}
              onAIClick={() => void handleAIClick(session)}
            />
          )}
        />
      );
    }

    return (
      <Virtuoso
        data={filteredSessions}
        className="h-full"
        itemContent={(index, session) => (
          <NoteRow
            session={session}
            onOpen={() => onOpen(session)}
            t={t}
            language={language}
            labels={labels}
            onDelete={(s) => onDelete(s)}
            onTagsChange={onTagsChange}
            onStorageChange={onStorageChange}
            onTitleChange={onTitleChange}
            onDateChange={onDateChange}
            onLabelChange={onLabelChange}
            userId={userId}
            allTags={allTags}
            searchQuery={searchQuery}
            aiProcessed={!!aiProcessedMap[session.id]}
            aiLoading={!!aiLoadingMap[session.id]}
            onAIClick={() => void handleAIClick(session)}
          />
        )}
      />
    );
  }

  if (viewMode === 'grid') {
    // Grouped grid is rendered without Virtuoso: nesting variable-height card
    // grids inside a vertical virtualizer desynced on sort/filter/view changes,
    // leaving phantom empty groups and missing cards. A plain map is robust.
    return (
      <div className="custom-scrollbar h-full overflow-y-auto">
        {sortedDates.map(dateKey => {
          const sessions = groupedSessions[dateKey] ?? [];
          if (sessions.length === 0) return null;
          return (
            <div key={dateKey} className="mb-2">
              <div className="flex items-center gap-3 py-4 pr-1">
                <span className="font-mono text-label-sm text-text-main/60 uppercase tracking-widest whitespace-nowrap">
                  {format(new Date(dateKey), 'd MMM', { locale: dateLocale })}
                </span>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[var(--border-subtle)]" />
                  <span className="font-mono text-label-sm text-[var(--brand-soft)] opacity-50">
                    {tp('archive_note_count', sessions.length)}
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[var(--border-subtle)]" />
                </div>
                <span className="font-mono text-label-sm text-text-main/60 whitespace-nowrap">
                  {sessions
                    .reduce((sum, s) => sum + (s.wordCount || 0), 0)
                    .toLocaleString()} {t('home_words_short')}
                </span>
              </div>
              <div className="grid gap-4 archive-grid-list">
                {sessions.map(session => (
                  <div key={session.id} className="archive-grid-item">
                    <GridNoteCard
                      session={session}
                      onClick={() => onOpen(session)}
                      searchQuery={searchQuery}
                      labels={labels}
                      allTags={allTags}
                      onTagsChange={onTagsChange}
                      onLabelChange={onLabelChange}
                      aiProcessed={!!aiProcessedMap[session.id]}
                      aiLoading={!!aiLoadingMap[session.id]}
                      onAIClick={() => void handleAIClick(session)}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Grouped list rendered without Virtuoso. GroupedVirtuoso's itemContent index
  // is GLOBAL (across all groups), but the code indexed the per-group array with
  // it — so groups after the first showed wrong/empty rows (worse on re-sorts).
  // The grid grouped view was de-virtualized for the same reason; do the same
  // here. A plain map is robust at this scale (~tens–hundreds of notes).
  return (
    <div className="custom-scrollbar h-full overflow-y-auto">
      {sortedDates.map(dateKey => {
        const sessions = groupedSessions[dateKey] ?? [];
        if (sessions.length === 0) return null;
        return (
          <div key={dateKey}>
            <div className="flex items-center gap-3 py-5 pr-1">
              <span className="font-mono text-label-sm text-text-main/60 uppercase tracking-widest whitespace-nowrap">
                {format(new Date(dateKey), 'd MMM', { locale: dateLocale })}
              </span>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[var(--border-subtle)]" />
                <span className="font-mono text-label-sm text-[var(--brand-soft)] opacity-50">
                  {tp('archive_note_count', sessions.length)}
                </span>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[var(--border-subtle)]" />
              </div>
              <span className="font-mono text-label-sm text-text-main/60 whitespace-nowrap">
                {sessions
                  .reduce((sum: number, s: ArchiveSession) => sum + (s.wordCount || 0), 0)
                  .toLocaleString()} {t('home_words_short')}
              </span>
            </div>
            {sessions.map(session => (
              <NoteRow
                key={session.id}
                session={session}
                onOpen={() => onOpen(session)}
                t={t}
                language={language}
                labels={labels}
                onDelete={(s) => onDelete(s)}
                onTagsChange={onTagsChange}
                onStorageChange={onStorageChange}
                onTitleChange={onTitleChange}
                onDateChange={onDateChange}
                onLabelChange={onLabelChange}
                userId={userId}
                allTags={allTags}
                searchQuery={searchQuery}
                aiProcessed={!!aiProcessedMap[session.id]}
                aiLoading={!!aiLoadingMap[session.id]}
                onAIClick={() => void handleAIClick(session)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
