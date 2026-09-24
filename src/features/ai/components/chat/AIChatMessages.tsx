import { type RefObject } from 'react';
import { Trash2, Paperclip, AlertTriangle, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ArchiveSession } from '../../../../shared/types/common';
import { Button } from '../../../../shared/components/Button';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';
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

export interface AIChatMessagesProps {
  displayMessages: readonly ChatMessage[];
  streamingMessage: string | null;
  streamingReasoning: string | null;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  convPersonaName: string;
  convVisual: PersonaVisual;
  onCopyMessage: (content: string) => void;
  onDeleteMessage: (index: number) => void;
  onFeedback: (value: 'up' | 'down') => void;
  onRegenerate: () => void;
  onSwitchVariant: (delta: number) => void;
  onCreateNote: (text: string) => void;
  onApplyToNote?: ((text: string) => void) | undefined;
  onForcedSearch: (query: string) => void;
  dailyLimitRemaining: number;
  followUps: string[];
  onSuggestion: (s: string) => void;
  starters: string[];
  activeDialogueId: string | null;
  activePersonaName: string;
  headerVisual: PersonaVisual;
  proactiveHint: string | null;
  setInputText: (v: string) => void;
  isMobile: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  previewSession: ArchiveSession | null;
  onClosePreview: () => void;
  setCitationPreviewSession: (session: ArchiveSession) => void;
}

export function AIChatMessages(props: AIChatMessagesProps) {
  const {
    displayMessages,
    streamingMessage,
    streamingReasoning,
    isLoading,
    error,
    clearError,
    convPersonaName,
    convVisual,
    onCopyMessage,
    onDeleteMessage,
    onFeedback,
    onRegenerate,
    onSwitchVariant,
    onCreateNote,
    onApplyToNote,
    onForcedSearch,
    dailyLimitRemaining,
    followUps,
    onSuggestion,
    starters,
    activeDialogueId,
    activePersonaName,
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

      <div className="relative z-[1] flex-1 overflow-y-auto px-6 py-7">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-7" aria-live="polite">
          {proactiveHint && !activeDialogueId && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-brand-soft/10 border border-brand-soft/20 text-sm text-brand-soft">
              <Sparkles size={16} className="shrink-0" aria-hidden="true" />
              <span className="flex-1">{proactiveHint}</span>
              <Button
                onClick={() => { if (proactiveHint) setInputText(proactiveHint.replace(/.*«|».*/, '').trim()); }}
                className="text-xs font-bold px-3 py-1 rounded-lg bg-brand-soft/20 hover:bg-brand-soft/30"
              >
                {isMobile ? 'OK' : 'Обсудить'}
              </Button>
            </div>
          )}
          {displayMessages.length === 0 && !activeDialogueId && (
            <div className="flex flex-col items-center justify-center gap-4 text-center py-24">
              <Monogram color={headerVisual.color} mono={headerVisual.mono} size={56} />
              <div>
                <p className="text-base font-medium text-text-main/70">{t('ai_start_dialogue', { name: activePersonaName })}</p>
                <p className="text-xs text-text-main/60 mt-1.5">{t('ai_select_persona')}</p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {starters.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSuggestion(s)}
                    disabled={isLoading || dailyLimitRemaining === 0}
                    className="px-4 py-2.5 rounded-xl bg-surface-card border border-border-subtle text-sm text-text-main/80 hover:border-brand-soft/40 hover:text-text-main transition-colors disabled:opacity-40"
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
                  onApplyToNote={onApplyToNote ? () => { onApplyToNote(msg.content); } : undefined}
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
                      <span className="opacity-80">Поискать в заметках:</span>
                      <span className="font-semibold truncate">„{msg.searchRequest}“</span>
                    </button>
                  )}
                  {msg.reasoning && (
                    <details className="mb-3 rounded-xl border border-border-subtle bg-surface-card/50 overflow-hidden">
                      <summary className="px-4 py-2 text-xs font-medium text-text-main/60 cursor-pointer hover:text-text-main transition-colors select-none">
                        🧠 Ход мысли
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
                </AssistantTurn>
              );
            }

            if (isAttachedNote) {
              // AX-1/AX-10: parse display into note cards + question.
              // Supports multiple attached notes (each with its own marker).
              const SEPARATOR = '\n\n— — —\nВопрос: ';
              const sepIdx = msg.content.indexOf(SEPARATOR);
              const beforeSep = sepIdx >= 0 ? msg.content.slice(0, sepIdx) : msg.content;
              const question = sepIdx >= 0 ? msg.content.slice(sepIdx + SEPARATOR.length).trim() : '';

              // Extract all note markers and their content blocks
              const NOTE_MARKER_RE = /\[Прикреплена заметка: "([^"]+)"\]/g;
              const markers: { title: string; start: number; end: number }[] = [];
              for (const m of beforeSep.matchAll(NOTE_MARKER_RE)) {
                markers.push({ title: m[1] ?? 'Заметка', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
              }
              const notes: { title: string; body: string }[] = markers.map((mk, idx) => {
                const nextStart = idx + 1 < markers.length ? markers[idx + 1]!.start : beforeSep.length;
                const body = beforeSep.slice(mk.end, nextStart).trim();
                return { title: mk.title, body };
              });

              return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  <div className="max-w-[78%] flex flex-col items-end gap-1.5">
                    {notes.map((note, ni) => (
                      note.body
                        ? <AttachedNoteCard key={ni} content={`[Прикреплена заметка: "${note.title}"]\n\n${note.body}`} />
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
                🧠 Ход мысли
              </summary>
              <div className="px-4 py-3 text-xs text-text-main/60 leading-relaxed whitespace-pre-wrap border-t border-border-subtle">
                {streamingReasoning}
              </div>
            </details>
          )}

          {streamingMessage !== null && (
            <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono} content={streamingMessage}>
              <MarkdownRenderer content={processCitations(streamingMessage)} onCitationClick={handleCitationClick} />
            </AssistantTurn>
          )}

          {isLoading && !streamingMessage && (
            <AssistantTurn name={convPersonaName} color={convVisual.color} mono={convVisual.mono}>
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

          {!isLoading && streamingMessage === null && !error && lastAssistantIdx === displayMessages.length - 1 && displayMessages.length > 0 && (
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
