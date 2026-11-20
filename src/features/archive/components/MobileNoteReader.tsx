// MP-1: читалка заметки на телефоне — полноэкранный режим для чтения. шапка из
// одной строки («‹ Заметки» · «ⓘ» · «⋯»), в теле только заголовок и текст.
// Дата, слова, время чтения, метка, теги и разбор живут в «ⓘ», правка и
// удаление — в «⋯» (тот же лист, что у строки заметки).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Info, MoreHorizontal, X, Lock, Sparkles, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { LoadNotice } from '../../../shared/components/LoadStateView';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell, SECTION_LABEL, SheetTitle } from '../../../shared/components/ModalShell';
import { cn } from '../../../core/utils/utils';
import { InlineTags } from './InlineTags';
import { MobileNoteActionsSheet } from '../../../app/components/MobileNoteActionsSheet';
import { usePanelHistory } from '../../../shared/hooks/usePanelHistory';
import { readingTimeMinutes } from '../../../shared/utils/readingTime';
import { isBlankTitle } from '../../../shared/utils/titleUtils';
import { MobileRenameSheet } from './MobileRenameSheet';
import { splitNoteTitle } from './noteTitle';
import { getDateLocale, toDate } from '../../../core/utils/dateUtils';
import { getCurrentUser } from '../../../core/auth';
import { useAiConsentOff } from '../../../core/ai/useAiConsentOff';
import { toggleAIExclusion } from '../services/archiveCrud';
import { runMutation } from '../../../shared/mutationResult';
import type { AIDocumentSummary } from '../../../core/storage/localDb';
import type { RelatedNote } from '../../../shared/types/common';
import { LABEL_PRESET_COLORS } from '../../../core/constants/labelColors';
import { sessionContentState } from '../../../core/services/sessionContent';

interface MobileNoteReaderProps {
  session: ArchiveSession;
  /** Дейлик 19.11: текст не прочитался — повторить чтение. */
  /** Обязателен: «текст не прочитался» без выхода не собирается. */
  onRetryContent: () => void;
  onClose: () => void;
  onContinue: (session: ArchiveSession) => void;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  onDelete?: ((session: ArchiveSession) => void) | undefined;
  onStorageChange?: (() => void) | undefined;
  summary?: AIDocumentSummary | null | undefined;
  analyzing?: boolean | undefined;
  justFinished?: boolean | undefined;
  analyzeError?: string | null | undefined;
  onAnalyze?: (() => void) | undefined;
  /** MF-12: «Удалить разбор ИИ» в листе действий читалки — как в списке. */
  onClearAnalysis?: (() => void) | undefined;
  /** Ревью 0.9.40: новая метка с телефона — тот же `addLabel`, что на десктопе. */
  onAddLabel?: ((label: { name: string; color: string }) => void) | undefined;
  /** Ревью 0.9.40: «Изменить название» переименовывает, а не открывает редактор. */
  onTitleChange?: ((session: ArchiveSession, title: string) => void) | undefined;
  /** Ревью 0.9.40: «Связанные записи» — в конце текста, как в десктопной панели. */
  relatedNotes?: RelatedNote[] | undefined;
  onSelectRelated?: ((documentId: string) => void) | undefined;
}

export function MobileNoteReader({
  session, onClose, onContinue, onTagsChange, onLabelChange, labels, allTags,
  onDelete, onStorageChange, summary, analyzing, justFinished, analyzeError, onAnalyze, onClearAnalysis,
  onAddLabel, onTitleChange, relatedNotes, onSelectRelated, onRetryContent,
}: MobileNoteReaderProps) {
  const { t, tp, language } = useLanguage();
  // MP-1/Safari: читалка — не окно, поэтому прокрутку страницы за собой не
  // закрывала. На WebKit из-за этого появлялся классический скроллбар, и
  // полноэкранный слой оказывался на 5 px меньше вьюпорта (проверено снимком).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const { showToast } = useToast();
  const user = getCurrentUser();
  const aiOff = useAiConsentOff();
  // Лист действий меряется на того, кто открыл заметку: гостю облачные пути не
  // показываются, а заметки гостя лежат под `session.userId`.
  const actorId = user?.uid ?? session.userId;
  const [infoOpen, setInfoOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tagAdding, setTagAdding] = useState(false);
  const [exclusionLoading, setExclusionLoading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<string>(LABEL_PRESET_COLORS[0]!);
  const createLabel = () => {
    const name = newLabelName.trim();
    if (!name || !onAddLabel) return;
    onAddLabel({ name, color: newLabelColor });
    setNewLabelName('');
    setNewLabelColor(LABEL_PRESET_COLORS[0]!);
    setCreatingLabel(false);
  };
  // MB-9: «назад» и свайп закрывают читалку, а не уводят из приложения.
  usePanelHistory(true, onClose, true);

  const date = toDate(session.createdAt) ?? new Date();
  const currentLabel = labels?.find(l => l.id === session.labelId);
  const body = sessionContentState(session);
  const readable = !session._locked && !session._decryptionError && !session._contentNotLoaded;
  const title = session._locked
    ? t('archive_note_locked')
    : session._decryptionError
      ? t('archive_decryption_error')
      : splitNoteTitle(session.title, session.content).title || t('session_untitled');

  const handleExclusionClick = () => {
    const nextExcluded = !session.excludedFromAI;
    setExclusionLoading(true);
    // Дейлик 19.11 Н-3: тот же помощник итога, что в списке архива.
    void runMutation({ showToast, t }, 'reader_toggle_ai_exclusion',
      () => toggleAIExclusion(session, nextExcluded, user, actorId),
      { successText: t(nextExcluded ? 'ai_note_excluded' : 'ai_note_include'), context: { documentId: session.id } },
    ).then(done => {
      if (done) onStorageChange?.();
      setExclusionLoading(false);
    });
  };

  // MB-4: портал в body. Внутри `main` `fixed` считается от предка с
  // transform/backdrop-filter, и « полноэкранный» лист упирался в край контента
  // (в e2e MP-1 это видно как левый край x=32 вместо 0).
  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: '0%' }}
      // MQ-15 (R1): уходя вниз, экран остаётся непрозрачным — без затухания по пути.
      exit={{ y: '100%' }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      // not-a-modal: fullscreen mobile screen — читалка не окно, а экран
      // (тот же путь, что `MobileWriteScreen`, `MobileFocusScreen`,
      // `MobileSessionSetupSheet`); листы «ⓘ» и «⋯» внутри неё идут через
      // `ModalShell`.
      className="fixed inset-0 z-[var(--z-panel)] flex flex-col bg-[var(--bg-base)] text-text-main"
      data-testid="note-reader"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-2 pt-[env(safe-area-inset-top,0px)]">
        {/* R2 (emil-review, хвост MQ-15): шеврон «‹» обещал «назад вправо», а
            экран приезжал снизу и туда же уходил. Знак теперь показывает,
            куда на самом деле едет экран. */}
        <Button
          onClick={onClose}
          className="min-h-11 rounded-xl px-3 text-[15px] text-text-main/70 hover:text-text-main"
        >
          ▾ {t('nav_notes_short')}
        </Button>
        <div className="flex items-center gap-1">
          <IconButton
            onClick={() => setInfoOpen(true)}
            className="h-11 w-11 rounded-xl"
            label={t('reader_info')}
            icon={<Info size={20} aria-hidden="true" />}
          />
          <IconButton
            onClick={() => setActionsOpen(true)}
            className="h-11 w-11 rounded-xl"
            label={t('archive_note_actions')}
            icon={<MoreHorizontal size={20} aria-hidden="true" />}
          />
        </div>
      </header>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-[var(--reading-gutter)] pb-8 pt-2">
        <h1 className="text-[24px] font-medium leading-[1.2] tracking-tight text-text-main">{title}</h1>
        {/* SA-17: когда это было — читателю дневника нужно сразу, а не после «Инфо». */}
        <time data-testid="reader-date" dateTime={date.toISOString()} className="mt-1.5 block text-[13px] text-text-subtle">
          {format(date, date.getFullYear() === new Date().getFullYear() ? 'd MMMM, HH:mm' : 'd MMMM yyyy, HH:mm', { locale: getDateLocale(language) })}
        </time>
        {body.kind === 'locked' ? (
          <div className="mt-6 rounded-2xl border border-accent-warning/20 bg-accent-warning/5 p-5 text-center">
            {/* U-25 (решение владельца 2026-10-18): как на десктопе — замок 32 и
                заголовок над пояснением (`DocumentPreview.tsx:727-731`). */}
            <Lock size={32} className="mx-auto mb-3 text-accent-warning/80" aria-hidden="true" />
            <p className="text-[15px] font-medium text-text-main">{t('archive_note_locked')}</p>
            <p className="mt-1 text-[13px] text-text-main/60">{t('archive_locked_preview_desc')}</p>
            <Button
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent('open-vault-unlock'));
              }}
              className="mt-3 rounded-xl bg-brand-soft/20 px-4 py-2 text-[15px] text-brand-soft"
            >
              {t('archive_unlock')}
            </Button>
          </div>
        ) : body.kind === 'undecryptable' ? (
          <p className="mt-4 text-[17px] text-accent-danger">{t('archive_decryption_error')}</p>
        ) : body.kind === 'error' ? (
          <LoadNotice variant="panel" className="mt-4 p-6" text={t('archive_content_load_error')} onRetry={onRetryContent} />
        ) : body.kind === 'loading' ? (
          <p className="mt-4 text-[17px] text-text-main/60">{t('common_loading')}</p>
        ) : (
          <p data-testid="reader-body" className="mt-3 whitespace-pre-wrap text-[length:var(--reading-size)] leading-[var(--reading-lh)] text-pretty text-[var(--ink)]">
            {body.content || <span className="italic text-text-main/60">{t('archive_no_content')}</span>}
          </p>
        )}
        {readable && (relatedNotes?.length ?? 0) > 0 && onSelectRelated && (
          <section data-testid="reader-related" className="mt-10 border-t border-border-subtle/60 pt-5">
            <h2 className={SECTION_LABEL}>{t('archive_related_notes')}</h2>
            <ul className="mt-2">
              {relatedNotes!.map(note => (
                <li key={note.documentId}>
                  <button
                    type="button"
                    onClick={() => onSelectRelated(note.documentId)}
                    // U-25: связанные записи — карточки, как в десктопной превью-панели
                    // (`DocumentPreview.tsx:770-776`); высота 48 px остаётся.
                    className="press flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border-subtle/40 bg-surface-card p-3 text-left"
                  >
                    <span className="truncate text-[15px] text-text-main/85">{note.title}</span>
                    <span className="shrink-0 text-[13px] text-text-subtle">{note.date}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* U-36 (решение владельца 2026-10-18, Q-8): главное действие читалки —
          общая `Button primary` внизу экрана, как на десктопной превью-панели
          (`DocumentPreview.tsx:790-810`). Дубль в листе «⋯» оставлен. */}
      <div className="shrink-0 border-t border-border-subtle px-[var(--reading-gutter)] pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => {
            if (session._locked) {
              window.dispatchEvent(new CustomEvent('open-vault-unlock'));
              return;
            }
            if (session._decryptionError) {
              showToast(t('archive_decryption_error'), 'error');
              return;
            }
            onContinue(session);
          }}
        >
          {t('archive_continue_writing')}
        </Button>
      </div>

      {/* MF-20: «Инфо» смонтирован всегда — open даёт листу уйти с анимацией. */}

          <ModalShell open={infoOpen} onClose={() => setInfoOpen(false)} labelId="note-reader-info-title" variant="sheet">
            <div className="custom-scrollbar max-h-[80dvh] overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              <div className="flex items-center justify-between py-3">
                <SheetTitle id="note-reader-info-title">{t('reader_info')}</SheetTitle>
                <IconButton
                  onClick={() => setInfoOpen(false)}
                  className="h-11 w-11 rounded-xl"
                  label={t('close')}
                  icon={<X size={18} aria-hidden="true" />}
                />
              </div>

              <div className="text-[13px] text-[var(--text-subtle)]">
                {format(date, 'd MMMM yyyy, HH:mm', { locale: getDateLocale(language) })}
                {' · '}
                {tp('archive_word_count', session.wordCount || 0)}
                {' · '}
                {t('reading_time', { n: readingTimeMinutes(session.wordCount || 0) })}
                {/* MQ-14: «· 0 мин» у короткой заметки не пишем. */}
                {Math.round((session.duration || 0) / 60) > 0 && ` · ${Math.round((session.duration || 0) / 60)} ${t('goal_time_min')}`}
              </div>

              {((labels?.length ?? 0) > 0 || onAddLabel) && onLabelChange && (
                <div className="mt-5">
                  <div className={SECTION_LABEL}>
                    {t('archive_assign_label')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentLabel && (
                      <Button
                        onClick={() => onLabelChange(session, undefined)}
                        className="min-h-11 rounded-full border border-border-subtle px-3 text-[15px] text-text-main/60"
                      >
                        {t('archive_no_label')}
                      </Button>
                    )}
                    {labels?.map(l => (
                      <Button
                        key={l.id}
                        onClick={() => onLabelChange(session, session.labelId === l.id ? undefined : l.id)}
                        aria-pressed={session.labelId === l.id}
                        // U-23 (хвост): общий чип метки, как в листе действий и в
                        // «Записано.»; выбранная отмечена кольцом `brand-soft`.
                        className={cn(
                          'min-h-11 inline-flex items-center gap-2 rounded-full border border-border-subtle px-3 text-[15px] text-text-main/70',
                          session.labelId === l.id && 'ring-2 ring-brand-soft text-text-main',
                        )}
                      >
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: l.color }} />
                        {l.name}
                      </Button>
                    ))}
                    {onAddLabel && !creatingLabel && (
                      <Button
                        onClick={() => setCreatingLabel(true)}
                        className="min-h-11 rounded-full border border-dashed border-border-subtle px-3 text-[15px] text-text-main/60"
                      >
                        + {t('archive_add_label')}
                      </Button>
                    )}
                  </div>
                  {onAddLabel && creatingLabel && (
                    <div className="mt-3 flex flex-col gap-3">
                      <input
                        value={newLabelName}
                        onChange={e => setNewLabelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createLabel(); }}
                        placeholder={t('archive_label_name_placeholder')}
                        aria-label={t('archive_label_name_placeholder')}
                        className="min-h-11 rounded-xl border border-border-subtle bg-transparent px-3 text-[15px] text-text-main outline-none"
                      />
                      <div className="flex items-center gap-1">
                        {LABEL_PRESET_COLORS.map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNewLabelColor(c)}
                            aria-label={c}
                            aria-pressed={newLabelColor === c}
                            className="flex h-11 w-11 items-center justify-center"
                          >
                            <span
                              className="h-6 w-6 rounded-full"
                              style={{ background: c, boxShadow: newLabelColor === c ? '0 0 0 2px var(--bg-base), 0 0 0 4px var(--text-main)' : undefined }}
                            />
                          </button>
                        ))}
                        <div className="flex-1" />
                        <Button onClick={() => setCreatingLabel(false)} className="min-h-11 px-3 text-[15px] text-text-main/60">
                          {t('common_cancel')}
                        </Button>
                        <Button
                          onClick={createLabel}
                          disabled={!newLabelName.trim()}
                          className="min-h-11 rounded-xl px-3 text-[15px] font-medium text-text-main disabled:opacity-40"
                        >
                          {t('common_save')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                <div className={SECTION_LABEL}>
                  {t('finish_tags')}
                </div>
                <InlineTags
                  variant="sheet"
                  tags={session.tags || []}
                  onChange={tags => onTagsChange?.(session, tags)}
                  allTags={allTags}
                  isAdding={tagAdding}
                  onStartAdding={() => setTagAdding(true)}
                  onStopAdding={() => setTagAdding(false)}
                />
              </div>

              <div className="mt-5">
                <div className={SECTION_LABEL}>
                  {t('archive_preview_ai_title')}
                </div>
                {summary ? (
                  /* MF-15: то же, что десктопное превью — сводка, темы, тон, инсайты,
                     факты; пустые части скрыты. Повторного разбора нет, как на десктопе:
                     для разобранной заметки в «⋯» — «Удалить разбор ИИ». */
                  <div className="mt-2 space-y-3 rounded-xl border border-brand-soft/15 bg-brand-soft/5 p-3 text-[15px] leading-[1.5] text-text-main/80">
                    {summary.summary && <p className="italic">{summary.summary}</p>}
                    {(summary.themes?.length ?? 0) > 0 && <p className="text-text-main/70">{summary.themes!.join(' · ')}</p>}
                    {summary.tone && <p><span className="text-text-main/60">{t('archive_preview_tone')}</span> {summary.tone}</p>}
                    {summary.insights.length > 0 && (
                      <div>
                        <div className="text-text-main/60">{t('archive_preview_insights')}</div>
                        <ul className="mt-1 ml-4 list-disc space-y-1">{summary.insights.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    )}
                    {summary.extractedFacts.length > 0 && (
                      <div>
                        <div className="text-text-main/60">{t('archive_preview_facts')}</div>
                        <ul className="mt-1 ml-4 list-disc space-y-1">{summary.extractedFacts.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    )}
                  </div>
                ) : session.excludedFromAI ? (
                  // U-25: состояния блока ИИ — те же плашки, что на десктопе
                  // (`DocumentPreview.tsx:704-713`), кегль оставлен телефонный.
                  <p className="mt-2 rounded-xl border border-border-subtle/10 bg-surface-base/5 px-3 py-2 text-[15px] italic text-text-main/50">{t('archive_preview_ai_excluded')}</p>
                ) : analyzing ? (
                  <p className="mt-2 flex items-center gap-2 rounded-xl border border-border-subtle/10 bg-surface-base/5 px-3 py-2 text-[15px] italic text-text-main/50">
                    <Loader2 size={14} className="animate-spin text-brand-soft" aria-hidden="true" />
                    {t('archive_preview_analyzing')}
                  </p>
                ) : justFinished ? (
                  <p className="mt-2 rounded-xl border border-brand-soft/20 bg-brand-soft/5 px-3 py-2 text-[15px] text-brand-soft">{t('archive_preview_refresh_hint')}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Button
                      onClick={() => onAnalyze?.()}
                      aria-describedby="analyze-caption-m"
                      className="min-h-11 gap-2 rounded-xl border border-brand-soft/20 bg-brand-soft/10 px-3 text-[15px] text-brand-soft"
                    >
                      {/* U-25: значок разбора как на десктопе (`DocumentPreview.tsx:722`). */}
                      <Sparkles size={14} className="text-brand-soft" aria-hidden="true" />
                      {t('archive_preview_analyze_btn')}
                    </Button>
                    {/* TR-5: что делает кнопка — по месту и всегда. */}
                    <p id="analyze-caption-m" className="text-[14px] text-text-main/60">
                      {t(aiOff ? 'archive_analyze_caption_no_consent' : 'archive_analyze_caption')}
                    </p>
                    {analyzeError && <p className="text-[14px] text-accent-danger">{analyzeError}</p>}
                  </div>
                )}
              </div>
            </div>
          </ModalShell>



      {/* MQ-5: листы смонтированы всегда — уход вниз играет сам лист (useExitLinger). */}
        <MobileNoteActionsSheet
          isOpen={actionsOpen}
          onClose={() => setActionsOpen(false)}
          session={session}
          userId={actorId}
          labels={labels}
          openLabel={t('archive_continue_writing')}
          onOpen={() => onContinue(session)}
          onRename={() => {
            if (onTitleChange) setRenameOpen(true);
            else onContinue(session);
          }}
          onAddTag={() => { setInfoOpen(true); setTagAdding(true); }}
          aiProcessed={!!summary}
          aiLoading={!!analyzing}
          onAIClick={summary ? onClearAnalysis : onAnalyze}
          onDelete={() => onDelete?.(session)}
          onLabelChange={labelId => onLabelChange?.(session, labelId)}
          onStorageChange={() => onStorageChange?.()}
          aiExclusionLoading={exclusionLoading}
          onAIExclusionClick={readable ? handleExclusionClick : undefined}
        />


        <MobileRenameSheet
          open={renameOpen}
          initialTitle={isBlankTitle(session.title) ? '' : (session.title ?? '')}
          onCancel={() => setRenameOpen(false)}
          onSave={title => { if (onTitleChange && title !== session.title) onTitleChange(session, title); setRenameOpen(false); }}
        />
    </motion.div>,
    document.body,
  );
}
