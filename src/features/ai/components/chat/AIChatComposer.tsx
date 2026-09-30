import { useEffect, type RefObject, type ChangeEvent } from 'react';
// File — вернуть вместе с пунктом «Загрузить файл» ниже.
import { Paperclip, Plus, ArrowRight, Square, X } from 'lucide-react';
import { Button } from '../../../../shared/components/Button';
import { IconButton } from '../../../../shared/components/IconButton';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';

export interface PendingAttachment {
  title: string;
  lastSessionAt?: number | undefined;
}

export interface AIChatComposerProps {
  inputText: string;
  setInputText: (v: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onStop: () => void;
  onSend: () => void;
  pendingAttachments: PendingAttachment[];
  removePendingAttachment: (idx: number) => void;
  onPasteAsNote: () => void;
  /** Заметка приложена, вопроса нет: «Разобрать» — строгий ход по ней. */
  onAnalyzeNote?: (() => void) | undefined;
  /** «Связать с другими записями» — широкий ход. */
  onRelateNote?: (() => void) | undefined;
  /** Есть, если последний ответ был строгим: кнопка «Посмотреть в других записях». */
  onLookWider?: (() => void) | undefined;
  attachMenuOpen: boolean;
  setAttachMenuOpen: (v: boolean) => void;
  attachMenuRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;  onOpenDocPicker: () => void;
  dailyLimitRemaining: number;
  dailyLimitTotal: number;
  /** SA-2: сервер не смог прочитать лимиты — локальные числа устарели. */
  quotaUnknown?: boolean;
  reasoningRemaining?: number;
  reasoningLimit?: number;
  reasoning?: boolean;
  maxInputChars: number;
  personaName: string;
  crisisActive: boolean;
  dismissCrisis: () => void;
}

// The server keys the daily quota by UTC date (postgresAiContext.ts `today()`),
// so the reset is the next UTC midnight. Shown as a relative "in N h": a local
// clock time reads oddly for anyone far from UTC (a person west of it sees the
// reset «at 19:00»). Hours to the next UTC midnight, rounded up, never 0.
function quotaResetInHours(): number {
  const now = Date.now();
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 3_600_000));
}

function QuotaMeter({ used, limit }: { used: number; limit: number }) {
  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const isWarning = remaining > 0 && remaining <= 2;
  const isDanger = remaining <= 0;

  return (
    <span className="inline-flex w-[40px] h-[3px] rounded-full bg-text-main/10 overflow-hidden shrink-0">
      <span
        className={cn(
          "h-full transition-[width]",
          isDanger ? "bg-accent-danger" : isWarning ? "bg-accent-warning" : "bg-text-main/50"
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function AIChatComposer(props: AIChatComposerProps) {
  const {
    inputText,
    setInputText,
    inputRef,
    isLoading,
    onStop,
    onSend,
    pendingAttachments,
    removePendingAttachment,
    onPasteAsNote,
    onAnalyzeNote,
    onRelateNote,
    onLookWider,
    attachMenuOpen,
    setAttachMenuOpen,
    attachMenuRef,
    fileInputRef,
    onFileUpload,
    onOpenDocPicker,
    dailyLimitRemaining,
    dailyLimitTotal,
    quotaUnknown,
    reasoningRemaining,
    reasoningLimit,
    reasoning,
    maxInputChars,
    personaName,
    crisisActive,
    dismissCrisis,
  } = props;
  const { t, language } = useLanguage();

  // Заметка приложена, вопроса нет — приложение само спрашивает, что с ней
  // сделать; модель не зовём, пока человек не выбрал.
  const askNoteAction = pendingAttachments.length > 0 && !inputText.trim() && !isLoading && !!onAnalyzeNote;
  const single = pendingAttachments.length === 1 ? pendingAttachments[0] : undefined;
  const noteQuestion = single?.lastSessionAt
    ? t('ai_note_what_to_do', {
        title: single.title,
        date: new Date(single.lastSessionAt).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      })
    : t('ai_note_what_to_do_plain');
  const chipClass = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-soft/10 border border-brand-soft/30 text-xs text-brand-soft hover:bg-brand-soft/20 transition-colors';

  const chatUsed = Math.max(0, dailyLimitTotal - dailyLimitRemaining);
  const chatWarning = dailyLimitRemaining > 0 && dailyLimitRemaining <= 2;
  const chatDanger = dailyLimitRemaining <= 0;

  const reasoningLim = reasoningLimit ?? 5;
  const reasoningRem = reasoningRemaining ?? 5;
  const reasoningUsed = Math.max(0, reasoningLim - reasoningRem);
  const reasoningWarning = reasoningRem > 0 && reasoningRem <= 2;
  const reasoningDanger = reasoningRem <= 0;

  // UI-07 review: chat and reasoning are separate server buckets. Gate BOTH the
  // input and the send button on the active mode's bucket — the send button was
  // SA-2: число, за которое сервер не ручается, не имеет права запирать доступ —
  // авторитет остаётся на сервере, он сам ответит 429.
  const outOfQuota = !quotaUnknown && (reasoning ? reasoningRem <= 0 : dailyLimitRemaining <= 0);
  const isReasoningOnly = reasoning && reasoningRem <= 0 && dailyLimitRemaining > 0;
  const quotaNoticeText = isReasoningOnly
    ? t('ai_quota_reasoning_exhausted')
    : t('ai_quota_exhausted');

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputText, inputRef]);

  return (
    <>
      {crisisActive && (
        <div className="relative z-10 mx-6 mb-2 rounded-xl border border-accent-danger/30 bg-accent-danger/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <span className="text-sm">🆘</span>
            <div className="flex-1 text-xs text-text-main/80 leading-relaxed">
              <p className="font-semibold mb-1">{t('ai_composer_crisis_title')}</p>
              <ul className="space-y-0.5">
                {[
                  t('ai_crisis_resource_1'),
                  t('ai_crisis_resource_2'),
                  t('ai_crisis_resource_3'),
                  t('ai_crisis_resource_4'),
                  t('ai_crisis_resource_abroad'),
                ].map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <button type="button" onClick={dismissCrisis} className="text-text-main/40 hover:text-text-main transition-colors" aria-label={t('ai_close')}><X size={14} /></button>
          </div>
        </div>
      )}

      <div className="relative z-10 px-6 py-4 border-t border-border-subtle">
        <div>
          {pendingAttachments.length === 0 && inputText.trim().length > 1500 && (
            <button
              type="button"
              onClick={onPasteAsNote}
              className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-soft/10 border border-brand-soft/30 text-xs text-brand-soft hover:bg-brand-soft/20 transition-colors"
            >
              <Paperclip size={12} />
              {t('ai_composer_paste_as_note')}
            </button>
          )}
          {askNoteAction && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={noteQuestion}>
              <span className="text-xs text-text-main/70 mr-1">{noteQuestion}</span>
              <button type="button" onClick={onAnalyzeNote} className={chipClass}>{t('ai_note_do_analyze')}</button>
              {onRelateNote && (
                <button type="button" onClick={onRelateNote} className={chipClass}>{t('ai_note_do_relate')}</button>
              )}
            </div>
          )}
          {onLookWider && pendingAttachments.length === 0 && !isLoading && (
            <button type="button" onClick={onLookWider} className={cn(chipClass, 'mb-2')}>
              {t('ai_note_look_wider')}
            </button>
          )}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map((att, idx) => (
                <div key={idx} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-brand-soft/30 text-xs text-text-main/80 max-w-full">
                  <Paperclip size={12} className="text-brand-soft shrink-0" />
                  <span className="truncate max-w-[200px]">{att.title}</span>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(idx)}
                    className="shrink-0 text-text-main/50 hover:text-text-main transition-colors"
                    aria-label={t('ai_close')}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {outOfQuota && (
            <div className="mb-2 px-3 py-2 rounded-xl bg-accent-warning/10 border border-accent-warning/20 text-xs text-accent-warning flex items-center justify-between">
              <span>{quotaNoticeText}</span>
            </div>
          )}
          <div className="flex items-end gap-2.5 p-2.5 pl-3.5 rounded-2xl bg-surface-card border border-border-subtle focus-within:border-brand-soft/40 transition-colors min-w-0">
            <div className="relative" ref={attachMenuRef}>
              <IconButton
                onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-elevated border border-border-subtle text-text-main/45 hover:text-text-main/70 transition-colors shrink-0"
                title={t('ai_attach')}
                label={t('ai_attach')}
                icon={<Plus size={15} />}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={onFileUpload}
              />
              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-48 border border-border-subtle rounded-xl shadow-xl overflow-hidden z-50 bg-surface-popup">
                  <Button
                    onClick={() => { setAttachMenuOpen(false); onOpenDocPicker(); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                  >
                    <Paperclip size={14} />
                    {t('ai_attach_note')}
                  </Button>
                  {/* Скрыто по решению владельца (2026-09-29): загрузка файла в чат убрана из меню.
                  <Button
                    onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                  >
                    <File size={14} />
                    {t('ai_upload_file')}
                  </Button>
                  */}
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              placeholder={outOfQuota ? quotaNoticeText : t('ai_write_placeholder', { name: personaName })}
              disabled={isLoading || outOfQuota}
              rows={1}
              className="flex-1 min-w-0 bg-transparent py-1.5 text-base text-text-main placeholder:text-text-main/40 outline-none disabled:opacity-40 resize-none overflow-y-auto max-h-40"
            />
            {isLoading ? (
              <Button
                onClick={onStop}
                className="flex items-center gap-2 px-3 py-2.5 md:px-4 rounded-xl shrink-0 bg-surface-elevated border border-border-subtle text-text-main/80 text-[13.5px] font-semibold hover:text-text-main transition-[color,background-color,border-color,opacity] duration-200"
              >
                <span className="w-3.5 h-3.5 rounded-full border-2 border-text-main/30 border-t-text-main/80 animate-spin" />
                <span className="hidden md:inline">{t('ai_processing')}</span>
                <Square size={13} className="fill-current" />
              </Button>
            ) : (
              <Button
                onClick={onSend}
                disabled={(!inputText.trim() && pendingAttachments.length === 0) || outOfQuota}
                className="flex items-center gap-2 px-3 py-2.5 md:px-4 rounded-xl shrink-0 bg-gradient-to-b from-brand-soft to-brand-primary text-surface-base text-[13.5px] font-semibold shadow-[0_4px_16px_rgba(125,79,209,0.35)] disabled:opacity-40 disabled:shadow-none transition-[color,background-color,box-shadow,opacity] duration-200"
              >
                <span className="hidden md:inline">{t('ai_send')}</span>
                <ArrowRight size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3.5 mt-2.5 flex-wrap">
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-text-main/60 flex-wrap">
              {quotaUnknown ? (
                <span>{t('ai_quota_unavailable')}</span>
              ) : (
                <>
                  <span>{t('ai_quota_chat')}</span>
                  <QuotaMeter used={chatUsed} limit={dailyLimitTotal} />
                  <b className={chatDanger ? "text-accent-danger" : chatWarning ? "text-accent-warning" : "text-text-main/60"}>
                    {dailyLimitRemaining}/{dailyLimitTotal}
                  </b>
                  <span>·</span>
                  <span>{t('ai_quota_reasoning')}</span>
                  <QuotaMeter used={reasoningUsed} limit={reasoningLim} />
                  <b className={reasoningDanger ? "text-accent-danger" : reasoningWarning ? "text-accent-warning" : "text-text-main/60"}>
                    {reasoningRem}/{reasoningLim}
                  </b>
                  {(chatDanger || reasoningDanger) && (
                    <span className="text-accent-danger ml-1">
                      ({t('ai_quota_reset_in', { hours: String(quotaResetInHours()) })})
                    </span>
                  )}
                </>
              )}
            </span>
            <div className="flex-1" />
            <span className={cn(
              "text-[10px] font-mono",
              inputText.length > maxInputChars * 0.9 ? "text-accent-danger" : "text-text-main/60"
            )}>
              {inputText.length.toLocaleString()}/{maxInputChars.toLocaleString()}
            </span>
            <div className="w-[120px] h-[3px] rounded-full bg-border-subtle overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-deep to-brand-soft transition-[width]"
                style={{ width: `${Math.min(100, (inputText.length / maxInputChars) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
