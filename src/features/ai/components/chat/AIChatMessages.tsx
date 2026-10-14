import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Trash2, Paperclip, AlertTriangle, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ArchiveSession } from '../../../../shared/types/common';
import { Button } from '../../../../shared/components/Button';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';
import { ATTACHED_QUESTION_SEP } from '../../../../shared/ai/languageNudge';
import {
  Monogram,
  AttachedNoteCard,
  AttachedFileCard,
  AttachedSummaryCard,
  AssistantTurn,
  ATTACHED_NOTE_RE,
  ATTACHED_NOTE_SUMMARY_RE,
  ATTACHED_FILE_RE,
} from '../AIChatPresentational';
import type { PersonaVisual } from '../../constants/personaVisuals';
import { useCitationMeta, type ChatMessage } from './useCitationMeta';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { ConsentCode } from '../../hooks/useAIChat';
import { diffPostAgainstNote, postBody } from '../../utils/editorDiff';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';
import { getCurrentUser } from '../../../../core/auth';

export interface AIChatMessagesProps {
  displayMessages: readonly ChatMessage[];
  streamingMessage: string | null;
  streamingReasoning: string | null;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  /** S-31: нет согласия на ИИ/индексацию — состояние, а не техническая ошибка. */
  consentRequired: ConsentCode | null;
  onOpenSettings: () => void;
  convPersonaName: string;
  /** DLG-Q10: id персоны диалога — плашка сверки поста положена только Редактору. */
  convPersonaId: string;
  /** Заметка-тема диалога: источник сверки для старых ходов без тела в реплике. */
  dialogueDocumentId?: string | undefined;
  convVisual: PersonaVisual;
  onCopyMessage: (content: string) => void;
  onDeleteMessage: (index: number) => void;
  onFeedback: (value: 'up' | 'down') => void;
  onRegenerate: () => void;
  onSwitchVariant: (delta: number) => void;
  onCreateNote: (text: string) => void;
  onForcedSearch: (query: string) => void;
  dailyLimitRemaining: number;
  followUps: string[];
  onSuggestion: (s: string) => void;
  starters: string[];
  activeDialogueId: string | null;
  activePersonaName: string;
  /** MC-9: «Диалог с …» требует творительного падежа; у самодельных персон
   *  его нет — там заголовок собирается через «Диалог: …». */
  activePersonaNameInstrumental?: string | undefined;
  headerVisual: PersonaVisual;
  proactiveHint: string | null;
  setInputText: (v: string) => void;
  isMobile: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  previewSession: ArchiveSession | null;
  onClosePreview: () => void;
  setCitationPreviewSession: (session: ArchiveSession) => void;
}

const ATTACHED_NOTE_MARKER_RE = /\[Прикреплена заметка: "([^"]+)"\]/g;

function parseAttachedNotes(content: string, defaultTitle: string) {
  const sepIdx = content.indexOf(ATTACHED_QUESTION_SEP);
  const beforeSep = sepIdx >= 0 ? content.slice(0, sepIdx) : content;
  const question = sepIdx >= 0 ? content.slice(sepIdx + ATTACHED_QUESTION_SEP.length).trim() : '';

  const markers: { title: string; start: number; end: number }[] = [];
  for (const m of beforeSep.matchAll(ATTACHED_NOTE_MARKER_RE)) {
    markers.push({ title: m[1] ?? defaultTitle, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  const notes: { title: string; body: string }[] = markers.map((mk, idx) => {
    const nextStart = idx + 1 < markers.length ? markers[idx + 1]!.start : beforeSep.length;
    const body = beforeSep.slice(mk.end, nextStart).trim();
    return { title: mk.title, body };
  });

  return { question, notes };
}

function buildAttachedNoteContent(title: string, body: string): string {
  return `[Прикреплена заметка: "${title}"]\n\n${body}`;
}

// DLG-Q10: откуда брать заметку-источник. Тело приложенной заметки лежит в
// пользовательской реплике с маркером; берём последнюю перед этим ответом. Если
// тела нет (старый формат хода), источник — заметка-тема диалога.
const ATTACHED_HEAD_RE = /\[#([^\s\]·]+)(?:\s·[^\]\n]*)?\]/;

interface SourceNote { id?: string | undefined; title: string; body: string }

function findSourceNote(messages: readonly ChatMessage[], before: number): SourceNote | null {
  for (let i = before - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !m.content.includes('[Прикреплена заметка:')) continue;
    const { notes } = parseAttachedNotes(m.content, '');
    const withBody = notes.filter(n => n.body);
    if (withBody.length === 0) continue;
    const last = withBody[withBody.length - 1]!;
    return { id: m.content.match(ATTACHED_HEAD_RE)?.[1], title: last.title, body: last.body };
  }
  return null;
}

function EditorPostDiff({ answer, source, dialogueDocumentId }: { answer: string; source: SourceNote | null; dialogueDocumentId?: string | undefined }) {
  const { t } = useLanguage();
  const [noteText, setNoteText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = source?.id ?? (source ? undefined : dialogueDocumentId);
    void (async () => {
      try {
        const db = await getLocalDb();
        if (id) {
          const doc = await db.get('documents', id);
          // Скрытая от ИИ, в корзине или удалённая — сверку не показываем.
          if (!doc || isExcludedFromAI(doc)) { if (!cancelled) setNoteText(null); return; }
          const text = await LocalVersionService.getLatestContent(id);
          if (!cancelled) setNoteText(text);
          return;
        }
        if (source) {
          const docs = await db.getAll('documents');
          const byTitle = docs.find(d => (d.title ?? '') === source.title);
          if (byTitle && isExcludedFromAI(byTitle)) { if (!cancelled) setNoteText(null); return; }
          if (!cancelled) setNoteText(source.body);
          return;
        }
        if (!cancelled) setNoteText(null);
      } catch {
        if (!cancelled) setNoteText(null);
      }
    })();
    return () => { cancelled = true; };
    // Зависимости — поля, а не объект: источник пересобирается на каждый рендер,
    // и по ссылке эффект зациклился бы.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- примитивы эквивалентны объекту
  }, [source?.id, source?.title, source?.body, dialogueDocumentId]);

  const diff = useMemo(
    () => (noteSourceIsPresent(noteText)
      ? diffPostAgainstNote(postBody(answer), noteText, { selfName: getCurrentUser()?.displayName ?? undefined })
      : null),
    [answer, noteText],
  );
  if (!diff) return null;

  const parts: string[] = [];
  if (diff.namesRemoved.length) parts.push(`${t('ai_editor_diff_names_removed')} — ${diff.namesRemoved.join(', ')}`);
  if (diff.numbersRemoved.length) parts.push(`${t('ai_editor_diff_numbers_removed')} — ${diff.numbersRemoved.join(', ')}`);
  if (diff.rolesAdded.length) parts.push(`${t('ai_editor_diff_roles_added')} — ${diff.rolesAdded.join(', ')}`);
  // ED-2: неубранные имена — не строчка «что изменилось», а предупреждение перед
  // публикацией, поэтому оно над плашкой и в стилях accent-warning.
  const hasKept = diff.namesKept.length > 0;
  // LD-1: чужая история в посте — второе предупреждение в том же стиле. Оно о
  // том, чего плашка сверки не видит: имён в посте может не быть вовсе.
  const hasClientStory = diff.clientStoryInPost;
  // MD-4: слова другого человека, переехавшие в пост дословно. LD-1 и DR-5 ловят
  // маркер слова («клиент», «терапия»), а здесь — саму реплику: пост может быть
  // без единого имени и всё равно цитировать чужой голос.
  const hasForeignSpeech = diff.foreignSpeechInPost;
  // R-4: «ничего не изменено» — непроверяемое утверждение (имена в начале фразы
  // раньше не считались вовсе), поэтому при пустом результате плашки нет.
  if (parts.length === 0 && !hasKept && !hasClientStory && !hasForeignSpeech) return null;

  return (
    <>
      {hasKept && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning/90 font-medium flex items-start gap-2 w-fit max-w-full">
          <AlertTriangle size={13} className="shrink-0 text-accent-warning mt-0.5" />
          <span>{t('ai_editor_diff_names_kept', { names: diff.namesKept.join(', ') })}</span>
        </div>
      )}
      {hasClientStory && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning/90 font-medium flex items-start gap-2 w-fit max-w-full">
          <AlertTriangle size={13} className="shrink-0 text-accent-warning mt-0.5" />
          <span>{t('ai_editor_diff_client_story')}</span>
        </div>
      )}
      {hasForeignSpeech && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning/90 font-medium flex items-start gap-2 w-fit max-w-full">
          <AlertTriangle size={13} className="shrink-0 text-accent-warning mt-0.5" />
          <span>{t('ai_editor_diff_foreign_speech')}</span>
        </div>
      )}
      {parts.length > 0 && (
        <div className="mt-2 px-3 py-1.5 rounded-xl bg-surface-card border border-border-subtle text-[11px] leading-relaxed text-text-main/55 w-fit max-w-full">
          <span className="font-medium">{t('ai_editor_diff_title')}: </span>
          <span>{parts.join('; ')}</span>
        </div>
      )}
    </>
  );
}

function noteSourceIsPresent(text: string | null): text is string {
  return !!text && text.trim().length > 0;
}

export function AIChatMessages(props: AIChatMessagesProps) {
  const {
    displayMessages,
    streamingMessage,
    streamingReasoning,
    isLoading,
    error,
    clearError,
    consentRequired,
    onOpenSettings,
    convPersonaName,
    convPersonaId,
    dialogueDocumentId,
    convVisual,
    onCopyMessage,
    onDeleteMessage,
    onFeedback,
    onRegenerate,
    onSwitchVariant,
    onCreateNote,
    onForcedSearch,
    dailyLimitRemaining,
    followUps,
    onSuggestion,
    starters,
    activeDialogueId,
    activePersonaName,
    activePersonaNameInstrumental,
    headerVisual,
    proactiveHint,
    setInputText,
    isMobile,
    messagesEndRef,
    previewSession,
    onClosePreview,
    setCitationPreviewSession,
  } = props;
  const { t } = useLanguage();

  const { processCitations, handleCitationClick } = useCitationMeta(displayMessages, streamingMessage, setCitationPreviewSession);

  const lastAssistantIdx = (() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m && m.role === 'assistant' && m.type !== 'system') return i;
    }
    return -1;
  })();

  return (
    <>
      {/* not-a-modal: preview backdrop */}
      {previewSession && <div className="fixed inset-0 z-40 bg-black/20" onClick={onClosePreview} />}

      {/* z-0, не выше: шапка и поле ввода стоят на z-10, и их выпадающие
          списки обязаны ложиться поверх сообщений. Фон-свечение — тоже z-0, но
          раньше в DOM, поэтому остаётся под сообщениями. */}
      <div className={cn("relative z-0 flex-1 overflow-y-auto py-7", isMobile ? 'min-h-0 px-5' : "px-6")}>
        <div className="max-w-[1600px] mx-auto flex flex-col gap-7" aria-live="polite">
          {proactiveHint && !activeDialogueId && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-brand-soft/10 border border-brand-soft/20 text-sm text-brand-soft">
              <Sparkles size={16} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">{proactiveHint}</span>
              <Button
                onClick={() => { if (proactiveHint) setInputText(proactiveHint.replace(/.*«|».*/, '').trim()); }}
                className={cn("text-xs font-bold px-3 py-1 rounded-lg bg-brand-soft/20 hover:bg-brand-soft/30", isMobile && "min-h-11")}
              >
                {t('ai_discuss')}
              </Button>
            </div>
          )}
          {displayMessages.length === 0 && !activeDialogueId && (
            <div className="flex flex-col items-center justify-center gap-4 text-center py-24">
              <Monogram color={headerVisual.color} mono={headerVisual.mono} size={56} />
              <div>
                <p className="text-base font-medium text-text-main/70">
                  {activePersonaNameInstrumental
                    ? t('ai_dialogue_with', { name: activePersonaNameInstrumental })
                    : t('ai_dialogue_anon', { name: activePersonaName })}
                </p>
                {!activePersonaName && (
                  <p className="text-xs text-text-main/60 mt-1.5">{t('ai_select_persona')}</p>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {starters.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSuggestion(s)}
                    disabled={isLoading || dailyLimitRemaining === 0}
                    className={cn("px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle text-sm text-text-main/80 hover:border-brand-soft/40 hover:text-text-main transition-colors disabled:opacity-40", isMobile && "min-h-11")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {displayMessages.map((msg, i) => {
            const isAttachedNote = msg.role === 'user' && ATTACHED_NOTE_RE.test(msg.content);
            const isAttachedSummary = msg.role === 'user' && ATTACHED_NOTE_SUMMARY_RE.test(msg.content);
            const isAttachedFile = msg.role === 'user' && ATTACHED_FILE_RE.test(msg.content);
            const isSystemMessage = msg.type === 'system';
            const isAttachment = isAttachedNote || isAttachedSummary || isAttachedFile;

            // Ключ — индекс: диалог только дописывается в конец, а сообщения после
            // каждого обновления приходят из базы новыми объектами. Ключ по объекту
            // перемонтировал бы весь чат и сбрасывал раскрытый ход мысли.
            if (isSystemMessage) {
              return (
                <div key={i} className="flex justify-center">
                  <div className="px-4 py-1.5 rounded-full bg-surface-card border border-border-subtle text-[11px] text-text-main/60 font-mono">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === 'assistant') {
              return (
                <AssistantTurn
                  key={i}
                  name={convPersonaName}
                  isMobile={isMobile}
                  color={convVisual.color}
                  mono={convVisual.mono}
                  onCopy={() => onCopyMessage(msg.content)}
                  onDelete={() => onDeleteMessage(i)}
                  onFeedback={v => void onFeedback(v)}
                  onRegenerate={i === lastAssistantIdx && !isLoading ? onRegenerate : undefined}
                  variants={msg.variants}
                  variantIndex={msg.variantIndex}
                  onSwitchVariant={i === lastAssistantIdx ? onSwitchVariant : undefined}
                  onCreateNote={() => { onCreateNote(msg.content); }}
                  content={msg.content}
                  reasoning={msg.reasoning}
                >
                  {msg.searchRequest && (
                    <button
                      type="button"
                      onClick={() => onForcedSearch(msg.searchRequest!)}
                      disabled={isLoading || dailyLimitRemaining === 0}
                      className={cn(
                        "mb-3 px-3 py-2 rounded-xl border text-[13px] font-medium flex items-center gap-2 w-fit max-w-[85%] text-left shadow-sm transition-colors",
                        isLoading || dailyLimitRemaining === 0
                          ? "bg-surface-card border-border-subtle text-text-main/50 cursor-default"
                          : "bg-surface-card border-brand-soft/30 text-text-main hover:border-brand-soft/60 hover:bg-brand-soft/5 cursor-pointer"
                      )}
                    >
                      <span className="text-sm">🔍</span>
                      <span className="opacity-80">{t('ai_search_in_notes')}</span>
                      <span className="font-semibold truncate">„{msg.searchRequest}“</span>
                    </button>
                  )}
                  {msg.reasoning && (
                    <details className="mb-3 rounded-xl border border-border-subtle bg-surface-card/50 overflow-hidden">
                      <summary className="px-4 py-2 text-xs font-medium text-text-main/60 cursor-pointer hover:text-text-main transition-colors select-none">
                        {t('ai_reasoning_flow')}
                      </summary>
                      <div className="px-4 py-3 text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap border-t border-border-subtle">
                        {msg.reasoning}
                      </div>
                    </details>
                  )}
                  {msg.degradedReason === 'daily_limit' && (
                    <div className="mb-3 px-3 py-1.5 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning/90 font-medium flex items-center gap-2 w-fit">
                      <AlertTriangle size={13} className="shrink-0 text-accent-warning" />
                      <span>{t('ai_degraded_daily_limit_chat')}</span>
                    </div>
                  )}
                  <MarkdownRenderer content={processCitations(msg.content)} onCitationClick={handleCitationClick} />
                  {convPersonaId === 'editor' && msg.content.includes('— — —') && (
                    <EditorPostDiff
                      answer={msg.content}
                      source={findSourceNote(displayMessages, i)}
                      dialogueDocumentId={dialogueDocumentId}
                    />
                  )}
                </AssistantTurn>
              );
            }

            if (isAttachedNote) {
              // AX-1/AX-10: parse display into note cards + question.
              // Supports multiple attached notes (each with its own marker).
              const { question, notes } = parseAttachedNotes(msg.content, t('common_untitled'));

              return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  <div className="max-w-[78%] flex flex-col items-end gap-1.5">
                    {notes.map((note, ni) => (
                      note.body
                        ? <AttachedNoteCard key={ni} content={buildAttachedNoteContent(note.title, note.body)} />
                        : <span key={ni} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-card border border-brand-soft/30 text-xs text-text-main/80 max-w-full">
                            <Paperclip size={12} className="text-brand-soft shrink-0" />
                            <span className="truncate">{note.title}</span>
                          </span>
                    ))}
                    {question && (
                      <div className="px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-b from-brand-primary/25 to-brand-primary/15 border border-brand-primary/30 text-text-main text-[14.5px] leading-relaxed whitespace-pre-wrap">
                        {question}
                      </div>
                    )}
                    <button type="button" onClick={() => onDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors mr-1" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                  </div>
                </div>
              );
            }

            if (isAttachment) {
              return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  <div className="max-w-[78%] flex flex-col items-end gap-1.5">
                    {isAttachedSummary
                      ? <AttachedSummaryCard content={msg.content} />
                      : <AttachedFileCard content={msg.content} />}
                    <button type="button" onClick={() => onDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors mr-1" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className="flex flex-col items-end gap-1.5">
                <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-br-md bg-gradient-to-b from-brand-primary/25 to-brand-primary/15 border border-brand-primary/30 text-text-main text-[14.5px] leading-relaxed">
                  {msg.content}
                </div>
                <div className="flex items-center gap-2 mr-1">
                  <button type="button" onClick={() => onDeleteMessage(i)} className="text-text-main/30 hover:text-accent-danger transition-colors" aria-label={t('ai_delete_message')}><Trash2 size={11} /></button>
                  <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-text-main/60">{t('ai_you')}</span>
                </div>
              </div>
            );
          })}

          {streamingReasoning && (
            <details className="mb-3 rounded-xl border border-border-subtle bg-surface-card/50 overflow-hidden">
              <summary className="px-4 py-2 text-xs font-medium text-text-main/60 cursor-pointer hover:text-text-main transition-colors select-none">
                {t('ai_reasoning_flow')}
              </summary>
              <div className="px-4 py-3 text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap border-t border-border-subtle">
                {streamingReasoning}
              </div>
            </details>
          )}

          {streamingMessage !== null && (
            <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono} isMobile={isMobile} content={streamingMessage}>
              <MarkdownRenderer content={processCitations(streamingMessage)} onCitationClick={handleCitationClick} />
            </AssistantTurn>
          )}

          {isLoading && !streamingMessage && (
            <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono} isMobile={isMobile}>
               <ThinkingIndicator name={convPersonaName} />
            </AssistantTurn>
          )}

          {error && (
            <div className="flex justify-center" role="alert">
              <div className="px-4 py-2 rounded-xl bg-accent-danger/10 border border-accent-danger/20 text-xs text-accent-danger">
                {error}
                 <Button onClick={clearError} className="ml-2 underline">{t('ai_close')}</Button>
              </div>
            </div>
          )}

          {/* S-31: согласие — не поломка: спокойная подсказка со ссылкой в Настройки
              вместо красной плашки «техническая ошибка». */}
          {consentRequired && (
            <div className="flex justify-center" role="status">
              {/* MB-6: на 360 px текст стоял в один ряд с двумя ссылками и
                  сжимался в столбик по слову, а «Закрыть» уезжал за край. Текст
                  получает ширину, кнопки переносятся, цели касания — 44 px. */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-xs text-brand-soft">
                <span className="min-w-[200px] flex-1">{t(consentRequired === 'INDEXING_CONSENT_REQUIRED' ? 'ai_chat_indexing_consent_hint' : 'ai_chat_consent_hint')}</span>
                <Button onClick={onOpenSettings} className="ml-1 underline shrink-0 min-h-[44px]">{t('settings_open')}</Button>
                <Button onClick={clearError} className="underline shrink-0 min-h-[44px]">{t('ai_close')}</Button>
              </div>
            </div>
          )}

          {!isLoading && streamingMessage === null && !error && !consentRequired && lastAssistantIdx === displayMessages.length - 1 && displayMessages.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {followUps.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSuggestion(s)}
                  disabled={dailyLimitRemaining === 0}
                  className="px-3 py-1.5 rounded-full bg-surface-card border border-border-subtle text-xs text-text-main/70 hover:border-brand-soft/40 hover:text-text-main transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </>
  );
}
