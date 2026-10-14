import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, File, Paperclip, Copy, Trash2, RefreshCw, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, FilePlus, MoreHorizontal } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { cn } from '../../../core/utils/utils';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useLanguage } from '../../../shared/i18n';

const ATTACHED_NOTE_RE = /^(?:\[#[^\]]*\]\s*)?\[Прикреплена заметка: "([^"]+)"\]/;
const ATTACHED_NOTE_SUMMARY_RE = /^(?:\[#[^\]]*\]\s*)?\[Прикреплено саммари заметки: "([^"]+)"\]/;
const ATTACHED_FILE_RE = /^(?:\[#[^\]]*\]\s*)?\[Прикреплен файл: "([^"]+)"\]/;

// Serif monogram tile in a persona's colour — the avatar used across header, threads and messages.
export function Monogram({ color, mono, size = 36, dim = false }: { color: string; mono: string; size?: number; dim?: boolean }) {
  const monogramStyle = (size: number, color: string, dim: boolean) => ({
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: size * 0.28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: dim ? `${color}14` : `linear-gradient(180deg, ${color}30, ${color}14)`,
    border: `1px solid ${color}${dim ? '2a' : '55'}`,
    boxShadow: dim ? 'none' : `0 0 14px ${color}26`,
    fontWeight: 600,
    fontSize: size * 0.38,
    color,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  });
  return (
    <span
      style={monogramStyle(size, color, dim)}
    >
      {mono}
    </span>
  );
}

export function threadPreview(d: { messages: { content: string }[] }): string {
  if (d.messages.length === 0) return '';
  const last = d.messages[d.messages.length - 1];
  if (last == null) return '';
  const c = last.content.replace(/^\[[^\]]*\]\s*/, '').trim();
  return c.length > 64 ? `${c.slice(0, 64)}…` : c;
}

export function AttachedNoteCard({ content }: { content: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_RE);
  const title = match?.[1] ?? t('ai_note_fallback');
  const noteContent = content.replace(ATTACHED_NOTE_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-brand-soft shadow-[0_0_8px_rgba(165,131,232,0.5)]" />
      <div className="min-w-0 flex-1">
        <Button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Paperclip size={12} className="text-text-main/60 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-text-main truncate">{title}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/60 shrink-0" aria-hidden="true" /> : <ChevronDown size={12} className="text-text-main/60 shrink-0" aria-hidden="true" />}
        </Button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
            {noteContent}
          </div>
        )}

      </div>
    </div>
  );
}

export function AttachedFileCard({ content }: { content: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_FILE_RE);
  const fileName = match?.[1] ?? t('ai_file_fallback');
  const fileContent = content.replace(ATTACHED_FILE_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-text-main/30" />
      <div className="min-w-0 flex-1">
        <Button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <File size={12} className="text-text-main/60 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-text-main truncate">{fileName}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/60 shrink-0" aria-hidden="true" /> : <ChevronDown size={12} className="text-text-main/60 shrink-0" aria-hidden="true" />}
        </Button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-60 overflow-y-auto">
            {fileContent}
          </div>
        )}
      </div>
    </div>
  );
}

export function AttachedSummaryCard({ content }: { content: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
  const title = match?.[1] ?? t('ai_note_fallback');
  const summaryContent = content.replace(ATTACHED_NOTE_SUMMARY_RE, '').trim();

  return (
    <div className="flex gap-3 items-stretch rounded-xl bg-surface-card border border-border-subtle p-2.5 pl-2">
      <span className="w-[3px] rounded-full bg-brand-soft shadow-[0_0_8px_rgba(165,131,232,0.5)]" />
      <div className="min-w-0 flex-1">
        <Button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Sparkles size={12} className="text-brand-soft shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-text-main truncate">{t('ai_attached_summary_title', { title })}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/60 shrink-0" aria-hidden="true" /> : <ChevronDown size={12} className="text-text-main/60 shrink-0" aria-hidden="true" />}
        </Button>
        {expanded && (
          <div className="mt-2 text-xs text-text-main/60 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {summaryContent}
          </div>
        )}
      </div>
    </div>
  );
}

// Letter-style assistant turn: monogram, name, serif body framed by a persona-coloured rule.
export const AssistantTurn = React.memo(
  function AssistantTurn({
    name,
    color,
    mono,
    children,
    onCopy,
    onDelete,
    onRegenerate,
    onFeedback,
    variants,
    variantIndex,
    onSwitchVariant,
    onCreateNote,
    isMobile = false,
    content: _content,
    reasoning: _reasoning,
  }: {
    name: string;
    color: string;
    mono: string;
    /** MC-5: на телефоне ответ ИИ — текст, а не пузырь: без колонки аватара и
     *  без левого бордера, действия — рядом иконок 44 px + «⋯». */
    isMobile?: boolean | undefined;
    children: React.ReactNode;
    onCopy?: () => void;
    onDelete?: () => void;
    onRegenerate?: (() => void) | undefined;
    onFeedback?: ((value: 'up' | 'down') => void) | undefined;
    variants?: string[] | undefined;
    variantIndex?: number | undefined;
    onSwitchVariant?: ((delta: number) => void) | undefined;
    onCreateNote?: (() => void) | undefined;
    content?: string | undefined;
    reasoning?: string | undefined;
  }) {
  const { t } = useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);
  const borderStyle = isMobile ? undefined : { borderLeft: `2px solid ${color}40` };
  const iconAction = 'h-11 w-11 rounded-xl';
  const moreActions = [onRegenerate, onSwitchVariant, onFeedback, onDelete].some(Boolean);
  return (
    <div className="flex gap-4 w-full self-start">
      {!isMobile && <Monogram color={color} mono={mono} size={36} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span className={cn('text-[13px] font-semibold', isMobile ? 'text-brand-soft' : 'text-text-main')}>{name}</span>
        </div>
        <div
          data-testid="assistant-text"
          className={
            isMobile
              ? 'min-w-0 text-[length:calc(var(--reading-size)-1px)] leading-[var(--reading-lh)] text-[var(--ink)]'
              : 'text-[15px] leading-[1.65] text-text-main/90 pl-[18px]'
          }
          style={borderStyle}
        >
          {children}
        </div>
        {isMobile && (onCopy || onCreateNote || onFeedback || onRegenerate || onDelete) && (
          <div className="mt-1 flex items-center gap-1">
            {onCopy && (
              <IconButton onClick={onCopy} label={t('ai_action_copy')} className={iconAction} icon={<Copy size={18} aria-hidden="true" />} />
            )}
            {onCreateNote && (
              <IconButton onClick={onCreateNote} label={t('ai_action_create_note')} className={iconAction} icon={<FilePlus size={18} aria-hidden="true" />} />
            )}
            {onFeedback && (
              <IconButton onClick={() => onFeedback('up')} label={t('ai_action_thumbs_up')} className={iconAction} icon={<ThumbsUp size={18} aria-hidden="true" />} />
            )}
            {moreActions && (
              <IconButton onClick={() => setMoreOpen(true)} label={t('ai_action_more')} className={iconAction} icon={<MoreHorizontal size={18} aria-hidden="true" />} />
            )}
          </div>
        )}
        {!isMobile && (onCopy || onDelete || onRegenerate || onFeedback || onCreateNote) && (
          <div className="flex gap-1 mt-3 -ml-2 flex-wrap">
            {onCopy && (
              <Button
                onClick={onCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <Copy size={11} aria-hidden="true" />
                {t('ai_action_copy')}
              </Button>
            )}
            {onCreateNote && (
              <Button
                onClick={onCreateNote}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <FilePlus size={11} aria-hidden="true" />
                {t('ai_action_create_note')}
              </Button>
            )}
            {onRegenerate && (
              <Button
                onClick={onRegenerate}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <RefreshCw size={11} aria-hidden="true" />
                {t('ai_action_regenerate')}
              </Button>
            )}
            {onSwitchVariant && variants && variants.length > 1 && (
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md text-text-main/40 font-mono text-[10px] tracking-wide">
                <button
                  type="button"
                  onClick={() => onSwitchVariant(-1)}
                  disabled={(variantIndex ?? 0) === 0}
                  className="p-0.5 hover:text-text-main/70 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={12} aria-hidden="true" />
                </button>
                <span>{(variantIndex ?? variants.length - 1) + 1}/{variants.length}</span>
                <button
                  type="button"
                  onClick={() => onSwitchVariant(1)}
                  disabled={(variantIndex ?? variants.length - 1) >= variants.length - 1}
                  className="p-0.5 hover:text-text-main/70 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            {onFeedback && (
              <>
                <Button
                  onClick={() => onFeedback('up')}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-main/35 hover:text-brand-soft hover:bg-brand-soft/10 transition-colors"
                  aria-label={t('ai_action_thumbs_up')}
                >
                  <ThumbsUp size={11} aria-hidden="true" />
                </Button>
                <Button
                  onClick={() => onFeedback('down')}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-main/35 hover:text-accent-danger hover:bg-accent-danger/10 transition-colors"
                  aria-label={t('ai_action_thumbs_down')}
                >
                  <ThumbsDown size={11} aria-hidden="true" />
                </Button>
              </>
            )}
            {onDelete && (
              <Button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-accent-danger hover:bg-accent-danger/10 transition-colors font-mono text-[10px] tracking-wide"
              >
                <Trash2 size={11} aria-hidden="true" />
                {t('ai_action_delete')}
              </Button>
            )}
          </div>
        )}

        {isMobile && moreOpen && (
          <ModalShell open onClose={() => setMoreOpen(false)} labelId="assistant-turn-more-title" variant="sheet">
            <div className="p-4 space-y-2 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              <h2 id="assistant-turn-more-title" className="text-sm font-semibold text-text-main">{t('ai_action_more')}</h2>
              {onRegenerate && (
                <Button
                  onClick={() => { onRegenerate(); setMoreOpen(false); }}
                  className="min-h-11 w-full justify-start gap-2 rounded-xl border border-border-subtle px-3 text-[15px] text-text-main"
                >
                  <RefreshCw size={16} aria-hidden="true" /> {t('ai_action_regenerate')}
                </Button>
              )}
              {onSwitchVariant && variants && variants.length > 1 && (
                <div className="flex items-center justify-between rounded-xl border border-border-subtle px-3 py-2 text-[14px] text-text-main/70">
                  <span>{t('ai_action_variants')}</span>
                  <span className="flex items-center gap-2">
                    <IconButton
                      onClick={() => onSwitchVariant(-1)}
                      disabled={(variantIndex ?? 0) === 0}
                      label={t('ai_action_prev_variant')}
                      className="h-11 w-11"
                      icon={<ChevronLeft size={18} aria-hidden="true" />}
                    />
                    <span className="tabular-nums">{(variantIndex ?? variants.length - 1) + 1}/{variants.length}</span>
                    <IconButton
                      onClick={() => onSwitchVariant(1)}
                      disabled={(variantIndex ?? variants.length - 1) >= variants.length - 1}
                      label={t('ai_action_next_variant')}
                      className="h-11 w-11"
                      icon={<ChevronRight size={18} aria-hidden="true" />}
                    />
                  </span>
                </div>
              )}
              {onFeedback && (
                <Button
                  onClick={() => { onFeedback('down'); setMoreOpen(false); }}
                  className="min-h-11 w-full justify-start gap-2 rounded-xl border border-border-subtle px-3 text-[15px] text-text-main"
                >
                  <ThumbsDown size={16} aria-hidden="true" /> {t('ai_action_thumbs_down')}
                </Button>
              )}
              {onDelete && (
                <Button
                  onClick={() => { onDelete(); setMoreOpen(false); }}
                  className="min-h-11 w-full justify-start gap-2 rounded-xl px-3 text-[15px] text-accent-danger"
                  variant="danger"
                >
                  <Trash2 size={16} aria-hidden="true" /> {t('ai_action_delete')}
                </Button>
              )}
            </div>
          </ModalShell>
        )}
      </div>
    </div>
  );
},
(prev, next) => {
  return (
    prev.name === next.name &&
    prev.color === next.color &&
    prev.mono === next.mono &&
    prev.variantIndex === next.variantIndex &&
    prev.content === next.content &&
    prev.reasoning === next.reasoning &&
    JSON.stringify(prev.variants) === JSON.stringify(next.variants)
  );
}
);

export { ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE };
