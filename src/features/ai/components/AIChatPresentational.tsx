import React, { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, File, Paperclip, Copy } from 'lucide-react';

const ATTACHED_NOTE_RE = /^\[Прикреплена заметка: "([^"]+)"\]/;
const ATTACHED_NOTE_SUMMARY_RE = /^\[Прикреплено саммари заметки: "([^"]+)"\]/;
const ATTACHED_FILE_RE = /^\[Прикреплен файл: "([^"]+)"\]/;

// Serif monogram tile in a persona's colour — the avatar used across header, threads and messages.
export function Monogram({ color, mono, size = 36, dim = false }: { color: string; mono: string; size?: number; dim?: boolean }) {
  return (
    <span
      style={{
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
      }}
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
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Paperclip size={12} className="text-text-main/40 shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">{title}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
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
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <File size={12} className="text-text-main/40 shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">{fileName}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
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
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Sparkles size={12} className="text-brand-soft shrink-0" />
            <span className="text-sm font-medium text-text-main truncate">Саммари: {title}</span>
          </span>
          {expanded ? <ChevronUp size={12} className="text-text-main/40 shrink-0" /> : <ChevronDown size={12} className="text-text-main/40 shrink-0" />}
        </button>
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
}: {
  name: string;
  color: string;
  mono: string;
  children: React.ReactNode;
  onCopy?: () => void;
}) {
  return (
    <div className="flex gap-4 w-full self-start">
      <Monogram color={color} mono={mono} size={36} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 mb-2">
          <span className="text-[13px] font-semibold text-text-main">{name}</span>
        </div>
        <div
          className="text-[15px] leading-[1.65] text-text-main/90 pl-[18px]"
          style={{ borderLeft: `2px solid ${color}40` }}
        >
          {children}
        </div>
        {onCopy && (
          <div className="flex gap-1 mt-3 -ml-2">
            <button
              onClick={onCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-main/35 hover:text-text-main/70 hover:bg-text-main/5 transition-colors font-mono text-[10px] tracking-wide"
            >
              <Copy size={11} />
              копировать
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE };
