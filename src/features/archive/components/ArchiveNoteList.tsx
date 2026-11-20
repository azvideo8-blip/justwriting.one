import { memo, type ComponentPropsWithoutRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { format, Locale } from 'date-fns';
import { BookOpen } from 'lucide-react';
import { GridNoteCard } from './GridNoteCard';
import { EmptyState } from '../../../shared/components/EmptyState';
import { LoadStateView, LoadNotice } from '../../../shared/components/LoadStateView';
import type { LoadState } from '../../../shared/loadState';
import { NoteRow } from './NoteRow';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { toggleAIExclusion } from '../services/archiveCrud';
import { runMutation } from '../../../shared/mutationResult';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { reportError } from '../../../shared/errors/reportError';
import { getCurrentUser } from '../../../core/auth';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { aiErrorToText } from '../../../shared/ai/aiErrorUtils';

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
  /** Заметки после фильтров и поиска; плашку «облако не ответило» показывает страница. */
  state: LoadState<ArchiveSession[]>;
  groupedSessions: Record<string, ArchiveSession[]>;
  sortedDates: string[];
  dateLocale: Locale;
  labels: Label[];
  userId: string;
  searchQuery: string;
  /** Метки/теги/дата отобраны: пустой срез — «ничего не найдено», а не «пока нет записей». */
  hasActiveFilter?: boolean;
  isGroupedByDate: boolean;
  onOpen: (session: ArchiveSession) => void;
  onDelete: (session: ArchiveSession) => void;
  onTagsChange: (session: ArchiveSession, tags: string[]) => void;
  onTitleChange: (session: ArchiveSession, title: string) => void;
  onDateChange: (session: ArchiveSession, date: Date) => void;
  onLabelChange: (session: ArchiveSession, labelId: string | undefined) => void;
  onStorageChange: () => void;
  t: (key: string, args?: Record<string, string | number>) => string;
  language: string;
  allTags?: string[];
  onClearSearch?: () => void;
  onAnalyzeNote?: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  onClearAnalysis?: (sessionId: string) => Promise<{ cloudSynced: boolean }>;
  loadAiProcessedMap?: () => Promise<Record<string, boolean>>;
}

const gridListClassName = 'grid gap-4 mt-3 archive-grid-list';
// MP-2: на телефоне три колонки оставляют карточке ~110 px — текст не читается.
// Класс общей сетки сохранён (на него смотрят спеки MR-8), колонки считает
// модификатор, который ставится только мобильной ветке.
const gridListClassNameMobile = 'grid gap-3 mt-3 archive-grid-list archive-grid-two-col';
const gridItemClassName = '';
const gridComponents = { Item: GridItem };

// AUDIT-L9: предел для негруппированного полного рендера.
const GROUPED_VIEW_LIMIT = 1000;

const SKELETON_KEYS = ['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5'] as const;

export function ArchiveNoteList({
  viewMode, state,
  groupedSessions, sortedDates, dateLocale,
  labels, userId, searchQuery, hasActiveFilter = false, isGroupedByDate,
  onOpen, onDelete, onTagsChange, onTitleChange,
  onDateChange, onLabelChange, onStorageChange,
  t, language, allTags, onClearSearch,
  onAnalyzeNote, onClearAnalysis, loadAiProcessedMap,
}: ArchiveNoteListProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { tp } = useLanguage();
  const { layoutMode } = useLayoutMode();
  const isMobileView = layoutMode === 'mobile';
  const gridListClass = isMobileView ? gridListClassNameMobile : gridListClassName;
  // MC-7: на телефоне заголовок дня — одно слово-дата, без счётчиков и без
  // линейки между ними: прокрутка списка читается как текст, а не как отчёт.
  // U-14 (решение владельца 2026-10-18 по Q-2): заголовок дня на телефоне — тот
  // же, что на десктопе: моноширинный капс, счётчики «N заметок · M слов»,
  // видимые разделительные линии. Разница только в размерах: на телефоне подпись
  // не мельче 12 px (U-9) и стро компактнее. MC-7 раньше выводил счётчики из
  // заголовка — решение от 2026-10-18 вернуло их, храповик переписан.
  const dayHeader = (dateKey: string, daySessions: ArchiveSession[], padClass: string) => {
    const label = isMobileView ? 'text-[12px]' : 'text-label-sm';
    const words = daySessions.reduce((sum, s) => sum + (s.wordCount || 0), 0);
    return (
      <div data-testid="archive-day-header" className={cn('flex items-center gap-3 pr-1', padClass)}>
        <span className={cn('font-mono uppercase tracking-widest whitespace-nowrap text-text-main/60', label)}>
          {format(new Date(dateKey), 'd MMM', { locale: dateLocale })}
        </span>
        <div className="flex flex-1 items-center gap-2">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[var(--color-border-subtle)]" />
          <span className={cn('text-brand-soft', label)}>{tp('archive_note_count', daySessions.length)}</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[var(--color-border-subtle)]" />
        </div>
        <span className={cn('font-mono whitespace-nowrap text-text-main/60', label)}>
          {tp('archive_word_count', words)}
        </span>
      </div>
    );
  };
  const { showToast } = useToast();
  const { confirm: confirmDialog } = useConfirmDialog();
  const [aiProcessedMap, setAiProcessedMap] = useState<Record<string, boolean>>({});
  const [aiBusyMap, setAiBusyMap] = useState<Record<string, boolean>>({});
  const [aiExclusionBusyMap, setAiExclusionBusyMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (loadAiProcessedMap) {
      void loadAiProcessedMap().then(setAiProcessedMap);
    }
  }, [loadAiProcessedMap]);

  const handleAIExclusionClick = async (session: ArchiveSession) => {
    if (!session.id || aiExclusionBusyMap[session.id]) return;
    const newExcluded = !session.excludedFromAI;
    setAiExclusionBusyMap(m => ({ ...m, [session.id]: true }));
    // Дейлик 19.11 Н-3: итог называет общий помощник — отказ облака не «Скрыто от ИИ».
    const done = await runMutation({ showToast, t }, 'archive_toggle_ai_exclusion',
      () => toggleAIExclusion(session, newExcluded, getCurrentUser(), userId),
      { successText: t(newExcluded ? 'ai_note_excluded' : 'ai_note_include'), context: { documentId: session.id } });
    if (done) {
      if (newExcluded) setAiProcessedMap(m => ({ ...m, [session.id]: false }));
      onStorageChange();
    }
    setAiExclusionBusyMap(m => ({ ...m, [session.id]: false }));
  };

  // Заметка разбирается только по этому нажатию — фонового разбора нет.
  // Второе нажатие на разобранной заметке удаляет сводку и вектор, в том числе
  // облачные копии: иначе «удалить разбор» ничего бы не удаляло.
  const handleAIClick = async (session: ArchiveSession) => {
    if (!session.id || aiBusyMap[session.id] || session.excludedFromAI) return;

    if (aiProcessedMap[session.id]) {
      const ok = await confirmDialog({
        title: t('ai_note_clear_confirm'),
        message: t('ai_note_clear_confirm_hint'),
      });
      if (!ok) return;
      setAiBusyMap(m => ({ ...m, [session.id]: true }));
      try {
        const res = onClearAnalysis ? await onClearAnalysis(session.id) : { cloudSynced: true };
        setAiProcessedMap(m => ({ ...m, [session.id]: false }));
        if (res.cloudSynced) showToast(t('ai_note_cleared'), 'success');
        else showToast(t('ai_note_cleared_local_only'), 'warning');
      } catch (e) {
        reportError(e, { action: 'archive_clear_analysis', documentId: session.id });
        showToast(t('error_generic_action'), 'error');
      } finally {
        setAiBusyMap(m => ({ ...m, [session.id]: false }));
      }
      return;
    }

    if (!onAnalyzeNote) return;

    setAiBusyMap(m => ({ ...m, [session.id]: true }));
    try {
      const res = await onAnalyzeNote(session.id);
      if (res.ok) {
        setAiProcessedMap(m => ({ ...m, [session.id]: true }));
        showToast(t('ai_note_analyzed'), 'success');
      } else {
        const isConsentRequired = res.error === 'AI_CONSENT_REQUIRED';
        showToast(
          aiErrorToText(res.error, { t, isLoggedIn: !!getCurrentUser() }),
          'error',
          isConsentRequired
            ? { label: t('settings_open'), onClick: () => { void navigate('/settings#security'); } }
            : undefined,
        );
      }
    } catch (e) {
      reportError(e, { action: 'archive_analyze_note', documentId: session.id });
      showToast(t('ai_error_server'), 'error');
    } finally {
      setAiBusyMap(m => ({ ...m, [session.id]: false }));
    }
  };

  const skeleton = (
    <div className="space-y-1 mt-2">
      {SKELETON_KEYS.map((skeletonKey, i) => (
        <div
          key={skeletonKey}
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

  // Поиск ничего не нашёл — это не «архив пуст»: срез пуст, а заметки есть.
  const searchEmpty = (
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
  const filterEmpty = (
    <div className="py-16 text-center">
      <p className="text-[16px] text-text-main/60 font-medium">{t('archive_empty_filtered')}</p>
    </div>
  );
  const sliceEmpty = searchQuery?.trim() ? searchEmpty : hasActiveFilter ? filterEmpty : null;
  const empty = sliceEmpty ?? (
      <EmptyState
        icon={BookOpen}
        title={t('archive_empty_title')}
        description={t('archive_empty_subtitle')}
        dataTour="notes-list"
        action={{
          label: t('archive_empty_action'),
          onClick: () => { void navigate('/'); },
        }}
      />
  );

  // Ветки чтения разбирает LoadStateView: не прочиталось — ошибка с «Повторить»,
  // а не «Архив пуст»; облако не ответило — список с устройства, даже пустой,
  // без «начни писать» (плашка об облаке выше, на странице).
  return (
    <LoadStateView
      state={state}
      loading={skeleton}
      error={retry => <LoadNotice variant="panel" className="rounded-3xl border-accent-danger/30" text={t('archive_load_error')} onRetry={retry} />}
      errorWithData={retry => <LoadNotice variant="row" className="mb-3" text={t('archive_load_error')} onRetry={retry} />}
      partial={() => null}
      empty={empty}
    >
      {(list, notice) => (<>
        {notice}
        {/* Пустой срез при прошлых данных (перечитываем) или частичном отказе: поиск
            и фильтр называют себя; без них — при перечитывании то же «пусто», что было,
            а при отказе облака — ничего (плашка облака выше). */}
        {list.length > 0 ? renderList(list) : sliceEmpty ?? (state.status === 'partial' ? null : empty)}
      </>)}
    </LoadStateView>
  );

  function renderList(filteredSessions: ArchiveSession[]) {
    // AUDIT-L9: группированные виды рендерятся целиком (документированный
    // компромисс «robust at ~tens–hundreds»). При росте архива сверх лимита
    // автоматически откатываемся на плоский виртуализированный вид — данные
    // те же, группировка просто отключается, ничего не теряется.
    const totalSessions = filteredSessions.length;
    const groupedOverLimit = isGroupedByDate && totalSessions > GROUPED_VIEW_LIMIT;
    if (!isGroupedByDate || groupedOverLimit) {
      if (viewMode === 'grid') {
        return (
          <VirtuosoGrid
            data={filteredSessions}
            computeItemKey={(_, s) => s.id}
            className="custom-scrollbar h-full"
            components={gridComponents}
            listClassName={gridListClass}
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
                onTitleChange={onTitleChange}
                onDelete={(s) => onDelete(s)}
                onStorageChange={onStorageChange}
                userId={userId}
                aiProcessed={!!aiProcessedMap[session.id]}
                aiLoading={!!aiBusyMap[session.id]}
                onAIClick={() => void handleAIClick(session)}
                aiExclusionLoading={!!aiExclusionBusyMap[session.id]}
                onAIExclusionClick={() => void handleAIExclusionClick(session)}
              />
            )}
          />
        );
      }

      return (
        <Virtuoso
          data={filteredSessions}
          computeItemKey={(_, s) => s.id}
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
              aiLoading={!!aiBusyMap[session.id]}
              onAIClick={() => void handleAIClick(session)}
              aiExclusionLoading={!!aiExclusionBusyMap[session.id]}
              onAIExclusionClick={() => void handleAIExclusionClick(session)}
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
                {dayHeader(dateKey, sessions, isMobileView ? 'py-3' : 'py-4')}
                {/* Десктоп — как до MP: без отступа под заголовком дня (ревью 0.9.40). */}
                <div className={isMobileView ? gridListClass : 'grid gap-4 archive-grid-list'}>
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
                        onTitleChange={onTitleChange}
                        onDelete={(s) => onDelete(s)}
                        onStorageChange={onStorageChange}
                        userId={userId}
                        aiProcessed={!!aiProcessedMap[session.id]}
                        aiLoading={!!aiBusyMap[session.id]}
                        onAIClick={() => void handleAIClick(session)}
                        aiExclusionLoading={!!aiExclusionBusyMap[session.id]}
                        onAIExclusionClick={() => void handleAIExclusionClick(session)}
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
      <div data-tour="notes-list" className="custom-scrollbar h-full overflow-y-auto">
        {sortedDates.map(dateKey => {
          const sessions = groupedSessions[dateKey] ?? [];
          if (sessions.length === 0) return null;
          return (
            <div key={dateKey}>
              {dayHeader(dateKey, sessions, isMobileView ? 'py-3' : 'py-5')}
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
                  aiLoading={!!aiBusyMap[session.id]}
                  onAIClick={() => void handleAIClick(session)}
                  aiExclusionLoading={!!aiExclusionBusyMap[session.id]}
                  onAIExclusionClick={() => void handleAIExclusionClick(session)}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }
}
