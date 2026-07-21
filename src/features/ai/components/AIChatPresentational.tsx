import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, File, Paperclip, Copy, Trash2, RefreshCw, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, FilePlus, CheckSquare } from 'lucide-react';
import { Button } from '../../../shared/components/Button';

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
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_RE);
  const title = match?.[1] ?? 'Заметка';
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
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_FILE_RE);
  const fileName = match?.[1] ?? 'Файл';
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
  const [expanded, setExpanded] = useState(false);
  const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
  const title = match?.[1] ?? 'Заметка';
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
            <span className="text-sm font-medium text-text-main truncate">Саммари: {title}</span>
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
export function AssistantTurn({
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
  onApplyToNote,
}: {
  name: string;
  color: string;
  mono: string;
  children: React.ReactNode;
  onCopy?: () => void;
  onDelete?: () => void;
  onRegenerate?: (() => void) | undefined;
  onFeedback?: ((value: 'up' | 'down') => void) | undefined;
  variants?: string[] | undefined;
  variantIndex?: number | undefined;
  onSwitchVariant?: ((delta: number) => void) | undefined;
  onCreateNote?: (() => void) | undefined;
  onApplyToNote?: (() => void) | undefined;
}) {
  const borderStyle = { borderLeft: `2px solid ${color}40` };
  return (
    <div className="flex gap-4 w-full self-start">
      <Monogram color={color} mono={mono} size={36} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span className="text-[13px] font-semibold text-text-main">{name}</span>
        </div>
        <div
          className="text-[15px] leading-[1.65] text-text-main/90 pl-[18px]"
          style={borderStyle}
        >
          {children}
        </div>
        {(onCopy || onDelete || onRegenerate || onFeedback || onCreateNote || onApplyToNote) && (
          <div className="flex gap-1 mt-3 -ml-2 flex-wrap">
            {onCopy && (
              <Button
                onClick={onCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <Copy size={11} aria-hidden="true" />
                копировать
              </Button>
            )}
            {onCreateNote && (
              <Button
                onClick={onCreateNote}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <FilePlus size={11} aria-hidden="true" />
                создать заметку
              </Button>
            )}
            {onApplyToNote && (
              <Button
                onClick={onApplyToNote}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <CheckSquare size={11} aria-hidden="true" />
                применить к заметке
              </Button>
            )}
            {onRegenerate && (
              <Button
                onClick={onRegenerate}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
              >
                <RefreshCw size={11} aria-hidden="true" />
                иначе
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
                  aria-label="Полезный ответ"
                >
                  <ThumbsUp size={11} aria-hidden="true" />
                </Button>
                <Button
                  onClick={() => onFeedback('down')}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-text-main/35 hover:text-accent-danger hover:bg-accent-danger/10 transition-colors"
                  aria-label="Не то"
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
                удалить
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE };
