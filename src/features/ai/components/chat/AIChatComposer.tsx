import { useEffect, type RefObject, type ChangeEvent } from 'react';
import { Paperclip, File, Plus, ArrowRight, Square, X } from 'lucide-react';
import { Button } from '../../../../shared/components/Button';
import { IconButton } from '../../../../shared/components/IconButton';
import { useLanguage } from '../../../../shared/i18n';
import { cn } from '../../../../core/utils/utils';
import { CRISIS_RESOURCES } from '../../utils/riskDetect';

export interface PendingAttachment {
  title: string;
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
  attachMenuOpen: boolean;
  setAttachMenuOpen: (v: boolean) => void;
  attachMenuRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;  onOpenDocPicker: () => void;
  dailyLimitRemaining: number;
  dailyLimitTotal: number;
  reasoningRemaining?: number;
  reasoningLimit?: number;
  reasoning?: boolean;
  maxInputChars: number;
  personaName: string;
  crisisActive: boolean;
  dismissCrisis: () => void;
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
    attachMenuOpen,
    setAttachMenuOpen,
    attachMenuRef,
    fileInputRef,
    onFileUpload,
    onOpenDocPicker,
    dailyLimitRemaining,
    dailyLimitTotal,
    reasoningRemaining,
    reasoningLimit,
    reasoning,
    maxInputChars,
    personaName,
    crisisActive,
    dismissCrisis,
  } = props;
  const { t } = useLanguage();

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
              <p className="font-semibold mb-1">Если тяжело — ты не один. Можно позвонить живому человеку прямо сейчас:</p>
              <ul className="space-y-0.5">
                {CRISIS_RESOURCES.map(r => <li key={r}>{r}</li>)}
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
              Это заметка? Разобрать как заметку (точнее по тексту)
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
                  <Button
                    onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors flex items-center gap-2"
                  >
                    <File size={14} />
                    {t('ai_upload_file')}
                  </Button>
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              placeholder={t('ai_write_placeholder', { name: personaName.toLowerCase() })}
              disabled={isLoading || dailyLimitRemaining === 0}
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
                disabled={(!inputText.trim() && pendingAttachments.length === 0) || (reasoning ? (reasoningRemaining ?? 5) <= 0 : dailyLimitRemaining <= 0)}
                className="flex items-center gap-2 px-3 py-2.5 md:px-4 rounded-xl shrink-0 bg-gradient-to-b from-brand-soft to-brand-primary text-white text-[13.5px] font-semibold shadow-[0_4px_16px_rgba(125,79,209,0.35)] disabled:opacity-40 disabled:shadow-none transition-[color,background-color,box-shadow,opacity] duration-200"
              >
                <span className="hidden md:inline">{t('ai_send')}</span>
                <ArrowRight size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3.5 mt-2.5">
            <span className="text-[10px] font-mono text-text-main/60">
              {t('ai_quota_chat')} <b className="text-text-main/60">{dailyLimitRemaining}/{dailyLimitTotal}</b> · {t('ai_quota_reasoning')} <b className="text-text-main/60">{reasoningRemaining ?? 5}/{reasoningLimit ?? 5}</b>
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
